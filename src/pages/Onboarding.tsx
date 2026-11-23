import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Link2, Plus, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { supabase, rpc, unwrap, edge } from '@/lib/supabase'
import { useOrg } from '@/contexts/org'
import { useAuth } from '@/contexts/auth'
import { cnpjValido, hoje, inicioMes, soDigitos } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Campo, EntradaValor, Grade, Seletor } from '@/components/form'
import { Erro, Spinner } from '@/components/common'
import { cn } from '@/lib/utils'

const PASSOS = ['Empresa', 'Plano de contas', 'Contas bancárias', 'Canais e taxas', 'Bling', 'Extrato OFX']

export function Onboarding() {
  const { orgs, org: orgAtual, trocarOrg, recarregar } = useOrg()
  const { sair } = useAuth()
  const [sp] = useSearchParams()
  const nova = sp.get('nova') === '1'
  const pendente = !nova ? orgs.find(o => !o.onboarding_concluido && o.papel === 'proprietario') : undefined
  const [orgId, setOrgId] = useState<string | null>(pendente?.id ?? null)
  const [passo, setPasso] = useState(pendente ? 1 : 0)
  const nav = useNavigate()
  const qc = useQueryClient()

  const convites = useQuery({ queryKey: ['meus-convites'], queryFn: () => rpc<any[]>('fn_meus_convites') })
  const aceitar = useMutation({
    mutationFn: (token: string) => rpc<string>('fn_aceitar_convite', { p_token: token }),
    onSuccess: async (id) => { localStorage.setItem('financy.org', JSON.stringify(id)); await qc.invalidateQueries({ queryKey: ['orgs'] }); trocarOrg(id); nav('/') },
    onError: (e: Error) => toast.error(e.message),
  })

  const demo = useMutation({
    mutationFn: () => rpc<string>('fn_criar_demo'),
    onSuccess: async (id) => { localStorage.setItem('financy.org', JSON.stringify(id)); await qc.invalidateQueries({ queryKey: ['orgs'] }); trocarOrg(id); toast.success('Organização de demonstração criada.'); nav('/') },
    onError: (e: Error) => toast.error(e.message),
  })

  const concluir = async () => {
    if (orgId) await supabase.from('organizacoes').update({ onboarding_concluido: true }).eq('id', orgId)
    if (orgId) localStorage.setItem('financy.org', JSON.stringify(orgId))
    await qc.invalidateQueries({ queryKey: ['orgs'] })   // aguarda o recarregamento para o guard de rotas não voltar ao onboarding
    if (orgId) trocarOrg(orgId)
    nav('/')
  }

  return (
    <div className="min-h-svh bg-muted/30 px-4 py-10">
      <div className="mx-auto max-w-3xl">
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Configuração inicial</h1>
            <p className="text-sm text-muted-foreground">Leva poucos minutos. Você pode ajustar tudo depois em Cadastros.</p>
          </div>
          {orgAtual && !pendente ? <Button variant="ghost" onClick={() => nav('/')}>Voltar ao sistema</Button>
            : <Button variant="ghost" onClick={sair}>Sair</Button>}
        </div>
        <ol className="mb-6 flex flex-wrap gap-2">
          {PASSOS.map((p, i) => (
            <li key={p} className={cn('flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs', i === passo && 'border-primary bg-primary/10 text-primary', i < passo && 'text-muted-foreground')}>
              {i < passo ? <Check className="size-3" /> : <span className="tabular">{i + 1}</span>}{p}
            </li>
          ))}
        </ol>
        {passo === 0 && !!convites.data?.length && (
          <Card className="mb-4 p-4">
            <p className="font-medium">Você tem convites pendentes</p>
            {convites.data.map(c => (
              <div key={c.token} className="mt-2 flex items-center justify-between gap-2 text-sm">
                <span>{c.organizacao} — {c.papel}</span>
                <Button size="sm" onClick={() => aceitar.mutate(c.token)} disabled={aceitar.isPending}>Aceitar e entrar</Button>
              </div>
            ))}
          </Card>
        )}
        {passo === 0 && (
          <Card className="mb-4 flex-row flex-wrap items-center justify-between gap-3 p-4">
            <div><p className="font-medium">Quer conhecer antes de configurar?</p>
              <p className="text-sm text-muted-foreground">Cria uma organização separada, claramente identificada como <b>demonstração</b>, com dados fictícios. Nada vem do Bling nem da IA.</p></div>
            <Button variant="outline" onClick={() => demo.mutate()} disabled={demo.isPending}>{demo.isPending && <Spinner />}Explorar com dados de demonstração</Button>
          </Card>
        )}
        <Card className="p-6">
          {passo === 0 && <PassoEmpresa onCriada={(id) => { setOrgId(id); recarregar(); setPasso(1) }} />}
          {passo === 1 && orgId && <PassoPlano orgId={orgId} onProximo={() => setPasso(2)} />}
          {passo === 2 && orgId && <PassoContas orgId={orgId} onProximo={() => setPasso(3)} />}
          {passo === 3 && orgId && <PassoCanais orgId={orgId} onProximo={() => setPasso(4)} />}
          {passo === 4 && orgId && <PassoBling orgId={orgId} onProximo={() => setPasso(5)} />}
          {passo === 5 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold">Primeira importação de extrato (OFX)</h2>
              <p className="text-sm text-muted-foreground">Exporte o extrato OFX no internet banking e importe em <b>Conciliação bancária</b>. O sistema evita duplicidades pelo identificador de cada transação (FITID) e sugere correspondências com suas contas.</p>
              <div className="flex flex-wrap gap-2">
                <Button onClick={async () => { await concluir(); nav('/conciliacao') }}><Upload />Concluir e importar OFX</Button>
                <Button variant="outline" onClick={concluir}>Concluir e ir para o dashboard</Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  )
}

function PassoEmpresa({ onCriada }: { onCriada: (id: string) => void }) {
  const [f, setF] = useState({ org: '', razao: '', fantasia: '', cnpj: '', regime: 'simples', aliquota: 6, modo: 'estimado' })
  const [erro, setErro] = useState<string | null>(null)
  const m = useMutation({
    mutationFn: async () => {
      if (f.org.trim().length < 2) throw new Error('Informe o nome da organização.')
      if (f.cnpj && !cnpjValido(f.cnpj)) throw new Error('CNPJ inválido.')
      return rpc<string>('fn_criar_organizacao', { p_nome: f.org, p_empresa: { razao_social: f.razao || f.org, nome_fantasia: f.fantasia,
        cnpj: soDigitos(f.cnpj), regime_tributario: f.regime, aliquota_imposto_vendas: f.aliquota, imposto_vendas_modo: f.modo } })
    },
    onSuccess: onCriada, onError: (e: Error) => setErro(e.message),
  })
  return (
    <form onSubmit={e => { e.preventDefault(); setErro(null); m.mutate() }} className="space-y-4">
      <h2 className="text-lg font-semibold">Dados da organização e da primeira empresa</h2>
      <Grade>
        <Campo rotulo="Nome da organização" obrigatorio className="sm:col-span-2" ajuda="Ex.: Grupo Loja Bela. Pode reunir várias empresas (CNPJs)."><Input value={f.org} onChange={e => setF({ ...f, org: e.target.value })} /></Campo>
        <Campo rotulo="Razão social"><Input value={f.razao} onChange={e => setF({ ...f, razao: e.target.value })} /></Campo>
        <Campo rotulo="Nome fantasia"><Input value={f.fantasia} onChange={e => setF({ ...f, fantasia: e.target.value })} /></Campo>
        <Campo rotulo="CNPJ"><Input value={f.cnpj} onChange={e => setF({ ...f, cnpj: e.target.value })} placeholder="00.000.000/0000-00" /></Campo>
        <Campo rotulo="Regime tributário">
          <Seletor value={f.regime} onChange={e => setF({ ...f, regime: e.target.value })} opcoes={[{ value: 'simples', label: 'Simples Nacional' }, { value: 'presumido', label: 'Lucro Presumido' }, { value: 'real', label: 'Lucro Real' }]} />
        </Campo>
        <Campo rotulo="Alíquota efetiva sobre vendas (%)" ajuda="Ex.: alíquota efetiva do DAS. Usada para estimar impostos na DRE.">
          <Input type="number" step="0.01" min={0} max={100} value={f.aliquota} onChange={e => setF({ ...f, aliquota: Number(e.target.value) })} />
        </Campo>
        <Campo rotulo="Impostos sobre vendas na DRE">
          <Seletor value={f.modo} onChange={e => setF({ ...f, modo: e.target.value })} opcoes={[{ value: 'estimado', label: 'Estimar pela alíquota' }, { value: 'lancado', label: 'Usar guias lançadas em contas a pagar' }]} />
        </Campo>
      </Grade>
      {erro && <Erro erro={erro} />}
      <Button type="submit" disabled={m.isPending}>{m.isPending && <Spinner />}Criar organização</Button>
    </form>
  )
}

function PassoPlano({ orgId, onProximo }: { orgId: string; onProximo: () => void }) {
  const q = useQuery({ queryKey: ['plano-count', orgId], queryFn: async () => (await supabase.from('plano_contas').select('id', { count: 'exact', head: true }).eq('organizacao_id', orgId)).count })
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Plano de contas</h2>
      <p className="text-sm text-muted-foreground">Criamos um plano de contas padrão para varejo com <b>{q.data ?? '…'}</b> categorias, já classificadas para a DRE (receitas, deduções, CMV, despesas variáveis e fixas, resultado financeiro) e para a DFC (operacional, investimento e financiamento). Ele é totalmente editável em <b>Cadastros → Plano de contas</b>.</p>
      <Button onClick={onProximo}>Continuar</Button>
    </div>
  )
}

