-- Cancelamento vindo do Bling: estorna as baixas da venda e cancela (uso exclusivo do worker bling-sync).
-- O cancelamento manual (fn_cancelar_venda) continua exigindo o estorno antes.
set search_path = public, extensions;

create or replace function fn_cancelar_venda_bling(p_venda uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  -- estorno: a trigger de baixas barra período fechado e baixa já conciliada com o extrato
  delete from baixas where titulo_id in (select id from titulos where venda_id = p_venda);
  -- quitação anterior à data de corte não tem baixa nem movimento de caixa: só desfaz a marca
  perform set_config('financy.recalc', '1', true);
  update titulos set liquidado_pre_corte = false, valor_pago = 0, status = 'aberto'
   where venda_id = p_venda and liquidado_pre_corte and status <> 'cancelado';
  perform set_config('financy.recalc', '', true);
  perform fn_cancelar_venda(p_venda);
end $$;

revoke execute on function fn_cancelar_venda_bling(uuid) from public, anon, authenticated;
grant execute on function fn_cancelar_venda_bling(uuid) to service_role;
