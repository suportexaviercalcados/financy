import { describe, expect, it } from 'vitest'
import { andamento, comissaoDaMeta, NIVEIS_PADRAO, niveisDaMeta } from './metas'

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

describe('metas em 3 níveis', () => {
  it('Desejável e Supermeta são +20% e +30% da Alcançável', () => {
    expect(niveisDaMeta(53773, NIVEIS_PADRAO).map(n => [n.nome, n.meta, n.comissaoPct, n.pctBase])).toEqual([
      ['Alcançável', 53773, 1, 100], ['Desejável', 64527.6, 1.5, 120], ['Supermeta', 69904.9, 2, 130]])
  })
  it('comissão vale sobre todo o vendido, conforme o nível atingido', () => {
    const c = (vendido: number) => { const r = comissaoDaMeta(10000, vendido, NIVEIS_PADRAO); return [r.atual?.nome ?? null, r.proximo?.nome ?? null, r.comissao] }
    expect(c(9999.99)).toEqual([null, 'Alcançável', 0])
    expect(c(10000)).toEqual(['Alcançável', 'Desejável', 100])
    expect(c(12000)).toEqual(['Desejável', 'Supermeta', 180])
    expect(c(15000)).toEqual(['Supermeta', null, 300])
  })
  it('sem meta não há nível nem comissão', () => {
    expect(comissaoDaMeta(0, 5000, NIVEIS_PADRAO).comissao).toBe(0)
  })
})
