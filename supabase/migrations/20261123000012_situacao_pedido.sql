-- Extensões ficam no schema "extensions" no Supabase hospedado
set search_path = public, extensions;

-- =====================================================================
-- FINANCY — 0012 Situação do pedido no sistema de origem (Bling)
-- Guarda o status do pedido importado (situacao.valor do Bling) para auditoria
-- e para o filtro de importação (padrão: Atendido = 1 e Verificado = 11).
-- =====================================================================
alter table vendas add column if not exists situacao_externa int;
comment on column vendas.situacao_externa is 'Bling situacao.valor: 0 aberto, 1 atendido, 3 andamento, 5 fat. parcial, 6 atend. parcial, 7 aguard. pgto, 8 pgto confirmado, 10 digitação, 11 verificado, 12 checkout parcial';
