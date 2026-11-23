-- Extensões ficam no schema "extensions" no Supabase hospedado
set search_path = public, extensions;

-- =====================================================================
-- FINANCY — 0006 Relatórios: fonte única para DRE, DFC, fluxo de caixa,
-- vendas por canal e dashboard. Todas as funções são SECURITY INVOKER:
-- o RLS das tabelas-base garante o isolamento por organização.
-- =====================================================================

-- Categorias de sistema por organização (pivot)
create or replace view vw_categorias_sistema with (security_invoker = true) as
select organizacao_id,
  (array_agg(id) filter (where chave_sistema = 'receita_vendas'))[1]        as receita_vendas,
  (array_agg(id) filter (where chave_sistema = 'descontos_concedidos'))[1]  as descontos_concedidos,
  (array_agg(id) filter (where chave_sistema = 'devolucoes_vendas'))[1]     as devolucoes_vendas,
  (array_agg(id) filter (where chave_sistema = 'impostos_vendas'))[1]       as impostos_vendas,
  (array_agg(id) filter (where chave_sistema = 'cmv'))[1]                   as cmv,
  (array_agg(id) filter (where chave_sistema = 'taxas_cartao'))[1]          as taxas_cartao,
  (array_agg(id) filter (where chave_sistema = 'taxas_marketplace'))[1]     as taxas_marketplace,
  (array_agg(id) filter (where chave_sistema = 'comissoes'))[1]             as comissoes,
  (array_agg(id) filter (where chave_sistema = 'fretes'))[1]                as fretes,
  (array_agg(id) filter (where chave_sistema = 'juros_multas_pagos'))[1]    as juros_multas_pagos,
  (array_agg(id) filter (where chave_sistema = 'juros_multas_recebidos'))[1] as juros_multas_recebidos,
  (array_agg(id) filter (where chave_sistema = 'descontos_obtidos'))[1]     as descontos_obtidos,
  (array_agg(id) filter (where chave_sistema = 'descontos_financeiros'))[1] as descontos_financeiros,
  (array_agg(id) filter (where chave_sistema = 'depreciacao'))[1]           as depreciacao
from plano_contas where chave_sistema is not null group by organizacao_id;

/*
  vw_dre_base — cada linha é um fato de competência rastreável à origem.
  valor > 0 aumenta a magnitude do grupo (receitas e despesas exibidas em módulo).
*/
create or replace view vw_dre_base with (security_invoker = true) as
-- 1) Títulos lançados (exceto os gerados por vendas, que entram via vendas)
select t.organizacao_id, t.empresa_id, t.canal_id, t.data_competencia as data, pc.dre_grupo as grupo,
       t.categoria_id,
       t.valor * case when (pc.dre_grupo in ('receita_bruta','receita_financeira')) = (t.tipo = 'receber') then 1 else -1 end as valor,
       'titulo'::text as origem, t.id as origem_id, t.descricao
  from titulos t
  join plano_contas pc on pc.id = t.categoria_id
  join empresas e on e.id = t.empresa_id
 where t.status <> 'cancelado' and t.venda_id is null and pc.dre_grupo <> 'nao_dre'
   and not (pc.dre_grupo = 'deducoes_impostos' and e.imposto_vendas_modo = 'estimado')
union all
-- 2) Vendas concluídas
select v.organizacao_id, v.empresa_id, v.canal_id, v.data_venda, x.grupo::dre_grupo, x.categoria_id, x.valor,
       'venda', v.id, 'Venda ' || coalesce(v.numero,'') || ' — ' || x.rotulo
  from vendas v
  join empresas e on e.id = v.empresa_id
  left join vw_categorias_sistema cs on cs.organizacao_id = v.organizacao_id
  cross join lateral (values
    ('receita_bruta',       cs.receita_vendas,       v.valor_produtos + v.frete_cobrado, 'receita bruta'),
    ('deducoes_devolucoes', cs.descontos_concedidos, v.desconto,                         'descontos'),
    ('deducoes_impostos',   cs.impostos_vendas,      case when e.imposto_vendas_modo = 'estimado'
                                                       then round(v.valor_total * e.aliquota_imposto_vendas / 100, 2) else 0 end, 'impostos estimados'),
    ('cmv',                 cs.cmv,                  v.cmv,                              'CMV'),
    ('despesa_variavel',    cs.taxas_cartao,         v.valor_taxas_pagamento,            'taxas de pagamento'),
    ('despesa_variavel',    cs.taxas_marketplace,    v.valor_taxa_marketplace,           'taxa marketplace'),
    ('despesa_variavel',    cs.comissoes,            v.valor_comissao,                   'comissão'),
    ('despesa_variavel',    cs.fretes,               v.custo_frete,                      'frete')
  ) as x(grupo, categoria_id, valor, rotulo)
 where v.status = 'concluida' and x.valor <> 0
