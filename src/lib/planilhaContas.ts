// Importação de contas a pagar/receber por planilha Excel: modelo (com listas suspensas) + leitura + validação.
import { parseValor } from './format'

export type TipoConta = 'pagar' | 'receber'
export interface CategoriaRef { id: string; codigo: string; nome: string; natureza: 'entrada' | 'saida'; aceita_lancamento: boolean; ativo: boolean }
export interface Ref { id: string; nome: string }
export interface EmpresaRef { id: string; razao_social: string; nome_fantasia: string | null; cnpj: string | null }

export const COLUNAS = ['Descrição', 'Fornecedor/Cliente', 'Categoria', 'Valor', 'Vencimento', 'Competência', 'Parcelas',
  'Centro de custo', 'Nº documento', 'Observações', 'Empresa'] as const

export interface LinhaPlanilha {
  linha: number                      // número da linha no Excel
  descricao: string
  contatoTexto: string; contato_id: string | null; novoContato: boolean
  categoriaTexto: string; categoria_id: string | null
  valor: number
  vencimento: string | null
  competencia: string | null
  parcelas: number
  centroTexto: string; centro_custo_id: string | null
  documento: string
  observacoes: string
  empresaTexto: string; empresa_id: string | null
  erros: string[]
}

/** minúsculas, sem acentos e sem espaços duplicados */
export const normalizar = (s: unknown) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()

export const rotuloCategoria = (c: Pick<CategoriaRef, 'codigo' | 'nome'>) => `${c.codigo} — ${c.nome}`
export const rotuloEmpresa = (e: EmpresaRef) => e.nome_fantasia || e.razao_social

export const categoriasValidas = (cats: CategoriaRef[], tipo: TipoConta) =>
  cats.filter(c => c.aceita_lancamento && c.ativo && c.natureza === (tipo === 'pagar' ? 'saida' : 'entrada'))
    .sort((a, b) => a.codigo.localeCompare(b.codigo, 'pt-BR', { numeric: true }))

/** Aceita "5.2.1 — Aluguel", "5.2.1", "Aluguel e condomínio" ou parte única do nome */
export function encontrarCategoria(texto: string, cats: CategoriaRef[]): CategoriaRef | null {
  const t = String(texto ?? '').trim()
  if (!t) return null
  const codigo = t.split(/\s+[—–-]\s+/)[0].trim()
  const porCodigo = cats.find(c => c.codigo === codigo)
  if (porCodigo) return porCodigo
  const n = normalizar(t.includes('—') ? t.split('—').slice(1).join('—') : t)
  const exato = cats.find(c => normalizar(c.nome) === n)
  if (exato) return exato
  const parciais = cats.filter(c => normalizar(c.nome).includes(n) || n.includes(normalizar(c.nome)))
  return parciais.length === 1 ? parciais[0] : null
}

