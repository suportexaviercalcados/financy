import { describe, it, expect } from 'vitest'
import { encontrarCategoria, lerData, validarPlanilha, type CategoriaRef } from './planilhaContas'

const cats: CategoriaRef[] = [
  { id: 'c1', codigo: '5.2.1', nome: 'Aluguel e condomínio', natureza: 'saida', aceita_lancamento: true, ativo: true },
  { id: 'c2', codigo: '5.2.2', nome: 'Energia, água e internet', natureza: 'saida', aceita_lancamento: true, ativo: true },
  { id: 'c3', codigo: '6.4', nome: 'Tarifas bancárias', natureza: 'saida', aceita_lancamento: true, ativo: true },
  { id: 'c4', codigo: '1.1', nome: 'Receita de vendas', natureza: 'entrada', aceita_lancamento: true, ativo: true },
  { id: 'c5', codigo: '5.2', nome: 'Ocupação', natureza: 'saida', aceita_lancamento: false, ativo: true },
]
const ctx = { tipo: 'pagar' as const, categorias: cats, centros: [{ id: 'cc1', nome: 'Loja Centro' }],
  contatos: [{ id: 'f1', nome: 'Imobiliária Central' }], empresas: [{ id: 'e1', razao_social: 'Loja LTDA', nome_fantasia: 'Loja', cnpj: '11222333000181' }],
  empresaPadrao: 'e1' }
const CAB = ['Descrição *', 'Fornecedor', 'Categoria *', 'Valor *', 'Vencimento *', 'Competência', 'Parcelas', 'Centro de custo', 'Nº documento', 'Observações', 'Empresa']

describe('planilha de contas', () => {
  it('reconhece categoria por rótulo da lista, código ou nome (sem acento/caixa)', () => {
    expect(encontrarCategoria('5.2.1 — Aluguel e condomínio', cats)?.id).toBe('c1')
    expect(encontrarCategoria('6.4', cats)?.id).toBe('c3')
    expect(encontrarCategoria('tarifas bancarias', cats)?.id).toBe('c3')
    expect(encontrarCategoria('energia', cats)?.id).toBe('c2')
    expect(encontrarCategoria('inexistente', cats)).toBeNull()
  })
  it('lê datas seriais do Excel e textos', () => {
    expect(lerData(46356)).toBe('2026-11-30')
    expect(lerData('05/12/2026')).toBe('2026-12-05')
    expect(lerData('2026-12-05')).toBe('2026-12-05')
    expect(lerData('31/02/2026')).toBeNull()
  })
  it('valida linhas, mapeia cadastros e aponta erros por linha', () => {
    const r = validarPlanilha([
      CAB,
      ['Aluguel dezembro', 'Imobiliária Central', '5.2.1 — Aluguel e condomínio', 3500, 46366, null, null, 'Loja Centro', 'NF 10', '', ''],
      ['Internet', 'Provedor Novo', 'Energia, água e internet', '199,90', '10/12/2026', '01/12/2026', 3, '', '', '', 'Loja'],
      [null, null, null, null, null, null, null, null, null, null, null],
      ['Receita errada', '', '1.1 — Receita de vendas', -5, 'ontem', 'x', 0, 'Centro X', '', '', 'Outra'],
    ], ctx)
    expect(r).toHaveLength(3)
    expect(r[0]).toMatchObject({ linha: 2, categoria_id: 'c1', contato_id: 'f1', novoContato: false, valor: 3500, vencimento: '2026-12-10',
      parcelas: 1, centro_custo_id: 'cc1', documento: 'NF 10', empresa_id: 'e1', erros: [] })
    expect(r[1]).toMatchObject({ linha: 3, categoria_id: 'c2', novoContato: true, valor: 199.9, competencia: '2026-12-01', parcelas: 3, erros: [] })
    expect(r[2].linha).toBe(5)
    expect(r[2].erros).toEqual(expect.arrayContaining([
      'Categoria "1.1 — Receita de vendas" não encontrada', 'Valor deve ser maior que zero', 'Vencimento inválido (use dd/mm/aaaa)',
      'Competência inválida', 'Parcelas deve ser um número inteiro de 1 a 120', 'Centro de custo "Centro X" não encontrado', 'Empresa "Outra" não encontrada']))
  })
  it('recusa planilha sem as colunas obrigatórias', () => {
    expect(() => validarPlanilha([['Nome', 'Preço']], ctx)).toThrow(/Cabeçalho/)
  })
})
