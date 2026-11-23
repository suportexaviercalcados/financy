import { Fragment, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, FileSpreadsheet, FileText, XCircle } from 'lucide-react'
import { rpc } from '@/lib/supabase'
import { useOrg } from '@/contexts/org'
import { brl, data, mesAno } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Carregando, PageHeader } from '@/components/common'
import { Seletor } from '@/components/form'
import { cn } from '@/lib/utils'

const LINHAS: { k: string; r: string; sub?: boolean; sinal?: -1 }[] = [
  { k: 'saldo_inicial', r: 'Saldo inicial de caixa', sub: true },
  { k: 'operacional_entradas', r: 'Recebimentos operacionais' },
  { k: 'operacional_saidas', r: '(−) Pagamentos operacionais', sinal: -1 },
  { k: 'operacional', r: '(=) Caixa das atividades operacionais', sub: true },
  { k: 'investimento', r: '(±) Caixa das atividades de investimento', sub: true },
  { k: 'financiamento', r: '(±) Caixa das atividades de financiamento', sub: true },
  { k: 'saldos_iniciais_novas_contas', r: '(+) Saldos iniciais de contas abertas no período' },
  { k: 'variacao', r: '(=) Variação líquida de caixa', sub: true },
  { k: 'saldo_final', r: 'Saldo final de caixa', sub: true },
  { k: 'saldo_bancario_final', r: 'Saldo das contas bancárias (conferência)' },
]
const GRUPO: Record<string, string> = { operacional: 'Operacional', investimento: 'Investimento', financiamento: 'Financiamento' }

