import { useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Ban, Check, CheckCheck, FileUp, Paperclip, Pencil, Plus, Sparkles, Trash2, Wallet, X } from 'lucide-react'
import { toast } from 'sonner'
import { supabase, rpc, unwrap, edge } from '@/lib/supabase'
import { useOrg, useEmpresaPadrao } from '@/contexts/org'
import { useCanais, useCategorias, useCentros, useContasBancarias, useContatos, opcoes, opcoesCategoria } from '@/hooks/lookups'
import { brl, data, hoje } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { DataTable, type Coluna } from '@/components/DataTable'
import { Campo, EntradaValor, Grade, Seletor } from '@/components/form'
import { Confirmar, Erro, PageHeader, Spinner, Status } from '@/components/common'
import { traduzirErro } from '@/components/CrudPage'
import { cn } from '@/lib/utils'
import { ImportarContas } from '@/components/ImportarContas'
import { separarExclusaoLote } from '@/lib/contasLote'

export interface Titulo {
  id: string; organizacao_id: string; empresa_id: string; tipo: 'pagar' | 'receber'; descricao: string; contato_id: string | null
  categoria_id: string; centro_custo_id: string | null; canal_id: string | null; valor: number; valor_pago: number
  data_emissao: string; data_vencimento: string; data_competencia: string; status: string; documento: string | null
  observacoes: string | null; origem: string; venda_id: string | null; version: number; parcela_num: number | null; parcela_total: number | null
  valor_bruto: number | null; valor_taxa: number | null; adquirente_id: string | null; conta_bancaria_prevista_id: string | null
  contatos?: { nome: string } | null; plano_contas?: { codigo: string; nome: string } | null
}

export const statusTitulo = (t: Pick<Titulo, 'status' | 'data_vencimento'>) =>
  ['aberto', 'parcial'].includes(t.status) && t.data_vencimento < hoje() ? 'vencido' : t.status
const saldo = (t: Titulo) => Math.round((Number(t.valor) - Number(t.valor_pago)) * 100) / 100