union all
-- 3) Devoluções
select d.organizacao_id, v.empresa_id, v.canal_id, d.data, x.grupo::dre_grupo, x.categoria_id, x.valor,
       'devolucao', d.id, 'Devolução venda ' || coalesce(v.numero,'') || ' — ' || x.rotulo
  from devolucoes d
  join vendas v on v.id = d.venda_id and v.status = 'concluida'
  join empresas e on e.id = v.empresa_id
  left join vw_categorias_sistema cs on cs.organizacao_id = d.organizacao_id
  cross join lateral (values
    ('deducoes_devolucoes', cs.devolucoes_vendas, d.valor, 'devolução'),
    ('cmv',                 cs.cmv,               -d.custo_devolvido, 'estorno CMV'),
    ('deducoes_impostos',   cs.impostos_vendas,   case when e.imposto_vendas_modo = 'estimado'
                                                    then -round(d.valor * e.aliquota_imposto_vendas / 100, 2) else 0 end, 'estorno impostos')
  ) as x(grupo, categoria_id, valor, rotulo)
 where x.valor <> 0
union all
-- 4) Encargos financeiros das baixas (juros, multa, desconto) — competência = data da baixa
select b.organizacao_id, t.empresa_id, t.canal_id, b.data_pagamento, x.grupo::dre_grupo, x.categoria_id, x.valor,
       'baixa', b.id, t.descricao || ' — ' || x.rotulo
  from baixas b
  join titulos t on t.id = b.titulo_id
  left join vw_categorias_sistema cs on cs.organizacao_id = b.organizacao_id
  cross join lateral (values
    (case when t.tipo = 'pagar' then 'despesa_financeira' else 'receita_financeira' end,
     case when t.tipo = 'pagar' then cs.juros_multas_pagos else cs.juros_multas_recebidos end, b.juros + b.multa, 'juros/multa'),
    (case when t.tipo = 'pagar' then 'receita_financeira' else 'despesa_financeira' end,
     case when t.tipo = 'pagar' then cs.descontos_obtidos else cs.descontos_financeiros end, b.desconto, 'desconto')
  ) as x(grupo, categoria_id, valor, rotulo)
 where x.valor <> 0
union all
-- 5) Depreciação (sem efeito caixa)
select dp.organizacao_id, dp.empresa_id, null::uuid, (date_trunc('month', dp.inicio) + make_interval(months => k))::date,
       'depreciacao'::dre_grupo, cs.depreciacao, dp.valor_mensal, 'depreciacao', dp.id, dp.descricao
  from depreciacoes dp
  left join vw_categorias_sistema cs on cs.organizacao_id = dp.organizacao_id
  cross join generate_series(0, dp.meses - 1) k;

-- Bucket de período
create or replace function fn_bucket(p_data date, p_gran text, p_ini date) returns date
language sql immutable as $$
  select case p_gran
    when 'dia' then p_data
    when 'semana' then date_trunc('week', p_data)::date
    when 'mes' then date_trunc('month', p_data)::date
    when 'trimestre' then date_trunc('quarter', p_data)::date
    when 'ano' then date_trunc('year', p_data)::date
    else p_ini end
$$;

create or replace function fn_periodos(p_ini date, p_fim date, p_gran text) returns setof date
language sql immutable as $$
  select distinct fn_bucket(d::date, p_gran, p_ini)
    from generate_series(p_ini, p_fim, interval '1 day') d
   order by 1
$$;

/*
  Linhas da DRE (com rateio por canal quando p_canal informado).
  Retorna base ponderada; usada por fn_dre, drill-down e IA (mesma lógica).
*/
create or replace function fn_dre_fatos(p_org uuid, p_empresas uuid[], p_ini date, p_fim date, p_canal uuid default null)
returns table (empresa_id uuid, canal_id uuid, data date, grupo dre_grupo, categoria_id uuid, valor numeric,
               peso numeric, origem text, origem_id uuid, descricao text)
language sql stable as $$
  with base as (
    select * from vw_dre_base b
     where b.organizacao_id = p_org and b.data between p_ini and p_fim
       and (p_empresas is null or b.empresa_id = any(p_empresas))
  ), fator as (
    select b.empresa_id, date_trunc('month', b.data)::date as mes,
      case when o.rateio_modo = 'manual' then coalesce(cv.rateio_percentual, 0) / 100
           else coalesce(sum(b.valor) filter (where b.grupo = 'receita_bruta' and b.canal_id = p_canal), 0)
                / nullif(sum(b.valor) filter (where b.grupo = 'receita_bruta' and b.canal_id is not null), 0) end as f
      from base b
      join organizacoes o on o.id = p_org
      left join canais_venda cv on cv.id = p_canal
     where p_canal is not null
     group by b.empresa_id, date_trunc('month', b.data), o.rateio_modo, cv.rateio_percentual
  )
  select b.empresa_id, b.canal_id, b.data, b.grupo, b.categoria_id,
         round(b.valor * w.peso, 2), w.peso, b.origem, b.origem_id, b.descricao
    from base b
    left join fator f on f.empresa_id = b.empresa_id and f.mes = date_trunc('month', b.data)
    cross join lateral (select case when p_canal is null or b.canal_id = p_canal then 1::numeric
                                    when b.canal_id is null then coalesce(f.f, 0) else 0 end as peso) w
   where w.peso <> 0
$$;

