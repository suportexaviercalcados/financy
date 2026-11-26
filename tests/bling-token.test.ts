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

const { BlingApi, conciliarPedidos } = await import('../supabase/functions/_shared/bling.ts')

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

describe('conciliarPedidos', () => {
  const ped = (id: number, valor: number) => ({ id, situacao: { valor } })
  const loc = (external_id: string, status = 'concluida', situacao_externa: number | null = 1) => ({ external_id, status, situacao_externa })

  it('revisa o que falta ou mudou de situação e aponta as vendas que sumiram do Bling', () => {
    const pedidos = [ped(1, 1), ped(2, 2), ped(3, 1), ped(4, 2), ped(5, 0)]
    const locais = [loc('1'), loc('2'), loc('9'), loc('8', 'cancelada'), loc('7', 'concluida', 2)]
    const { revisar, sumidas } = conciliarPedidos(pedidos, locais, [1, 11])
    // 2: cancelado lá e ativo aqui; 3: atendido lá e ausente aqui. Fora: 1 (igual), 4 (cancelado nunca importado), 5 (em aberto)
    expect(revisar.map(p => p.id)).toEqual([2, 3])
    // 9 sumiu; 8 já cancelada e 7 já marcada como cancelada no Bling não repetem
    expect(sumidas.map(l => l.external_id)).toEqual(['9'])
  })
})
