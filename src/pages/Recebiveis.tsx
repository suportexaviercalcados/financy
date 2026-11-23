// Recebíveis de cartão/gateway: títulos a receber com adquirente ou taxa
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Wallet } from 'lucide-react'
import { supabase, unwrap } from '@/lib/supabase'
import { useOrg } from '@/contexts/org'
import { useAdquirentes, opcoes } from '@/hooks/lookups'
import { brl, data, hoje } from '@/lib/format'
import { DataTable, type Coluna } from '@/components/DataTable'
import { Kpi, PageHeader, Status } from '@/components/common'
import { Seletor } from '@/components/form'
import { Button } from '@/components/ui/button'
import { BaixaDialog, statusTitulo, type Titulo } from './Contas'

export default function Recebiveis() {
  const { org, empresaIds, podeEscrever } = useOrg()
  const adq = useAdquirentes()
  const [filtroAdq, setFiltroAdq] = useState(''); const [situacao, setSituacao] = useState('abertos')
  const [baixa, setBaixa] = useState<Titulo | null>(null)
  const q = useQuery({
    queryKey: ['titulos', 'recebiveis', org?.id, empresaIds, filtroAdq, situacao], enabled: !!org,
    queryFn: async () => {
      let x = supabase.from('titulos').select('*, adquirentes(nome), contas_bancarias!titulos_conta_bancaria_prevista_id_organizacao_id_fkey(nome)')
        .eq('organizacao_id', org!.id).eq('tipo', 'receber').not('valor_taxa', 'is', null).order('data_vencimento').limit(3000)
      if (empresaIds) x = x.in('empresa_id', empresaIds)
      if (filtroAdq) x = x.eq('adquirente_id', filtroAdq)
      if (situacao === 'abertos') x = x.in('status', ['aberto', 'parcial'])
      if (situacao === 'recebidos') x = x.eq('status', 'pago')
      return unwrap(await x) as any[]
    },
  })
  const l = q.data ?? []
  const s = (f: (t: any) => boolean, k = 'valor') => l.filter(f).reduce((a, t) => a + Number(t[k] ?? 0), 0)
  const colunas: Coluna<any>[] = [
    { id: 'v', titulo: 'Previsão', celula: t => data(t.data_vencimento), valor: t => t.data_vencimento },
    { id: 'd', titulo: 'Descrição', celula: t => t.descricao, valor: t => t.descricao },
    { id: 'a', titulo: 'Adquirente', celula: t => t.adquirentes?.nome ?? '—', valor: t => t.adquirentes?.nome },
    { id: 'c', titulo: 'Conta', celula: t => t.contas_bancarias?.nome ?? '—', valor: t => t.contas_bancarias?.nome },
    { id: 'b', titulo: 'Bruto', alinhar: 'right', celula: t => brl(t.valor_bruto), valor: t => Number(t.valor_bruto), rodape: brl(s(() => true, 'valor_bruto')) },
    { id: 't', titulo: 'Taxa', alinhar: 'right', celula: t => brl(t.valor_taxa), valor: t => Number(t.valor_taxa), rodape: brl(s(() => true, 'valor_taxa')) },
    { id: 'l', titulo: 'Líquido', alinhar: 'right', celula: t => <b>{brl(t.valor)}</b>, valor: t => Number(t.valor), rodape: brl(s(() => true)) },
    { id: 's', titulo: 'Status', celula: t => <Status s={statusTitulo(t)} />, valor: t => statusTitulo(t) },
    { id: 'ac', titulo: '', alinhar: 'right', celula: t => podeEscrever && ['aberto', 'parcial'].includes(t.status) ? <Button size="sm" variant="outline" onClick={(e) => { e.stopPropagation(); setBaixa(t) }}><Wallet />Receber</Button> : null },
  ]
  return (
    <div className="space-y-6">
      <PageHeader titulo="Recebíveis de cartão e gateways" descricao="Gerados automaticamente a partir das vendas, com data prevista, taxa descontada e valor líquido por adquirente." />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi titulo="A receber (líquido)" valor={brl(s(t => ['aberto', 'parcial'].includes(t.status), 'valor') - s(t => ['aberto', 'parcial'].includes(t.status), 'valor_pago'))} />
        <Kpi titulo="Próximos 7 dias" valor={brl(s(t => ['aberto', 'parcial'].includes(t.status) && t.data_vencimento >= hoje() && t.data_vencimento <= addD(7)))} />
        <Kpi titulo="Próximos 30 dias" valor={brl(s(t => ['aberto', 'parcial'].includes(t.status) && t.data_vencimento >= hoje() && t.data_vencimento <= addD(30)))} />
        <Kpi titulo="Atrasados (não repassados)" valor={brl(s(t => ['aberto', 'parcial'].includes(t.status) && t.data_vencimento < hoje()))} />
      </div>
      <DataTable colunas={colunas} linhas={l} carregando={q.isLoading} exportar={{ nome: 'recebiveis', titulo: 'Recebíveis de cartão' }}
        barra={<>
          <Seletor aria-label="Adquirente" className="w-auto" value={filtroAdq} onChange={e => setFiltroAdq(e.target.value)} vazio="Todos os adquirentes" opcoes={opcoes(adq.data)} />
          <Seletor aria-label="Situação" className="w-auto" value={situacao} onChange={e => setSituacao(e.target.value)} opcoes={[{ value: 'abertos', label: 'A receber' }, { value: 'recebidos', label: 'Recebidos' }, { value: 'todos', label: 'Todos' }]} />
        </>} />
      {baixa && <BaixaDialog titulo={baixa} onFechar={() => setBaixa(null)} />}
    </div>
  )
}
const addD = (n: number) => { const d = new Date(hoje() + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