export default function Contas() {
  const { tipo = 'pagar' } = useParams() as { tipo: 'pagar' | 'receber' }
  const [sp, setSp] = useSearchParams()
  const { org, empresaIds, periodo, podeEscrever } = useOrg()
  const qc = useQueryClient()
  const cats = useCategorias(); const contatos = useContatos(); const contas = useContasBancarias()
  const filtroStatus = sp.get('status') ?? 'abertas'
  const filtroCat = sp.get('categoria') ?? ''
  const filtroContato = sp.get('contato') ?? ''
  const usarPeriodo = sp.get('periodo') !== 'todos'
  const setFiltro = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); setSp(n, { replace: true }) }

  const [sel, setSel] = useState<Set<string>>(new Set())
  const [form, setForm] = useState<Partial<Titulo> | null>(null)
  const [baixa, setBaixa] = useState<Titulo | null>(null)
  const [anexos, setAnexos] = useState<Titulo | null>(null)
  const [cancelar, setCancelar] = useState<Titulo | null>(null)
  const [excluir, setExcluir] = useState<Titulo | null>(null)
  const [lote, setLote] = useState(false)
  const [excluirLote, setExcluirLote] = useState(false)
  const [importar, setImportar] = useState(false)

  const q = useQuery({
    queryKey: ['titulos', org?.id, tipo, filtroStatus, filtroCat, filtroContato, usarPeriodo, periodo, empresaIds],
    enabled: !!org,
    queryFn: async () => {
      let x = supabase.from('titulos').select('*, contatos(nome), plano_contas(codigo, nome)').eq('organizacao_id', org!.id).eq('tipo', tipo)
        .order('data_vencimento').limit(2000)
      if (empresaIds) x = x.in('empresa_id', empresaIds)
      if (filtroStatus === 'abertas') x = x.in('status', ['aberto', 'parcial'])
      if (filtroStatus === 'vencidas') x = x.in('status', ['aberto', 'parcial']).lt('data_vencimento', hoje())
      if (filtroStatus === 'pagas') x = x.eq('status', 'pago')
      if (filtroStatus === 'canceladas') x = x.eq('status', 'cancelado')
      if (usarPeriodo && filtroStatus !== 'vencidas') x = x.gte('data_vencimento', periodo.inicio).lte('data_vencimento', periodo.fim)
      if (filtroCat) x = x.eq('categoria_id', filtroCat)
      if (filtroContato) x = x.eq('contato_id', filtroContato)
      return unwrap(await x) as Titulo[]
    },
  })
  const ids = (q.data ?? []).map(t => t.id)
  const sugestoes = useQuery({
    queryKey: ['ia_sugestoes', 'titulos', ids.join(',').length, org?.id], enabled: !!org && ids.length > 0,
    queryFn: async () => unwrap(await supabase.from('ia_sugestoes').select('*').eq('organizacao_id', org!.id).eq('alvo_tabela', 'titulos')
      .eq('status', 'pendente').in('alvo_id', ids.slice(0, 300))) as any[],
  })
  // quantidade e tipos de anexos por título (indicador na lista)
  const anexosQ = useQuery({
    queryKey: ['anexos-contagem', org?.id, ids.slice(0, 500).join(',')], enabled: !!org && ids.length > 0,
    queryFn: async () => {
      const r = unwrap(await supabase.from('titulo_anexos').select('titulo_id, tipo').in('titulo_id', ids.slice(0, 500))) as { titulo_id: string; tipo: string }[]
      const m = new Map<string, string[]>()
      for (const a of r) m.set(a.titulo_id, [...(m.get(a.titulo_id) ?? []), a.tipo])
      return m
    },
  })
  const decidir = useMutation({
    mutationFn: async ({ s, aceitar }: { s: any; aceitar: boolean }) => {
      if (aceitar) unwrap(await supabase.from('titulos').update({ categoria_id: s.sugestao.categoria_id }).eq('id', s.alvo_id))
      unwrap(await supabase.from('ia_sugestoes').update({ status: aceitar ? 'aprovada' : 'rejeitada', decidido_em: new Date().toISOString() }).eq('id', s.id))
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['titulos'] }).then(() => qc.invalidateQueries({ queryKey: ['ia_sugestoes'] })),
    onError: (e: Error) => toast.error(traduzirErro(e.message)),
  })
  const categorizarIA = useMutation({
    mutationFn: () => edge('ai-assistant', { acao: 'categorizar', organizacao_id: org!.id, alvo: 'titulos', ids: [...sel], idempotency_key: crypto.randomUUID() }),
    onSuccess: (r: any) => { toast.success(`${r.sugestoes} sugestão(ões) da IA${r.aplicadas_automaticamente ? `, ${r.aplicadas_automaticamente} aplicada(s) automaticamente` : ''}.`); qc.invalidateQueries({ queryKey: ['ia_sugestoes'] }); qc.invalidateQueries({ queryKey: ['titulos'] }) },
    onError: (e: Error) => toast.error(e.message),
  })
  const cancelarM = useMutation({
    mutationFn: async (t: Titulo) => unwrap(await supabase.from('titulos').update({ status: 'cancelado' }).eq('id', t.id)),
    onSuccess: () => { toast.success('Título cancelado.'); setCancelar(null); qc.invalidateQueries({ queryKey: ['titulos'] }) },
    onError: (e: Error) => { toast.error(traduzirErro(e.message)); setCancelar(null) },
  })
  const excluirM = useMutation({
    mutationFn: async (t: Titulo) => unwrap(await supabase.from('titulos').delete().eq('id', t.id)),
    onSuccess: () => { toast.success('Título excluído.'); setExcluir(null); qc.invalidateQueries({ queryKey: ['titulos'] }) },
    onError: (e: Error) => { toast.error(traduzirErro(e.message)); setExcluir(null) },
  })
  // Exclusão em lote: manuais/planilha sem baixa são excluídos; Bling/empréstimos são cancelados
  // (excluídos, voltariam na próxima sincronização); com baixa ou gerados por venda ficam de fora.
  const loteExc = useMemo(() => separarExclusaoLote((q.data ?? []).filter(t => sel.has(t.id))), [q.data, sel])
  const excluirLoteM = useMutation({
    mutationFn: async () => {
      let excluidos = 0, cancelados = 0
      for (let i = 0; i < loteExc.excluir.length; i += 200) {
        const r = unwrap(await supabase.from('titulos').delete().in('id', loteExc.excluir.slice(i, i + 200).map(t => t.id)).select('id')) as unknown[]
        excluidos += r.length
      }
      for (let i = 0; i < loteExc.cancelar.length; i += 200) {
        const r = unwrap(await supabase.from('titulos').update({ status: 'cancelado' }).in('id', loteExc.cancelar.slice(i, i + 200).map(t => t.id)).select('id')) as unknown[]
        cancelados += r.length
      }
      return { excluidos, cancelados }
    },
    onSuccess: ({ excluidos, cancelados }) => {
      toast.success([excluidos && `${excluidos} excluída(s)`, cancelados && `${cancelados} cancelada(s)`, loteExc.pular.length && `${loteExc.pular.length} pulada(s)`].filter(Boolean).join(', ') + '.')
      setExcluirLote(false); setSel(new Set())
    },
    onError: (e: Error) => { toast.error(traduzirErro(e.message)); setExcluirLote(false) },
    onSettled: () => qc.invalidateQueries({ queryKey: ['titulos'] }),
  })

  const sugDe = (id: string) => sugestoes.data?.find(s => s.alvo_id === id)
  const linhas = q.data ?? []
  const totais = useMemo(() => ({ valor: linhas.reduce((s, t) => s + Number(t.valor), 0), pago: linhas.reduce((s, t) => s + Number(t.valor_pago), 0) }), [linhas])
  const titulo = tipo === 'pagar' ? 'Contas a pagar' : 'Contas a receber'

  const colunas: Coluna<Titulo>[] = [
    { id: 'venc', titulo: 'Vencimento', celula: t => data(t.data_vencimento), valor: t => t.data_vencimento },
    { id: 'desc', titulo: 'Descrição', valor: t => t.descricao, celula: t => {
      const s = sugDe(t.id)
      return (
        <div className="min-w-48">
          <div className="font-medium">{t.descricao}</div>
          <div className="text-xs text-muted-foreground">{t.contatos?.nome ?? ''}{t.documento ? ` · doc ${t.documento}` : ''}{t.origem !== 'manual' ? ` · ${t.origem}` : ''}{(t as any).liquidado_pre_corte ? ' · quitado antes do corte do caixa' : ''}</div>
          {s && podeEscrever && (
            <div className="mt-1 flex flex-wrap items-center gap-1 rounded-md bg-primary/5 px-2 py-1 text-xs" onClick={e => e.stopPropagation()}>
              <Sparkles className="size-3 text-primary" />IA sugere <b>{s.sugestao.categoria}</b> ({Math.round(s.confianca * 100)}%)
              <Button size="xs" variant="ghost" onClick={() => decidir.mutate({ s, aceitar: true })}><Check />Aceitar</Button>
              <Button size="xs" variant="ghost" onClick={() => decidir.mutate({ s, aceitar: false })}><X />Rejeitar</Button>
            </div>
          )}
        </div>
      )
    } },
    { id: 'cat', titulo: 'Categoria', celula: t => <span className="text-sm">{t.plano_contas?.nome}</span>, valor: t => t.plano_contas?.nome },
    { id: 'comp', titulo: 'Competência', celula: t => data(t.data_competencia), valor: t => t.data_competencia },
    { id: 'valor', titulo: 'Valor', alinhar: 'right', celula: t => brl(t.valor), valor: t => Number(t.valor), rodape: brl(totais.valor) },
    { id: 'pago', titulo: tipo === 'pagar' ? 'Pago' : 'Recebido', alinhar: 'right', celula: t => brl(t.valor_pago), valor: t => Number(t.valor_pago), rodape: brl(totais.pago) },
    { id: 'saldo', titulo: 'Saldo', alinhar: 'right', celula: t => <b>{brl(saldo(t))}</b>, valor: t => saldo(t), rodape: brl(totais.valor - totais.pago) },
    { id: 'st', titulo: 'Status', celula: t => <Status s={statusTitulo(t)} />, valor: t => statusTitulo(t) },
    { id: 'ac', titulo: '', alinhar: 'right', className: 'w-px', celula: t => (
      <div className="flex justify-end gap-0.5" onClick={e => e.stopPropagation()}>
        {podeEscrever && ['aberto', 'parcial', 'pago'].includes(t.status) &&
          <Button size="sm" variant={t.status === 'pago' ? 'ghost' : 'outline'} onClick={() => setBaixa(t)}><Wallet />{t.status === 'pago' ? 'Baixas' : 'Baixar'}</Button>}
        {(() => {
          const tipos = anexosQ.data?.get(t.id) ?? []
          const resumo = tipos.length ? [...new Set(tipos)].map(x => TIPOS_ANEXO.find(y => y.value === x)?.label ?? x).join(', ') : 'Sem anexos'
          return <Button size="sm" variant="ghost" className={cn('px-2', tipos.length && 'text-primary')} aria-label={`Anexos: ${resumo}`} title={resumo}
            onClick={() => setAnexos(t)}><Paperclip />{tipos.length > 0 && <span className="tabular">{tipos.length}</span>}</Button>
        })()}
        {podeEscrever && t.status !== 'cancelado' && !t.venda_id && <Button size="icon-sm" variant="ghost" aria-label="Editar" onClick={() => setForm(t)}><Pencil /></Button>}
        {podeEscrever && Number(t.valor_pago) === 0 && t.status !== 'cancelado' && <Button size="icon-sm" variant="ghost" aria-label="Cancelar" onClick={() => setCancelar(t)}><Ban /></Button>}
        {podeEscrever && Number(t.valor_pago) === 0 && t.origem === 'manual' && <Button size="icon-sm" variant="ghost" aria-label="Excluir" onClick={() => setExcluir(t)}><Trash2 /></Button>}
      </div>
    ) },
  ]

  return (
    <div>
      <PageHeader titulo={titulo} descricao={tipo === 'pagar' ? 'Fornecedores, despesas fixas e variáveis, impostos e parcelas.' : 'Recebíveis de vendas, cartões, boletos e outras entradas.'}
        acoes={podeEscrever && <>
          <Button variant="outline" onClick={() => setImportar(true)}><FileUp />Importar planilha</Button>
          <Button onClick={() => setForm({ tipo })}><Plus />Nova conta a {tipo}</Button>
        </>} />
      <DataTable colunas={colunas} linhas={linhas} carregando={q.isLoading} selecao={podeEscrever ? sel : undefined} onSelecao={setSel}
        exportar={{ nome: `contas-a-${tipo}`, titulo, subtitulo: `Vencimentos de ${data(periodo.inicio)} a ${data(periodo.fim)}` }}
        acoesSelecao={<>
          <Button size="sm" onClick={() => setLote(true)}><CheckCheck />Baixar em lote</Button>
          <Button size="sm" variant="outline" onClick={() => categorizarIA.mutate()} disabled={categorizarIA.isPending}>{categorizarIA.isPending ? <Spinner /> : <Sparkles />}Categorizar com IA</Button>
          <Button size="sm" variant="outline" className="text-destructive" onClick={() => setExcluirLote(true)}><Trash2 />Excluir selecionadas</Button>
        </>}
        barra={<>
          <Seletor aria-label="Status" className="w-auto" value={filtroStatus} onChange={e => setFiltro('status', e.target.value)}
            opcoes={[{ value: 'abertas', label: 'Em aberto' }, { value: 'vencidas', label: 'Vencidas' }, { value: 'pagas', label: tipo === 'pagar' ? 'Pagas' : 'Recebidas' }, { value: 'canceladas', label: 'Canceladas' }, { value: 'todas', label: 'Todas' }]} />
          <Seletor aria-label="Categoria" className="w-auto max-w-56" value={filtroCat} onChange={e => setFiltro('categoria', e.target.value)} vazio="Todas as categorias"
            opcoes={opcoesCategoria(cats.data)} />
          <Seletor aria-label="Contato" className="w-auto max-w-48" value={filtroContato} onChange={e => setFiltro('contato', e.target.value)} vazio={tipo === 'pagar' ? 'Todos os fornecedores' : 'Todos os clientes'} opcoes={opcoes(contatos.data)} />
          <Seletor aria-label="Período" className="w-auto" value={usarPeriodo ? 'p' : 'todos'} onChange={e => setFiltro('periodo', e.target.value === 'todos' ? 'todos' : '')}
            opcoes={[{ value: 'p', label: 'Vencimento no período' }, { value: 'todos', label: 'Qualquer vencimento' }]} />
        </>}
        vazio={<div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">Nenhuma conta encontrada com esses filtros.</div>}
      />
      {form && <TituloForm inicial={form} onFechar={() => setForm(null)} />}
      {importar && <ImportarContas tipo={tipo} onFechar={() => setImportar(false)} />}
      {baixa && <BaixaDialog titulo={baixa} onFechar={() => setBaixa(null)} />}
      {anexos && <AnexosDialog titulo={anexos} onFechar={() => setAnexos(null)} />}
      {lote && <BaixaLoteDialog titulos={linhas.filter(t => sel.has(t.id) && ['aberto', 'parcial'].includes(t.status))} contas={contas.data ?? []}
        onFechar={(ok) => { setLote(false); if (ok) setSel(new Set()) }} />}
      <Confirmar aberto={!!cancelar} titulo="Cancelar título?" descricao="O título deixa de contar na DRE e na projeção de caixa. O registro é mantido para auditoria."
        perigo textoBotao="Cancelar título" carregando={cancelarM.isPending} onFechar={() => setCancelar(null)} onConfirmar={() => cancelarM.mutate(cancelar!)} />
      <Confirmar aberto={!!excluir} titulo="Excluir título?" descricao="A exclusão é registrada na auditoria e não pode ser desfeita." perigo textoBotao="Excluir"
        carregando={excluirM.isPending} onFechar={() => setExcluir(null)} onConfirmar={() => excluirM.mutate(excluir!)} />
      <Confirmar aberto={excluirLote} titulo={`Excluir ${sel.size} conta(s) selecionada(s)?`} perigo textoBotao="Confirmar exclusão"
        carregando={excluirLoteM.isPending} onFechar={() => setExcluirLote(false)} onConfirmar={() => excluirLoteM.mutate()}>
        <ul className="space-y-1 text-sm">
          {loteExc.excluir.length > 0 && <li><b>{loteExc.excluir.length}</b> lançada(s) à mão ou por planilha serão <b>excluídas</b> ({brl(loteExc.excluir.reduce((s, t) => s + Number(t.valor), 0))}). Não pode ser desfeito.</li>}
          {loteExc.cancelar.length > 0 && <li><b>{loteExc.cancelar.length}</b> vinda(s) do Bling ou de empréstimos serão <b>canceladas</b>: saem da DRE e do caixa, o registro fica para auditoria.</li>}
          {loteExc.pular.length > 0 && <li><b>{loteExc.pular.length}</b> serão <b>puladas</b> (já têm pagamento, são de venda ou já estão canceladas).</li>}
        </ul>
      </Confirmar>
    </div>
  )
}

