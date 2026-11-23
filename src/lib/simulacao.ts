// Simulação de cenários de caixa (não altera dados reais). Base: saldo de hoje + títulos em aberto.
export interface TituloAberto { id: string; tipo: 'pagar' | 'receber'; saldo: number; vencimento: string; adquirente?: boolean }
export interface Cenario {
  atrasoRecebimentosDias?: number              // atrasa todos os recebimentos
  inadimplenciaPct?: number                    // % dos recebimentos que não entram
  novasDespesas?: { descricao: string; valor: number; data: string; recorrenteMeses?: number }[]
  antecipacao?: { ate: string; taxaPct: number } // antecipa recebíveis de cartão até a data, com desconto
}
export interface PontoSimulado { data: string; base: number; simulado: number }

const add = (iso: string, n: number) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const addMes = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number)
  const ult = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate()
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, ult))).toISOString().slice(0, 10)
}

export function simular(saldoHoje: number, hoje: string, dias: number, titulos: TituloAberto[], c: Cenario): PontoSimulado[] {
  const base = new Map<string, number>(); const sim = new Map<string, number>()
  const soma = (m: Map<string, number>, d: string, v: number) => { const k = d < hoje ? hoje : d; m.set(k, (m.get(k) ?? 0) + v) }
  for (const t of titulos) {
    const v = t.tipo === 'receber' ? t.saldo : -t.saldo
    soma(base, t.vencimento, v)
    if (t.tipo === 'pagar') { soma(sim, t.vencimento, v); continue }
    let valor = v * (1 - (c.inadimplenciaPct ?? 0) / 100)
    let data = add(t.vencimento < hoje ? hoje : t.vencimento, c.atrasoRecebimentosDias ?? 0)
    if (c.antecipacao && t.adquirente && t.vencimento > hoje && t.vencimento <= c.antecipacao.ate) {
      valor = valor * (1 - c.antecipacao.taxaPct / 100); data = hoje
    }
    soma(sim, data, valor)
  }
  for (const d of c.novasDespesas ?? []) {
    for (let i = 0; i < Math.max(1, d.recorrenteMeses ?? 1); i++) soma(sim, addMes(d.data, i), -Math.abs(d.valor))
  }
  const out: PontoSimulado[] = []
  let sb = saldoHoje, ss = saldoHoje
  for (let i = 0; i <= dias; i++) {
    const d = add(hoje, i)
    sb += base.get(d) ?? 0; ss += sim.get(d) ?? 0
    out.push({ data: d, base: Math.round(sb * 100) / 100, simulado: Math.round(ss * 100) / 100 })
  }
  return out
}
