-- Extensões ficam no schema "extensions" no Supabase hospedado
set search_path = public, extensions;

-- =====================================================================
-- FINANCY — 0002 Financeiro: períodos, títulos, baixas, movimentos,
-- transferências, recorrências, vendas, recebíveis, empréstimos, metas
-- =====================================================================

-- ---------------------------------------------------------------------
-- Fechamento de período
-- ---------------------------------------------------------------------
create table periodos_fechados (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  empresa_id uuid not null,
  competencia date not null check (extract(day from competencia) = 1),  -- 1º dia do mês
  fechado_por uuid references auth.users(id),
  fechado_em timestamptz not null default now(),
  foreign key (empresa_id, organizacao_id) references empresas(id, organizacao_id) on delete cascade,
  unique (empresa_id, competencia)
);

create table periodos_reaberturas (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  empresa_id uuid not null,
  competencia date not null,
  motivo text not null check (length(trim(motivo)) >= 5),
  reaberto_por uuid references auth.users(id),
  reaberto_em timestamptz not null default now()
);

create or replace function fn_assert_periodo_aberto(p_empresa uuid, p_data date) returns void
language plpgsql stable as $$
begin
  if p_data is not null and exists (
      select 1 from periodos_fechados
       where empresa_id = p_empresa and competencia = date_trunc('month', p_data)::date) then
    raise exception 'Período % está fechado para esta empresa. Reabra o período para editar.',
      to_char(p_data, 'MM/YYYY') using errcode = 'P0001';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Vendas (antes de títulos, pois títulos referenciam vendas)
-- ---------------------------------------------------------------------
create table vendas (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  empresa_id uuid not null,
  canal_id uuid not null,
  contato_id uuid,
  numero text,
  data_venda date not null,
  status text not null default 'concluida' check (status in ('concluida','cancelada')),
  valor_produtos numeric(14,2) not null default 0 check (valor_produtos >= 0),   -- Σ qtd × preço (bruto)
  desconto numeric(14,2) not null default 0 check (desconto >= 0),               -- descontos (itens + pedido)
  frete_cobrado numeric(14,2) not null default 0 check (frete_cobrado >= 0),
  valor_total numeric(14,2) generated always as (valor_produtos - desconto + frete_cobrado) stored,
  valor_taxas_pagamento numeric(14,2) not null default 0,
  valor_comissao numeric(14,2) not null default 0,
  valor_taxa_marketplace numeric(14,2) not null default 0,
  custo_frete numeric(14,2) not null default 0,
  cmv numeric(14,2) not null default 0,
  cmv_incompleto boolean not null default false,       -- algum item sem custo cadastrado
  origem text not null default 'manual' check (origem in ('manual','bling','demo')),
  external_id text,
  observacoes text,
  cancelada_em timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (id, organizacao_id),
  unique (organizacao_id, origem, external_id),
  foreign key (empresa_id, organizacao_id) references empresas(id, organizacao_id),
  foreign key (canal_id, organizacao_id) references canais_venda(id, organizacao_id),
  foreign key (contato_id, organizacao_id) references contatos(id, organizacao_id),
  check (desconto <= valor_produtos + frete_cobrado)
);
create index on vendas(organizacao_id, data_venda);
create index on vendas(organizacao_id, canal_id, data_venda);

create table venda_itens (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  venda_id uuid not null references vendas(id) on delete cascade,
  produto_id uuid,
  descricao text not null,
  quantidade numeric(14,4) not null check (quantidade > 0),
  preco_unitario numeric(14,4) not null check (preco_unitario >= 0),
  desconto numeric(14,2) not null default 0 check (desconto >= 0),
  custo_unitario numeric(14,4),   -- snapshot do custo no momento da venda; null = sem custo
  foreign key (produto_id, organizacao_id) references produtos(id, organizacao_id)
);
create index on venda_itens(venda_id);
create index on venda_itens(organizacao_id, produto_id);

