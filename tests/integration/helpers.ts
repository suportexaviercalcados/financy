import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL!
const anon = process.env.SUPABASE_ANON_KEY!
const service = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!url || !anon || !service) {
  throw new Error('Defina SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY em .env.test.local (veja README).')
}

export const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })

const rnd = () => Math.random().toString(36).slice(2, 10)

export async function novoUsuario(prefixo = 'u'): Promise<{ client: SupabaseClient; userId: string; email: string }> {
  const email = `${prefixo}-${rnd()}@teste.financy.local`
  const password = `Senha-${rnd()}-Aa1!`
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw error
  const client = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } })
  const { error: e2 } = await client.auth.signInWithPassword({ email, password })
  if (e2) throw e2
  return { client, userId: data.user.id, email }
}

export function ok<T>(r: { data: T; error: unknown }): T {
  if (r.error) throw new Error(JSON.stringify(r.error))
  return r.data
}

export interface Org {
  client: SupabaseClient
  userId: string
  email: string
  orgId: string
  empresaId: string
  cat: (chave: string) => string
  catCodigo: (codigo: string) => string
  forma: (tipo: string) => string
}

/** Cria usuário + organização (onboarding real) e carrega ids úteis */
export async function novaOrganizacao(aliquota = 6): Promise<Org> {
  const u = await novoUsuario('dono')
  const orgId = ok(await u.client.rpc('fn_criar_organizacao', {
    p_nome: 'Loja Teste ' + rnd(),
    p_empresa: { razao_social: 'Loja Teste LTDA', regime_tributario: 'simples', aliquota_imposto_vendas: aliquota },
  })) as string
  const empresas = ok(await u.client.from('empresas').select('id').eq('organizacao_id', orgId)) as { id: string }[]
  const cats = ok(await u.client.from('plano_contas').select('id,codigo,chave_sistema').eq('organizacao_id', orgId)) as
    { id: string; codigo: string; chave_sistema: string | null }[]
  const formas = ok(await u.client.from('formas_pagamento').select('id,tipo').eq('organizacao_id', orgId)) as
    { id: string; tipo: string }[]
  const byKey = (k: string) => { const c = cats.find(c => c.chave_sistema === k); if (!c) throw new Error('cat ' + k); return c.id }
  const byCod = (k: string) => { const c = cats.find(c => c.codigo === k); if (!c) throw new Error('cod ' + k); return c.id }
  const forma = (t: string) => { const f = formas.find(f => f.tipo === t); if (!f) throw new Error('forma ' + t); return f.id }
  return { ...u, orgId, empresaId: empresas[0].id, cat: byKey, catCodigo: byCod, forma }
}

export async function novaConta(o: Org, nome: string, saldo: number, data: string): Promise<string> {
  const r = ok(await o.client.from('contas_bancarias').insert({
    organizacao_id: o.orgId, empresa_id: o.empresaId, nome, saldo_inicial: saldo, data_saldo_inicial: data,
  }).select('id').single()) as { id: string }
  return r.id
}

export async function novoCanal(o: Org, nome: string, extra: Record<string, unknown> = {}): Promise<string> {
  const r = ok(await o.client.from('canais_venda').insert({ organizacao_id: o.orgId, nome, ...extra }).select('id').single()) as { id: string }
  return r.id
}

export const hoje = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
export const somaDias = (d: string, n: number) => {
  const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10)
}
export const n = (v: unknown) => Number(v)
