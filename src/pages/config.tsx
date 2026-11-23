import { useEffect, useRef, useState } from 'react'
import { Navigate, useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Link2, Lock, LockOpen, Mail, RefreshCw, Trash2, Unplug } from 'lucide-react'
import { toast } from 'sonner'
import { supabase, rpc, unwrap, edge } from '@/lib/supabase'
import { useOrg, type Papel } from '@/contexts/org'
import { useAuth } from '@/contexts/auth'
import { useCanais, useCategorias, useCentros, useContasBancarias, useContatos, useFormas, opcoes, opcoesCategoria } from '@/hooks/lookups'
import { brl, data, dataHora, hoje, mesAno, num, somaMeses, inicioMes } from '@/lib/format'
import { CrudPage, traduzirErro, type CrudConfig } from '@/components/CrudPage'
import { DataTable, type Coluna } from '@/components/DataTable'
import { Aviso, Confirmar, Erro, PageHeader, Spinner, Status } from '@/components/common'
import { Campo, Grade, Seletor } from '@/components/form'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Checkbox } from '@/components/ui/checkbox'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Progress } from '@/components/ui/progress'

// situacao.valor dos pedidos de venda no Bling (Cancelado e Em digitação nunca são importados)
const SITUACOES_PEDIDO: [number, string][] = [[1, 'Atendido'], [11, 'Verificado'], [8, 'Pagamento confirmado'], [6, 'Atendido parcialmente'],
  [5, 'Faturado parcialmente'], [3, 'Em andamento'], [7, 'Aguardando pagamento'], [12, 'Checkout parcial'], [0, 'Em aberto']]

const PAPEIS: { value: Papel; label: string; desc: string }[] = [
  { value: 'proprietario', label: 'Proprietário', desc: 'Acesso total, incluindo assinatura, usuários e integrações.' },
  { value: 'administrador', label: 'Administrador', desc: 'Operações e configurações, exceto assinatura.' },
  { value: 'financeiro', label: 'Financeiro', desc: 'Lançamentos, contas, conciliação, relatórios e importações.' },
  { value: 'visualizador', label: 'Visualizador', desc: 'Somente leitura de dashboards e relatórios.' },
]

export default function Config() {
  const { pagina } = useParams()
  switch (pagina) {
    case 'organizacao': return <Organizacao />
    case 'usuarios': return <Usuarios />
    case 'integracoes': return <Integracoes />
    case 'regras': return <Regras />
    case 'ia': return <ConfigIA />
    case 'periodos': return <Periodos />
    case 'depreciacoes': return <Depreciacoes />
    case 'auditoria': return <Auditoria />
  }
  return <Navigate to="/" replace />
}

