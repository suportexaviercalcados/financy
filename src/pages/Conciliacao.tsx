import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, EyeOff, FilePlus2, Link2, ListChecks, Search, Sparkles, Undo2, Upload, Wand2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase, rpc, unwrap, edge } from '@/lib/supabase'
import { useOrg } from '@/contexts/org'
import { useCategorias, useCentros, useContasBancarias, useContatos, opcoes, opcoesCategoria } from '@/hooks/lookups'
import { lerOFX, hashArquivo, type ExtratoOFX } from '@/lib/ofx'
import { brl, data, somaDias } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { DataTable, type Coluna } from '@/components/DataTable'
import { Campo, Grade, Seletor } from '@/components/form'
import { Aviso, Dinheiro, Erro, Kpi, PageHeader, Spinner, Status, Vazio } from '@/components/common'
import { traduzirErro } from '@/components/CrudPage'
import { cn } from '@/lib/utils'

export default function Conciliacao() {
  const { org, podeEscrever } = useOrg()
  const qc = useQueryClient()
  const contas = useContasBancarias()
  const [conta, setConta] = useState('')
  const contaId = conta || contas.data?.find(c => c.ativo)?.id || ''
  const [filtro, setFiltro] = useState('pendente')
  const [arquivo, setArquivo] = useState<{ nome: string; texto: string; extrato: ExtratoOFX } | null>(null)
  const [erroArq, setErroArq] = useState<string | null>(null)
  const [buscar, setBuscar] = useState<any | null>(null)
  const [criar, setCriar] = useState<any | null>(null)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const invalidar = () => { ['transacoes', 'sugestoes-conc', 'resumo-conc', 'titulos', 'ia_sugestoes'].forEach(k => qc.invalidateQueries({ queryKey: [k] })) }

  const resumo = useQuery({ queryKey: ['resumo-conc', contaId], enabled: !!contaId, queryFn: () => rpc<any>('fn_resumo_conciliacao', { p_conta: contaId }) })
  const trs = useQuery({ queryKey: ['transacoes', contaId, filtro], enabled: !!contaId, queryFn: async () => {
    let x = supabase.from('transacoes_bancarias').select('*').eq('conta_bancaria_id', contaId).order('data', { ascending: false }).limit(2000)
    if (filtro !== 'todas') x = x.eq('status', filtro)
    return unwrap(await x) as any[]
  } })
  const sug = useQuery({ queryKey: ['sugestoes-conc', contaId], enabled: !!contaId, queryFn: () => rpc<any[]>('fn_sugestoes_conciliacao', { p_conta: contaId }) })
  const sugIA = useQuery({ queryKey: ['ia_sugestoes', 'conc', contaId], enabled: !!contaId && !!org, queryFn: async () =>
    unwrap(await supabase.from('ia_sugestoes').select('*').eq('organizacao_id', org!.id).eq('alvo_tabela', 'transacoes_bancarias').eq('status', 'pendente')) as any[] })
  const sugDe = (id: string) => {
    const s = sug.data?.find(x => x.transacao_id === id)
    if (s) return { ...s, fonte: 'regra' }
    const i = sugIA.data?.find(x => x.alvo_id === id && x.tipo === 'conciliacao')
    return i ? { transacao_id: id, alvo_tipo: i.sugestao.alvo_tipo, alvo_id: i.sugestao.alvo_id, descricao: i.sugestao.justificativa, score: i.confianca, fonte: 'ia', iaId: i.id } : null
  }
  const catIA = (id: string) => sugIA.data?.find(x => x.alvo_id === id && x.tipo === 'categoria')

  const aceitar = async (s: any, origem = 'sugestao') => {
    if (s.alvo_tipo === 'movimento') await rpc('fn_conciliar', { p_transacao: s.transacao_id, p_movimentos: [s.alvo_id], p_origem: s.fonte === 'ia' ? 'ia' : origem })
    else await rpc('fn_conciliar_titulo', { p_transacao: s.transacao_id, p_titulo: s.alvo_id, p_origem: s.fonte === 'ia' ? 'ia' : origem })
    if (s.iaId) await supabase.from('ia_sugestoes').update({ status: 'aprovada', decidido_em: new Date().toISOString() }).eq('id', s.iaId)
  }
  const aceitarM = useMutation({ mutationFn: (s: any) => aceitar(s), onSuccess: () => { toast.success('Conciliado.'); invalidar() }, onError: (e: Error) => toast.error(traduzirErro(e.message)) })
  const lote = useMutation({
    mutationFn: async () => {
      let ok = 0; const erros: string[] = []
      for (const id of sel) { const s = sugDe(id); if (!s) continue; try { await aceitar(s, 'lote'); ok++ } catch (e) { erros.push((e as Error).message) } }
      return { ok, erros }
    },
    onSuccess: ({ ok, erros }) => { toast.success(`${ok} transação(ões) conciliada(s).`); if (erros.length) toast.error(erros[0]); setSel(new Set()); invalidar() },
  })
  const regras = useMutation({ mutationFn: () => rpc<number>('fn_aplicar_regras', { p_conta: contaId }),
    onSuccess: (n) => { toast.success(n ? `${n} transação(ões) lançada(s) e conciliada(s) por regras.` : 'Nenhuma transação pendente atende às regras.'); invalidar() },
    onError: (e: Error) => toast.error(e.message) })
  const ia = useMutation({
    mutationFn: async () => {
      const r1 = await edge<any>('ai-assistant', { acao: 'conciliar', organizacao_id: org!.id, conta_bancaria_id: contaId, idempotency_key: crypto.randomUUID() })
      const semSug = (trs.data ?? []).filter(t => t.status === 'pendente' && !sugDe(t.id)).map(t => t.id).slice(0, 40)
      const r2 = semSug.length ? await edge<any>('ai-assistant', { acao: 'categorizar', organizacao_id: org!.id, alvo: 'transacoes_bancarias', ids: semSug, idempotency_key: crypto.randomUUID() }) : { sugestoes: 0 }
      return r1.sugestoes + r2.sugestoes
    },
    onSuccess: (n) => { toast.success(`${n} sugestão(ões) da IA para revisão.`); invalidar() }, onError: (e: Error) => toast.error(e.message),
  })
  const ignorar = useMutation({ mutationFn: async (t: any) => unwrap(await supabase.from('transacoes_bancarias').update({ status: t.status === 'ignorada' ? 'pendente' : 'ignorada' }).eq('id', t.id)),
    onSuccess: invalidar })
  const desfazer = useMutation({ mutationFn: (t: any) => rpc('fn_desfazer_conciliacao', { p_transacao: t.id }), onSuccess: () => { toast.success('Conciliação desfeita.'); invalidar() }, onError: (e: Error) => toast.error(e.message) })

  const lerArquivo = async (f: File) => {
    setErroArq(null)
    if (f.size > 5 * 1024 * 1024) return setErroArq('Arquivo maior que 5 MB.')
    const buf = await f.arrayBuffer()
    // OFX de bancos brasileiros costuma vir em latin1; tenta UTF-8 e cai para windows-1252
    let texto = new TextDecoder('utf-8').decode(buf)
    if (texto.includes('�')) texto = new TextDecoder('windows-1252').decode(buf)
    try { setArquivo({ nome: f.name, texto, extrato: lerOFX(texto) }) } catch (e) { setErroArq((e as Error).message) }
  }
  const importar = useMutation({
    mutationFn: async () => {
      const a = arquivo!; const hash = await hashArquivo(a.texto)
      const caminho = `${org!.id}/extratos/${contaId}/${hash}.ofx`
      const up = await supabase.storage.from('anexos').upload(caminho, new Blob([a.texto], { type: 'application/x-ofx' }), { upsert: true })
      return rpc<any>('fn_importar_ofx', { p_conta: contaId, p_nome_arquivo: a.nome, p_hash: hash, p_storage_path: up.error ? null : caminho,
        p_meta: { banco_id: a.extrato.banco_id, conta: a.extrato.conta, data_inicio: a.extrato.data_inicio, data_fim: a.extrato.data_fim,
          saldo_final: a.extrato.saldo_final, data_saldo: a.extrato.data_saldo }, p_transacoes: a.extrato.transacoes })
    },
    onSuccess: (r) => {
      if (r.ja_importado) toast.info('Este arquivo já havia sido importado para esta conta. Nada foi duplicado.')
      else toast.success(`${r.novas} transação(ões) nova(s) importada(s)${r.duplicadas ? `, ${r.duplicadas} já existente(s) ignorada(s)` : ''}.`)
      setArquivo(null); invalidar()
    },
    onError: (e: Error) => setErroArq(e.message),
  })

  const r = resumo.data
  const dif = r && r.saldo_extrato != null ? Number(r.saldo_conciliado) - Number(r.saldo_extrato) : null
  const colunas: Coluna<any>[] = [
    { id: 'd', titulo: 'Data', celula: t => data(t.data), valor: t => t.data },
    { id: 'x', titulo: 'Descrição do extrato', celula: t => <span className="text-sm">{t.descricao || '—'}</span>, valor: t => t.descricao },
    { id: 'v', titulo: 'Valor', alinhar: 'right', celula: t => <Dinheiro v={t.valor} />, valor: t => Number(t.valor) },
    { id: 's', titulo: 'Correspondência', valor: t => sugDe(t.id)?.descricao, celula: t => {
      if (t.status !== 'pendente') return <Status s={t.status} />
      const s = sugDe(t.id); const c = catIA(t.id)
      if (s) return (
        <div className="flex flex-wrap items-center gap-1 text-xs">
          {s.fonte === 'ia' ? <Sparkles className="size-3 text-primary" /> : <Link2 className="size-3 text-muted-foreground" />}
          <span className="max-w-60 truncate">{s.alvo_tipo === 'titulo' ? 'Título em aberto: ' : 'Lançamento: '}<b>{s.descricao}</b></span>
          <span className="text-muted-foreground">({Math.round(Number(s.score) * 100)}%)</span>
          {podeEscrever && <Button size="xs" onClick={(e) => { e.stopPropagation(); aceitarM.mutate(s) }}><Check />Conciliar</Button>}
        </div>)
      if (c) return <span className="flex items-center gap-1 text-xs"><Sparkles className="size-3 text-primary" />IA sugere categoria <b>{c.sugestao.categoria}</b></span>
      return <span className="text-xs text-muted-foreground">Sem sugestão</span>
    } },
    { id: 'a', titulo: '', alinhar: 'right', className: 'w-px', celula: t => podeEscrever && (
      <div className="flex justify-end gap-0.5" onClick={e => e.stopPropagation()}>
        {t.status === 'pendente' && <>
          <Button size="icon-sm" variant="ghost" title="Buscar lançamento" aria-label="Buscar lançamento" onClick={() => setBuscar(t)}><Search /></Button>
          <Button size="icon-sm" variant="ghost" title="Criar lançamento" aria-label="Criar lançamento" onClick={() => setCriar(t)}><FilePlus2 /></Button>
        </>}
        {t.status !== 'conciliada' && <Button size="icon-sm" variant="ghost" title={t.status === 'ignorada' ? 'Reativar' : 'Ignorar'} aria-label="Ignorar" onClick={() => ignorar.mutate(t)}><EyeOff /></Button>}
        {t.status === 'conciliada' && <Button size="sm" variant="ghost" onClick={() => desfazer.mutate(t)}><Undo2 />Desfazer</Button>}
      </div>
    ) },
  ]

  if (contas.data && !contas.data.length) return <><PageHeader titulo="Conciliação bancária" /><Vazio titulo="Cadastre uma conta bancária" descricao="A conciliação é feita por conta. Cadastre em Cadastros → Contas bancárias." /></>
  return (
    <div className="space-y-6">
      <PageHeader titulo="Conciliação bancária" descricao="Importe o extrato OFX, confira as sugestões e concilie com os lançamentos do sistema."
        acoes={<Seletor aria-label="Conta" className="w-auto min-w-48" value={contaId} onChange={e => { setConta(e.target.value); setSel(new Set()) }} opcoes={opcoes(contas.data)} />} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi titulo="Saldo no sistema" valor={<Dinheiro v={r?.saldo_sistema} />} rodape={`${r?.movimentos_nao_conciliados ?? 0} lançamento(s) não conciliado(s)`} />
        <Kpi titulo="Saldo conciliado" valor={<Dinheiro v={r?.saldo_conciliado} />} />
        <Kpi titulo="Saldo do último extrato" valor={<Dinheiro v={r?.saldo_extrato} />} rodape={r?.data_saldo_extrato ? `em ${data(r.data_saldo_extrato)}` : 'Nenhum extrato com saldo'}
          alerta={dif != null && Math.abs(dif) > 0.009 ? `Diferença de ${brl(dif)} para o conciliado` : undefined} />
        <Kpi titulo="Transações pendentes" valor={r?.pendentes ?? 0} rodape={`${r?.conciliadas ?? 0} conciliada(s)`} />
      </div>
      {podeEscrever && (
        <div className="flex flex-wrap items-center gap-2">
          <label className={cn('inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground hover:bg-primary/90')}>
            <Upload className="size-4" />Importar OFX
            <input type="file" accept=".ofx,.OFX,application/x-ofx" className="sr-only" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) lerArquivo(f) }} />
          </label>
          <Button variant="outline" onClick={() => regras.mutate()} disabled={regras.isPending}>{regras.isPending ? <Spinner /> : <Wand2 />}Aplicar regras</Button>
          <Button variant="outline" onClick={() => ia.mutate()} disabled={ia.isPending}>{ia.isPending ? <Spinner /> : <Sparkles />}Sugestões da IA</Button>
        </div>
      )}
      {erroArq && <Erro erro={erroArq} />}
      <DataTable colunas={colunas} linhas={trs.data} carregando={trs.isLoading} selecao={podeEscrever && filtro === 'pendente' ? sel : undefined} onSelecao={setSel}
        exportar={{ nome: 'extrato-conciliacao', titulo: 'Transações do extrato' }}
        acoesSelecao={<Button size="sm" onClick={() => lote.mutate()} disabled={lote.isPending}>{lote.isPending ? <Spinner /> : <ListChecks />}Conciliar sugestões selecionadas</Button>}
        barra={<Seletor aria-label="Situação" className="w-auto" value={filtro} onChange={e => { setFiltro(e.target.value); setSel(new Set()) }}
          opcoes={[{ value: 'pendente', label: 'Pendentes' }, { value: 'conciliada', label: 'Conciliadas' }, { value: 'ignorada', label: 'Ignoradas' }, { value: 'todas', label: 'Todas' }]} />}
        vazio={<Vazio titulo={filtro === 'pendente' ? 'Nenhuma transação pendente' : 'Nada encontrado'} descricao="Importe um extrato OFX para começar." />} />

      <Dialog open={!!arquivo} onOpenChange={o => !o && setArquivo(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Importar {arquivo?.nome}</DialogTitle>
            <DialogDescription>Conta de destino: <b>{contas.data?.find(c => c.id === contaId)?.nome}</b></DialogDescription></DialogHeader>
          {arquivo && <div className="space-y-1 text-sm">
            <p>{arquivo.extrato.transacoes.length} transação(ões) · período {data(arquivo.extrato.data_inicio)} a {data(arquivo.extrato.data_fim)}</p>
            {arquivo.extrato.saldo_final != null && <p>Saldo final informado pelo banco: <b>{brl(arquivo.extrato.saldo_final)}</b> em {data(arquivo.extrato.data_saldo)}</p>}
            {arquivo.extrato.conta && <p className="text-muted-foreground">Conta no arquivo: {arquivo.extrato.conta}</p>}
            <Aviso className="mt-2">Transações já importadas (mesmo FITID nesta conta) são ignoradas automaticamente.</Aviso>
          </div>}
          {erroArq && <Erro erro={erroArq} />}
          <DialogFooter><Button variant="outline" onClick={() => setArquivo(null)}>Cancelar</Button>
            <Button onClick={() => importar.mutate()} disabled={importar.isPending}>{importar.isPending && <Spinner />}Importar</Button></DialogFooter>
        </DialogContent>
      </Dialog>
      {buscar && <BuscarLancamento transacao={buscar} onFechar={(ok) => { setBuscar(null); if (ok) invalidar() }} />}
      {criar && <CriarLancamento transacao={criar} sugestaoCategoria={catIA(criar.id)} onFechar={(ok) => { setCriar(null); if (ok) invalidar() }} />}
    </div>
  )
}

