import { describe, expect, it } from 'vitest'
import { andamento } from './metas'

describe('andamento da meta', () => {
  it('meio do mês: ritmos e dias', () => {
    const a = andamento(30000, 10000, '2026-11-01', '2026-11-10')
    expect(a.diasMes).toBe(30)
    expect(a.diasDecorridos).toBe(10)
    expect(a.diasRestantes).toBe(21)          // 10 a 30, hoje incluído
    expect(a.falta).toBe(20000)
    expect(a.ritmoAtual).toBe(1000)
    expect(a.ritmoNecessario).toBeCloseTo(952.38, 2)
    expect(a.projecao).toBe(30000)
    expect(a.pct).toBeCloseTo(33.33, 2)
  })
  it('mês passado e meta batida', () => {
    const a = andamento(1000, 1500, '2026-10-01', '2026-11-10')
    expect([a.diasRestantes, a.falta, a.ritmoNecessario]).toEqual([0, 0, 0])
    expect(a.pct).toBe(150)
  })
  it('mês futuro', () => {
    const a = andamento(1000, 0, '2026-12-01', '2026-11-10')
    expect([a.diasDecorridos, a.diasRestantes, a.ritmoAtual]).toEqual([0, 31, 0])
  })
})
