-- Extensões ficam no schema "extensions" no Supabase hospedado
set search_path = public, extensions;

-- =====================================================================
-- FINANCY — 0003 Vendas: registro atômico, recebíveis com taxas,
-- comissões/fretes, cancelamento e devoluções
-- =====================================================================

create or replace function fn_vendas_guard() returns trigger language plpgsql as $$
begin
  if tg_op in ('UPDATE','DELETE') then perform fn_assert_periodo_aberto(old.empresa_id, old.data_venda); end if;
  if tg_op = 'DELETE' then
    if exists (select 1 from titulos where venda_id = old.id and valor_pago > 0) then
      raise exception 'Venda possui recebimentos baixados. Estorne as baixas antes de excluir.';
    end if;
    return old;
  end if;
  perform fn_assert_periodo_aberto(new.empresa_id, new.data_venda);
  return new;
end $$;
create trigger t_vendas_guard before insert or update or delete on vendas
  for each row execute function fn_vendas_guard();

-- Busca a taxa aplicável: específica do canal > geral; faixa de parcelas
create or replace function fn_taxa_aplicavel(p_org uuid, p_canal uuid, p_forma uuid, p_parcelas int)
returns canal_taxas language sql stable as $$
  select * from canal_taxas
   where organizacao_id = p_org and forma_pagamento_id = p_forma
     and p_parcelas between parcelas_min and parcelas_max
     and (canal_id = p_canal or canal_id is null)
   order by (canal_id is null), parcelas_min desc
   limit 1
$$;

-- Divide um valor em n partes (última absorve arredondamento)
create or replace function fn_split(p_total numeric, p_n int, p_i int) returns numeric
language sql immutable as $$
  select case when p_i = p_n then p_total - trunc(p_total / p_n, 2) * (p_n - 1) else trunc(p_total / p_n, 2) end
$$;

/*
  Registra uma venda completa de forma atômica e idempotente.
  p = {
    organizacao_id, empresa_id, canal_id, contato_id?, numero?, data_venda, desconto?, frete_cobrado?,
    custo_frete?, origem?, external_id?, observacoes?,
    itens: [{produto_id?, descricao, quantidade, preco_unitario, desconto?, custo_unitario?}],
    pagamentos: [{forma_pagamento_id, valor, parcelas?, data_vencimento?, conta_bancaria_id?}]
  }
*/
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
      -- liquidação imediata (dinheiro/PIX com prazo 0 e conta definida)
      if v_conta is not null and v_venc <= v_data and v_forma_tipo in ('dinheiro','pix','debito','transferencia') then
        perform fn_baixar_titulo(v_tit, v_conta, v_data, v_liq);
      end if;
    end loop;
  end loop;

  if v_comissao > 0 and v_cat_comissao is not null then
    insert into titulos (organizacao_id, empresa_id, tipo, descricao, categoria_id, canal_id, valor, data_emissao,
        data_vencimento, data_competencia, origem, external_id, venda_id)
    values (v_org, (p->>'empresa_id')::uuid, 'pagar', 'Comissão venda ' || v_numero, v_cat_comissao, v_canal.id,
        v_comissao, v_data, (date_trunc('month', v_data) + interval '1 month + 4 days')::date, v_data,
        'venda', v_id || ':comissao', v_id);
  end if;
  if v_custo_frete > 0 and v_cat_frete is not null then
    insert into titulos (organizacao_id, empresa_id, tipo, descricao, categoria_id, canal_id, valor, data_emissao,
        data_vencimento, data_competencia, origem, external_id, venda_id)
    values (v_org, (p->>'empresa_id')::uuid, 'pagar', 'Frete venda ' || v_numero, v_cat_frete, v_canal.id,
        v_custo_frete, v_data, v_data + 30, v_data, 'venda', v_id || ':frete', v_id);
  end if;

  update vendas set valor_produtos = v_produtos, desconto = v_desc, valor_taxas_pagamento = v_taxas,
         valor_comissao = v_comissao, valor_taxa_marketplace = v_mkt, custo_frete = v_custo_frete,
         cmv = v_cmv, cmv_incompleto = v_incompleto
   where id = v_id;
  return v_id;
end $$;

create or replace function fn_cancelar_venda(p_venda uuid) returns void language plpgsql security definer set search_path = public as $$
begin
  if not (fn_can_write((select organizacao_id from vendas where id = p_venda)) or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'Sem permissão.';
  end if;
  if exists (select 1 from titulos where venda_id = p_venda and valor_pago > 0) then
    raise exception 'Venda possui recebimentos/pagamentos baixados. Estorne as baixas antes de cancelar.';
  end if;
  update titulos set status = 'cancelado' where venda_id = p_venda and status <> 'cancelado';
  update vendas set status = 'cancelada', cancelada_em = now() where id = p_venda and status <> 'cancelada';
end $$;

-- Devoluções / trocas: valida limite e gera reembolso
create or replace function fn_devolucoes_trg() returns trigger language plpgsql as $$
declare v vendas%rowtype; v_cat uuid; v_total_dev numeric;
begin
  if tg_op = 'DELETE' then
    perform fn_assert_periodo_aberto((select empresa_id from vendas where id = old.venda_id), old.data);
    if exists (select 1 from titulos where external_id = old.id || ':reembolso' and valor_pago > 0) then
      raise exception 'Reembolso já pago. Estorne a baixa antes de excluir a devolução.';
    end if;
    delete from titulos where organizacao_id = old.organizacao_id and origem = 'devolucao' and external_id = old.id || ':reembolso';
    return old;
  end if;
  if tg_op = 'UPDATE' then raise exception 'Devoluções não podem ser alteradas. Exclua e registre novamente.'; end if;
  select * into v from vendas where id = new.venda_id;
  if v.status = 'cancelada' then raise exception 'Venda cancelada não aceita devolução.'; end if;
  perform fn_assert_periodo_aberto(v.empresa_id, new.data);
  select coalesce(sum(valor),0) into v_total_dev from devolucoes where venda_id = new.venda_id;
  if v_total_dev + new.valor > v.valor_total then
    raise exception 'Total devolvido (R$ %) excede o valor da venda (R$ %).', v_total_dev + new.valor, v.valor_total;
  end if;
  if new.custo_devolvido > v.cmv then raise exception 'Custo devolvido maior que o CMV da venda.'; end if;
  return new;
end $$;
create trigger t_devolucoes_before before insert or update or delete on devolucoes
  for each row execute function fn_devolucoes_trg();

create or replace function fn_devolucoes_after() returns trigger language plpgsql as $$
declare v vendas%rowtype; v_cat uuid;
begin
  select * into v from vendas where id = new.venda_id;
  if new.gera_reembolso and new.tipo = 'devolucao' then
    select id into v_cat from plano_contas where organizacao_id = new.organizacao_id and chave_sistema = 'reembolso_clientes';
    insert into titulos (organizacao_id, empresa_id, tipo, descricao, contato_id, categoria_id, canal_id, valor,
        data_emissao, data_vencimento, data_competencia, origem, external_id, venda_id)
    values (new.organizacao_id, v.empresa_id, 'pagar', 'Reembolso devolução venda ' || v.numero, v.contato_id,
        v_cat, v.canal_id, new.valor, new.data, new.data, new.data, 'devolucao', new.id || ':reembolso', v.id);
  end if;
  return new;
end $$;
create trigger t_devolucoes_after after insert on devolucoes for each row execute function fn_devolucoes_after();
