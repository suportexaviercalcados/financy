import { describe, it, expect } from 'vitest'
import { lerOFX, ErroOFX } from './ofx'
import { simular } from './simulacao'
import { parseValor, cnpjValido, data, fimMes } from './format'

const OFX_SGML = `OFXHEADER:100
DATA:OFXSGML
<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS><BANKACCTFROM><BANKID>0341<ACCTID>12345-6</BANKACCTFROM>
<BANKTRANLIST><DTSTART>20260901<DTEND>20260930
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260902120000[-3:BRT]<TRNAMT>-45.90<FITID>A1<MEMO>TARIFA PACOTE</STMTTRN>
<STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260904<TRNAMT>350,00<FITID>A2<NAME>PIX RECEBIDO<MEMO>CLIENTE &amp; CIA</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260905<TRNAMT>-10.00<MEMO>IOF</STMTTRN>
<STMTTRN><TRNTYPE>DEBIT<DTPOSTED>20260905<TRNAMT>-10.00<MEMO>IOF</STMTTRN>
</BANKTRANLIST><LEDGERBAL><BALAMT>1284.10<DTASOF>20260930</LEDGERBAL></STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>`

describe('leitor OFX', () => {
  it('lê SGML com datas, valores BR e saldo', () => {
    const e = lerOFX(OFX_SGML)
    expect(e.conta).toBe('12345-6')
    expect(e.saldo_final).toBe(1284.1)
    expect(e.data_saldo).toBe('2026-09-30')
    expect(e.transacoes.map(t => t.valor)).toEqual([-45.9, 350, -10, -10])
    expect(e.transacoes[0].data).toBe('2026-09-02')
    expect(e.transacoes[1].descricao).toBe('PIX RECEBIDO — CLIENTE & CIA')
  })
  it('gera FITID determinístico e único quando ausente', () => {
    const e = lerOFX(OFX_SGML)
    const [a, b] = e.transacoes.slice(2)
    expect(a.fitid).not.toBe(b.fitid)
    expect(lerOFX(OFX_SGML).transacoes[3].fitid).toBe(b.fitid)   // mesmo arquivo = mesmos ids
  })
  it('rejeita arquivo inválido com mensagem clara', () => {
    expect(() => lerOFX('qualquer coisa')).toThrow(ErroOFX)
    expect(() => lerOFX('<OFX><STMTTRN><DTPOSTED>xx<TRNAMT>1</STMTTRN></OFX>')).toThrow(/data/)
  })
})

describe('simulação de caixa', () => {
  const tits = [
    { id: '1', tipo: 'receber' as const, saldo: 1000, vencimento: '2026-01-10', adquirente: true },
    { id: '2', tipo: 'pagar' as const, saldo: 400, vencimento: '2026-01-05' },
  ]
  it('base acumula títulos e não altera com cenário vazio', () => {
    const s = simular(100, '2026-01-01', 15, tits, {})
    expect(s.at(-1)).toEqual({ data: '2026-01-16', base: 700, simulado: 700 })
    expect(s.find(p => p.data === '2026-01-05')!.base).toBe(-300)
  })
  it('atraso, nova despesa recorrente e antecipação', () => {
    const atraso = simular(100, '2026-01-01', 15, tits, { atrasoRecebimentosDias: 10 })
    expect(atraso.at(-1)!.simulado).toBe(-300)
    const desp = simular(100, '2026-01-01', 40, tits, { novasDespesas: [{ descricao: 'x', valor: 50, data: '2026-01-02', recorrenteMeses: 2 }] })
    expect(desp.at(-1)!.simulado).toBe(600)
    const ant = simular(100, '2026-01-01', 3, tits, { antecipacao: { ate: '2026-01-31', taxaPct: 3 } })
    expect(ant[0].simulado).toBe(1070)
  })
})

describe('formatação', () => {
  it('converte valores e valida CNPJ', () => {
    expect(parseValor('1.234,56')).toBe(1234.56)
    expect(parseValor('1234.56')).toBe(1234.56)
    expect(cnpjValido('11.222.333/0001-81')).toBe(true)
    expect(cnpjValido('11.222.333/0001-82')).toBe(false)
    expect(data('2026-09-05')).toBe('05/09/2026')
    expect(fimMes('2026-02-10')).toBe('2026-02-28')
  })
})
