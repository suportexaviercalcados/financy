// Painel do dono da plataforma: organizações, uso, integrações e consumo de IA — sem dados financeiros detalhados
import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase, rpc } from '@/lib/supabase'
import { useOrg } from '@/contexts/org'
import { dataHora, num } from '@/lib/format'
import { DataTable, type Coluna } from '@/components/DataTable'
import { Kpi, PageHeader, Status } from '@/components/common'
import { Seletor, Campo } from '@/components/form'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

export default function Admin() {
  const { ehAdminPlataforma } = useOrg()
  const q = useQuery({ queryKey: ['admin-orgs'], enabled: ehAdminPlataforma, queryFn: () => rpc<any[]>('fn_admin_organizacoes') })
  const planos = useQuery({ queryKey: ['planos'], queryFn: async () => (await supabase.from('planos').select('*')).data ?? [] })
  const plat = useQuery({ queryKey: ['ia-plat'], queryFn: async () => (await supabase.from('ia_config_plataforma').select('*').single()).data })
  const [ia, setIa] = useState<any>(null)
  const setPlano = useMutation({ mutationFn: ({ org, plano }: { org: string; plano: string }) => rpc('fn_admin_set_plano', { p_org: org, p_plano: plano }),
    onSuccess: () => { toast.success('Plano alterado.'); q.refetch() }, onError: (e: Error) => toast.error(e.message) })
  const salvarIA = useMutation({ mutationFn: () => rpc('fn_admin_ia_config', { p_modelo: ia.modelo_padrao, p_modelos: ia.modelos_txt.split('\n').map((s: string) => s.trim()).filter(Boolean), p_prompt: ia.prompt_sistema }),
    onSuccess: () => { toast.success('Configuração da IA da plataforma salva.'); plat.refetch() }, onError: (e: Error) => toast.error(e.message) })
  if (!ehAdminPlataforma) return <Navigate to="/" replace />
  const l = q.data ?? []
  const iaAtual = ia ?? (plat.data && { ...plat.data, modelos_txt: (plat.data.modelos_disponiveis ?? []).join('\n') })
  const col: Coluna<any>[] = [
    { id: 'n', titulo: 'Organização', celula: o => o.nome, valor: o => o.nome },
    { id: 'c', titulo: 'Criada', celula: o => dataHora(o.criada_em), valor: o => o.criada_em },
    { id: 'p', titulo: 'Plano', valor: o => o.plano_id, celula: o => <Seletor className="w-auto" value={o.plano_id} onChange={e => setPlano.mutate({ org: o.id, plano: e.target.value })} opcoes={(planos.data ?? []).map((p: any) => ({ value: p.id, label: p.nome }))} /> },
    { id: 'a', titulo: 'Assinatura', celula: o => o.assinatura ?? '—', valor: o => o.assinatura },
    { id: 'u', titulo: 'Usuários', alinhar: 'right', celula: o => num(o.usuarios), valor: o => Number(o.usuarios) },
    { id: 'e', titulo: 'Empresas', alinhar: 'right', celula: o => num(o.empresas), valor: o => Number(o.empresas) },
    { id: 'i', titulo: 'IA no mês', alinhar: 'right', celula: o => `${num(o.ia_tokens_mes)} tokens · ${num(o.ia_execucoes_mes)} exec.`, valor: o => Number(o.ia_tokens_mes) },
    { id: 'b', titulo: 'Integrações', celula: o => (o.integracoes ?? []).map((i: any, k: number) => <span key={k} className="mr-1"><Status s={i.status} /></span>), valor: o => (o.integracoes ?? []).map((i: any) => i.status).join(',') },
  ]
  return (
    <div className="space-y-6">
      <PageHeader titulo="Painel da plataforma" descricao="Visão de uso por organização. Dados financeiros detalhados só com concessão registrada pelo proprietário da organização." />
      <div className="grid gap-3 sm:grid-cols-4">
        <Kpi titulo="Organizações" valor={num(l.length)} />
        <Kpi titulo="Usuários" valor={num(l.reduce((s, o) => s + Number(o.usuarios), 0))} />
        <Kpi titulo="Tokens de IA no mês" valor={num(l.reduce((s, o) => s + Number(o.ia_tokens_mes), 0))} />
        <Kpi titulo="Integrações com erro" valor={num(l.reduce((s, o) => s + (o.integracoes ?? []).filter((i: any) => i.status !== 'conectado').length, 0))} />
      </div>
      <DataTable colunas={col} linhas={l} carregando={q.isLoading} exportar={{ nome: 'organizacoes', titulo: 'Organizações' }} />
      {iaAtual && <Card><CardHeader><CardTitle className="text-sm">IA da plataforma (OpenRouter)</CardTitle></CardHeader><CardContent className="space-y-3">
        <Campo rotulo="Modelo padrão"><Input value={iaAtual.modelo_padrao} onChange={e => setIa({ ...iaAtual, modelo_padrao: e.target.value })} /></Campo>
        <Campo rotulo="Modelos disponíveis para as organizações (um por linha, ids da OpenRouter)"><Textarea rows={4} value={iaAtual.modelos_txt} onChange={e => setIa({ ...iaAtual, modelos_txt: e.target.value })} /></Campo>
        <Campo rotulo="Prompt do sistema"><Textarea rows={8} value={iaAtual.prompt_sistema} onChange={e => setIa({ ...iaAtual, prompt_sistema: e.target.value })} /></Campo>
        <Button onClick={() => salvarIA.mutate()} disabled={salvarIA.isPending}>Salvar</Button>
      </CardContent></Card>}
    </div>
  )
}