/** Data do Excel (número serial ou texto dd/mm/aaaa, aaaa-mm-dd) -> 'YYYY-MM-DD' */
export function lerData(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number' && Number.isFinite(v)) {
    if (v < 1 || v > 2958465) return null
    return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 864e5).toISOString().slice(0, 10)
  }
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10)
  const s = String(v).trim()
  let m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/)
  if (m) {
    const ano = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])
    const iso = `${ano}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
    return valida(iso) ? iso : null
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (m) return valida(m[0]) ? m[0] : null
  return null
}
const valida = (iso: string) => { const d = new Date(iso + 'T12:00:00Z'); return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso }

const lerValor = (v: unknown) => (typeof v === 'number' ? v : parseValor(String(v ?? '')))

/**
 * Valida as linhas lidas da planilha (primeira linha = cabeçalho).
 * Cabeçalhos são reconhecidos pelo nome (sem acento/caixa), então planilhas próprias com os mesmos títulos funcionam.
 */
export function validarPlanilha(linhas: unknown[][], ctx: {
  tipo: TipoConta; categorias: CategoriaRef[]; centros: Ref[]; contatos: Ref[]; empresas: EmpresaRef[]; empresaPadrao: string
}): LinhaPlanilha[] {
  if (!linhas.length) return []
  const cab = (linhas[0] ?? []).map(normalizar)
  const idx = (...nomes: string[]) => cab.findIndex(h => nomes.some(n => h === n || h.startsWith(n) || h.includes(n)))
  const col = {
    descricao: idx('descricao'), contato: idx('fornecedor', 'cliente', 'contato'), categoria: idx('categoria'), valor: idx('valor'),
    vencimento: idx('vencimento'), competencia: idx('competencia'), parcelas: idx('parcelas'), centro: idx('centro de custo', 'centro'),
    documento: idx('documento'), observacoes: idx('observac'),
    empresa: idx('empresa'),
  }
  if (col.descricao < 0 || col.valor < 0 || col.vencimento < 0 || col.categoria < 0) {
    throw new Error('Cabeçalho não reconhecido. Use o modelo: as colunas Descrição, Categoria, Valor e Vencimento são obrigatórias.')
  }
  const cats = categoriasValidas(ctx.categorias, ctx.tipo)
  const get = (r: unknown[], i: number) => (i >= 0 ? r[i] : undefined)
  const txt = (r: unknown[], i: number) => String(get(r, i) ?? '').trim()
  const out: LinhaPlanilha[] = []
  linhas.slice(1).forEach((r, k) => {
    if (!r || r.every(c => c === null || c === undefined || String(c).trim() === '')) return
    const erros: string[] = []
    const descricao = txt(r, col.descricao)
    if (descricao.length < 2) erros.push('Descrição obrigatória')
    const categoriaTexto = txt(r, col.categoria)
    const cat = encontrarCategoria(categoriaTexto, cats)
    if (!categoriaTexto) erros.push('Categoria obrigatória')
    else if (!cat) erros.push(`Categoria "${categoriaTexto}" não encontrada`)
    const valor = lerValor(get(r, col.valor))
    if (!(valor > 0)) erros.push('Valor deve ser maior que zero')
    const vencimento = lerData(get(r, col.vencimento))
    if (!vencimento) erros.push('Vencimento inválido (use dd/mm/aaaa)')
    const compBruta = get(r, col.competencia)
    const competencia = lerData(compBruta)
    if (compBruta !== undefined && compBruta !== null && String(compBruta).trim() !== '' && !competencia) erros.push('Competência inválida')
    const parcBruta = get(r, col.parcelas)
    const parcelas = parcBruta === undefined || parcBruta === null || String(parcBruta).trim() === '' ? 1 : Number(parcBruta)
    if (!Number.isInteger(parcelas) || parcelas < 1 || parcelas > 120) erros.push('Parcelas deve ser um número inteiro de 1 a 120')
    const contatoTexto = txt(r, col.contato)
    const contato = contatoTexto ? ctx.contatos.find(c => normalizar(c.nome) === normalizar(contatoTexto)) : undefined
    const centroTexto = txt(r, col.centro)
    const centro = centroTexto ? ctx.centros.find(c => normalizar(c.nome) === normalizar(centroTexto)) : undefined
    if (centroTexto && !centro) erros.push(`Centro de custo "${centroTexto}" não encontrado`)
    const empresaTexto = txt(r, col.empresa)
    let empresa_id: string | null = ctx.empresaPadrao || null
    if (empresaTexto) {
      const n = normalizar(empresaTexto); const dig = empresaTexto.replace(/\D/g, '')
      const e = ctx.empresas.find(x => normalizar(rotuloEmpresa(x)) === n || normalizar(x.razao_social) === n || (dig.length === 14 && x.cnpj === dig))
      if (e) empresa_id = e.id; else erros.push(`Empresa "${empresaTexto}" não encontrada`)
    }
    if (!empresa_id) erros.push('Empresa não definida')
    out.push({
      linha: k + 2, descricao, contatoTexto, contato_id: contato?.id ?? null, novoContato: !!contatoTexto && !contato,
      categoriaTexto, categoria_id: cat?.id ?? null, valor: Number.isFinite(valor) ? Math.round(valor * 100) / 100 : NaN,
      vencimento, competencia, parcelas: Number.isInteger(parcelas) ? parcelas : 1, centroTexto, centro_custo_id: centro?.id ?? null,
      documento: txt(r, col.documento), observacoes: txt(r, col.observacoes), empresaTexto, empresa_id, erros,
    })
  })
  return out
}

/** Lê a primeira aba com o cabeçalho do modelo (ou a primeira aba) como matriz de valores brutos */
export async function lerPlanilha(arquivo: ArrayBuffer): Promise<unknown[][]> {
  const XLSX = await import('xlsx')
  const wb = XLSX.read(arquivo, { type: 'array', cellDates: false })
  const nome = wb.SheetNames.find(n => /^contas a (pagar|receber)$/i.test(n.trim())) ?? wb.SheetNames.find(n => !/instru|lista/i.test(n)) ?? wb.SheetNames[0]
  return XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[nome], { header: 1, raw: true, defval: null, blankrows: false })
}

/** Gera o modelo .xlsx com listas suspensas (categorias, centros de custo e empresas) */
export async function baixarModelo(ctx: { tipo: TipoConta; categorias: CategoriaRef[]; centros: Ref[]; empresas: EmpresaRef[] }) {
  const ExcelJS = (await import('exceljs')).default
  const wb = new ExcelJS.Workbook()
  wb.creator = 'Financy'
  const titulo = ctx.tipo === 'pagar' ? 'Contas a pagar' : 'Contas a receber'
  const ws = wb.addWorksheet(titulo, { views: [{ state: 'frozen', ySplit: 1 }] })
  const listas = wb.addWorksheet('Listas')
  const instr = wb.addWorksheet('Instruções')

  const cats = categoriasValidas(ctx.categorias, ctx.tipo).map(rotuloCategoria)
  const centros = ctx.centros.map(c => c.nome)
  const empresas = ctx.empresas.map(rotuloEmpresa)
  listas.getRow(1).values = ['Categorias', 'Centros de custo', 'Empresas']
  cats.forEach((c, i) => { listas.getCell(i + 2, 1).value = c })
  centros.forEach((c, i) => { listas.getCell(i + 2, 2).value = c })
  empresas.forEach((c, i) => { listas.getCell(i + 2, 3).value = c })
  listas.columns = [{ width: 55 }, { width: 30 }, { width: 40 }]
  listas.state = 'hidden'

  const cabecalho = COLUNAS.map(c => (c === 'Fornecedor/Cliente' ? (ctx.tipo === 'pagar' ? 'Fornecedor' : 'Cliente') : c))
  ws.columns = cabecalho.map((h, i) => ({ header: ['Descrição', 'Categoria', 'Valor', 'Vencimento'].includes(h) ? `${h} *` : h,
    width: [40, 28, 45, 14, 14, 14, 10, 22, 16, 35, 30][i] }))
  const h = ws.getRow(1)
  h.font = { bold: true, color: { argb: 'FFFFFFFF' } }
  h.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3A35B8' } }
  h.alignment = { vertical: 'middle' }
  h.height = 22

  const ate = 1000
  const lista = (col: string, letra: string, n: number, msg: string) => {
    if (!n) return
    for (let r = 2; r <= ate; r++) ws.getCell(`${col}${r}`).dataValidation = {
      type: 'list', allowBlank: true, formulae: [`Listas!$${letra}$2:$${letra}$${n + 1}`],
      showErrorMessage: true, errorStyle: 'stop', errorTitle: 'Valor inválido', error: msg,
    }
  }
  lista('C', 'A', cats.length, 'Escolha uma categoria da lista.')
  lista('H', 'B', centros.length, 'Escolha um centro de custo da lista.')
  lista('K', 'C', empresas.length, 'Escolha uma empresa da lista.')
  for (let r = 2; r <= ate; r++) {
    ws.getCell(`D${r}`).numFmt = '#,##0.00'
    ws.getCell(`D${r}`).dataValidation = { type: 'decimal', operator: 'greaterThan', allowBlank: true, formulae: [0], showErrorMessage: true, error: 'Informe um valor maior que zero.' }
    for (const c of ['E', 'F']) {
      ws.getCell(`${c}${r}`).numFmt = 'dd/mm/yyyy'
      ws.getCell(`${c}${r}`).dataValidation = { type: 'date', operator: 'greaterThan', allowBlank: true, formulae: [new Date(Date.UTC(2000, 0, 1))], showErrorMessage: true, error: 'Informe uma data (dd/mm/aaaa).' }
    }
    ws.getCell(`G${r}`).dataValidation = { type: 'whole', operator: 'between', allowBlank: true, formulae: [1, 120], showErrorMessage: true, error: 'Parcelas: número inteiro de 1 a 120.' }
  }

  instr.columns = [{ width: 110 }]
  ;[
    `Como preencher — ${titulo}`, '',
    `1. Preencha uma conta por linha na aba "${titulo}". Colunas com * são obrigatórias.`,
    '2. Categoria: escolha na lista suspensa (código — nome do plano de contas). Também aceitamos só o código (ex.: 5.2.1) ou o nome exato.',
    '3. Valor: número (ex.: 1500,90). Com Parcelas maior que 1, o valor é o TOTAL e o sistema divide em parcelas mensais.',
    '4. Vencimento e Competência: datas no formato dd/mm/aaaa. Sem competência, usamos o vencimento (a competência define o mês na DRE).',
    `5. ${ctx.tipo === 'pagar' ? 'Fornecedor' : 'Cliente'}: nome. Se não existir no sistema, será cadastrado automaticamente.`,
    '6. Centro de custo e Empresa: opcionais, escolha na lista. Sem empresa, usamos a empresa selecionada no sistema.',
    '7. Não altere os títulos da primeira linha. Linhas vazias são ignoradas.',
    '8. Antes de gravar, o sistema mostra a prévia com os erros de cada linha. Reimportar o mesmo arquivo não duplica contas.',
    '', 'Exemplo:',
    `Aluguel novembro | ${ctx.tipo === 'pagar' ? 'Imobiliária Central' : 'Cliente Exemplo'} | ${cats[0] ?? '5.2.1 — Aluguel e condomínio'} | 3500,00 | 10/12/2026 | 01/12/2026 | 1`,
  ].forEach((t, i) => { const c = instr.getCell(i + 1, 1); c.value = t; if (i === 0) c.font = { bold: true, size: 14 } })

  const buf = await wb.xlsx.writeBuffer()
  const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const a = document.createElement('a')
  a.href = url; a.download = `modelo-${ctx.tipo === 'pagar' ? 'contas-a-pagar' : 'contas-a-receber'}.xlsx`
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000)
}
