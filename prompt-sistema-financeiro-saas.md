# Sistema Financeiro SaaS — Gestão Financeira para Varejo

Você é um **engenheiro de software sênior Full Stack**, especialista em React, TypeScript, Supabase, arquitetura SaaS multi-tenant, contabilidade gerencial (DRE, DFC, fluxo de caixa), integrações com ERPs via API (Bling API v3), conciliação bancária (OFX) e inteligência artificial aplicada a finanças.

Sua missão é desenvolver um **sistema financeiro SaaS completo para empresas de varejo**, com foco em um dashboard gerencial confiável, controle de caixa e contas, análise de vendas por canal e demonstrativos (DRE e DFC) gerados automaticamente a partir de dados reais.

> **IMPORTANTE:** Não quero apenas um protótipo, demonstração, wireframe ou MVP com funcionalidades fictícias. Quero um sistema utilizável em produção, vendável para várias empresas, com banco de dados real, isolamento total entre clientes, autenticação, integrações, segurança, cálculos financeiros corretos e interface profissional.

---

## 1. Arquitetura e tecnologias

### Frontend

- React com TypeScript e Vite.
- Tailwind CSS.
- shadcn/ui.
- Lucide React.
- TanStack Query.
- React Router.
- Biblioteca de gráficos (Recharts ou equivalente).
- Layout responsivo.
- Deploy na Vercel.

### Backend

- Supabase PostgreSQL.
- Supabase Auth.
- Supabase Storage (anexos: boletos, notas, comprovantes, arquivos OFX).
- Row Level Security (RLS).
- Supabase Edge Functions em TypeScript.
- Rotinas agendadas (pg_cron ou equivalente) para sincronizações, recorrências e alertas.
- Webhooks para eventos externos, quando disponíveis na API oficial.

### Inteligência artificial

- OpenRouter como provedor principal.
- Possibilidade de selecionar e trocar modelos de IA no painel administrativo da plataforma.
- Configuração de prompts e comportamento da IA.
- Histórico das execuções e consumo da API por cliente (tenant).
- Processamento exclusivamente no backend, nunca expondo chaves no frontend.

### Escopo multi-tenant

O sistema é um **SaaS multi-tenant**: cada empresa cliente (organização) deve ter seus dados totalmente isolados por RLS. Uma organização pode ter uma ou mais empresas (CNPJs), com visão individual e consolidada.

### Regras técnicas obrigatórias para valores e datas

- Armazenar valores monetários em tipo `numeric` (nunca `float`).
- Exibir valores em reais (R$), datas em dd/mm/aaaa e fuso horário `America/Sao_Paulo`.
- Distinguir sempre **regime de competência** (DRE) e **regime de caixa** (fluxo de caixa e DFC).

---

## 2. Referências de design e experiência

Antes de implementar a interface, utilize como referência visual e funcional:

| Referência | Link | O que aproveitar |
|---|---|---|
| **Conta Azul** | https://contaazul.com | Gestão financeira de PMEs brasileiras: contas a pagar e receber, fluxo de caixa e conciliação. |
| **Stripe** | https://stripe.com | Dashboard: cartões de indicadores, gráficos, comparação entre períodos e navegação do resumo até o detalhe. |
| **Mercury** | https://mercury.com | Visual de produto financeiro moderno: clareza na leitura de números, tipografia e hierarquia. |
| **Attio** | https://attio.com | Navegação, menu lateral, tabelas e organização das telas. |

Crie uma interface **original, moderna, profissional, intuitiva e visualmente consistente**, inspirada nas melhores práticas dessas plataformas, sem copiar suas marcas ou elementos proprietários.

Inclua:

- Tema claro e escuro.
- Menu lateral recolhível.
- Seletor de empresa e período no topo.
- Filtros, indicadores e ações rápidas.
- Tabelas com ordenação e exportação.
- Modais, feedback visual e estados de carregamento e de "sem dados".

