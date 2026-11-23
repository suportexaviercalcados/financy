// Leitor de extratos OFX (v1 SGML e v2 XML). O backend (fn_importar_ofx) revalida os dados.
export interface TransacaoOFX { fitid: string; data: string; valor: number; descricao: string; tipo: string }
export interface ExtratoOFX {
  banco_id?: string; conta?: string; data_inicio?: string; data_fim?: string
  saldo_final?: number; data_saldo?: string; transacoes: TransacaoOFX[]
}

export class ErroOFX extends Error {}

const tag = (bloco: string, nome: string) => {
  const m = bloco.match(new RegExp(`<${nome}>([^<\\r\\n]*)`, 'i'))
  return m ? m[1].trim() : undefined
}
/** OFX date: YYYYMMDD[HHMMSS[.XXX][TZ]] -> YYYY-MM-DD */
const dataOFX = (s?: string) => {
  if (!s || !/^\d{8}/.test(s)) return undefined
  const iso = `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`
  return Number.isNaN(Date.parse(iso)) ? undefined : iso
}
/** Aceita "1234.56", "-1234,56", "1.234,56" */
const valorOFX = (s?: string) => {
  if (!s) return NaN
  const t = s.trim()
  const norm = /,\d{1,2}$/.test(t) ? t.replace(/\./g, '').replace(',', '.') : t.replace(/,/g, '')
  return Number(norm)
}
const decodificar = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")

export function lerOFX(conteudo: string): ExtratoOFX {
  if (!/<OFX>/i.test(conteudo)) throw new ErroOFX('Arquivo não parece ser um OFX válido (tag <OFX> ausente).')
  const blocos = conteudo.split(/<STMTTRN>/i).slice(1).map(b => b.split(/<\/STMTTRN>/i)[0])
  if (!blocos.length && !/<BANKTRANLIST>/i.test(conteudo)) throw new ErroOFX('Nenhuma lista de transações encontrada no arquivo.')
  const vistos = new Map<string, number>()
  const transacoes: TransacaoOFX[] = blocos.map((b, i) => {
    const data = dataOFX(tag(b, 'DTPOSTED'))
    const valor = valorOFX(tag(b, 'TRNAMT'))
    if (!data) throw new ErroOFX(`Transação ${i + 1}: data (DTPOSTED) inválida.`)
    if (Number.isNaN(valor)) throw new ErroOFX(`Transação ${i + 1}: valor (TRNAMT) inválido.`)
    const descricao = decodificar([tag(b, 'NAME'), tag(b, 'MEMO')].filter(Boolean).filter((x, j, a) => a.indexOf(x) === j).join(' — '))
    // FITID ausente: identificador determinístico para manter a idempotência
    let fitid = tag(b, 'FITID') || `SEM-FITID:${data}:${valor.toFixed(2)}:${descricao.slice(0, 40)}`
    const n = (vistos.get(fitid) ?? 0) + 1
    vistos.set(fitid, n)
    if (n > 1) fitid = `${fitid}#${n}`
    return { fitid, data, valor: Math.round(valor * 100) / 100, descricao, tipo: tag(b, 'TRNTYPE') ?? '' }
  })
  const ledger = conteudo.split(/<LEDGERBAL>/i)[1]
  return {
    banco_id: tag(conteudo, 'BANKID'), conta: tag(conteudo, 'ACCTID'),
    data_inicio: dataOFX(tag(conteudo, 'DTSTART')), data_fim: dataOFX(tag(conteudo, 'DTEND')),
    saldo_final: ledger ? valorOFX(tag(ledger, 'BALAMT')) : undefined,
    data_saldo: ledger ? dataOFX(tag(ledger, 'DTASOF')) : undefined,
    transacoes,
  }
}

/** SHA-256 hex do arquivo (identifica reimportação do mesmo extrato) */
export async function hashArquivo(texto: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto))
  return Array.from(new Uint8Array(buf), b => b.toString(16).padStart(2, '0')).join('')
}