function Organizacao() {
  const { org, podeAdministrar, ehProprietario, recarregar, empresas } = useOrg()
  const qc = useQueryClient()
  const [nome, setNome] = useState(org?.nome ?? ''); const [rateio, setRateio] = useState(org?.rateio_modo ?? 'faturamento')
  const info = useQuery({ queryKey: ['plano', org?.id], enabled: !!org, queryFn: async () => {
    const [pl, ass, mem, uso] = await Promise.all([supabase.from('planos').select('*').eq('id', org!.plano_id).single(),
      supabase.from('assinaturas').select('*').eq('organizacao_id', org!.id).maybeSingle(), supabase.from('membros').select('user_id', { count: 'exact', head: true }).eq('organizacao_id', org!.id),
      rpc<any>('fn_ia_uso_mes', { p_org: org!.id })])
    return { plano: pl.data, assinatura: ass.data, usuarios: mem.count ?? 0, uso }
  } })
  const salvar = useMutation({
    mutationFn: async () => unwrap(await supabase.from('organizacoes').update({ nome, rateio_modo: rateio }).eq('id', org!.id)),
    onSuccess: () => { toast.success('Organização atualizada.'); recarregar(); qc.invalidateQueries() }, onError: (e: Error) => toast.error(traduzirErro(e.message)),
  })
  const sup = useQuery({ queryKey: ['suporte', org?.id], enabled: ehProprietario, queryFn: async () => unwrap(await supabase.from('acessos_suporte').select('*').eq('organizacao_id', org!.id).order('created_at', { ascending: false })) as any[] })
  const [s, setS] = useState({ email: '', motivo: '', dias: 3 })
  const conceder = useMutation({ mutationFn: () => rpc('fn_conceder_suporte', { p_org: org!.id, p_email: s.email, p_motivo: s.motivo, p_dias: s.dias }),
    onSuccess: () => { toast.success('Acesso de suporte concedido (somente leitura).'); sup.refetch() }, onError: (e: Error) => toast.error(e.message) })
  const revogar = async (id: string) => { await supabase.from('acessos_suporte').update({ revogado_em: new Date().toISOString() }).eq('id', id); sup.refetch() }
  const i = info.data
  return (
    <div className="space-y-6">
      <PageHeader titulo="Organização e plano" />
      <Card><CardHeader><CardTitle className="text-sm">Dados da organização</CardTitle></CardHeader><CardContent className="space-y-4">
        <Grade>
          <Campo rotulo="Nome"><Input value={nome} onChange={e => setNome(e.target.value)} disabled={!podeAdministrar} /></Campo>
          <Campo rotulo="Rateio de despesas fixas na DRE por canal">
            <Seletor value={rateio} onChange={e => setRateio(e.target.value)} disabled={!podeAdministrar}
              opcoes={[{ value: 'faturamento', label: 'Proporcional ao faturamento do canal' }, { value: 'manual', label: 'Percentual manual por canal' }]} /></Campo>
        </Grade>
        {podeAdministrar && <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>Salvar</Button>}
        <p className="text-xs text-muted-foreground">{empresas.length} empresa(s). Cadastre CNPJs em Cadastros → Empresas.</p>
      </CardContent></Card>
      {i && <Card><CardHeader><CardTitle className="text-sm">Plano {i.plano?.nome} — {i.assinatura?.status === 'trial' ? `período de avaliação até ${data(i.assinatura.fim)}` : i.assinatura?.status}</CardTitle></CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <Uso rotulo="Empresas" atual={empresas.length} limite={i.plano?.max_empresas} />
          <Uso rotulo="Usuários" atual={i.usuarios} limite={i.plano?.max_usuarios} />
          <Uso rotulo="Tokens de IA no mês" atual={Number(i.uso?.tokens ?? 0)} limite={Number(i.plano?.ia_tokens_mes)} />
          <p className="text-xs text-muted-foreground sm:col-span-3">A cobrança ainda não está integrada a um gateway de pagamento. Para mudar de plano, fale com o suporte da plataforma.</p>
        </CardContent></Card>}
      {ehProprietario && <Card><CardHeader><CardTitle className="text-sm">Acesso do suporte da plataforma</CardTitle></CardHeader><CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">O suporte só enxerga dados financeiros da sua organização com uma concessão registrada, temporária e somente leitura.</p>
        <Grade cols={3}>
          <Campo rotulo="E-mail do administrador da plataforma"><Input value={s.email} onChange={e => setS({ ...s, email: e.target.value })} /></Campo>
          <Campo rotulo="Motivo"><Input value={s.motivo} onChange={e => setS({ ...s, motivo: e.target.value })} /></Campo>
          <Campo rotulo="Duração (dias, máx. 30)"><Input type="number" min={1} max={30} value={s.dias} onChange={e => setS({ ...s, dias: Number(e.target.value) })} /></Campo>
        </Grade>
        <Button variant="outline" onClick={() => conceder.mutate()} disabled={conceder.isPending}>Conceder acesso</Button>
        {sup.data?.map(a => <div key={a.id} className="flex items-center justify-between border-b py-1 text-sm"><span>{a.motivo} · até {dataHora(a.expira_em)}</span>
          {a.revogado_em ? <span className="text-xs text-muted-foreground">revogado</span> : new Date(a.expira_em) > new Date() ? <Button size="xs" variant="ghost" onClick={() => revogar(a.id)}>Revogar</Button> : <span className="text-xs text-muted-foreground">expirado</span>}</div>)}
      </CardContent></Card>}
    </div>
  )
}
const Uso = ({ rotulo, atual, limite }: { rotulo: string; atual: number; limite: number }) => (
  <div className="space-y-1"><div className="flex justify-between text-sm"><span>{rotulo}</span><span className="tabular">{num(atual)} / {num(limite)}</span></div><Progress value={Math.min(100, 100 * atual / (limite || 1))} /></div>)

