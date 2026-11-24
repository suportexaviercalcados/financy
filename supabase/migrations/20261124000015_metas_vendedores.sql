-- Extensões ficam no schema "extensions" no Supabase hospedado
set search_path = public, extensions;

-- =====================================================================
-- FINANCY — 0015 Metas de vendedores
-- * Vendedor: membro com papel 'vendedor'. NÃO lê nenhum dado da organização
--   pelas políticas genéricas (fn_orgs_leitura / fn_can_read o excluem);
--   só enxerga a própria meta e a corrida via fn_corrida_vendedores.
-- * Venda → vendedor: vendas.vendedor_externo guarda vendedor.id do Bling;
--   integracao_mapeamentos (tipo 'vendedor') liga esse id ao usuário do Financy.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Permissões: vendedor fora da leitura geral
-- ---------------------------------------------------------------------
create or replace function fn_orgs_leitura() returns setof uuid
language sql stable security definer set search_path = public as $$
  select organizacao_id from membros where user_id = auth.uid() and papel <> 'vendedor'
  union
  select organizacao_id from acessos_suporte
   where admin_user_id = auth.uid() and revogado_em is null and expira_em > now()
$$;

create or replace function fn_can_read(org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where organizacao_id = org and user_id = auth.uid() and papel <> 'vendedor')
      or exists(select 1 from acessos_suporte s
                 where s.organizacao_id = org and s.admin_user_id = auth.uid()
                   and s.revogado_em is null and s.expira_em > now())
$$;

-- Todas as organizações em que o usuário é membro (inclusive como vendedor)
create or replace function fn_orgs_membro() returns setof uuid
language sql stable security definer set search_path = public as $$
  select organizacao_id from membros where user_id = auth.uid()
$$;

-- Vendedor vê o nome da organização e a própria linha em membros (para o app saber o papel)
drop policy if exists p_select on organizacoes;
create policy p_select on organizacoes for select to authenticated
  using (id in (select fn_orgs_membro()) or id in (select fn_orgs_leitura()));
drop policy if exists p_self on membros;
create policy p_self on membros for select to authenticated using (user_id = auth.uid());

-- ---------------------------------------------------------------------
-- Vínculo venda → vendedor (Bling)
-- ---------------------------------------------------------------------
alter table vendas add column if not exists vendedor_externo text;
comment on column vendas.vendedor_externo is 'Bling vendedor.id do pedido; ligado ao usuário via integracao_mapeamentos (tipo vendedor)';
create index if not exists vendas_vendedor_idx on vendas(organizacao_id, vendedor_externo, data_venda) where vendedor_externo is not null;

alter table integracao_mapeamentos drop constraint if exists integracao_mapeamentos_tipo_check;
alter table integracao_mapeamentos add constraint integracao_mapeamentos_tipo_check
  check (tipo in ('loja','forma_pagamento','categoria','vendedor'));
comment on column integracao_mapeamentos.interno_id is 'canal / forma de pagamento / categoria do plano de contas / user_id do vendedor';

alter table sync_jobs drop constraint if exists sync_jobs_recurso_check;
alter table sync_jobs add constraint sync_jobs_recurso_check
  check (recurso in ('cadastros','produtos','contatos','vendas','contas_pagar','contas_receber','venda_unica','vendedores'));

-- ---------------------------------------------------------------------
-- Metas mensais por vendedor e megaprêmio do mês
-- ---------------------------------------------------------------------
create table if not exists metas_vendedor (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  user_id uuid not null,
  competencia date not null check (extract(day from competencia) = 1),
  valor numeric(14,2) not null check (valor > 0),
  created_at timestamptz not null default now(),
  foreign key (organizacao_id, user_id) references membros(organizacao_id, user_id) on delete cascade,
  unique (organizacao_id, user_id, competencia)
);

create table if not exists premios_mes (
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  competencia date not null check (extract(day from competencia) = 1),
  descricao text not null check (length(trim(descricao)) between 2 and 300),
  -- critério: maior % da meta; só concorre quem atingir ao menos pct_minimo
  pct_minimo numeric(6,2) not null default 100 check (pct_minimo between 0 and 1000),
  primary key (organizacao_id, competencia)
);