create table venda_pagamentos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  venda_id uuid not null references vendas(id) on delete cascade,
  forma_pagamento_id uuid not null,
  valor numeric(14,2) not null check (valor > 0),
  parcelas int not null default 1 check (parcelas between 1 and 48),
  taxa_percentual numeric(7,4) not null default 0,
  taxa_fixa numeric(14,2) not null default 0,
  valor_taxa numeric(14,2) not null default 0,
  prazo_dias int not null default 0,
  intervalo_parcelas_dias int not null default 30,
  adquirente_id uuid,
  conta_bancaria_id uuid,
  foreign key (forma_pagamento_id, organizacao_id) references formas_pagamento(id, organizacao_id),
  foreign key (adquirente_id, organizacao_id) references adquirentes(id, organizacao_id),
  foreign key (conta_bancaria_id, organizacao_id) references contas_bancarias(id, organizacao_id)
);
create index on venda_pagamentos(venda_id);

create table devolucoes (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  venda_id uuid not null,
  data date not null,
  tipo text not null default 'devolucao' check (tipo in ('devolucao','troca')),
  valor numeric(14,2) not null check (valor > 0),          -- receita devolvida
  custo_devolvido numeric(14,2) not null default 0 check (custo_devolvido >= 0),  -- estorno de CMV (mercadoria volta ao estoque)
  gera_reembolso boolean not null default true,
  motivo text,
  created_at timestamptz not null default now(),
  foreign key (venda_id, organizacao_id) references vendas(id, organizacao_id) on delete cascade
);

-- ---------------------------------------------------------------------
-- Recorrências e empréstimos (referenciados por títulos)
-- ---------------------------------------------------------------------
create table recorrencias (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  empresa_id uuid not null,
  tipo tipo_titulo not null,
  descricao text not null,
  contato_id uuid,
  categoria_id uuid not null,
  centro_custo_id uuid,
  valor numeric(14,2) not null check (valor > 0),
  frequencia text not null default 'mensal' check (frequencia in ('semanal','mensal','anual')),
  dia_vencimento int check (dia_vencimento between 1 and 31),
  data_inicio date not null,
  data_fim date,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, organizacao_id),
  foreign key (empresa_id, organizacao_id) references empresas(id, organizacao_id),
  foreign key (contato_id, organizacao_id) references contatos(id, organizacao_id),
  foreign key (categoria_id, organizacao_id) references plano_contas(id, organizacao_id),
  foreign key (centro_custo_id, organizacao_id) references centros_custo(id, organizacao_id)
);

create table emprestimos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  empresa_id uuid not null,
  descricao text not null,
  credor_contato_id uuid,
  conta_bancaria_id uuid not null,
  valor_principal numeric(14,2) not null check (valor_principal > 0),
  taxa_juros_mensal numeric(9,6) not null check (taxa_juros_mensal >= 0),   -- em %
  prazo_meses int not null check (prazo_meses between 1 and 600),
  sistema text not null check (sistema in ('SAC','PRICE')),
  data_contratacao date not null,
  data_primeira_parcela date not null,
  registrar_entrada boolean not null default true,  -- lança a entrada do principal na conta
  created_at timestamptz not null default now(),
  unique (id, organizacao_id),
  foreign key (empresa_id, organizacao_id) references empresas(id, organizacao_id),
  foreign key (credor_contato_id, organizacao_id) references contatos(id, organizacao_id),
  foreign key (conta_bancaria_id, organizacao_id) references contas_bancarias(id, organizacao_id)
);

