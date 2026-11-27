// Metas de vendedores: andamento do mês, megaprêmio e corrida.
// A corrida é ordenada pelo valor vendido. O vendedor só recebe do banco os próprios valores em R$;
// dos colegas, nome, ordem e % da meta (fn_corrida_vendedores).
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Crown, Flag, Gift, RefreshCw, Save, Trophy, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { supabase, rpc, unwrap, edge } from '@/lib/supabase'
import { useOrg } from '@/contexts/org'
import { brl, hoje, inicioMes, mesAno, pct } from '@/lib/format'
import { andamento, comissaoDaMeta, NIVEIS_PADRAO, niveisDaMeta, type NiveisConfig } from '@/lib/metas'
import { cn } from '@/lib/utils'
import { Aviso, Carregando, Erro, Kpi, PageHeader, Spinner, Vazio } from '@/components/common'
import { Campo, EntradaValor, Seletor } from '@/components/form'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { traduzirErro } from '@/components/CrudPage'

interface Corredor { user_id: string; nome: string; meta: number | null; vendido: number | null; pct: number; eu: boolean }
interface Premio { descricao: string; pct_minimo: number }

const CORES = ['bg-chart-1', 'bg-chart-2', 'bg-chart-3', 'bg-chart-4', 'bg-chart-5']
const iniciais = (nome: string) => nome.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]).join('').toUpperCase()

export default function Vendedores() {
  const { org, ehVendedor, podeAdministrar } = useOrg()
  const [mes, setMes] = useState(() => inicioMes(hoje()))
  const corrida = useQuery({ queryKey: ['corrida', org?.id, mes], enabled: !!org, refetchInterval: 300_000,
    queryFn: () => rpc<Corredor[]>('fn_corrida_vendedores', { p_org: org!.id, p_competencia: mes }) })
  const premio = useQuery({ queryKey: ['premio', org?.id, mes], enabled: !!org,
    queryFn: async () => unwrap(await supabase.from('premios_mes').select('descricao, pct_minimo').eq('organizacao_id', org!.id)
      .eq('competencia', mes).maybeSingle()) as Premio | null })
  const niveisMes = useQuery({ queryKey: ['niveis', org?.id, mes], enabled: !!org,
    queryFn: async () => unwrap(await supabase.from('metas_niveis_mes').select('pct_desejavel, pct_super, com_alcancavel, com_desejavel, com_super')
      .eq('organizacao_id', org!.id).eq('competencia', mes).maybeSingle()) as NiveisConfig | null })
  const cfg = niveisMes.data ?? NIVEIS_PADRAO
  const linhas = corrida.data ?? []
  const eu = linhas.find(l => l.eu)

  return (
    <div className="space-y-6 max-sm:[&_button]:min-h-10 max-sm:[&_input]:h-10 max-sm:[&_select]:h-10">
      <PageHeader titulo={ehVendedor ? 'Minhas metas' : 'Metas de vendedores'}
        descricao={ehVendedor ? 'Seu andamento no mês, sua comissão e a corrida pelo megaprêmio.' : 'Metas, comissões e megaprêmio de cada vendedor, e a corrida da equipe.'}
        acoes={<Campo rotulo="Mês" className="w-48"><Input type="month" value={mes.slice(0, 7)} onChange={e => e.target.value && setMes(e.target.value + '-01')} /></Campo>} />
      {corrida.error && <Erro erro={corrida.error} />}
      {eu && eu.meta != null && <MeuAndamento meta={Number(eu.meta)} vendido={Number(eu.vendido)} mes={mes} cfg={cfg} />}
      {ehVendedor && !corrida.isLoading && !eu && <Aviso>Você ainda não tem meta para {mesAno(mes)}. Fale com o administrador.</Aviso>}
      <PremioCard premio={premio.data} mes={mes} />
      <Card className="max-sm:[--card-spacing:--spacing(3)]">
        <CardHeader><CardTitle className="flex items-center gap-2"><Flag className="size-4" />Corrida do mês</CardTitle></CardHeader>
        <CardContent>
          {corrida.isLoading ? <Carregando linhas={3} /> : !linhas.length
            ? <Vazio titulo="Nenhum vendedor com meta neste mês" descricao={podeAdministrar ? 'Defina as metas abaixo para a corrida começar.' : undefined} />
            : <Pista linhas={linhas} pctMinimo={premio.data?.pct_minimo ?? null} valores={!ehVendedor} cfg={cfg} />}
        </CardContent>
      </Card>
      {podeAdministrar && <AdminMetas mes={mes} corrida={linhas} premio={premio.data ?? null} cfg={cfg} />}
    </div>
  )
}

