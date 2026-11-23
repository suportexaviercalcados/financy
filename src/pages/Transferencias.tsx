import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase, unwrap } from '@/lib/supabase'
import { useOrg } from '@/contexts/org'
import { useContasBancarias } from '@/hooks/lookups'
import { brl, data, hoje } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DataTable, type Coluna } from '@/components/DataTable'
import { Campo, EntradaValor, Grade, Seletor } from '@/components/form'
import { Confirmar, Erro, PageHeader, Spinner } from '@/components/common'
import { traduzirErro } from '@/components/CrudPage'

export default function Transferencias() {
  const { org, empresaIds, periodo, podeEscrever } = useOrg()
  const qc = useQueryClient(); const contas = useContasBancarias()
  const [nova, setNova] = useState(false); const [excluir, setExcluir] = useState<any | null>(null)
  const q = useQuery({ queryKey: ['transferencias', org?.id, empresaIds, periodo], enabled: !!org, queryFn: async () => {
    let x = supabase.from('transferencias').select('*').eq('organizacao_id', org!.id).gte('data', periodo.inicio).lte('data', periodo.fim).order('data', { ascending: false })
    if (empresaIds) x = x.in('empresa_id', empresaIds)
    return unwrap(await x) as any[]
  } })
  const nome = (id: string) => contas.data?.find(c => c.id === id)?.nome ?? '—'
  const del = useMutation({
    mutationFn: async (t: any) => unwrap(await supabase.from('transferencias').delete().eq('id', t.id)),
    onSuccess: () => { toast.success('Transferência excluída.'); setExcluir(null); qc.invalidateQueries() },
    onError: (e: Error) => { toast.error(traduzirErro(e.message)); setExcluir(null) },
  })
  const colunas: Coluna<any>[] = [
    { id: 'd', titulo: 'Data', celula: t => data(t.data), valor: t => t.data },
    { id: 'o', titulo: 'Origem → destino', celula: t => <span className="inline-flex items-center gap-1">{nome(t.conta_origem_id)}<ArrowRight className="size-3" />{nome(t.conta_destino_id)}</span>, valor: t => nome(t.conta_origem_id) },
    { id: 'x', titulo: 'Descrição', celula: t => t.descricao ?? '—', valor: t => t.descricao },
    { id: 'v', titulo: 'Valor', alinhar: 'right', celula: t => brl(t.valor), valor: t => Number(t.valor) },
    { id: 'a', titulo: '', alinhar: 'right', celula: t => podeEscrever && <Button size="icon-sm" variant="ghost" aria-label="Excluir" onClick={() => setExcluir(t)}><Trash2 /></Button> },
  ]
  return (
    <div>
      <PageHeader titulo="Transferências entre contas" descricao="Movimentam saldo entre contas da mesma empresa sem contar como receita ou despesa."
        acoes={podeEscrever && <Button onClick={() => setNova(true)}><Plus />Nova transferência</Button>} />
      <DataTable colunas={colunas} linhas={q.data} carregando={q.isLoading} exportar={{ nome: 'transferencias', titulo: 'Transferências' }} />
      {nova && <NovaTransferencia onFechar={() => setNova(false)} />}
      <Confirmar aberto={!!excluir} titulo="Excluir transferência?" perigo textoBotao="Excluir" carregando={del.isPending}
        descricao="Os dois movimentos (saída e entrada) são removidos. Não é possível excluir se algum estiver conciliado." onFechar={() => setExcluir(null)} onConfirmar={() => del.mutate(excluir)} />
    </div>
  )
}

function NovaTransferencia({ onFechar }: { onFechar: () => void }) {
  const { org } = useOrg(); const qc = useQueryClient(); const contas = useContasBancarias()
  const [f, setF] = useState({ origem: '', destino: '', data: hoje(), valor: NaN, descricao: '' })
  const [erro, setErro] = useState<string | null>(null)
  const origem = contas.data?.find(c => c.id === f.origem)
  const m = useMutation({
    mutationFn: async () => {
      if (!f.origem || !f.destino) throw new Error('Escolha as contas de origem e destino.')
      if (f.origem === f.destino) throw new Error('Origem e destino devem ser diferentes.')
      if (!(f.valor > 0)) throw new Error('Informe o valor.')
      unwrap(await supabase.from('transferencias').insert({ organizacao_id: org!.id, empresa_id: origem!.empresa_id, conta_origem_id: f.origem,
        conta_destino_id: f.destino, data: f.data, valor: f.valor, descricao: f.descricao || null }))
    },
    onSuccess: () => { toast.success('Transferência registrada.'); qc.invalidateQueries(); onFechar() },
    onError: (e: Error) => setErro(traduzirErro(e.message)),
  })
  return (
    <Dialog open onOpenChange={o => !o && onFechar()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Nova transferência</DialogTitle><DialogDescription>Somente entre contas da mesma empresa.</DialogDescription></DialogHeader>
        <Grade>
          <Campo rotulo="Conta de origem" obrigatorio><Seletor value={f.origem} onChange={e => setF({ ...f, origem: e.target.value, destino: '' })} vazio="Selecione…" opcoes={(contas.data ?? []).filter(c => c.ativo).map(c => ({ value: c.id, label: c.nome }))} /></Campo>
          <Campo rotulo="Conta de destino" obrigatorio><Seletor value={f.destino} onChange={e => setF({ ...f, destino: e.target.value })} vazio="Selecione…"
            opcoes={(contas.data ?? []).filter(c => c.ativo && c.id !== f.origem && (!origem || c.empresa_id === origem.empresa_id)).map(c => ({ value: c.id, label: c.nome }))} /></Campo>
          <Campo rotulo="Data" obrigatorio><Input type="date" value={f.data} onChange={e => setF({ ...f, data: e.target.value })} /></Campo>
          <Campo rotulo="Valor" obrigatorio><EntradaValor valor={f.valor} onChange={v => setF({ ...f, valor: v })} /></Campo>
          <Campo rotulo="Descrição" className="sm:col-span-2"><Input value={f.descricao} onChange={e => setF({ ...f, descricao: e.target.value })} /></Campo>
        </Grade>
        {erro && <Erro erro={erro} />}
        <DialogFooter><Button variant="outline" onClick={onFechar}>Cancelar</Button><Button onClick={() => { setErro(null); m.mutate() }} disabled={m.isPending}>{m.isPending && <Spinner />}Transferir</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