-- ---------------------------------------------------------------------
-- Títulos (contas a pagar e a receber) — base de DRE/caixa/projeção
-- ---------------------------------------------------------------------
create table titulos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  empresa_id uuid not null,
  tipo tipo_titulo not null,
  descricao text not null check (length(trim(descricao)) >= 2),
  contato_id uuid,
  categoria_id uuid not null,
  centro_custo_id uuid,
  canal_id uuid,                              -- opcional: despesa/receita direta de um canal
  valor numeric(14,2) not null check (valor > 0),   -- valor a liquidar (líquido p/ recebíveis de cartão)
  valor_pago numeric(14,2) not null default 0,      -- Σ principal das baixas (mantido por trigger)
  data_emissao date not null default current_date,
  data_vencimento date not null,
  data_competencia date not null,
  status text not null default 'aberto' check (status in ('aberto','parcial','pago','cancelado')),
  documento text,
  observacoes text,
  parcela_num int, parcela_total int,
  grupo_parcelamento uuid,
  origem text not null default 'manual'
    check (origem in ('manual','bling','venda','emprestimo','recorrencia','ofx','devolucao','demo')),
  external_id text,
  venda_id uuid,
  recorrencia_id uuid,
  emprestimo_id uuid,
  -- recebíveis de cartão/gateway
  adquirente_id uuid,
  valor_bruto numeric(14,2),
  valor_taxa numeric(14,2),
  conta_bancaria_prevista_id uuid,
  version int not null default 1,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelado_em timestamptz,
  unique (id, organizacao_id),
  unique (organizacao_id, origem, external_id),
  foreign key (empresa_id, organizacao_id) references empresas(id, organizacao_id),
  foreign key (contato_id, organizacao_id) references contatos(id, organizacao_id),
  foreign key (categoria_id, organizacao_id) references plano_contas(id, organizacao_id),
  foreign key (centro_custo_id, organizacao_id) references centros_custo(id, organizacao_id),
  foreign key (canal_id, organizacao_id) references canais_venda(id, organizacao_id),
  foreign key (venda_id, organizacao_id) references vendas(id, organizacao_id) on delete cascade,
  foreign key (recorrencia_id, organizacao_id) references recorrencias(id, organizacao_id) on delete set null (recorrencia_id),
  foreign key (emprestimo_id, organizacao_id) references emprestimos(id, organizacao_id) on delete cascade,
  foreign key (adquirente_id, organizacao_id) references adquirentes(id, organizacao_id),
  foreign key (conta_bancaria_prevista_id, organizacao_id) references contas_bancarias(id, organizacao_id),
  check (valor_pago >= 0 and valor_pago <= valor)
);
create index on titulos(organizacao_id, tipo, status, data_vencimento);
create index on titulos(organizacao_id, data_competencia);
create index on titulos(venda_id);
create index on titulos(emprestimo_id);
create index titulos_desc_trgm on titulos using gin (descricao gin_trgm_ops);
create trigger t_touch before update on titulos for each row execute function fn_touch();

create table titulo_anexos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  titulo_id uuid not null,
  storage_path text not null unique,
  nome text not null,
  mime text, tamanho bigint,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (titulo_id, organizacao_id) references titulos(id, organizacao_id) on delete cascade
);

-- Proteção de período + regras de edição de títulos
create or replace function fn_titulos_guard() returns trigger language plpgsql as $$
begin
  if tg_op in ('UPDATE','DELETE') then
    perform fn_assert_periodo_aberto(old.empresa_id, old.data_competencia);
  end if;
  if tg_op = 'DELETE' then
    if old.valor_pago > 0 then
      raise exception 'Título possui baixas. Estorne as baixas antes de excluir.';
    end if;
    return old;
  end if;
  perform fn_assert_periodo_aberto(new.empresa_id, new.data_competencia);
  if tg_op = 'INSERT' then
    new.valor_pago := 0;
    if new.status <> 'cancelado' then new.status := 'aberto'; end if;
  end if;
  if tg_op = 'UPDATE' and coalesce(current_setting('financy.recalc', true), '') <> '1' then
    -- valor pago e status de liquidação só mudam via baixas
    if new.valor_pago <> old.valor_pago then raise exception 'O valor pago é calculado pelas baixas.'; end if;
    if new.status <> old.status and new.status <> 'cancelado' and old.status <> 'cancelado' then
      raise exception 'O status de pagamento é calculado pelas baixas.';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    if new.valor < new.valor_pago then
      raise exception 'Valor do título não pode ser menor que o valor já pago (R$ %).', new.valor_pago;
    end if;
    if old.status = 'cancelado' and new.status <> 'cancelado' and new.valor_pago = 0 then
      new.status := 'aberto'; new.cancelado_em := null;
    end if;
    if new.status = 'cancelado' and old.status <> 'cancelado' then
      if old.valor_pago > 0 then raise exception 'Título com baixa não pode ser cancelado. Estorne as baixas.'; end if;
      new.cancelado_em := now();
    end if;
    -- controle otimista de concorrência
    new.version := old.version + 1;
  end if;
  return new;
end $$;
create trigger t_titulos_guard before insert or update or delete on titulos
  for each row execute function fn_titulos_guard();