export function TituloForm({ inicial, onFechar }: { inicial: Partial<Titulo>; onFechar: () => void }) {
  const { org, empresas } = useOrg()
  const empresaPadrao = useEmpresaPadrao()
  const qc = useQueryClient()
  const cats = useCategorias(); const contatos = useContatos(); const centros = useCentros(); const canais = useCanais()
  const editando = !!inicial.id
  const tipo = inicial.tipo ?? 'pagar'
  const [f, setF] = useState<any>({
    empresa_id: inicial.empresa_id ?? empresaPadrao, descricao: inicial.descricao ?? '', contato_id: inicial.contato_id ?? '',
    categoria_id: inicial.categoria_id ?? '', centro_custo_id: inicial.centro_custo_id ?? '', canal_id: inicial.canal_id ?? '',
    valor: inicial.valor != null ? Number(inicial.valor) : NaN, parcelas: 1, data_vencimento: inicial.data_vencimento ?? hoje(),
    data_competencia: inicial.data_competencia ?? '', documento: inicial.documento ?? '', observacoes: inicial.observacoes ?? '', competencia_por_parcela: false,
  })
  const [erro, setErro] = useState<string | null>(null)
  const [arquivo, setArquivo] = useState<File | null>(null)
  const [tipoArquivo, setTipoArquivo] = useState(tipo === 'pagar' ? 'boleto' : 'nota_fiscal')
  const set = (k: string, v: unknown) => setF((x: any) => ({ ...x, [k]: v }))
  const m = useMutation({
    mutationFn: async () => {
      if (!f.descricao.trim()) throw new Error('Informe a descrição.')
      if (!f.categoria_id) throw new Error('Escolha a categoria do plano de contas.')
      if (!(f.valor > 0)) throw new Error('Informe um valor maior que zero.')
      if (editando) {
        const { data: r, error } = await supabase.from('titulos').update({
          descricao: f.descricao, contato_id: f.contato_id || null, categoria_id: f.categoria_id, centro_custo_id: f.centro_custo_id || null,
          canal_id: f.canal_id || null, valor: f.valor, data_vencimento: f.data_vencimento, data_competencia: f.data_competencia || f.data_vencimento,
          documento: f.documento || null, observacoes: f.observacoes || null,
        }).eq('id', inicial.id!).eq('version', inicial.version!).select('id')
        if (error) throw new Error(traduzirErro(error.message))
        if (!r?.length) throw new Error('Este título foi alterado por outro usuário. Recarregue a lista e tente novamente.')
        return
      }
      const ids = await rpc<string[]>('fn_criar_titulos', { p: { organizacao_id: org!.id, empresa_id: f.empresa_id, tipo, descricao: f.descricao.trim(),
        contato_id: f.contato_id, categoria_id: f.categoria_id, centro_custo_id: f.centro_custo_id, canal_id: f.canal_id, valor: f.valor,
        parcelas: f.parcelas, data_vencimento: f.data_vencimento, data_competencia: f.data_competencia || null, documento: f.documento || null,
        observacoes: f.observacoes || null, competencia_por_parcela: f.competencia_por_parcela } })
      // anexo vai para a 1ª parcela (as demais recebem os seus pelo botão de anexos da linha)
      if (arquivo && ids?.length) {
        try { await enviarAnexo({ id: ids[0], organizacao_id: org!.id }, arquivo, tipoArquivo) }
        catch (e) { toast.error(`Conta criada, mas o anexo falhou: ${(e as Error).message}`) }
      }
    },
    onSuccess: () => { toast.success(editando ? 'Título atualizado.' : 'Título criado.'); qc.invalidateQueries({ queryKey: ['titulos'] }); onFechar() },
    onError: (e: Error) => setErro(traduzirErro(e.message)),
  })
  return (
    <Dialog open onOpenChange={o => !o && onFechar()}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>{editando ? 'Editar' : 'Nova'} conta a {tipo}</DialogTitle></DialogHeader>
        <form id="titulo-form" onSubmit={e => { e.preventDefault(); setErro(null); m.mutate() }} className="max-h-[65vh] overflow-y-auto pr-1">
          <Grade>
            {empresas.length > 1 && <Campo rotulo="Empresa" obrigatorio className="sm:col-span-2"><Seletor value={f.empresa_id} disabled={editando} onChange={e => set('empresa_id', e.target.value)} opcoes={empresas.map(e => ({ value: e.id, label: e.nome_fantasia || e.razao_social }))} /></Campo>}
            <Campo rotulo="Descrição" obrigatorio className="sm:col-span-2"><Input value={f.descricao} onChange={e => set('descricao', e.target.value)} /></Campo>
            <Campo rotulo={tipo === 'pagar' ? 'Fornecedor' : 'Cliente'}><Seletor value={f.contato_id} onChange={e => set('contato_id', e.target.value)} vazio="—" opcoes={opcoes(contatos.data)} /></Campo>
            <Campo rotulo="Categoria (plano de contas)" obrigatorio><Seletor value={f.categoria_id} onChange={e => set('categoria_id', e.target.value)} vazio="Selecione…" opcoes={opcoesCategoria(cats.data, tipo === 'pagar' ? 'saida' : 'entrada')} /></Campo>
            <Campo rotulo="Centro de custo"><Seletor value={f.centro_custo_id} onChange={e => set('centro_custo_id', e.target.value)} vazio="—" opcoes={opcoes(centros.data)} /></Campo>
            <Campo rotulo="Canal (opcional)" ajuda="Para despesas diretas de um canal na DRE por canal."><Seletor value={f.canal_id} onChange={e => set('canal_id', e.target.value)} vazio="—" opcoes={opcoes(canais.data)} /></Campo>
            <Campo rotulo={!editando && f.parcelas > 1 ? 'Valor total' : 'Valor'} obrigatorio><EntradaValor valor={f.valor} onChange={v => set('valor', v)} /></Campo>
            {!editando && <Campo rotulo="Parcelas" ajuda={f.parcelas > 1 && f.valor > 0 ? `${f.parcelas}x de ~${brl(f.valor / f.parcelas)} (mensais)` : 'Parcelamento mensal'}>
              <Input type="number" min={1} max={120} value={f.parcelas} onChange={e => set('parcelas', Math.max(1, Number(e.target.value)))} /></Campo>}
            <Campo rotulo={!editando && f.parcelas > 1 ? '1º vencimento' : 'Vencimento'} obrigatorio><Input type="date" value={f.data_vencimento} onChange={e => set('data_vencimento', e.target.value)} /></Campo>
            <Campo rotulo="Competência (DRE)" ajuda="Mês a que a despesa/receita pertence. Vazio = vencimento."><Input type="date" value={f.data_competencia} onChange={e => set('data_competencia', e.target.value)} /></Campo>
            {!editando && f.parcelas > 1 && <Campo rotulo="Competência por parcela"><Seletor value={f.competencia_por_parcela ? '1' : ''} onChange={e => set('competencia_por_parcela', !!e.target.value)}
              opcoes={[{ value: '', label: 'Todas na mesma competência' }, { value: '1', label: 'Uma competência por mês' }]} /></Campo>}
            <Campo rotulo="Nº do documento"><Input value={f.documento} onChange={e => set('documento', e.target.value)} /></Campo>
            <Campo rotulo="Observações" className="sm:col-span-2"><Textarea value={f.observacoes} onChange={e => set('observacoes', e.target.value)} /></Campo>
            {!editando && (
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <span className="text-sm font-medium">Anexo (opcional)</span>
                <div className="flex flex-wrap items-center gap-2">
                  <Seletor aria-label="Tipo do anexo" className="w-auto" value={tipoArquivo} onChange={e => setTipoArquivo(e.target.value)} opcoes={TIPOS_ANEXO} />
                  <CampoArquivo arquivo={arquivo} onChange={setArquivo} rotulo="Escolher arquivo" />
                </div>
                {f.parcelas > 1 && arquivo && <span className="text-xs text-muted-foreground">O arquivo será anexado à 1ª parcela.</span>}
              </div>
            )}
          </Grade>
          {erro && <div className="mt-4"><Erro erro={erro} /></div>}
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>Cancelar</Button>
          <Button type="submit" form="titulo-form" disabled={m.isPending}>{m.isPending && <Spinner />}Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function BaixaDialog({ titulo, onFechar }: { titulo: Titulo; onFechar: () => void }) {
  const qc = useQueryClient()
  const { podeEscrever } = useOrg()
  const contas = useContasBancarias()
  const s = saldo(titulo)
  const [chave] = useState(() => crypto.randomUUID())
  const [f, setF] = useState({ conta: titulo.conta_bancaria_prevista_id ?? '', data: hoje(), principal: s, juros: 0, multa: 0, desconto: 0, obs: '' })
  const [erro, setErro] = useState<string | null>(null)
  const [comprovante, setComprovante] = useState<File | null>(null)
  const baixas = useQuery({ queryKey: ['baixas', titulo.id], queryFn: async () =>
    unwrap(await supabase.from('baixas').select('*, contas_bancarias(nome), movimentos(conciliado)').eq('titulo_id', titulo.id).order('data_pagamento')) as any[] })
  const contasEmp = (contas.data ?? []).filter(c => c.empresa_id === titulo.empresa_id && c.ativo)
  const total = (f.principal || 0) + (f.juros || 0) + (f.multa || 0) - (f.desconto || 0)
  const invalidar = () => { qc.invalidateQueries({ queryKey: ['titulos'] }); qc.invalidateQueries({ queryKey: ['baixas', titulo.id] }); qc.invalidateQueries({ queryKey: ['dashboard'] }) }
  const m = useMutation({
    mutationFn: async () => {
      if (!f.conta) throw new Error('Escolha a conta bancária.')
      if (!(f.principal > 0)) throw new Error('Informe o valor principal.')
      if (f.principal > s + 0.001) throw new Error(`O valor principal excede o saldo em aberto (${brl(s)}). Lance juros/multa separadamente.`)
      await rpc('fn_baixar_titulo', { p_titulo: titulo.id, p_conta: f.conta, p_data: f.data, p_valor_principal: f.principal,
        p_juros: f.juros || 0, p_multa: f.multa || 0, p_desconto: f.desconto || 0, p_observacao: f.obs || null, p_idempotency_key: chave })
      if (comprovante) {
        try { await enviarAnexo(titulo, comprovante, 'comprovante') }
        catch (e) { toast.error(`Baixa registrada, mas o comprovante não foi anexado: ${(e as Error).message}`) }
      }
    },
    onSuccess: () => { toast.success('Baixa registrada.'); invalidar(); qc.invalidateQueries({ queryKey: ['anexos-contagem'] }); onFechar() },
    onError: (e: Error) => setErro(e.message),
  })
  const estornar = useMutation({
    mutationFn: async (id: string) => unwrap(await supabase.from('baixas').delete().eq('id', id)),
    onSuccess: () => { toast.success('Baixa estornada.'); invalidar() },
    onError: (e: Error) => toast.error(e.message),
  })
  const aberto = ['aberto', 'parcial'].includes(titulo.status)
  return (
    <Dialog open onOpenChange={o => !o && onFechar()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{titulo.tipo === 'pagar' ? 'Pagamento' : 'Recebimento'}: {titulo.descricao}</DialogTitle>
          <DialogDescription>Valor {brl(titulo.valor)} · vencimento {data(titulo.data_vencimento)} · saldo em aberto <b>{brl(s)}</b></DialogDescription>
        </DialogHeader>
        {!!baixas.data?.length && (
          <div className="rounded-lg border text-sm">
            {baixas.data.map(b => (
              <div key={b.id} className="flex items-center justify-between gap-2 border-b px-3 py-2 last:border-0">
                <span>{data(b.data_pagamento)} · {b.contas_bancarias?.nome}{Number(b.juros) + Number(b.multa) > 0 ? ` · encargos ${brl(Number(b.juros) + Number(b.multa))}` : ''}{Number(b.desconto) > 0 ? ` · desconto ${brl(b.desconto)}` : ''}</span>
                <span className="flex items-center gap-1 tabular"><b>{brl(b.valor_total)}</b>
                  {b.movimentos?.[0]?.conciliado ? <span className="text-xs text-muted-foreground">conciliada</span>
                    : podeEscrever && <Button size="xs" variant="ghost" onClick={() => estornar.mutate(b.id)} disabled={estornar.isPending}>Estornar</Button>}
                </span>
              </div>
            ))}
          </div>
        )}
        {aberto && podeEscrever && (
          <form id="baixa-form" onSubmit={e => { e.preventDefault(); setErro(null); m.mutate() }}>
            <Grade>
              <Campo rotulo="Conta bancária" obrigatorio><Seletor value={f.conta} onChange={e => setF({ ...f, conta: e.target.value })} vazio="Selecione…" opcoes={contasEmp.map(c => ({ value: c.id, label: c.nome }))} /></Campo>
              <Campo rotulo="Data do pagamento" obrigatorio><Input type="date" value={f.data} onChange={e => setF({ ...f, data: e.target.value })} /></Campo>
              <Campo rotulo="Valor principal" obrigatorio ajuda="Parte do título que está sendo quitada."><EntradaValor valor={f.principal} onChange={v => setF({ ...f, principal: v })} /></Campo>
              <Campo rotulo="Juros"><EntradaValor valor={f.juros} onChange={v => setF({ ...f, juros: v })} /></Campo>
              <Campo rotulo="Multa"><EntradaValor valor={f.multa} onChange={v => setF({ ...f, multa: v })} /></Campo>
              <Campo rotulo="Desconto"><EntradaValor valor={f.desconto} onChange={v => setF({ ...f, desconto: v })} /></Campo>
              <Campo rotulo="Observação" className="sm:col-span-2"><Input value={f.obs} onChange={e => setF({ ...f, obs: e.target.value })} /></Campo>
            </Grade>
            <div className="mt-3 flex flex-col gap-1.5">
              <span className="text-sm font-medium">{titulo.tipo === 'pagar' ? 'Comprovante de pagamento' : 'Comprovante de recebimento'} (opcional)</span>
              <CampoArquivo arquivo={comprovante} onChange={setComprovante} rotulo="Anexar comprovante" />
            </div>
            <p className="mt-3 text-sm">Valor movimentado na conta: <b className="tabular">{brl(total)}</b></p>
            {erro && <div className="mt-3"><Erro erro={erro} /></div>}
          </form>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>Fechar</Button>
          {aberto && podeEscrever && <Button type="submit" form="baixa-form" disabled={m.isPending}>{m.isPending && <Spinner />}Confirmar baixa</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function BaixaLoteDialog({ titulos, contas, onFechar }: { titulos: Titulo[]; contas: any[]; onFechar: (ok: boolean) => void }) {
  const qc = useQueryClient()
  const empresasSel = new Set(titulos.map(t => t.empresa_id))
  const [conta, setConta] = useState(''); const [dt, setDt] = useState(hoje()); const [erro, setErro] = useState<string | null>(null)
  const total = titulos.reduce((s, t) => s + saldo(t), 0)
  const m = useMutation({
    mutationFn: () => rpc<number>('fn_baixar_lote', { p_conta: conta, p_data: dt, p_itens: titulos.map(t => ({ titulo_id: t.id })) }),
    onSuccess: (n) => { toast.success(`${n} título(s) baixado(s).`); qc.invalidateQueries({ queryKey: ['titulos'] }); onFechar(true) },
    onError: (e: Error) => setErro(e.message),
  })
  return (
    <Dialog open onOpenChange={o => !o && onFechar(false)}>
      <DialogContent>
        <DialogHeader><DialogTitle>Baixa em lote</DialogTitle><DialogDescription>{titulos.length} título(s) em aberto, saldo total {brl(total)}. Todos são baixados pelo saldo integral; se algum falhar, nenhum é baixado.</DialogDescription></DialogHeader>
        {empresasSel.size > 1 ? <Erro erro="Selecione títulos de uma única empresa." /> : (
          <Grade>
            <Campo rotulo="Conta bancária" obrigatorio><Seletor value={conta} onChange={e => setConta(e.target.value)} vazio="Selecione…"
              opcoes={contas.filter(c => empresasSel.has(c.empresa_id) && c.ativo).map(c => ({ value: c.id, label: c.nome }))} /></Campo>
            <Campo rotulo="Data" obrigatorio><Input type="date" value={dt} onChange={e => setDt(e.target.value)} /></Campo>
          </Grade>
        )}
        {erro && <Erro erro={erro} />}
        <DialogFooter>
          <Button variant="outline" onClick={() => onFechar(false)}>Cancelar</Button>
          <Button onClick={() => m.mutate()} disabled={!conta || !titulos.length || empresasSel.size > 1 || m.isPending}>{m.isPending && <Spinner />}Baixar {titulos.length}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export const TIPOS_ANEXO = [{ value: 'boleto', label: 'Boleto' }, { value: 'comprovante', label: 'Comprovante de pagamento' },
  { value: 'nota_fiscal', label: 'Nota fiscal' }, { value: 'outro', label: 'Outro' }]
const rotuloAnexo = (t: string) => TIPOS_ANEXO.find(x => x.value === t)?.label ?? 'Outro'
const ACEITOS = '.pdf,.png,.jpg,.jpeg,.webp,.xml'

/** Envia um arquivo ao Storage (pasta da organização) e registra o anexo do título */
export async function enviarAnexo(titulo: Pick<Titulo, 'id' | 'organizacao_id'>, arq: File, tipo: string) {
  if (arq.size > 20 * 1024 * 1024) throw new Error(`"${arq.name}" é maior que 20 MB.`)
  const caminho = `${titulo.organizacao_id}/titulos/${titulo.id}/${crypto.randomUUID()}-${arq.name.replace(/[^\w.-]+/g, '_')}`
  const up = await supabase.storage.from('anexos').upload(caminho, arq, { contentType: arq.type || 'application/octet-stream' })
  if (up.error) throw new Error(up.error.message)
  const r = await supabase.from('titulo_anexos').insert({ organizacao_id: titulo.organizacao_id, titulo_id: titulo.id, storage_path: caminho,
    nome: arq.name, mime: arq.type, tamanho: arq.size, tipo })
  if (r.error) { await supabase.storage.from('anexos').remove([caminho]); throw new Error(r.error.message) }
}

/** Campo de arquivo compacto para anexar junto com outra ação (criação da conta, baixa) */
export function CampoArquivo({ arquivo, onChange, rotulo }: { arquivo: File | null; onChange: (f: File | null) => void; rotulo: string }) {
  return (
    <div className="flex items-center gap-2">
      <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border px-3 text-sm hover:bg-muted/40">
        <Paperclip className="size-4" />{arquivo ? 'Trocar arquivo' : rotulo}
        <input type="file" className="sr-only" accept={ACEITOS} onChange={e => { const f = e.target.files?.[0] ?? null; e.target.value = ''; onChange(f) }} />
      </label>
      {arquivo && <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground"><span className="truncate">{arquivo.name}</span>
        <button type="button" aria-label="Remover arquivo" onClick={() => onChange(null)}><X className="size-3.5" /></button></span>}
    </div>
  )
}

export function AnexosDialog({ titulo, onFechar }: { titulo: Titulo; onFechar: () => void }) {
  const qc = useQueryClient(); const { podeEscrever } = useOrg()
  const [enviando, setEnviando] = useState(false)
  const [tipo, setTipo] = useState(titulo.status === 'pago' ? 'comprovante' : 'boleto')
  const q = useQuery({ queryKey: ['anexos', titulo.id], queryFn: async () => unwrap(await supabase.from('titulo_anexos').select('*').eq('titulo_id', titulo.id).order('created_at')) as any[] })
  const invalidar = () => { qc.invalidateQueries({ queryKey: ['anexos', titulo.id] }); qc.invalidateQueries({ queryKey: ['anexos-contagem'] }) }
  const enviar = async (arquivos: File[]) => {
    setEnviando(true)
    for (const arq of arquivos) { try { await enviarAnexo(titulo, arq, tipo) } catch (e) { toast.error((e as Error).message) } }
    setEnviando(false); invalidar()
  }
  const abrir = async (a: any) => {
    const { data: u, error } = await supabase.storage.from('anexos').createSignedUrl(a.storage_path, 120)
    if (error) return toast.error(error.message)
    window.open(u.signedUrl, '_blank', 'noopener')
  }
  const remover = async (a: any) => {
    await supabase.storage.from('anexos').remove([a.storage_path])
    const r = await supabase.from('titulo_anexos').delete().eq('id', a.id)
    if (r.error) toast.error(r.error.message); invalidar()
  }
  return (
    <Dialog open onOpenChange={o => !o && onFechar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Anexos</DialogTitle><DialogDescription>{titulo.descricao} — boleto, comprovante de pagamento e nota fiscal.</DialogDescription></DialogHeader>
        <ul className="divide-y rounded-lg border text-sm">
          {q.data?.map(a => (
            <li key={a.id} className="flex items-center justify-between gap-2 px-3 py-2">
              <span className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[11px] font-medium">{rotuloAnexo(a.tipo)}</span>
                <button className="truncate text-left text-primary hover:underline" onClick={() => abrir(a)} title="Abrir">{a.nome}</button>
              </span>
              {podeEscrever && <Button size="icon-sm" variant="ghost" onClick={() => remover(a)} aria-label={`Remover ${a.nome}`}><Trash2 /></Button>}
            </li>
          ))}
          {!q.data?.length && <li className="px-3 py-4 text-center text-muted-foreground">Nenhum anexo.</li>}
        </ul>
        {podeEscrever && (
          <div className="space-y-2">
            <Seletor aria-label="Tipo do anexo" value={tipo} onChange={e => setTipo(e.target.value)} opcoes={TIPOS_ANEXO} />
            <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed p-4 text-sm hover:bg-muted/40">
              {enviando ? <Spinner /> : <Paperclip className="size-4" />}Adicionar {rotuloAnexo(tipo).toLowerCase()} (PDF, imagem ou XML)
              <input type="file" multiple className="sr-only" accept={ACEITOS} onChange={e => { const f = [...(e.target.files ?? [])]; e.target.value = ''; if (f.length) enviar(f) }} />
            </label>
          </div>
        )}
        <DialogFooter><Button variant="outline" onClick={onFechar}>Fechar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
