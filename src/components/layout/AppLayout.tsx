import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowLeftRight, Banknote, Bell, BookOpen, Bot, Building2, CalendarClock, ChartColumn, ChevronsLeft, ChevronsRight, CircleDollarSign,
  ClipboardList, CreditCard, FileBarChart, FileSpreadsheet, Gauge, HandCoins, Landmark, LayoutDashboard, Link2, LogOut, Menu, Monitor,
  Moon, Package, PiggyBank, Receipt, Repeat, ScrollText, Settings, Shield, ShoppingBag, Store, Sun, Tags, Target, Users, Wallet, Waypoints, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useOrg } from '@/contexts/org'
import { useAuth } from '@/contexts/auth'
import { useTheme } from '@/contexts/theme'
import { supabase, rpc, unwrap } from '@/lib/supabase'
import { dataHora } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Seletor } from '@/components/form'
import { PeriodoSeletor } from './PeriodoSeletor'

type Item = { to: string; rotulo: string; icone: typeof Gauge; admin?: boolean }
const MENU: { secao: string; itens: Item[] }[] = [
  { secao: 'Visão geral', itens: [{ to: '/', rotulo: 'Dashboard', icone: LayoutDashboard }] },
  { secao: 'Operação', itens: [
    { to: '/vendas', rotulo: 'Vendas', icone: ShoppingBag },
    { to: '/contas/pagar', rotulo: 'Contas a pagar', icone: Receipt },
    { to: '/contas/receber', rotulo: 'Contas a receber', icone: HandCoins },
    { to: '/recebiveis', rotulo: 'Recebíveis de cartão', icone: CreditCard },
    { to: '/transferencias', rotulo: 'Transferências', icone: ArrowLeftRight },
    { to: '/fluxo-caixa', rotulo: 'Fluxo de caixa', icone: Wallet },
    { to: '/conciliacao', rotulo: 'Conciliação bancária', icone: Waypoints },
  ] },
  { secao: 'Relatórios', itens: [
    { to: '/dre', rotulo: 'DRE gerencial', icone: FileBarChart },
    { to: '/dfc', rotulo: 'DFC', icone: ChartColumn },
    { to: '/vendas/canais', rotulo: 'Vendas por canal', icone: Store },
  ] },
  { secao: 'Planejamento', itens: [
    { to: '/metas', rotulo: 'Metas e orçamento', icone: Target },
    { to: '/emprestimos', rotulo: 'Empréstimos', icone: Landmark },
  ] },
  { secao: 'Inteligência', itens: [{ to: '/ia', rotulo: 'Assistente IA', icone: Bot }] },
  { secao: 'Cadastros', itens: [
    { to: '/cadastros/empresas', rotulo: 'Empresas', icone: Building2, admin: true },
    { to: '/cadastros/plano-contas', rotulo: 'Plano de contas', icone: BookOpen },
    { to: '/cadastros/centros-custo', rotulo: 'Centros de custo', icone: Tags },
    { to: '/cadastros/contas-bancarias', rotulo: 'Contas bancárias', icone: PiggyBank },
    { to: '/cadastros/canais', rotulo: 'Canais e taxas', icone: Store },
    { to: '/cadastros/formas-pagamento', rotulo: 'Formas de pagamento', icone: Banknote },
    { to: '/cadastros/adquirentes', rotulo: 'Adquirentes', icone: CreditCard },
    { to: '/cadastros/contatos', rotulo: 'Clientes e fornecedores', icone: Users },
    { to: '/cadastros/produtos', rotulo: 'Produtos e custos', icone: Package },
    { to: '/cadastros/recorrencias', rotulo: 'Recorrências', icone: Repeat },
  ] },
  { secao: 'Configurações', itens: [
    { to: '/config/organizacao', rotulo: 'Organização e plano', icone: Settings },
    { to: '/config/usuarios', rotulo: 'Usuários', icone: Users, admin: true },
    { to: '/config/integracoes', rotulo: 'Integração Bling', icone: Link2 },
    { to: '/config/regras', rotulo: 'Regras de conciliação', icone: ClipboardList },
    { to: '/config/ia', rotulo: 'Configuração da IA', icone: Bot, admin: true },
    { to: '/config/periodos', rotulo: 'Fechamento de períodos', icone: CalendarClock },
    { to: '/config/depreciacoes', rotulo: 'Depreciações', icone: CircleDollarSign },
    { to: '/config/auditoria', rotulo: 'Auditoria e logs', icone: ScrollText, admin: true },
  ] },
]