-- ---------------------------------------------------------------------
-- Baixas (pagamentos/recebimentos) e movimentos bancários
-- ---------------------------------------------------------------------
create table baixas (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  titulo_id uuid not null,
  conta_bancaria_id uuid not null,
  data_pagamento date not null,
  valor_principal numeric(14,2) not null check (valor_principal > 0),
  juros numeric(14,2) not null default 0 check (juros >= 0),
  multa numeric(14,2) not null default 0 check (multa >= 0),
  desconto numeric(14,2) not null default 0 check (desconto >= 0),
  valor_total numeric(14,2) generated always as (valor_principal + juros + multa - desconto) stored,
  observacao text,
  idempotency_key text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (id, organizacao_id),
  unique (organizacao_id, idempotency_key),
  foreign key (titulo_id, organizacao_id) references titulos(id, organizacao_id) on delete cascade,
  foreign key (conta_bancaria_id, organizacao_id) references contas_bancarias(id, organizacao_id),
  check (valor_principal + juros + multa - desconto > 0)
);
create index on baixas(titulo_id);
create index on baixas(organizacao_id, data_pagamento);

create table transferencias (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  empresa_id uuid not null,
  conta_origem_id uuid not null,
  conta_destino_id uuid not null,
  data date not null,
  valor numeric(14,2) not null check (valor > 0),
  descricao text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (id, organizacao_id),
  foreign key (empresa_id, organizacao_id) references empresas(id, organizacao_id),
  foreign key (conta_origem_id, organizacao_id) references contas_bancarias(id, organizacao_id),
  foreign key (conta_destino_id, organizacao_id) references contas_bancarias(id, organizacao_id),
  check (conta_origem_id <> conta_destino_id)
);

-- Livro-caixa: toda entrada/saída real de dinheiro de uma conta
create table movimentos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  empresa_id uuid not null,
  conta_bancaria_id uuid not null,
  data date not null,
  valor numeric(14,2) not null check (valor <> 0),   -- + entrada / − saída
  descricao text not null,
  tipo text not null check (tipo in ('baixa','transferencia')),
  baixa_id uuid unique,
  transferencia_id uuid,
  conciliado boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, organizacao_id),
  foreign key (baixa_id, organizacao_id) references baixas(id, organizacao_id) on delete cascade,
  foreign key (transferencia_id, organizacao_id) references transferencias(id, organizacao_id) on delete cascade,
  foreign key (conta_bancaria_id, organizacao_id) references contas_bancarias(id, organizacao_id),
  check ((tipo = 'baixa') = (baixa_id is not null)),
  check ((tipo = 'transferencia') = (transferencia_id is not null))
);
create index on movimentos(organizacao_id, conta_bancaria_id, data);
create index on movimentos(organizacao_id, data);

-- Recalcula valor_pago/status do título a partir das baixas
create or replace function fn_recalcular_titulo(p_titulo uuid) returns void language plpgsql security definer set search_path = public as $$
declare v_pago numeric; v_valor numeric; v_status text;
begin
  select coalesce(sum(valor_principal),0) into v_pago from baixas where titulo_id = p_titulo;
  select valor, status into v_valor, v_status from titulos where id = p_titulo;
  if v_status = 'cancelado' then return; end if;
  perform set_config('financy.recalc', '1', true);
  update titulos set valor_pago = v_pago,
    status = case when v_pago = 0 then 'aberto' when v_pago >= v_valor then 'pago' else 'parcial' end
  where id = p_titulo and (valor_pago is distinct from v_pago
     or status is distinct from case when v_pago = 0 then 'aberto' when v_pago >= v_valor then 'pago' else 'parcial' end);
  perform set_config('financy.recalc', '', true);
end $$;

create or replace function fn_baixas_before() returns trigger language plpgsql as $$
declare t titulos%rowtype; v_empresa_conta uuid;
begin
  if tg_op = 'DELETE' then
    perform fn_assert_periodo_aberto((select empresa_id from titulos where id = old.titulo_id), old.data_pagamento);
    if exists (select 1 from movimentos where baixa_id = old.id and conciliado) then
      raise exception 'Baixa já conciliada com o extrato. Desfaça a conciliação antes de estornar.';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'Baixas não podem ser alteradas. Estorne e registre novamente.';
  end if;
  -- trava o título: serializa baixas concorrentes
  select * into t from titulos where id = new.titulo_id for update;
  if t.status = 'cancelado' then raise exception 'Título cancelado não pode receber baixa.'; end if;
  if new.valor_principal > t.valor - t.valor_pago then
    raise exception 'Valor da baixa (R$ %) excede o saldo em aberto do título (R$ %).',
      new.valor_principal, t.valor - t.valor_pago using errcode = 'P0002';
  end if;
  select empresa_id into v_empresa_conta from contas_bancarias where id = new.conta_bancaria_id;
  if v_empresa_conta <> t.empresa_id then
    raise exception 'A conta bancária pertence a outra empresa.';
  end if;
  if new.data_pagamento < (select data_saldo_inicial from contas_bancarias where id = new.conta_bancaria_id) then
    raise exception 'Data da baixa anterior à data do saldo inicial da conta.';
  end if;
  perform fn_assert_periodo_aberto(t.empresa_id, new.data_pagamento);
  return new;
