-- =====================================================================
-- FINANCY — 0005 Integrações (Bling), webhooks, IA, alertas, auditoria
-- =====================================================================

create table integracoes (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  empresa_id uuid not null,
  provedor text not null default 'bling' check (provedor in ('bling')),
  status text not null default 'desconectado' check (status in ('desconectado','conectado','erro','reautorizar')),
  external_company_id text,               -- companyId do Bling (roteamento de webhooks)
  sync_inicio date,                       -- início do histórico na sincronização inicial
  ultima_sincronizacao timestamptz,
  ultimo_erro text,
  config jsonb not null default '{}'::jsonb,   -- ex.: {"situacoes_venda":[1,9], "importar_contas": true}
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organizacao_id),
  unique (empresa_id, provedor),
  foreign key (empresa_id, organizacao_id) references empresas(id, organizacao_id) on delete cascade
);
create unique index integracoes_company_uq on integracoes(provedor, external_company_id) where external_company_id is not null;
create trigger t_touch before update on integracoes for each row execute function fn_touch();

-- Tokens criptografados (AES-GCM na Edge Function). Sem políticas: só service_role acessa.
create table integracao_tokens (
  integracao_id uuid primary key references integracoes(id) on delete cascade,
  access_token_enc text not null,
  refresh_token_enc text not null,
  expires_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create table oauth_states (
  state text primary key,
  integracao_id uuid not null references integracoes(id) on delete cascade,
  user_id uuid not null,
  redirect_to text,
  expires_at timestamptz not null default now() + interval '10 minutes'
);

create table integracao_mapeamentos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  integracao_id uuid not null,
  tipo text not null check (tipo in ('loja','forma_pagamento','categoria')),
  external_id text not null,
  external_nome text,
  interno_id uuid,      -- canal / forma de pagamento / categoria do plano de contas
  updated_at timestamptz not null default now(),
  foreign key (integracao_id, organizacao_id) references integracoes(id, organizacao_id) on delete cascade,
  unique (integracao_id, tipo, external_id)
);

create table sync_jobs (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  integracao_id uuid not null,
  tipo text not null check (tipo in ('inicial','incremental','webhook','manual')),
  recurso text not null check (recurso in ('cadastros','produtos','contatos','vendas','contas_pagar','contas_receber','venda_unica')),
  status text not null default 'pendente' check (status in ('pendente','executando','concluido','erro','cancelado')),
  parametros jsonb not null default '{}'::jsonb,
  cursor jsonb not null default '{}'::jsonb,      -- {pagina: n} para retomada
  tentativas int not null default 0,
  max_tentativas int not null default 6,
  proxima_execucao timestamptz not null default now(),
  registros_importados int not null default 0,
  erro text,
  locked_at timestamptz,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  foreign key (integracao_id, organizacao_id) references integracoes(id, organizacao_id) on delete cascade
);
create index on sync_jobs(status, proxima_execucao);
create index on sync_jobs(integracao_id, created_at desc);

create table sync_logs (
  id bigint generated always as identity primary key,
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  integracao_id uuid,
  job_id uuid references sync_jobs(id) on delete cascade,
  nivel text not null default 'info' check (nivel in ('info','aviso','erro')),
  mensagem text not null,
  detalhes jsonb,
  created_at timestamptz not null default now()
);
create index on sync_logs(organizacao_id, created_at desc);

create table webhook_eventos (
  id uuid primary key default gen_random_uuid(),
  provedor text not null default 'bling',
  event_id text not null,
  company_id text,
  evento text not null,
  payload jsonb not null,
  organizacao_id uuid references organizacoes(id) on delete cascade,
  integracao_id uuid references integracoes(id) on delete cascade,
  status text not null default 'recebido' check (status in ('recebido','enfileirado','ignorado','erro')),
  erro text,
  recebido_em timestamptz not null default now(),
  unique (provedor, event_id)          -- Bling pode reenviar: idempotência
);