export function AppLayout() {
  const { org, orgs, trocarOrg, empresas, empresaId, setEmpresaId, podeAdministrar, ehAdminPlataforma } = useOrg()
  const [recolhido, setRecolhido] = useState(() => { try { return localStorage.getItem('financy.menu') === '1' } catch { return false } })
  const [mobile, setMobile] = useState(false)
  const alternar = () => { setRecolhido(r => { try { localStorage.setItem('financy.menu', r ? '0' : '1') } catch { /* */ } return !r }) }

  const nav = (
    <nav className="flex flex-col gap-4 px-2 py-3" aria-label="Menu principal">
      {MENU.map(s => (
        <div key={s.secao}>
          {!recolhido && <p className="mb-1 px-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">{s.secao}</p>}
          <ul className="space-y-0.5">
            {s.itens.filter(i => !i.admin || podeAdministrar).map(i => (
              <li key={i.to}>
                <NavLink to={i.to} end={i.to === '/' || i.to === '/vendas'} onClick={() => setMobile(false)} title={recolhido ? i.rotulo : undefined}
                  className={({ isActive }) => cn('flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground',
                    isActive && 'bg-sidebar-accent font-medium text-sidebar-foreground', recolhido && 'justify-center')}>
                  <i.icone className="size-4 shrink-0" />{!recolhido && <span className="truncate">{i.rotulo}</span>}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
      {ehAdminPlataforma && (
        <NavLink to="/admin" className={({ isActive }) => cn('flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm hover:bg-sidebar-accent', isActive && 'bg-sidebar-accent font-medium', recolhido && 'justify-center')}>
          <Shield className="size-4" />{!recolhido && 'Painel da plataforma'}
        </NavLink>
      )}
    </nav>
  )

  return (
    <div className="flex min-h-svh bg-background">
      <aside className={cn('sticky top-0 hidden h-svh shrink-0 flex-col border-r bg-sidebar transition-[width] md:flex', recolhido ? 'w-16' : 'w-60')}>
        <Marca recolhido={recolhido} />
        <div className="flex-1 overflow-y-auto">{nav}</div>
        <button onClick={alternar} className="flex items-center gap-2 border-t px-4 py-3 text-xs text-muted-foreground hover:text-foreground" aria-label={recolhido ? 'Expandir menu' : 'Recolher menu'}>
          {recolhido ? <ChevronsRight className="size-4" /> : <><ChevronsLeft className="size-4" />Recolher</>}
        </button>
      </aside>
      {mobile && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobile(false)} />
          <aside className="absolute inset-y-0 left-0 flex w-72 flex-col overflow-y-auto bg-sidebar">
            <div className="flex items-center justify-between pr-2"><Marca recolhido={false} /><Button variant="ghost" size="icon" onClick={() => setMobile(false)} aria-label="Fechar menu"><X /></Button></div>
            {nav}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-40 flex flex-wrap items-center gap-2 border-b bg-background/90 px-4 py-2 backdrop-blur md:px-6">
          <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMobile(true)} aria-label="Abrir menu"><Menu /></Button>
          {orgs.length > 1 && (
            <Seletor aria-label="Organização" className="w-auto max-w-48" value={org?.id ?? ''} onChange={e => trocarOrg(e.target.value)}
              opcoes={orgs.map(o => ({ value: o.id, label: o.nome }))} />
          )}
          <Seletor aria-label="Empresa" className="w-auto max-w-56" value={empresaId ?? ''} onChange={e => setEmpresaId(e.target.value || null)}
            opcoes={empresas.map(e => ({ value: e.id, label: e.nome_fantasia || e.razao_social }))} vazio={empresas.length > 1 ? 'Consolidado (todas)' : undefined} />
          <PeriodoSeletor />
          <div className="ml-auto flex items-center gap-1">
            <Alertas />
            <TemaBotao />
            <Usuario />
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 md:px-6"><Outlet /></main>
      </div>
    </div>
  )
}

function Marca({ recolhido }: { recolhido: boolean }) {
  return (
    <div className={cn('flex h-14 items-center gap-2 px-4', recolhido && 'justify-center px-0')}>
      <div className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground"><FileSpreadsheet className="size-4" /></div>
      {!recolhido && <span className="font-semibold tracking-tight">Financy</span>}
    </div>
  )
}

function TemaBotao() {
  const { theme, setTheme } = useTheme()
  const prox = { light: 'dark', dark: 'system', system: 'light' } as const
  const Icone = theme === 'light' ? Sun : theme === 'dark' ? Moon : Monitor
  return <Button variant="ghost" size="icon" onClick={() => setTheme(prox[theme])} aria-label={`Tema: ${theme === 'system' ? 'sistema' : theme === 'dark' ? 'escuro' : 'claro'}`}><Icone /></Button>
}

function Usuario() {
  const { user, sair } = useAuth()
  const navigate = useNavigate()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label="Conta" />}>
        <span className="flex size-7 items-center justify-center rounded-full bg-muted text-xs font-semibold uppercase">{user?.email?.[0]}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="truncate text-xs">{user?.email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => navigate('/onboarding?nova=1')}>Criar outra organização</DropdownMenuItem>
        <DropdownMenuItem onClick={async () => { await sair(); navigate('/login') }}><LogOut />Sair</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function Alertas() {
  const { org, podeEscrever } = useOrg()
  const qc = useQueryClient()
  const q = useQuery({
    queryKey: ['alertas', org?.id], enabled: !!org, refetchInterval: 120_000,
    queryFn: async () => unwrap(await supabase.from('alertas').select('*').eq('organizacao_id', org!.id).eq('lido', false)
      .order('created_at', { ascending: false }).limit(30)) as any[],
  })
  const lido = useMutation({
    mutationFn: async (ids: string[]) => unwrap(await supabase.from('alertas').update({ lido: true }).in('id', ids)),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alertas'] }),
  })
  const gerar = useMutation({
    mutationFn: () => rpc('fn_gerar_alertas', { p_org: org!.id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['alertas'] }),
  })
  const n = q.data?.length ?? 0
  const cor = { critico: 'bg-red-500', aviso: 'bg-amber-500', info: 'bg-sky-500' } as Record<string, string>
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={`Alertas (${n})`} className="relative" />}>
        <Bell />{n > 0 && <span className="absolute top-1 right-1 flex size-4 items-center justify-center rounded-full bg-destructive text-[10px] font-semibold text-white">{n > 9 ? '9+' : n}</span>}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-96 max-w-[calc(100vw-2rem)]">
        <div className="flex items-center justify-between px-2 py-1.5">
          <span className="text-sm font-medium">Alertas</span>
          <div className="flex gap-1">
            {podeEscrever && <Button size="xs" variant="ghost" onClick={() => gerar.mutate()} disabled={gerar.isPending}>Verificar agora</Button>}
            {n > 0 && <Button size="xs" variant="ghost" onClick={() => lido.mutate(q.data!.map(a => a.id))}>Marcar todos como lidos</Button>}
          </div>
        </div>
        <DropdownMenuSeparator />
        <div className="max-h-96 overflow-y-auto">
          {!n && <p className="p-4 text-center text-sm text-muted-foreground">Nenhum alerta pendente.</p>}
          {q.data?.map(a => (
            <div key={a.id} className="flex gap-2 rounded-md p-2 hover:bg-muted/50">
              <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', cor[a.severidade])} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{a.titulo} {a.origem === 'ia' && <span className="ml-1 rounded bg-primary/10 px-1 text-[10px] text-primary">IA</span>}</p>
                <p className="text-xs whitespace-pre-line text-muted-foreground">{a.mensagem}</p>
                <p className="mt-0.5 text-[10px] text-muted-foreground">{dataHora(a.created_at)}</p>
              </div>
              <Button size="xs" variant="ghost" onClick={() => lido.mutate([a.id])}>Lido</Button>
            </div>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