create or replace function fn_dre(p_org uuid, p_empresas uuid[], p_ini date, p_fim date,
                                  p_gran text default 'mes', p_canal uuid default null)
returns table (periodo date, receita_bruta numeric, deducoes_impostos numeric, deducoes_devolucoes numeric,
  receita_liquida numeric, cmv numeric, lucro_bruto numeric, despesa_variavel numeric, margem_contribuicao numeric,
  despesa_fixa numeric, ebitda numeric, depreciacao numeric, receita_financeira numeric, despesa_financeira numeric,
  resultado_financeiro numeric, lair numeric, impostos_lucro numeric, lucro_liquido numeric)
language sql stable as $$
  with g as (
    select fn_bucket(f.data, p_gran, p_ini) as periodo,
      coalesce(sum(valor) filter (where grupo = 'receita_bruta'),0) rb,
      coalesce(sum(valor) filter (where grupo = 'deducoes_impostos'),0) di,
      coalesce(sum(valor) filter (where grupo = 'deducoes_devolucoes'),0) dd,
      coalesce(sum(valor) filter (where grupo = 'cmv'),0) cmv,
      coalesce(sum(valor) filter (where grupo = 'despesa_variavel'),0) dv,
      coalesce(sum(valor) filter (where grupo = 'despesa_fixa'),0) df,
      coalesce(sum(valor) filter (where grupo = 'depreciacao'),0) dep,
      coalesce(sum(valor) filter (where grupo = 'receita_financeira'),0) rf,
      coalesce(sum(valor) filter (where grupo = 'despesa_financeira'),0) dfin,
      coalesce(sum(valor) filter (where grupo = 'impostos_lucro'),0) il
    from fn_dre_fatos(p_org, p_empresas, p_ini, p_fim, p_canal) f
    group by 1
  )
  select p.periodo, coalesce(rb,0), coalesce(di,0), coalesce(dd,0),
    coalesce(rb - di - dd, 0),
    coalesce(cmv,0), coalesce(rb - di - dd - cmv, 0),
    coalesce(dv,0), coalesce(rb - di - dd - cmv - dv, 0),
    coalesce(df,0), coalesce(rb - di - dd - cmv - dv - df, 0),
    coalesce(dep,0), coalesce(rf,0), coalesce(dfin,0), coalesce(rf - dfin, 0),
    coalesce(rb - di - dd - cmv - dv - df - dep + rf - dfin, 0),
    coalesce(il,0),
    coalesce(rb - di - dd - cmv - dv - df - dep + rf - dfin - il, 0)
  from fn_periodos(p_ini, p_fim, p_gran) p(periodo)
  left join g on g.periodo = p.periodo
  order by p.periodo
$$;

-- DRE por categoria (para expandir linhas e comparar com orçamento)
create or replace function fn_dre_categorias(p_org uuid, p_empresas uuid[], p_ini date, p_fim date,
                                             p_gran text default 'mes', p_canal uuid default null)
returns table (periodo date, grupo dre_grupo, categoria_id uuid, categoria text, valor numeric, orcado numeric)
language sql stable as $$
  with r as (
    select fn_bucket(f.data, p_gran, p_ini) periodo, f.grupo, f.categoria_id, sum(f.valor) valor
      from fn_dre_fatos(p_org, p_empresas, p_ini, p_fim, p_canal) f group by 1,2,3
  ), o as (
    select fn_bucket(o.competencia, p_gran, p_ini) periodo, pc.dre_grupo grupo, o.categoria_id, sum(o.valor) orcado
      from orcamentos o join plano_contas pc on pc.id = o.categoria_id
     where o.organizacao_id = p_org and o.competencia between date_trunc('month', p_ini) and p_fim
       and (p_empresas is null or o.empresa_id = any(p_empresas)) and p_canal is null
     group by 1,2,3
  )
  select coalesce(r.periodo, o.periodo), coalesce(r.grupo, o.grupo), coalesce(r.categoria_id, o.categoria_id),
         coalesce(pc.nome, '(sem categoria)'), coalesce(r.valor, 0), o.orcado
    from r full join o on o.periodo = r.periodo and o.categoria_id is not distinct from r.categoria_id and o.grupo = r.grupo
    left join plano_contas pc on pc.id = coalesce(r.categoria_id, o.categoria_id)
   order by 1, 2, 5 desc
$$;

-- Drill-down: lançamentos que formam um grupo/categoria da DRE
create or replace function fn_dre_lancamentos(p_org uuid, p_empresas uuid[], p_ini date, p_fim date,
  p_grupos dre_grupo[] default null, p_categoria uuid default null, p_canal uuid default null)
returns table (data date, grupo dre_grupo, categoria text, descricao text, valor numeric, peso numeric,
               origem text, origem_id uuid, empresa_id uuid, canal text)
language sql stable as $$
  select f.data, f.grupo, pc.nome, f.descricao, f.valor, f.peso, f.origem, f.origem_id, f.empresa_id, cv.nome
    from fn_dre_fatos(p_org, p_empresas, p_ini, p_fim, p_canal) f
    left join plano_contas pc on pc.id = f.categoria_id
    left join canais_venda cv on cv.id = f.canal_id
   where (p_grupos is null or f.grupo = any(p_grupos))
     and (p_categoria is null or f.categoria_id = p_categoria)
   order by f.data, f.descricao