function Usuarios() {
  const { org, ehProprietario, podeAdministrar } = useOrg(); const { user } = useAuth(); const qc = useQueryClient()
  const membros = useQuery({ queryKey: ['membros', org?.id], enabled: !!org, queryFn: () => rpc<any[]>('fn_membros', { p_org: org!.id }) })
  const convites = useQuery({ queryKey: ['convites', org?.id], enabled: !!org, queryFn: async () => unwrap(await supabase.from('convites').select('*').eq('organizacao_id', org!.id).is('aceito_em', null).order('created_at', { ascending: false })) as any[] })
  const [novo, setNovo] = useState({ email: '', papel: 'financeiro' }); const [remover, setRemover] = useState<any | null>(null)
  const convidar = useMutation({
    mutationFn: async () => {
      const c = unwrap(await supabase.from('convites').insert({ organizacao_id: org!.id, email: novo.email.trim().toLowerCase(), papel: novo.papel, convidado_por: user!.id }).select().single()) as any
      const r = await edge<any>('enviar-convite', { convite_id: c.id }).catch((e) => ({ erro: e.message }))
      return { c, r }
    },
    onSuccess: ({ r }) => {
      toast.success(r?.enviado ? 'Convite enviado por e-mail.' : r?.usuario_existente ? 'Usuário já tem conta: o convite aparecerá quando ele entrar.' : `Convite criado. Envie o link manualmente${r?.erro ? ` (${r.erro})` : ''}.`)
      setNovo({ email: '', papel: 'financeiro' }); qc.invalidateQueries({ queryKey: ['convites'] })
    },
    onError: (e: Error) => toast.error(traduzirErro(e.message)),
  })
  const papel = useMutation({ mutationFn: ({ u, p }: { u: string; p: string }) => rpc('fn_alterar_papel', { p_org: org!.id, p_user: u, p_papel: p }),
    onSuccess: () => { toast.success('Papel alterado.'); membros.refetch() }, onError: (e: Error) => toast.error(e.message) })
  const rem = useMutation({ mutationFn: (u: string) => rpc('fn_remover_membro', { p_org: org!.id, p_user: u }),
    onSuccess: () => { toast.success('Usuário removido.'); setRemover(null); membros.refetch() }, onError: (e: Error) => { toast.error(e.message); setRemover(null) } })
  const col: Coluna<any>[] = [
    { id: 'n', titulo: 'Usuário', celula: m => <div><div>{m.nome || m.email}</div><div className="text-xs text-muted-foreground">{m.email}</div></div>, valor: m => m.email },
    { id: 'p', titulo: 'Papel', valor: m => m.papel, celula: m => podeAdministrar && m.user_id !== user?.id
      ? <Seletor className="w-auto" value={m.papel} onChange={e => papel.mutate({ u: m.user_id, p: e.target.value })} opcoes={PAPEIS.map(p => ({ ...p, disabled: p.value === 'proprietario' && !ehProprietario }))} />
      : PAPEIS.find(p => p.value === m.papel)?.label },
    { id: 'd', titulo: 'Desde', celula: m => dataHora(m.desde), valor: m => m.desde },
    { id: 'a', titulo: '', alinhar: 'right', celula: m => podeAdministrar && m.user_id !== user?.id && <Button size="icon-sm" variant="ghost" aria-label="Remover" onClick={() => setRemover(m)}><Trash2 /></Button> },
  ]
  const link = (t: string) => `${location.origin}/convite/${t}`
  return (
    <div className="space-y-6">
      <PageHeader titulo="Usuários e perfis" descricao="As permissões são aplicadas no banco de dados (RLS), não apenas na tela." />
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{PAPEIS.map(p => <Card key={p.value} className="gap-1 p-3"><p className="text-sm font-medium">{p.label}</p><p className="text-xs text-muted-foreground">{p.desc}</p></Card>)}</div>
      <DataTable colunas={col} linhas={membros.data} carregando={membros.isLoading} chave={m => m.user_id} busca={false} />
      {podeAdministrar && <Card><CardHeader><CardTitle className="text-sm">Convidar usuário</CardTitle></CardHeader><CardContent className="space-y-3">
        <form className="flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); convidar.mutate() }}>
          <Campo rotulo="E-mail" className="w-72"><Input type="email" required value={novo.email} onChange={e => setNovo({ ...novo, email: e.target.value })} /></Campo>
          <Campo rotulo="Papel"><Seletor value={novo.papel} onChange={e => setNovo({ ...novo, papel: e.target.value })} opcoes={PAPEIS.filter(p => p.value !== 'proprietario')} /></Campo>
          <Button type="submit" disabled={convidar.isPending}>{convidar.isPending ? <Spinner /> : <Mail />}Convidar</Button>
        </form>
        {convites.data?.map(c => <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 border-b py-1.5 text-sm">
          <span>{c.email} · {PAPEIS.find(p => p.value === c.papel)?.label} · expira {dataHora(c.expira_em)}</span>
          <span className="flex gap-1"><Button size="xs" variant="ghost" onClick={() => { navigator.clipboard.writeText(link(c.token)); toast.success('Link copiado.') }}><Copy />Copiar link</Button>
            <Button size="xs" variant="ghost" onClick={async () => { await supabase.from('convites').delete().eq('id', c.id); convites.refetch() }}>Cancelar</Button></span>
        </div>)}
      </CardContent></Card>}
      <Confirmar aberto={!!remover} titulo="Remover usuário?" descricao={`${remover?.email} perderá o acesso a esta organização.`} perigo textoBotao="Remover"
        onFechar={() => setRemover(null)} onConfirmar={() => rem.mutate(remover.user_id)} carregando={rem.isPending} />
    </div>
  )
}