function MeuAndamento({ meta, vendido, mes, cfg }: { meta: number; vendido: number; mes: string; cfg: NiveisConfig }) {
  const { niveis, atual, proximo, comissao } = comissaoDaMeta(meta, vendido, cfg)
  // andamento em relação ao próximo nível (ou à Supermeta, quando já bateu todos)
  const a = andamento((proximo ?? niveis[2]).meta, vendido, mes, hoje())
  const noRitmo = a.ritmoAtual >= a.ritmoNecessario
  const projetado = comissaoDaMeta(meta, a.projecao, cfg).atual
  const escala = Math.max(niveis[2].meta, vendido) * 1.04
  const pos = (v: number) => `${Math.min(100, (v / escala) * 100)}%`
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Kpi titulo="Vendido no mês" valor={brl(vendido)} rodape={`${pct((vendido / meta) * 100)} da meta Alcançável`} />
      <Kpi titulo="Comissão garantida" valor={brl(comissao)}
        rodape={atual ? `${pct(atual.comissaoPct)} do vendido · nível ${atual.nome}` : `Bata a Alcançável para ganhar ${pct(niveis[0].comissaoPct)}`} />
      <Kpi titulo={proximo ? `Falta para a ${proximo.nome}` : 'Próximo nível'} valor={proximo ? brl(a.falta) : 'Supermeta batida! 🎉'}
        rodape={proximo ? `Comissão ${atual ? 'sobe para' : 'de'} ${pct(proximo.comissaoPct)}: ${brl(proximo.meta * proximo.comissaoPct / 100)} ou mais` : 'Você atingiu o nível máximo'} />
      <Kpi titulo="Ritmo por dia" valor={brl(a.ritmoAtual)} alerta={proximo && a.diasRestantes > 0 && !noRitmo ? 'Abaixo do ritmo necessário' : undefined}
        rodape={!proximo ? `${a.diasRestantes} de ${a.diasMes} dias restantes` : a.diasRestantes ? `Necessário: ${brl(a.ritmoNecessario)}/dia · ${a.diasRestantes} dias restantes` : 'Mês encerrado'} />
      <div className="col-span-2 lg:col-span-4">
        <div className="relative h-3 rounded-full bg-muted" role="progressbar" aria-valuenow={Math.round(vendido)} aria-valuemin={0} aria-valuemax={Math.round(niveis[2].meta)}
          aria-label="Vendido em relação às três metas" aria-valuetext={`${brl(vendido)} de ${brl(niveis[2].meta)}`}>
          <div className={cn('h-full rounded-full transition-[width] duration-1000 ease-out', atual ? 'bg-emerald-500' : 'bg-primary')} style={{ width: pos(vendido) }} />
          {niveis.map(n => <span key={n.nome} aria-hidden className="absolute -inset-y-1 w-0.5 rounded-full bg-foreground/60" style={{ left: pos(n.meta) }} />)}
        </div>
        <ol className="mt-3 grid grid-cols-3 gap-2" aria-label="Níveis de meta">
          {niveis.map(n => {
            const ok = vendido >= n.meta
            return (
              <li key={n.nome} className={cn('rounded-lg border p-2 text-xs', ok ? 'border-emerald-500/50 bg-emerald-500/10' : n === proximo && 'border-primary/50 bg-primary/5')}>
                <p className="flex items-center gap-1 font-medium">{ok && <Check className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Atingida" />}<span className="truncate">{n.nome}</span></p>
                <p className="font-semibold tabular sm:text-sm">{brl(n.meta)}</p>
                <p className="text-muted-foreground">comissão {pct(n.comissaoPct)}</p>
              </li>
            )
          })}
        </ol>
        {a.diasRestantes > 0 && a.diasDecorridos > 0 && (
          <p className={cn('mt-2 text-sm', !proximo || noRitmo ? 'text-emerald-700 dark:text-emerald-400' : 'text-amber-700 dark:text-amber-400')}>
            No ritmo atual você fecha o mês em {brl(a.projecao)}{projetado ? `, no nível ${projetado.nome}` : ', abaixo da Alcançável'}.
            {proximo && !noRitmo && ` Venda ${brl(a.ritmoNecessario)} por dia para chegar à ${proximo.nome}.`}
          </p>
        )}
      </div>
    </div>
  )
}