end $$;
create trigger t_baixas_before before insert or update or delete on baixas
  for each row execute function fn_baixas_before();

create or replace function fn_baixas_after() returns trigger language plpgsql security definer set search_path = public as $$
declare t titulos%rowtype;
begin
  if tg_op = 'INSERT' then
    select * into t from titulos where id = new.titulo_id;
    insert into movimentos (organizacao_id, empresa_id, conta_bancaria_id, data, valor, descricao, tipo, baixa_id)
    values (new.organizacao_id, t.empresa_id, new.conta_bancaria_id, new.data_pagamento,
            case when t.tipo = 'receber' then new.valor_total else -new.valor_total end,
            t.descricao, 'baixa', new.id);
    perform fn_recalcular_titulo(new.titulo_id);
    return new;
  end if;
  perform fn_recalcular_titulo(old.titulo_id);
  return old;
end $$;
create trigger t_baixas_after after insert or delete on baixas
  for each row execute function fn_baixas_after();

create or replace function fn_transferencias_trg() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    perform fn_assert_periodo_aberto(old.empresa_id, old.data);
    if exists (select 1 from movimentos where transferencia_id = old.id and conciliado) then
      raise exception 'Transferência conciliada. Desfaça a conciliação antes de excluir.';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' then raise exception 'Transferências não podem ser alteradas. Exclua e registre novamente.'; end if;
  perform fn_assert_periodo_aberto(new.empresa_id, new.data);
  if (select count(*) from contas_bancarias where id in (new.conta_origem_id, new.conta_destino_id)
        and empresa_id = new.empresa_id) <> 2 then
    raise exception 'Transferências só são permitidas entre contas da mesma empresa.';
  end if;
  if new.data < (select max(data_saldo_inicial) from contas_bancarias where id in (new.conta_origem_id, new.conta_destino_id)) then
    raise exception 'Data da transferência anterior à data do saldo inicial de uma das contas.';
  end if;
  return new;
end $$;
create trigger t_transf_before before insert or update or delete on transferencias
  for each row execute function fn_transferencias_trg();

create or replace function fn_transferencias_after() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into movimentos (organizacao_id, empresa_id, conta_bancaria_id, data, valor, descricao, tipo, transferencia_id) values
    (new.organizacao_id, new.empresa_id, new.conta_origem_id, new.data, -new.valor, coalesce(new.descricao,'Transferência enviada'), 'transferencia', new.id),
    (new.organizacao_id, new.empresa_id, new.conta_destino_id, new.data,  new.valor, coalesce(new.descricao,'Transferência recebida'), 'transferencia', new.id);
  return new;
end $$;
create trigger t_transf_after after insert on transferencias
  for each row execute function fn_transferencias_after();

-- Baixa (RPC) com validações e idempotência
create or replace function fn_baixar_titulo(
  p_titulo uuid, p_conta uuid, p_data date, p_valor_principal numeric,
  p_juros numeric default 0, p_multa numeric default 0, p_desconto numeric default 0,
  p_observacao text default null, p_idempotency_key text default null)
returns uuid language plpgsql as $$
declare v_id uuid; v_org uuid;
begin
  select organizacao_id into v_org from titulos where id = p_titulo;
  if v_org is null then raise exception 'Título não encontrado.'; end if;
  if p_idempotency_key is not null then
    select id into v_id from baixas where organizacao_id = v_org and idempotency_key = p_idempotency_key;
    if v_id is not null then return v_id; end if;
  end if;
  insert into baixas (organizacao_id, titulo_id, conta_bancaria_id, data_pagamento, valor_principal,
                      juros, multa, desconto, observacao, idempotency_key)
  values (v_org, p_titulo, p_conta, p_data, p_valor_principal,
          coalesce(p_juros,0), coalesce(p_multa,0), coalesce(p_desconto,0), p_observacao, p_idempotency_key)
  returning id into v_id;
  return v_id;
