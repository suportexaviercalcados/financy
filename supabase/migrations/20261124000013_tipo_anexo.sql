-- Extensões ficam no schema "extensions" no Supabase hospedado
set search_path = public, extensions;

-- =====================================================================
-- FINANCY — 0013 Tipo do anexo (boleto, comprovante, nota fiscal)
-- =====================================================================
alter table titulo_anexos add column if not exists tipo text not null default 'outro'
  check (tipo in ('boleto', 'comprovante', 'nota_fiscal', 'outro'));
create index if not exists titulo_anexos_titulo_idx on titulo_anexos(titulo_id);