$$;

-- ---------------------------------------------------------------------
-- Caixa
-- ---------------------------------------------------------------------
create or replace view vw_movimentos_classificados with (security_invoker = true) as
select m.organizacao_id, m.empresa_id, m.conta_bancaria_id, m.data, m.valor, m.descricao, m.tipo, m.conciliado,
       m.id as movimento_id, b.titulo_id, t.categoria_id, t.tipo as titulo_tipo,
       case when m.tipo = 'transferencia' then 'transferencia'
            when pc.dfc_grupo = 'nao_dfc' or pc.dfc_grupo is null then 'operacional'
            else pc.dfc_grupo::text end as dfc_grupo
  from movimentos m
  left join baixas b on b.id = m.baixa_id
  left join titulos t on t.id = b.titulo_id
  left join plano_contas pc on pc.id = t.categoria_id;

-- Saldo de cada conta ao final de uma data
create or replace function fn_saldos_contas(p_org uuid, p_empresas uuid[], p_data date default current_date)
returns table (conta_bancaria_id uuid, empresa_id uuid, nome text, tipo text, saldo numeric)
language sql stable as $$
  select cb.id, cb.empresa_id, cb.nome, cb.tipo,
         case when cb.data_saldo_inicial <= p_data then cb.saldo_inicial else 0 end
         + coalesce((select sum(m.valor) from movimentos m where m.conta_bancaria_id = cb.id and m.data <= p_data), 0)
    from contas_bancarias cb
   where cb.organizacao_id = p_org and (p_empresas is null or cb.empresa_id = any(p_empresas)) and cb.ativo
   order by cb.nome
$$;

create or replace function fn_saldo_total(p_org uuid, p_empresas uuid[], p_data date) returns numeric
language sql stable as $$
  select coalesce(sum(case when cb.data_saldo_inicial <= p_data then cb.saldo_inicial else 0 end), 0)
       + coalesce((select sum(m.valor) from movimentos m
                    where m.organizacao_id = p_org and m.data <= p_data
                      and (p_empresas is null or m.empresa_id = any(p_empresas))), 0)
    from contas_bancarias cb
   where cb.organizacao_id = p_org and (p_empresas is null or cb.empresa_id = any(p_empresas))
$$;

-- DFC método direto: resumo por período, conciliado com os saldos bancários
create or replace function fn_dfc(p_org uuid, p_empresas uuid[], p_ini date, p_fim date, p_gran text default 'mes')
returns table (periodo date, periodo_fim date, saldo_inicial numeric,
  operacional_entradas numeric, operacional_saidas numeric, operacional numeric,
  investimento numeric, financiamento numeric, saldos_iniciais_novas_contas numeric,
  variacao numeric, saldo_final numeric, saldo_bancario_final numeric)
language sql stable as $$
  with per as (
    select p as periodo,
      least(p_fim, case p_gran when 'dia' then p when 'semana' then p + 6
            when 'mes' then (p + interval '1 month - 1 day')::date
            when 'trimestre' then (p + interval '3 months - 1 day')::date
            when 'ano' then (p + interval '1 year - 1 day')::date else p_fim end) as fim
      from fn_periodos(p_ini, p_fim, p_gran) p
  ), mov as (
    select fn_bucket(m.data, p_gran, p_ini) periodo, m.dfc_grupo, m.valor
      from vw_movimentos_classificados m
     where m.organizacao_id = p_org and m.data between p_ini and p_fim
       and (p_empresas is null or m.empresa_id = any(p_empresas)) and m.dfc_grupo <> 'transferencia'
  ), agg as (
    select periodo,
      coalesce(sum(valor) filter (where dfc_grupo = 'operacional' and valor > 0),0) oe,
      coalesce(-sum(valor) filter (where dfc_grupo = 'operacional' and valor < 0),0) os,
      coalesce(sum(valor) filter (where dfc_grupo = 'investimento'),0) inv,
      coalesce(sum(valor) filter (where dfc_grupo = 'financiamento'),0) fin
      from mov group by periodo
  )
  select per.periodo, per.fim,
    fn_saldo_total(p_org, p_empresas, (greatest(per.periodo, p_ini) - 1)),
    coalesce(a.oe,0), coalesce(a.os,0), coalesce(a.oe - a.os,0), coalesce(a.inv,0), coalesce(a.fin,0),
    coalesce((select sum(cb.saldo_inicial) from contas_bancarias cb
               where cb.organizacao_id = p_org and (p_empresas is null or cb.empresa_id = any(p_empresas))
                 and cb.data_saldo_inicial between greatest(per.periodo, p_ini) and per.fim), 0),
    coalesce(a.oe - a.os + a.inv + a.fin, 0),
    fn_saldo_total(p_org, p_empresas, (greatest(per.periodo, p_ini) - 1))
      + coalesce(a.oe - a.os + a.inv + a.fin, 0)
      + coalesce((select sum(cb.saldo_inicial) from contas_bancarias cb
               where cb.organizacao_id = p_org and (p_empresas is null or cb.empresa_id = any(p_empresas))
                 and cb.data_saldo_inicial between greatest(per.periodo, p_ini) and per.fim), 0),
    fn_saldo_total(p_org, p_empresas, per.fim)
  from per left join agg a on a.periodo = per.periodo
  order by per.periodo
