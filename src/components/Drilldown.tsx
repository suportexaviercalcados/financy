// Lista os lançamentos que formam um valor da DRE/dashboard (mesma função SQL da DRE)
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { rpc } from '@/lib/supabase'
import { useOrg } from '@/contexts/org'
import { brl, data, pct } from '@/lib/format'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DataTable, type Coluna } from './DataTable'

const ORIGEM: Record<string, { rotulo: string; link?: string }> = {
  titulo: { rotulo: 'Conta a pagar/receber', link: '/contas/pagar?periodo=todos&status=todas' },
  venda: { rotulo: 'Venda', link: '/vendas' }, devolucao: { rotulo: 'Devolução', link: '/vendas' },
  baixa: { rotulo: 'Encargos de baixa' }, depreciacao: { rotulo: 'Depreciação', link: '/config/depreciacoes' },
}

export function Drilldown({ titulo, grupos, categoria, ini, fim, canal, onFechar }: {
  titulo: string; grupos: string[]; categoria?: string; ini: string; fim: string; canal?: string | null; onFechar: () => void
}) {
  const { org, empresaIds } = useOrg()
  const q = useQuery({ queryKey: ['drill', org?.id, empresaIds, grupos, categoria, ini, fim, canal], enabled: !!org,
    queryFn: () => rpc<any[]>('fn_dre_lancamentos', { p_org: org!.id, p_empresas: empresaIds, p_ini: ini, p_fim: fim, p_grupos: grupos, p_categoria: categoria ?? null, p_canal: canal ?? null }) })
  const total = (q.data ?? []).reduce((s, l) => s + Number(l.valor), 0)
  const colunas: Coluna<any>[] = [
    { id: 'd', titulo: 'Data', celula: l => data(l.data), valor: l => l.data },
    { id: 'x', titulo: 'Descrição', celula: l => l.descricao, valor: l => l.descricao },
    { id: 'c', titulo: 'Categoria', celula: l => l.categoria ?? '—', valor: l => l.categoria },
    { id: 'n', titulo: 'Canal', celula: l => l.canal ?? '—', valor: l => l.canal },
    { id: 'o', titulo: 'Origem', valor: l => ORIGEM[l.origem]?.rotulo ?? l.origem,
      celula: l => ORIGEM[l.origem]?.link ? <Link className="text-primary hover:underline" to={ORIGEM[l.origem].link!} onClick={onFechar}>{ORIGEM[l.origem].rotulo}</Link> : (ORIGEM[l.origem]?.rotulo ?? l.origem) },
    { id: 'p', titulo: 'Rateio', alinhar: 'right', celula: l => Number(l.peso) === 1 ? '—' : pct(100 * Number(l.peso), 1), valor: l => Number(l.peso) },
    { id: 'v', titulo: 'Valor', alinhar: 'right', celula: l => brl(l.valor), valor: l => Number(l.valor), rodape: brl(total) },
  ]
  return (
    <Dialog open onOpenChange={o => !o && onFechar()}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader><DialogTitle>{titulo}</DialogTitle><DialogDescription>{data(ini)} a {data(fim)} · {q.data?.length ?? 0} lançamento(s) · total {brl(total)}</DialogDescription></DialogHeader>
        <div className="max-h-[65vh] overflow-y-auto">
          <DataTable colunas={colunas} linhas={q.data} carregando={q.isLoading} compacta chave={l => `${l.origem}:${l.origem_id}:${l.grupo}:${l.descricao}`}
            exportar={{ nome: 'lancamentos', titulo, subtitulo: `${data(ini)} a ${data(fim)}` }} />
        </div>
      </DialogContent>
    </Dialog>
  )
}