function Integracoes() {
  const { org, empresas, podeAdministrar } = useOrg(); const qc = useQueryClient(); const [sp, setSp] = useSearchParams()
  // Retorno do OAuth: o código é trocado pelo backend em nome do usuário logado que iniciou o fluxo
  const callbackFeito = useRef(false)
  const [concluindo, setConcluindo] = useState(!!sp.get('bling_code'))
  useEffect(() => {
    const code = sp.get('bling_code'); const state = sp.get('bling_state')
    if (!code || !state || callbackFeito.current) return
    callbackFeito.current = true
    edge('bling-oauth', { action: 'callback', code, state })
      .then(() => { setSp({ bling: 'ok' }, { replace: true }); qc.invalidateQueries() })
      .catch((e: Error) => setSp({ bling: 'erro', motivo: e.message }, { replace: true }))
      .finally(() => setConcluindo(false))
  }, [sp, setSp, qc])
  const contas = useContasBancarias()
  const integ = useQuery({ queryKey: ['integracoes', org?.id], enabled: !!org, queryFn: async () => unwrap(await supabase.from('integracoes').select('*').eq('organizacao_id', org!.id)) as any[] })
  const [inicio, setInicio] = useState(somaMeses(inicioMes(hoje()), -12))
  const [empSel, setEmpSel] = useState(empresas[0]?.id ?? '')
  const conectar = useMutation({ mutationFn: (empresa: string) => edge<{ url: string }>('bling-oauth', { empresa_id: empresa, sync_inicio: inicio }),
    onSuccess: (r) => { window.location.href = r.url }, onError: (e: Error) => toast.error(e.message) })
  const desconectar = useMutation({ mutationFn: (id: string) => edge('bling-oauth', { action: 'disconnect', integracao_id: id }),
    onSuccess: () => { toast.success('Bling desconectado.'); integ.refetch() }, onError: (e: Error) => toast.error(e.message) })
  const sincronizar = useMutation({ mutationFn: (id: string) => edge<any>('bling-sync', { integracao_id: id }),
    onSuccess: (r) => { toast.success(`Sincronização executada (${r.processados} etapa(s)). Etapas longas continuam automaticamente.`); qc.invalidateQueries() }, onError: (e: Error) => toast.error(e.message) })
  const salvarCfg = async (i: any, cfg: any) => { const r = await supabase.from('integracoes').update({ config: { ...i.config, ...cfg } }).eq('id', i.id); if (r.error) toast.error(r.error.message); else { toast.success('Configuração salva.'); integ.refetch() } }
  const retorno = sp.get('bling')
  return (
    <div className="space-y-6">
      <PageHeader titulo="Integração com o Bling" descricao="API oficial Bling v3 com OAuth 2.0. Importa pedidos de venda, produtos (com custo), contatos, formas de pagamento e contas a pagar/receber."
        acoes={<a href="/ajuda/bling" target="_blank" rel="noopener" className="text-sm text-primary hover:underline">Manual da integração</a>} />
      {concluindo && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Concluindo a conexão com o Bling…</p>}
      {retorno === 'ok' && <Aviso className="border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300">Conta Bling conectada. A sincronização inicial foi agendada e roda em segundo plano.</Aviso>}
      {retorno === 'erro' && <Erro erro={`Não foi possível conectar ao Bling (${sp.get('motivo')}). Tente novamente; se persistir, verifique as credenciais do aplicativo na plataforma.`} />}
      {empresas.map(e => {
        const i = integ.data?.find(x => x.empresa_id === e.id)
        return (
          <Card key={e.id}><CardHeader className="flex-row items-center justify-between"><CardTitle className="text-sm">{e.nome_fantasia || e.razao_social}</CardTitle><Status s={i?.status ?? 'desconectado'} /></CardHeader>
            <CardContent className="space-y-4">
              {i && <div className="grid gap-2 text-sm sm:grid-cols-3">
                <span>Última sincronização: <b>{dataHora(i.ultima_sincronizacao)}</b></span>
                <span>Histórico desde: <b>{data(i.sync_inicio)}</b></span>
                {i.ultimo_erro && <span className="text-destructive sm:col-span-3">Último erro: {i.ultimo_erro}</span>}
              </div>}
              {podeAdministrar && (!i || ['desconectado', 'reautorizar', 'erro'].includes(i.status)) && (
                <div className="flex flex-wrap items-end gap-2">
                  <Campo rotulo="Importar histórico a partir de"><Input type="date" value={inicio} onChange={x => setInicio(x.target.value)} /></Campo>
                  <Button onClick={() => { setEmpSel(e.id); conectar.mutate(e.id) }} disabled={conectar.isPending && empSel === e.id}>{conectar.isPending && empSel === e.id ? <Spinner /> : <Link2 />}{i?.status === 'reautorizar' ? 'Reautorizar' : 'Conectar Bling'}</Button>
                </div>)}
              {podeAdministrar && i && ['conectado', 'erro'].includes(i.status) && (
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" onClick={() => sincronizar.mutate(i.id)} disabled={sincronizar.isPending}>{sincronizar.isPending ? <Spinner /> : <RefreshCw />}Sincronizar agora</Button>
                  <Button variant="ghost" onClick={() => desconectar.mutate(i.id)}><Unplug />Desconectar</Button>
                </div>)}
              {i && i.status !== 'desconectado' && <Tabs defaultValue="config">
                <TabsList><TabsTrigger value="config">Configuração</TabsTrigger><TabsTrigger value="map">Mapeamentos</TabsTrigger><TabsTrigger value="jobs">Execuções</TabsTrigger><TabsTrigger value="logs">Logs</TabsTrigger></TabsList>
                <TabsContent value="config" className="space-y-3 pt-3">
                  <Grade>
                    <Campo rotulo="Conta para registrar pagamentos feitos no Bling" ajuda="Opcional. Sem conta, contas pagas no Bling entram em aberto e são baixadas pela conciliação OFX (recomendado).">
                      <Seletor value={i.config?.conta_baixa_id ?? ''} disabled={!podeAdministrar} onChange={x => salvarCfg(i, { conta_baixa_id: x.target.value || null })} vazio="Não registrar (conciliar via OFX)"
                        opcoes={opcoes(contas.data?.filter(c => c.empresa_id === e.id))} /></Campo>
                    <Campo rotulo="Importar pedidos de venda" ajuda="Desligado: contas a receber de pedidos do Bling são importadas como títulos.">
                      <Switch checked={i.config?.importar_vendas !== false} disabled={!podeAdministrar} onCheckedChange={v => salvarCfg(i, { importar_vendas: v })} /></Campo>
                  </Grade>
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Importar pedidos com o status</p>
                    <p className="text-xs text-muted-foreground">Pedidos em outros status ficam de fora e entram automaticamente quando mudarem para um status marcado. Pedidos cancelados no Bling são sempre cancelados aqui.</p>
                    <div className="flex flex-wrap gap-2">
                      {SITUACOES_PEDIDO.map(([v, r]) => {
                        const atuais: number[] = i.config?.situacoes_importar ?? [1, 11, 8, 3]
                        const marcado = atuais.includes(v)
                        return (
                          <label key={v} className="flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm">
                            <Checkbox checked={marcado} disabled={!podeAdministrar || (marcado && atuais.length === 1)}
                              onCheckedChange={(c) => salvarCfg(i, { situacoes_importar: c ? [...atuais, v] : atuais.filter(x => x !== v) })} />{r}
                          </label>
                        )
                      })}
                    </div>
                  </div>
                </TabsContent>
                <TabsContent value="map" className="pt-3"><Mapeamentos integracao={i.id} /></TabsContent>
                <TabsContent value="jobs" className="pt-3"><Jobs integracao={i.id} /></TabsContent>
                <TabsContent value="logs" className="pt-3"><Logs integracao={i.id} /></TabsContent>
              </Tabs>}
            </CardContent></Card>
        )
      })}
      <Card><CardHeader><CardTitle className="text-sm">Webhooks</CardTitle></CardHeader><CardContent className="text-sm text-muted-foreground">
        Eventos de pedidos e produtos do Bling são recebidos em <code className="rounded bg-muted px-1">{import.meta.env.VITE_SUPABASE_URL}/functions/v1/bling-webhook</code> com verificação de assinatura (X-Bling-Signature-256). Configure essa URL na aba Webhooks do aplicativo na Central de Extensões do Bling.
      </CardContent></Card>
    </div>
  )
}

