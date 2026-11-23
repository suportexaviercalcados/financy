/**
 * Testes de integração dos fluxos críticos contra o Supabase local (migrations reais + RLS).
 * Pré-requisito: `npx supabase start` e .env.test.local preenchido (ver README).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { admin, novaOrganizacao, novaConta, novoCanal, novoUsuario, ok, hoje, somaDias, n, type Org } from './helpers'

// Mês fechado de referência para DRE/DFC (no passado, determinístico)
const INI = '2026-09-01'
const FIM = '2026-09-30'

describe('Recebíveis gerados a partir de vendas com taxas', () => {
  let o: Org; let conta: string; let canal: string; let vendaId: string
  beforeAll(async () => {
    o = await novaOrganizacao(6)
    conta = await novaConta(o, 'Banco', 0, '2026-01-01')
    canal = await novoCanal(o, 'Site', { comissao_percentual: 5 })
    ok(await o.client.from('canal_taxas').insert({
      organizacao_id: o.orgId, canal_id: canal, forma_pagamento_id: o.forma('credito'), conta_bancaria_id: conta,
      parcelas_min: 1, parcelas_max: 6, taxa_percentual: 4, taxa_fixa: 0.5, prazo_dias: 30, intervalo_parcelas_dias: 30,
    }))
    vendaId = ok(await o.client.rpc('fn_registrar_venda', { p: {
      organizacao_id: o.orgId, empresa_id: o.empresaId, canal_id: canal, data_venda: '2026-09-10',
      itens: [
        { descricao: 'Tênis', quantidade: 2, preco_unitario: 300, custo_unitario: 120 },
        { descricao: 'Bolsa', quantidade: 1, preco_unitario: 400 },              // sem custo
      ],
      pagamentos: [{ forma_pagamento_id: o.forma('credito'), valor: 1000, parcelas: 3 }],
    } })) as string
  })

  it('calcula taxa, divide parcelas e projeta vencimentos', async () => {
    const tits = ok(await o.client.from('titulos').select('*').eq('venda_id', vendaId).eq('tipo', 'receber')
      .order('data_vencimento')) as any[]
    expect(tits).toHaveLength(3)
    expect(tits.map(t => n(t.valor_bruto))).toEqual([333.33, 333.33, 333.34])
    expect(tits.map(t => n(t.valor_taxa))).toEqual([13.5, 13.5, 13.5])
    expect(tits.map(t => n(t.valor))).toEqual([319.83, 319.83, 319.84])
    expect(tits.map(t => t.data_vencimento)).toEqual(['2026-10-10', '2026-11-09', '2026-12-09'])
    expect(tits.every(t => t.conta_bancaria_prevista_id === conta)).toBe(true)
  })

  it('registra CMV parcial, comissão e marca dado faltante', async () => {
    const v = ok(await o.client.from('vendas').select('*').eq('id', vendaId).single()) as any
    expect(n(v.valor_total)).toBe(1000)
    expect(n(v.cmv)).toBe(240)
    expect(v.cmv_incompleto).toBe(true)
    expect(n(v.valor_taxas_pagamento)).toBe(40.5)
    expect(n(v.valor_comissao)).toBe(50)
    const com = ok(await o.client.from('titulos').select('valor').eq('venda_id', vendaId).eq('tipo', 'pagar')) as any[]
    expect(com.map(c => n(c.valor))).toEqual([50])
  })

  it('PIX com prazo 0 é liquidado na hora e entra no caixa', async () => {
    const loja = await novoCanal(o, 'Loja física')
    ok(await o.client.from('canal_taxas').insert({ organizacao_id: o.orgId, forma_pagamento_id: o.forma('pix'),
      conta_bancaria_id: conta, taxa_percentual: 0, prazo_dias: 0 }))
    const id = ok(await o.client.rpc('fn_registrar_venda', { p: {
      organizacao_id: o.orgId, empresa_id: o.empresaId, canal_id: loja, data_venda: '2026-09-11',
      itens: [{ descricao: 'Meia', quantidade: 3, preco_unitario: 20, custo_unitario: 8 }],
      pagamentos: [{ forma_pagamento_id: o.forma('pix'), valor: 60 }],
    } })) as string
    const t = ok(await o.client.from('titulos').select('status,valor_pago').eq('venda_id', id).single()) as any
    expect(t.status).toBe('pago')
    const saldo = ok(await o.client.rpc('fn_saldo_total', { p_org: o.orgId, p_empresas: null, p_data: '2026-09-30' }))
    expect(n(saldo)).toBe(60)
  })

  it('rejeita pagamentos que não fecham com o total', async () => {
    const r = await o.client.rpc('fn_registrar_venda', { p: {
      organizacao_id: o.orgId, empresa_id: o.empresaId, canal_id: canal, data_venda: '2026-09-12',
      itens: [{ descricao: 'X', quantidade: 1, preco_unitario: 100 }],
      pagamentos: [{ forma_pagamento_id: o.forma('pix'), valor: 90 }] } })
    expect(r.error?.message).toMatch(/difere do total/)
  })
})

describe('DRE, DFC e fluxo de caixa batem entre si', () => {
  let o: Org; let banco: string; let caixa: string; let canal: string
  beforeAll(async () => {
    o = await novaOrganizacao(6)
    banco = await novaConta(o, 'Banco', 10000, '2026-08-31')
    caixa = await novaConta(o, 'Caixa', 500, '2026-08-31')
    canal = await novoCanal(o, 'Loja')
    ok(await o.client.from('canal_taxas').insert({ organizacao_id: o.orgId, forma_pagamento_id: o.forma('debito'),
      conta_bancaria_id: banco, taxa_percentual: 2, prazo_dias: 1 }))
    // Venda: 2.000 em débito (taxa 2% = 40), CMV 800
    const venda = ok(await o.client.rpc('fn_registrar_venda', { p: {
      organizacao_id: o.orgId, empresa_id: o.empresaId, canal_id: canal, data_venda: '2026-09-05',
      itens: [{ descricao: 'Produto', quantidade: 10, preco_unitario: 200, custo_unitario: 80 }],
      pagamentos: [{ forma_pagamento_id: o.forma('debito'), valor: 2000 }] } })) as string
    const rec = ok(await o.client.from('titulos').select('id').eq('venda_id', venda).single()) as any
    ok(await o.client.rpc('fn_baixar_titulo', { p_titulo: rec.id, p_conta: banco, p_data: '2026-09-06', p_valor_principal: 1960 }))
    // Aluguel 1.500 (competência set), pago em atraso com 30 de juros
    const [alug] = ok(await o.client.rpc('fn_criar_titulos', { p: {
      organizacao_id: o.orgId, empresa_id: o.empresaId, tipo: 'pagar', descricao: 'Aluguel setembro',
      categoria_id: o.catCodigo('5.2.1'), valor: 1500, data_vencimento: '2026-09-10', data_competencia: '2026-09-01' } })) as string[]
    ok(await o.client.rpc('fn_baixar_titulo', { p_titulo: alug, p_conta: banco, p_data: '2026-09-15',
      p_valor_principal: 1500, p_juros: 30 }))
    // Compra de mercadoria 700 paga (fora da DRE: CMV vem das vendas)
    const [compra] = ok(await o.client.rpc('fn_criar_titulos', { p: {
      organizacao_id: o.orgId, empresa_id: o.empresaId, tipo: 'pagar', descricao: 'Compra estoque',
      categoria_id: o.catCodigo('3.2'), valor: 700, data_vencimento: '2026-09-20' } })) as string[]
    ok(await o.client.rpc('fn_baixar_titulo', { p_titulo: compra, p_conta: banco, p_data: '2026-09-20', p_valor_principal: 700 }))
    // Energia 300 competência set, ainda em aberto (não afeta caixa)
    ok(await o.client.rpc('fn_criar_titulos', { p: {
      organizacao_id: o.orgId, empresa_id: o.empresaId, tipo: 'pagar', descricao: 'Energia',
      categoria_id: o.catCodigo('5.2.2'), valor: 300, data_vencimento: '2026-10-05', data_competencia: '2026-09-30' } }))
    // Transferência banco -> caixa (não é receita nem despesa)
    ok(await o.client.from('transferencias').insert({ organizacao_id: o.orgId, empresa_id: o.empresaId,
      conta_origem_id: banco, conta_destino_id: caixa, data: '2026-09-25', valor: 1000 }))
    // Aporte de sócios 5.000 (financiamento)
    const [aporte] = ok(await o.client.rpc('fn_criar_titulos', { p: {
      organizacao_id: o.orgId, empresa_id: o.empresaId, tipo: 'receber', descricao: 'Aporte',
      categoria_id: o.catCodigo('9.3'), valor: 5000, data_vencimento: '2026-09-28' } })) as string[]
    ok(await o.client.rpc('fn_baixar_titulo', { p_titulo: aporte, p_conta: banco, p_data: '2026-09-28', p_valor_principal: 5000 }))
  })

  it('DRE em competência com a estrutura completa', async () => {
    const [d] = ok(await o.client.rpc('fn_dre', { p_org: o.orgId, p_empresas: null, p_ini: INI, p_fim: FIM, p_gran: 'total' })) as any[]
    expect(n(d.receita_bruta)).toBe(2000)
    expect(n(d.deducoes_impostos)).toBe(120)        // 6% estimado
    expect(n(d.receita_liquida)).toBe(1880)
    expect(n(d.cmv)).toBe(800)
    expect(n(d.lucro_bruto)).toBe(1080)
    expect(n(d.despesa_variavel)).toBe(40)          // taxa débito
    expect(n(d.margem_contribuicao)).toBe(1040)
    expect(n(d.despesa_fixa)).toBe(1800)            // aluguel + energia (competência)
    expect(n(d.ebitda)).toBe(-760)
    expect(n(d.despesa_financeira)).toBe(30)        // juros por atraso
    expect(n(d.lucro_liquido)).toBe(-790)
  })

  it('DFC direta: saldo inicial + variação = saldo bancário final', async () => {
    const [f] = ok(await o.client.rpc('fn_dfc', { p_org: o.orgId, p_empresas: null, p_ini: INI, p_fim: FIM, p_gran: 'total' })) as any[]
    expect(n(f.saldo_inicial)).toBe(10500)
    expect(n(f.operacional_entradas)).toBe(1960)
    expect(n(f.operacional_saidas)).toBe(1530 + 700)
    expect(n(f.financiamento)).toBe(5000)
    expect(n(f.saldo_final)).toBe(10500 + 1960 - 2230 + 5000)
    expect(n(f.saldo_final)).toBe(n(f.saldo_bancario_final))
  })

  it('DFC indireta parte do lucro líquido e chega ao caixa operacional', async () => {
    const linhas = ok(await o.client.rpc('fn_dfc_indireto', { p_org: o.orgId, p_empresas: null, p_ini: INI, p_fim: FIM })) as any[]
    const get = (i: number) => n(linhas.find(l => l.ordem === i).valor)
    expect(get(1)).toBe(-790)
    expect(get(3)).toBe(800)
    expect(get(4)).toBe(-700)
    expect(get(6)).toBe(1960 - 2230)
    expect(get(1) + get(2) + get(3) + get(4) + get(5)).toBeCloseTo(get(6), 2)
  })

  it('fluxo de caixa: transferência não conta como receita e saldo bate com contas', async () => {
    const dias = ok(await o.client.rpc('fn_fluxo_caixa', { p_org: o.orgId, p_empresas: null, p_ini: INI, p_fim: FIM, p_gran: 'mes' })) as any[]
    expect(dias).toHaveLength(1)
    expect(n(dias[0].realizado_entradas)).toBe(1960 + 5000)
    expect(n(dias[0].realizado_saidas)).toBe(2230)
    const saldos = ok(await o.client.rpc('fn_saldos_contas', { p_org: o.orgId, p_empresas: null, p_data: FIM })) as any[]
    const total = saldos.reduce((s, c) => s + n(c.saldo), 0)
    expect(n(dias[0].saldo_realizado)).toBe(total)
    expect(n(saldos.find(c => c.nome === 'Caixa').saldo)).toBe(1500)
    // por conta (inclui transferência)
    const porConta = ok(await o.client.rpc('fn_fluxo_caixa', { p_org: o.orgId, p_empresas: null, p_ini: INI, p_fim: FIM,
      p_gran: 'mes', p_contas: [caixa] })) as any[]
    expect(n(porConta[0].realizado_entradas)).toBe(1000)
  })

  it('projeção inclui contas em aberto', async () => {
    const proj = ok(await o.client.rpc('fn_projecao_diaria', { p_org: o.orgId, p_empresas: null, p_dias: 30 })) as any[]
    const saldoHoje = n(ok(await o.client.rpc('fn_saldo_total', { p_org: o.orgId, p_empresas: null, p_data: hoje() })))
    // energia (300) vencida em 05/10 é projetada para hoje
    expect(n(proj[0].saldo)).toBeCloseTo(saldoHoje - 300, 2)
  })

  it('drill-down soma exatamente a linha da DRE', async () => {
    const l = ok(await o.client.rpc('fn_dre_lancamentos', { p_org: o.orgId, p_empresas: null, p_ini: INI, p_fim: FIM,
      p_grupos: ['despesa_fixa'] })) as any[]
    expect(l.reduce((s, x) => s + n(x.valor), 0)).toBe(1800)
    expect(l.every(x => x.origem === 'titulo')).toBe(true)
  })

  it('dashboard usa a mesma lógica da DRE', async () => {
    const d = ok(await o.client.rpc('fn_dashboard', { p_org: o.orgId, p_empresas: null, p_ini: INI, p_fim: FIM })) as any
    expect(n(d.dre.lucro_liquido)).toBe(-790)
    expect(n(d.pedidos)).toBe(1)
    expect(n(d.ticket_medio)).toBe(2000)
    expect(n(d.margem_contribuicao_pct)).toBeCloseTo(55.32, 2)
  })
})

describe('Empréstimos — SAC e Price', () => {
  it('Price: parcela constante, saldo zera, juros decrescentes', async () => {
    const o = await novaOrganizacao()
    const c = ok(await o.client.rpc('fn_calc_amortizacao', { p_principal: 10000, p_taxa_mensal_pct: 2, p_n: 12, p_sistema: 'PRICE' })) as any[]
    expect(c).toHaveLength(12)
    expect(n(c[0].parcela)).toBe(945.6)
    expect(n(c[0].juros)).toBe(200)
    expect(c.reduce((s, x) => s + n(x.amortizacao), 0)).toBeCloseTo(10000, 2)
    expect(n(c[11].saldo)).toBe(0)
    expect(n(c[11].juros)).toBeLessThan(n(c[0].juros))
  })

  it('SAC: amortização constante e geração de títulos com juros na DRE e amortização na DFC', async () => {
    const o = await novaOrganizacao()
    const conta = await novaConta(o, 'Banco', 0, '2026-01-01')
    const c = ok(await o.client.rpc('fn_calc_amortizacao', { p_principal: 10000, p_taxa_mensal_pct: 1, p_n: 12, p_sistema: 'SAC' })) as any[]
    expect(n(c[0].amortizacao)).toBe(833.33)
    expect(n(c[0].juros)).toBe(100)
    expect(n(c[11].amortizacao)).toBe(833.37)
    const emp = ok(await o.client.from('emprestimos').insert({
      organizacao_id: o.orgId, empresa_id: o.empresaId, descricao: 'Capital de giro', conta_bancaria_id: conta,
      valor_principal: 10000, taxa_juros_mensal: 1, prazo_meses: 12, sistema: 'SAC',
      data_contratacao: '2026-09-01', data_primeira_parcela: '2026-10-01' }).select('id').single()) as any
    const parcelas = ok(await o.client.from('emprestimo_parcelas').select('*').eq('emprestimo_id', emp.id)) as any[]
    expect(parcelas).toHaveLength(12)
    const tits = ok(await o.client.from('titulos').select('valor,tipo,status').eq('emprestimo_id', emp.id)) as any[]
    expect(tits.filter(t => t.tipo === 'pagar')).toHaveLength(24)
    const [f] = ok(await o.client.rpc('fn_dfc', { p_org: o.orgId, p_empresas: null, p_ini: '2026-09-01', p_fim: '2026-09-30', p_gran: 'total' })) as any[]
    expect(n(f.financiamento)).toBe(10000)
    // juros de outubro aparecem na DRE (despesa financeira), amortização não
    const [d] = ok(await o.client.rpc('fn_dre', { p_org: o.orgId, p_empresas: null, p_ini: '2026-10-01', p_fim: '2026-10-31', p_gran: 'total' })) as any[]
    expect(n(d.despesa_financeira)).toBe(100)
    expect(n(d.lucro_liquido)).toBe(-100)
  })
})

describe('Importação OFX: idempotência e conciliação', () => {
  let o: Org; let conta: string
  const trs = [
    { fitid: 'A1', data: '2026-09-02', valor: -45.9, descricao: 'TARIFA PACOTE SERVICOS', tipo: 'DEBIT' },
    { fitid: 'A2', data: '2026-09-03', valor: -1200, descricao: 'PAG BOLETO FORNECEDOR XYZ', tipo: 'DEBIT' },
    { fitid: 'A3', data: '2026-09-04', valor: 350, descricao: 'PIX RECEBIDO CLIENTE', tipo: 'CREDIT' },
  ]
  beforeAll(async () => {
    o = await novaOrganizacao()
    conta = await novaConta(o, 'Banco', 1000, '2026-09-01')
  })

  it('não duplica: mesmo arquivo e arquivos sobrepostos', async () => {
    const r1 = ok(await o.client.rpc('fn_importar_ofx', { p_conta: conta, p_nome_arquivo: 'set.ofx', p_hash: 'h1',
      p_meta: { saldo_final: 104.1, data_saldo: '2026-09-04' }, p_transacoes: trs })) as any
    expect(r1).toMatchObject({ novas: 3, duplicadas: 0, ja_importado: false })
    const r2 = ok(await o.client.rpc('fn_importar_ofx', { p_conta: conta, p_nome_arquivo: 'set.ofx', p_hash: 'h1',
      p_meta: {}, p_transacoes: trs })) as any
    expect(r2.ja_importado).toBe(true)
    const r3 = ok(await o.client.rpc('fn_importar_ofx', { p_conta: conta, p_nome_arquivo: 'set2.ofx', p_hash: 'h2',
      p_meta: {}, p_transacoes: [...trs, { fitid: 'A4', data: '2026-09-05', valor: -10, descricao: 'IOF', tipo: 'DEBIT' }] })) as any
    expect(r3).toMatchObject({ novas: 1, duplicadas: 3 })
    const count = (await o.client.from('transacoes_bancarias').select('id', { count: 'exact', head: true }).eq('conta_bancaria_id', conta)).count
    expect(count).toBe(4)
  })

  it('regra cria lançamento e concilia; sugestão casa título; desfazer volta a pendente', async () => {
    ok(await o.client.from('regras_conciliacao').insert({ organizacao_id: o.orgId, nome: 'Tarifas',
      descricao_contem: 'TARIFA', sentido: 'saida', categoria_id: o.catCodigo('6.4') }))
    expect(ok(await o.client.rpc('fn_aplicar_regras', { p_conta: conta }))).toBe(1)
    const [boleto] = ok(await o.client.rpc('fn_criar_titulos', { p: { organizacao_id: o.orgId, empresa_id: o.empresaId,
      tipo: 'pagar', descricao: 'Fornecedor XYZ NF 123', categoria_id: o.catCodigo('3.2'), valor: 1200, data_vencimento: '2026-09-03' } })) as string[]
    const sug = ok(await o.client.rpc('fn_sugestoes_conciliacao', { p_conta: conta })) as any[]
    const tr2 = ok(await o.client.from('transacoes_bancarias').select('id').eq('fitid', 'A2').eq('conta_bancaria_id', conta).single()) as any
    const s = sug.find(x => x.transacao_id === tr2.id)
    expect(s).toMatchObject({ alvo_tipo: 'titulo', alvo_id: boleto })
    ok(await o.client.rpc('fn_conciliar_titulo', { p_transacao: tr2.id, p_titulo: boleto }))
    const t = ok(await o.client.from('titulos').select('status').eq('id', boleto).single()) as any
    expect(t.status).toBe('pago')
    const st = ok(await o.client.from('transacoes_bancarias').select('status').eq('id', tr2.id).single()) as any
    expect(st.status).toBe('conciliada')
    // conciliar de novo falha
    const again = await o.client.rpc('fn_conciliar_titulo', { p_transacao: tr2.id, p_titulo: boleto })
    expect(again.error).toBeTruthy()
    // baixa conciliada não pode ser estornada
    const del = await o.client.from('baixas').delete().eq('titulo_id', boleto)
    expect(del.error?.message).toMatch(/conciliada/)
    ok(await o.client.rpc('fn_desfazer_conciliacao', { p_transacao: tr2.id }))
    const st2 = ok(await o.client.from('transacoes_bancarias').select('status').eq('id', tr2.id).single()) as any
    expect(st2.status).toBe('pendente')
    const resumo = ok(await o.client.rpc('fn_resumo_conciliacao', { p_conta: conta })) as any
    expect(n(resumo.saldo_extrato)).toBe(104.1)
  })
})

describe('Idempotência da importação Bling', () => {
  it('reimportar o mesmo pedido/conta não duplica', async () => {
    const o = await novaOrganizacao()
    const canal = await novoCanal(o, 'Bling Loja')
    const p = { organizacao_id: o.orgId, empresa_id: o.empresaId, canal_id: canal, data_venda: '2026-09-10',
      origem: 'bling', external_id: '987654', itens: [{ descricao: 'Item', quantidade: 1, preco_unitario: 50 }],
      pagamentos: [{ forma_pagamento_id: o.forma('boleto'), valor: 50, data_vencimento: '2026-09-20' }] }
    // via service_role, como a Edge Function
    const a = ok(await admin.rpc('fn_registrar_venda', { p })) as string
    const b = ok(await admin.rpc('fn_registrar_venda', { p })) as string
    expect(a).toBe(b)
    const c = (await admin.from('vendas').select('id', { count: 'exact', head: true }).eq('organizacao_id', o.orgId)).count
    expect(c).toBe(1)
    const row = { organizacao_id: o.orgId, empresa_id: o.empresaId, tipo: 'pagar', descricao: 'Conta Bling', categoria_id: o.catCodigo('5.3.4'),
      valor: 99, data_vencimento: '2026-09-30', data_competencia: '2026-09-30', origem: 'bling', external_id: 'CP-1' }
    ok(await admin.from('titulos').upsert(row, { onConflict: 'organizacao_id,origem,external_id' }))
    ok(await admin.from('titulos').upsert({ ...row, valor: 120 }, { onConflict: 'organizacao_id,origem,external_id' }))
    const tits = ok(await admin.from('titulos').select('valor').eq('organizacao_id', o.orgId).eq('external_id', 'CP-1')) as any[]
    expect(tits).toHaveLength(1)
    expect(n(tits[0].valor)).toBe(120)
  })
})

describe('Isolamento entre organizações (RLS)', () => {
  let a: Org; let b: Org; let contaA: string
  beforeAll(async () => {
    a = await novaOrganizacao(); b = await novaOrganizacao()
    contaA = await novaConta(a, 'Banco A', 777, '2026-01-01')
    ok(await a.client.rpc('fn_criar_titulos', { p: { organizacao_id: a.orgId, empresa_id: a.empresaId, tipo: 'pagar',
      descricao: 'Segredo A', categoria_id: a.catCodigo('5.3.4'), valor: 123, data_vencimento: '2026-09-10' } }))
  })

  it('B não lê dados de A', async () => {
    for (const t of ['titulos', 'empresas', 'contas_bancarias', 'plano_contas', 'membros', 'organizacoes', 'audit_log']) {
      const col = t === 'organizacoes' ? 'id' : 'organizacao_id'
      const r = ok(await b.client.from(t).select('*').eq(col, a.orgId)) as any[]
      expect(r, t).toHaveLength(0)
    }
    const saldo = ok(await b.client.rpc('fn_saldo_total', { p_org: a.orgId, p_empresas: null, p_data: '2026-12-31' }))
    expect(n(saldo)).toBe(0)
    const [d] = ok(await b.client.rpc('fn_dre', { p_org: a.orgId, p_empresas: null, p_ini: INI, p_fim: FIM, p_gran: 'total' })) as any[]
    expect(n(d.despesa_fixa)).toBe(0)
  })

  it('B não grava em A nem referencia cadastros de A', async () => {
    const r1 = await b.client.from('titulos').insert({ organizacao_id: a.orgId, empresa_id: a.empresaId, tipo: 'pagar',
      descricao: 'Invasão', categoria_id: a.catCodigo('5.3.4'), valor: 1, data_vencimento: '2026-09-10', data_competencia: '2026-09-10' })
    expect(r1.error).toBeTruthy()
    const r2 = await b.client.from('titulos').insert({ organizacao_id: b.orgId, empresa_id: b.empresaId, tipo: 'pagar',
      descricao: 'Ref cruzada', categoria_id: a.catCodigo('5.3.4'), valor: 1, data_vencimento: '2026-09-10', data_competencia: '2026-09-10' })
    expect(r2.error).toBeTruthy()  // FK composta (categoria de outra organização)
    const r3 = await b.client.rpc('fn_registrar_venda', { p: { organizacao_id: a.orgId, empresa_id: a.empresaId,
      canal_id: a.orgId, data_venda: '2026-09-10', itens: [{ descricao: 'x', quantidade: 1, preco_unitario: 1 }],
      pagamentos: [{ forma_pagamento_id: a.forma('pix'), valor: 1 }] } })
    expect(r3.error?.message).toMatch(/permissão/)
    const r4 = await b.client.rpc('fn_importar_ofx', { p_conta: contaA, p_nome_arquivo: 'x', p_hash: 'x', p_meta: {}, p_transacoes: [] })
    expect(r4.error).toBeTruthy()
    const r5 = ok(await b.client.from('organizacoes').update({ nome: 'hackeada' }).eq('id', a.orgId).select()) as any[]
    expect(r5).toHaveLength(0)
  })

  it('visualizador lê mas não grava; não pode alterar plano', async () => {
    const v = await novoUsuario('viewer')
    ok(await a.client.from('convites').insert({ organizacao_id: a.orgId, email: v.email, papel: 'visualizador' }))
    const conv = ok(await v.client.rpc('fn_meus_convites')) as any[]
    ok(await v.client.rpc('fn_aceitar_convite', { p_token: conv[0].token }))
    const lidos = ok(await v.client.from('titulos').select('id').eq('organizacao_id', a.orgId)) as any[]
    expect(lidos.length).toBeGreaterThan(0)
    const w = await v.client.from('titulos').insert({ organizacao_id: a.orgId, empresa_id: a.empresaId, tipo: 'pagar',
      descricao: 'x', categoria_id: a.catCodigo('5.3.4'), valor: 1, data_vencimento: '2026-09-10', data_competencia: '2026-09-10' })
    expect(w.error).toBeTruthy()
    const up = await a.client.from('organizacoes').update({ plano_id: 'empresarial' }).eq('id', a.orgId)
    expect(up.error).toBeTruthy()   // coluna protegida mesmo para o proprietário
  })

  it('convite não altera o papel de quem já é membro', async () => {
    ok(await a.client.from('convites').insert({ organizacao_id: a.orgId, email: a.email, papel: 'visualizador' }))
    const conv = ok(await a.client.rpc('fn_meus_convites')) as any[]
    ok(await a.client.rpc('fn_aceitar_convite', { p_token: conv[0].token }))
    const m = ok(await a.client.from('membros').select('papel').eq('organizacao_id', a.orgId).eq('user_id', a.userId).single()) as any
    expect(m.papel).toBe('proprietario')
  })

  it('callback OAuth do Bling só é aceito pelo usuário que iniciou o fluxo', async () => {
    const integ = ok(await admin.from('integracoes').insert({ organizacao_id: a.orgId, empresa_id: a.empresaId }).select('id').single()) as any
    ok(await admin.from('oauth_states').insert({ state: 'st-teste-' + a.orgId, integracao_id: integ.id, user_id: a.userId }))
    const r = await b.client.functions.invoke('bling-oauth', { body: { action: 'callback', code: 'x', state: 'st-teste-' + a.orgId } })
    expect((r.error as any)?.context?.status).toBe(403)
    const estado = ok(await admin.from('oauth_states').select('state').eq('integracao_id', integ.id)) as any[]
    expect(estado).toHaveLength(1)   // não foi consumido pelo atacante
    const tokens = ok(await admin.from('integracao_tokens').select('integracao_id').eq('integracao_id', integ.id)) as any[]
    expect(tokens).toHaveLength(0)
  })

  it('visualizador não grava sugestões de IA', async () => {
    const v = await novoUsuario('viewer2')
    ok(await a.client.from('convites').insert({ organizacao_id: a.orgId, email: v.email, papel: 'visualizador' }))
    const conv = ok(await v.client.rpc('fn_meus_convites')) as any[]
    ok(await v.client.rpc('fn_aceitar_convite', { p_token: conv[0].token }))
    const r = await v.client.functions.invoke('ai-assistant', { body: { acao: 'categorizar', organizacao_id: a.orgId, ids: [] } })
    expect((r.error as any)?.context?.status).toBe(403)   // perfil somente leitura
    const ins = await v.client.from('ia_sugestoes').insert({ organizacao_id: a.orgId, tipo: 'categoria', alvo_tabela: 'titulos',
      alvo_id: a.orgId, sugestao: {}, confianca: 1 })
    expect(ins.error).toBeTruthy()
  })

  it('valor pago e status só mudam por baixa', async () => {
    const [t] = ok(await a.client.rpc('fn_criar_titulos', { p: { organizacao_id: a.orgId, empresa_id: a.empresaId,
      tipo: 'pagar', descricao: 'Teste', categoria_id: a.catCodigo('5.3.4'), valor: 50, data_vencimento: '2026-09-10' } })) as string[]
    const r = await a.client.from('titulos').update({ valor_pago: 50, status: 'pago' }).eq('id', t)
    expect(r.error?.message).toMatch(/calculado pelas baixas/)
    const m = await a.client.from('movimentos').insert({ organizacao_id: a.orgId, empresa_id: a.empresaId,
      conta_bancaria_id: contaA, data: '2026-09-10', valor: 1000000, descricao: 'fraude', tipo: 'baixa' })
    expect(m.error).toBeTruthy()
  })
})

describe('Concorrência e fechamento de período', () => {
  it('baixas concorrentes não excedem o saldo do título', async () => {
    const o = await novaOrganizacao()
    const conta = await novaConta(o, 'Banco', 0, '2026-01-01')
    const [t] = ok(await o.client.rpc('fn_criar_titulos', { p: { organizacao_id: o.orgId, empresa_id: o.empresaId,
      tipo: 'pagar', descricao: 'Fornecedor', categoria_id: o.catCodigo('5.3.4'), valor: 100, data_vencimento: '2026-09-10' } })) as string[]
    const res = await Promise.all([1, 2, 3].map(() =>
      o.client.rpc('fn_baixar_titulo', { p_titulo: t, p_conta: conta, p_data: '2026-09-10', p_valor_principal: 60 })))
    expect(res.filter(r => !r.error)).toHaveLength(1)
    const tit = ok(await o.client.from('titulos').select('valor_pago,status').eq('id', t).single()) as any
    expect(n(tit.valor_pago)).toBe(60)
    expect(tit.status).toBe('parcial')
    // idempotência de baixa
    const k1 = ok(await o.client.rpc('fn_baixar_titulo', { p_titulo: t, p_conta: conta, p_data: '2026-09-11', p_valor_principal: 10, p_idempotency_key: 'k' }))
    const k2 = ok(await o.client.rpc('fn_baixar_titulo', { p_titulo: t, p_conta: conta, p_data: '2026-09-11', p_valor_principal: 10, p_idempotency_key: 'k' }))
    expect(k1).toBe(k2)
  })

  it('período fechado bloqueia edição e reabertura fica registrada', async () => {
    const o = await novaOrganizacao()
    ok(await o.client.from('periodos_fechados').insert({ organizacao_id: o.orgId, empresa_id: o.empresaId, competencia: '2026-08-01' }))
    const r = await o.client.rpc('fn_criar_titulos', { p: { organizacao_id: o.orgId, empresa_id: o.empresaId, tipo: 'pagar',
      descricao: 'Retroativo', categoria_id: o.catCodigo('5.3.4'), valor: 10, data_vencimento: '2026-08-15' } })
    expect(r.error?.message).toMatch(/fechado/)
    ok(await o.client.rpc('fn_reabrir_periodo', { p_empresa: o.empresaId, p_competencia: '2026-08-01', p_motivo: 'Ajuste de nota atrasada' }))
    ok(await o.client.rpc('fn_criar_titulos', { p: { organizacao_id: o.orgId, empresa_id: o.empresaId, tipo: 'pagar',
      descricao: 'Retroativo', categoria_id: o.catCodigo('5.3.4'), valor: 10, data_vencimento: '2026-08-15' } }))
    const reab = ok(await o.client.from('periodos_reaberturas').select('motivo').eq('organizacao_id', o.orgId)) as any[]
    expect(reab).toHaveLength(1)
  })

  it('recorrências geram títulos sem duplicar', async () => {
    const o = await novaOrganizacao()
    ok(await o.client.from('recorrencias').insert({ organizacao_id: o.orgId, empresa_id: o.empresaId, tipo: 'pagar',
      descricao: 'Aluguel', categoria_id: o.catCodigo('5.2.1'), valor: 2000, dia_vencimento: 31,
      data_inicio: '2026-01-01', data_fim: '2026-04-30' }))
    const g1 = ok(await o.client.rpc('fn_gerar_recorrencias', { p_ate: '2026-12-31' }))
    const g2 = ok(await o.client.rpc('fn_gerar_recorrencias', { p_ate: '2026-12-31' }))
    expect(g1).toBe(4); expect(g2).toBe(0)
    const tits = ok(await o.client.from('titulos').select('data_vencimento').eq('organizacao_id', o.orgId).order('data_vencimento')) as any[]
    expect(tits.map(t => t.data_vencimento)).toEqual(['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30'])
  })
})

describe('Devoluções', () => {
  it('reduz receita, estorna CMV e gera reembolso', async () => {
    const o = await novaOrganizacao(0)
    const canal = await novoCanal(o, 'Loja')
    const v = ok(await o.client.rpc('fn_registrar_venda', { p: { organizacao_id: o.orgId, empresa_id: o.empresaId, canal_id: canal,
      data_venda: '2026-09-10', itens: [{ descricao: 'A', quantidade: 2, preco_unitario: 100, custo_unitario: 40 }],
      pagamentos: [{ forma_pagamento_id: o.forma('boleto'), valor: 200, data_vencimento: '2026-09-20' }] } })) as string
    ok(await o.client.from('devolucoes').insert({ organizacao_id: o.orgId, venda_id: v, data: '2026-09-15', valor: 100, custo_devolvido: 40 }))
    const [d] = ok(await o.client.rpc('fn_dre', { p_org: o.orgId, p_empresas: null, p_ini: INI, p_fim: FIM, p_gran: 'total' })) as any[]
    expect(n(d.receita_liquida)).toBe(100)
    expect(n(d.cmv)).toBe(40)
    const reemb = ok(await o.client.from('titulos').select('valor').eq('origem', 'devolucao').eq('venda_id', v)) as any[]
    expect(n(reemb[0].valor)).toBe(100)
    const excesso = await o.client.from('devolucoes').insert({ organizacao_id: o.orgId, venda_id: v, data: '2026-09-16', valor: 150 })
    expect(excesso.error?.message).toMatch(/excede/)
  })
})

// silencia variável utilitária não usada em alguns cenários
void somaDias