export default function DFC() {
  const { org, empresaIds, periodo } = useOrg()
  const [gran, setGran] = useState('mes')
  const args = { p_org: org?.id, p_empresas: empresaIds, p_ini: periodo.inicio, p_fim: periodo.fim, p_gran: gran }
  const dfc = useQuery({ queryKey: ['dfc', args], enabled: !!org, queryFn: () => rpc<any[]>('fn_dfc', args) })
  const tot = useQuery({ queryKey: ['dfc-tot', args], enabled: !!org, queryFn: () => rpc<any[]>('fn_dfc', { ...args, p_gran: 'total' }) })
  const cats = useQuery({ queryKey: ['dfc-cat', args], enabled: !!org, queryFn: () => rpc<any[]>('fn_dfc_categorias', { ...args, p_gran: 'total' }) })
  const ind = useQuery({ queryKey: ['dfc-ind', args], enabled: !!org, queryFn: () => rpc<any[]>('fn_dfc_indireto', { p_org: org!.id, p_empresas: empresaIds, p_ini: periodo.inicio, p_fim: periodo.fim }) })
  const per = dfc.data ?? []; const t = tot.data?.[0]
  const rot = (p: string) => gran === 'mes' ? mesAno(p) : gran === 'trimestre' ? `${Math.floor(Number(p.slice(5, 7)) / 3) + 1}º tri/${p.slice(2, 4)}` : p.slice(0, 4)
  const v = (row: any, l: (typeof LINHAS)[number]) => Number(row?.[l.k] ?? 0) * (l.sinal ?? 1)
  const confere = t && Math.abs(Number(t.saldo_final) - Number(t.saldo_bancario_final)) < 0.01
  const exportar = async (tipo: 'xlsx' | 'pdf') => {
    const { exportarExcel, exportarPDF } = await import('@/lib/export')
    const f = (x: number) => (tipo === 'xlsx' ? x : brl(x)) as any
    const cols = [{ titulo: 'Linha', valor: (l: any) => l.r }, ...per.map((p, i) => ({ titulo: rot(p.periodo), valor: (l: any) => f(v(per[i], l)) })), { titulo: 'Período', valor: (l: any) => f(v(t, l)) }]
    if (tipo === 'xlsx') exportarExcel('DFC', cols, LINHAS)
    else exportarPDF('DFC', 'Demonstração do Fluxo de Caixa — método direto', `${data(periodo.inicio)} a ${data(periodo.fim)} · regime de caixa`, cols, LINHAS, l => !!l.sub)
  }
  return (
    <div className="space-y-6">
      <PageHeader titulo="DFC — Demonstração do Fluxo de Caixa" descricao="Regime de caixa, método direto, conciliado com o saldo das contas bancárias."
        acoes={<>
          <Seletor aria-label="Visão" className="w-auto" value={gran} onChange={e => setGran(e.target.value)} opcoes={[{ value: 'mes', label: 'Mensal' }, { value: 'trimestre', label: 'Trimestral' }, { value: 'ano', label: 'Anual' }]} />
          <Button variant="outline" size="sm" onClick={() => exportar('xlsx')}><FileSpreadsheet />Excel</Button>
          <Button variant="outline" size="sm" onClick={() => exportar('pdf')}><FileText />PDF</Button>
        </>} />
      {t && <p className={cn('flex items-center gap-2 text-sm', confere ? 'text-positivo' : 'text-negativo')}>
        {confere ? <CheckCircle2 className="size-4" /> : <XCircle className="size-4" />}
        {confere ? 'Saldo final da DFC confere com o saldo das contas bancárias.' : `Diferença de ${brl(Number(t.saldo_final) - Number(t.saldo_bancario_final))} entre DFC e saldo bancário.`}
      </p>}
      {dfc.isLoading ? <Carregando linhas={10} /> : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader><TableRow><TableHead className="sticky left-0 min-w-80 bg-card">Método direto</TableHead>
              {per.map(p => <TableHead key={p.periodo} className="text-right">{rot(p.periodo)}</TableHead>)}<TableHead className="text-right">Período</TableHead></TableRow></TableHeader>
            <TableBody>
              {LINHAS.map(l => (
                <TableRow key={l.k} className={cn(l.sub && 'bg-muted/40 font-semibold', l.k === 'saldo_bancario_final' && 'text-xs text-muted-foreground')}>
                  <TableCell className="sticky left-0 bg-inherit">{l.r}</TableCell>
                  {per.map(p => <TableCell key={p.periodo} className={cn('text-right tabular', v(p, l) < 0 && 'text-negativo')}>{brl(v(p, l))}</TableCell>)}
                  <TableCell className={cn('text-right tabular', v(t, l) < 0 && 'text-negativo')}>{t ? brl(v(t, l)) : '—'}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><CardTitle className="text-sm">Detalhamento por atividade e categoria (período)</CardTitle></CardHeader><CardContent>
          {Object.keys(GRUPO).map(g => {
            const linhas = (cats.data ?? []).filter(c => c.dfc_grupo === g)
            if (!linhas.length) return null
            return <Fragment key={g}>
              <p className="mt-3 mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{GRUPO[g]}</p>
              {linhas.map(c => <div key={g + c.categoria} className="flex justify-between border-b py-1 text-sm"><span>{c.categoria}</span>
                <span className="tabular">{Number(c.entradas) ? <span className="text-positivo">+{brl(c.entradas)}</span> : null} {Number(c.saidas) ? <span className="text-negativo">−{brl(c.saidas)}</span> : null}</span></div>)}
            </Fragment>
          })}
          {!cats.data?.length && <p className="text-sm text-muted-foreground">Sem movimentações no período.</p>}
        </CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm">Método indireto (a partir do lucro líquido da DRE)</CardTitle></CardHeader><CardContent>
          {(ind.data ?? []).map(l => <div key={l.ordem} className={cn('flex justify-between border-b py-1.5 text-sm', (l.ordem === 1 || l.ordem === 6) && 'font-semibold')}>
            <span>{l.linha}</span><span className={cn('tabular', Number(l.valor) < 0 && 'text-negativo')}>{brl(l.valor)}</span></div>)}
          <p className="mt-3 text-xs text-muted-foreground">A variação de capital de giro reconcilia a diferença entre competência (DRE) e caixa: recebíveis ainda não recebidos, contas a pagar ainda não pagas e impostos estimados a recolher.</p>
        </CardContent></Card>
      </div>
    </div>
  )
}
