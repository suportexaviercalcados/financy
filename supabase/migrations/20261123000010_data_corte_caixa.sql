-- Extensões ficam no schema "extensions" no Supabase hospedado
set search_path = public, extensions;

-- =====================================================================
-- FINANCY — 0010 Data de corte do caixa (importação de histórico)
-- Títulos que venceram antes da data de corte (menor data de saldo inicial
-- das contas da empresa) já estão refletidos no saldo inicial. Eles entram
-- como "liquidados antes do corte": contam na DRE (competência), mas não
-- geram movimento de caixa nem aparecem como vencidos/projetados.
-- =====================================================================

alter table titulos add column if not exists liquidado_pre_corte boolean not null default false;

create or replace function fn_data_corte(p_empresa uuid) returns date
language sql stable security definer set search_path = public as $$
  select min(data_saldo_inicial) from contas_bancarias where empresa_id = p_empresa
$$;

create or replace function fn_liquidar_pre_corte(p_titulo uuid) returns void
language plpgsql security definer set search_path = public as $$
declare t titulos%rowtype; v_corte date;
begin
  select * into t from titulos where id = p_titulo for update;
  if t.id is null then raise exception 'Título não encontrado.'; end if;
  if not (fn_can_write(t.organizacao_id) or coalesce(auth.role(),'') = 'service_role' or auth.uid() is null) then
    raise exception 'Sem permissão.';
  end if;
  v_corte := fn_data_corte(t.empresa_id);
  if v_corte is null or t.data_vencimento >= v_corte then
    raise exception 'Somente títulos vencidos antes da data de corte do caixa (%) podem ser quitados sem baixa.', to_char(v_corte,'DD/MM/YYYY');
  end if;
  if t.status = 'cancelado' or exists (select 1 from baixas where titulo_id = p_titulo) then return; end if;
  perform set_config('financy.recalc', '1', true);
  update titulos set liquidado_pre_corte = true, valor_pago = valor, status = 'pago' where id = p_titulo;
  perform set_config('financy.recalc', '', true);
end $$;

-- recálculo preserva a quitação anterior ao corte
create or replace function fn_recalcular_titulo(p_titulo uuid) returns void language plpgsql security definer set search_path = public as $$
declare v_pago numeric; v_valor numeric; v_status text; v_pre boolean;
begin
  select coalesce(sum(valor_principal),0) into v_pago from baixas where titulo_id = p_titulo;
  select valor, status, liquidado_pre_corte into v_valor, v_status, v_pre from titulos where id = p_titulo;
  if v_status = 'cancelado' or v_pre then return; end if;
  perform set_config('financy.recalc', '1', true);
  update titulos set valor_pago = v_pago,
    status = case when v_pago = 0 then 'aberto' when v_pago >= v_valor then 'pago' else 'parcial' end
  where id = p_titulo and (valor_pago is distinct from v_pago
     or status is distinct from case when v_pago = 0 then 'aberto' when v_pago >= v_valor then 'pago' else 'parcial' end);
  perform set_config('financy.recalc', '', true);
end $$;

-- título quitado antes do corte não recebe baixa
create or replace function fn_bloqueia_baixa_pre_corte() returns trigger language plpgsql as $$
begin
  if exists (select 1 from titulos where id = new.titulo_id and liquidado_pre_corte) then
    raise exception 'Título quitado antes da data de corte do caixa: não aceita baixa.';
  end if;
  return new;
end $$;
drop trigger if exists t_baixa_pre_corte on baixas;
create trigger t_baixa_pre_corte before insert on baixas for each row execute function fn_bloqueia_baixa_pre_corte();

create or replace function fn_registrar_venda(p jsonb) returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := (p->>'organizacao_id')::uuid;
  v_id uuid; v_canal canais_venda%rowtype; v_data date := (p->>'data_venda')::date;
  it jsonb; pg jsonb; v_custo numeric; v_prod_custo numeric;
  v_produtos numeric := 0; v_desc numeric := coalesce((p->>'desconto')::numeric,0);
  v_frete numeric := coalesce((p->>'frete_cobrado')::numeric,0);
  v_cmv numeric := 0; v_incompleto boolean := false;
  v_total numeric; v_soma_pag numeric := 0; v_taxas numeric := 0;
  v_comissao numeric; v_mkt numeric; v_custo_frete numeric;
  tx canal_taxas%rowtype; v_parc int; v_vtaxa numeric; v_pag_id uuid; v_forma_tipo text;
  i int; v_bruto numeric; v_tx_i numeric; v_mkt_pag numeric; v_mkt_i numeric; v_liq numeric; v_venc date;
  v_cat_receita uuid; v_cat_comissao uuid; v_cat_frete uuid; v_tit uuid; v_conta uuid; v_numero text;
  v_corte date := fn_data_corte((p->>'empresa_id')::uuid);