alter table metas_vendedor enable row level security;
-- equipe financeira lê tudo; o vendedor lê só a própria meta
create policy p_select on metas_vendedor for select to authenticated
  using (organizacao_id in (select fn_orgs_leitura()) or user_id = auth.uid());
create policy p_insert on metas_vendedor for insert to authenticated with check (organizacao_id in (select fn_orgs_admin()));
create policy p_update on metas_vendedor for update to authenticated
  using (organizacao_id in (select fn_orgs_admin())) with check (organizacao_id in (select fn_orgs_admin()));
create policy p_delete on metas_vendedor for delete to authenticated using (organizacao_id in (select fn_orgs_admin()));

alter table premios_mes enable row level security;
create policy p_select on premios_mes for select to authenticated
  using (organizacao_id in (select fn_orgs_membro()) or organizacao_id in (select fn_orgs_leitura()));
create policy p_insert on premios_mes for insert to authenticated with check (organizacao_id in (select fn_orgs_admin()));
create policy p_update on premios_mes for update to authenticated
  using (organizacao_id in (select fn_orgs_admin())) with check (organizacao_id in (select fn_orgs_admin()));
create policy p_delete on premios_mes for delete to authenticated using (organizacao_id in (select fn_orgs_admin()));

-- ---------------------------------------------------------------------
-- Corrida / andamento do mês
-- Participa quem tem meta no mês. Vendido = produtos − desconto (sem frete) das vendas concluídas.
-- Valores em R$ só para a equipe com leitura (fn_can_read) ou para o próprio vendedor;
-- para os demais vendedores, apenas nome e % da meta.
-- ---------------------------------------------------------------------
create or replace function fn_corrida_vendedores(p_org uuid, p_competencia date)
returns table (user_id uuid, nome text, meta numeric, vendido numeric, pct numeric, eu boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare v_ini date := date_trunc('month', p_competencia)::date; v_tudo boolean;
begin
  if p_org not in (select fn_orgs_membro()) and not fn_can_read(p_org) then
    raise exception 'Sem acesso a esta organização.';
  end if;
  v_tudo := fn_can_read(p_org);
  return query
  with base as (
    select mv.user_id,
           coalesce(nullif(trim(pr.nome), ''), split_part(u.email::text, '@', 1)) as nome,
           mv.valor as meta,
           coalesce((select sum(vd.valor_produtos - vd.desconto)
                       from integracao_mapeamentos im
                       join integracoes i on i.id = im.integracao_id
                       join vendas vd on vd.organizacao_id = im.organizacao_id and vd.empresa_id = i.empresa_id
                                     and vd.vendedor_externo = im.external_id
                      where im.organizacao_id = p_org and im.tipo = 'vendedor' and im.interno_id = mv.user_id
                        and vd.status = 'concluida' and vd.data_venda >= v_ini
                        and vd.data_venda < (v_ini + interval '1 month')::date), 0) as vendido
      from metas_vendedor mv
      join auth.users u on u.id = mv.user_id
      left join profiles pr on pr.user_id = mv.user_id
     where mv.organizacao_id = p_org and mv.competencia = v_ini
  )
  select b.user_id, b.nome,
         case when v_tudo or b.user_id = auth.uid() then b.meta end,
         case when v_tudo or b.user_id = auth.uid() then b.vendido end,
         round(b.vendido / b.meta * 100, 1),
         b.user_id = auth.uid()
    from base b
   order by round(b.vendido / b.meta * 100, 1) desc, b.nome;
end $$;
revoke execute on function fn_corrida_vendedores(uuid, date) from public, anon;
grant execute on function fn_corrida_vendedores(uuid, date) to authenticated;

-- Reprocessa o vínculo das vendas já importadas (o job roda na próxima execução do bling-sync)
insert into sync_jobs (organizacao_id, integracao_id, tipo, recurso)
select i.organizacao_id, i.id, 'manual', 'vendedores' from integracoes i
 where i.status in ('conectado','erro')
   and not exists (select 1 from sync_jobs j where j.integracao_id = i.id and j.recurso = 'vendedores' and j.status in ('pendente','executando'));