Toda a interface deverá estar em **português do Brasil**.

---

## 3. Dashboard gerencial

> **Este é o módulo mais importante do projeto.**

O dashboard é a tela inicial do sistema e deve permitir que o dono da empresa entenda a saúde financeira do negócio em poucos segundos. Todos os números devem vir dos dados reais do banco e ser rastreáveis até os lançamentos de origem.

### Indicadores

- Faturamento bruto e líquido.
- Faturamento por canal de venda.
- Quantidade de pedidos e ticket médio (geral e por canal).
- CMV (custo da mercadoria vendida).
- Margem bruta e margem de contribuição (geral e por canal).
- Despesas fixas e variáveis.
- EBITDA e lucro líquido.
- Ponto de equilíbrio: faturamento necessário para cobrir os custos do período.
- Percentual da meta de faturamento atingido.
- Saldo atual em caixa, por conta bancária e consolidado.
- Caixa projetado para 30, 60 e 90 dias.
- Contas a pagar e a receber dos próximos 7 e 30 dias.
- Contas vencidas.
- Prazo médio de recebimento e de pagamento.
- Despesas por categoria.
- Endividamento total e parcelas futuras.

### Funcionalidades

- Filtros por período, empresa (CNPJ) e canal.
- Comparação com o período anterior e com o mesmo período do ano anterior.
- Gráficos de evolução mensal (faturamento, lucro, margem, caixa).
- Ao clicar em um indicador, abrir a lista de lançamentos que formam aquele valor.
- Exibir a data e hora da última sincronização de cada fonte de dados.
- Alertas visíveis gerados pelo sistema e pela IA (caixa negativo projetado, margem em queda, despesa fora do padrão, vencimentos).
- Quando faltar informação para um cálculo (por exemplo, produto sem custo cadastrado), indicar claramente o dado faltante em vez de exibir um número incorreto.

---

## 4. Vendas e vendas por canal

Criar um módulo para registrar e analisar as vendas da empresa por canal.

### Funcionalidades

- Cadastro de canais de venda configuráveis (ex.: loja física, site, WhatsApp, Instagram, marketplace).
- Configuração por canal: taxas de maquininha ou gateway por forma de pagamento e parcelamento, prazo de recebimento, comissões e custos de frete.
- Importação automática das vendas do Bling, com mapeamento da loja ou origem do Bling para o canal do sistema.
- Lançamento manual de vendas, quando necessário.
- Registro de descontos, devoluções, trocas e cancelamentos.
- Cálculo automático do CMV de cada venda a partir do custo dos produtos.
- Geração automática dos recebíveis (contas a receber) a partir da forma de pagamento, com data prevista e taxa descontada.
- Relatório de vendas por canal: faturamento, pedidos, ticket médio, CMV, taxas, margem de contribuição e participação no total.
- Ranking de produtos mais vendidos e de maior margem.

---

## 5. Fluxo de caixa

Criar o controle de fluxo de caixa realizado e projetado.

### Funcionalidades

- Visões diária, semanal e mensal.
- Realizado versus previsto, com diferença destacada.
- Saldo por conta bancária e consolidado.
- Projeção futura com base em contas a pagar, contas a receber, recebíveis de cartão, recorrências e parcelas de empréstimos.
- Transferências entre contas da mesma empresa, sem contar como receita ou despesa.
- Lançamentos recorrentes (aluguel, salários, assinaturas).
- Simulação de cenários (ex.: atraso de recebimentos, nova despesa, antecipação de recebíveis) sem alterar os dados reais.
- Alerta de dias com saldo projetado negativo.

---

## 6. Contas a pagar e a receber

Criar módulos completos de contas a pagar e a receber.

### Funcionalidades

