# Checklist de validação para produção

## Infraestrutura
- [ ] Projeto Supabase na região `sa-east-1`, com plano que inclua backups diários (de preferência PITR).
- [ ] `npx supabase db push` aplicado sem erros; `select * from cron.job` mostra os 3 agendamentos.
- [ ] Segredos `APP_URL`, `TOKEN_ENCRYPTION_KEY`, `CRON_SECRET`, `BLING_*` e `OPENROUTER_API_KEY` definidos. A `TOKEN_ENCRYPTION_KEY` está guardada num cofre.
- [ ] Vault com `project_url` e `cron_secret`; `select net.http_get(...)` funciona a partir do banco.
- [ ] SMTP próprio configurado; e-mails de confirmação, recuperação de senha e convite chegam.
- [ ] Site URL e Redirect URLs do Auth apontando para o domínio final.
- [ ] Vercel com `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` (anon), sem nenhuma chave secreta no frontend.

## Segurança
- [ ] `npm run test:integration` passa num ambiente de staging (inclui isolamento entre organizações).
- [ ] Supabase **Advisors** (Security e Performance) sem alertas críticos.
- [ ] Confirmar no painel do Supabase: RLS habilitado em todas as tabelas do schema `public`.
- [ ] Testar manualmente com dois usuários de organizações diferentes: um não vê nem altera dados do outro.
- [ ] Webhook do Bling: uma requisição sem assinatura válida retorna 401.
- [ ] Rate limiting do Auth revisado (Authentication → Rate Limits).
- [ ] Leaked-password protection e confirmação de e-mail ativadas no Auth.

## Funcional (com uma organização real de teste)
- [ ] Assistente inicial completo (empresa, contas, canais e taxas).
- [ ] Venda manual gera recebíveis com a taxa correta e aparece em DRE, fluxo e dashboard.
- [ ] Baixa, baixa em lote, estorno e transferência refletem nos saldos.
- [ ] Importar o mesmo OFX duas vezes não duplica; conciliação por sugestão, regra e manual; desfazer funciona.
- [ ] DFC: o saldo final confere com o saldo das contas (indicador verde na tela).
- [ ] Fechar um mês e confirmar o bloqueio; reabrir com motivo e conferir a auditoria.
- [ ] Bling: conectar uma conta de teste, sincronizar e conferir pedidos, produtos com custo e contas; reimportar sem duplicar; testar um webhook real.
- [ ] IA: pergunta simples respondida com fontes; categorização gera sugestões pendentes; consumo registrado; limite do plano bloqueia ao exceder.

## Operação
- [ ] Monitorar **Edge Functions → Logs**: os logs são JSON estruturado com `nivel` e `msg`.
- [ ] Acompanhar `sync_jobs` com status `erro` e `integracoes` com status `reautorizar` no Painel da plataforma.
- [ ] Definir um responsável pela renovação e pela rotação do client secret do Bling.
- [ ] Gateway de cobrança: não integrado. A tabela `assinaturas` já tem os campos `gateway*` para a integração futura.
