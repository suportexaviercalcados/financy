# IA via OpenRouter

Tudo roda na Edge Function `ai-assistant`. A chave nunca chega ao navegador.

## Configurar

1. Crie uma chave em https://openrouter.ai/keys e defina um limite de gasto na própria OpenRouter.
2. Grave o segredo no Supabase:
   ```bash
   npx supabase secrets set OPENROUTER_API_KEY=sk-or-...
   ```
3. No **Painel da plataforma** (usuário em `platform_admins`), defina:
   - o modelo padrão (id da OpenRouter, ex.: `openai/gpt-4o-mini`);
   - a lista de modelos que as organizações podem escolher;
   - o prompt do sistema.
4. Cada organização ajusta em **Configurações → Configuração da IA**: modelo, instruções, aplicação automática, nível de confiança e alertas semanais.

Para tornar um usuário administrador da plataforma (SQL Editor do Supabase):

```sql
insert into platform_admins (user_id) select id from auth.users where email = 'voce@empresa.com';
```

## Garantias implementadas

- **Sem números inventados.** O modelo só recebe dados por ferramentas que chamam funções SQL fixas (`fn_dre`, `fn_vendas_por_canal`, `fn_saldos_contas`, `fn_projecao_diaria`, …). Elas executam com o JWT do usuário, então o RLS restringe à organização dele. A organização é fixada pelo servidor, não pelo modelo.
- **Sem ações destrutivas.** A IA só consulta e cria registros em `ia_sugestoes`. Pagamentos, baixas e exclusões não existem como ferramenta.
- **Aprovação humana.**
  - Categorizações ficam pendentes. Só são aplicadas automaticamente em títulos quando a organização ativa a opção e a confiança é ≥ o nível configurado.
  - Conciliações sempre exigem aprovação, porque geram baixa.
- **Limites.**
  - Tokens por mês conforme o plano (`planos.ia_tokens_mes`); acima do limite, a chamada é bloqueada e registrada.
  - `idempotency_key` evita execuções duplicadas.
- **Registro.** `ia_execucoes` guarda tipo, modelo, ferramentas chamadas, tokens, custo (quando a OpenRouter informa), duração e erro.
- **Alertas e resumo semanal.** O cron chama a função às segundas, 08:00 (horário de Brasília), para organizações com alertas ativos. Os alertas ficam marcados como origem "IA".

## Custos

Sem autorização explícita, nenhuma chamada paga é feita em volume. Os testes automatizados não chamam a OpenRouter.