- Cadastro com fornecedor ou cliente, categoria do plano de contas, centro de custo, valor, vencimento, competência e observações.
- Parcelamento e recorrência.
- Anexos (boleto, nota fiscal, comprovante) no Supabase Storage.
- Status: em aberto, vencida, paga parcialmente, paga, cancelada.
- Baixa com escolha da conta bancária, data de pagamento e registro de juros, multa e desconto.
- Baixa em lote.
- Importação das contas a pagar e a receber do Bling.
- Controle dos recebíveis de cartão por adquirente, com data prevista, taxa e valor líquido.
- Filtros por período, status, fornecedor, categoria e conta.
- Alertas de vencimento.

---

## 7. DRE gerencial

Gerar automaticamente a DRE (Demonstração do Resultado do Exercício) em **regime de competência**.

### Estrutura mínima

| Linha | Descrição |
|---|---|
| | Receita bruta de vendas |
| (−) | Deduções: impostos sobre vendas conforme o regime tributário (ex.: DAS no Simples Nacional), devoluções e descontos |
| **(=)** | **Receita líquida** |
| (−) | CMV |
| **(=)** | **Lucro bruto** |
| (−) | Despesas variáveis de venda: taxas de cartão e gateway, comissões, fretes e marketplace |
| **(=)** | **Margem de contribuição** |
| (−) | Despesas fixas: pessoal, ocupação, administrativas e marketing |
| **(=)** | **EBITDA** |
| (−) | Depreciação, quando cadastrada |
| (+/−) | Resultado financeiro: juros pagos, tarifas bancárias e rendimentos |
| **(=)** | **Resultado antes dos impostos sobre o lucro** |
| (−) | IRPJ e CSLL, quando aplicáveis ao regime |
| **(=)** | **Lucro líquido** |

### Funcionalidades

- DRE mensal, trimestral e anual, com colunas por mês e análise vertical (% sobre a receita) e horizontal (variação entre períodos).
- DRE por canal de venda, com critério de rateio das despesas fixas configurável (proporcional ao faturamento ou percentual manual).
- DRE por empresa e consolidada.
- Comparação entre o realizado e o orçado.
- Detalhamento de cada linha até os lançamentos.
- Exportação em PDF e Excel.

---

## 8. DFC — Demonstração do Fluxo de Caixa

Gerar automaticamente a DFC em **regime de caixa**.

### Funcionalidades

- Método direto, separado em atividades **operacionais**, de **investimento** e de **financiamento**.
- Saldo inicial, variação do período e saldo final, sempre conciliados com o saldo das contas bancárias.
- Método indireto opcional, partindo do lucro líquido da DRE.
- Visão mensal, trimestral e anual.
- Exportação em PDF e Excel.

---

## 9. Integração com o Bling (API v3)

Implementar a integração com a **API oficial do Bling, versão 3**.

**Documentação:** https://developer.bling.com.br

### Funcionalidades

- Conexão de cada empresa cliente à sua própria conta do Bling via **OAuth 2.0**, com armazenamento seguro e renovação automática dos tokens.
- Importação de pedidos de venda, produtos (incluindo custo), contatos, formas de pagamento, contas a pagar e contas a receber.
- Sincronização inicial do histórico, com período configurável.
- Sincronização incremental agendada e, quando a API oficial oferecer, recebimento de eventos por webhook.
- Mapeamento configurável de lojas, formas de pagamento e categorias do Bling para canais, contas e plano de contas do sistema.
- Respeito aos limites de requisição da API, com fila, nova tentativa e espera progressiva.
- **Idempotência:** reimportar o mesmo pedido ou conta nunca deve gerar duplicidade.
- Tela de status da integração com última sincronização, registros importados e erros.

Utilize **exclusivamente a API oficial do Bling**. Consulte a documentação oficial e valide a estrutura exata das requisições e respostas antes de implementar.

Se forem necessárias credenciais, cadastro de aplicativo ou aprovações externas, implemente o código e os fluxos de configuração e documente exatamente o que falta para ativar a integração real. **Nunca apresente uma integração simulada como funcional.**

---