function PremioCard({ premio, mes }: { premio: Premio | null | undefined; mes: string }) {
  if (!premio) return null
  return (
    <div className="flex items-center gap-3 rounded-xl border border-amber-500/40 bg-gradient-to-r from-amber-500/15 via-amber-400/5 to-transparent p-4 sm:gap-4">
      <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-amber-500/20 text-amber-600 sm:size-12 dark:text-amber-400"><Trophy className="size-5 sm:size-6" /></div>
      <div className="min-w-0">
        <p className="text-xs font-medium tracking-wide text-amber-700 uppercase dark:text-amber-400">Megaprêmio de {mesAno(mes)}</p>
        <p className="text-base leading-snug font-semibold sm:text-lg">{premio.descricao}</p>
        <p className="text-xs text-muted-foreground">Ganha quem vender mais no mês{Number(premio.pct_minimo) > 0 ? `, tendo atingido ao menos ${pct(premio.pct_minimo, 0)} da própria meta Alcançável` : ''}.</p>
      </div>
    </div>
  )
}

/**
 * Pista de corrida por valor vendido. Com `valores` (administração): distância proporcional ao R$ e as três metas
 * de cada um marcadas na própria raia. Sem `valores` (vendedor): só a ordem, em degraus iguais, porque a
 * distância proporcional deixaria calcular o R$ dos colegas a partir do próprio valor.
 */