function PassoContas({ orgId, onProximo }: { orgId: string; onProximo: () => void }) {
  const qc = useQueryClient()
  const emp = useQuery({ queryKey: ['emp-onb', orgId], queryFn: async () => unwrap(await supabase.from('empresas').select('id').eq('organizacao_id', orgId)) as any[] })
  const contas = useQuery({ queryKey: ['contas-onb', orgId], queryFn: async () => unwrap(await supabase.from('contas_bancarias').select('*').eq('organizacao_id', orgId).order('created_at')) as any[] })
  const [f, setF] = useState({ nome: '', tipo: 'corrente', banco: '', saldo: 0, data: inicioMes(hoje()) })
  const add = useMutation({
    mutationFn: async () => {
      if (!f.nome.trim()) throw new Error('Informe o nome da conta.')
      unwrap(await supabase.from('contas_bancarias').insert({ organizacao_id: orgId, empresa_id: emp.data![0].id, nome: f.nome, tipo: f.tipo,
        banco: f.banco || null, saldo_inicial: Number.isNaN(f.saldo) ? 0 : f.saldo, data_saldo_inicial: f.data }))
    },
    onSuccess: () => { setF({ ...f, nome: '', banco: '', saldo: 0 }); qc.invalidateQueries({ queryKey: ['contas-onb'] }) },
    onError: (e: Error) => toast.error(e.message),
  })
  const rem = async (id: string) => { await supabase.from('contas_bancarias').delete().eq('id', id); qc.invalidateQueries({ queryKey: ['contas-onb'] }) }
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Contas bancárias e caixas</h2>
      <p className="text-sm text-muted-foreground">Informe o saldo de cada conta numa data de corte. Lançamentos anteriores a essa data já estão no saldo inicial.</p>
      <ul className="divide-y rounded-lg border">
        {contas.data?.map(c => (
          <li key={c.id} className="flex items-center justify-between px-3 py-2 text-sm">
            <span>{c.nome} <span className="text-muted-foreground">({c.tipo})</span></span>
            <span className="flex items-center gap-2 tabular">{Number(c.saldo_inicial).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
              <Button size="icon-sm" variant="ghost" onClick={() => rem(c.id)} aria-label="Remover"><Trash2 /></Button></span>
          </li>
        ))}
        {!contas.data?.length && <li className="px-3 py-2 text-sm text-muted-foreground">Nenhuma conta ainda.</li>}
      </ul>
      <Grade cols={3}>
        <Campo rotulo="Nome"><Input value={f.nome} onChange={e => setF({ ...f, nome: e.target.value })} placeholder="Itaú PJ, Caixa da loja…" /></Campo>
        <Campo rotulo="Tipo"><Seletor value={f.tipo} onChange={e => setF({ ...f, tipo: e.target.value })} opcoes={TIPOS_CONTA} /></Campo>
        <Campo rotulo="Banco"><Input value={f.banco} onChange={e => setF({ ...f, banco: e.target.value })} /></Campo>
        <Campo rotulo="Saldo inicial"><EntradaValor valor={f.saldo} onChange={v => setF({ ...f, saldo: v })} /></Campo>
        <Campo rotulo="Data do saldo"><Input type="date" value={f.data} onChange={e => setF({ ...f, data: e.target.value })} /></Campo>
        <div className="flex items-end"><Button variant="outline" onClick={() => add.mutate()} disabled={add.isPending}><Plus />Adicionar conta</Button></div>
      </Grade>
      <Button onClick={onProximo} disabled={!contas.data?.length}>Continuar</Button>
    </div>
  )
}
export const TIPOS_CONTA = [{ value: 'corrente', label: 'Conta corrente' }, { value: 'poupanca', label: 'Poupança' }, { value: 'caixa', label: 'Caixa físico' },
  { value: 'investimento', label: 'Investimento' }, { value: 'carteira_digital', label: 'Carteira digital' }]