function Mapeamentos({ integracao }: { integracao: string }) {
  const { podeAdministrar } = useOrg()
  const canais = useCanais(); const formas = useFormas(); const cats = useCategorias()
  const q = useQuery({ queryKey: ['mapeamentos', integracao], queryFn: async () => unwrap(await supabase.from('integracao_mapeamentos').select('*').eq('integracao_id', integracao).order('tipo').order('external_nome')) as any[] })
  const set = async (m: any, v: string) => { const r = await supabase.from('integracao_mapeamentos').update({ interno_id: v || null }).eq('id', m.id); if (r.error) toast.error(r.error.message); else q.refetch() }
  const opc = (t: string) => t === 'loja' ? opcoes(canais.data) : t === 'forma_pagamento' ? opcoes(formas.data) : opcoesCategoria(cats.data)
  const rot = { loja: 'Loja do Bling → canal', forma_pagamento: 'Forma de pagamento', categoria: 'Categoria financeira' } as Record<string, string>
  if (!q.data?.length) return <p className="text-sm text-muted-foreground">Os mapeamentos aparecem após a primeira sincronização de cadastros.</p>
  return <div className="space-y-4">{['loja', 'forma_pagamento', 'categoria'].map(t => (
    <div key={t}><p className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">{rot[t]}</p>
      {q.data.filter(m => m.tipo === t).map(m => <div key={m.id} className="grid grid-cols-2 items-center gap-2 border-b py-1 text-sm">
        <span>{m.external_nome} <span className="text-xs text-muted-foreground">#{m.external_id}</span></span>
        <Seletor value={m.interno_id ?? ''} disabled={!podeAdministrar} onChange={e => set(m, e.target.value)} vazio={t === 'categoria' ? 'Categoria padrão (Outras)' : 'Não mapeado'} opcoes={opc(t)} />
      </div>)}</div>))}</div>
}
function Jobs({ integracao }: { integracao: string }) {
  const q = useQuery({ queryKey: ['jobs', integracao], refetchInterval: 15000, queryFn: async () => unwrap(await supabase.from('sync_jobs').select('*').eq('integracao_id', integracao).order('created_at', { ascending: false }).limit(50)) as any[] })
  const col: Coluna<any>[] = [{ id: 'c', titulo: 'Criado', celula: j => dataHora(j.created_at), valor: j => j.created_at }, { id: 'r', titulo: 'Recurso', celula: j => j.recurso, valor: j => j.recurso },
    { id: 't', titulo: 'Tipo', celula: j => j.tipo }, { id: 's', titulo: 'Status', celula: j => <Status s={j.status} />, valor: j => j.status },
    { id: 'n', titulo: 'Registros', alinhar: 'right', celula: j => num(j.registros_importados), valor: j => j.registros_importados },
    { id: 'e', titulo: 'Tentativas / erro', celula: j => <span className="text-xs">{j.tentativas}{j.erro ? ` · ${j.erro.slice(0, 120)}` : ''}</span> }]
  return <DataTable colunas={col} linhas={q.data} carregando={q.isLoading} busca={false} compacta />
}
function Logs({ integracao }: { integracao?: string }) {
  const { org } = useOrg()
  const q = useQuery({ queryKey: ['sync-logs', integracao, org?.id], enabled: !!org, queryFn: async () => {
    let x = supabase.from('sync_logs').select('*').eq('organizacao_id', org!.id).order('created_at', { ascending: false }).limit(300)
    if (integracao) x = x.eq('integracao_id', integracao)
    return unwrap(await x) as any[] } })
  const col: Coluna<any>[] = [{ id: 'd', titulo: 'Data', celula: l => dataHora(l.created_at), valor: l => l.created_at },
    { id: 'n', titulo: 'Nível', celula: l => <Status s={l.nivel === 'erro' ? 'erro' : l.nivel === 'aviso' ? 'pendente' : 'concluido'} />, valor: l => l.nivel },
    { id: 'm', titulo: 'Mensagem', celula: l => <span className="text-xs">{l.mensagem}</span>, valor: l => l.mensagem }]
  return <DataTable colunas={col} linhas={q.data} carregando={q.isLoading} compacta chave={l => String(l.id)} exportar={{ nome: 'logs-integracao', titulo: 'Logs de integração' }} />
}