## 10. Importação de extrato OFX e conciliação bancária

Implementar a importação de extratos bancários no formato OFX e a conciliação com os lançamentos do sistema.

### Funcionalidades

- Upload de arquivos OFX por conta bancária.
- Leitura e validação do arquivo, com mensagens claras em caso de erro.
- Prevenção de duplicidade usando o identificador único de cada transação (`FITID`) e o período do extrato.
- Sugestão automática de correspondência entre transações do extrato e lançamentos (valor, data e descrição).
- Conciliação manual, em lote e por regras (ex.: "descrição contém TARIFA → categoria Tarifas bancárias").
- Criação de lançamento a partir de uma transação sem correspondência.
- Desfazer conciliação.
- Indicador de saldo conciliado versus saldo do extrato.

---

## 11. Inteligência artificial financeira

Implementar uma IA integrada à operação e à análise financeira.

### A IA deverá conseguir

- Sugerir a categoria do plano de contas e o centro de custo de novos lançamentos e transações do extrato.
- Sugerir correspondências na conciliação bancária.
- Explicar em linguagem simples o resultado do mês (DRE, margem, caixa) e o que mudou em relação ao período anterior.
- Responder perguntas em linguagem natural sobre os dados da empresa (ex.: *"quanto vendi no WhatsApp em outubro?"*, *"qual a maior despesa do trimestre?"*).
- Identificar despesas fora do padrão, queda de margem por canal e risco de caixa negativo.
- Gerar alertas e um resumo financeiro semanal.

### Regras da IA

- **A IA nunca deverá inventar valores, saldos, datas ou indicadores.** Todo número deve vir de consultas ao banco, executadas por funções pré-definidas e seguras no backend, restritas aos dados da organização do usuário.
- Quando não houver dados suficientes, a IA deve informar isso claramente.
- Sugestões de categorização e conciliação ficam pendentes de aprovação humana, exceto quando o usuário ativar a aplicação automática acima de um nível de confiança configurável.
- A IA nunca realiza pagamentos, baixas ou exclusões.
- Implementar limites de consumo por organização e por plano, tratamento de falhas, proteção contra execuções duplicadas e registro de todas as decisões e sugestões da IA.

---

## 12. Cadastros e estrutura financeira

Criar os cadastros que dão base aos cálculos.

### Funcionalidades

- Empresas (CNPJ, razão social, regime tributário: Simples Nacional, Lucro Presumido ou Lucro Real, e alíquotas aplicáveis).
- Plano de contas hierárquico, com modelo padrão para varejo criado automaticamente e totalmente editável, já classificado para a DRE e para a DFC.
- Centros de custo.
- Contas bancárias e caixas, com saldo inicial.
- Adquirentes, maquininhas e gateways, com taxas e prazos.
- Fornecedores e clientes.
- Formas de pagamento.

---

## 13. Metas, orçamento e endividamento

### Funcionalidades

- Metas de faturamento mensais por empresa e por canal.
- Orçamento anual por categoria do plano de contas, com comparação realizado versus orçado.
- Cadastro de empréstimos e financiamentos com valor, taxa, prazo e sistema de amortização (SAC ou Price).
- Geração automática das parcelas, separando juros e amortização (juros na DRE; amortização na DFC de financiamento).
- Saldo devedor atualizado e cronograma de pagamentos.

---

## 14. Multi-tenant, assinatura e onboarding

### Funcionalidades

- Cadastro de nova organização com assistente de configuração inicial: dados da empresa, regime tributário, plano de contas padrão, contas bancárias, canais e taxas, conexão com o Bling e primeira importação OFX.
- Convite de usuários por e-mail.
- Estrutura de planos com limites (empresas, usuários, consumo de IA), preparada para cobrança futura. **Não integrar gateway de pagamento inicialmente**, mas deixar a arquitetura pronta.
- Painel interno do dono da plataforma (super administrador): organizações, uso, status das integrações e consumo de IA, sem acesso aos dados financeiros detalhados dos clientes sem permissão registrada.