-- Job claim com SKIP LOCKED: um job por integração por vez, em ordem de criação
-- (cadastros -> produtos -> contatos -> vendas -> contas), retomando jobs travados há > 15 min
create or replace function fn_claim_sync_jobs(p_limite int default 5) returns setof sync_jobs
language sql as $$
  update sync_jobs set status = 'executando', locked_at = now(), started_at = coalesce(started_at, now()),
                       tentativas = tentativas + 1
   where id in (
     select j.id from sync_jobs j
      where ((j.status = 'pendente' and j.proxima_execucao <= now())
             or (j.status = 'executando' and j.locked_at < now() - interval '15 minutes'))
        and not exists (select 1 from sync_jobs x where x.integracao_id = j.integracao_id and x.id <> j.id
                          and x.status = 'executando' and x.locked_at >= now() - interval '15 minutes')
        and not exists (select 1 from sync_jobs y where y.integracao_id = j.integracao_id and y.id <> j.id
                          and y.status = 'pendente' and y.created_at < j.created_at)
      order by j.created_at limit p_limite
      for update skip locked)
  returning *
$$;
revoke all on function fn_claim_sync_jobs(int) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- IA
-- ---------------------------------------------------------------------
create table ia_config_plataforma (
  id boolean primary key default true check (id),
  modelo_padrao text not null default 'openai/gpt-4o-mini',
  modelos_disponiveis jsonb not null default '["openai/gpt-4o-mini","anthropic/claude-sonnet-4.5","google/gemini-2.5-flash"]'::jsonb,
  prompt_sistema text not null default
'Você é o assistente financeiro do Financy, para empresas de varejo brasileiras. Responda em português do Brasil, de forma clara e objetiva.
REGRAS INVIOLÁVEIS:
1. Nunca invente valores, saldos, datas ou indicadores. Todo número deve vir das ferramentas (funções) disponíveis.
2. Se as ferramentas não retornarem dados suficientes, diga claramente que não há dados suficientes.
3. Você não realiza pagamentos, baixas, exclusões nem altera dados.
4. Formate valores como R$ 1.234,56 e datas como dd/mm/aaaa.
5. Diferencie regime de competência (DRE) de regime de caixa (fluxo de caixa/DFC) quando relevante.',
  updated_at timestamptz not null default now()
);
insert into ia_config_plataforma default values;

create table ia_config (
  organizacao_id uuid primary key references organizacoes(id) on delete cascade,
  modelo text,                                   -- null = padrão da plataforma
  instrucoes text,
  auto_aplicar boolean not null default false,
  nivel_confianca numeric(4,3) not null default 0.900 check (nivel_confianca between 0.5 and 1),
  alertas_ativos boolean not null default true,
  updated_at timestamptz not null default now()
);

create table ia_execucoes (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  user_id uuid,
  tipo text not null check (tipo in ('chat','categorizacao','conciliacao','resumo','alertas')),
  modelo text,
  status text not null default 'executando' check (status in ('executando','sucesso','erro','bloqueado')),
  idempotency_key text,
  entrada jsonb,
  saida jsonb,
  ferramentas jsonb,          -- funções chamadas e parâmetros (rastreabilidade dos números)
  prompt_tokens int not null default 0,
  completion_tokens int not null default 0,
  custo_usd numeric(12,6) not null default 0,
  duracao_ms int,
  erro text,
  created_at timestamptz not null default now(),
  unique (organizacao_id, idempotency_key)
);
create index on ia_execucoes(organizacao_id, created_at desc);

create table ia_sugestoes (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  execucao_id uuid references ia_execucoes(id) on delete set null,
  tipo text not null check (tipo in ('categoria','conciliacao')),
  alvo_tabela text not null check (alvo_tabela in ('titulos','transacoes_bancarias')),
  alvo_id uuid not null,
  sugestao jsonb not null,             -- {categoria_id, centro_custo_id, justificativa} | {alvo_tipo, alvo_id}
  confianca numeric(4,3) not null,
  status text not null default 'pendente' check (status in ('pendente','aprovada','rejeitada','aplicada_auto')),
  decidido_por uuid,
  decidido_em timestamptz,
  created_at timestamptz not null default now()
);
create unique index ia_sugestoes_pendente_uq on ia_sugestoes(alvo_tabela, alvo_id, tipo) where status = 'pendente';

-- Uso de tokens no mês corrente x limite do plano
create or replace function fn_ia_uso_mes(p_org uuid) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'tokens', coalesce((select sum(prompt_tokens + completion_tokens) from ia_execucoes
                         where organizacao_id = p_org and created_at >= date_trunc('month', now())),0),
    'limite', (select p.ia_tokens_mes from organizacoes o join planos p on p.id = o.plano_id where o.id = p_org),
    'execucoes', (select count(*) from ia_execucoes where organizacao_id = p_org and created_at >= date_trunc('month', now())))
  where fn_can_read(p_org) or auth.role() = 'service_role'
