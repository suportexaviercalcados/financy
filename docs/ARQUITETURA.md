# Arquitetura e decisões técnicas

## Multi-tenant e segurança

- Toda tabela de negócio tem `organizacao_id`. O RLS libera a leitura para membros (`fn_orgs_leitura()`). A escrita vai para proprietário, administrador e financeiro (`fn_orgs_escrita()`) ou só para proprietário e administrador (`fn_orgs_admin()`), conforme a tabela.
- Referências entre tabelas usam **FK composta** `(id, organizacao_id)`. Uma organização não consegue apontar para uma categoria, conta ou contato de outra, mesmo conhecendo o UUID.
- Colunas sensíveis ficam protegidas no banco:
  - `organizacoes.plano_id` é imutável para o cliente;
  - `titulos.valor_pago` e o status de pagamento só mudam por baixas (gatilho com flag de sessão);
  - `movimentos`, `vendas`, `venda_itens` e `venda_pagamentos` só são gravados por funções e gatilhos;
  - `sync_jobs`, `sync_logs`, `ia_execucoes` e `audit_log` são somente leitura para o cliente.
- O super administrador vê apenas agregados (`fn_admin_organizacoes`). Para ler dados financeiros, precisa de uma concessão em `acessos_suporte`. A concessão é feita pelo proprietário, é temporária, somente leitura e auditada.
- Os tokens do Bling são criptografados com AES-256-GCM na Edge Function. A tabela `integracao_tokens` não tem política RLS: só a `service_role` a acessa.
- O webhook do Bling é validado por HMAC-SHA256 (`X-Bling-Signature-256`) com comparação em tempo constante. O cron usa um segredo compartilhado guardado no Vault.

## Fonte única de cálculo

Todos os números saem de funções SQL `SECURITY INVOKER`, sujeitas a RLS:

| Função | Uso |
|---|---|
| `vw_dre_base` | Fatos de competência rastreáveis: títulos, vendas, devoluções, encargos de baixas e depreciação |
| `fn_dre_fatos` / `fn_dre` / `fn_dre_categorias` / `fn_dre_lancamentos` | DRE, detalhamento, orçado e drill-down, com rateio por canal |
| `vw_movimentos_classificados` / `fn_dfc` / `fn_dfc_categorias` / `fn_dfc_indireto` | DFC conciliada com `fn_saldo_total` |
| `fn_fluxo_caixa` / `fn_projecao_diaria` | Realizado × previsto e projeção |
| `fn_vendas_por_canal` / `fn_ranking_produtos` | Mesma base da DRE |
| `fn_dashboard` / `fn_evolucao_mensal` | Compõem as funções acima |

A IA usa exatamente essas funções. Por isso dashboard, relatórios e IA nunca divergem.

## Regras contábeis adotadas

- **Vendas.** Receita bruta = produtos + frete cobrado. Os descontos entram nas deduções. O CMV é o custo do produto congelado no momento da venda. Taxas de pagamento, marketplace, comissão e frete são despesas variáveis.
  - Os recebíveis são criados líquidos de taxa, com o bruto e a taxa guardados no título.
  - Títulos com `venda_id` são excluídos da DRE (a venda já está nela), mas aparecem no caixa e na DFC.
- **Impostos sobre vendas.** No modo `estimado`, o imposto é alíquota × total da venda, e os títulos da categoria de impostos ficam fora da DRE (entram só no caixa). No modo `lancado`, usam-se as guias lançadas.
- **Compras de mercadoria.** Ficam fora da DRE (`nao_dre`), porque o CMV vem das vendas. Entram na DFC operacional e aparecem como ajuste na DFC indireta.
- **Juros e multas pagos ou recebidos nas baixas.** Entram no resultado financeiro na data da baixa. Descontos obtidos são receita financeira; descontos concedidos na baixa são despesa financeira.
- **Empréstimos.** Cada parcela gera dois títulos: amortização (fora da DRE, DFC de financiamento) e juros (despesa financeira). A captação entra na DFC de financiamento.
- **Transferências.** Geram dois movimentos e nunca entram em DRE ou DFC.
- **Saldo de caixa.** É o saldo inicial na data de corte + movimentos. Movimentos anteriores à data de corte são bloqueados.
- **DFC por canal e rateio.** As despesas sem canal são rateadas pelo faturamento do canal no mês ou pelo percentual manual (configurável na organização).

## Concorrência e idempotência

- Baixas travam o título (`SELECT … FOR UPDATE`) e validam o saldo. Aceitam `idempotency_key`.
- Conciliações travam a transação e o movimento, e validam conta, sentido e soma.
- O OFX é deduplicado pelo hash do arquivo por conta e por `(conta, FITID)`.
- Vendas, títulos, produtos e contatos do Bling são deduplicados por `(organizacao_id, origem, external_id)`. Os webhooks, por `event_id`.
- Recorrências usam `external_id = recorrência:data`.
- A fila de sincronização usa `FOR UPDATE SKIP LOCKED`, processa um job por integração por vez em ordem de criação e tem retentativa com espera progressiva (2, 4, 8… minutos).
- As execuções da IA são deduplicadas por `(organizacao_id, idempotency_key)`.

## Fechamento de período

Gatilhos bloqueiam inclusão, alteração e exclusão em títulos, baixas, transferências, vendas e devoluções com data em mês fechado. A reabertura (`fn_reabrir_periodo`) exige motivo e grava em `periodos_reaberturas` e na auditoria.