$$;

-- DFC detalhada por grupo/categoria
create or replace function fn_dfc_categorias(p_org uuid, p_empresas uuid[], p_ini date, p_fim date, p_gran text default 'mes')
returns table (periodo date, dfc_grupo text, categoria_id uuid, categoria text, entradas numeric, saidas numeric)
language sql stable as $$
  select fn_bucket(m.data, p_gran, p_ini), m.dfc_grupo, m.categoria_id, coalesce(pc.nome,'(sem categoria)'),
         coalesce(sum(m.valor) filter (where m.valor > 0),0), coalesce(-sum(m.valor) filter (where m.valor < 0),0)
    from vw_movimentos_classificados m
    left join plano_contas pc on pc.id = m.categoria_id
   where m.organizacao_id = p_org and m.data between p_ini and p_fim
     and (p_empresas is null or m.empresa_id = any(p_empresas)) and m.dfc_grupo <> 'transferencia'
   group by 1,2,3,4 order by 1,2,4
$$;

-- DFC método indireto (período inteiro), partindo do lucro líquido
create or replace function fn_dfc_indireto(p_org uuid, p_empresas uuid[], p_ini date, p_fim date)
returns table (ordem int, linha text, valor numeric)
language sql stable as $$
  with d as (select * from fn_dre(p_org, p_empresas, p_ini, p_fim, 'total')),
  c as (
    select coalesce(sum(m.valor) filter (where m.dfc_grupo = 'operacional'),0) oper,
           coalesce(-sum(m.valor) filter (where m.dfc_grupo = 'operacional' and pc.dre_grupo = 'nao_dre' and m.valor < 0
                                           and pc.chave_sistema is null and m.titulo_tipo = 'pagar'),0) compras
      from vw_movimentos_classificados m left join plano_contas pc on pc.id = m.categoria_id
     where m.organizacao_id = p_org and m.data between p_ini and p_fim
       and (p_empresas is null or m.empresa_id = any(p_empresas)) and m.dfc_grupo <> 'transferencia'
  )
  select * from (values
    (1, 'Lucro líquido do período', (select lucro_liquido from d)),
    (2, '(+) Depreciação', (select depreciacao from d)),
    (3, '(+) CMV (baixa de estoque, sem efeito caixa)', (select cmv from d)),
    (4, '(−) Pagamentos operacionais fora da DRE (compras de mercadorias e similares)', -(select compras from c)),
    (5, '(±) Variação de capital de giro (recebíveis, contas a pagar, impostos a recolher)',
        (select oper from c) - ((select lucro_liquido + depreciacao + cmv from d) - (select compras from c))),
    (6, '(=) Caixa líquido das atividades operacionais', (select oper from c))
  ) v(ordem, linha, valor)
$$;

-- Fluxo de caixa realizado x previsto + saldo projetado
create or replace function fn_fluxo_caixa(p_org uuid, p_empresas uuid[], p_ini date, p_fim date,
                                          p_gran text default 'dia', p_contas uuid[] default null)
returns table (periodo date, periodo_fim date, realizado_entradas numeric, realizado_saidas numeric,
               previsto_entradas numeric, previsto_saidas numeric, saldo_realizado numeric, saldo_projetado numeric)
language sql stable as $$
  with per as (
    select p as periodo,
      least(p_fim, case p_gran when 'dia' then p when 'semana' then p + 6
            when 'mes' then (p + interval '1 month - 1 day')::date else p_fim end) as fim
      from fn_periodos(p_ini, p_fim, p_gran) p
  ), real as (
    select fn_bucket(m.data, p_gran, p_ini) periodo,
           coalesce(sum(m.valor) filter (where m.valor > 0),0) e, coalesce(-sum(m.valor) filter (where m.valor < 0),0) s
      from movimentos m
     where m.organizacao_id = p_org and m.data between p_ini and p_fim
       and (p_empresas is null or m.empresa_id = any(p_empresas))
       and (case when p_contas is null then m.tipo <> 'transferencia' else m.conta_bancaria_id = any(p_contas) end)
     group by 1
  ), prev as (
    select fn_bucket(t.data_vencimento, p_gran, p_ini) periodo,
           coalesce(sum(t.valor) filter (where t.tipo = 'receber'),0) e, coalesce(sum(t.valor) filter (where t.tipo = 'pagar'),0) s
      from titulos t
     where t.organizacao_id = p_org and t.status <> 'cancelado' and t.data_vencimento between p_ini and p_fim
       and (p_empresas is null or t.empresa_id = any(p_empresas))
     group by 1
  ), abertos as (   -- saldo em aberto com vencidos projetados para hoje
    select greatest(t.data_vencimento, current_date) dv,
           sum(case when t.tipo = 'receber' then t.valor - t.valor_pago else -(t.valor - t.valor_pago) end) v
      from titulos t
     where t.organizacao_id = p_org and t.status in ('aberto','parcial')
       and (p_empresas is null or t.empresa_id = any(p_empresas))
     group by 1
  )
  select per.periodo, per.fim, coalesce(r.e,0), coalesce(r.s,0), coalesce(pv.e,0), coalesce(pv.s,0),
    case when per.periodo <= current_date then
      case when p_contas is null then fn_saldo_total(p_org, p_empresas, least(per.fim, current_date))
           else (select sum(saldo) from fn_saldos_contas(p_org, p_empresas, least(per.fim, current_date))
                  where conta_bancaria_id = any(p_contas)) end
    end,
    case when per.fim >= current_date then
      case when p_contas is null then fn_saldo_total(p_org, p_empresas, current_date)
           else (select sum(saldo) from fn_saldos_contas(p_org, p_empresas, current_date) where conta_bancaria_id = any(p_contas)) end
      + coalesce((select sum(v) from abertos where dv <= per.fim), 0)
    end
  from per
  left join real r on r.periodo = per.periodo
  left join prev pv on pv.periodo = per.periodo
  order by per.periodo