function BuscarLancamento({ transacao: t, onFechar }: { transacao: any; onFechar: (ok: boolean) => void }) {
  const [sel, setSel] = useState<Set<string>>(new Set()); const [titulo, setTitulo] = useState(''); const [q, setQ] = useState('')
  const movs = useQuery({ queryKey: ['movs-livres', t.id], queryFn: async () => unwrap(await supabase.from('movimentos').select('*')
    .eq('conta_bancaria_id', t.conta_bancaria_id).eq('conciliado', false).gte('data', somaDias(t.data, -30)).lte('data', somaDias(t.data, 30))
    .order('data')) as any[] })
  const tits = useQuery({ queryKey: ['tits-livres', t.id], queryFn: async () => {
    const { data: cb } = await supabase.from('contas_bancarias').select('empresa_id').eq('id', t.conta_bancaria_id).single()
    return unwrap(await supabase.from('titulos').select('id, descricao, valor, valor_pago, data_vencimento, contatos(nome)').eq('empresa_id', cb!.empresa_id)
      .eq('tipo', t.valor > 0 ? 'receber' : 'pagar').in('status', ['aberto', 'parcial']).gte('data_vencimento', somaDias(t.data, -60)).lte('data_vencimento', somaDias(t.data, 60))
      .order('data_vencimento').limit(200)) as any[]
  } })
  const mesmoSinal = (movs.data ?? []).filter(m => Math.sign(m.valor) === Math.sign(t.valor))
  const soma = mesmoSinal.filter(m => sel.has(m.id)).reduce((s, m) => s + Number(m.valor), 0)
  const filtrar = (s: string) => !q || s.toLowerCase().includes(q.toLowerCase())
  const m = useMutation({
    mutationFn: () => titulo ? rpc('fn_conciliar_titulo', { p_transacao: t.id, p_titulo: titulo }) : rpc('fn_conciliar', { p_transacao: t.id, p_movimentos: [...sel] }),
    onSuccess: () => { toast.success('Conciliado.'); onFechar(true) }, onError: (e: Error) => toast.error(traduzirErro(e.message)),
  })
  return (
    <Dialog open onOpenChange={o => !o && onFechar(false)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader><DialogTitle>Conciliar transação de {brl(t.valor)}</DialogTitle><DialogDescription>{data(t.data)} — {t.descricao}</DialogDescription></DialogHeader>
        <Input placeholder="Filtrar por descrição…" value={q} onChange={e => setQ(e.target.value)} />
        <div className="max-h-[50vh] space-y-4 overflow-y-auto text-sm">
          <div>
            <p className="mb-1 font-medium">Lançamentos já baixados nesta conta (selecione um ou mais)</p>
            {!mesmoSinal.length && <p className="text-muted-foreground">Nenhum lançamento livre em ±30 dias.</p>}
            {mesmoSinal.filter(x => filtrar(x.descricao)).map(x => (
              <label key={x.id} className="flex items-center gap-2 border-b py-1.5">
                <Checkbox checked={sel.has(x.id)} onCheckedChange={(v) => { const s = new Set(sel); if (v) s.add(x.id); else s.delete(x.id); setSel(s); setTitulo('') }} />
                <span className="flex-1">{data(x.data)} · {x.descricao}</span><Dinheiro v={x.valor} />
              </label>
            ))}
          </div>
          <div>
            <p className="mb-1 font-medium">Ou um título em aberto (será baixado na data da transação)</p>
            {(tits.data ?? []).filter(x => filtrar(x.descricao + ' ' + (x.contatos?.nome ?? ''))).map(x => (
              <label key={x.id} className="flex items-center gap-2 border-b py-1.5">
                <input type="radio" name="tit" checked={titulo === x.id} onChange={() => { setTitulo(x.id); setSel(new Set()) }} />
                <span className="flex-1">{data(x.data_vencimento)} · {x.descricao}{x.contatos?.nome ? ` — ${x.contatos.nome}` : ''}</span>
                <span className={cn('tabular', Math.abs(Number(x.valor) - Number(x.valor_pago) - Math.abs(t.valor)) < 0.01 && 'font-semibold text-positivo')}>{brl(Number(x.valor) - Number(x.valor_pago))}</span>
              </label>
            ))}
          </div>
        </div>
        {sel.size > 0 && <p className={cn('text-sm', Math.abs(soma - t.valor) > 0.009 && 'text-amber-600')}>Selecionado: {brl(soma)} de {brl(t.valor)}{Math.abs(soma - t.valor) > 0.009 ? ' — a transação fica pendente até fechar o valor.' : ''}</p>}
        <DialogFooter><Button variant="outline" onClick={() => onFechar(false)}>Cancelar</Button>
          <Button onClick={() => m.mutate()} disabled={(!sel.size && !titulo) || m.isPending}>{m.isPending && <Spinner />}Conciliar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CriarLancamento({ transacao: t, sugestaoCategoria, onFechar }: { transacao: any; sugestaoCategoria?: any; onFechar: (ok: boolean) => void }) {
  const cats = useCategorias(); const contatos = useContatos(); const centros = useCentros()
  const [f, setF] = useState({ categoria: sugestaoCategoria?.sugestao.categoria_id ?? '', descricao: t.descricao, contato: '', centro: '' })
  const [regra, setRegra] = useState(false); const [termo, setTermo] = useState(t.descricao.split(/\s+/).slice(0, 2).join(' '))
  const { org } = useOrg()
  const natureza = t.valor > 0 ? 'entrada' : 'saida'
  const opc = useMemo(() => opcoesCategoria(cats.data, natureza), [cats.data, natureza])
  const m = useMutation({
    mutationFn: async () => {
      if (!f.categoria) throw new Error('Escolha a categoria.')
      await rpc('fn_lancamento_de_transacao', { p_transacao: t.id, p_categoria: f.categoria, p_descricao: f.descricao, p_contato: f.contato || null, p_centro_custo: f.centro || null,
        p_origem: sugestaoCategoria && sugestaoCategoria.sugestao.categoria_id === f.categoria ? 'ia' : 'manual' })
      if (sugestaoCategoria) await supabase.from('ia_sugestoes').update({ status: sugestaoCategoria.sugestao.categoria_id === f.categoria ? 'aprovada' : 'rejeitada', decidido_em: new Date().toISOString() }).eq('id', sugestaoCategoria.id)
      if (regra && termo.trim().length >= 2) unwrap(await supabase.from('regras_conciliacao').insert({ organizacao_id: org!.id, nome: `Regra: ${termo}`, conta_bancaria_id: t.conta_bancaria_id,
        descricao_contem: termo.trim(), sentido: t.valor > 0 ? 'entrada' : 'saida', categoria_id: f.categoria, contato_id: f.contato || null, centro_custo_id: f.centro || null }))
    },
    onSuccess: () => { toast.success('Lançamento criado e conciliado.'); onFechar(true) }, onError: (e: Error) => toast.error(traduzirErro(e.message)),
  })
  return (
    <Dialog open onOpenChange={o => !o && onFechar(false)}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader><DialogTitle>Criar lançamento a partir do extrato</DialogTitle><DialogDescription>{data(t.data)} · {brl(t.valor)} — cria o título já baixado nesta conta e concilia.</DialogDescription></DialogHeader>
        {sugestaoCategoria && <p className="flex items-center gap-1 text-xs"><Sparkles className="size-3 text-primary" />IA sugere <b>{sugestaoCategoria.sugestao.categoria}</b>: {sugestaoCategoria.sugestao.justificativa}</p>}
        <Grade>
          <Campo rotulo="Categoria" obrigatorio className="sm:col-span-2"><Seletor value={f.categoria} onChange={e => setF({ ...f, categoria: e.target.value })} vazio="Selecione…" opcoes={opc} /></Campo>
          <Campo rotulo="Descrição" className="sm:col-span-2"><Input value={f.descricao} onChange={e => setF({ ...f, descricao: e.target.value })} /></Campo>
          <Campo rotulo={t.valor > 0 ? 'Cliente' : 'Fornecedor'}><Seletor value={f.contato} onChange={e => setF({ ...f, contato: e.target.value })} vazio="—" opcoes={opcoes(contatos.data)} /></Campo>
          <Campo rotulo="Centro de custo"><Seletor value={f.centro} onChange={e => setF({ ...f, centro: e.target.value })} vazio="—" opcoes={opcoes(centros.data)} /></Campo>
        </Grade>
        <label className="flex items-center gap-2 text-sm"><Checkbox checked={regra} onCheckedChange={v => setRegra(!!v)} />Criar regra: descrição contém
          <Input className="h-7 w-40" value={termo} onChange={e => setTermo(e.target.value)} disabled={!regra} /></label>
        <DialogFooter><Button variant="outline" onClick={() => onFechar(false)}>Cancelar</Button>
          <Button onClick={() => m.mutate()} disabled={m.isPending}>{m.isPending && <Spinner />}Criar e conciliar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