end $$;

-- Baixa em lote: [{titulo_id, valor_principal?, juros?, multa?, desconto?}] — tudo ou nada
create or replace function fn_baixar_lote(p_conta uuid, p_data date, p_itens jsonb) returns int
language plpgsql as $$
declare it jsonb; n int := 0; t record;
begin
  for it in select * from jsonb_array_elements(p_itens) loop
    select id, valor - valor_pago as saldo into t from titulos where id = (it->>'titulo_id')::uuid;
    if t.id is null then raise exception 'Título % não encontrado.', it->>'titulo_id'; end if;
    perform fn_baixar_titulo(t.id, p_conta, p_data,
      coalesce((it->>'valor_principal')::numeric, t.saldo),
      coalesce((it->>'juros')::numeric,0), coalesce((it->>'multa')::numeric,0), coalesce((it->>'desconto')::numeric,0));
    n := n + 1;
  end loop;
  return n;
end $$;

-- Cria título(s) com parcelamento: valor total dividido em N parcelas (última absorve centavos)
create or replace function fn_criar_titulos(p jsonb) returns setof uuid language plpgsql as $$
declare
  n int := greatest(coalesce((p->>'parcelas')::int,1),1);
  total numeric := (p->>'valor')::numeric;
  base numeric; v numeric; grupo uuid := case when n > 1 then gen_random_uuid() end;
  venc date := (p->>'data_vencimento')::date;
  comp date := coalesce((p->>'data_competencia')::date, venc);
  intervalo int := coalesce((p->>'intervalo_dias')::int, 0);  -- 0 = mensal
  i int; v_id uuid;
begin
  if total is null or total <= 0 then raise exception 'Valor deve ser maior que zero.'; end if;
  base := trunc(total / n, 2);
  for i in 1..n loop
    v := case when i = n then total - base * (n - 1) else base end;
    insert into titulos (organizacao_id, empresa_id, tipo, descricao, contato_id, categoria_id, centro_custo_id,
      canal_id, valor, data_emissao, data_vencimento, data_competencia, documento, observacoes,
      parcela_num, parcela_total, grupo_parcelamento, origem, external_id)
    values ((p->>'organizacao_id')::uuid, (p->>'empresa_id')::uuid, (p->>'tipo')::tipo_titulo,
      case when n > 1 then (p->>'descricao') || ' (' || i || '/' || n || ')' else p->>'descricao' end,
      nullif(p->>'contato_id','')::uuid, (p->>'categoria_id')::uuid, nullif(p->>'centro_custo_id','')::uuid,
      nullif(p->>'canal_id','')::uuid, v, coalesce((p->>'data_emissao')::date, current_date),
      case when intervalo > 0 then venc + (i-1) * intervalo else (venc + make_interval(months => i-1))::date end,
      case when coalesce((p->>'competencia_por_parcela')::boolean, false)
           then (comp + make_interval(months => i-1))::date else comp end,
      p->>'documento', p->>'observacoes',
      case when n > 1 then i end, case when n > 1 then n end, grupo,
      coalesce(p->>'origem','manual'),
      case when p->>'external_id' is not null then (p->>'external_id') || case when n > 1 then '#' || i else '' end end)
    returning id into v_id;
    return next v_id;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- Recorrências: gera títulos até um horizonte (idempotente via external_id)