function Regras() {
  const cats = useCategorias(); const contatos = useContatos(); const centros = useCentros(); const contas = useContasBancarias()
  const cfg: CrudConfig = {
    tabela: 'regras_conciliacao', titulo: 'Regras de conciliação', singular: 'Regra', permissao: 'escrita', ordem: 'prioridade',
    descricao: 'Ex.: descrição contém "TARIFA" → categoria Tarifas bancárias. Ao aplicar, cria o lançamento já baixado e concilia a transação do extrato.',
    campos: [
      { nome: 'nome', rotulo: 'Nome', tipo: 'texto', obrigatorio: true },
      { nome: 'descricao_contem', rotulo: 'Descrição do extrato contém', tipo: 'texto', obrigatorio: true },
      { nome: 'sentido', rotulo: 'Sentido', tipo: 'selecao', padrao: 'saida', obrigatorio: true, opcoes: [{ value: 'saida', label: 'Saídas' }, { value: 'entrada', label: 'Entradas' }, { value: 'ambos', label: 'Ambos' }] },
      { nome: 'conta_bancaria_id', rotulo: 'Conta', tipo: 'selecao', opcoes: opcoes(contas.data), vazio: 'Todas as contas' },
      { nome: 'categoria_id', rotulo: 'Categoria', tipo: 'selecao', obrigatorio: true, opcoes: opcoesCategoria(cats.data) },
      { nome: 'contato_id', rotulo: 'Fornecedor/cliente', tipo: 'selecao', opcoes: opcoes(contatos.data), vazio: '—' },
      { nome: 'centro_custo_id', rotulo: 'Centro de custo', tipo: 'selecao', opcoes: opcoes(centros.data), vazio: '—' },
      { nome: 'prioridade', rotulo: 'Prioridade (menor = primeiro)', tipo: 'numero', padrao: 100 },
      { nome: 'ativo', rotulo: 'Ativa', tipo: 'booleano', padrao: true },
    ],
    colunas: [
      { id: 'n', titulo: 'Regra', celula: r => r.nome, valor: r => r.nome },
      { id: 'c', titulo: 'Contém', celula: r => <code className="rounded bg-muted px-1 text-xs">{r.descricao_contem}</code>, valor: r => r.descricao_contem },
      { id: 's', titulo: 'Sentido', celula: r => r.sentido, valor: r => r.sentido },
      { id: 'k', titulo: 'Categoria', celula: r => cats.data?.find(c => c.id === r.categoria_id)?.nome, valor: r => cats.data?.find(c => c.id === r.categoria_id)?.nome },
      { id: 'p', titulo: 'Prioridade', alinhar: 'right', celula: r => r.prioridade, valor: r => r.prioridade },
      { id: 'a', titulo: 'Status', celula: r => r.ativo ? 'Ativa' : 'Inativa' },
    ],
  }
  return <CrudPage cfg={cfg} />
}

function ConfigIA() {
  const { org, podeAdministrar, ehAdminPlataforma } = useOrg()
  const q = useQuery({ queryKey: ['ia-config', org?.id], enabled: !!org, queryFn: async () => {
    const [c, p] = await Promise.all([supabase.from('ia_config').select('*').eq('organizacao_id', org!.id).maybeSingle(), supabase.from('ia_config_plataforma').select('*').single()])
    return { cfg: c.data ?? { organizacao_id: org!.id, modelo: null, instrucoes: '', auto_aplicar: false, nivel_confianca: 0.9, alertas_ativos: true }, plat: p.data }
  } })
  const [f, setF] = useState<any>(null)
  const atual = f ?? q.data?.cfg
  const salvar = useMutation({ mutationFn: async () => unwrap(await supabase.from('ia_config').upsert({ ...atual, organizacao_id: org!.id, updated_at: new Date().toISOString() })),
    onSuccess: () => { toast.success('Configuração da IA salva.'); q.refetch() }, onError: (e: Error) => toast.error(traduzirErro(e.message)) })
  if (!atual) return <><PageHeader titulo="Configuração da IA" /><Spinner /></>
  return (
    <div className="space-y-6">
      <PageHeader titulo="Configuração da IA" descricao="Processamento exclusivamente no servidor via OpenRouter. As chaves nunca são expostas no navegador." />
      <Card><CardContent className="space-y-4 pt-6">
        <Grade>
          <Campo rotulo="Modelo" ajuda={`Padrão da plataforma: ${q.data?.plat?.modelo_padrao}`}>
            <Seletor value={atual.modelo ?? ''} disabled={!podeAdministrar} onChange={e => setF({ ...atual, modelo: e.target.value || null })} vazio="Usar padrão da plataforma"
              opcoes={(q.data?.plat?.modelos_disponiveis ?? []).map((m: string) => ({ value: m, label: m }))} /></Campo>
          <Campo rotulo="Nível de confiança para aplicação automática" ajuda="Somente categorização de títulos; conciliação sempre exige aprovação.">
            <Input type="number" min={0.5} max={1} step={0.01} value={atual.nivel_confianca} disabled={!podeAdministrar} onChange={e => setF({ ...atual, nivel_confianca: Number(e.target.value) })} /></Campo>
          <Campo rotulo="Aplicar categorização automaticamente acima do nível"><Switch checked={atual.auto_aplicar} disabled={!podeAdministrar} onCheckedChange={v => setF({ ...atual, auto_aplicar: v })} /></Campo>
          <Campo rotulo="Alertas e resumo semanal da IA"><Switch checked={atual.alertas_ativos} disabled={!podeAdministrar} onCheckedChange={v => setF({ ...atual, alertas_ativos: v })} /></Campo>
          <Campo rotulo="Instruções adicionais para a IA" className="sm:col-span-2" ajuda="Ex.: 'Nossa loja fecha às segundas; considere o 13º em dezembro.'">
            <Textarea rows={4} value={atual.instrucoes ?? ''} disabled={!podeAdministrar} onChange={e => setF({ ...atual, instrucoes: e.target.value })} /></Campo>
        </Grade>
        {podeAdministrar && <Button onClick={() => salvar.mutate()} disabled={salvar.isPending}>Salvar</Button>}
      </CardContent></Card>
      {ehAdminPlataforma && <p className="text-xs text-muted-foreground">Modelos disponíveis e prompt do sistema são definidos no Painel da plataforma.</p>}
    </div>
  )
}

