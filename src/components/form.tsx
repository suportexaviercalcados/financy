import { useEffect, useState, type ReactNode, type SelectHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'
import { Input } from '@/components/ui/input'
import { parseValor } from '@/lib/format'

export function Campo({ rotulo, erro, ajuda, children, className, obrigatorio }: {
  rotulo: string; erro?: string | null; ajuda?: string; children: ReactNode; className?: string; obrigatorio?: boolean
}) {
  // <label> envolvendo o controle: associação implícita rótulo ↔ campo (leitores de tela e clique no rótulo)
  return (
    <label className={cn('flex flex-col gap-1.5', className)}>
      <span className="flex items-center gap-1 text-sm leading-none font-medium select-none">{rotulo}{obrigatorio && <span className="text-destructive">*</span>}</span>
      {children}
      {erro ? <span className="text-xs text-destructive">{erro}</span> : ajuda ? <span className="text-xs text-muted-foreground">{ajuda}</span> : null}
    </label>
  )
}

/** Select nativo estilizado (acessível e confiável em qualquer dispositivo) */
export function Seletor({ className, opcoes, vazio, ...p }: SelectHTMLAttributes<HTMLSelectElement> & {
  opcoes: { value: string; label: string; disabled?: boolean }[]; vazio?: string
}) {
  return (
    <select {...p} className={cn('h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30 [&>option]:bg-popover', className)}>
      {vazio !== undefined && <option value="">{vazio}</option>}
      {opcoes.map(o => <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>)}
    </select>
  )
}

/** Entrada monetária: aceita "1.234,56"; devolve número (NaN se vazio/inválido) */
export function EntradaValor({ valor, onChange, className, ...p }: { valor: number | null | undefined; onChange: (v: number) => void; className?: string; placeholder?: string; disabled?: boolean; id?: string }) {
  const fmt = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(v) ? '' : v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }))
  const [texto, setTexto] = useState(fmt(valor))
  const [foco, setFoco] = useState(false)
  useEffect(() => { if (!foco) setTexto(fmt(valor)) }, [valor, foco])
  return (
    <div className={cn('relative', className)}>
      <span className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-xs text-muted-foreground">R$</span>
      <Input {...p} inputMode="decimal" className="pl-8 text-right tabular" value={texto}
        onFocus={() => setFoco(true)}
        onBlur={() => { setFoco(false); setTexto(fmt(parseValor(texto))) }}
        onChange={(e) => { setTexto(e.target.value); onChange(parseValor(e.target.value)) }} />
    </div>
  )
}

export function Grade({ children, cols = 2, className }: { children: ReactNode; cols?: 1 | 2 | 3 | 4; className?: string }) {
  const c = { 1: '', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-2 lg:grid-cols-3', 4: 'sm:grid-cols-2 lg:grid-cols-4' }[cols]
  return <div className={cn('grid grid-cols-1 gap-4', c, className)}>{children}</div>
}
