import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Bot, FileText, Send, Sparkles, User } from 'lucide-react'
import { supabase, rpc, unwrap, edge } from '@/lib/supabase'
import { useOrg } from '@/contexts/org'
import { data, dataHora, num } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DataTable, type Coluna } from '@/components/DataTable'
import { Erro, PageHeader, Spinner, Status } from '@/components/common'
import { cn } from '@/lib/utils'

type Msg = { role: 'user' | 'assistant'; content: string; fontes?: string[] }
const SUGESTOES = ['Quanto vendi em cada canal neste mês?', 'Qual a maior despesa do trimestre?', 'Meu caixa fica negativo nos próximos 60 dias?',
  'Quais contas a pagar estão vencidas?', 'Qual canal tem a melhor margem de contribuição?', 'Quais produtos mais venderam no mês?']

/** Markdown mínimo: **negrito** e quebras de linha (texto escapado pelo React) */
function Texto({ t }: { t: string }) {
  return <>{t.split('\n').map((linha, i) => <p key={i} className={cn('min-h-3', linha.startsWith('#') && 'font-semibold')}>
    {linha.replace(/^#+\s*/, '').split(/(\*\*[^*]+\*\*)/).map((p, j) => p.startsWith('**') ? <b key={j}>{p.slice(2, -2)}</b> : p)}</p>)}</>
}

export default function IA() {
  const { org, empresaIds, periodo } = useOrg()
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [texto, setTexto] = useState('')
  const fim = useRef<HTMLDivElement>(null)
  useEffect(() => { fim.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs])
  const uso = useQuery({ queryKey: ['ia-uso', org?.id], enabled: !!org, queryFn: () => rpc<any>('fn_ia_uso_mes', { p_org: org!.id }) })
  const hist = useQuery({ queryKey: ['ia-exec', org?.id], enabled: !!org, queryFn: async () =>
    unwrap(await supabase.from('ia_execucoes').select('id, tipo, modelo, status, prompt_tokens, completion_tokens, custo_usd, duracao_ms, erro, created_at, ferramentas').eq('organizacao_id', org!.id).order('created_at', { ascending: false }).limit(100)) as any[] })
  const chat = useMutation({
    mutationFn: (historico: Msg[]) => edge<{ resposta: string; fontes: string[] }>('ai-assistant', { acao: 'chat', organizacao_id: org!.id, empresa_ids: empresaIds,
      mensagens: historico.map(m => ({ role: m.role, content: m.content })), idempotency_key: crypto.randomUUID() }),
    onSuccess: (r) => { setMsgs(m => [...m, { role: 'assistant', content: r.resposta, fontes: r.fontes }]); uso.refetch(); hist.refetch() },
  })
  const resumo = useMutation({
    mutationFn: () => edge<{ resposta: string }>('ai-assistant', { acao: 'resumo', organizacao_id: org!.id, empresa_ids: empresaIds, inicio: periodo.inicio, fim: periodo.fim, idempotency_key: crypto.randomUUID() }),
    onSuccess: (r) => { setMsgs(m => [...m, { role: 'user', content: `Explique o resultado de ${data(periodo.inicio)} a ${data(periodo.fim)}` }, { role: 'assistant', content: r.resposta, fontes: ['DRE', 'vendas por canal', 'despesas', 'saldos', 'projeção'] }]); uso.refetch() },
  })
  const enviar = (t: string) => {
    if (!t.trim() || chat.isPending) return
    const h = [...msgs, { role: 'user' as const, content: t.trim() }]
    setMsgs(h); setTexto(''); chat.mutate(h)
  }
  const pctUso = uso.data ? Math.min(100, 100 * Number(uso.data.tokens) / Number(uso.data.limite)) : 0
  const colHist: Coluna<any>[] = [
    { id: 'd', titulo: 'Data', celula: r => dataHora(r.created_at), valor: r => r.created_at },
    { id: 't', titulo: 'Tipo', celula: r => r.tipo, valor: r => r.tipo },
    { id: 'm', titulo: 'Modelo', celula: r => <span className="text-xs">{r.modelo}</span>, valor: r => r.modelo },
    { id: 'f', titulo: 'Consultas ao banco', celula: r => <span className="text-xs">{(r.ferramentas ?? []).map((f: any) => f.nome).join(', ') || '—'}</span> },
    { id: 'k', titulo: 'Tokens', alinhar: 'right', celula: r => num(r.prompt_tokens + r.completion_tokens), valor: r => r.prompt_tokens + r.completion_tokens },
    { id: 's', titulo: 'Status', celula: r => <span title={r.erro ?? ''}><Status s={r.status === 'sucesso' ? 'concluido' : r.status} /></span>, valor: r => r.status },
  ]
  return (
    <div>
      <PageHeader titulo="Assistente financeiro (IA)" descricao="Pergunte sobre seus números. A IA consulta somente os dados da sua organização por funções seguras — nunca inventa valores, nunca paga, baixa ou exclui." />
      <Tabs defaultValue="chat">
        <TabsList><TabsTrigger value="chat">Conversa</TabsTrigger><TabsTrigger value="historico">Histórico e consumo</TabsTrigger></TabsList>
        <TabsContent value="chat" className="pt-4">
          <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
            <Card className="flex h-[65vh] flex-col p-0">
              <div className="flex-1 space-y-4 overflow-y-auto p-4">
                {!msgs.length && (
                  <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                    <Sparkles className="size-8 text-primary" /><p className="text-sm text-muted-foreground">Comece com uma pergunta ou peça a explicação do resultado do período.</p>
                    <div className="flex max-w-xl flex-wrap justify-center gap-2">{SUGESTOES.map(s => <Button key={s} size="sm" variant="outline" onClick={() => enviar(s)}>{s}</Button>)}</div>
                  </div>
                )}
                {msgs.map((m, i) => (
                  <div key={i} className={cn('flex gap-2', m.role === 'user' && 'flex-row-reverse')}>
                    <div className={cn('flex size-7 shrink-0 items-center justify-center rounded-full', m.role === 'user' ? 'bg-muted' : 'bg-primary text-primary-foreground')}>{m.role === 'user' ? <User className="size-4" /> : <Bot className="size-4" />}</div>
                    <div className={cn('max-w-[80%] rounded-xl px-3 py-2 text-sm', m.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted')}>
                      <Texto t={m.content} />
                      {m.fontes?.length ? <p className="mt-2 text-[11px] opacity-70">Fontes consultadas: {[...new Set(m.fontes)].join(', ')}</p> : null}
                    </div>
                  </div>
                ))}
                {(chat.isPending || resumo.isPending) && <div className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />Consultando seus dados…</div>}
                {(chat.error || resumo.error) && <Erro erro={chat.error || resumo.error} />}
                <div ref={fim} />
              </div>
              <form className="flex gap-2 border-t p-3" onSubmit={e => { e.preventDefault(); enviar(texto) }}>
                <Textarea rows={1} className="min-h-9 resize-none" placeholder="Ex.: quanto vendi no WhatsApp em outubro?" value={texto} onChange={e => setTexto(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); enviar(texto) } }} />
                <Button type="submit" size="icon" disabled={chat.isPending || !texto.trim()} aria-label="Enviar"><Send /></Button>
              </form>
            </Card>
            <div className="space-y-4">
              <Card><CardHeader><CardTitle className="text-sm">Análise do período</CardTitle></CardHeader><CardContent className="space-y-2">
                <p className="text-xs text-muted-foreground">{data(periodo.inicio)} a {data(periodo.fim)}, comparado ao período anterior.</p>
                <Button className="w-full" onClick={() => resumo.mutate()} disabled={resumo.isPending}>{resumo.isPending ? <Spinner /> : <FileText />}Explicar o resultado</Button>
              </CardContent></Card>
              <Card><CardHeader><CardTitle className="text-sm">Consumo de IA no mês</CardTitle></CardHeader><CardContent className="space-y-2">
                <Progress value={pctUso} />
                <p className="text-xs text-muted-foreground">{num(uso.data?.tokens ?? 0)} de {num(uso.data?.limite ?? 0)} tokens · {uso.data?.execucoes ?? 0} execuções</p>
              </CardContent></Card>
            </div>
          </div>
        </TabsContent>
        <TabsContent value="historico" className="pt-4">
          <DataTable colunas={colHist} linhas={hist.data} carregando={hist.isLoading} exportar={{ nome: 'execucoes-ia', titulo: 'Execuções da IA' }} />
        </TabsContent>
      </Tabs>
    </div>
  )
}