function Periodos() {
  const { org, empresas, podeAdministrar } = useOrg(); const qc = useQueryClient()
  const [emp, setEmp] = useState(empresas[0]?.id ?? ''); const [reabrir, setReabrir] = useState<string | null>(null); const [motivo, setMotivo] = useState('')
  const q = useQuery({ queryKey: ['periodos', emp], enabled: !!emp, queryFn: async () => {
    const [f, r] = await Promise.all([supabase.from('periodos_fechados').select('*').eq('empresa_id', emp), supabase.from('periodos_reaberturas').select('*').eq('empresa_id', emp).order('reaberto_em', { ascending: false })])
    return { fechados: unwrap(f) as any[], reaberturas: unwrap(r) as any[] }
  } })
  const meses = Array.from({ length: 18 }, (_, i) => somaMeses(inicioMes(hoje()), -i))
  const fechar = useMutation({ mutationFn: async (m: string) => unwrap(await supabase.from('periodos_fechados').insert({ organizacao_id: org!.id, empresa_id: emp, competencia: m })),
    onSuccess: () => { toast.success('Período fechado.'); qc.invalidateQueries({ queryKey: ['periodos'] }) }, onError: (e: Error) => toast.error(traduzirErro(e.message)) })
  const reab = useMutation({ mutationFn: () => rpc('fn_reabrir_periodo', { p_empresa: emp, p_competencia: reabrir, p_motivo: motivo }),
    onSuccess: () => { toast.success('Período reaberto (registrado na auditoria).'); setReabrir(null); setMotivo(''); qc.invalidateQueries({ queryKey: ['periodos'] }) }, onError: (e: Error) => toast.error(e.message) })
  return (
    <div className="space-y-6">
      <PageHeader titulo="Fechamento de períodos" descricao="Meses fechados ficam bloqueados para inclusão, edição, baixa e exclusão. A reabertura exige motivo e fica registrada."
        acoes={empresas.length > 1 && <Seletor className="w-auto" value={emp} onChange={e => setEmp(e.target.value)} opcoes={empresas.map(e => ({ value: e.id, label: e.nome_fantasia || e.razao_social }))} />} />
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {meses.map(m => {
          const fechado = q.data?.fechados.find(f => f.competencia === m)
          return <Card key={m} className="flex-row items-center justify-between gap-2 p-3">
            <span className="flex items-center gap-2 text-sm font-medium">{fechado ? <Lock className="size-4 text-muted-foreground" /> : <LockOpen className="size-4 text-positivo" />}{mesAno(m)}</span>
            {podeAdministrar && (fechado ? <Button size="sm" variant="ghost" onClick={() => setReabrir(m)}>Reabrir</Button>
              : <Button size="sm" variant="outline" onClick={() => fechar.mutate(m)} disabled={m >= inicioMes(hoje())}>Fechar</Button>)}
          </Card>
        })}
      </div>
      {!!q.data?.reaberturas.length && <Card><CardHeader><CardTitle className="text-sm">Histórico de reaberturas</CardTitle></CardHeader><CardContent>
        {q.data.reaberturas.map(r => <p key={r.id} className="border-b py-1 text-sm">{mesAno(r.competencia)} · {dataHora(r.reaberto_em)} · {r.motivo}</p>)}</CardContent></Card>}
      <Confirmar aberto={!!reabrir} titulo={`Reabrir ${reabrir ? mesAno(reabrir) : ''}?`} textoBotao="Reabrir" carregando={reab.isPending} onFechar={() => setReabrir(null)} onConfirmar={() => reab.mutate()}>
        <Campo rotulo="Motivo (obrigatório)"><Input value={motivo} onChange={e => setMotivo(e.target.value)} /></Campo>
      </Confirmar>
    </div>
  )
}

