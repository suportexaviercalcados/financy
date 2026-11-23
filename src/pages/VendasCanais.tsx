import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle } from 'lucide-react'
import { rpc } from '@/lib/supabase'
import { useOrg } from '@/contexts/org'
import { useCanais, opcoes } from '@/hooks/lookups'
import { brl, brlCompacto, data, num, pct } from '@/lib/format'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DataTable, type Coluna } from '@/components/DataTable'
import { Aviso, PageHeader } from '@/components/common'
import { Seletor } from '@/components/form'

export const CORES = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)', 'var(--chart-5)', 'oklch(0.6 0.1 200)', 'oklch(0.65 0.12 120)']

export default function VendasCanais() {
  const { org, empresaIds, periodo } = useOrg()
  const canais = useCanais()
  const [canalRank, setCanalRank] = useState('')
  const q = useQuery({ queryKey: ['vendas-canal', org?.id, empresaIds, periodo], enabled: !!org,
    queryFn: () => rpc<any[]>('fn_vendas_por_canal', { p_org: org!.id, p_empresas: empresaIds, p_ini: periodo.inicio, p_fim: periodo.fim }) })
  const rank = useQuery({ queryKey: ['ranking', org?.id, empresaIds, periodo, canalRank], enabled: !!org,
    queryFn: () => rpc<any[]>('fn_ranking_produtos', { p_org: org!.id, p_empresas: empresaIds, p_ini: periodo.inicio, p_fim: periodo.fim, p_canal: canalRank || null, p_limite: 50 }) })
  const l = (q.data ?? []).map(r => ({ ...r, faturamento_bruto: Number(r.faturamento_bruto), margem_contribuicao: Number(r.margem_contribuicao) }))
  const tot = (k: string) => l.reduce((s, x) => s + Number(x[k]), 0)
  const semCusto = tot('vendas_sem_custo')
  const colunas: Coluna<any>[] = [
    { id: 'canal', titulo: 'Canal', celula: r => r.canal, valor: r => r.canal, rodape: 'Total' },
    { id: 'fat', titulo: 'Faturamento bruto', alinhar: 'right', celula: r => brl(r.faturamento_bruto), valor: r => Number(r.faturamento_bruto), rodape: brl(tot('faturamento_bruto')) },
    { id: 'part', titulo: 'Participação', alinhar: 'right', celula: r => pct(r.participacao), valor: r => Number(r.participacao) },
    { id: 'ped', titulo: 'Pedidos', alinhar: 'right', celula: r => num(r.pedidos), valor: r => Number(r.pedidos), rodape: num(tot('pedidos')) },
    { id: 'tm', titulo: 'Ticket médio', alinhar: 'right', celula: r => brl(r.ticket_medio), valor: r => Number(r.ticket_medio), rodape: brl(tot('faturamento_bruto') / (tot('pedidos') || 1)) },
    { id: 'ded', titulo: 'Deduções', alinhar: 'right', celula: r => brl(Number(r.descontos_devolucoes) + Number(r.impostos)), valor: r => Number(r.descontos_devolucoes) + Number(r.impostos) },
    { id: 'cmv', titulo: 'CMV', alinhar: 'right', valor: r => Number(r.cmv), rodape: brl(tot('cmv')),
      celula: r => <span className="inline-flex items-center gap-1">{brl(r.cmv)}{Number(r.vendas_sem_custo) > 0 && <AlertTriangle className="size-3.5 text-amber-500" />}</span> },
    { id: 'dv', titulo: 'Taxas, comissões e fretes', alinhar: 'right', celula: r => brl(r.despesas_variaveis), valor: r => Number(r.despesas_variaveis), rodape: brl(tot('despesas_variaveis')) },
    { id: 'mc', titulo: 'Margem de contribuição', alinhar: 'right', celula: r => <b>{brl(r.margem_contribuicao)}</b>, valor: r => Number(r.margem_contribuicao), rodape: brl(tot('margem_contribuicao')) },
    { id: 'mcp', titulo: 'MC %', alinhar: 'right', celula: r => pct(r.margem_percentual), valor: r => Number(r.margem_percentual) },
  ]
  const colRank: Coluna<any>[] = [
    { id: 'p', titulo: 'Produto', celula: r => <span className="inline-flex items-center gap-1">{r.produto}{r.sem_custo && <AlertTriangle className="size-3.5 text-amber-500" aria-label="Sem custo" />}</span>, valor: r => r.produto },
    { id: 'q', titulo: 'Quantidade', alinhar: 'right', celula: r => num(r.quantidade), valor: r => Number(r.quantidade) },
    { id: 'r', titulo: 'Receita', alinhar: 'right', celula: r => brl(r.receita), valor: r => Number(r.receita) },
    { id: 'c', titulo: 'CMV', alinhar: 'right', celula: r => brl(r.cmv), valor: r => Number(r.cmv) },
    { id: 'm', titulo: 'Margem bruta', alinhar: 'right', celula: r => brl(r.margem), valor: r => Number(r.margem) },
    { id: 'mp', titulo: 'Margem %', alinhar: 'right', celula: r => r.sem_custo ? <span className="text-muted-foreground">incompleta</span> : pct(r.margem_percentual), valor: r => Number(r.margem_percentual) },
  ]
  return (
    <div className="space-y-6">
      <PageHeader titulo="Vendas por canal" descricao={`Mesma base de cálculo da DRE (competência). Período: ${data(periodo.inicio)} a ${data(periodo.fim)}.`} />
      {semCusto > 0 && <Aviso>{semCusto} venda(s) no período têm itens sem custo cadastrado: CMV e margem desses canais estão subestimados. Cadastre os custos em Produtos.</Aviso>}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card><CardHeader><CardTitle className="text-sm">Faturamento e margem por canal</CardTitle></CardHeader><CardContent className="h-64">
          <ResponsiveContainer><BarChart data={l}><CartesianGrid vertical={false} strokeOpacity={0.15} /><XAxis dataKey="canal" fontSize={11} /><YAxis tickFormatter={brlCompacto} fontSize={11} width={70} />
            <Tooltip formatter={(v) => brl(v)} contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8 }} />
            <Bar dataKey="faturamento_bruto" name="Faturamento" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
            <Bar dataKey="margem_contribuicao" name="Margem de contribuição" fill="var(--chart-2)" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer>
        </CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm">Participação no faturamento</CardTitle></CardHeader><CardContent className="h-64">
          <ResponsiveContainer><PieChart><Pie data={l} dataKey="faturamento_bruto" nameKey="canal" innerRadius={55} outerRadius={90} paddingAngle={2}>
            {l.map((_, i) => <Cell key={i} fill={CORES[i % CORES.length]} />)}</Pie>
            <Tooltip formatter={(v) => brl(v)} contentStyle={{ background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8 }} /></PieChart></ResponsiveContainer>
        </CardContent></Card>
      </div>
      <DataTable colunas={colunas} linhas={l} carregando={q.isLoading} busca={false} chave={r => r.canal_id}
        exportar={{ nome: 'vendas-por-canal', titulo: 'Vendas por canal', subtitulo: `${data(periodo.inicio)} a ${data(periodo.fim)}` }} />
      <div>
        <h2 className="mb-3 text-lg font-semibold">Ranking de produtos</h2>
        <DataTable colunas={colRank} linhas={rank.data} carregando={rank.isLoading} chave={r => r.produto_id ?? r.produto} ordemInicial={{ id: 'r', desc: true }}
          exportar={{ nome: 'ranking-produtos', titulo: 'Ranking de produtos', subtitulo: `${data(periodo.inicio)} a ${data(periodo.fim)}` }}
          barra={<Seletor aria-label="Canal" className="w-auto" value={canalRank} onChange={e => setCanalRank(e.target.value)} vazio="Todos os canais" opcoes={opcoes(canais.data)} />} />
      </div>
    </div>
  )
}