const CANAIS_SUGERIDOS = [
  { nome: 'Loja física', tipo: 'loja_fisica' }, { nome: 'Site', tipo: 'site' }, { nome: 'WhatsApp', tipo: 'whatsapp' },
  { nome: 'Instagram', tipo: 'instagram' }, { nome: 'Marketplace', tipo: 'marketplace' },
]

function PassoCanais({ orgId, onProximo }: { orgId: string; onProximo: () => void }) {
  const [sel, setSel] = useState(new Set(['Loja física']))
  const [tx, setTx] = useState({ credito: 3.5, credito_prazo: 30, debito: 1.5, debito_prazo: 1, pix: 0, conta: '' })
  const contas = useQuery({ queryKey: ['contas-onb', orgId], queryFn: async () => unwrap(await supabase.from('contas_bancarias').select('*').eq('organizacao_id', orgId).order('created_at')) as any[] })
  const m = useMutation({
    mutationFn: async () => {
      const conta = tx.conta || contas.data?.[0]?.id || null
      if (sel.size) unwrap(await supabase.from('canais_venda').upsert([...sel].map(n => ({ organizacao_id: orgId, nome: n,
        tipo: CANAIS_SUGERIDOS.find(c => c.nome === n)!.tipo })), { onConflict: 'organizacao_id,nome' }))
      const formas = unwrap(await supabase.from('formas_pagamento').select('id, tipo').eq('organizacao_id', orgId)) as any[]
      const f = (t: string) => formas.find(x => x.tipo === t)?.id
      const linhas = [
        { forma_pagamento_id: f('credito'), parcelas_min: 1, parcelas_max: 12, taxa_percentual: tx.credito, prazo_dias: tx.credito_prazo },
        { forma_pagamento_id: f('debito'), parcelas_min: 1, parcelas_max: 1, taxa_percentual: tx.debito, prazo_dias: tx.debito_prazo },
        { forma_pagamento_id: f('pix'), parcelas_min: 1, parcelas_max: 1, taxa_percentual: tx.pix, prazo_dias: 0 },
        { forma_pagamento_id: f('dinheiro'), parcelas_min: 1, parcelas_max: 1, taxa_percentual: 0, prazo_dias: 0 },
      ].filter(l => l.forma_pagamento_id).map(l => ({ ...l, organizacao_id: orgId, conta_bancaria_id: conta }))
      unwrap(await supabase.from('canal_taxas').insert(linhas))
    },
    onSuccess: onProximo, onError: (e: Error) => toast.error(e.message),
  })
  return (
    <div className="space-y-5">
      <h2 className="text-lg font-semibold">Canais de venda e taxas</h2>
      <div className="flex flex-wrap gap-3">
        {CANAIS_SUGERIDOS.map(c => (
          <label key={c.nome} className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">
            <Checkbox checked={sel.has(c.nome)} onCheckedChange={(v) => { const s = new Set(sel); if (v) s.add(c.nome); else s.delete(c.nome); setSel(s) }} />{c.nome}
          </label>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">Taxas padrão (valem para todos os canais; ajuste por canal, adquirente e parcelamento em <b>Cadastros → Canais e taxas</b>):</p>
      <Grade cols={3}>
        <Campo rotulo="Crédito — taxa (%)"><Input type="number" step="0.01" value={tx.credito} onChange={e => setTx({ ...tx, credito: Number(e.target.value) })} /></Campo>
        <Campo rotulo="Crédito — prazo 1ª parcela (dias)"><Input type="number" value={tx.credito_prazo} onChange={e => setTx({ ...tx, credito_prazo: Number(e.target.value) })} /></Campo>
        <Campo rotulo="Conta de recebimento">
          <Seletor value={tx.conta} onChange={e => setTx({ ...tx, conta: e.target.value })} opcoes={(contas.data ?? []).map(c => ({ value: c.id, label: c.nome }))} vazio="Primeira conta" />
        </Campo>
        <Campo rotulo="Débito — taxa (%)"><Input type="number" step="0.01" value={tx.debito} onChange={e => setTx({ ...tx, debito: Number(e.target.value) })} /></Campo>
        <Campo rotulo="Débito — prazo (dias)"><Input type="number" value={tx.debito_prazo} onChange={e => setTx({ ...tx, debito_prazo: Number(e.target.value) })} /></Campo>
        <Campo rotulo="PIX — taxa (%)"><Input type="number" step="0.01" value={tx.pix} onChange={e => setTx({ ...tx, pix: Number(e.target.value) })} /></Campo>
      </Grade>
      <Button onClick={() => m.mutate()} disabled={m.isPending}>{m.isPending && <Spinner />}Salvar e continuar</Button>
    </div>
  )
}

function PassoBling({ orgId, onProximo }: { orgId: string; onProximo: () => void }) {
  const [erro, setErro] = useState<string | null>(null)
  const conectar = useMutation({
    mutationFn: async () => {
      const emp = unwrap(await supabase.from('empresas').select('id').eq('organizacao_id', orgId).limit(1)) as any[]
      await supabase.from('organizacoes').update({ onboarding_concluido: true }).eq('id', orgId)
      const r = await edge<{ url: string }>('bling-oauth', { empresa_id: emp[0].id })
      window.location.href = r.url
    },
    onError: (e: Error) => setErro(e.message),
  })
  return (
    <div className="space-y-4">
      <h2 className="text-lg font-semibold">Conectar o Bling (opcional)</h2>
      <p className="text-sm text-muted-foreground">Importe automaticamente pedidos de venda, produtos com custo, clientes, formas de pagamento e contas a pagar/receber pela API oficial do Bling (v3). A conexão usa OAuth: você autoriza no próprio Bling. <a href="/ajuda/bling" target="_blank" rel="noopener" className="text-primary hover:underline">Como funciona</a></p>
      {erro && <Erro erro={erro} />}
      <div className="flex gap-2">
        <Button onClick={() => conectar.mutate()} disabled={conectar.isPending}>{conectar.isPending && <Spinner />}<Link2 />Conectar Bling</Button>
        <Button variant="outline" onClick={onProximo}>Pular por enquanto</Button>
      </div>
    </div>
  )
}
