-- =====================================================================
-- FINANCY — 0004 Extratos OFX e conciliação bancária
-- =====================================================================
create table extratos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  conta_bancaria_id uuid not null,
  nome_arquivo text not null,
  storage_path text,
  hash_arquivo text not null,
  banco_id text, conta_ofx text,
  data_inicio date, data_fim date,
  saldo_final numeric(14,2), data_saldo date,
  total_transacoes int not null default 0,
  novas_transacoes int not null default 0,
  importado_por uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (id, organizacao_id),
  unique (conta_bancaria_id, hash_arquivo),
  foreign key (conta_bancaria_id, organizacao_id) references contas_bancarias(id, organizacao_id) on delete cascade
);

create table transacoes_bancarias (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  conta_bancaria_id uuid not null,
  extrato_id uuid,
  fitid text not null,
  data date not null,
  valor numeric(14,2) not null,
  descricao text not null default '',
  tipo_ofx text,
  status text not null default 'pendente' check (status in ('pendente','conciliada','ignorada')),
  created_at timestamptz not null default now(),
  unique (id, organizacao_id),
  unique (conta_bancaria_id, fitid),           -- idempotência por FITID
  foreign key (conta_bancaria_id, organizacao_id) references contas_bancarias(id, organizacao_id) on delete cascade,
  foreign key (extrato_id, organizacao_id) references extratos(id, organizacao_id) on delete set null (extrato_id)
);
create index on transacoes_bancarias(organizacao_id, conta_bancaria_id, status, data);
create index transacoes_desc_trgm on transacoes_bancarias using gin (descricao gin_trgm_ops);

