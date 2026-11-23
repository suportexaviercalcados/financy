import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Plus, Trash2 } from 'lucide-react'
import { supabase, rpc, unwrap } from '@/lib/supabase'
import { useOrg } from '@/contexts/org'
import { useContasBancarias, opcoes } from '@/hooks/lookups'
import { brl, brlCompacto, data, hoje, mesAno } from '@/lib/format'
import { simular, type Cenario } from '@/lib/simulacao'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DataTable, type Coluna } from '@/components/DataTable'
import { Aviso, Dinheiro, Kpi, PageHeader } from '@/components/common'
import { Campo, EntradaValor, Grade, Seletor } from '@/components/form'
import { cn } from '@/lib/utils'

const tooltip = { contentStyle: { background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 } }

export default function FluxoCaixa() {
  const { org, empresaIds, periodo } = useOrg()
  const contas = useContasBancarias()
  const [gran, setGran] = useState<'dia' | 'semana' | 'mes'>('dia')
  const [conta, setConta] = useState('')
  const fluxo = useQuery({ queryKey: ['fluxo', org?.id, empresaIds, periodo, gran, conta], enabled: !!org,
    queryFn: () => rpc<any[]>('fn_fluxo_caixa', { p_org: org!.id, p_empresas: empresaIds, p_ini: periodo.inicio, p_fim: periodo.fim, p_gran: gran, p_contas: conta ? [conta] : null }) })
  const saldos = useQuery({ queryKey: ['saldos', org?.id, empresaIds], enabled: !!org,
    queryFn: () => rpc<any[]>('fn_saldos_contas', { p_org: org!.id, p_empresas: empresaIds, p_data: hoje() }) })
  const nOuNulo = (v: unknown) => (v === null || v === undefined ? null : Number(v))
  const l = (fluxo.data ?? []).map(p => ({ ...p, rotulo: gran === 'mes' ? mesAno(p.periodo) : data(p.periodo).slice(0, 5),
    realizado_entradas: Number(p.realizado_entradas), realizado_saidas: Number(p.realizado_saidas),
    previsto_entradas: Number(p.previsto_entradas), previsto_saidas: Number(p.previsto_saidas),
    saldo_realizado: nOuNulo(p.saldo_realizado), saldo_projetado: nOuNulo(p.saldo_projetado),
    saldo: nOuNulo(p.saldo_realizado) ?? nOuNulo(p.saldo_projetado), saidas_neg: -Number(p.realizado_saidas) }))
  const negativos = l.filter(p => p.saldo_projetado != null && Number(p.saldo_projetado) < 0 && p.periodo >= hoje())
  const colunas: Coluna<any>[] = [
    { id: 'p', titulo: 'Período', celula: p => gran === 'mes' ? mesAno(p.periodo) : data(p.periodo), valor: p => p.periodo },
    { id: 'pe', titulo: 'Entradas previstas', alinhar: 'right', celula: p => brl(p.previsto_entradas), valor: p => Number(p.previsto_entradas) },
    { id: 're', titulo: 'Entradas realizadas', alinhar: 'right', celula: p => brl(p.realizado_entradas), valor: p => Number(p.realizado_entradas) },
    { id: 'ps', titulo: 'Saídas previstas', alinhar: 'right', celula: p => brl(p.previsto_saidas), valor: p => Number(p.previsto_saidas) },
    { id: 'rs', titulo: 'Saídas realizadas', alinhar: 'right', celula: p => brl(p.realizado_saidas), valor: p => Number(p.realizado_saidas) },
    { id: 'dif', titulo: 'Diferença (realizado − previsto)', alinhar: 'right', valor: p => (p.realizado_entradas - p.realizado_saidas) - (p.previsto_entradas - p.previsto_saidas),
      celula: p => { if (p.periodo > hoje()) return <span className="text-muted-foreground">—</span>
        const d = (Number(p.realizado_entradas) - Number(p.realizado_saidas)) - (Number(p.previsto_entradas) - Number(p.previsto_saidas))
        return <span className={cn(Math.abs(d) > 0.009 && (d < 0 ? 'font-medium text-negativo' : 'font-medium text-positivo'))}>{brl(d)}</span> } },
    { id: 's', titulo: 'Saldo (realizado / projetado)', alinhar: 'right', valor: p => Number(p.saldo),
      celula: p => <span className={cn(p.saldo_realizado == null && 'italic')}><Dinheiro v={p.saldo} /></span> },
  ]
  return (
    <div className="space-y-6">
      <PageHeader titulo="Fluxo de caixa" descricao="Regime de caixa: realizado (baixas e transferências) versus previsto (vencimentos), com projeção pelas contas em aberto." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi titulo="Saldo consolidado hoje" valor={<Dinheiro v={(saldos.data ?? []).reduce((s, c) => s + Number(c.saldo), 0)} />} />
        {(saldos.data ?? []).slice(0, 3).map(c => <Kpi key={c.conta_bancaria_id} titulo={c.nome} valor={<Dinheiro v={c.saldo} />} />)}
      </div>
      <Tabs defaultValue="fluxo">
        <TabsList><TabsTrigger value="fluxo">Realizado × previsto</TabsTrigger><TabsTrigger value="simulacao">Projeção e simulação</TabsTrigger></TabsList>
        <TabsContent value="fluxo" className="space-y-4 pt-4">
          <div className="flex flex-wrap gap-2">
            <Seletor aria-label="Granularidade" className="w-auto" value={gran} onChange={e => setGran(e.target.value as any)} opcoes={[{ value: 'dia', label: 'Diário' }, { value: 'semana', label: 'Semanal' }, { value: 'mes', label: 'Mensal' }]} />
            <Seletor aria-label="Conta" className="w-auto" value={conta} onChange={e => setConta(e.target.value)} vazio="Todas as contas (consolidado)" opcoes={opcoes(contas.data)} />
          </div>
          {negativos.length > 0 && <Aviso>Saldo projetado negativo a partir de {gran === 'mes' ? mesAno(negativos[0].periodo) : data(negativos[0].periodo)} ({brl(negativos[0].saldo_projetado)}). Antecipe recebíveis, renegocie pagamentos ou simule cenários.</Aviso>}
          <Card><CardContent className="h-80 pt-4">
            <ResponsiveContainer><ComposedChart data={l} stackOffset="sign"><CartesianGrid vertical={false} strokeOpacity={0.15} />
              <XAxis dataKey="rotulo" fontSize={11} /><YAxis tickFormatter={brlCompacto} fontSize={11} width={72} />
              <Tooltip formatter={(v) => brl(Math.abs(Number(v)))} {...tooltip} /><Legend wrapperStyle={{ fontSize: 12 }} />
              <ReferenceLine y={0} stroke="var(--border)" />
              <Bar dataKey="realizado_entradas" name="Entradas" fill="var(--chart-2)" stackId="r" />
              <Bar dataKey="saidas_neg" name="Saídas" fill="var(--chart-4)" stackId="r" />
              <Line dataKey="saldo" name="Saldo (realizado/projetado)" stroke="var(--chart-1)" strokeWidth={2} dot={false} type="monotone" connectNulls isAnimationActive={false} />
            </ComposedChart></ResponsiveContainer>
          </CardContent></Card>
          <DataTable colunas={colunas} linhas={l} carregando={fluxo.isLoading} busca={false} chave={p => p.periodo} compacta
            exportar={{ nome: 'fluxo-de-caixa', titulo: 'Fluxo de caixa', subtitulo: `${data(periodo.inicio)} a ${data(periodo.fim)} — ${gran}` }} />
          {conta && <p className="text-xs text-muted-foreground">Com uma conta selecionada, o realizado inclui transferências daquela conta; o previsto considera todos os vencimentos da empresa.</p>}
        </TabsContent>
        <TabsContent value="simulacao" className="pt-4"><Simulacao /></TabsContent>
      </Tabs>
    </div>
  )
}

