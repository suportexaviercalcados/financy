import { useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown, FileSpreadsheet, FileText, Search } from 'lucide-react'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Carregando, Vazio } from './common'
import { cn } from '@/lib/utils'

export interface Coluna<T> {
  id: string
  titulo: string
  celula: (l: T) => ReactNode
  /** valor usado para ordenar/buscar/exportar */
  valor?: (l: T) => string | number | null | undefined
  alinhar?: 'left' | 'right' | 'center'
  className?: string
  rodape?: ReactNode
}

export function DataTable<T extends { id?: string }>({ colunas, linhas, carregando, busca = true, exportar, vazio, onLinha,
  selecao, onSelecao, acoesSelecao, ordemInicial, chave = (l: any) => l.id, destaque, compacta, barra }: {
  colunas: Coluna<T>[]; linhas: T[] | undefined; carregando?: boolean; busca?: boolean
  exportar?: { nome: string; titulo: string; subtitulo?: string }
  vazio?: ReactNode; onLinha?: (l: T) => void
  selecao?: Set<string>; onSelecao?: (s: Set<string>) => void; acoesSelecao?: ReactNode
  ordemInicial?: { id: string; desc?: boolean }; chave?: (l: T) => string; destaque?: (l: T) => boolean
  compacta?: boolean; barra?: ReactNode
}) {
  const [q, setQ] = useState('')
  const [ordem, setOrdem] = useState<{ id: string; desc?: boolean } | undefined>(ordemInicial)
  const dados = useMemo(() => {
    let r = linhas ?? []
    if (q.trim()) {
      const t = q.trim().toLowerCase()
      r = r.filter(l => colunas.some(c => String(c.valor?.(l) ?? '').toLowerCase().includes(t)))
    }
    const col = colunas.find(c => c.id === ordem?.id)
    if (col?.valor) {
      r = [...r].sort((a, b) => {
        const x = col.valor!(a), y = col.valor!(b)
        const cmp = typeof x === 'number' && typeof y === 'number' ? x - y : String(x ?? '').localeCompare(String(y ?? ''), 'pt-BR', { numeric: true })
        return ordem?.desc ? -cmp : cmp
      })
    }
    return r
  }, [linhas, q, ordem, colunas])

  const colsExport = colunas.filter(c => c.valor).map(c => ({ titulo: c.titulo, valor: c.valor! }))
  const todosSel = selecao && dados.length > 0 && dados.every(l => selecao.has(chave(l)))
  const temRodape = colunas.some(c => c.rodape !== undefined)

  return (
    <div className="space-y-3">
      {(busca || exportar || barra || (selecao && selecao.size > 0)) && (
        <div className="flex flex-wrap items-center gap-2">
          {busca && (
            <div className="relative w-full sm:w-64">
              <Search className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Buscar…" value={q} onChange={e => setQ(e.target.value)} className="pl-8" aria-label="Buscar na tabela" />
            </div>
          )}
          {barra}
          {selecao && selecao.size > 0 && <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">{selecao.size} selecionado(s)</span>{acoesSelecao}</div>}
          {exportar && (
            <div className="ml-auto flex gap-1">
              <Button variant="outline" size="sm" onClick={() => import('@/lib/export').then(m => m.exportarExcel(exportar.nome, colsExport, dados))} disabled={!dados.length}><FileSpreadsheet />Excel</Button>
              <Button variant="outline" size="sm" onClick={() => import('@/lib/export').then(m => m.exportarPDF(exportar.nome, exportar.titulo, exportar.subtitulo ?? '', colsExport, dados, destaque))} disabled={!dados.length}><FileText />PDF</Button>
            </div>
          )}
        </div>
      )}
      {carregando ? <Carregando /> : !dados.length ? (vazio ?? <Vazio />) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                {selecao && <TableHead className="w-8"><Checkbox checked={!!todosSel} onCheckedChange={(v) => onSelecao?.(new Set(v ? dados.map(chave) : []))} aria-label="Selecionar todos" /></TableHead>}
                {colunas.map(c => (
                  <TableHead key={c.id} className={cn(c.alinhar === 'right' && 'text-right', c.alinhar === 'center' && 'text-center', c.className)}>
                    {c.valor ? (
                      <button type="button" className={cn('inline-flex items-center gap-1 hover:text-foreground', c.alinhar === 'right' && 'flex-row-reverse')}
                        onClick={() => setOrdem(o => ({ id: c.id, desc: o?.id === c.id ? !o.desc : false }))}>
                        {c.titulo}
                        {ordem?.id === c.id ? (ordem.desc ? <ArrowDown className="size-3" /> : <ArrowUp className="size-3" />) : <ArrowUpDown className="size-3 opacity-40" />}
                      </button>
                    ) : c.titulo}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {dados.map((l, i) => {
                const k = chave(l) ?? String(i)
                return (
                  <TableRow key={k} onClick={onLinha ? () => onLinha(l) : undefined}
                    className={cn(onLinha && 'cursor-pointer', destaque?.(l) && 'bg-muted/50 font-semibold', compacta && '[&>td]:py-1.5')}>
                    {selecao && (
                      <TableCell onClick={e => e.stopPropagation()}>
                        <Checkbox checked={selecao.has(k)} aria-label="Selecionar linha" onCheckedChange={(v) => {
                          const s = new Set(selecao); if (v) s.add(k); else s.delete(k); onSelecao?.(s)
                        }} />
                      </TableCell>
                    )}
                    {colunas.map(c => <TableCell key={c.id} className={cn(c.alinhar === 'right' && 'text-right tabular', c.alinhar === 'center' && 'text-center', c.className)}>{c.celula(l)}</TableCell>)}
                  </TableRow>
                )
              })}
            </TableBody>
            {temRodape && (
              <TableFooter>
                <TableRow>
                  {selecao && <TableCell />}
                  {colunas.map(c => <TableCell key={c.id} className={cn(c.alinhar === 'right' && 'text-right tabular', 'font-semibold')}>{c.rodape}</TableCell>)}
                </TableRow>
              </TableFooter>
            )}
          </Table>
        </div>
      )}
    </div>
  )
}