-- ---------------------------------------------------------------------
create or replace function fn_gerar_recorrencias(p_ate date default (current_date + 365)) returns int
language plpgsql as $$
declare r recorrencias%rowtype; d date; n int := 0; passo interval; limite date;
begin
  for r in select * from recorrencias where ativo loop
    passo := case r.frequencia when 'semanal' then interval '7 days' when 'anual' then interval '1 year' else interval '1 month' end;
    limite := least(p_ate, coalesce(r.data_fim, p_ate));
    d := r.data_inicio;
    if r.frequencia = 'mensal' and r.dia_vencimento is not null then
      d := (date_trunc('month', r.data_inicio) + make_interval(days => least(r.dia_vencimento,
             extract(day from (date_trunc('month', r.data_inicio) + interval '1 month - 1 day'))::int) - 1))::date;
      if d < r.data_inicio then d := (d + interval '1 month')::date; end if;
    end if;
    while d <= limite loop
      -- pula meses fechados (não gera retroativamente em período fechado)
      if not exists (select 1 from periodos_fechados where empresa_id = r.empresa_id and competencia = date_trunc('month', d)) then
        insert into titulos (organizacao_id, empresa_id, tipo, descricao, contato_id, categoria_id, centro_custo_id,
            valor, data_emissao, data_vencimento, data_competencia, origem, external_id, recorrencia_id)
        values (r.organizacao_id, r.empresa_id, r.tipo, r.descricao, r.contato_id, r.categoria_id, r.centro_custo_id,
            r.valor, d, d, d, 'recorrencia', r.id || ':' || d, r.id)
        on conflict (organizacao_id, origem, external_id) do nothing;
        if found then n := n + 1; end if;
      end if;
      d := (d + passo)::date;
      if r.frequencia = 'mensal' and r.dia_vencimento is not null then
        d := (date_trunc('month', d) + make_interval(days => least(r.dia_vencimento,
              extract(day from (date_trunc('month', d) + interval '1 month - 1 day'))::int) - 1))::date;
      end if;
    end loop;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------
-- Empréstimos: SAC / Price
-- ---------------------------------------------------------------------
create table emprestimo_parcelas (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  emprestimo_id uuid not null,
  numero int not null,
  data_vencimento date not null,
  amortizacao numeric(14,2) not null,
  juros numeric(14,2) not null,
  valor_parcela numeric(14,2) not null,
  saldo_devedor numeric(14,2) not null,       -- saldo após a parcela
  titulo_amortizacao_id uuid references titulos(id) on delete set null,
  titulo_juros_id uuid references titulos(id) on delete set null,
  foreign key (emprestimo_id, organizacao_id) references emprestimos(id, organizacao_id) on delete cascade,
  unique (emprestimo_id, numero)
);

-- Cálculo puro (testável): retorna cronograma
create or replace function fn_calc_amortizacao(p_principal numeric, p_taxa_mensal_pct numeric, p_n int, p_sistema text)
returns table (numero int, amortizacao numeric, juros numeric, parcela numeric, saldo numeric)
language plpgsql immutable as $$
declare i numeric := p_taxa_mensal_pct / 100; s numeric := p_principal; pmt numeric; a numeric; j numeric; k int;
begin
  if p_sistema = 'PRICE' then
    pmt := case when i = 0 then p_principal / p_n else p_principal * i / (1 - power(1 + i, -p_n)) end;
    pmt := round(pmt, 2);
  end if;
  for k in 1..p_n loop
    j := round(s * i, 2);
    if p_sistema = 'SAC' then a := round(p_principal / p_n, 2); else a := pmt - j; end if;
    if k = p_n then a := s; end if;            -- última parcela zera o saldo (ajuste de arredondamento)
    s := s - a;
    numero := k; amortizacao := a; juros := j; parcela := a + j; saldo := s;
    return next;
  end loop;
end $$;

create or replace function fn_gerar_emprestimo(p_emprestimo uuid) returns int language plpgsql as $$
declare
  e emprestimos%rowtype; c record; v_cat_amort uuid; v_cat_juros uuid; v_cat_capt uuid;
  v_ta uuid; v_tj uuid; v_te uuid; n int := 0;