$$;

-- Projeção diária a partir de hoje (alertas, 30/60/90 e base para simulação)
create or replace function fn_projecao_diaria(p_org uuid, p_empresas uuid[], p_dias int default 90)
returns table (data date, entradas numeric, saidas numeric, saldo numeric)
language sql stable as $$
  with dias as (select (current_date + k)::date d from generate_series(0, p_dias) k),
  ab as (
    select greatest(t.data_vencimento, current_date) dv,
           sum(t.valor - t.valor_pago) filter (where t.tipo = 'receber') e,
           sum(t.valor - t.valor_pago) filter (where t.tipo = 'pagar') s
      from titulos t
     where t.organizacao_id = p_org and t.status in ('aberto','parcial')
       and (p_empresas is null or t.empresa_id = any(p_empresas))
       and t.data_vencimento <= current_date + p_dias
     group by 1
  )
  select dias.d, coalesce(ab.e,0), coalesce(ab.s,0),
         fn_saldo_total(p_org, p_empresas, current_date)
         + sum(coalesce(ab.e,0) - coalesce(ab.s,0)) over (order by dias.d)
    from dias left join ab on ab.dv = dias.d
   order by dias.d
$$;

-- ---------------------------------------------------------------------
-- Vendas por canal e ranking de produtos (mesma base da DRE)
-- ---------------------------------------------------------------------
create or replace function fn_vendas_por_canal(p_org uuid, p_empresas uuid[], p_ini date, p_fim date)
returns table (canal_id uuid, canal text, pedidos bigint, faturamento_bruto numeric, descontos_devolucoes numeric,
  impostos numeric, receita_liquida numeric, cmv numeric, despesas_variaveis numeric, margem_contribuicao numeric,
  margem_percentual numeric, ticket_medio numeric, participacao numeric, vendas_sem_custo bigint)
language sql stable as $$
  with f as (
    select b.canal_id, b.grupo, sum(b.valor) v from vw_dre_base b
     where b.organizacao_id = p_org and b.data between p_ini and p_fim and b.origem in ('venda','devolucao')
       and (p_empresas is null or b.empresa_id = any(p_empresas))
     group by 1,2
  ), p as (
    select v.canal_id, count(*) n, count(*) filter (where v.cmv_incompleto) sem_custo
      from vendas v
     where v.organizacao_id = p_org and v.status = 'concluida' and v.data_venda between p_ini and p_fim
       and (p_empresas is null or v.empresa_id = any(p_empresas))
     group by 1
  ), x as (
    select cv.id, cv.nome, coalesce(p.n,0) n, coalesce(p.sem_custo,0) sc,
      coalesce(sum(f.v) filter (where f.grupo = 'receita_bruta'),0) rb,
      coalesce(sum(f.v) filter (where f.grupo = 'deducoes_devolucoes'),0) dd,
      coalesce(sum(f.v) filter (where f.grupo = 'deducoes_impostos'),0) di,
      coalesce(sum(f.v) filter (where f.grupo = 'cmv'),0) cmv,
      coalesce(sum(f.v) filter (where f.grupo = 'despesa_variavel'),0) dv
      from canais_venda cv
      left join f on f.canal_id = cv.id
      left join p on p.canal_id = cv.id
     where cv.organizacao_id = p_org
     group by cv.id, cv.nome, p.n, p.sem_custo
  )
  select id, nome, n, rb, dd, di, rb - dd - di, cmv, dv, rb - dd - di - cmv - dv,
         round(100 * (rb - dd - di - cmv - dv) / nullif(rb - dd - di, 0), 2),
         round(rb / nullif(n, 0), 2),
         round(100 * rb / nullif(sum(rb) over (), 0), 2), sc
    from x where n > 0 or rb <> 0
   order by rb desc
$$;

create or replace function fn_ranking_produtos(p_org uuid, p_empresas uuid[], p_ini date, p_fim date,
                                               p_canal uuid default null, p_limite int default 20)
returns table (produto_id uuid, produto text, quantidade numeric, receita numeric, cmv numeric,
               margem numeric, margem_percentual numeric, sem_custo boolean)