$$;

-- ---------------------------------------------------------------------
-- Alertas
-- ---------------------------------------------------------------------
create table alertas (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  empresa_id uuid references empresas(id) on delete cascade,
  tipo text not null,
  severidade text not null default 'aviso' check (severidade in ('info','aviso','critico')),
  titulo text not null,
  mensagem text not null,
  origem text not null default 'sistema' check (origem in ('sistema','ia')),
  referencia jsonb,
  chave text not null,              -- deduplicação
  lido boolean not null default false,
  created_at timestamptz not null default now(),
  unique (organizacao_id, chave)
);
create index on alertas(organizacao_id, lido, created_at desc);

-- ---------------------------------------------------------------------
-- Auditoria
-- ---------------------------------------------------------------------
create table audit_log (
  id bigint generated always as identity primary key,
  organizacao_id uuid,
  user_id uuid default auth.uid(),
  tabela text not null,
  registro_id text,
  acao text not null,
  antes jsonb,
  depois jsonb,
  created_at timestamptz not null default now()
);
create index on audit_log(organizacao_id, created_at desc);

create or replace function fn_audit() returns trigger language plpgsql security definer set search_path = public as $$
declare r jsonb := to_jsonb(coalesce(new, old));
begin
  insert into audit_log (organizacao_id, tabela, registro_id, acao, antes, depois)
  values ((r->>'organizacao_id')::uuid, tg_table_name, coalesce(r->>'id', r->>'organizacao_id'),
          lower(tg_op),
          case when tg_op <> 'INSERT' then to_jsonb(old) end,
          case when tg_op <> 'DELETE' then to_jsonb(new) end);
  return coalesce(new, old);
end $$;

do $$ declare t text;
begin
  foreach t in array array['titulos','baixas','transferencias','vendas','devolucoes','conciliacoes','periodos_fechados',
    'periodos_reaberturas','emprestimos','membros','convites','empresas','contas_bancarias','plano_contas',
    'regras_conciliacao','integracoes','ia_config','acessos_suporte','metas','orcamentos','recorrencias'] loop
    execute format('create trigger t_audit after insert or update or delete on %I for each row execute function fn_audit()', t);
  end loop;
end $$;

-- Reabertura de período registrada
create or replace function fn_reabrir_periodo(p_empresa uuid, p_competencia date, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare v_org uuid;
begin
  select organizacao_id into v_org from empresas where id = p_empresa;
  if not fn_can_admin(v_org) then raise exception 'Somente proprietário/administrador pode reabrir períodos.'; end if;
  delete from periodos_fechados where empresa_id = p_empresa and competencia = date_trunc('month', p_competencia)::date;
  if not found then raise exception 'Período não está fechado.'; end if;
  insert into periodos_reaberturas (organizacao_id, empresa_id, competencia, motivo, reaberto_por)
  values (v_org, p_empresa, date_trunc('month', p_competencia)::date, p_motivo, auth.uid());
end $$;

-- Agenda sincronização (chamado pelo app ou pelo callback OAuth). Idempotente: não duplica jobs pendentes.
create or replace function fn_agendar_sync(p_integracao uuid, p_tipo text default 'manual',
  p_recursos text[] default array['cadastros','produtos','contatos','vendas','contas_pagar','contas_receber'],
  p_parametros jsonb default '{}'::jsonb)
returns int language plpgsql security definer set search_path = public as $$
declare i integracoes%rowtype; r text; n int := 0; k int := 0;
begin
  select * into i from integracoes where id = p_integracao;
  if i.id is null then raise exception 'Integração não encontrada.'; end if;
  if not (fn_can_admin(i.organizacao_id) or coalesce(auth.role(),'') = 'service_role') then raise exception 'Sem permissão.'; end if;
  if i.status not in ('conectado','erro') then raise exception 'Conecte a conta Bling antes de sincronizar.'; end if;
  foreach r in array p_recursos loop
    k := k + 1;
    if not exists (select 1 from sync_jobs where integracao_id = i.id and recurso = r and status in ('pendente','executando')) then
      insert into sync_jobs (organizacao_id, integracao_id, tipo, recurso, parametros, created_at)
      values (i.organizacao_id, i.id, p_tipo, r, p_parametros, clock_timestamp() + make_interval(secs => k * 0.001));
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;
