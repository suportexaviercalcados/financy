import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Eye, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { supabase, rpc, unwrap } from '@/lib/supabase'
import { useEmpresaPadrao, useOrg } from '@/contexts/org'
import { useContasBancarias, useContatos, opcoes } from '@/hooks/lookups'
import { brl, data, hoje, pct, somaMeses } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DataTable, type Coluna } from '@/components/DataTable'
import { Campo, EntradaValor, Grade, Seletor } from '@/components/form'
import { Erro, Kpi, PageHeader, Spinner, Status } from '@/components/common'
import { traduzirErro } from '@/components/CrudPage'

export default function Emprestimos() {
  const { org, empresaIds, podeEscrever } = useOrg()
  const [novo, setNovo] = useState(false); const [ver, setVer] = useState<any | null>(null)
  const q = useQuery({ queryKey: ['emprestimos', org?.id, empresaIds], enabled: !!org, queryFn: async () => {
    let x = supabase.from('emprestimos').select('*, emprestimo_parcelas(amortizacao, juros, data_vencimento, titulo_amortizacao_id), contatos(nome)').eq('organizacao_id', org!.id).order('data_contratacao', { ascending: false })
    if (empresaIds) x = x.in('empresa_id', empresaIds)
    const emps = unwrap(await x) as any[]
    const ids = emps.flatMap(e => e.emprestimo_parcelas.map((p: any) => p.titulo_amortizacao_id)).filter(Boolean)
    const pagos = ids.length ? unwrap(await supabase.from('titulos').select('id, valor_pago, status').in('id', ids)) as any[] : []
    return emps.map(e => {
      const amortPaga = e.emprestimo_parcelas.reduce((s: number, p: any) => s + Number(pagos.find(t => t.id === p.titulo_amortizacao_id)?.valor_pago ?? 0), 0)
      const prox = e.emprestimo_parcelas.filter((p: any) => pagos.find(t => t.id === p.titulo_amortizacao_id)?.status !== 'pago').sort((a: any, b: any) => a.data_vencimento.localeCompare(b.data_vencimento))[0]
      return { ...e, saldo_devedor: Number(e.valor_principal) - amortPaga, juros_total: e.emprestimo_parcelas.reduce((s: number, p: any) => s + Number(p.juros), 0), proxima: prox }
    })
  } })
  const l = q.data ?? []
  const colunas: Coluna<any>[] = [
    { id: 'd', titulo: 'Descrição', celula: e => <div><div className="font-medium">{e.descricao}</div><div className="text-xs text-muted-foreground">{e.contatos?.nome ?? ''}</div></div>, valor: e => e.descricao },
    { id: 'c', titulo: 'Contratação', celula: e => data(e.data_contratacao), valor: e => e.data_contratacao },
    { id: 's', titulo: 'Sistema', celula: e => `${e.sistema} · ${pct(e.taxa_juros_mensal, 2)} a.m. · ${e.prazo_meses}x`, valor: e => e.sistema },
    { id: 'p', titulo: 'Principal', alinhar: 'right', celula: e => brl(e.valor_principal), valor: e => Number(e.valor_principal) },
    { id: 'j', titulo: 'Juros totais', alinhar: 'right', celula: e => brl(e.juros_total), valor: e => e.juros_total },
    { id: 'sd', titulo: 'Saldo devedor', alinhar: 'right', celula: e => <b>{brl(e.saldo_devedor)}</b>, valor: e => e.saldo_devedor },
    { id: 'pr', titulo: 'Próxima parcela', celula: e => e.proxima ? `${data(e.proxima.data_vencimento)} · ${brl(Number(e.proxima.amortizacao) + Number(e.proxima.juros))}` : 'Quitado', valor: e => e.proxima?.data_vencimento },
    { id: 'a', titulo: '', alinhar: 'right', celula: e => <Button size="icon-sm" variant="ghost" aria-label="Cronograma" onClick={() => setVer(e)}><Eye /></Button> },
  ]
  return (
    <div className="space-y-6">
      <PageHeader titulo="Empréstimos e financiamentos" descricao="Parcelas geradas automaticamente (SAC ou Price): juros entram na DRE como despesa financeira; a amortização entra na DFC como financiamento."
        acoes={podeEscrever && <Button onClick={() => setNovo(true)}><Plus />Novo empréstimo</Button>} />
      <div className="grid gap-3 sm:grid-cols-3">
        <Kpi titulo="Saldo devedor total" valor={brl(l.reduce((s, e) => s + e.saldo_devedor, 0))} />
        <Kpi titulo="Contratos ativos" valor={l.filter(e => e.saldo_devedor > 0.009).length} />
        <Kpi titulo="Juros totais contratados" valor={brl(l.reduce((s, e) => s + e.juros_total, 0))} />
      </div>
      <DataTable colunas={colunas} linhas={l} carregando={q.isLoading} onLinha={setVer} exportar={{ nome: 'emprestimos', titulo: 'Empréstimos' }} />
      {novo && <NovoEmprestimo onFechar={() => setNovo(false)} />}
      {ver && <Cronograma emp={ver} onFechar={() => setVer(null)} />}
    </div>
  )
}

