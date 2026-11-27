-- Corrida de vendedores passa a ser ordenada pelo valor vendido (antes: % da meta).
-- O vendedor continua sem receber o R$ dos colegas; só a ordem muda.
set search_path = public, extensions;

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
                        and vd.status = 'concluida' and vd.situacao_externa is distinct from 2
                        and vd.data_venda >= v_ini
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
   order by b.vendido desc, b.nome;
end $$;