---

## 15. Usuários e permissões

Implementar autenticação com Supabase Auth.

### Perfis iniciais

| Perfil | Acesso |
|---|---|
| **Proprietário** | Acesso total à organização, incluindo assinatura, usuários e integrações. |
| **Administrador** | Acesso completo às operações e configurações, exceto assinatura. |
| **Financeiro** | Lançamentos, contas, conciliação, relatórios e importações. |
| **Visualizador** | Somente leitura de dashboards e relatórios (ex.: sócio ou contador). |

Implementar permissões no banco utilizando **RLS**, sempre filtrando pela organização do usuário. **Não depender apenas de verificações de acesso no frontend.**

---

## 16. Configurações administrativas

Criar telas para:

- Dados da organização e das empresas.
- Gerenciamento de usuários e perfis.
- Plano de contas e centros de custo.
- Contas bancárias, adquirentes e taxas.
- Canais de venda e regras de rateio.
- Integração com o Bling.
- Regras de conciliação.
- Configuração da IA (modelo via OpenRouter, instruções, nível de confiança, alertas).
- Metas e orçamento.
- Logs de integração.
- Histórico de ações (auditoria).

---

## 17. Segurança, confiabilidade e qualidade

Implementar:

- Autenticação segura.
- Políticas RLS com isolamento entre organizações testado.
- Validação das entradas no frontend e no backend.
- Criptografia e proteção das credenciais e tokens de integração.
- Verificação de autenticidade dos webhooks.
- Idempotência nas importações (Bling e OFX).
- Controle de concorrência em baixas e conciliações.
- Fechamento de período: bloquear edição de meses fechados, com reabertura registrada.
- Tratamento de erros.
- Logs estruturados.
- Auditoria de ações importantes (criação, edição, exclusão, baixa, conciliação, reabertura de período).
- Proteção contra duplicidade de lançamentos.
- Recuperação adequada de falhas temporárias.

As chamadas às APIs do Bling e da OpenRouter devem ocorrer **exclusivamente no backend**.

Para sincronizações e processamentos pesados, utilizar filas ou processamento assíncrono confiável compatível com a arquitetura definida.

---

## 18. Banco de dados

Criar **migrations SQL completas** para todas as entidades necessárias, incluindo:

- Organizações, assinaturas e planos.
- Empresas.
- Perfis de usuários e vínculos com organizações.
- Plano de contas e centros de custo.
- Contas bancárias.
- Canais de venda, adquirentes e taxas.
- Fornecedores e clientes.
- Produtos e custos.
- Vendas e itens de venda.
- Lançamentos financeiros (contas a pagar e a receber, parcelas e baixas).
- Recebíveis de cartão.
- Transferências.
- Extratos importados e transações bancárias.
- Conciliações e regras de conciliação.
- Empréstimos e parcelas.
- Metas e orçamentos.
- Períodos fechados.
- Integrações, tokens e execuções de sincronização.
- Eventos de webhooks.
- Configurações e execuções da IA.
- Alertas.
- Logs de auditoria.

Criar relacionamentos, índices, constraints e políticas de segurança adequados. Criar views ou funções SQL para os cálculos de DRE, DFC, fluxo de caixa e indicadores, garantindo que o **dashboard e os relatórios usem a mesma lógica**.

---

## 19. Publicação

- O frontend deverá ser publicado na **Vercel**.
- O backend e o banco deverão funcionar no **Supabase**.

### Forneça

- Estrutura completa do projeto.
- Código-fonte funcional.
- Migrations SQL.
- Edge Functions.
- Configuração das variáveis de ambiente.
- Instruções para configurar o Supabase.
- Instruções para registrar o aplicativo no Bling e conectar uma conta.
- Instruções para configurar a OpenRouter.
- Procedimento de deploy na Vercel.
- Testes automatizados dos fluxos críticos, incluindo:
  - cálculos da DRE e da DFC;
  - saldo do fluxo de caixa;
  - geração de recebíveis com taxas;
  - amortização de empréstimos;
  - idempotência da importação OFX e do Bling;
  - isolamento de dados entre organizações.