function Simulacao() {
  const { org, empresaIds } = useOrg()
  const [dias, setDias] = useState(90)
  const [c, setC] = useState<Cenario>({ atrasoRecebimentosDias: 0, inadimplenciaPct: 0, novasDespesas: [] })
  const [ant, setAnt] = useState({ ativa: false, ate: '', taxa: 2.5 })
  const base = useQuery({ queryKey: ['simulacao-base', org?.id, empresaIds], enabled: !!org, queryFn: async () => {
    let x = supabase.from('titulos').select('id, tipo, valor, valor_pago, data_vencimento, adquirente_id, valor_taxa').eq('organizacao_id', org!.id).in('status', ['aberto', 'parcial'])
    if (empresaIds) x = x.in('empresa_id', empresaIds)
    const t = unwrap(await x) as any[]
    const saldo = await rpc<number>('fn_saldo_total', { p_org: org!.id, p_empresas: empresaIds, p_data: hoje() })
    return { saldo: Number(saldo), titulos: t.map(r => ({ id: r.id, tipo: r.tipo, saldo: Number(r.valor) - Number(r.valor_pago), vencimento: r.data_vencimento, adquirente: !!r.adquirente_id || r.valor_taxa != null })) }
  } })
  const serie = useMemo(() => base.data ? simular(base.data.saldo, hoje(), dias, base.data.titulos,
    { ...c, antecipacao: ant.ativa && ant.ate ? { ate: ant.ate, taxaPct: ant.taxa } : undefined }) : [], [base.data, dias, c, ant])
  const minB = Math.min(...serie.map(p => p.base)), minS = Math.min(...serie.map(p => p.simulado))
  const negS = serie.find(p => p.simulado < 0)
  const desp = c.novasDespesas ?? []
  return (
    <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
      <Card><CardHeader><CardTitle className="text-sm">Cenário (não altera dados reais)</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <Campo rotulo="Horizonte"><Seletor value={String(dias)} onChange={e => setDias(Number(e.target.value))} opcoes={[30, 60, 90, 180].map(d => ({ value: String(d), label: `${d} dias` }))} /></Campo>
          <Grade>
            <Campo rotulo="Atraso nos recebimentos (dias)"><Input type="number" min={0} value={c.atrasoRecebimentosDias} onChange={e => setC({ ...c, atrasoRecebimentosDias: Number(e.target.value) })} /></Campo>
            <Campo rotulo="Inadimplência (%)"><Input type="number" min={0} max={100} value={c.inadimplenciaPct} onChange={e => setC({ ...c, inadimplenciaPct: Number(e.target.value) })} /></Campo>
          </Grade>
          <div className="space-y-2">
            <p className="text-sm font-medium">Novas despesas</p>
            {desp.map((d, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-1">
                <EntradaValor valor={d.valor} onChange={v => setC({ ...c, novasDespesas: desp.map((x, j) => j === i ? { ...x, valor: v } : x) })} />
                <Input type="date" value={d.data} onChange={e => setC({ ...c, novasDespesas: desp.map((x, j) => j === i ? { ...x, data: e.target.value } : x) })} />
                <Button size="icon-sm" variant="ghost" onClick={() => setC({ ...c, novasDespesas: desp.filter((_, j) => j !== i) })} aria-label="Remover"><Trash2 /></Button>
                <Seletor className="col-span-3" value={String(d.recorrenteMeses ?? 1)} onChange={e => setC({ ...c, novasDespesas: desp.map((x, j) => j === i ? { ...x, recorrenteMeses: Number(e.target.value) } : x) })}
                  opcoes={[1, 2, 3, 6, 12].map(n => ({ value: String(n), label: n === 1 ? 'Única' : `Mensal por ${n} meses` }))} />
              </div>
            ))}
            <Button variant="outline" size="sm" onClick={() => setC({ ...c, novasDespesas: [...desp, { descricao: 'Nova despesa', valor: 1000, data: hoje(), recorrenteMeses: 1 }] })}><Plus />Despesa</Button>
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={ant.ativa} onChange={e => setAnt({ ...ant, ativa: e.target.checked })} />Antecipar recebíveis de cartão</label>
            {ant.ativa && <Grade><Campo rotulo="Com vencimento até"><Input type="date" value={ant.ate} onChange={e => setAnt({ ...ant, ate: e.target.value })} /></Campo>
              <Campo rotulo="Taxa de antecipação (%)"><Input type="number" step="0.1" value={ant.taxa} onChange={e => setAnt({ ...ant, taxa: Number(e.target.value) })} /></Campo></Grade>}
          </div>
        </CardContent>
      </Card>
      <div className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <Kpi titulo="Saldo hoje" valor={<Dinheiro v={base.data?.saldo} />} />
          <Kpi titulo="Menor saldo (base)" valor={<Dinheiro v={serie.length ? minB : null} />} />
          <Kpi titulo="Menor saldo (cenário)" valor={<Dinheiro v={serie.length ? minS : null} />} alerta={negS ? `Negativo a partir de ${data(negS.data)}` : undefined} />
        </div>
        <Card><CardContent className="h-80 pt-4">
          <ResponsiveContainer><ComposedChart data={serie.map(p => ({ ...p, rotulo: data(p.data).slice(0, 5) }))}><CartesianGrid vertical={false} strokeOpacity={0.15} />
            <XAxis dataKey="rotulo" fontSize={11} interval="preserveStartEnd" /><YAxis tickFormatter={brlCompacto} fontSize={11} width={72} />
            <Tooltip formatter={(v) => brl(v)} {...tooltip} /><Legend wrapperStyle={{ fontSize: 12 }} /><ReferenceLine y={0} stroke="var(--negativo)" strokeDasharray="4 4" />
            <Line dataKey="base" name="Projeção atual" stroke="var(--chart-1)" dot={false} strokeWidth={2} />
            <Line dataKey="simulado" name="Cenário simulado" stroke="var(--chart-3)" dot={false} strokeWidth={2} strokeDasharray="5 3" />
          </ComposedChart></ResponsiveContainer>
        </CardContent></Card>
        <p className="text-xs text-muted-foreground">A projeção considera o saldo atual e todas as contas em aberto (vencidas projetadas para hoje), incluindo recebíveis de cartão, recorrências já geradas e parcelas de empréstimos.</p>
      </div>
    </div>
  )
}