language sql stable as $$
  select vi.produto_id, coalesce(pr.nome, min(vi.descricao)), sum(vi.quantidade),
         sum(round(vi.quantidade * vi.preco_unitario, 2) - vi.desconto),
         sum(round(vi.quantidade * coalesce(vi.custo_unitario, 0), 2)),
         sum(round(vi.quantidade * vi.preco_unitario, 2) - vi.desconto - round(vi.quantidade * coalesce(vi.custo_unitario,0), 2)),
         round(100 * sum(round(vi.quantidade * vi.preco_unitario, 2) - vi.desconto - round(vi.quantidade * coalesce(vi.custo_unitario,0), 2))
               / nullif(sum(round(vi.quantidade * vi.preco_unitario, 2) - vi.desconto), 0), 2),
         bool_or(vi.custo_unitario is null)
    from venda_itens vi
    join vendas v on v.id = vi.venda_id and v.status = 'concluida'
    left join produtos pr on pr.id = vi.produto_id
   where v.organizacao_id = p_org and v.data_venda between p_ini and p_fim
     and (p_empresas is null or v.empresa_id = any(p_empresas))
     and (p_canal is null or v.canal_id = p_canal)
   group by vi.produto_id, pr.nome, case when vi.produto_id is null then vi.descricao end
   order by 4 desc
   limit p_limite
$$;

-- ---------------------------------------------------------------------
-- Dashboard: todos os indicadores numa chamada, reaproveitando as funções acima
-- ---------------------------------------------------------------------
create or replace function fn_dashboard(p_org uuid, p_empresas uuid[], p_ini date, p_fim date, p_canal uuid default null)
returns jsonb language plpgsql stable as $$
declare
  dias int := p_fim - p_ini + 1;
  atual record; anterior record; ano_ant record;
  v_pedidos bigint; v_meta numeric; v_saldo numeric; res jsonb;