- Checklist de validação para produção.

---

## 20. Executar e testar

Após implementar:

1. Instale as dependências necessárias.
2. Configure o ambiente utilizando `.env.example`.
3. Verifique se já existem credenciais configuradas, sem exibir seus valores.
4. Execute o frontend e o backend.
5. Corrija eventuais erros de compilação e inicialização.
6. Abra a aplicação no navegador disponível no ambiente de execução.
7. Teste os fluxos: criar organização e empresa, configurar plano de contas e contas bancárias, lançar e baixar contas, importar um OFX de exemplo, conciliar, registrar vendas por canal, conferir DRE, DFC, fluxo de caixa e dashboard.
8. Se houver credenciais válidas, deixe as integrações reais prontas, mas não execute chamadas pagas de IA em volume sem autorização.
9. Caso não existam credenciais, ofereça um modo de demonstração claramente identificado, sem simular que dados falsos vieram do Bling ou da IA.
10. Informe a URL local para acessar a aplicação.

---

## 21. Requisitos obrigatórios de entrega

Não quero apenas planejamento ou exemplos de código. **Quero que você construa efetivamente o projeto.**

Siga estas diretrizes:

1. Desenvolva o sistema completo por módulos, mantendo uma arquitetura consistente.
2. Gere os arquivos e implemente funcionalidades reais.
3. Não deixe botões sem ação ou telas com dados fictícios apresentados como reais.
4. Não substitua funcionalidades solicitadas por placeholders.
5. Utilize dados de demonstração apenas quando explicitamente identificados como demonstração.
6. Implemente a persistência no Supabase desde o início.
7. Crie uma interface com qualidade visual de software comercial.
8. Garanta que as funcionalidades estejam integradas entre si: uma venda deve refletir em recebíveis, fluxo de caixa, DRE, DFC e dashboard.
9. Execute testes e corrija erros identificados.
10. Documente separadamente tudo que depender de credenciais, aprovações ou configurações externas.
11. Não declare que uma funcionalidade está pronta sem implementá-la e validá-la.
12. Continue desenvolvendo e verificando os módulos até entregar a aplicação completa, dentro das ferramentas e do ambiente disponíveis.

---

## 22. Critérios de conclusão

Considere o trabalho finalizado **somente quando**:

- [ ] A aplicação iniciar sem erros.
- [ ] For possível criar uma organização e configurá-la pelo assistente inicial.
- [ ] Contas a pagar e a receber, baixas e transferências estiverem funcionando.
- [ ] A importação OFX e a conciliação estiverem funcionando sem duplicidade.
- [ ] A integração com o Bling estiver implementada, com o que falta para ativação documentado.
- [ ] DRE, DFC e fluxo de caixa forem gerados a partir dos lançamentos reais e baterem entre si.
- [ ] O dashboard exibir os indicadores com drill-down até os lançamentos.
- [ ] A IA estiver implementada, usando apenas dados do banco.
- [ ] O isolamento entre organizações estiver validado por testes.
- [ ] Os testes automatizados dos fluxos críticos tiverem sido executados com sucesso.

---

## Objetivo final

Entregar um **sistema financeiro SaaS profissional**, que qualquer empresa de varejo consiga usar diariamente para controlar caixa, contas e vendas por canal, e tomar decisões com base em DRE, DFC e dashboard confiáveis.

> Comece pela definição da arquitetura e estrutura do projeto e, em seguida, avance imediatamente para a implementação real do código. Não fique apenas apresentando propostas ou fazendo perguntas desnecessárias. Assuma decisões técnicas razoáveis, documente-as e continue o desenvolvimento.