create table conciliacoes (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  transacao_id uuid not null,
  movimento_id uuid not null unique,              -- cada movimento concilia uma única vez
  origem text not null default 'manual' check (origem in ('manual','sugestao','regra','ia','lote')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  foreign key (transacao_id, organizacao_id) references transacoes_bancarias(id, organizacao_id) on delete cascade,
  foreign key (movimento_id, organizacao_id) references movimentos(id, organizacao_id) on delete cascade
);
create index on conciliacoes(transacao_id);

create table regras_conciliacao (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references organizacoes(id) on delete cascade,
  nome text not null,
  conta_bancaria_id uuid,
  descricao_contem text not null check (length(trim(descricao_contem)) >= 2),
  sentido text not null default 'ambos' check (sentido in ('entrada','saida','ambos')),
  categoria_id uuid not null,
  centro_custo_id uuid,
  contato_id uuid,
  prioridade int not null default 100,
  ativo boolean not null default true,
  foreign key (conta_bancaria_id, organizacao_id) references contas_bancarias(id, organizacao_id) on delete cascade,
  foreign key (categoria_id, organizacao_id) references plano_contas(id, organizacao_id),
  foreign key (centro_custo_id, organizacao_id) references centros_custo(id, organizacao_id),
  foreign key (contato_id, organizacao_id) references contatos(id, organizacao_id)
);

-- Mantém status da transação e flag do movimento
create or replace function fn_conciliacoes_trg() returns trigger language plpgsql security definer set search_path = public as $$
declare v_tr uuid := coalesce(new.transacao_id, old.transacao_id); v_soma numeric; v_valor numeric;
begin
  if tg_op = 'INSERT' then
    update movimentos set conciliado = true where id = new.movimento_id;
  else
    update movimentos set conciliado = false where id = old.movimento_id;
  end if;
  select coalesce(sum(m.valor),0) into v_soma from conciliacoes c join movimentos m on m.id = c.movimento_id
   where c.transacao_id = v_tr;
  select valor into v_valor from transacoes_bancarias where id = v_tr;
  update transacoes_bancarias set status = case when v_soma = v_valor then 'conciliada'
                                                 when status = 'ignorada' then 'ignorada' else 'pendente' end
   where id = v_tr;
  return coalesce(new, old);
end $$;
create trigger t_conciliacoes after insert or delete on conciliacoes for each row execute function fn_conciliacoes_trg();

-- Validação: conta, sinal e soma
create or replace function fn_conciliacoes_before() returns trigger language plpgsql security definer set search_path = public as $$
declare t transacoes_bancarias%rowtype; m movimentos%rowtype; v_soma numeric;
begin
  select * into t from transacoes_bancarias where id = new.transacao_id for update;   -- trava concorrência
  select * into m from movimentos where id = new.movimento_id for update;
  if m.conta_bancaria_id <> t.conta_bancaria_id then
    raise exception 'Movimento e transação pertencem a contas diferentes.';
  end if;
  if sign(m.valor) <> sign(t.valor) then raise exception 'Sentido (entrada/saída) do movimento difere da transação.'; end if;
  select coalesce(sum(mm.valor),0) into v_soma from conciliacoes c join movimentos mm on mm.id = c.movimento_id
   where c.transacao_id = t.id;
  if abs(v_soma + m.valor) > abs(t.valor) + 0.001 then
    raise exception 'A soma dos lançamentos (R$ %) excede o valor da transação (R$ %).', v_soma + m.valor, t.valor;
  end if;
  return new;
end $$;
create trigger t_conciliacoes_before before insert on conciliacoes for each row execute function fn_conciliacoes_before();

/*
  Importa transações de um OFX já lido (o parser roda no app e o backend revalida).
  p_transacoes: [{fitid, data 'YYYY-MM-DD', valor, descricao, tipo}]
  Retorna {extrato_id, total, novas, duplicadas, ja_importado}
*/
create or replace function fn_importar_ofx(
  p_conta uuid, p_nome_arquivo text, p_hash text, p_meta jsonb, p_transacoes jsonb, p_storage_path text default null)
returns jsonb language plpgsql as $$
declare v_org uuid; v_ext uuid; t jsonb; n_total int := 0; n_novas int := 0;
begin
  select organizacao_id into v_org from contas_bancarias where id = p_conta;
  if v_org is null then raise exception 'Conta bancária não encontrada.'; end if;
  if jsonb_typeof(p_transacoes) <> 'array' then raise exception 'Formato de transações inválido.'; end if;
  select id into v_ext from extratos where conta_bancaria_id = p_conta and hash_arquivo = p_hash;
  if v_ext is not null then
    return jsonb_build_object('extrato_id', v_ext, 'total', 0, 'novas', 0, 'duplicadas', 0, 'ja_importado', true);
  end if;
  insert into extratos (organizacao_id, conta_bancaria_id, nome_arquivo, storage_path, hash_arquivo, banco_id, conta_ofx,
                        data_inicio, data_fim, saldo_final, data_saldo)
  values (v_org, p_conta, p_nome_arquivo, p_storage_path, p_hash, p_meta->>'banco_id', p_meta->>'conta',
          (p_meta->>'data_inicio')::date, (p_meta->>'data_fim')::date,
          (p_meta->>'saldo_final')::numeric, (p_meta->>'data_saldo')::date)
  returning id into v_ext;
  for t in select * from jsonb_array_elements(p_transacoes) loop
    if coalesce(t->>'fitid','') = '' or (t->>'data') is null or (t->>'valor') is null then
      raise exception 'Transação inválida no arquivo: %', t;
    end if;
    if (t->>'valor')::numeric = 0 then continue; end if;
    n_total := n_total + 1;
    insert into transacoes_bancarias (organizacao_id, conta_bancaria_id, extrato_id, fitid, data, valor, descricao, tipo_ofx)
    values (v_org, p_conta, v_ext, t->>'fitid', (t->>'data')::date, round((t->>'valor')::numeric, 2),
            left(coalesce(t->>'descricao',''), 500), t->>'tipo')
    on conflict (conta_bancaria_id, fitid) do nothing;
    if found then n_novas := n_novas + 1; end if;
  end loop;
  update extratos set total_transacoes = n_total, novas_transacoes = n_novas where id = v_ext;
  return jsonb_build_object('extrato_id', v_ext, 'total', n_total, 'novas', n_novas,
                            'duplicadas', n_total - n_novas, 'ja_importado', false);
end $$;

/*
  Sugestões de correspondência para transações pendentes de uma conta.
  Considera (a) movimentos não conciliados e (b) títulos em aberto (gera baixa ao conciliar).
  Score: valor exato + proximidade de data (±7 dias) + similaridade de descrição.
*/
create or replace function fn_sugestoes_conciliacao(p_conta uuid)
returns table (transacao_id uuid, alvo_tipo text, alvo_id uuid, descricao text, data date, valor numeric, score numeric)
language sql stable as $$
  with tr as (
    select * from transacoes_bancarias where conta_bancaria_id = p_conta and status = 'pendente'
  ), cand as (
    select tr.id as transacao_id, 'movimento'::text as alvo_tipo, m.id as alvo_id, m.descricao, m.data, m.valor,
           round((0.6 + 0.3 * (1 - least(abs(m.data - tr.data), 7) / 7.0)
                 + 0.1 * similarity(lower(m.descricao), lower(tr.descricao)))::numeric, 3) as score
      from tr join movimentos m
        on m.conta_bancaria_id = tr.conta_bancaria_id and not m.conciliado
       and m.valor = tr.valor and abs(m.data - tr.data) <= 7
    union all
    select tr.id, 'titulo', t.id, t.descricao, t.data_vencimento,
           case when t.tipo = 'receber' then t.valor - t.valor_pago else -(t.valor - t.valor_pago) end,
           round((0.5 + 0.3 * (1 - least(abs(t.data_vencimento - tr.data), 15) / 15.0)
                 + 0.2 * similarity(lower(t.descricao || ' ' || coalesce(c.nome,'')), lower(tr.descricao)))::numeric, 3)
      from tr
      join contas_bancarias cb on cb.id = tr.conta_bancaria_id
      join titulos t on t.empresa_id = cb.empresa_id and t.status in ('aberto','parcial')
       and t.tipo = case when tr.valor > 0 then 'receber'::tipo_titulo else 'pagar'::tipo_titulo end
       and (t.valor - t.valor_pago) = abs(tr.valor)
       and abs(t.data_vencimento - tr.data) <= 15
      left join contatos c on c.id = t.contato_id
  )
  select distinct on (transacao_id) * from cand order by transacao_id, score desc
$$;

create or replace function fn_conciliar(p_transacao uuid, p_movimentos uuid[], p_origem text default 'manual')
returns void language plpgsql as $$
declare v_org uuid; m uuid;
begin
  select organizacao_id into v_org from transacoes_bancarias where id = p_transacao;
  foreach m in array p_movimentos loop
    insert into conciliacoes (organizacao_id, transacao_id, movimento_id, origem) values (v_org, p_transacao, m, p_origem);
  end loop;
end $$;

-- Concilia com um título em aberto: baixa o título na data/conta da transação e vincula
create or replace function fn_conciliar_titulo(p_transacao uuid, p_titulo uuid, p_origem text default 'manual')
returns uuid language plpgsql as $$
declare t transacoes_bancarias%rowtype; v_baixa uuid; v_mov uuid; v_saldo numeric;
begin
  select * into t from transacoes_bancarias where id = p_transacao for update;
  if t.status <> 'pendente' then raise exception 'Transação já conciliada ou ignorada.'; end if;
  select valor - valor_pago into v_saldo from titulos where id = p_titulo;
  v_baixa := fn_baixar_titulo(p_titulo, t.conta_bancaria_id, t.data, least(abs(t.valor), v_saldo),
                              greatest(abs(t.valor) - v_saldo, 0), 0, 0, 'Conciliação bancária');
  select id into v_mov from movimentos where baixa_id = v_baixa;
  perform fn_conciliar(p_transacao, array[v_mov], p_origem);
  return v_baixa;
end $$;

-- Cria lançamento (título + baixa) a partir de transação sem correspondência e concilia
create or replace function fn_lancamento_de_transacao(
  p_transacao uuid, p_categoria uuid, p_descricao text default null, p_contato uuid default null,
  p_centro_custo uuid default null, p_origem text default 'manual')
returns uuid language plpgsql as $$
declare t transacoes_bancarias%rowtype; v_emp uuid; v_tit uuid;
begin
  select * into t from transacoes_bancarias where id = p_transacao for update;
  if t.status <> 'pendente' then raise exception 'Transação já conciliada ou ignorada.'; end if;
  select empresa_id into v_emp from contas_bancarias where id = t.conta_bancaria_id;
  insert into titulos (organizacao_id, empresa_id, tipo, descricao, contato_id, categoria_id, centro_custo_id, valor,
      data_emissao, data_vencimento, data_competencia, origem, external_id)
  values (t.organizacao_id, v_emp, case when t.valor > 0 then 'receber'::tipo_titulo else 'pagar'::tipo_titulo end,
      coalesce(nullif(trim(p_descricao),''), nullif(t.descricao,''), 'Lançamento do extrato'), p_contato, p_categoria, p_centro_custo,
      abs(t.valor), t.data, t.data, t.data, 'ofx', t.id::text)
  returning id into v_tit;
  perform fn_conciliar_titulo(p_transacao, v_tit, p_origem);
  return v_tit;
end $$;

-- Aplica regras ativas às transações pendentes de uma conta. Retorna quantidade conciliada.
create or replace function fn_aplicar_regras(p_conta uuid) returns int language plpgsql as $$
declare t record; r regras_conciliacao%rowtype; n int := 0;
begin
  for t in select * from transacoes_bancarias where conta_bancaria_id = p_conta and status = 'pendente' order by data loop
    select * into r from regras_conciliacao
     where organizacao_id = t.organizacao_id and ativo
       and (conta_bancaria_id is null or conta_bancaria_id = p_conta)
       and t.descricao ilike '%' || descricao_contem || '%'
       and (sentido = 'ambos' or (sentido = 'entrada' and t.valor > 0) or (sentido = 'saida' and t.valor < 0))
     order by prioridade, length(descricao_contem) desc limit 1;
    if r.id is not null then
      perform fn_lancamento_de_transacao(t.id, r.categoria_id, null, r.contato_id, r.centro_custo_id, 'regra');
      n := n + 1;
    end if;
  end loop;
  return n;
end $$;

create or replace function fn_desfazer_conciliacao(p_transacao uuid) returns void language plpgsql as $$
begin
  perform 1 from transacoes_bancarias where id = p_transacao for update;
  delete from conciliacoes where transacao_id = p_transacao;
  update transacoes_bancarias set status = 'pendente' where id = p_transacao;
end $$;

-- Saldo conciliado x saldo do extrato
create or replace function fn_resumo_conciliacao(p_conta uuid) returns jsonb language sql stable as $$
  select jsonb_build_object(
    'saldo_sistema', cb.saldo_inicial + coalesce((select sum(valor) from movimentos where conta_bancaria_id = cb.id and data >= cb.data_saldo_inicial),0),
    'saldo_conciliado', cb.saldo_inicial + coalesce((select sum(valor) from movimentos where conta_bancaria_id = cb.id and conciliado and data >= cb.data_saldo_inicial),0),
    'saldo_extrato', (select saldo_final from extratos where conta_bancaria_id = cb.id and saldo_final is not null order by data_saldo desc nulls last, created_at desc limit 1),
    'data_saldo_extrato', (select data_saldo from extratos where conta_bancaria_id = cb.id and saldo_final is not null order by data_saldo desc nulls last, created_at desc limit 1),
    'pendentes', (select count(*) from transacoes_bancarias where conta_bancaria_id = cb.id and status = 'pendente'),
    'conciliadas', (select count(*) from transacoes_bancarias where conta_bancaria_id = cb.id and status = 'conciliada'),
    'movimentos_nao_conciliados', (select count(*) from movimentos where conta_bancaria_id = cb.id and not conciliado))
  from contas_bancarias cb where cb.id = p_conta
$$;