begin
  select * into atual    from fn_dre(p_org, p_empresas, p_ini, p_fim, 'total', p_canal);
  select * into anterior from fn_dre(p_org, p_empresas, p_ini - dias, p_ini - 1, 'total', p_canal);
  select * into ano_ant  from fn_dre(p_org, p_empresas, (p_ini - interval '1 year')::date, (p_fim - interval '1 year')::date, 'total', p_canal);
  select count(*) into v_pedidos from vendas v
   where v.organizacao_id = p_org and v.status = 'concluida' and v.data_venda between p_ini and p_fim
     and (p_empresas is null or v.empresa_id = any(p_empresas)) and (p_canal is null or v.canal_id = p_canal);
  select sum(m.valor) into v_meta from metas m
   where m.organizacao_id = p_org and m.competencia between date_trunc('month', p_ini) and p_fim
     and (p_empresas is null or m.empresa_id = any(p_empresas))
     and (case when p_canal is null then m.canal_id is null else m.canal_id = p_canal end);
  v_saldo := fn_saldo_total(p_org, p_empresas, current_date);

  res := jsonb_build_object(
    'periodo', jsonb_build_object('inicio', p_ini, 'fim', p_fim),
    'dre', to_jsonb(atual), 'dre_anterior', to_jsonb(anterior), 'dre_ano_anterior', to_jsonb(ano_ant),
    'pedidos', v_pedidos,
    'ticket_medio', round(atual.receita_bruta / nullif(v_pedidos,0), 2),
    'margem_bruta_pct', round(100 * atual.lucro_bruto / nullif(atual.receita_liquida,0), 2),
    'margem_contribuicao_pct', round(100 * atual.margem_contribuicao / nullif(atual.receita_liquida,0), 2),
    'margem_liquida_pct', round(100 * atual.lucro_liquido / nullif(atual.receita_liquida,0), 2),
    'ponto_equilibrio', case when atual.margem_contribuicao > 0 and atual.receita_liquida > 0
        then round((atual.despesa_fixa + atual.depreciacao) / (atual.margem_contribuicao / atual.receita_liquida), 2) end,
    'meta', v_meta,
    'meta_pct', round(100 * atual.receita_bruta / nullif(v_meta,0), 2),
    'saldo_atual', v_saldo,
    'saldos_contas', (select coalesce(jsonb_agg(to_jsonb(s)), '[]') from fn_saldos_contas(p_org, p_empresas, current_date) s),
    'projecao', (select jsonb_build_object(
        'd30', (select saldo from fn_projecao_diaria(p_org, p_empresas, 90) where data = current_date + 30),
        'd60', (select saldo from fn_projecao_diaria(p_org, p_empresas, 90) where data = current_date + 60),
        'd90', (select saldo from fn_projecao_diaria(p_org, p_empresas, 90) where data = current_date + 90),
        'menor_saldo', (select min(saldo) from fn_projecao_diaria(p_org, p_empresas, 90)),
        'primeiro_dia_negativo', (select min(data) from fn_projecao_diaria(p_org, p_empresas, 90) where saldo < 0))),
    'contas', (select jsonb_build_object(
        'pagar_7',    coalesce(sum(t.valor - t.valor_pago) filter (where t.tipo='pagar'   and t.data_vencimento between current_date and current_date + 7), 0),
        'pagar_30',   coalesce(sum(t.valor - t.valor_pago) filter (where t.tipo='pagar'   and t.data_vencimento between current_date and current_date + 30), 0),
        'receber_7',  coalesce(sum(t.valor - t.valor_pago) filter (where t.tipo='receber' and t.data_vencimento between current_date and current_date + 7), 0),
        'receber_30', coalesce(sum(t.valor - t.valor_pago) filter (where t.tipo='receber' and t.data_vencimento between current_date and current_date + 30), 0),
        'vencidas_pagar',   coalesce(sum(t.valor - t.valor_pago) filter (where t.tipo='pagar'   and t.data_vencimento < current_date), 0),
        'vencidas_receber', coalesce(sum(t.valor - t.valor_pago) filter (where t.tipo='receber' and t.data_vencimento < current_date), 0),
        'qtd_vencidas', count(*) filter (where t.data_vencimento < current_date))
      from titulos t where t.organizacao_id = p_org and t.status in ('aberto','parcial')
       and (p_empresas is null or t.empresa_id = any(p_empresas))),
    'prazos', (select jsonb_build_object(
        'pmr', round(sum((b.data_pagamento - t.data_emissao) * b.valor_principal) filter (where t.tipo='receber')
                     / nullif(sum(b.valor_principal) filter (where t.tipo='receber'),0), 1),
        'pmp', round(sum((b.data_pagamento - t.data_emissao) * b.valor_principal) filter (where t.tipo='pagar')
                     / nullif(sum(b.valor_principal) filter (where t.tipo='pagar'),0), 1))
      from baixas b join titulos t on t.id = b.titulo_id
     where b.organizacao_id = p_org and b.data_pagamento between p_ini and p_fim
       and (p_empresas is null or t.empresa_id = any(p_empresas))),
    'despesas_categoria', (select coalesce(jsonb_agg(x order by x.valor desc), '[]') from (
        select c.categoria_id, c.categoria, c.grupo, sum(c.valor) valor
          from fn_dre_categorias(p_org, p_empresas, p_ini, p_fim, 'total', p_canal) c
         where c.grupo in ('despesa_variavel','despesa_fixa','despesa_financeira','cmv','deducoes_impostos')
         group by 1,2,3 having sum(c.valor) <> 0 order by 4 desc limit 12) x),
    'endividamento', (select jsonb_build_object(
        'saldo_devedor', coalesce(sum(t.valor - t.valor_pago) filter (where pc.chave_sistema = 'amortizacao_emprestimos'), 0),
        'parcelas_futuras_valor', coalesce(sum(t.valor - t.valor_pago), 0),
        'parcelas_futuras_qtd', count(distinct (t.emprestimo_id, t.parcela_num)))
      from titulos t join plano_contas pc on pc.id = t.categoria_id
     where t.organizacao_id = p_org and t.emprestimo_id is not null and t.tipo = 'pagar' and t.status in ('aberto','parcial')
       and (p_empresas is null or t.empresa_id = any(p_empresas))),
    'canais', (select coalesce(jsonb_agg(to_jsonb(c)), '[]') from fn_vendas_por_canal(p_org, p_empresas, p_ini, p_fim) c),
    'dados_faltantes', jsonb_build_object(
        'vendas_sem_custo', (select count(*) from vendas v where v.organizacao_id = p_org and v.status='concluida'
                               and v.cmv_incompleto and v.data_venda between p_ini and p_fim
                               and (p_empresas is null or v.empresa_id = any(p_empresas))),
        'produtos_sem_custo', (select count(*) from produtos where organizacao_id = p_org and ativo and custo is null),
        'contas_bancarias', (select count(*) from contas_bancarias where organizacao_id = p_org and ativo)),
    'integracoes', (select coalesce(jsonb_agg(jsonb_build_object('provedor', i.provedor, 'empresa_id', i.empresa_id,
                       'status', i.status, 'ultima_sincronizacao', i.ultima_sincronizacao)), '[]')
                      from integracoes i where i.organizacao_id = p_org),
    'ultima_importacao_ofx', (select max(e.created_at) from extratos e where e.organizacao_id = p_org)
  );
  return res;
end $$;

-- Evolução mensal (12 meses): faturamento, lucro, margem, caixa
create or replace function fn_evolucao_mensal(p_org uuid, p_empresas uuid[], p_fim date, p_meses int default 12,
                                              p_canal uuid default null)
returns table (mes date, receita_bruta numeric, lucro_liquido numeric, margem_contribuicao_pct numeric, saldo_caixa numeric)
language sql stable as $$
  select d.periodo, d.receita_bruta, d.lucro_liquido,
         round(100 * d.margem_contribuicao / nullif(d.receita_liquida, 0), 2),
         fn_saldo_total(p_org, p_empresas, least((d.periodo + interval '1 month - 1 day')::date, current_date))
    from fn_dre(p_org, p_empresas, (date_trunc('month', p_fim) - make_interval(months => p_meses - 1))::date,
                (date_trunc('month', p_fim) + interval '1 month - 1 day')::date, 'mes', p_canal) d
$$;