function Pista({ linhas, pctMinimo, valores, cfg }: { linhas: Corredor[]; pctMinimo: number | null; valores: boolean; cfg: NiveisConfig }) {
  const [largou, setLargou] = useState(false)
  useEffect(() => { const t = requestAnimationFrame(() => setLargou(true)); return () => cancelAnimationFrame(t) }, [])
  const niveis = niveisDaMeta(100, cfg)   // em % da Alcançável: 100, 120, 130
  const escala = Math.max(1, ...linhas.map(l => Math.max(Number(l.vendido ?? 0), Number(l.meta ?? 0) * niveis[2].pctBase / 100))) * 1.04
  const lider = Number(linhas[0]?.pct) > 0 ? linhas[0].user_id : null
  const cor = useMemo(() => new Map(linhas.map((l, i) => [l.user_id, CORES[i % CORES.length]])), [linhas])
  const pos = (v: number) => `${(Math.min(v, escala) / escala) * 100}%`
  return (
    <ol className="space-y-3" aria-label="Classificação da corrida">
      {linhas.map((l, i) => {
        const p = Number(l.pct)
        const ehLider = l.user_id === lider
        const elegivel = pctMinimo != null && p >= Number(pctMinimo)
        const nivel = niveis.filter(n => p >= n.pctBase).pop()
        const avanco = valores ? pos(Number(l.vendido)) : p > 0 ? `${((linhas.length - i) / linhas.length) * 92}%` : '0%'
        return (
          <li key={l.user_id} className={cn('rounded-xl border p-2 transition-colors sm:p-3', l.eu && 'border-primary/50 bg-primary/5', ehLider && 'border-amber-500/60 bg-amber-500/5')}>
            <div className="mb-3 flex items-center gap-2 text-sm">
              <span className={cn('w-7 text-center font-semibold tabular', ehLider ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground')}>{i + 1}º</span>
              <span className="min-w-0 flex-1 truncate font-medium">{l.nome}{l.eu && <span className="ml-1 text-xs text-primary">(você)</span>}</span>
              {nivel && <span className="hidden rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary sm:inline">{nivel.nome}</span>}
              {elegivel && <Trophy className="size-4 shrink-0 text-emerald-600 sm:hidden dark:text-emerald-400" aria-label="No páreo do prêmio" />}
              {elegivel && <span className="hidden rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-700 sm:inline dark:text-emerald-400">no páreo do prêmio</span>}
              {l.meta != null && <span className="hidden text-xs text-muted-foreground tabular md:inline">{pct(p)} de {brl(l.meta)}</span>}
              {l.vendido != null && <span className="text-right font-semibold tabular">{brl(l.vendido)}</span>}
            </div>
            {l.meta != null && <p className="-mt-2 mb-3 pl-9 text-xs text-muted-foreground tabular md:hidden">{pct(p)} de {brl(l.meta)}</p>}
            <div className="relative h-10 rounded-lg bg-[repeating-linear-gradient(90deg,var(--muted)_0_24px,transparent_24px_48px)] ring-1 ring-border">
              <div className="absolute inset-x-0 top-1/2 border-t border-dashed border-muted-foreground/30" />
              {/* metas da própria raia: Alcançável quadriculada, Desejável e Supermeta tracejadas */}
              {valores && l.meta != null && niveis.map((n, k) => {
                const alvo = Number(l.meta) * n.pctBase / 100
                return <div key={n.nome} title={`${n.nome}: ${brl(alvo)}`} aria-hidden style={{ left: pos(alvo) }} className={cn('absolute inset-y-0',
                  k ? 'border-l-2 border-dashed border-foreground/40' : 'w-2 bg-[repeating-conic-gradient(var(--foreground)_0_25%,transparent_0_50%)] bg-[length:8px_8px] opacity-60')} />
              })}
              <div className={cn('absolute inset-y-1 left-0 rounded-md opacity-25 transition-[width] duration-[1600ms] ease-out', cor.get(l.user_id))}
                style={{ width: largou ? avanco : '0%', transitionDelay: `${i * 120}ms` }} />
              <div className="absolute top-1/2 -translate-x-full -translate-y-1/2 transition-[left] duration-[1600ms] ease-out" style={{ left: `max(2.25rem, ${largou ? avanco : '0%'})`, transitionDelay: `${i * 120}ms` }}>
                <div className={cn('relative flex size-8 items-center justify-center rounded-full text-[11px] font-bold text-white shadow-md motion-safe:animate-[corrida_0.6s_ease-in-out_infinite_alternate]',
                  cor.get(l.user_id), ehLider && 'ring-2 ring-amber-400 ring-offset-2 ring-offset-background')}>
                  {iniciais(l.nome)}
                  {ehLider && <Crown className="absolute -top-3.5 left-1/2 size-4 -translate-x-1/2 fill-amber-400 text-amber-500" aria-label="Líder" />}
                </div>
              </div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function AdminMetas({ mes, corrida, premio, cfg }: { mes: string; corrida: Corredor[]; premio: Premio | null; cfg: NiveisConfig }) {
  const { org } = useOrg(); const qc = useQueryClient()
  const membros = useQuery({ queryKey: ['membros', org?.id], enabled: !!org, queryFn: () => rpc<any[]>('fn_membros', { p_org: org!.id }) })
  const vinculos = useQuery({ queryKey: ['map-vendedores', org?.id], enabled: !!org,
    queryFn: async () => unwrap(await supabase.from('integracao_mapeamentos').select('interno_id').eq('organizacao_id', org!.id)
      .eq('tipo', 'vendedor').not('interno_id', 'is', null)) as { interno_id: string }[] })
  const vendedores = (membros.data ?? []).filter(m => m.papel === 'vendedor')
  const [metas, setMetas] = useState<Record<string, number>>({})
  const [p, setP] = useState<Premio>({ descricao: '', pct_minimo: 100 })
  useEffect(() => { setMetas(Object.fromEntries(corrida.filter(c => c.meta != null).map(c => [c.user_id, Number(c.meta)]))) }, [corrida])
  useEffect(() => { setP(premio ?? { descricao: '', pct_minimo: 100 }) }, [premio])
  const [n, setN] = useState<NiveisConfig>(cfg)
  useEffect(() => { setN(cfg) }, [cfg])
  const recarregar = () => { for (const k of ['corrida', 'premio', 'niveis']) qc.invalidateQueries({ queryKey: [k] }) }
  const vendidoDe = new Map(corrida.map(c => [c.user_id, Number(c.vendido ?? 0)]))
  const resultado = (userId: string) => (metas[userId] > 0 ? comissaoDaMeta(metas[userId], vendidoDe.get(userId) ?? 0, cfg) : null)

  const salvarMetas = useMutation({
    mutationFn: async () => {
      const com = vendedores.filter(v => metas[v.user_id] > 0)
      const sem = vendedores.filter(v => !(metas[v.user_id] > 0)).map(v => v.user_id)
      if (com.length) unwrap(await supabase.from('metas_vendedor').upsert(com.map(v => ({ organizacao_id: org!.id, user_id: v.user_id, competencia: mes, valor: metas[v.user_id] })),
        { onConflict: 'organizacao_id,user_id,competencia' }))
      if (sem.length) unwrap(await supabase.from('metas_vendedor').delete().eq('organizacao_id', org!.id).eq('competencia', mes).in('user_id', sem))
    },
    onSuccess: () => { toast.success('Metas salvas.'); recarregar() }, onError: (e: Error) => toast.error(traduzirErro(e.message)),
  })
  const salvarPremio = useMutation({
    mutationFn: async () => {
      if (!p.descricao.trim()) unwrap(await supabase.from('premios_mes').delete().eq('organizacao_id', org!.id).eq('competencia', mes))
      else unwrap(await supabase.from('premios_mes').upsert({ organizacao_id: org!.id, competencia: mes, descricao: p.descricao.trim(), pct_minimo: p.pct_minimo || 0 }))
    },
    onSuccess: () => { toast.success('Megaprêmio salvo.'); recarregar() }, onError: (e: Error) => toast.error(traduzirErro(e.message)),
  })
  const salvarNiveis = useMutation({
    mutationFn: async () => {
      if (!(n.pct_desejavel > 0 && n.pct_super > n.pct_desejavel)) throw new Error('A Supermeta precisa ficar acima da Desejável, e a Desejável acima da Alcançável.')
      unwrap(await supabase.from('metas_niveis_mes').upsert({ organizacao_id: org!.id, competencia: mes, ...n }))
    },
    onSuccess: () => { toast.success('Níveis e comissões salvos.'); recarregar() }, onError: (e: Error) => toast.error(traduzirErro(e.message)),
  })
  const semVinculo = vendedores.filter(v => !vinculos.data?.some(x => x.interno_id === v.user_id))

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="lg:col-span-2">
        <CardHeader><CardTitle>Metas e comissões de {mesAno(mes)}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {membros.isLoading ? <Carregando linhas={3} /> : !vendedores.length
            ? <Vazio titulo="Nenhum vendedor cadastrado" acao={<Link to="/config/vendedores" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary underline-offset-4 hover:underline"><UserPlus className="size-4" />Cadastrar vendedores</Link>} />
            : <>
              <p className="text-xs text-muted-foreground">Digite só a meta Alcançável. A Desejável (+{pct(cfg.pct_desejavel, 0)}) e a Supermeta (+{pct(cfg.pct_super, 0)}) são calculadas.</p>
              <ul className="divide-y">
                {vendedores.map(v => {
                  const r = resultado(v.user_id)
                  return (
                    <li key={v.user_id} className="flex flex-wrap items-end gap-x-6 gap-y-2 py-3 first:pt-0">
                      <span className="min-w-0 flex-1 basis-40 truncate self-center text-sm font-medium">{v.nome || v.email}</span>
                      <Campo rotulo="Alcançável" className="w-40 max-sm:w-full">
                        <EntradaValor valor={metas[v.user_id]} onChange={x => setMetas(m => ({ ...m, [v.user_id]: x }))} placeholder="Sem meta" />
                      </Campo>
                      <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-xs max-sm:w-full sm:grid-cols-[repeat(4,7.5rem)] [&_dd]:text-sm [&_dd]:font-medium [&_dd]:tabular [&_dt]:text-muted-foreground">
                        <div><dt>Desejável</dt><dd>{r ? brl(r.niveis[1].meta) : '—'}</dd></div>
                        <div><dt>Supermeta</dt><dd>{r ? brl(r.niveis[2].meta) : '—'}</dd></div>
                        <div><dt>Nível atingido</dt><dd>{r ? r.atual?.nome ?? 'Nenhum' : '—'}</dd></div>
                        <div><dt>Comissão{r?.atual && ` (${pct(r.atual.comissaoPct)})`}</dt><dd>{r ? brl(r.comissao) : '—'}</dd></div>
                      </dl>
                    </li>
                  )
                })}
              </ul>
              {semVinculo.length > 0 && <Aviso>Sem vínculo com vendedor do Bling (as vendas não contam): {semVinculo.map(v => v.nome || v.email).join(', ')}. <Link className="underline" to="/config/vendedores">Vincular</Link></Aviso>}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
                <p className="text-sm">Comissão total do mês até agora: <span className="font-semibold tabular">{brl(vendedores.reduce((t, v) => t + (resultado(v.user_id)?.comissao ?? 0), 0))}</span></p>
                <Button className="max-sm:w-full" onClick={() => salvarMetas.mutate()} disabled={salvarMetas.isPending}>{salvarMetas.isPending ? <Spinner /> : <Save />}Salvar metas</Button>
              </div>
            </>}
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Gift className="size-4" />Megaprêmio de {mesAno(mes)}</CardTitle></CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={e => { e.preventDefault(); salvarPremio.mutate() }}>
            <Campo rotulo="Prêmio" ajuda="Deixe em branco para remover o prêmio do mês."><Input value={p.descricao} maxLength={300} placeholder="Ex.: Fim de semana na serra"
              onChange={e => setP({ ...p, descricao: e.target.value })} /></Campo>
            <Campo rotulo="Critério: maior valor vendido, atingindo ao menos este % da meta Alcançável" className="w-full sm:w-64">
              <div className="relative"><Input type="number" min={0} max={1000} step={1} className="pr-7 text-right" value={p.pct_minimo}
                onChange={e => setP({ ...p, pct_minimo: Number(e.target.value) })} /><span className="absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-muted-foreground">%</span></div>
            </Campo>
            <Button type="submit" className="max-sm:w-full" disabled={salvarPremio.isPending}>{salvarPremio.isPending ? <Spinner /> : <Save />}Salvar prêmio</Button>
          </form>
        </CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Níveis e comissões de {mesAno(mes)}</CardTitle></CardHeader>
        <CardContent>
          <form className="space-y-3" onSubmit={e => { e.preventDefault(); salvarNiveis.mutate() }}>
            <div className="grid grid-cols-[1fr_6.5rem_6.5rem] items-center gap-x-3 gap-y-2 text-sm">
              <span /><span className="text-xs text-muted-foreground">Acima da Alcançável</span><span className="text-xs text-muted-foreground">Comissão</span>
              <span>Alcançável</span><span className="text-center text-muted-foreground">—</span>
              <Pct rotulo="Comissão da Alcançável" valor={n.com_alcancavel} onChange={v => setN({ ...n, com_alcancavel: v })} />
              <span>Desejável</span>
              <Pct rotulo="Desejável: acima da Alcançável" valor={n.pct_desejavel} onChange={v => setN({ ...n, pct_desejavel: v })} />
              <Pct rotulo="Comissão da Desejável" valor={n.com_desejavel} onChange={v => setN({ ...n, com_desejavel: v })} />
              <span>Supermeta</span>
              <Pct rotulo="Supermeta: acima da Alcançável" valor={n.pct_super} onChange={v => setN({ ...n, pct_super: v })} />
              <Pct rotulo="Comissão da Supermeta" valor={n.com_super} onChange={v => setN({ ...n, com_super: v })} />
            </div>
            <p className="text-xs text-muted-foreground">A comissão vale sobre todo o valor vendido no mês (produtos menos desconto, sem frete), conforme o nível atingido. Abaixo da Alcançável não há comissão.</p>
            <Button type="submit" className="max-sm:w-full" disabled={salvarNiveis.isPending}>{salvarNiveis.isPending ? <Spinner /> : <Save />}Salvar níveis</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

function Pct({ rotulo, valor, onChange }: { rotulo: string; valor: number; onChange: (v: number) => void }) {
  return (
    <div className="relative">
      <Input type="number" min={0} max={1000} step={0.1} aria-label={rotulo} className="pr-7 text-right" value={valor} onChange={e => onChange(Number(e.target.value))} />
      <span className="absolute top-1/2 right-2.5 -translate-y-1/2 text-xs text-muted-foreground">%</span>
    </div>
  )
}

/** Configurações > Vendedores: cadastro de login e vínculo com o vendedor do Bling */
export function CadastroVendedores() {
  const { org } = useOrg(); const qc = useQueryClient()
  const membros = useQuery({ queryKey: ['membros', org?.id], enabled: !!org, queryFn: () => rpc<any[]>('fn_membros', { p_org: org!.id }) })
  const mapas = useQuery({ queryKey: ['map-vendedores-lista', org?.id], enabled: !!org,
    queryFn: async () => unwrap(await supabase.from('integracao_mapeamentos').select('id, integracao_id, external_id, external_nome, interno_id')
      .eq('organizacao_id', org!.id).eq('tipo', 'vendedor').order('external_nome')) as any[] })
  const integs = useQuery({ queryKey: ['integracoes-ids', org?.id], enabled: !!org,
    queryFn: async () => unwrap(await supabase.from('integracoes').select('id, status').eq('organizacao_id', org!.id)) as any[] })
  const vendedores = (membros.data ?? []).filter(m => m.papel === 'vendedor')
  const [novo, setNovo] = useState({ nome: '', email: '', senha: '' })

  const criar = useMutation({
    mutationFn: () => edge('criar-vendedor', { organizacao_id: org!.id, ...novo }),
    onSuccess: () => { toast.success(`Login criado. Passe o e-mail e a senha inicial para ${novo.nome}.`); setNovo({ nome: '', email: '', senha: '' }); membros.refetch() },
    onError: (e: Error) => toast.error(e.message),
  })
  const vincular = useMutation({
    mutationFn: async ({ id, user }: { id: string; user: string | null }) =>
      unwrap(await supabase.from('integracao_mapeamentos').update({ interno_id: user, updated_at: new Date().toISOString() }).eq('id', id)),
    onSuccess: () => { toast.success('Vínculo salvo.'); mapas.refetch(); qc.invalidateQueries({ queryKey: ['corrida'] }); qc.invalidateQueries({ queryKey: ['map-vendedores'] }) },
    onError: (e: Error) => toast.error(e.message),
  })
  const sincronizar = useMutation({
    mutationFn: async () => {
      const ativas = (integs.data ?? []).filter(i => ['conectado', 'erro'].includes(i.status))
      if (!ativas.length) throw new Error('Conecte a integração Bling primeiro.')
      for (const i of ativas) await edge('bling-sync', { integracao_id: i.id, recursos: ['vendedores'] })
    },
    onSuccess: () => { toast.success('Buscando vendedores e vinculando vendas do Bling. Isso pode levar alguns minutos.'); setTimeout(() => mapas.refetch(), 15000) },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="space-y-6 max-sm:[&_button]:min-h-10 max-sm:[&_input]:h-10 max-sm:[&_select]:h-10">
      <PageHeader titulo="Vendedores" descricao="Login próprio para cada vendedor. O vendedor só acessa a área de metas: nada de financeiro, DRE ou contas." />
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><UserPlus className="size-4" />Novo vendedor</CardTitle></CardHeader>
        <CardContent>
          <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); criar.mutate() }}>
            <Campo rotulo="Nome" className="w-full sm:w-56"><Input required minLength={2} value={novo.nome} onChange={e => setNovo({ ...novo, nome: e.target.value })} /></Campo>
            <Campo rotulo="E-mail" className="w-full sm:w-64"><Input type="email" required value={novo.email} onChange={e => setNovo({ ...novo, email: e.target.value })} /></Campo>
            <Campo rotulo="Senha inicial" ajuda="Mínimo 8 caracteres." className="w-full sm:w-48"><Input type="text" required minLength={8} autoComplete="new-password" value={novo.senha} onChange={e => setNovo({ ...novo, senha: e.target.value })} /></Campo>
            <Button type="submit" className="max-sm:w-full" disabled={criar.isPending}>{criar.isPending ? <Spinner /> : <UserPlus />}Criar login</Button>
          </form>
          <p className="mt-3 text-xs text-muted-foreground">Para remover um vendedor ou mudar o papel, use <Link className="underline" to="/config/usuarios">Usuários</Link>. Esqueceu a senha? O vendedor usa "Esqueci a senha" na tela de login.</p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle>Vendedores do Bling</CardTitle>
          <Button variant="outline" size="sm" className="max-sm:w-full" onClick={() => sincronizar.mutate()} disabled={sincronizar.isPending}>{sincronizar.isPending ? <Spinner /> : <RefreshCw />}Buscar no Bling e vincular vendas</Button>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm text-muted-foreground">Ligue cada vendedor do Bling ao login do vendedor aqui. As vendas importadas com esse vendedor passam a contar na meta (inclusive as já importadas).</p>
          {mapas.isLoading ? <Carregando linhas={3} /> : !mapas.data?.length
            ? <Vazio titulo="Nenhum vendedor do Bling ainda" descricao='Clique em "Buscar no Bling e vincular vendas".' />
            : mapas.data.map(m => (
              <div key={m.id} className="flex flex-wrap items-center gap-2 border-b py-2 last:border-0">
                <span className="min-w-0 flex-1 truncate text-sm">{m.external_nome} <span className="text-xs text-muted-foreground">#{m.external_id}</span></span>
                <Seletor aria-label={`Login do vendedor ${m.external_nome}`} className="w-full sm:w-64" value={m.interno_id ?? ''} vazio="— sem vínculo —"
                  onChange={e => vincular.mutate({ id: m.id, user: e.target.value || null })}
                  opcoes={vendedores.map(v => ({ value: v.user_id, label: v.nome || v.email }))} />
              </div>
            ))}
        </CardContent>
      </Card>
    </div>
  )
}
