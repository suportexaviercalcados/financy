# Financy — Gestão financeira SaaS para varejo

SaaS multi-tenant de gestão financeira para varejo. Inclui dashboard gerencial, contas a pagar e receber, vendas por canal com recebíveis de cartão, fluxo de caixa com simulação, conciliação OFX, DRE (competência), DFC (caixa), metas, orçamento, empréstimos (SAC/Price), integração Bling v3 e IA via OpenRouter.

- **Frontend:** React 19, TypeScript, Vite, Tailwind v4, shadcn/ui (Base UI), TanStack Query, React Router, Recharts. Deploy na Vercel.
- **Backend:** Supabase com Postgres 17, Auth, Storage, RLS, Edge Functions (Deno), pg_cron e pg_net.
- **Documentação:**
  - [docs/ARQUITETURA.md](docs/ARQUITETURA.md): decisões técnicas
  - [docs/DEPLOY.md](docs/DEPLOY.md): Supabase e Vercel
  - [docs/BLING.md](docs/BLING.md): integração Bling
  - [docs/OPENROUTER.md](docs/OPENROUTER.md): IA
  - [docs/PRODUCAO.md](docs/PRODUCAO.md): checklist de produção

## Rodar localmente

Pré-requisitos: Node 20+ e Docker Desktop.

```bash
npm install
npm run db:start            # sobe o Supabase local (portas 554xx; ver supabase/config.toml)
npx supabase status -o env  # copie API_URL e ANON_KEY
```

1. Crie o arquivo `.env.local` com `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.
2. Crie o arquivo `.env.test.local` com `SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY`, usando o modelo `.env.example`.
3. Crie o arquivo `supabase/functions/.env` com `APP_URL`, `TOKEN_ENCRYPTION_KEY` e `CRON_SECRET`. Para ativar as integrações reais, preencha também `BLING_*` e `OPENROUTER_API_KEY`.

```bash
npm run db:reset   # aplica todas as migrations
npm run dev        # http://localhost:5173
```

Na primeira vez, crie uma conta em **/cadastro**. O assistente inicial cria a organização, o plano de contas padrão, as contas bancárias e os canais com taxas. Ele também oferece a conexão com o Bling e a primeira importação OFX.

Para conhecer o sistema sem dados reais, clique em **"Explorar com dados de demonstração"**. Isso cria uma organização separada, identificada como demonstração, com dados fictícios de origem `demo`. Nenhum desses dados é atribuído ao Bling ou à IA.

> Se o Docker for reiniciado e as Edge Functions responderem 503, execute `docker start supabase_edge_runtime_financy`.

## Testes

```bash
npm test                 # tudo (requer Supabase local rodando)
npm run test:unit        # leitor OFX, simulação de caixa, formatação
npm run test:integration # fluxos críticos contra o banco real com RLS
```

Os testes de integração (`tests/integration/financeiro.test.ts`) usam as migrations reais e usuários reais do Supabase Auth. Eles cobrem:

- DRE completa (impostos estimados, CMV, despesas variáveis e fixas, juros), DFC direta e indireta conciliada com o saldo bancário, fluxo de caixa e projeção;
- recebíveis gerados por vendas com taxa percentual + fixa, parcelamento, prazos e liquidação imediata de PIX;
- amortização SAC e Price, com juros na DRE e amortização na DFC de financiamento;
- idempotência do OFX (mesmo arquivo e arquivos sobrepostos pelo FITID) e do Bling (pedido e conta reimportados);
- isolamento entre organizações (leitura, escrita, referências cruzadas, RPCs), papel visualizador e colunas protegidas;
- concorrência de baixas, idempotência de baixa, fechamento e reabertura de período, recorrências e devoluções.

## Estrutura

```
src/
  pages/            telas (Dashboard, Vendas, Contas, Fluxo, Conciliação, DRE, DFC, IA, cadastros, config, Admin…)
  components/       layout, DataTable (ordenação/exportação), CrudPage, Drilldown, formulários
  contexts/         auth, organização ativa + filtros globais, tema
  lib/              supabase, formatação pt-BR, leitor OFX, simulação de caixa, exportação PDF/Excel
supabase/
  migrations/       schema, RLS, funções de cálculo (fonte única de DRE/DFC/fluxo/dashboard), cron
  functions/        bling-oauth, bling-sync, bling-webhook, ai-assistant, enviar-convite
tests/integration/  testes dos fluxos críticos
```

## O que depende de credenciais externas

| Item | Situação | Como ativar |
|---|---|---|
| Bling v3 | Código completo: OAuth, sincronização com fila, webhook com HMAC e mapeamentos. Não foi exercitado contra uma conta Bling real. | [docs/BLING.md](docs/BLING.md) |
| IA (OpenRouter) | Código completo: ferramentas, limites, idempotência e registro. Sem chave, retorna "IA não configurada" e nunca simula respostas. | [docs/OPENROUTER.md](docs/OPENROUTER.md) |
| E-mail (convites, confirmação, senha) | Local: Mailpit (http://127.0.0.1:55424). Produção: configure o SMTP no Supabase. | [docs/DEPLOY.md](docs/DEPLOY.md) |
| Cobrança | Estrutura de planos e assinaturas pronta, sem gateway, conforme o escopo. | — |