begin
  if v_org is null or v_data is null then raise exception 'organizacao_id e data_venda são obrigatórios.'; end if;
  if not (fn_can_write(v_org) or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Sem permissão para registrar vendas nesta organização.';
  end if;
  if p->>'external_id' is not null then
    select id into v_id from vendas where organizacao_id = v_org
       and origem = coalesce(p->>'origem','manual') and external_id = p->>'external_id';
    if v_id is not null then return v_id; end if;   -- idempotência
  end if;
  if jsonb_array_length(coalesce(p->'itens','[]')) = 0 then raise exception 'A venda precisa de ao menos um item.'; end if;
  if jsonb_array_length(coalesce(p->'pagamentos','[]')) = 0 then raise exception 'Informe ao menos uma forma de pagamento.'; end if;

  select * into v_canal from canais_venda where id = (p->>'canal_id')::uuid and organizacao_id = v_org;
  if v_canal.id is null then raise exception 'Canal de venda inválido.'; end if;
  select id into v_cat_receita  from plano_contas where organizacao_id = v_org and chave_sistema = 'receita_vendas';
  select id into v_cat_comissao from plano_contas where organizacao_id = v_org and chave_sistema = 'comissoes';
  select id into v_cat_frete    from plano_contas where organizacao_id = v_org and chave_sistema = 'fretes';
  if v_cat_receita is null then raise exception 'Categoria de sistema receita_vendas ausente.'; end if;
  v_numero := coalesce(p->>'numero', (select (count(*)+1)::text from vendas where organizacao_id = v_org));

  insert into vendas (organizacao_id, empresa_id, canal_id, contato_id, numero, data_venda, frete_cobrado,
                      origem, external_id, observacoes)
  values (v_org, (p->>'empresa_id')::uuid, v_canal.id, nullif(p->>'contato_id','')::uuid, v_numero,
          v_data, v_frete, coalesce(p->>'origem','manual'), p->>'external_id', p->>'observacoes')
  returning id into v_id;

  -- Itens + CMV
  for it in select * from jsonb_array_elements(p->'itens') loop
    v_prod_custo := null;
    if nullif(it->>'produto_id','') is not null then
      select custo into v_prod_custo from produtos where id = (it->>'produto_id')::uuid and organizacao_id = v_org;
    end if;
    v_custo := coalesce((it->>'custo_unitario')::numeric, v_prod_custo);
    if v_custo is null then v_incompleto := true; end if;
    insert into venda_itens (organizacao_id, venda_id, produto_id, descricao, quantidade, preco_unitario, desconto, custo_unitario)
    values (v_org, v_id, nullif(it->>'produto_id','')::uuid, it->>'descricao', (it->>'quantidade')::numeric,
            (it->>'preco_unitario')::numeric, coalesce((it->>'desconto')::numeric,0), v_custo);
    v_produtos := v_produtos + round((it->>'quantidade')::numeric * (it->>'preco_unitario')::numeric, 2);
    v_desc := v_desc + coalesce((it->>'desconto')::numeric,0);
    v_cmv := v_cmv + coalesce(round((it->>'quantidade')::numeric * v_custo, 2), 0);
  end loop;
  v_total := v_produtos - v_desc + v_frete;
  if v_total < 0 then raise exception 'Desconto maior que o valor da venda.'; end if;

  select coalesce(sum((x->>'valor')::numeric),0) into v_soma_pag from jsonb_array_elements(p->'pagamentos') x;
  if abs(v_soma_pag - v_total) > 0.01 then
    raise exception 'Soma dos pagamentos (R$ %) difere do total da venda (R$ %).', v_soma_pag, v_total;
  end if;

  -- Custos variáveis do canal
  v_comissao := round((v_total - v_frete) * v_canal.comissao_percentual / 100, 2);
  v_mkt := round(v_total * v_canal.taxa_marketplace_percentual / 100, 2);
  v_custo_frete := coalesce((p->>'custo_frete')::numeric, round(v_total * v_canal.custo_frete_percentual / 100, 2));

  -- Pagamentos -> recebíveis
  for pg in select * from jsonb_array_elements(p->'pagamentos') loop
    v_parc := greatest(coalesce((pg->>'parcelas')::int,1),1);
    select tipo into v_forma_tipo from formas_pagamento where id = (pg->>'forma_pagamento_id')::uuid and organizacao_id = v_org;
    if v_forma_tipo is null then raise exception 'Forma de pagamento inválida.'; end if;
    tx := fn_taxa_aplicavel(v_org, v_canal.id, (pg->>'forma_pagamento_id')::uuid, v_parc);
    v_vtaxa := round((pg->>'valor')::numeric * coalesce(tx.taxa_percentual,0) / 100 + coalesce(tx.taxa_fixa,0), 2);
    v_taxas := v_taxas + v_vtaxa;
    v_conta := coalesce(nullif(pg->>'conta_bancaria_id','')::uuid, tx.conta_bancaria_id);
    insert into venda_pagamentos (organizacao_id, venda_id, forma_pagamento_id, valor, parcelas, taxa_percentual,
        taxa_fixa, valor_taxa, prazo_dias, intervalo_parcelas_dias, adquirente_id, conta_bancaria_id)
    values (v_org, v_id, (pg->>'forma_pagamento_id')::uuid, (pg->>'valor')::numeric, v_parc,
        coalesce(tx.taxa_percentual,0), coalesce(tx.taxa_fixa,0), v_vtaxa, coalesce(tx.prazo_dias,0),
        coalesce(tx.intervalo_parcelas_dias,30), tx.adquirente_id, v_conta)
    returning id into v_pag_id;

    -- taxa de marketplace rateada proporcionalmente ao pagamento (descontada do repasse)
    v_mkt_pag := case when v_total > 0 then round(v_mkt * (pg->>'valor')::numeric / v_total, 2) else 0 end;
    for i in 1..v_parc loop
      v_bruto := fn_split((pg->>'valor')::numeric, v_parc, i);
      v_tx_i := fn_split(v_vtaxa, v_parc, i);
      v_mkt_i := fn_split(v_mkt_pag, v_parc, i);
      v_liq := v_bruto - v_tx_i - v_mkt_i;
      v_venc := coalesce((pg->>'data_vencimento')::date, v_data + coalesce(tx.prazo_dias,0))
                + (i - 1) * coalesce(tx.intervalo_parcelas_dias,30);
      continue when v_liq <= 0;
      insert into titulos (organizacao_id, empresa_id, tipo, descricao, contato_id, categoria_id, canal_id, valor,
          data_emissao, data_vencimento, data_competencia, origem, external_id, venda_id, adquirente_id,
          valor_bruto, valor_taxa, conta_bancaria_prevista_id, parcela_num, parcela_total)
      values (v_org, (p->>'empresa_id')::uuid, 'receber',
          'Venda ' || v_numero || ' — ' || v_canal.nome || case when v_parc > 1 then ' (' || i || '/' || v_parc || ')' else '' end,
          nullif(p->>'contato_id','')::uuid, v_cat_receita, v_canal.id, v_liq, v_data, v_venc, v_data,
          'venda', v_pag_id || ':' || i, v_id, tx.adquirente_id, v_bruto, v_tx_i + v_mkt_i, v_conta,
          case when v_parc > 1 then i end, case when v_parc > 1 then v_parc end)
      returning id into v_tit;
      -- antes da data de corte do caixa: o dinheiro já está no saldo inicial das contas
      if v_corte is not null and v_venc < v_corte then
        perform fn_liquidar_pre_corte(v_tit);
      -- liquidação imediata (dinheiro/PIX com prazo 0 e conta definida)
      elsif v_conta is not null and v_venc <= v_data and v_forma_tipo in ('dinheiro','pix','debito','transferencia')
            and v_data >= (select data_saldo_inicial from contas_bancarias where id = v_conta) then
        perform fn_baixar_titulo(v_tit, v_conta, v_data, v_liq);
      end if;
    end loop;
  end loop;

  if v_comissao > 0 and v_cat_comissao is not null then
    insert into titulos (organizacao_id, empresa_id, tipo, descricao, categoria_id, canal_id, valor, data_emissao,
        data_vencimento, data_competencia, origem, external_id, venda_id)
    values (v_org, (p->>'empresa_id')::uuid, 'pagar', 'Comissão venda ' || v_numero, v_cat_comissao, v_canal.id,
        v_comissao, v_data, (date_trunc('month', v_data) + interval '1 month + 4 days')::date, v_data,
        'venda', v_id || ':comissao', v_id)
    returning id into v_tit;
    if v_corte is not null and (date_trunc('month', v_data) + interval '1 month + 4 days')::date < v_corte then
      perform fn_liquidar_pre_corte(v_tit);
    end if;
  end if;
  if v_custo_frete > 0 and v_cat_frete is not null then
    insert into titulos (organizacao_id, empresa_id, tipo, descricao, categoria_id, canal_id, valor, data_emissao,
        data_vencimento, data_competencia, origem, external_id, venda_id)
    values (v_org, (p->>'empresa_id')::uuid, 'pagar', 'Frete venda ' || v_numero, v_cat_frete, v_canal.id,
        v_custo_frete, v_data, v_data + 30, v_data, 'venda', v_id || ':frete', v_id)
    returning id into v_tit;
    if v_corte is not null and v_data + 30 < v_corte then perform fn_liquidar_pre_corte(v_tit); end if;
  end if;

  update vendas set valor_produtos = v_produtos, desconto = v_desc, valor_taxas_pagamento = v_taxas,
         valor_comissao = v_comissao, valor_taxa_marketplace = v_mkt, custo_frete = v_custo_frete,
         cmv = v_cmv, cmv_incompleto = v_incompleto
   where id = v_id;
  return v_id;
end $$;

-- Saneamento: títulos gerados por vendas já importadas que venceram antes do corte
do $$
declare r record;
begin
  for r in select t.id from titulos t
            where t.origem in ('venda','devolucao') and t.status in ('aberto','parcial') and t.valor_pago = 0
              and t.data_vencimento < fn_data_corte(t.empresa_id) loop
    perform fn_liquidar_pre_corte(r.id);
  end loop;
end $$;
