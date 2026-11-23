import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { supabase, rpc, unwrap } from '@/lib/supabase'
import { useEmpresaPadrao, useOrg } from '@/contexts/org'
import { useCanais, useCategorias, opcoes, opcoesCategoria } from '@/hooks/lookups'
import { brl, data, mesAno, pct } from '@/lib/format'
import { CrudPage, type CrudConfig } from '@/components/CrudPage'
import { DataTable, type Coluna } from '@/components/DataTable'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Campo, EntradaValor, Seletor } from '@/components/form'
import { Spinner } from '@/components/common'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'

const primeiroDia = (r: any) => ({ ...r, competencia: r.competencia ? r.competencia.slice(0, 8) + '01' : r.competencia })

export default function Metas() {
  const { org, empresas, empresaIds, periodo, podeAdministrar } = useOrg()
  const canais = useCanais(); const cats = useCategorias()
  const empOpc = empresas.map(e => ({ value: e.id, label: e.nome_fantasia || e.razao_social }))
  const metasCfg: CrudConfig = {
    tabela: 'metas', titulo: 'Metas de faturamento', singular: 'Meta', ordem: 'competencia', ordemDesc: true,
    descricao: 'Meta mensal por empresa (sem canal = meta total) e por canal. O dashboard mostra o percentual atingido.',
    campos: [
      { nome: 'empresa_id', rotulo: 'Empresa', tipo: 'selecao', obrigatorio: true, opcoes: empOpc, padrao: empOpc[0]?.value },
      { nome: 'canal_id', rotulo: 'Canal', tipo: 'selecao', opcoes: opcoes(canais.data), vazio: 'Total da empresa' },
      { nome: 'competencia', rotulo: 'Mês', tipo: 'data', obrigatorio: true, ajuda: 'Qualquer dia do mês; é gravado como dia 1.' },
      { nome: 'valor', rotulo: 'Meta de faturamento bruto', tipo: 'dinheiro', obrigatorio: true },
    ],
    preparar: primeiroDia,
    colunas: [
      { id: 'mes', titulo: 'Mês', celula: r => mesAno(r.competencia), valor: r => r.competencia },
      { id: 'emp', titulo: 'Empresa', celula: r => empOpc.find(e => e.value === r.empresa_id)?.label },
      { id: 'canal', titulo: 'Canal', celula: r => canais.data?.find(c => c.id === r.canal_id)?.nome ?? 'Total', valor: r => canais.data?.find(c => c.id === r.canal_id)?.nome ?? '' },
      { id: 'v', titulo: 'Meta', alinhar: 'right', celula: r => brl(r.valor), valor: r => Number(r.valor) },
    ],
  }
  const orcCfg: CrudConfig = {
    tabela: 'orcamentos', titulo: 'Orçamento por categoria', singular: 'Orçamento', ordem: 'competencia',
    descricao: 'Valores orçados por categoria do plano de contas e mês. Comparados com o realizado na DRE (botão "Realizado × orçado").',
    campos: [
      { nome: 'empresa_id', rotulo: 'Empresa', tipo: 'selecao', obrigatorio: true, opcoes: empOpc, padrao: empOpc[0]?.value },
      { nome: 'categoria_id', rotulo: 'Categoria', tipo: 'selecao', obrigatorio: true, opcoes: opcoesCategoria(cats.data) },
      { nome: 'competencia', rotulo: 'Mês', tipo: 'data', obrigatorio: true },
      { nome: 'valor', rotulo: 'Valor orçado', tipo: 'dinheiro', obrigatorio: true },
    ],
    preparar: primeiroDia,
    colunas: [
      { id: 'mes', titulo: 'Mês', celula: r => mesAno(r.competencia), valor: r => r.competencia },
      { id: 'cat', titulo: 'Categoria', celula: r => { const c = cats.data?.find(x => x.id === r.categoria_id); return c ? `${c.codigo} ${c.nome}` : '—' }, valor: r => cats.data?.find(x => x.id === r.categoria_id)?.codigo },
      { id: 'v', titulo: 'Orçado', alinhar: 'right', celula: r => brl(r.valor), valor: r => Number(r.valor) },
    ],
  }
  const comp = useQuery({ queryKey: ['orc-comp', org?.id, empresaIds, periodo], enabled: !!org,
    queryFn: () => rpc<any[]>('fn_dre_categorias', { p_org: org!.id, p_empresas: empresaIds, p_ini: periodo.inicio, p_fim: periodo.fim, p_gran: 'total' }) })
  const linhasComp = (comp.data ?? []).filter(c => c.orcado != null)
  const colComp: Coluna<any>[] = [
    { id: 'c', titulo: 'Categoria', celula: r => r.categoria, valor: r => r.categoria },
    { id: 'o', titulo: 'Orçado', alinhar: 'right', celula: r => brl(r.orcado), valor: r => Number(r.orcado) },
    { id: 'r', titulo: 'Realizado', alinhar: 'right', celula: r => brl(r.valor), valor: r => Number(r.valor) },
    { id: 'd', titulo: 'Diferença', alinhar: 'right', valor: r => Number(r.valor) - Number(r.orcado), celula: r => {
      const receita = ['receita_bruta', 'receita_financeira'].includes(r.grupo); const dif = Number(r.valor) - Number(r.orcado)
      const ruim = receita ? dif < 0 : dif > 0
      return <span className={cn(ruim ? 'text-negativo' : 'text-positivo')}>{brl(dif)} ({Number(r.orcado) ? pct(100 * dif / Number(r.orcado)) : '—'})</span> } },
  ]
  return (
    <Tabs defaultValue="metas">
      <TabsList><TabsTrigger value="metas">Metas</TabsTrigger><TabsTrigger value="orcamento">Orçamento</TabsTrigger><TabsTrigger value="comparativo">Realizado × orçado</TabsTrigger></TabsList>
      <TabsContent value="metas" className="pt-4"><CrudPage cfg={metasCfg} /></TabsContent>
      <TabsContent value="orcamento" className="space-y-6 pt-4">
        {podeAdministrar && <OrcamentoAnual />}
        <CrudPage cfg={orcCfg} />
      </TabsContent>
      <TabsContent value="comparativo" className="pt-4">
        <p className="mb-3 text-sm text-muted-foreground">Período {data(periodo.inicio)} a {data(periodo.fim)} (competência).</p>
        <DataTable colunas={colComp} linhas={linhasComp} carregando={comp.isLoading} chave={r => r.categoria_id + r.grupo} exportar={{ nome: 'orcado-x-realizado', titulo: 'Realizado × orçado' }} />
      </TabsContent>
    </Tabs>
  )
}

