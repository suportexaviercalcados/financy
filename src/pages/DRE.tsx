import { Fragment, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, FileSpreadsheet, FileText } from 'lucide-react'
import { rpc } from '@/lib/supabase'
import { useOrg } from '@/contexts/org'
import { useCanais, opcoes } from '@/hooks/lookups'
import { brl, data, mesAno, pct } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Aviso, Carregando, PageHeader } from '@/components/common'
import { Seletor } from '@/components/form'
import { Drilldown } from '@/components/Drilldown'
import { cn } from '@/lib/utils'

export const LINHAS_DRE: { k: string; r: string; grupos?: string[]; sinal?: -1 | 1; sub?: boolean }[] = [
  { k: 'receita_bruta', r: 'Receita bruta de vendas', grupos: ['receita_bruta'] },
  { k: 'deducoes_impostos', r: '(−) Impostos sobre vendas', grupos: ['deducoes_impostos'], sinal: -1 },
  { k: 'deducoes_devolucoes', r: '(−) Devoluções e descontos', grupos: ['deducoes_devolucoes'], sinal: -1 },
  { k: 'receita_liquida', r: '(=) Receita líquida', sub: true },
  { k: 'cmv', r: '(−) CMV', grupos: ['cmv'], sinal: -1 },
  { k: 'lucro_bruto', r: '(=) Lucro bruto', sub: true },
  { k: 'despesa_variavel', r: '(−) Despesas variáveis de venda', grupos: ['despesa_variavel'], sinal: -1 },
  { k: 'margem_contribuicao', r: '(=) Margem de contribuição', sub: true },
  { k: 'despesa_fixa', r: '(−) Despesas fixas', grupos: ['despesa_fixa'], sinal: -1 },
  { k: 'ebitda', r: '(=) EBITDA', sub: true },
  { k: 'depreciacao', r: '(−) Depreciação', grupos: ['depreciacao'], sinal: -1 },
  { k: 'receita_financeira', r: '(+) Receitas financeiras', grupos: ['receita_financeira'] },
  { k: 'despesa_financeira', r: '(−) Despesas financeiras', grupos: ['despesa_financeira'], sinal: -1 },
  { k: 'lair', r: '(=) Resultado antes de IRPJ/CSLL', sub: true },
  { k: 'impostos_lucro', r: '(−) IRPJ e CSLL', grupos: ['impostos_lucro'], sinal: -1 },
  { k: 'lucro_liquido', r: '(=) Lucro líquido', sub: true },
]

