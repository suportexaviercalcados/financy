/**
 * Metas de vendedores: o papel 'vendedor' não lê dados financeiros nem a meta de outros,
 * e só vê o próprio andamento em R$ (dos colegas, apenas nome e %).
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { admin, novaOrganizacao, novaConta, novoCanal, novoUsuario, ok, hoje, n, type Org } from './helpers'

const url = process.env.SUPABASE_URL!
const anon = process.env.SUPABASE_ANON_KEY!
const mes = hoje().slice(0, 8) + '01'

async function vendedor(o: Org, nome: string) {
  const u = await novoUsuario('vend')
  ok(await admin.from('membros').insert({ organizacao_id: o.orgId, user_id: u.userId, papel: 'vendedor' }))
  ok(await admin.from('profiles').update({ nome }).eq('user_id', u.userId))
  return u
}

async function venda(o: Org, canal: string, produtos: number, desconto: number, frete: number, vendedorExt: string, forma = 'pix') {
  const id = ok(await o.client.rpc('fn_registrar_venda', { p: {
    organizacao_id: o.orgId, empresa_id: o.empresaId, canal_id: canal, data_venda: hoje(), desconto, frete_cobrado: frete,
    itens: [{ descricao: 'Tênis', quantidade: 1, preco_unitario: produtos }],
    pagamentos: [{ forma_pagamento_id: o.forma(forma), valor: produtos - desconto + frete }],
  } })) as string
  ok(await admin.from('vendas').update({ vendedor_externo: vendedorExt }).eq('id', id))
  return id
}

describe('Papel vendedor e metas', () => {
  let o: Org; let a: { client: SupabaseClient; userId: string }; let b: { client: SupabaseClient; userId: string }
  beforeAll(async () => {
    o = await novaOrganizacao()
    const conta = await novaConta(o, 'Banco', 5000, '2026-01-01')
    const canal = await novoCanal(o, 'Loja')
    ok(await o.client.from('canal_taxas').insert({ organizacao_id: o.orgId, forma_pagamento_id: o.forma('pix'), conta_bancaria_id: conta }))
    a = await vendedor(o, 'Ana')
    b = await vendedor(o, 'Bruno')
    const integ = ok(await o.client.from('integracoes').insert({ organizacao_id: o.orgId, empresa_id: o.empresaId }).select('id').single()) as any
    ok(await o.client.from('integracao_mapeamentos').insert([
      { organizacao_id: o.orgId, integracao_id: integ.id, tipo: 'vendedor', external_id: '111', external_nome: 'Ana Bling', interno_id: a.userId },
      { organizacao_id: o.orgId, integracao_id: integ.id, tipo: 'vendedor', external_id: '222', external_nome: 'Bruno Bling', interno_id: b.userId },
    ]))
    ok(await o.client.from('metas_vendedor').insert([
      { organizacao_id: o.orgId, user_id: a.userId, competencia: mes, valor: 3000 },
      { organizacao_id: o.orgId, user_id: b.userId, competencia: mes, valor: 1000 },
    ]))
    ok(await o.client.from('premios_mes').insert({ organizacao_id: o.orgId, competencia: mes, descricao: 'Viagem para Gramado', pct_minimo: 100 }))
    await venda(o, canal, 1000, 100, 50, '111')       // Ana: 900 (sem frete)
    await venda(o, canal, 500, 0, 0, '222')           // Bruno: 500
    const cancelada = await venda(o, canal, 700, 0, 0, '111', 'boleto')
    ok(await o.client.rpc('fn_cancelar_venda', { p_venda: cancelada }))  // cancelada não conta
  })

  it('vendedor não lê dados financeiros', async () => {
    for (const t of ['vendas', 'venda_itens', 'venda_pagamentos', 'titulos', 'movimentos', 'contas_bancarias', 'empresas',
      'plano_contas', 'canais_venda', 'metas', 'orcamentos', 'integracoes', 'integracao_mapeamentos', 'assinaturas', 'audit_log']) {
      const r = await a.client.from(t).select('*').eq('organizacao_id', o.orgId)
      expect(r.error, t).toBeNull()
      expect(r.data, t).toEqual([])
    }
    expect(ok(await a.client.rpc('fn_membros', { p_org: o.orgId }))).toEqual([])
    expect(ok(await a.client.rpc('fn_can_read', { org: o.orgId }))).toBe(false)
    const saldos = ok(await a.client.rpc('fn_saldos_contas', { p_org: o.orgId, p_empresas: null })) as any[]
    expect(saldos).toEqual([])
    // o dono enxerga as mesmas tabelas (garante que o teste não passa por falta de dados)
    expect((ok(await o.client.from('titulos').select('id').eq('organizacao_id', o.orgId)) as any[]).length).toBeGreaterThan(0)
    expect((ok(await o.client.rpc('fn_saldos_contas', { p_org: o.orgId, p_empresas: null })) as any[]).length).toBe(1)
    // escrita também bloqueada
    const ins = await a.client.from('contas_bancarias').insert({ organizacao_id: o.orgId, empresa_id: o.empresaId, nome: 'x' })
    expect(ins.error).not.toBeNull()
  })

  it('vendedor vê a organização, o próprio papel e o prêmio', async () => {
    const orgs = ok(await a.client.from('membros').select('papel, organizacoes(id, nome)').eq('user_id', a.userId)) as any[]
    expect(orgs).toHaveLength(1)
    expect(orgs[0].papel).toBe('vendedor')
    expect(orgs[0].organizacoes.id).toBe(o.orgId)
    const outros = ok(await a.client.from('membros').select('user_id').eq('organizacao_id', o.orgId)) as any[]
    expect(outros.map(x => x.user_id)).toEqual([a.userId])
    const p = ok(await a.client.from('premios_mes').select('descricao').eq('organizacao_id', o.orgId)) as any[]
    expect(p[0].descricao).toBe('Viagem para Gramado')
  })

  it('vendedor lê só a própria meta e não altera metas', async () => {
    const m = ok(await a.client.from('metas_vendedor').select('user_id, valor').eq('organizacao_id', o.orgId)) as any[]
    expect(m).toEqual([{ user_id: a.userId, valor: 3000 }])
    const up = ok(await a.client.from('metas_vendedor').update({ valor: 1 }).eq('user_id', a.userId).select('id')) as any[]
    expect(up).toEqual([])
    const ins = await a.client.from('metas_vendedor').insert({ organizacao_id: o.orgId, user_id: a.userId, competencia: '2027-01-01', valor: 1 })
    expect(ins.error).not.toBeNull()
    const pr = await a.client.from('premios_mes').update({ descricao: 'Hackeado' }).eq('organizacao_id', o.orgId).select('*')
    expect(pr.data ?? []).toEqual([])
  })

  it('corrida: ordem por valor vendido; vendedor vê o próprio R$ e só nome/% dos colegas', async () => {
    const r = ok(await a.client.rpc('fn_corrida_vendedores', { p_org: o.orgId, p_competencia: mes })) as any[]
    expect(r.map(x => x.nome)).toEqual(['Ana', 'Bruno'])        // R$ 900 > R$ 500, apesar de 30% < 50%
    const ana = r.find(x => x.eu)
    expect(ana.user_id).toBe(a.userId)
    expect(n(ana.meta)).toBe(3000)
    expect(n(ana.vendido)).toBe(900)
    expect(n(ana.pct)).toBe(30)
    const bruno = r.find(x => !x.eu)
    expect(bruno.meta).toBeNull()
    expect(bruno.vendido).toBeNull()
    expect(n(bruno.pct)).toBe(50)
  })

  it('corrida: dono vê os valores de todos', async () => {
    const r = ok(await o.client.rpc('fn_corrida_vendedores', { p_org: o.orgId, p_competencia: mes })) as any[]
    expect(r.map(x => [x.nome, n(x.meta), n(x.vendido)])).toEqual([['Ana', 3000, 900], ['Bruno', 1000, 500]])
  })

  it('quem não é da organização não vê a corrida', async () => {
    const fora = await novoUsuario('fora')
    const r = await fora.client.rpc('fn_corrida_vendedores', { p_org: o.orgId, p_competencia: mes })
    expect(r.error).not.toBeNull()
  })

  it('criar-vendedor: só admin cria login de vendedor', async () => {
    const chamar = (c: SupabaseClient, corpo: object) => c.functions.invoke('criar-vendedor', { body: corpo })
    const email = `novo-${Date.now()}@teste.financy.local`
    const negado = await chamar(a.client, { organizacao_id: o.orgId, nome: 'Intruso', email, senha: 'Senha-12345' })
    expect(negado.error).not.toBeNull()
    const r = await chamar(o.client, { organizacao_id: o.orgId, nome: 'Carla', email, senha: 'Senha-12345' })
    expect(r.error).toBeNull()
    const c = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
    ok(await c.auth.signInWithPassword({ email, password: 'Senha-12345' }))
    const m = ok(await c.from('membros').select('papel').eq('organizacao_id', o.orgId)) as any[]
    expect(m).toEqual([{ papel: 'vendedor' }])
    expect(ok(await c.from('vendas').select('id').eq('organizacao_id', o.orgId))).toEqual([])
    // e-mail já cadastrado e senha recusada recebem a mesma resposta (não revela quem tem conta)
    const msg = async (corpo: object) => { const r = await chamar(o.client, corpo); return (await (r.error as any)?.context?.json())?.erro }
    const existente = await msg({ organizacao_id: o.orgId, nome: 'Carla 2', email, senha: 'Outra-12345' })
    const fraca = await msg({ organizacao_id: o.orgId, nome: 'Davi', email: `davi-${Date.now()}@teste.financy.local`, senha: '12345678' })
    expect(existente).toMatch(/Não foi possível criar o login/)
    expect(fraca === undefined || fraca === existente).toBe(true)   // senha fraca só falha se o Auth local exigir força
  })
})
