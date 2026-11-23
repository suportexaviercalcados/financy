import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Ban, Eye, Plus, Trash2, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase, rpc, unwrap } from '@/lib/supabase'
import { useEmpresaPadrao, useOrg } from '@/contexts/org'
import { useCanais, useContasBancarias, useContatos, useFormas, useProdutos, opcoes } from '@/hooks/lookups'
import { brl, data, hoje } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { DataTable, type Coluna } from '@/components/DataTable'
import { Campo, EntradaValor, Grade, Seletor } from '@/components/form'
import { Confirmar, Erro, PageHeader, Spinner, Status } from '@/components/common'
import { Switch } from '@/components/ui/switch'

export default function Vendas() {
  const { org, empresaIds, periodo, podeEscrever } = useOrg()
  const qc = useQueryClient()
  const canais = useCanais()
  const [canal, setCanal] = useState('')
  const [nova, setNova] = useState(false)
  const [ver, setVer] = useState<any | null>(null)
  const [cancelar, setCancelar] = useState<any | null>(null)
  const q = useQuery({
    queryKey: ['vendas', org?.id, empresaIds, periodo, canal],
    enabled: !!org,
    queryFn: async () => {
      let x = supabase.from('vendas').select('*, canais_venda(nome), contatos(nome)').eq('organizacao_id', org!.id)
        .gte('data_venda', periodo.inicio).lte('data_venda', periodo.fim).order('data_venda', { ascending: false }).limit(3000)
      if (empresaIds) x = x.in('empresa_id', empresaIds)
      if (canal) x = x.eq('canal_id', canal)
      return unwrap(await x) as any[]
    },
  })
  const cancelarM = useMutation({
    mutationFn: (v: any) => rpc('fn_cancelar_venda', { p_venda: v.id }),
    onSuccess: () => { toast.success('Venda cancelada; recebíveis em aberto foram cancelados.'); setCancelar(null); qc.invalidateQueries({ queryKey: ['vendas'] }) },
    onError: (e: Error) => { toast.error(e.message); setCancelar(null) },
  })
  const ativas = (q.data ?? []).filter(v => v.status === 'concluida')
  const soma = (k: string) => ativas.reduce((s, v) => s + Number(v[k]), 0)
  const colunas: Coluna<any>[] = [
    { id: 'data', titulo: 'Data', celula: v => data(v.data_venda), valor: v => v.data_venda },
    { id: 'num', titulo: 'Nº', celula: v => v.numero, valor: v => v.numero },
    { id: 'canal', titulo: 'Canal', celula: v => v.canais_venda?.nome, valor: v => v.canais_venda?.nome },
    { id: 'cli', titulo: 'Cliente', celula: v => v.contatos?.nome ?? '—', valor: v => v.contatos?.nome },
    { id: 'total', titulo: 'Total', alinhar: 'right', celula: v => brl(v.valor_total), valor: v => Number(v.valor_total), rodape: brl(soma('valor_total')) },
    { id: 'taxas', titulo: 'Taxas/comissões', alinhar: 'right', valor: v => Number(v.valor_taxas_pagamento) + Number(v.valor_taxa_marketplace) + Number(v.valor_comissao) + Number(v.custo_frete),
      celula: v => brl(Number(v.valor_taxas_pagamento) + Number(v.valor_taxa_marketplace) + Number(v.valor_comissao) + Number(v.custo_frete)) },
    { id: 'cmv', titulo: 'CMV', alinhar: 'right', valor: v => Number(v.cmv), rodape: brl(soma('cmv')),
      celula: v => <span className="inline-flex items-center gap-1">{brl(v.cmv)}{v.cmv_incompleto && <AlertTriangle className="size-3.5 text-amber-500" aria-label="CMV incompleto: item sem custo" />}</span> },
    { id: 'orig', titulo: 'Origem', celula: v => v.origem === 'bling' ? 'Bling' : v.origem === 'demo' ? 'Demonstração' : 'Manual', valor: v => v.origem },
    { id: 'st', titulo: 'Status', celula: v => <Status s={v.status} />, valor: v => v.status },
    { id: 'ac', titulo: '', alinhar: 'right', className: 'w-px', celula: v => (
      <div className="flex justify-end gap-0.5" onClick={e => e.stopPropagation()}>
        <Button size="icon-sm" variant="ghost" aria-label="Detalhes" onClick={() => setVer(v)}><Eye /></Button>
        {podeEscrever && v.status === 'concluida' && <Button size="icon-sm" variant="ghost" aria-label="Cancelar venda" onClick={() => setCancelar(v)}><Ban /></Button>}
      </div>
    ) },
  ]
  return (
    <div>
      <PageHeader titulo="Vendas" descricao="Cada venda gera automaticamente CMV, taxas, comissões e recebíveis — e reflete no fluxo de caixa, DRE, DFC e dashboard."
        acoes={podeEscrever && <Button onClick={() => setNova(true)}><Plus />Nova venda</Button>} />
      <DataTable colunas={colunas} linhas={q.data} carregando={q.isLoading} onLinha={setVer}
        exportar={{ nome: 'vendas', titulo: 'Vendas', subtitulo: `${data(periodo.inicio)} a ${data(periodo.fim)}` }}
        barra={<Seletor aria-label="Canal" className="w-auto" value={canal} onChange={e => setCanal(e.target.value)} vazio="Todos os canais" opcoes={opcoes(canais.data)} />} />
      {nova && <NovaVenda onFechar={() => setNova(false)} />}
      {ver && <DetalheVenda venda={ver} onFechar={() => setVer(null)} />}
      <Confirmar aberto={!!cancelar} titulo="Cancelar venda?" perigo textoBotao="Cancelar venda" carregando={cancelarM.isPending}
        descricao="A venda sai da DRE e os recebíveis/comissões em aberto são cancelados. Se houver recebimentos baixados, estorne-os antes."
        onFechar={() => setCancelar(null)} onConfirmar={() => cancelarM.mutate(cancelar)} />
    </div>
  )
}