export default function DRE() {
  const { org, empresaIds, periodo, empresas, empresaId } = useOrg()
  const canais = useCanais()
  const [gran, setGran] = useState('mes'); const [canal, setCanal] = useState(''); const [orcado, setOrcado] = useState(false)
  const [abertos, setAbertos] = useState<Set<string>>(new Set())
  const [drill, setDrill] = useState<{ grupos: string[]; ini: string; fim: string; titulo: string; categoria?: string } | null>(null)
  const args = { p_org: org?.id, p_empresas: empresaIds, p_ini: periodo.inicio, p_fim: periodo.fim, p_gran: gran, p_canal: canal || null }
  const dre = useQuery({ queryKey: ['dre', args], enabled: !!org, queryFn: () => rpc<any[]>('fn_dre', args) })
  const tot = useQuery({ queryKey: ['dre-total', args], enabled: !!org, queryFn: () => rpc<any[]>('fn_dre', { ...args, p_gran: 'total' }) })
  const cats = useQuery({ queryKey: ['dre-cat', args], enabled: !!org, queryFn: () => rpc<any[]>('fn_dre_categorias', args) })
  const per = dre.data ?? []; const total = tot.data?.[0]
  const fimPer = (_p: string, i: number) => (per[i + 1] ? new Date(Date.parse(per[i + 1].periodo) - 864e5).toISOString().slice(0, 10) : periodo.fim)
  const rotuloPer = (p: string) => gran === 'mes' ? mesAno(p) : gran === 'trimestre' ? `${Math.floor(Number(p.slice(5, 7)) / 3) + 1}º tri/${p.slice(2, 4)}` : gran === 'ano' ? p.slice(0, 4) : 'Período'
  const valor = (row: any, l: (typeof LINHAS_DRE)[number]) => (row ? Number(row[l.k]) * (l.sinal ?? 1) : 0)
  const orc = (grupos: string[] | undefined, p: string | null, cat?: string) => (cats.data ?? []).filter(c => grupos?.includes(c.grupo) && (!p || c.periodo === p) && (!cat || c.categoria_id === cat))
    .reduce((s, c) => s + Number(c.orcado ?? 0), 0)
  const base = (row: any) => Number(row?.receita_liquida) || 0
  const nomeEmpresa = empresaId ? empresas.find(e => e.id === empresaId)?.razao_social : 'Consolidado'

  const exportar = async (tipo: 'xlsx' | 'pdf') => {
    const { exportarExcel, exportarPDF } = await import('@/lib/export')
    const colunas = [{ titulo: 'Linha', valor: (l: any) => l.r }, ...per.map((p, i) => ({ titulo: rotuloPer(p.periodo), valor: (l: any) => fmt(valor(per[i], l)) })),
      { titulo: 'Total', valor: (l: any) => fmt(valor(total, l)) }, { titulo: 'AV %', valor: (l: any) => base(total) ? pct(100 * valor(total, l) / base(total)) : '—' }]
    const fmt = (v: number) => (tipo === 'xlsx' ? Math.round(v * 100) / 100 : brl(v)) as any
    const sub = `${nomeEmpresa} · ${data(periodo.inicio)} a ${data(periodo.fim)}${canal ? ' · canal ' + canais.data?.find(c => c.id === canal)?.nome : ''} · regime de competência`
    if (tipo === 'xlsx') exportarExcel('DRE', colunas, LINHAS_DRE); else exportarPDF('DRE', 'DRE gerencial', sub, colunas, LINHAS_DRE, l => !!l.sub)
  }

  return (
    <div>
      <PageHeader titulo="DRE gerencial" descricao="Regime de competência. Clique em qualquer valor para ver os lançamentos que o compõem."
        acoes={<>
          <Seletor aria-label="Visão" className="w-auto" value={gran} onChange={e => setGran(e.target.value)} opcoes={[{ value: 'mes', label: 'Mensal' }, { value: 'trimestre', label: 'Trimestral' }, { value: 'ano', label: 'Anual' }]} />
          <Seletor aria-label="Canal" className="w-auto" value={canal} onChange={e => setCanal(e.target.value)} vazio="Todos os canais" opcoes={opcoes(canais.data)} />
          <Button variant={orcado ? 'default' : 'outline'} size="sm" onClick={() => setOrcado(o => !o)} disabled={!!canal}>Realizado × orçado</Button>
          <Button variant="outline" size="sm" onClick={() => exportar('xlsx')}><FileSpreadsheet />Excel</Button>
          <Button variant="outline" size="sm" onClick={() => exportar('pdf')}><FileText />PDF</Button>
        </>} />
      {canal && <Aviso className="mb-4">DRE do canal: receitas, CMV e despesas variáveis do próprio canal; despesas sem canal (fixas, financeiras e demais) rateadas {org?.rateio_modo === 'manual' ? 'pelo percentual manual do canal' : 'proporcionalmente ao faturamento do canal em cada mês'}.</Aviso>}
      {dre.isLoading ? <Carregando linhas={12} /> : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader><TableRow>
              <TableHead className="sticky left-0 z-10 min-w-72 bg-card">Demonstração do resultado</TableHead>
              {per.map((p, i) => <Fragment key={p.periodo}><TableHead className="text-right">{rotuloPer(p.periodo)}</TableHead>
                {gran !== 'total' && i > 0 && !orcado && <TableHead className="text-right text-xs">AH</TableHead>}
                {orcado && <><TableHead className="text-right text-xs">Orçado</TableHead><TableHead className="text-right text-xs">Var.</TableHead></>}</Fragment>)}
              <TableHead className="text-right">Total</TableHead><TableHead className="text-right">AV %</TableHead>
            </TableRow></TableHeader>
            <TableBody>
              {LINHAS_DRE.map(l => {
                const exp = abertos.has(l.k)
                const catsLinha = l.grupos ? [...new Map((cats.data ?? []).filter(c => l.grupos!.includes(c.grupo)).map(c => [c.categoria_id, c.categoria])).entries()] : []
                return (
                  <Fragment key={l.k}>
                    <TableRow className={cn(l.sub && 'bg-muted/40 font-semibold', l.k === 'lucro_liquido' && 'bg-primary/5')}>
                      <TableCell className={cn('sticky left-0 z-10 bg-inherit', !l.sub && 'pl-4')}>
                        {l.grupos && catsLinha.length > 0 ? (
                          <button className="inline-flex items-center gap-1" onClick={() => setAbertos(s => { const n = new Set(s); if (n.has(l.k)) n.delete(l.k); else n.add(l.k); return n })}>
                            {exp ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}{l.r}
                          </button>) : l.r}
                      </TableCell>
                      {per.map((p, i) => {
                        const v = valor(p, l); const ant = i > 0 ? valor(per[i - 1], l) : null
                        return <Fragment key={p.periodo}>
                          <TableCell className="text-right tabular">
                            {l.grupos ? <button className="hover:underline" onClick={() => setDrill({ grupos: l.grupos!, ini: p.periodo, fim: fimPer(p.periodo, i), titulo: `${l.r} — ${rotuloPer(p.periodo)}` })}>{brl(v)}</button>
                              : <span className={cn(v < 0 && 'text-negativo')}>{brl(v)}</span>}
                          </TableCell>
                          {i > 0 && !orcado && <TableCell className="text-right text-xs text-muted-foreground tabular">{ant ? pct(100 * (v - ant) / Math.abs(ant)) : '—'}</TableCell>}
                          {orcado && <OrcCols v={v} o={l.grupos ? orc(l.grupos, p.periodo) * (l.sinal ?? 1) : null} />}
                        </Fragment>
                      })}
                      <TableCell className={cn('text-right font-medium tabular', valor(total, l) < 0 && l.sub && 'text-negativo')}>
                        {l.grupos ? <button className="hover:underline" onClick={() => setDrill({ grupos: l.grupos!, ini: periodo.inicio, fim: periodo.fim, titulo: l.r })}>{brl(valor(total, l))}</button> : brl(valor(total, l))}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground tabular">{base(total) ? pct(100 * valor(total, l) / base(total)) : '—'}</TableCell>
                    </TableRow>
                    {exp && catsLinha.map(([catId, nome]) => (
                      <TableRow key={l.k + catId} className="text-xs">
                        <TableCell className="sticky left-0 z-10 bg-card pl-10 text-muted-foreground">{nome}</TableCell>
                        {per.map((p, i) => {
                          const v = (cats.data ?? []).filter(c => c.periodo === p.periodo && c.categoria_id === catId && l.grupos!.includes(c.grupo)).reduce((s, c) => s + Number(c.valor), 0) * (l.sinal ?? 1)
                          return <Fragment key={p.periodo}>
                            <TableCell className="text-right tabular"><button className="hover:underline" onClick={() => setDrill({ grupos: l.grupos!, categoria: catId ?? undefined, ini: p.periodo, fim: fimPer(p.periodo, i), titulo: `${nome} — ${rotuloPer(p.periodo)}` })}>{brl(v)}</button></TableCell>
                            {i > 0 && !orcado && <TableCell />}
                            {orcado && <OrcCols v={v} o={orc(l.grupos, p.periodo, catId) * (l.sinal ?? 1)} />}
                          </Fragment>
                        })}
                        <TableCell className="text-right tabular">{brl((cats.data ?? []).filter(c => c.categoria_id === catId && l.grupos!.includes(c.grupo)).reduce((s, c) => s + Number(c.valor), 0) * (l.sinal ?? 1))}</TableCell>
                        <TableCell />
                      </TableRow>
                    ))}
                  </Fragment>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
      <p className="mt-3 text-xs text-muted-foreground">AV % = análise vertical sobre a receita líquida. AH = variação em relação ao período anterior. Impostos sobre vendas: {empresas.some(e => e.imposto_vendas_modo === 'estimado') ? 'estimados pela alíquota efetiva cadastrada na empresa' : 'pelas guias lançadas'}.</p>
      {drill && <Drilldown titulo={drill.titulo} grupos={drill.grupos} categoria={drill.categoria} ini={drill.ini} fim={drill.fim} canal={canal || null} onFechar={() => setDrill(null)} />}
    </div>
  )
}

function OrcCols({ v, o }: { v: number; o: number | null }) {
  if (o == null || o === 0) return <><TableCell className="text-right text-xs text-muted-foreground">—</TableCell><TableCell /></>
  const d = v - o
  return <><TableCell className="text-right text-xs tabular">{brl(o)}</TableCell><TableCell className={cn('text-right text-xs tabular', d < 0 ? 'text-negativo' : 'text-positivo')}>{pct(100 * d / Math.abs(o))}</TableCell></>
}
