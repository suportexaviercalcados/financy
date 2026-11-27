-- Metas em 3 níveis (Alcançável, Desejável, Supermeta) com comissão por nível.
-- metas_vendedor.valor é a meta Alcançável; Desejável e Supermeta são um acréscimo percentual sobre ela.
-- Sem linha para o mês, o app usa o padrão: +20% / +30% e comissão de 1% / 1,5% / 2%.
set search_path = public, extensions;

create table if not exists metas_niveis_mes (
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  competencia date not null check (extract(day from competencia) = 1),
  pct_desejavel numeric(6,2) not null default 20 check (pct_desejavel > 0),
  pct_super numeric(6,2) not null default 30,
  com_alcancavel numeric(5,2) not null default 1 check (com_alcancavel between 0 and 100),
  com_desejavel numeric(5,2) not null default 1.5 check (com_desejavel between 0 and 100),
  com_super numeric(5,2) not null default 2 check (com_super between 0 and 100),
  primary key (organizacao_id, competencia),
  check (pct_super > pct_desejavel)
);

alter table metas_niveis_mes enable row level security;
-- vendedor precisa ler para ver os próprios níveis; só admin altera
create policy p_select on metas_niveis_mes for select to authenticated
  using (organizacao_id in (select fn_orgs_membro()) or organizacao_id in (select fn_orgs_leitura()));
create policy p_insert on metas_niveis_mes for insert to authenticated with check (organizacao_id in (select fn_orgs_admin()));
create policy p_update on metas_niveis_mes for update to authenticated
  using (organizacao_id in (select fn_orgs_admin())) with check (organizacao_id in (select fn_orgs_admin()));
create policy p_delete on metas_niveis_mes for delete to authenticated using (organizacao_id in (select fn_orgs_admin()));