function OrcamentoAnual() {
  const { org } = useOrg(); const emp = useEmpresaPadrao(); const cats = useCategorias(); const qc = useQueryClient()
  const [f, setF] = useState({ categoria: '', ano: new Date().getFullYear(), valor: NaN })
  const m = useMutation({
    mutationFn: async () => {
      if (!f.categoria || !(f.valor >= 0)) throw new Error('Informe categoria e valor mensal.')
      const linhas = Array.from({ length: 12 }, (_, i) => ({ organizacao_id: org!.id, empresa_id: emp, categoria_id: f.categoria,
        competencia: `${f.ano}-${String(i + 1).padStart(2, '0')}-01`, valor: f.valor }))
      unwrap(await supabase.from('orcamentos').upsert(linhas, { onConflict: 'empresa_id,categoria_id,competencia' }))
    },
    onSuccess: () => { toast.success('Orçamento anual gravado (12 meses).'); qc.invalidateQueries({ queryKey: ['orcamentos'] }) },
    onError: (e: Error) => toast.error(e.message),
  })
  return (
    <Card><CardHeader><CardTitle className="text-sm">Orçamento anual rápido</CardTitle></CardHeader>
      <CardContent className="grid gap-3 sm:grid-cols-4">
        <Campo rotulo="Categoria" className="sm:col-span-2"><Seletor value={f.categoria} onChange={e => setF({ ...f, categoria: e.target.value })} vazio="Selecione…" opcoes={opcoesCategoria(cats.data)} /></Campo>
        <Campo rotulo="Ano"><Input type="number" value={f.ano} onChange={e => setF({ ...f, ano: Number(e.target.value) })} /></Campo>
        <Campo rotulo="Valor mensal"><EntradaValor valor={f.valor} onChange={v => setF({ ...f, valor: v })} /></Campo>
        <div className="sm:col-span-4"><Button onClick={() => m.mutate()} disabled={m.isPending}>{m.isPending && <Spinner />}Gravar 12 meses</Button></div>
      </CardContent>
    </Card>
  )
}
