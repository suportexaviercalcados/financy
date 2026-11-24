-- Extensões ficam no schema "extensions" no Supabase hospedado
set search_path = public, extensions;

-- =====================================================================
-- FINANCY — 0014 Papel "vendedor" (acesso só à área de metas)
-- Fica num arquivo próprio: o novo valor do enum só pode ser usado
-- depois que esta transação for confirmada (usado na 0015).
-- =====================================================================
alter type papel_membro add value if not exists 'vendedor';
