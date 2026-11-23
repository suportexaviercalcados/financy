-- Extensões ficam no schema "extensions" no Supabase hospedado
set search_path = public, extensions;

-- =====================================================================
-- FINANCY — 0009 Correções de segurança (revisão)
-- 1) Convites só podem ser vistos/aceitos por e-mail CONFIRMADO
--    (evita que alguém crie conta não confirmada com o e-mail do convidado).
-- 2) Aceitar convite não altera o papel de quem já é membro (evita rebaixar
--    o único proprietário ou trocar o próprio papel via convite).
-- =====================================================================

create or replace function fn_email_confirmado() returns text
language sql stable security definer set search_path = public as $$
  select lower(email) from auth.users where id = auth.uid() and email_confirmed_at is not null
$$;
revoke execute on function fn_email_confirmado() from public, anon;

create or replace function fn_aceitar_convite(p_token text) returns uuid
language plpgsql security definer set search_path = public as $$
declare c convites%rowtype; v_email text := fn_email_confirmado();
begin
  if v_email is null then raise exception 'Confirme seu e-mail antes de aceitar convites.'; end if;
  select * into c from convites where token = p_token for update;
  if c.id is null or c.aceito_em is not null or c.expira_em < now() then raise exception 'Convite inválido ou expirado.'; end if;
  if lower(c.email) <> v_email then raise exception 'Este convite foi enviado para outro e-mail.'; end if;
  if exists (select 1 from membros where organizacao_id = c.organizacao_id and user_id = auth.uid()) then
    update convites set aceito_em = now() where id = c.id;
    return c.organizacao_id;   -- já é membro: papel não muda por convite
  end if;
  if (select count(*) from membros where organizacao_id = c.organizacao_id)
     >= (select p.max_usuarios from organizacoes o join planos p on p.id = o.plano_id where o.id = c.organizacao_id) then
    raise exception 'Limite de usuários do plano atingido.';
  end if;
  insert into membros (organizacao_id, user_id, papel) values (c.organizacao_id, auth.uid(), c.papel);
  update convites set aceito_em = now() where id = c.id;
  insert into profiles (user_id, organizacao_ativa_id) values (auth.uid(), c.organizacao_id)
  on conflict (user_id) do update set organizacao_ativa_id = excluded.organizacao_ativa_id;
  return c.organizacao_id;
end $$;

create or replace function fn_meus_convites() returns table (token text, organizacao text, papel papel_membro, expira_em timestamptz)
language sql stable security definer set search_path = public as $$
  select c.token, o.nome, c.papel, c.expira_em from convites c join organizacoes o on o.id = c.organizacao_id
   where fn_email_confirmado() is not null and lower(c.email) = fn_email_confirmado()
     and c.aceito_em is null and c.expira_em > now()
$$;
