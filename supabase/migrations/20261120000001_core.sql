-- Extensões ficam no schema "extensions" no Supabase hospedado
set search_path = public, extensions;

-- =====================================================================
-- FINANCY — 0001 Core: extensões, tenancy, helpers de permissão, cadastros
-- =====================================================================
-- Fuso horário oficial do sistema (current_date em horário de Brasília)
alter database postgres set timezone to 'America/Sao_Paulo';
set timezone to 'America/Sao_Paulo';

create extension if not exists pg_trgm;
create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Tipos
-- ---------------------------------------------------------------------
create type papel_membro as enum ('proprietario','administrador','financeiro','visualizador');
create type regime_tributario as enum ('simples','presumido','real');
create type dre_grupo as enum (
  'receita_bruta','deducoes_impostos','deducoes_devolucoes','cmv','despesa_variavel',
  'despesa_fixa','depreciacao','receita_financeira','despesa_financeira','impostos_lucro','nao_dre');
create type dfc_grupo as enum ('operacional','investimento','financiamento','nao_dfc');
create type tipo_titulo as enum ('pagar','receber');

-- ---------------------------------------------------------------------
-- Planos / organizações / membros
-- ---------------------------------------------------------------------
create table planos (
  id text primary key,
  nome text not null,
  max_empresas int not null,
  max_usuarios int not null,
  ia_tokens_mes bigint not null,         -- limite de tokens de IA por mês
  preco_mensal numeric(14,2) not null default 0,
  ativo boolean not null default true
);
insert into planos (id, nome, max_empresas, max_usuarios, ia_tokens_mes, preco_mensal) values
  ('essencial','Essencial',1,3,  500000, 0),
  ('profissional','Profissional',3,10, 3000000, 0),
  ('empresarial','Empresarial',20,50,20000000, 0);

create table organizacoes (
  id uuid primary key default gen_random_uuid(),
  nome text not null check (length(trim(nome)) between 2 and 120),
  plano_id text not null default 'essencial' references planos(id),
  status text not null default 'ativa' check (status in ('ativa','suspensa','cancelada')),
  onboarding_concluido boolean not null default false,
  rateio_modo text not null default 'faturamento' check (rateio_modo in ('faturamento','manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Assinatura: preparada para gateway futuro (sem integração por ora)
create table assinaturas (
  organizacao_id uuid primary key references organizacoes(id) on delete cascade,
  plano_id text not null references planos(id),
  status text not null default 'trial' check (status in ('trial','ativa','inadimplente','cancelada')),
  inicio date not null default current_date,
  fim date,
  gateway text,
  gateway_customer_id text,
  gateway_subscription_id text,
  updated_at timestamptz not null default now()
);

create table membros (
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  papel papel_membro not null,
  created_at timestamptz not null default now(),
  primary key (organizacao_id, user_id)
);
create index on membros(user_id);

create table profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  nome text,
  email text,
  organizacao_ativa_id uuid references organizacoes(id) on delete set null,
  created_at timestamptz not null default now()
);

create table convites (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  papel papel_membro not null check (papel <> 'proprietario'),
  token text not null unique default encode(gen_random_bytes(24),'hex'),
  convidado_por uuid references auth.users(id),
  expira_em timestamptz not null default now() + interval '7 days',
  aceito_em timestamptz,
  created_at timestamptz not null default now()
);
create unique index convites_pendente_uq on convites(organizacao_id, lower(email)) where aceito_em is null;

-- Super administradores da plataforma
create table platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- Permissão registrada de acesso de suporte (super admin só vê dados com concessão ativa)
create table acessos_suporte (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  admin_user_id uuid not null references auth.users(id) on delete cascade,
  concedido_por uuid not null references auth.users(id),
  motivo text not null,
  expira_em timestamptz not null,
  revogado_em timestamptz,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Helpers de permissão (SECURITY DEFINER para evitar recursão de RLS)
-- ---------------------------------------------------------------------
create or replace function fn_papel(org uuid) returns papel_membro
language sql stable security definer set search_path = public as $$
  select papel from membros where organizacao_id = org and user_id = auth.uid()
$$;

create or replace function fn_is_platform_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from platform_admins where user_id = auth.uid())
$$;

create or replace function fn_can_read(org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where organizacao_id = org and user_id = auth.uid())
      or exists(select 1 from acessos_suporte s
                 where s.organizacao_id = org and s.admin_user_id = auth.uid()
                   and s.revogado_em is null and s.expira_em > now())
$$;

create or replace function fn_can_write(org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where organizacao_id = org and user_id = auth.uid()
                 and papel in ('proprietario','administrador','financeiro'))
$$;

create or replace function fn_can_admin(org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where organizacao_id = org and user_id = auth.uid()
                 and papel in ('proprietario','administrador'))
$$;

create or replace function fn_is_owner(org uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from membros where organizacao_id = org and user_id = auth.uid()
                 and papel = 'proprietario')
$$;

-- updated_at genérico
create or replace function fn_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger t_touch before update on organizacoes for each row execute function fn_touch();

-- ---------------------------------------------------------------------
-- Cadastros
-- ---------------------------------------------------------------------
create table empresas (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  razao_social text not null check (length(trim(razao_social)) >= 2),
  nome_fantasia text,
  cnpj text check (cnpj is null or cnpj ~ '^\d{14}$'),
  regime_tributario regime_tributario not null default 'simples',
  -- alíquota efetiva estimada sobre a receita (ex.: DAS no Simples), em %
  aliquota_imposto_vendas numeric(7,4) not null default 0 check (aliquota_imposto_vendas between 0 and 100),
  -- 'estimado': DRE calcula imposto = alíquota × receita; 'lancado': usa títulos da categoria de impostos
  imposto_vendas_modo text not null default 'estimado' check (imposto_vendas_modo in ('estimado','lancado')),
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, organizacao_id),
  unique (organizacao_id, cnpj)
);
create trigger t_touch before update on empresas for each row execute function fn_touch();

create table plano_contas (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  parent_id uuid,
  codigo text not null,
  nome text not null,
  natureza text not null check (natureza in ('entrada','saida')),
  dre_grupo dre_grupo not null default 'nao_dre',
  dfc_grupo dfc_grupo not null default 'operacional',
  -- chave das categorias de sistema (usadas pelos cálculos automáticos de vendas, juros, empréstimos)
  chave_sistema text,
  aceita_lancamento boolean not null default true,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, organizacao_id),
  unique (organizacao_id, codigo),
  unique (organizacao_id, chave_sistema),
  foreign key (parent_id, organizacao_id) references plano_contas(id, organizacao_id)
);
create index on plano_contas(organizacao_id, parent_id);