begin
  select * into e from emprestimos where id = p_emprestimo;
  if exists (select 1 from emprestimo_parcelas where emprestimo_id = e.id) then return 0; end if;  -- idempotente
  select id into v_cat_amort from plano_contas where organizacao_id = e.organizacao_id and chave_sistema = 'amortizacao_emprestimos';
  select id into v_cat_juros from plano_contas where organizacao_id = e.organizacao_id and chave_sistema = 'juros_emprestimos';
  select id into v_cat_capt  from plano_contas where organizacao_id = e.organizacao_id and chave_sistema = 'captacao_emprestimos';
  if v_cat_amort is null or v_cat_juros is null then
    raise exception 'Categorias de sistema de empréstimos ausentes no plano de contas.';
  end if;
  for c in select * from fn_calc_amortizacao(e.valor_principal, e.taxa_juros_mensal, e.prazo_meses, e.sistema) loop
    insert into titulos (organizacao_id, empresa_id, tipo, descricao, contato_id, categoria_id, valor,
        data_emissao, data_vencimento, data_competencia, origem, external_id, emprestimo_id, parcela_num, parcela_total)
    values (e.organizacao_id, e.empresa_id, 'pagar', e.descricao || ' — amortização ' || c.numero || '/' || e.prazo_meses,
        e.credor_contato_id, v_cat_amort, c.amortizacao, e.data_contratacao,
        (e.data_primeira_parcela + make_interval(months => c.numero - 1))::date,
        (e.data_primeira_parcela + make_interval(months => c.numero - 1))::date,
        'emprestimo', e.id || ':A' || c.numero, e.id, c.numero, e.prazo_meses)
    returning id into v_ta;
    v_tj := null;
    if c.juros > 0 then
      insert into titulos (organizacao_id, empresa_id, tipo, descricao, contato_id, categoria_id, valor,
          data_emissao, data_vencimento, data_competencia, origem, external_id, emprestimo_id, parcela_num, parcela_total)
      values (e.organizacao_id, e.empresa_id, 'pagar', e.descricao || ' — juros ' || c.numero || '/' || e.prazo_meses,
          e.credor_contato_id, v_cat_juros, c.juros, e.data_contratacao,
          (e.data_primeira_parcela + make_interval(months => c.numero - 1))::date,
          (e.data_primeira_parcela + make_interval(months => c.numero - 1))::date,
          'emprestimo', e.id || ':J' || c.numero, e.id, c.numero, e.prazo_meses)
      returning id into v_tj;
    end if;
    insert into emprestimo_parcelas (organizacao_id, emprestimo_id, numero, data_vencimento, amortizacao, juros,
        valor_parcela, saldo_devedor, titulo_amortizacao_id, titulo_juros_id)
    values (e.organizacao_id, e.id, c.numero, (e.data_primeira_parcela + make_interval(months => c.numero - 1))::date,
        c.amortizacao, c.juros, c.parcela, c.saldo, v_ta, v_tj);
    n := n + 1;
  end loop;
  if e.registrar_entrada then
    insert into titulos (organizacao_id, empresa_id, tipo, descricao, contato_id, categoria_id, valor,
        data_emissao, data_vencimento, data_competencia, origem, external_id, emprestimo_id)
    values (e.organizacao_id, e.empresa_id, 'receber', e.descricao || ' — entrada do principal', e.credor_contato_id,
        v_cat_capt, e.valor_principal, e.data_contratacao, e.data_contratacao, e.data_contratacao,
        'emprestimo', e.id || ':E', e.id)
    returning id into v_te;
    perform fn_baixar_titulo(v_te, e.conta_bancaria_id, e.data_contratacao, e.valor_principal);
  end if;
  return n;
end $$;

create or replace function fn_emprestimos_after() returns trigger language plpgsql as $$
begin perform fn_gerar_emprestimo(new.id); return new; end $$;
create trigger t_emprestimos_after after insert on emprestimos for each row execute function fn_emprestimos_after();

-- ---------------------------------------------------------------------
-- Depreciação (DRE, sem efeito caixa)
-- ---------------------------------------------------------------------
create table depreciacoes (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  empresa_id uuid not null,
  descricao text not null,
  valor_mensal numeric(14,2) not null check (valor_mensal > 0),
  inicio date not null,
  meses int not null check (meses > 0),
  foreign key (empresa_id, organizacao_id) references empresas(id, organizacao_id) on delete cascade
);

-- ---------------------------------------------------------------------
-- Metas e orçamento
-- ---------------------------------------------------------------------
create table metas (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  empresa_id uuid not null,
  canal_id uuid,
  competencia date not null check (extract(day from competencia) = 1),
  valor numeric(14,2) not null check (valor >= 0),
  foreign key (empresa_id, organizacao_id) references empresas(id, organizacao_id) on delete cascade,
  foreign key (canal_id, organizacao_id) references canais_venda(id, organizacao_id) on delete cascade,
  unique nulls not distinct (empresa_id, canal_id, competencia)
);

create table orcamentos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  empresa_id uuid not null,
  categoria_id uuid not null,
  competencia date not null check (extract(day from competencia) = 1),
  valor numeric(14,2) not null check (valor >= 0),
  foreign key (empresa_id, organizacao_id) references empresas(id, organizacao_id) on delete cascade,
  foreign key (categoria_id, organizacao_id) references plano_contas(id, organizacao_id) on delete cascade,
  unique (empresa_id, categoria_id, competencia)
);
