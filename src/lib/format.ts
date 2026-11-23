// Formatação pt-BR: R$, dd/mm/aaaa, fuso America/Sao_Paulo
export const TZ = 'America/Sao_Paulo'

const moeda = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' })
const moedaCompacta = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 })
const numero = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 })

export const brl = (v: unknown) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? '—' : moeda.format(Math.abs(Number(v)) < 0.005 ? 0 : Number(v)))
export const brlCompacto = (v: unknown) => (v === null || v === undefined ? '—' : moedaCompacta.format(Number(v)))
export const num = (v: unknown) => (v === null || v === undefined ? '—' : numero.format(Number(v)))
export const pct = (v: unknown, casas = 1) =>
  v === null || v === undefined || Number.isNaN(Number(v)) ? '—' : `${Number(v).toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`

/** 'YYYY-MM-DD' -> 'dd/mm/aaaa' (sem conversão de fuso: datas de calendário) */
export const data = (iso?: string | null) => {
  if (!iso) return '—'
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${d}/${m}/${y}`
}
export const dataHora = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { timeZone: TZ, dateStyle: 'short', timeStyle: 'short' }) : '—'

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
export const mesAno = (iso: string) => `${MESES[Number(iso.slice(5, 7)) - 1]}/${iso.slice(2, 4)}`

/** Data de hoje no fuso de Brasília, 'YYYY-MM-DD' */
export const hoje = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ })
export const somaDias = (iso: string, n: number) => {
  const x = new Date(iso + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10)
}
export const somaMeses = (iso: string, n: number) => {
  const [y, m] = iso.split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 1 + n, 1)); return d.toISOString().slice(0, 10)
}
export const inicioMes = (iso: string) => iso.slice(0, 8) + '01'
export const fimMes = (iso: string) => somaDias(somaMeses(inicioMes(iso), 1), -1)
export const diffDias = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5)

/** Converte texto digitado ("1.234,56" ou "1234.56") em número */
export const parseValor = (s: string | number) => {
  if (typeof s === 'number') return s
  const t = s.trim().replace(/[R$\s]/g, '')
  if (!t) return NaN
  return Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t)
}

export const soDigitos = (s: string) => s.replace(/\D/g, '')
export const cnpj = (s?: string | null) => {
  const d = soDigitos(s ?? '')
  return d.length === 14 ? d.replace(/^(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})$/, '$1.$2.$3/$4-$5') : s ?? ''
}
export function cnpjValido(v: string) {
  const c = soDigitos(v)
  if (c.length !== 14 || /^(\d)\1+$/.test(c)) return false
  const calc = (n: number) => {
    let s = 0, p = n - 7
    for (let i = 0; i < n; i++) { s += Number(c[i]) * p--; if (p < 2) p = 9 }
    const r = s % 11; return r < 2 ? 0 : 11 - r
  }
  return calc(12) === Number(c[12]) && calc(13) === Number(c[13])
}