create table centros_custo (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  codigo text,
  nome text not null,
  ativo boolean not null default true,
  unique (id, organizacao_id),
  unique (organizacao_id, nome)
);

create table contas_bancarias (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  empresa_id uuid not null,
  nome text not null,
  tipo text not null default 'corrente' check (tipo in ('corrente','poupanca','caixa','investimento','carteira_digital')),
  banco text, agencia text, numero text,
  saldo_inicial numeric(14,2) not null default 0,
  data_saldo_inicial date not null default current_date,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, organizacao_id),
  foreign key (empresa_id, organizacao_id) references empresas(id, organizacao_id) on delete cascade
);

create table contatos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  tipo text not null default 'ambos' check (tipo in ('cliente','fornecedor','ambos')),
  nome text not null,
  documento text,
  email text, telefone text,
  origem text not null default 'manual',
  external_id text,
  created_at timestamptz not null default now(),
  unique (id, organizacao_id),
  unique (organizacao_id, origem, external_id)
);
create index contatos_nome_trgm on contatos using gin (nome gin_trgm_ops);

create table adquirentes (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  nome text not null,
  tipo text not null default 'maquininha' check (tipo in ('maquininha','gateway','marketplace','outro')),
  ativo boolean not null default true,
  unique (id, organizacao_id)
);

create table formas_pagamento (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  nome text not null,
  tipo text not null check (tipo in ('dinheiro','pix','debito','credito','boleto','transferencia','marketplace','crediario','outro')),
  ativo boolean not null default true,
  unique (id, organizacao_id),
  unique (organizacao_id, nome)
);

create table canais_venda (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  nome text not null,
  tipo text not null default 'loja_fisica' check (tipo in ('loja_fisica','site','whatsapp','instagram','marketplace','outro')),
  comissao_percentual numeric(7,4) not null default 0 check (comissao_percentual between 0 and 100),
  taxa_marketplace_percentual numeric(7,4) not null default 0 check (taxa_marketplace_percentual between 0 and 100),
  custo_frete_percentual numeric(7,4) not null default 0 check (custo_frete_percentual between 0 and 100),
  rateio_percentual numeric(7,4) check (rateio_percentual between 0 and 100),  -- usado quando rateio_modo='manual'
  ativo boolean not null default true,
  unique (id, organizacao_id),
  unique (organizacao_id, nome)
);

-- Taxas por canal x forma de pagamento x faixa de parcelas
create table canal_taxas (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  canal_id uuid,                -- null = vale para todos os canais
  forma_pagamento_id uuid not null,
  adquirente_id uuid,
  conta_bancaria_id uuid,       -- conta onde cai o recebível
  foreign key (canal_id, organizacao_id) references canais_venda(id, organizacao_id) on delete cascade,
  foreign key (forma_pagamento_id, organizacao_id) references formas_pagamento(id, organizacao_id) on delete cascade,
  foreign key (adquirente_id, organizacao_id) references adquirentes(id, organizacao_id),
  foreign key (conta_bancaria_id, organizacao_id) references contas_bancarias(id, organizacao_id),
  parcelas_min int not null default 1 check (parcelas_min >= 1),
  parcelas_max int not null default 1,
  taxa_percentual numeric(7,4) not null default 0 check (taxa_percentual between 0 and 100),
  taxa_fixa numeric(14,2) not null default 0 check (taxa_fixa >= 0),
  prazo_dias int not null default 0 check (prazo_dias >= 0),            -- prazo da 1ª parcela
  intervalo_parcelas_dias int not null default 30 check (intervalo_parcelas_dias > 0),
  check (parcelas_max >= parcelas_min)
);
create index on canal_taxas(organizacao_id, forma_pagamento_id, canal_id);

create table produtos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  sku text,
  nome text not null,
  preco numeric(14,2) not null default 0 check (preco >= 0),
  custo numeric(14,4) check (custo >= 0),       -- null = custo não cadastrado (CMV incompleto)
  ativo boolean not null default true,
  origem text not null default 'manual',
  external_id text,
  updated_at timestamptz not null default now(),
  unique (id, organizacao_id),
  unique (organizacao_id, origem, external_id)
);
create index produtos_nome_trgm on produtos using gin (nome gin_trgm_ops);
create trigger t_touch before update on produtos for each row execute function fn_touch();
