import type { ReactNode } from 'react'
import { AlertTriangle, Inbox, Loader2, TrendingDown, TrendingUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { brl, pct } from '@/lib/format'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'

export function PageHeader({ titulo, descricao, acoes, children }: { titulo: string; descricao?: string; acoes?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">{titulo}</h1>
        {descricao && <p className="mt-1 text-sm text-muted-foreground">{descricao}</p>}
        {children}
      </div>
      {acoes && <div className="flex flex-wrap items-center gap-2">{acoes}</div>}
    </div>
  )
}

export function Vazio({ titulo = 'Nada por aqui ainda', descricao, acao }: { titulo?: string; descricao?: string; acao?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed py-12 text-center">
      <Inbox className="size-8 text-muted-foreground" />
      <p className="font-medium">{titulo}</p>
      {descricao && <p className="max-w-md text-sm text-muted-foreground">{descricao}</p>}
      {acao && <div className="mt-2">{acao}</div>}
    </div>
  )
}

export function Carregando({ linhas = 5 }: { linhas?: number }) {
  return <div className="space-y-2" aria-busy="true" aria-label="Carregando">{Array.from({ length: linhas }, (_, i) => <Skeleton key={i} className="h-9 w-full" />)}</div>
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('size-4 animate-spin', className)} />
}

export function Erro({ erro }: { erro: unknown }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
      <span>{erro instanceof Error ? erro.message : String(erro)}</span>
    </div>
  )
}

export function Aviso({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300', className)}>
      <AlertTriangle className="mt-0.5 size-4 shrink-0" /><div>{children}</div>
    </div>
  )
}

/** Valor monetário com cor por sinal */
export function Dinheiro({ v, cor = true, className }: { v: unknown; cor?: boolean; className?: string }) {
  const n = Number(v)
  return <span className={cn('tabular whitespace-nowrap', cor && n < 0 && 'text-negativo', cor && n > 0 && 'text-foreground', className)}>{brl(v)}</span>
}

export function Variacao({ atual, anterior, inverter = false }: { atual?: number | null; anterior?: number | null; inverter?: boolean }) {
  if (atual == null || anterior == null || Number(anterior) === 0) return <span className="text-xs text-muted-foreground">sem base</span>
  const v = ((Number(atual) - Number(anterior)) / Math.abs(Number(anterior))) * 100
  const bom = inverter ? v < 0 : v > 0
  const Icone = v >= 0 ? TrendingUp : TrendingDown
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium tabular', bom ? 'text-positivo' : 'text-negativo')}>
      <Icone className="size-3" />{pct(v)}
    </span>
  )
}

export function Kpi({ titulo, valor, rodape, onClick, alerta, className }: {
  titulo: string; valor: ReactNode; rodape?: ReactNode; onClick?: () => void; alerta?: string; className?: string
}) {
  const Comp = onClick ? 'button' : 'div'
  return (
    <Card className={cn('gap-1 p-4 text-left transition-colors', onClick && 'cursor-pointer hover:bg-muted/40', className)}>
      <Comp onClick={onClick} className="flex flex-col gap-1 text-left outline-none" type={onClick ? 'button' : undefined}>
        <span className="text-xs font-medium text-muted-foreground">{titulo}</span>
        <span className="text-xl font-semibold tracking-tight tabular">{valor}</span>
        {rodape && <span className="text-xs text-muted-foreground">{rodape}</span>}
        {alerta && <span className="mt-1 flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400"><AlertTriangle className="size-3" />{alerta}</span>}
      </Comp>
    </Card>
  )
}

const CORES_STATUS: Record<string, string> = {
  aberto: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
  vencido: 'bg-red-500/10 text-red-700 dark:text-red-300',
  parcial: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  pago: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  cancelado: 'bg-muted text-muted-foreground line-through',
  concluida: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  cancelada: 'bg-muted text-muted-foreground',
  pendente: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  conciliada: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  ignorada: 'bg-muted text-muted-foreground',
  conectado: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  desconectado: 'bg-muted text-muted-foreground',
  erro: 'bg-red-500/10 text-red-700 dark:text-red-300',
  reautorizar: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
  concluido: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  executando: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
}
const ROTULOS: Record<string, string> = { aberto: 'Em aberto', vencido: 'Vencida', parcial: 'Pago parcial', pago: 'Pago', cancelado: 'Cancelado',
  concluida: 'Concluída', cancelada: 'Cancelada', pendente: 'Pendente', conciliada: 'Conciliada', ignorada: 'Ignorada',
  conectado: 'Conectado', desconectado: 'Desconectado', erro: 'Erro', reautorizar: 'Reautorizar', concluido: 'Concluído', executando: 'Executando' }

export function Status({ s }: { s: string }) {
  return <span className={cn('inline-flex rounded-md px-2 py-0.5 text-xs font-medium whitespace-nowrap', CORES_STATUS[s] ?? 'bg-muted')}>{ROTULOS[s] ?? s}</span>
}

export function Confirmar({ aberto, titulo, descricao, onConfirmar, onFechar, perigo, carregando, textoBotao = 'Confirmar', children }: {
  aberto: boolean; titulo: string; descricao?: string; onConfirmar: () => void; onFechar: () => void; perigo?: boolean; carregando?: boolean;
  textoBotao?: string; children?: ReactNode
}) {
  return (
    <Dialog open={aberto} onOpenChange={(o) => !o && onFechar()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{titulo}</DialogTitle>{descricao && <DialogDescription>{descricao}</DialogDescription>}</DialogHeader>
        {children}
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>Cancelar</Button>
          <Button variant={perigo ? 'destructive' : 'default'} onClick={onConfirmar} disabled={carregando}>{carregando && <Spinner />}{textoBotao}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