type Item = { produto_id: string; descricao: string; quantidade: number; preco_unitario: number; desconto: number; custo?: number | null }
type Pag = { forma_pagamento_id: string; valor: number; parcelas: number; data_vencimento: string; conta_bancaria_id: string }

function NovaVenda({ onFechar }: { onFechar: () => void }) {
  const { org, empresas } = useOrg()
  const empresaPadrao = useEmpresaPadrao()
  const qc = useQueryClient()
  const canais = useCanais(); const formas = useFormas(); const produtos = useProdutos(); const contatos = useContatos(); const contas = useContasBancarias()
  const [cab, setCab] = useState({ empresa_id: empresaPadrao, canal_id: '', contato_id: '', data_venda: hoje(), desconto: 0, frete: 0, numero: '', obs: '' })
  const [itens, setItens] = useState<Item[]>([{ produto_id: '', descricao: '', quantidade: 1, preco_unitario: NaN, desconto: 0 }])
  const [pags, setPags] = useState<Pag[]>([{ forma_pagamento_id: '', valor: NaN, parcelas: 1, data_vencimento: '', conta_bancaria_id: '' }])
  const [chave] = useState(() => crypto.randomUUID())
  const [erro, setErro] = useState<string | null>(null)
  const totalProdutos = itens.reduce((s, i) => s + (i.quantidade || 0) * (i.preco_unitario || 0) - (i.desconto || 0), 0)
  const total = Math.round((totalProdutos - (cab.desconto || 0) + (cab.frete || 0)) * 100) / 100
  const somaPags = pags.reduce((s, p) => s + (p.valor || 0), 0)
  const tipoForma = (id: string) => formas.data?.find(f => f.id === id)?.tipo
  const setItem = (i: number, p: Partial<Item>) => setItens(l => l.map((x, j) => (j === i ? { ...x, ...p } : x)))
  const setPag = (i: number, p: Partial<Pag>) => setPags(l => l.map((x, j) => (j === i ? { ...x, ...p } : x)))
  const m = useMutation({
    mutationFn: async () => {
      if (!cab.canal_id) throw new Error('Escolha o canal de venda.')
      if (itens.some(i => !i.descricao.trim() || !(i.quantidade > 0) || !(i.preco_unitario >= 0))) throw new Error('Revise os itens (descrição, quantidade e preço).')
      if (pags.some(p => !p.forma_pagamento_id || !(p.valor > 0))) throw new Error('Revise as formas de pagamento.')
      if (Math.abs(somaPags - total) > 0.009) throw new Error(`A soma dos pagamentos (${brl(somaPags)}) deve ser igual ao total (${brl(total)}).`)
      return rpc<string>('fn_registrar_venda', { p: {
        organizacao_id: org!.id, empresa_id: cab.empresa_id, canal_id: cab.canal_id, contato_id: cab.contato_id || null, numero: cab.numero || null,
        data_venda: cab.data_venda, desconto: cab.desconto || 0, frete_cobrado: cab.frete || 0, observacoes: cab.obs || null,
        origem: 'manual', external_id: chave,   // evita duplicar em duplo clique / reenvio
        itens: itens.map(i => ({ produto_id: i.produto_id || null, descricao: i.descricao, quantidade: i.quantidade, preco_unitario: i.preco_unitario, desconto: i.desconto || 0 })),
        pagamentos: pags.map(p => ({ forma_pagamento_id: p.forma_pagamento_id, valor: p.valor, parcelas: p.parcelas,
          data_vencimento: p.data_vencimento || undefined, conta_bancaria_id: p.conta_bancaria_id || undefined })),
      } })
    },
    onSuccess: () => { toast.success('Venda registrada: recebíveis e custos gerados.'); qc.invalidateQueries(); onFechar() },
    onError: (e: Error) => setErro(e.message),
  })
  return (
    <Dialog open onOpenChange={o => !o && onFechar()}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader><DialogTitle>Nova venda</DialogTitle><DialogDescription>Lançamento manual. Vendas do Bling entram automaticamente pela integração.</DialogDescription></DialogHeader>
        <div className="max-h-[70vh] space-y-5 overflow-y-auto pr-1">
          <Grade cols={3}>
            {empresas.length > 1 && <Campo rotulo="Empresa"><Seletor value={cab.empresa_id} onChange={e => setCab({ ...cab, empresa_id: e.target.value })} opcoes={empresas.map(e => ({ value: e.id, label: e.nome_fantasia || e.razao_social }))} /></Campo>}
            <Campo rotulo="Canal" obrigatorio><Seletor value={cab.canal_id} onChange={e => setCab({ ...cab, canal_id: e.target.value })} vazio="Selecione…" opcoes={opcoes(canais.data?.filter(c => c.ativo))} /></Campo>
            <Campo rotulo="Data" obrigatorio><Input type="date" value={cab.data_venda} onChange={e => setCab({ ...cab, data_venda: e.target.value })} /></Campo>
            <Campo rotulo="Cliente"><Seletor value={cab.contato_id} onChange={e => setCab({ ...cab, contato_id: e.target.value })} vazio="—" opcoes={opcoes(contatos.data)} /></Campo>
            <Campo rotulo="Número"><Input value={cab.numero} onChange={e => setCab({ ...cab, numero: e.target.value })} placeholder="Automático" /></Campo>
          </Grade>
          <div>
            <p className="mb-2 text-sm font-medium">Itens</p>
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader><TableRow><TableHead className="min-w-56">Produto / descrição</TableHead><TableHead className="w-20">Qtd</TableHead><TableHead className="w-36">Preço unit.</TableHead><TableHead className="w-32">Desconto</TableHead><TableHead className="w-28 text-right">Subtotal</TableHead><TableHead className="w-8" /></TableRow></TableHeader>
                <TableBody>
                  {itens.map((it, i) => (
                    <TableRow key={i}>
                      <TableCell className="space-y-1">
                        <Seletor value={it.produto_id} vazio="Item avulso" opcoes={(produtos.data ?? []).filter(p => p.ativo).map(p => ({ value: p.id, label: `${p.sku ? p.sku + ' — ' : ''}${p.nome}` }))}
                          onChange={e => { const p = produtos.data?.find(x => x.id === e.target.value); setItem(i, { produto_id: e.target.value, descricao: p?.nome ?? it.descricao, preco_unitario: p ? Number(p.preco) : it.preco_unitario, custo: p?.custo }) }} />
                        {!it.produto_id && <Input placeholder="Descrição" value={it.descricao} onChange={e => setItem(i, { descricao: e.target.value })} />}
                        {it.produto_id && it.custo == null && <p className="text-xs text-amber-600">Produto sem custo cadastrado — CMV ficará incompleto.</p>}
                      </TableCell>
                      <TableCell><Input type="number" min={0} step="any" value={it.quantidade} onChange={e => setItem(i, { quantidade: Number(e.target.value) })} /></TableCell>
                      <TableCell><EntradaValor valor={it.preco_unitario} onChange={v => setItem(i, { preco_unitario: v })} /></TableCell>
                      <TableCell><EntradaValor valor={it.desconto} onChange={v => setItem(i, { desconto: v })} /></TableCell>
                      <TableCell className="text-right tabular">{brl((it.quantidade || 0) * (it.preco_unitario || 0) - (it.desconto || 0))}</TableCell>
                      <TableCell>{itens.length > 1 && <Button size="icon-sm" variant="ghost" onClick={() => setItens(l => l.filter((_, j) => j !== i))} aria-label="Remover item"><Trash2 /></Button>}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => setItens(l => [...l, { produto_id: '', descricao: '', quantidade: 1, preco_unitario: NaN, desconto: 0 }])}><Plus />Item</Button>
          </div>
          <Grade cols={3}>
            <Campo rotulo="Desconto no pedido"><EntradaValor valor={cab.desconto} onChange={v => setCab({ ...cab, desconto: v })} /></Campo>
            <Campo rotulo="Frete cobrado do cliente"><EntradaValor valor={cab.frete} onChange={v => setCab({ ...cab, frete: v })} /></Campo>
            <div className="flex flex-col justify-end"><span className="text-xs text-muted-foreground">Total da venda</span><span className="text-2xl font-semibold tabular">{brl(total)}</span></div>
          </Grade>
          <div>
            <p className="mb-2 text-sm font-medium">Pagamento</p>
            <div className="space-y-2">
              {pags.map((p, i) => {
                const t = tipoForma(p.forma_pagamento_id)
                return (
                  <div key={i} className="grid grid-cols-2 gap-2 rounded-lg border p-2 md:grid-cols-6">
                    <Seletor className="col-span-2" value={p.forma_pagamento_id} vazio="Forma…" opcoes={opcoes(formas.data?.filter(f => f.ativo))} onChange={e => setPag(i, { forma_pagamento_id: e.target.value })} />
                    <EntradaValor valor={p.valor} onChange={v => setPag(i, { valor: v })} />
                    <Input type="number" min={1} max={48} title="Parcelas" value={p.parcelas} disabled={t !== 'credito' && t !== 'crediario' && t !== 'boleto'} onChange={e => setPag(i, { parcelas: Math.max(1, Number(e.target.value)) })} />
                    {['boleto', 'crediario', 'outro', 'transferencia'].includes(t ?? '')
                      ? <Input type="date" title="1º vencimento" value={p.data_vencimento} onChange={e => setPag(i, { data_vencimento: e.target.value })} />
                      : <Seletor value={p.conta_bancaria_id} vazio="Conta da taxa" title="Conta de recebimento (padrão: a da configuração de taxas)" opcoes={opcoes(contas.data)} onChange={e => setPag(i, { conta_bancaria_id: e.target.value })} />}
                    <div className="flex items-center justify-end">{pags.length > 1 && <Button size="icon-sm" variant="ghost" onClick={() => setPags(l => l.filter((_, j) => j !== i))} aria-label="Remover pagamento"><Trash2 /></Button>}</div>
                  </div>
                )
              })}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setPags(l => [...l, { forma_pagamento_id: '', valor: Math.max(0, Math.round((total - somaPags) * 100) / 100), parcelas: 1, data_vencimento: '', conta_bancaria_id: '' }])}><Plus />Forma de pagamento</Button>
              {pags.length === 1 && <Button variant="ghost" size="sm" onClick={() => setPag(0, { valor: total })}>Usar total</Button>}
              <span className={`text-sm ${Math.abs(somaPags - total) > 0.009 ? 'text-destructive' : 'text-muted-foreground'}`}>Pagamentos: {brl(somaPags)} de {brl(total)}</span>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">Taxas, prazos e contas vêm de Cadastros → Canais e taxas. Dinheiro/PIX/débito com prazo zero e conta definida são liquidados na hora.</p>
          </div>
          {erro && <Erro erro={erro} />}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>Cancelar</Button>
          <Button onClick={() => { setErro(null); m.mutate() }} disabled={m.isPending}>{m.isPending && <Spinner />}Registrar venda</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function DetalheVenda({ venda, onFechar }: { venda: any; onFechar: () => void }) {
  const { podeEscrever } = useOrg(); const qc = useQueryClient()
  const det = useQuery({ queryKey: ['venda', venda.id], queryFn: async () => {
    const [itens, pags, tits, devs] = await Promise.all([
      supabase.from('venda_itens').select('*').eq('venda_id', venda.id),
      supabase.from('venda_pagamentos').select('*, formas_pagamento(nome)').eq('venda_id', venda.id),
      supabase.from('titulos').select('id, tipo, descricao, valor, valor_bruto, valor_taxa, valor_pago, data_vencimento, status').eq('venda_id', venda.id).order('data_vencimento'),
      supabase.from('devolucoes').select('*').eq('venda_id', venda.id).order('data'),
    ])
    return { itens: unwrap(itens) as any[], pags: unwrap(pags) as any[], tits: unwrap(tits) as any[], devs: unwrap(devs) as any[] }
  } })
  const [dev, setDev] = useState({ data: hoje(), valor: NaN, custo: 0, tipo: 'devolucao', reembolso: true, motivo: '' })
  const [abrirDev, setAbrirDev] = useState(false)
  const devM = useMutation({
    mutationFn: async () => {
      if (!(dev.valor > 0)) throw new Error('Informe o valor devolvido.')
      unwrap(await supabase.from('devolucoes').insert({ organizacao_id: venda.organizacao_id, venda_id: venda.id, data: dev.data, valor: dev.valor,
        custo_devolvido: dev.custo || 0, tipo: dev.tipo, gera_reembolso: dev.reembolso, motivo: dev.motivo || null }))
    },
    onSuccess: () => { toast.success('Devolução registrada.'); setAbrirDev(false); qc.invalidateQueries() },
    onError: (e: Error) => toast.error(e.message),
  })
  const linha = (r: string, v: unknown, neg = false) => <div className="flex justify-between"><span className="text-muted-foreground">{r}</span><span className="tabular">{neg && Number(v) ? '− ' : ''}{brl(v)}</span></div>
  const v = venda
  const margem = Number(v.valor_total) - Number(v.cmv) - Number(v.valor_taxas_pagamento) - Number(v.valor_taxa_marketplace) - Number(v.valor_comissao) - Number(v.custo_frete)
  return (
    <Dialog open onOpenChange={o => !o && onFechar()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader><DialogTitle>Venda {v.numero} — {v.canais_venda?.nome}</DialogTitle><DialogDescription>{data(v.data_venda)} · <Status s={v.status} /></DialogDescription></DialogHeader>
        <div className="max-h-[70vh] space-y-4 overflow-y-auto pr-1 text-sm">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1 rounded-lg border p-3">
              {linha('Produtos', v.valor_produtos)}{linha('Descontos', v.desconto, true)}{linha('Frete cobrado', v.frete_cobrado)}
              <div className="flex justify-between border-t pt-1 font-semibold"><span>Total</span><span className="tabular">{brl(v.valor_total)}</span></div>
            </div>
            <div className="space-y-1 rounded-lg border p-3">
              {linha('CMV' + (v.cmv_incompleto ? ' (incompleto)' : ''), v.cmv, true)}{linha('Taxas de pagamento', v.valor_taxas_pagamento, true)}
              {linha('Taxa marketplace', v.valor_taxa_marketplace, true)}{linha('Comissão', v.valor_comissao, true)}{linha('Custo de frete', v.custo_frete, true)}
              <div className="flex justify-between border-t pt-1 font-semibold"><span>Margem de contribuição (antes de impostos)</span><span className="tabular">{brl(margem)}</span></div>
            </div>
          </div>
          {det.data && <>
            <p className="font-medium">Itens</p>
            <ul className="divide-y rounded-lg border">{det.data.itens.map(i => <li key={i.id} className="flex justify-between gap-2 px-3 py-1.5"><span>{Number(i.quantidade)} × {i.descricao}</span><span className="tabular">{brl(i.quantidade * i.preco_unitario - i.desconto)} <span className="text-xs text-muted-foreground">custo {i.custo_unitario == null ? 'não cadastrado' : brl(i.custo_unitario)}</span></span></li>)}</ul>
            <p className="font-medium">Recebíveis e custos gerados</p>
            <ul className="divide-y rounded-lg border">{det.data.tits.map(t => <li key={t.id} className="flex flex-wrap justify-between gap-2 px-3 py-1.5"><span>{t.tipo === 'receber' ? '↓' : '↑'} {t.descricao}</span><span className="flex items-center gap-2 tabular">{data(t.data_vencimento)} · {t.valor_taxa ? <span className="text-xs text-muted-foreground">bruto {brl(t.valor_bruto)} − taxa {brl(t.valor_taxa)} =</span> : null} {brl(t.valor)} <Status s={t.status} /></span></li>)}</ul>
            {!!det.data.devs.length && <>
              <p className="font-medium">Devoluções e trocas</p>
              <ul className="divide-y rounded-lg border">{det.data.devs.map(d => <li key={d.id} className="flex justify-between px-3 py-1.5"><span>{data(d.data)} · {d.tipo}{d.motivo ? ` — ${d.motivo}` : ''}</span><span className="tabular">{brl(d.valor)}</span></li>)}</ul>
            </>}
          </>}
          {abrirDev && (
            <div className="rounded-lg border p-3">
              <Grade cols={3}>
                <Campo rotulo="Data"><Input type="date" value={dev.data} onChange={e => setDev({ ...dev, data: e.target.value })} /></Campo>
                <Campo rotulo="Tipo"><Seletor value={dev.tipo} onChange={e => setDev({ ...dev, tipo: e.target.value })} opcoes={[{ value: 'devolucao', label: 'Devolução' }, { value: 'troca', label: 'Troca' }]} /></Campo>
                <Campo rotulo="Valor devolvido"><EntradaValor valor={dev.valor} onChange={x => setDev({ ...dev, valor: x })} /></Campo>
                <Campo rotulo="Custo da mercadoria que voltou ao estoque"><EntradaValor valor={dev.custo} onChange={x => setDev({ ...dev, custo: x })} /></Campo>
                <Campo rotulo="Gerar reembolso a pagar"><Switch checked={dev.reembolso} onCheckedChange={x => setDev({ ...dev, reembolso: x })} disabled={dev.tipo === 'troca'} /></Campo>
                <Campo rotulo="Motivo"><Input value={dev.motivo} onChange={e => setDev({ ...dev, motivo: e.target.value })} /></Campo>
              </Grade>
              <Button className="mt-3" size="sm" onClick={() => devM.mutate()} disabled={devM.isPending}>{devM.isPending && <Spinner />}Registrar devolução</Button>
            </div>
          )}
        </div>
        <DialogFooter>
          {podeEscrever && v.status === 'concluida' && !abrirDev && <Button variant="outline" onClick={() => setAbrirDev(true)}><Undo2 />Devolução / troca</Button>}
          <Button variant="outline" onClick={onFechar}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
