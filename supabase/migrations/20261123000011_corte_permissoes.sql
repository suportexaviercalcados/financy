-- Extensões ficam no schema "extensions" no Supabase hospedado
set search_path = public, extensions;

-- =====================================================================
-- FINANCY — 0011 Correção de segurança (revisão da 0010)
-- fn_liquidar_pre_corte aceitava chamadas sem usuário (auth.uid() nulo),
-- o que liberaria a quitação de títulos por chamada anônima à API.
-- Agora: só usuário com escrita na organização, service_role ou execução
-- interna (dono das funções, ex.: dentro de fn_registrar_venda); e as
-- funções deixam de ser executáveis diretamente pelos clientes da API.
-- =====================================================================

create or replace function fn_liquidar_pre_corte(p_titulo uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t titulos%rowtype; v_corte date;
begin
  select * into t from titulos where id = p_titulo for update;
  if t.id is null then raise exception 'Título não encontrado.'; end if;
  if not (fn_can_write(t.organizacao_id)
          or coalesce(auth.role(), '') = 'service_role'
          or session_user in ('postgres', 'supabase_admin')) then
    raise exception 'Sem permissão.';
  end if;
  v_corte := fn_data_corte(t.empresa_id);
  if v_corte is null or t.data_vencimento >= v_corte then
    raise exception 'Somente títulos vencidos antes da data de corte do caixa (%) podem ser quitados sem baixa.', to_char(v_corte,'DD/MM/YYYY');
  end if;
  if t.status = 'cancelado' or exists (select 1 from baixas where titulo_id = p_titulo) then return; end if;
  perform set_config('financy.recalc', '1', true);
  update titulos set liquidado_pre_corte = true, valor_pago = valor, status = 'pago' where id = p_titulo;
  perform set_config('financy.recalc', '', true);
end $$;

-- Uso interno apenas (chamadas por fn_registrar_venda e pelo worker com service_role)
revoke execute on function fn_liquidar_pre_corte(uuid) from public, anon, authenticated;
revoke execute on function fn_data_corte(uuid) from public, anon, authenticated;
grant execute on function fn_liquidar_pre_corte(uuid) to service_role;
grant execute on function fn_data_corte(uuid) to service_role;