function NovoEmprestimo({ onFechar }: { onFechar: () => void }) {
  const { org } = useOrg(); const emp = useEmpresaPadrao(); const qc = useQueryClient()
  const contas = useContasBancarias(); const contatos = useContatos()
  const [f, setF] = useState({ descricao: '', credor: '', conta: '', principal: NaN, taxa: 1.5, prazo: 12, sistema: 'PRICE', contratacao: hoje(), primeira: somaMeses(hoje(), 1).slice(0, 8) + hoje().slice(8), entrada: true })
  const [erro, setErro] = useState<string | null>(null)
  const prev = useQuery({ queryKey: ['prev-amort', f.principal, f.taxa, f.prazo, f.sistema], enabled: f.principal > 0 && f.prazo > 0,
    queryFn: () => rpc<any[]>('fn_calc_amortizacao', { p_principal: f.principal, p_taxa_mensal_pct: f.taxa, p_n: f.prazo, p_sistema: f.sistema }) })
  const m = useMutation({
    mutationFn: async () => {
      if (!f.descricao.trim() || !f.conta || !(f.principal > 0)) throw new Error('Preencha descrição, conta e valor.')
      unwrap(await supabase.from('emprestimos').insert({ organizacao_id: org!.id, empresa_id: contas.data?.find(c => c.id === f.conta)?.empresa_id ?? emp,
        descricao: f.descricao.trim(), credor_contato_id: f.credor || null, conta_bancaria_id: f.conta, valor_principal: f.principal, taxa_juros_mensal: f.taxa,
        prazo_meses: f.prazo, sistema: f.sistema, data_contratacao: f.contratacao, data_primeira_parcela: f.primeira, registrar_entrada: f.entrada }))
    },
    onSuccess: () => { toast.success('Empréstimo cadastrado e parcelas geradas.'); qc.invalidateQueries(); onFechar() },
    onError: (e: Error) => setErro(traduzirErro(e.message)),
  })
  const p = prev.data ?? []
  return (
    <Dialog open onOpenChange={o => !o && onFechar()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader><DialogTitle>Novo empréstimo / financiamento</DialogTitle></DialogHeader>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1">
          <Grade cols={3}>
            <Campo rotulo="Descrição" obrigatorio className="sm:col-span-2"><Input value={f.descricao} onChange={e => setF({ ...f, descricao: e.target.value })} placeholder="Capital de giro Banco X" /></Campo>
            <Campo rotulo="Credor"><Seletor value={f.credor} onChange={e => setF({ ...f, credor: e.target.value })} vazio="—" opcoes={opcoes(contatos.data)} /></Campo>
            <Campo rotulo="Conta que recebe/paga" obrigatorio><Seletor value={f.conta} onChange={e => setF({ ...f, conta: e.target.value })} vazio="Selecione…" opcoes={opcoes(contas.data)} /></Campo>
            <Campo rotulo="Valor principal" obrigatorio><EntradaValor valor={f.principal} onChange={v => setF({ ...f, principal: v })} /></Campo>
            <Campo rotulo="Juros (% ao mês)"><Input type="number" step="0.0001" min={0} value={f.taxa} onChange={e => setF({ ...f, taxa: Number(e.target.value) })} /></Campo>
            <Campo rotulo="Prazo (meses)"><Input type="number" min={1} max={600} value={f.prazo} onChange={e => setF({ ...f, prazo: Number(e.target.value) })} /></Campo>
            <Campo rotulo="Sistema"><Seletor value={f.sistema} onChange={e => setF({ ...f, sistema: e.target.value })} opcoes={[{ value: 'PRICE', label: 'Price (parcelas iguais)' }, { value: 'SAC', label: 'SAC (amortização constante)' }]} /></Campo>
            <Campo rotulo="Contratação"><Input type="date" value={f.contratacao} onChange={e => setF({ ...f, contratacao: e.target.value })} /></Campo>
            <Campo rotulo="1ª parcela"><Input type="date" value={f.primeira} onChange={e => setF({ ...f, primeira: e.target.value })} /></Campo>
            <Campo rotulo="Registrar entrada do dinheiro na conta" className="sm:col-span-2" ajuda="Desligue se o valor já entrou e foi conciliado por outro lançamento."><Switch checked={f.entrada} onCheckedChange={v => setF({ ...f, entrada: v })} /></Campo>
          </Grade>
          {p.length > 0 && <div className="rounded-lg border p-3 text-sm">
            <p>1ª parcela {brl(p[0].parcela)} · última {brl(p.at(-1).parcela)} · juros totais <b>{brl(p.reduce((s, x) => s + Number(x.juros), 0))}</b> · total pago {brl(p.reduce((s, x) => s + Number(x.parcela), 0))}</p>
          </div>}
          {erro && <Erro erro={erro} />}
        </div>
        <DialogFooter><Button variant="outline" onClick={onFechar}>Cancelar</Button><Button onClick={() => { setErro(null); m.mutate() }} disabled={m.isPending}>{m.isPending && <Spinner />}Cadastrar e gerar parcelas</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Cronograma({ emp, onFechar }: { emp: any; onFechar: () => void }) {
  const q = useQuery({ queryKey: ['cronograma', emp.id], queryFn: async () => {
    const parc = unwrap(await supabase.from('emprestimo_parcelas').select('*').eq('emprestimo_id', emp.id).order('numero')) as any[]
    const ids = parc.flatMap(p => [p.titulo_amortizacao_id, p.titulo_juros_id]).filter(Boolean)
    const t = ids.length ? unwrap(await supabase.from('titulos').select('id, status, data_vencimento').in('id', ids)) as any[] : []
    return parc.map(p => { const a = t.find(x => x.id === p.titulo_amortizacao_id); const j = t.find(x => x.id === p.titulo_juros_id)
      return { ...p, status: a?.status === 'pago' && (!j || j.status === 'pago') ? 'pago' : a?.status === 'cancelado' ? 'cancelado' : (p.data_vencimento < hoje() ? 'vencido' : 'aberto') } })
  } })
  const col: Coluna<any>[] = [
    { id: 'n', titulo: 'Nº', celula: p => p.numero, valor: p => p.numero },
    { id: 'v', titulo: 'Vencimento', celula: p => data(p.data_vencimento), valor: p => p.data_vencimento },
    { id: 'a', titulo: 'Amortização', alinhar: 'right', celula: p => brl(p.amortizacao), valor: p => Number(p.amortizacao) },
    { id: 'j', titulo: 'Juros', alinhar: 'right', celula: p => brl(p.juros), valor: p => Number(p.juros) },
    { id: 'p', titulo: 'Parcela', alinhar: 'right', celula: p => <b>{brl(p.valor_parcela)}</b>, valor: p => Number(p.valor_parcela) },
    { id: 's', titulo: 'Saldo após', alinhar: 'right', celula: p => brl(p.saldo_devedor), valor: p => Number(p.saldo_devedor) },
    { id: 'st', titulo: 'Situação', celula: p => <Status s={p.status} />, valor: p => p.status },
  ]
  return (
    <Dialog open onOpenChange={o => !o && onFechar()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader><DialogTitle>{emp.descricao}</DialogTitle><DialogDescription>{emp.sistema} · {pct(emp.taxa_juros_mensal, 2)} a.m. · saldo devedor {brl(emp.saldo_devedor)} · pague as parcelas em Contas a pagar.</DialogDescription></DialogHeader>
        <div className="max-h-[65vh] overflow-y-auto"><DataTable colunas={col} linhas={q.data} carregando={q.isLoading} busca={false} compacta exportar={{ nome: 'cronograma', titulo: emp.descricao }} /></div>
      </DialogContent>
    </Dialog>
  )
}
