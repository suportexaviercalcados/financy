import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { AlertTriangle, Bell, RefreshCw } from 'lucide-react'
import { supabase, rpc, unwrap } from '@/lib/supabase'
import { useOrg } from '@/contexts/org'
import { useCanais, opcoes } from '@/hooks/lookups'
import { brl, brlCompacto, data, dataHora, mesAno, num, pct } from '@/lib/format'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Aviso, Carregando, Dinheiro, Erro, Kpi, PageHeader, Variacao } from '@/components/common'
import { Seletor } from '@/components/form'
import { Drilldown } from '@/components/Drilldown'
import { cn } from '@/lib/utils'

const tt = { contentStyle: { background: 'var(--popover)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 } }

export default function Dashboard() {
  const { org, empresaIds, periodo } = useOrg()
  const nav = useNavigate()
  const canais = useCanais()
  const [canal, setCanal] = useState('')
  const [drill, setDrill] = useState<{ titulo: string; grupos: string[] } | null>(null)
  const args = { p_org: org?.id, p_empresas: empresaIds, p_ini: periodo.inicio, p_fim: periodo.fim, p_canal: canal || null }
  const q = useQuery({ queryKey: ['dashboard', args], enabled: !!org, queryFn: () => rpc<any>('fn_dashboard', args) })
  const evo = useQuery({ queryKey: ['evolucao', args], enabled: !!org,
    queryFn: () => rpc<any[]>('fn_evolucao_mensal', { p_org: org!.id, p_empresas: empresaIds, p_fim: periodo.fim, p_meses: 12, p_canal: canal || null }) })
  const alertas = useQuery({ queryKey: ['alertas', org?.id], enabled: !!org,
    queryFn: async () => unwrap(await supabase.from('alertas').select('*').eq('organizacao_id', org!.id).eq('lido', false).order('created_at', { ascending: false }).limit(30)) as any[] })

  if (q.error) return <Erro erro={q.error} />
  if (q.isLoading || !q.data) return <><PageHeader titulo="Dashboard" /><Carregando linhas={10} /></>
  const d = q.data; const dre = d.dre; const ant = d.dre_anterior; const aa = d.dre_ano_anterior
  const comp = (k: string, inverter = false) => (
    <span className="flex flex-wrap gap-x-2"><span>vs anterior <Variacao atual={dre[k]} anterior={ant[k]} inverter={inverter} /></span>
      <span>vs ano ant. <Variacao atual={dre[k]} anterior={aa[k]} inverter={inverter} /></span></span>)
  const falta = d.dados_faltantes
  const semDados = Number(dre.receita_bruta) === 0 && Number(dre.despesa_fixa) === 0 && d.saldo_atual === 0
  const despesasCat = (d.despesas_categoria ?? []).map((x: any) => ({ ...x, valor: Number(x.valor) }))
  const proj = d.projecao ?? {}
  const sev = { critico: 'border-red-500/40 bg-red-500/5', aviso: 'border-amber-500/40 bg-amber-500/5', info: 'border-sky-500/30 bg-sky-500/5' } as Record<string, string>

  return (
    <div className="space-y-6">
      <PageHeader titulo="Dashboard" descricao={`${data(periodo.inicio)} a ${data(periodo.fim)} · competência para resultado, caixa para saldos`}
        acoes={<Seletor aria-label="Canal" className="w-auto" value={canal} onChange={e => setCanal(e.target.value)} vazio="Todos os canais" opcoes={opcoes(canais.data)} />} />

      {semDados && <Aviso>Ainda não há lançamentos neste período. Registre vendas e contas, importe um extrato OFX ou conecte o Bling para ver os indicadores.</Aviso>}
      {Number(falta.vendas_sem_custo) > 0 && <Aviso>{falta.vendas_sem_custo} venda(s) do período têm produtos sem custo cadastrado: CMV, margens e lucro estão <b>subestimados no custo</b>. {falta.produtos_sem_custo} produto(s) ativo(s) sem custo. <button className="underline" onClick={() => nav('/cadastros/produtos')}>Cadastrar custos</button></Aviso>}
      {!!alertas.data?.length && (
        <div className="grid gap-2 md:grid-cols-2">
          {alertas.data.slice(0, 4).map(a => (
            <div key={a.id} className={cn('flex gap-2 rounded-lg border p-3 text-sm', sev[a.severidade])}>
              <Bell className="mt-0.5 size-4 shrink-0" /><div><p className="font-medium">{a.titulo}{a.origem === 'ia' && <span className="ml-1 rounded bg-primary/10 px-1 text-[10px] text-primary">IA</span>}</p><p className="line-clamp-3 text-muted-foreground">{a.mensagem}</p></div>
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi titulo="Faturamento bruto" valor={brl(dre.receita_bruta)} rodape={comp('receita_bruta')} onClick={() => setDrill({ titulo: 'Faturamento bruto', grupos: ['receita_bruta'] })} />
        <Kpi titulo="Receita líquida" valor={brl(dre.receita_liquida)} rodape={comp('receita_liquida')} onClick={() => setDrill({ titulo: 'Deduções da receita', grupos: ['deducoes_impostos', 'deducoes_devolucoes'] })} />
        <Kpi titulo="Lucro líquido" valor={<Dinheiro v={dre.lucro_liquido} />} rodape={<>Margem líquida {pct(d.margem_liquida_pct)} · {comp('lucro_liquido')}</>} onClick={() => nav('/dre')} />
        <Kpi titulo="Saldo em caixa (hoje)" valor={<Dinheiro v={d.saldo_atual} />} rodape={`${d.saldos_contas.length} conta(s)`} onClick={() => nav('/fluxo-caixa')} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-6">
        <Kpi titulo="Pedidos" valor={num(d.pedidos)} rodape={<>Ticket médio {brl(d.ticket_medio)}</>} onClick={() => nav('/vendas')} />
        <Kpi titulo="CMV" valor={brl(dre.cmv)} rodape={`Margem bruta ${pct(d.margem_bruta_pct)}`} alerta={Number(falta.vendas_sem_custo) > 0 ? 'Custo incompleto' : undefined} onClick={() => setDrill({ titulo: 'CMV', grupos: ['cmv'] })} />
        <Kpi titulo="Margem de contribuição" valor={brl(dre.margem_contribuicao)} rodape={pct(d.margem_contribuicao_pct)} onClick={() => setDrill({ titulo: 'Despesas variáveis', grupos: ['despesa_variavel'] })} />
        <Kpi titulo="Despesas variáveis" valor={brl(dre.despesa_variavel)} rodape={comp('despesa_variavel', true)} onClick={() => setDrill({ titulo: 'Despesas variáveis', grupos: ['despesa_variavel'] })} />
        <Kpi titulo="Despesas fixas" valor={brl(dre.despesa_fixa)} rodape={comp('despesa_fixa', true)} onClick={() => setDrill({ titulo: 'Despesas fixas', grupos: ['despesa_fixa'] })} />
        <Kpi titulo="EBITDA" valor={<Dinheiro v={dre.ebitda} />} rodape={comp('ebitda')} onClick={() => nav('/dre')} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="gap-2 p-4">
          <span className="text-xs font-medium text-muted-foreground">Meta de faturamento</span>
          {d.meta ? <><span className="text-xl font-semibold tabular">{pct(d.meta_pct)}</span><Progress value={Math.min(100, Number(d.meta_pct) || 0)} />
            <span className="text-xs text-muted-foreground">{brl(dre.receita_bruta)} de {brl(d.meta)}</span></>
            : <button className="text-left text-sm text-primary hover:underline" onClick={() => nav('/metas')}>Definir meta do período</button>}
        </Card>
        <Kpi titulo="Ponto de equilíbrio" valor={d.ponto_equilibrio ? brl(d.ponto_equilibrio) : '—'}
          rodape={d.ponto_equilibrio ? (Number(dre.receita_liquida) >= Number(d.ponto_equilibrio) ? 'Receita acima do equilíbrio' : `Faltam ${brl(Number(d.ponto_equilibrio) - Number(dre.receita_liquida))}`) : 'Requer margem de contribuição positiva'} />
        <Kpi titulo="Prazo médio de recebimento" valor={d.prazos.pmr != null ? `${num(d.prazos.pmr)} dias` : '—'} rodape={`Pagamento: ${d.prazos.pmp != null ? num(d.prazos.pmp) + ' dias' : '—'}`} />
        <Kpi titulo="Endividamento" valor={brl(d.endividamento.saldo_devedor)} rodape={`${d.endividamento.parcelas_futuras_qtd} parcela(s) futuras · ${brl(d.endividamento.parcelas_futuras_valor)}`} onClick={() => nav('/emprestimos')} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi titulo="Caixa projetado — 30 dias" valor={<Dinheiro v={proj.d30} />} rodape={<>60 dias <Dinheiro v={proj.d60} /> · 90 dias <Dinheiro v={proj.d90} /></>}
          alerta={proj.primeiro_dia_negativo ? `Saldo negativo em ${data(proj.primeiro_dia_negativo)}` : undefined} onClick={() => nav('/fluxo-caixa')} />
        <Kpi titulo="A pagar" valor={brl(d.contas.pagar_7)} rodape={`7 dias · 30 dias: ${brl(d.contas.pagar_30)}`} onClick={() => nav('/contas/pagar?periodo=todos')} />
        <Kpi titulo="A receber" valor={brl(d.contas.receber_7)} rodape={`7 dias · 30 dias: ${brl(d.contas.receber_30)}`} onClick={() => nav('/contas/receber?periodo=todos')} />
        <Kpi titulo="Contas vencidas" valor={<span className={cn(Number(d.contas.qtd_vencidas) > 0 && 'text-negativo')}>{num(d.contas.qtd_vencidas)}</span>}
          rodape={`A pagar ${brl(d.contas.vencidas_pagar)} · a receber ${brl(d.contas.vencidas_receber)}`} onClick={() => nav('/contas/pagar?status=vencidas')} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2"><CardHeader><CardTitle className="text-sm">Evolução mensal — faturamento, lucro e margem</CardTitle></CardHeader><CardContent className="h-72">
          <ResponsiveContainer><ComposedChart data={(evo.data ?? []).map(e => ({ ...e, mes: mesAno(e.mes), receita_bruta: Number(e.receita_bruta), lucro_liquido: Number(e.lucro_liquido), margem: e.margem_contribuicao_pct == null ? null : Number(e.margem_contribuicao_pct) }))}>
            <CartesianGrid vertical={false} strokeOpacity={0.15} /><XAxis dataKey="mes" fontSize={11} />
            <YAxis yAxisId="v" tickFormatter={brlCompacto} fontSize={11} width={70} /><YAxis yAxisId="p" orientation="right" tickFormatter={(v) => `${v}%`} fontSize={11} width={40} />
            <Tooltip formatter={(v, n) => n === 'Margem de contribuição' ? pct(v) : brl(v)} {...tt} /><Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar yAxisId="v" dataKey="receita_bruta" name="Faturamento" fill="var(--chart-1)" radius={[4, 4, 0, 0]} />
            <Bar yAxisId="v" dataKey="lucro_liquido" name="Lucro líquido" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
            <Line yAxisId="p" dataKey="margem" name="Margem de contribuição" stroke="var(--chart-3)" strokeWidth={2} dot={false} connectNulls />
          </ComposedChart></ResponsiveContainer>
        </CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm">Saldo de caixa no fim de cada mês</CardTitle></CardHeader><CardContent className="h-72">
          <ResponsiveContainer><ComposedChart data={(evo.data ?? []).map(e => ({ mes: mesAno(e.mes), saldo: Number(e.saldo_caixa) }))}>
            <CartesianGrid vertical={false} strokeOpacity={0.15} /><XAxis dataKey="mes" fontSize={11} /><YAxis tickFormatter={brlCompacto} fontSize={11} width={70} />
            <Tooltip formatter={(v) => brl(v)} {...tt} /><Line dataKey="saldo" name="Saldo" stroke="var(--chart-1)" strokeWidth={2} />
          </ComposedChart></ResponsiveContainer>
        </CardContent></Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2"><CardHeader><CardTitle className="text-sm">Faturamento e margem por canal</CardTitle></CardHeader><CardContent>
          {!d.canais.length ? <p className="text-sm text-muted-foreground">Sem vendas no período.</p> : (
            <div className="overflow-x-auto"><table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground"><tr className="border-b"><th className="py-2 text-left font-medium">Canal</th><th className="text-right font-medium">Faturamento</th><th className="text-right font-medium">Part.</th><th className="text-right font-medium">Pedidos</th><th className="text-right font-medium">Ticket</th><th className="text-right font-medium">Margem contrib.</th><th className="text-right font-medium">MC %</th></tr></thead>
              <tbody>{d.canais.map((c: any) => (
                <tr key={c.canal_id} className="border-b last:border-0"><td className="py-2">{c.canal}{Number(c.vendas_sem_custo) > 0 && <AlertTriangle className="ml-1 inline size-3 text-amber-500" />}</td>
                  <td className="text-right tabular">{brl(c.faturamento_bruto)}</td><td className="text-right tabular">{pct(c.participacao)}</td><td className="text-right tabular">{num(c.pedidos)}</td>
                  <td className="text-right tabular">{brl(c.ticket_medio)}</td><td className="text-right tabular">{brl(c.margem_contribuicao)}</td><td className="text-right tabular">{pct(c.margem_percentual)}</td></tr>))}
              </tbody></table></div>)}
        </CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm">Saldo por conta</CardTitle></CardHeader><CardContent className="space-y-1.5">
          {d.saldos_contas.map((s: any) => <div key={s.conta_bancaria_id} className="flex justify-between text-sm"><span className="truncate">{s.nome}</span><Dinheiro v={s.saldo} /></div>)}
          <div className="flex justify-between border-t pt-2 text-sm font-semibold"><span>Consolidado</span><Dinheiro v={d.saldo_atual} /></div>
        </CardContent></Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2"><CardHeader><CardTitle className="text-sm">Despesas por categoria (competência)</CardTitle></CardHeader><CardContent className="h-80">
          {!despesasCat.length ? <p className="text-sm text-muted-foreground">Sem despesas no período.</p> : (
            <ResponsiveContainer><BarChart data={despesasCat} layout="vertical" margin={{ left: 10 }}>
              <CartesianGrid horizontal={false} strokeOpacity={0.15} /><XAxis type="number" tickFormatter={brlCompacto} fontSize={11} />
              <YAxis type="category" dataKey="categoria" width={180} fontSize={11} /><Tooltip formatter={(v) => brl(v)} {...tt} />
              <Bar dataKey="valor" name="Valor" fill="var(--chart-4)" radius={[0, 4, 4, 0]} cursor="pointer"
                onClick={(x: any) => setDrill({ titulo: x.categoria, grupos: [x.grupo] })} />
            </BarChart></ResponsiveContainer>)}
        </CardContent></Card>
        <Card><CardHeader><CardTitle className="flex items-center gap-1 text-sm"><RefreshCw className="size-3.5" />Fontes de dados</CardTitle></CardHeader><CardContent className="space-y-2 text-sm">
          {d.integracoes.map((i: any) => <div key={i.empresa_id} className="flex justify-between gap-2"><span>Bling</span><span className="text-right text-muted-foreground">{i.status} · {dataHora(i.ultima_sincronizacao)}</span></div>)}
          {!d.integracoes.length && <div className="flex justify-between"><span>Bling</span><button className="text-primary hover:underline" onClick={() => nav('/config/integracoes')}>Não conectado</button></div>}
          <div className="flex justify-between gap-2"><span>Extrato OFX</span><span className="text-muted-foreground">{d.ultima_importacao_ofx ? dataHora(d.ultima_importacao_ofx) : 'nunca importado'}</span></div>
          <div className="flex justify-between gap-2"><span>Lançamentos manuais</span><span className="text-muted-foreground">em tempo real</span></div>
        </CardContent></Card>
      </div>
      {drill && <Drilldown titulo={drill.titulo} grupos={drill.grupos} ini={periodo.inicio} fim={periodo.fim} canal={canal || null} onFechar={() => setDrill(null)} />}
    </div>
  )
}
