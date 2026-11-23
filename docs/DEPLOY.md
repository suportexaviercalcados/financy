# Deploy: Supabase + Vercel

## 1. Supabase (backend e banco)

1. Crie o projeto em https://supabase.com, na região `sa-east-1` (São Paulo), e anote o `project-ref`.
2. Vincule o projeto e aplique as migrations:
   ```bash
   npx supabase login
   npx supabase link --project-ref <ref>
   npx supabase db push
   ```
   As migrations criam: schema, RLS, funções de cálculo, bucket privado `anexos`, as extensões `pg_cron`/`pg_net` e os agendamentos.
   - `financy-rotina-diaria`: 06:00 BRT (recorrências e alertas).
   - `financy-bling-sync`: a cada 10 min.
   - `financy-ia-semanal`: segunda, 08:00 BRT.
3. Publique as Edge Functions:
   ```bash
   npx supabase functions deploy bling-oauth bling-sync bling-webhook ai-assistant enviar-convite
   ```
   O `verify_jwt = false` de cada função já está em `supabase/config.toml`. Cada função faz a própria autenticação (JWT do usuário, segredo do cron ou HMAC do Bling).
4. Configure os segredos:
   ```bash
   npx supabase secrets set APP_URL=https://seu-app.vercel.app \
     TOKEN_ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))") \
     CRON_SECRET=$(node -e "console.log(require('crypto').randomBytes(24).toString('hex'))") \
     BLING_CLIENT_ID=... BLING_CLIENT_SECRET=... OPENROUTER_API_KEY=...
   ```
   > Guarde a `TOKEN_ENCRYPTION_KEY`. Se ela mudar, os tokens do Bling já gravados não podem ser decifrados e as contas precisam ser reconectadas.
5. Grave no Vault os valores usados pelo pg_cron (SQL Editor). O `cron_secret` deve ser igual ao `CRON_SECRET` da etapa 4:
   ```sql
   select vault.create_secret('https://<ref>.supabase.co', 'project_url');
   select vault.create_secret('<mesmo CRON_SECRET>', 'cron_secret');
   ```
6. Em **Authentication → URL Configuration**:
   - Site URL: `https://seu-app.vercel.app`
   - Redirect URLs: `https://seu-app.vercel.app/**`
7. Em **Authentication → Emails → SMTP**, configure um SMTP próprio (Resend, SES, Postmark…). O SMTP padrão do Supabase tem limite baixo e não serve para produção.
8. Confirme que o fuso do banco é `America/Sao_Paulo` (a primeira migration faz `alter database postgres set timezone`).

## 2. Vercel (frontend)

1. Importe o repositório na Vercel. O framework Vite é detectado e o `vercel.json` já define o rewrite de SPA e os headers de segurança.
2. Defina as variáveis de ambiente (Production e Preview):
   - `VITE_SUPABASE_URL` = `https://<ref>.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` = a chave anon/publishable (**nunca** a service_role)
3. Faça o deploy. Depois, atualize `APP_URL` (etapa 1.4) e as URLs de Auth (etapa 1.6) com o domínio final.

## 3. Primeiro acesso

1. Crie a sua conta em `/cadastro` e conclua o assistente inicial.
2. Torne-se administrador da plataforma:
   ```sql
   insert into platform_admins (user_id) select id from auth.users where email = 'voce@empresa.com';
   ```
3. Siga docs/BLING.md e docs/OPENROUTER.md para ativar as integrações.
