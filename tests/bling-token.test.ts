/**
 * Renovação concorrente do token Bling: quem perde a corrida do refresh (uso único)
 * deve usar o token que a outra execução gravou, sem marcar a integração como "reautorizar".
 * Roda sem Supabase: util.ts (Deno) é substituído por um mock.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../supabase/functions/_shared/util.ts', () => ({
  env: () => 'x',
  log: () => {},
  sleep: () => Promise.resolve(),
  encrypt: async (s: string) => s,
  decrypt: async (s: string) => s,
}))

const { BlingApi } = await import('../supabase/functions/_shared/bling.ts')

const antigo = { access_token_enc: 'velho', refresh_token_enc: 'r1', expires_at: '2000-01-01T00:00:00Z', updated_at: 't1' }

/** Cliente fake: cada select devolve a próxima linha da fila (a última se repete). */
function svcFake(linhas: Record<string, string>[]) {
  const updates: unknown[] = []
  let i = 0
  const svc = {
    from: (_t: string) => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: linhas[Math.min(i++, linhas.length - 1)], error: null }) }) }),
      update: (v: unknown) => { updates.push(v); return { eq: async () => ({ error: null }) } },
      upsert: async () => ({ error: null }),
    }),
  }
  return { svc: svc as any, updates }
}

describe('BlingApi.accessToken', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400 })))
  })

  it('usa o token renovado por outra execução em vez de pedir reautorização', async () => {
    const novo = { access_token_enc: 'novo', refresh_token_enc: 'r2', expires_at: '2999-01-01T00:00:00Z', updated_at: 't2' }
    const { svc, updates } = svcFake([antigo, antigo, novo])
    const api = new BlingApi(svc, 'integ-1')
    await expect((api as any).accessToken()).resolves.toBe('novo')
    expect(updates).toEqual([])
  })

  it('marca reautorizar quando ninguém renovou (refresh realmente inválido)', async () => {
    const { svc, updates } = svcFake([antigo])
    const api = new BlingApi(svc, 'integ-1')
    await expect((api as any).accessToken()).rejects.toThrow('Falha no token Bling (400)')
    expect(updates).toEqual([expect.objectContaining({ status: 'reautorizar' })])
  })
})
