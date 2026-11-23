# Integração com o Bling (API v3)

As URLs e campos foram conferidos no OpenAPI oficial publicado em https://developer.bling.com.br/referencia (arquivo `openapi-*.json`).

| Item | Valor |
|---|---|
| Base da API | `https://api.bling.com.br/Api/v3` |
| Autorização (OAuth 2.0, authorization code) | `https://bling.com.br/Api/v3/oauth/authorize?response_type=code&client_id=…&state=…` |
| Token / refresh | `POST https://bling.com.br/Api/v3/oauth/token` com `Authorization: Basic base64(client_id:client_secret)` e corpo form-urlencoded (`grant_type=authorization_code&code=…` ou `grant_type=refresh_token&refresh_token=…`). O code expira em 30 s. |
| Limites | 3 req/s e 120.000/dia por conta (HTTP 429). O cliente espaça as chamadas em 350 ms e faz retry exponencial. Filtros de período devem ter no máximo 1 ano (o sistema divide em janelas). |
| Webhook | Header `X-Bling-Signature-256: sha256=<hmac hex>`, com HMAC-SHA256 do corpo usando o client secret. A resposta 2xx precisa sair em até 5 s. |

## O que é importado

| Recurso | Endpoint | Destino no sistema |
|---|---|---|
| Formas de pagamento | `/formas-pagamentos` | Mapeamento automático por `tipoPagamento` → formas do sistema (editável) |
| Lojas / canais | `/canais-venda` | Mapeamento para canais de venda (cria o canal quando não existe) |
| Categorias financeiras | `/categorias/receitas-despesas` | Mapeamento manual para o plano de contas (sem mapeamento = categoria padrão "Outras") |
| Produtos | `/produtos` (incremental por `dataAlteracaoInicial`) | Produtos. `precoCusto` > 0 vira o custo; o custo manual nunca é apagado |
| Contatos | `/contatos` | Clientes e fornecedores |
| Pedidos de venda | `/pedidos/vendas` + `/pedidos/vendas/{id}` | `fn_registrar_venda`: itens, CMV, taxas e recebíveis. Pedido cancelado (`situacao.valor = 2`) cancela a venda. Pedidos "em digitação" (10) são ignorados |
| Contas a pagar | `/contas/pagar` + detalhe | Títulos a pagar (`external_id = CP-<id>`) |
| Contas a receber | `/contas/receber` + detalhe | Títulos a receber (`CR-<id>`). Contas com `origem.tipoOrigem = venda` são ignoradas quando a importação de vendas está ativa, para não duplicar com os recebíveis do pedido |

- **Contas pagas no Bling.** Só viram baixa se a organização escolher uma "conta para registrar pagamentos". O recomendado é deixar em branco e baixar pela conciliação OFX, que é a fonte real do caixa.
- **Pedidos já importados.** Não são reprocessados, salvo o cancelamento. Alterações posteriores de itens ou valores no Bling não são aplicadas automaticamente. Para corrigir, cancele e reimporte, ou ajuste manualmente.

## Ativar a integração real

1. Na **Central de Extensões do Bling** (Área do Integrador), crie um aplicativo:
   - **Link de redirecionamento:** `https://<SEU-PROJETO>.supabase.co/functions/v1/bling-oauth`
   - **Escopos:** pedidos de venda, produtos, contatos, formas de pagamento, canais de venda, categorias de receitas/despesas, contas a pagar, contas a receber e dados básicos da empresa.
   - **Webhooks (aba Webhooks):** URL `https://<SEU-PROJETO>.supabase.co/functions/v1/bling-webhook`, recursos `order` e `product`, ações created/updated/deleted, versão 1.
2. Grave os segredos no Supabase:
   ```bash
   npx supabase secrets set BLING_CLIENT_ID=... BLING_CLIENT_SECRET=... APP_URL=https://seu-app.vercel.app
   ```
3. No sistema, acesse **Configurações → Integração Bling**, escolha a data inicial do histórico e clique em **Conectar Bling**. O usuário autoriza no Bling e volta com a sincronização inicial agendada.
4. A sincronização incremental roda a cada 10 minutos pelo `pg_cron`, desde que o Vault esteja configurado (ver docs/DEPLOY.md). Também pode ser disparada em **Sincronizar agora**.
5. Revise os **Mapeamentos** de loja → canal, formas de pagamento e categorias. Configure as taxas por canal e forma em **Cadastros → Canais e taxas**: elas definem os recebíveis líquidos dos pedidos importados.

## Pendências conhecidas

- O fluxo completo ainda não foi executado contra uma conta Bling real neste ambiente, porque não há credenciais. Valide com uma conta de teste antes de liberar aos clientes.
- O nome exato do campo de token no JSON de resposta segue o padrão OAuth (`access_token`, `refresh_token`, `expires_in`). A documentação do Bling omite a tabela de resposta na renderização pública, então confirme na primeira conexão (os logs da função registram o erro, sem os tokens).