function Depreciacoes() {
  const { empresas } = useOrg()
  const empOpc = empresas.map(e => ({ value: e.id, label: e.nome_fantasia || e.razao_social }))
  return <CrudPage cfg={{
    tabela: 'depreciacoes', titulo: 'Depreciações', singular: 'Depreciação', ordem: 'inicio', permissao: 'escrita',
    descricao: 'Valor mensal lançado na linha "Depreciação" da DRE, sem efeito no caixa (a compra do bem entra na DFC de investimento).',
    campos: [{ nome: 'empresa_id', rotulo: 'Empresa', tipo: 'selecao', obrigatorio: true, opcoes: empOpc, padrao: empOpc[0]?.value },
      { nome: 'descricao', rotulo: 'Bem', tipo: 'texto', obrigatorio: true }, { nome: 'valor_mensal', rotulo: 'Valor mensal', tipo: 'dinheiro', obrigatorio: true },
      { nome: 'inicio', rotulo: 'Início', tipo: 'data', obrigatorio: true, padrao: hoje }, { nome: 'meses', rotulo: 'Quantidade de meses', tipo: 'numero', obrigatorio: true, padrao: 60 }],
    colunas: [{ id: 'd', titulo: 'Bem', celula: r => r.descricao, valor: r => r.descricao }, { id: 'v', titulo: 'Mensal', alinhar: 'right', celula: r => brl(r.valor_mensal), valor: r => Number(r.valor_mensal) },
      { id: 'i', titulo: 'Início', celula: r => data(r.inicio), valor: r => r.inicio }, { id: 'm', titulo: 'Meses', alinhar: 'right', celula: r => r.meses }],
  }} />
}

function Auditoria() {
  const { org } = useOrg()
  const [tabela, setTabela] = useState('')
  const q = useQuery({ queryKey: ['auditoria', org?.id, tabela], enabled: !!org, queryFn: async () => {
    let x = supabase.from('audit_log').select('*').eq('organizacao_id', org!.id).order('created_at', { ascending: false }).limit(500)
    if (tabela) x = x.eq('tabela', tabela)
    return unwrap(await x) as any[] } })
  const membros = useQuery({ queryKey: ['membros', org?.id], enabled: !!org, queryFn: () => rpc<any[]>('fn_membros', { p_org: org!.id }) })
  const quem = (id: string | null) => !id ? 'Sistema' : membros.data?.find(m => m.user_id === id)?.email ?? id.slice(0, 8)
  const resumo = (a: any) => {
    if (a.acao === 'update' && a.antes && a.depois) return Object.keys(a.depois).filter(k => !['updated_at', 'version'].includes(k) && JSON.stringify(a.antes[k]) !== JSON.stringify(a.depois[k]))
      .map(k => `${k}: ${JSON.stringify(a.antes[k])} → ${JSON.stringify(a.depois[k])}`).join('; ')
    const r = a.depois ?? a.antes ?? {}
    return r.descricao ?? r.nome ?? r.motivo ?? (r.valor != null ? `valor ${r.valor}` : '')
  }
  const col: Coluna<any>[] = [
    { id: 'd', titulo: 'Data', celula: a => dataHora(a.created_at), valor: a => a.created_at },
    { id: 'u', titulo: 'Usuário', celula: a => quem(a.user_id), valor: a => quem(a.user_id) },
    { id: 't', titulo: 'Tabela', celula: a => a.tabela, valor: a => a.tabela },
    { id: 'a', titulo: 'Ação', celula: a => ({ insert: 'criação', update: 'edição', delete: 'exclusão' } as any)[a.acao] ?? a.acao, valor: a => a.acao },
    { id: 'r', titulo: 'Detalhe', celula: a => <span className="line-clamp-2 max-w-xl text-xs">{resumo(a)}</span>, valor: a => resumo(a) },
  ]
  return (
    <div className="space-y-6">
      <PageHeader titulo="Auditoria e logs" descricao="Criação, edição, exclusão, baixas, conciliações, reaberturas de período e alterações de usuários." />
      <Tabs defaultValue="aud"><TabsList><TabsTrigger value="aud">Histórico de ações</TabsTrigger><TabsTrigger value="int">Logs de integração</TabsTrigger></TabsList>
        <TabsContent value="aud" className="pt-3">
          <DataTable colunas={col} linhas={q.data} carregando={q.isLoading} chave={a => String(a.id)} compacta exportar={{ nome: 'auditoria', titulo: 'Auditoria' }}
            barra={<Seletor className="w-auto" value={tabela} onChange={e => setTabela(e.target.value)} vazio="Todas as tabelas"
              opcoes={['titulos', 'baixas', 'transferencias', 'vendas', 'devolucoes', 'conciliacoes', 'periodos_fechados', 'periodos_reaberturas', 'membros', 'empresas', 'contas_bancarias', 'plano_contas', 'integracoes', 'emprestimos'].map(t => ({ value: t, label: t }))} />} />
        </TabsContent>
        <TabsContent value="int" className="pt-3"><Logs /></TabsContent>
      </Tabs>
    </div>
  )
}
