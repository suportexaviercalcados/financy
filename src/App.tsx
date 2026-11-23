import { lazy, Suspense, type ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { useAuth } from '@/contexts/auth'
import { useOrg } from '@/contexts/org'
import { configurado } from '@/lib/supabase'
import { AppLayout } from '@/components/layout/AppLayout'
import { Carregando } from '@/components/common'
import { AceitarConvite, Cadastro, Login, NovaSenha, Recuperar } from '@/pages/auth'
import { Onboarding } from '@/pages/Onboarding'

const Dashboard = lazy(() => import('@/pages/Dashboard'))
const Vendas = lazy(() => import('@/pages/Vendas'))
const VendasCanais = lazy(() => import('@/pages/VendasCanais'))
const Contas = lazy(() => import('@/pages/Contas'))
const Recebiveis = lazy(() => import('@/pages/Recebiveis'))
const Transferencias = lazy(() => import('@/pages/Transferencias'))
const FluxoCaixa = lazy(() => import('@/pages/FluxoCaixa'))
const Conciliacao = lazy(() => import('@/pages/Conciliacao'))
const DRE = lazy(() => import('@/pages/DRE'))
const DFC = lazy(() => import('@/pages/DFC'))
const Metas = lazy(() => import('@/pages/Metas'))
const Emprestimos = lazy(() => import('@/pages/Emprestimos'))
const IA = lazy(() => import('@/pages/IA'))
const Admin = lazy(() => import('@/pages/Admin'))
const Cad = lazy(() => import('@/pages/cadastros'))
const Cfg = lazy(() => import('@/pages/config'))
const AjudaBling = lazy(() => import('@/pages/AjudaBling'))

function Protegido({ children }: { children: ReactNode }) {
  const { user, carregando } = useAuth()
  const { orgs, org, carregando: cOrg } = useOrg()
  const loc = useLocation()
  if (carregando || (user && cOrg)) return <div className="p-8"><Carregando /></div>
  if (!user) return <Navigate to={`/login?voltar=${encodeURIComponent(loc.pathname)}`} replace />
  if (!orgs.length || (org && !org.onboarding_concluido && org.papel === 'proprietario')) return <Navigate to="/onboarding" replace />
  return <>{children}</>
}

function SoLogado({ children }: { children: ReactNode }) {
  const { user, carregando } = useAuth()
  if (carregando) return null
  return user ? <>{children}</> : <Navigate to="/login" replace />
}

export default function App() {
  if (!configurado) {
    return (
      <div className="mx-auto max-w-lg p-10 text-sm">
        <h1 className="mb-2 text-xl font-semibold">Configuração pendente</h1>
        <p>Defina <code>VITE_SUPABASE_URL</code> e <code>VITE_SUPABASE_ANON_KEY</code> (veja <code>.env.example</code> e o README).</p>
      </div>
    )
  }
  return (
    <BrowserRouter>
      <Suspense fallback={<div className="p-8"><Carregando /></div>}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/cadastro" element={<Cadastro />} />
          <Route path="/recuperar" element={<Recuperar />} />
          <Route path="/nova-senha" element={<NovaSenha />} />
          <Route path="/convite/:token" element={<AceitarConvite />} />
          <Route path="/ajuda/bling" element={<AjudaBling />} />
          <Route path="/onboarding" element={<SoLogado><Onboarding /></SoLogado>} />
          <Route element={<Protegido><AppLayout /></Protegido>}>
            <Route index element={<Dashboard />} />
            <Route path="vendas" element={<Vendas />} />
            <Route path="vendas/canais" element={<VendasCanais />} />
            <Route path="contas/:tipo" element={<Contas />} />
            <Route path="recebiveis" element={<Recebiveis />} />
            <Route path="transferencias" element={<Transferencias />} />
            <Route path="fluxo-caixa" element={<FluxoCaixa />} />
            <Route path="conciliacao" element={<Conciliacao />} />
            <Route path="dre" element={<DRE />} />
            <Route path="dfc" element={<DFC />} />
            <Route path="metas" element={<Metas />} />
            <Route path="emprestimos" element={<Emprestimos />} />
            <Route path="ia" element={<IA />} />
            <Route path="cadastros/:pagina" element={<Cad />} />
            <Route path="config/:pagina" element={<Cfg />} />
            <Route path="admin" element={<Admin />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </Suspense>
    </BrowserRouter>
  )
}
