// Organização ativa, papel do usuário, empresas e filtros globais (empresa + período)
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, unwrap } from '@/lib/supabase'
import { useAuth } from './auth'
import { fimMes, hoje, inicioMes } from '@/lib/format'

export type Papel = 'proprietario' | 'administrador' | 'financeiro' | 'visualizador' | 'vendedor'
export interface Organizacao { id: string; nome: string; plano_id: string; onboarding_concluido: boolean; rateio_modo: string; papel: Papel }
export interface Empresa { id: string; razao_social: string; nome_fantasia: string | null; cnpj: string | null; regime_tributario: string;
  aliquota_imposto_vendas: number; imposto_vendas_modo: string; ativo: boolean }
export interface Periodo { inicio: string; fim: string }

interface Valor {
  orgs: Organizacao[]; org: Organizacao | null; carregando: boolean
  trocarOrg: (id: string) => void
  empresas: Empresa[]; empresaId: string | null; setEmpresaId: (id: string | null) => void
  /** null = consolidado (todas as empresas) */
  empresaIds: string[] | null
  periodo: Periodo; setPeriodo: (p: Periodo) => void
  podeEscrever: boolean; podeAdministrar: boolean; ehProprietario: boolean; ehAdminPlataforma: boolean
  /** papel restrito: só acessa a área de metas (/vendedores) */
  ehVendedor: boolean
  recarregar: () => void
}

const Ctx = createContext<Valor>(null as unknown as Valor)
const lerLS = <T,>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d } catch { return d } }
const gravarLS = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* sem storage */ } }

export function OrgProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const [orgId, setOrgId] = useState<string | null>(() => lerLS('financy.org', null))
  const [empresaId, setEmpresaIdState] = useState<string | null>(() => lerLS('financy.empresa', null))
  const [periodo, setPeriodoState] = useState<Periodo>(() => lerLS('financy.periodo', { inicio: inicioMes(hoje()), fim: fimMes(hoje()) }))

  const orgsQ = useQuery({
    queryKey: ['orgs', user?.id], enabled: !!user,
    queryFn: async () => {
      const m = unwrap(await supabase.from('membros').select('papel, organizacoes(id, nome, plano_id, onboarding_concluido, rateio_modo)')
        .eq('user_id', user!.id)) as any[]
      return m.filter(x => x.organizacoes).map(x => ({ ...x.organizacoes, papel: x.papel })) as Organizacao[]
    },
  })
  const adminQ = useQuery({
    queryKey: ['platform-admin', user?.id], enabled: !!user,
    queryFn: async () => ((await supabase.from('platform_admins').select('user_id').eq('user_id', user!.id)).data?.length ?? 0) > 0,
  })
  const orgs = orgsQ.data ?? []
  const org = orgs.find(o => o.id === orgId) ?? orgs[0] ?? null
  useEffect(() => { if (org && org.id !== orgId) { setOrgId(org.id); gravarLS('financy.org', org.id) } }, [org, orgId])

  const empQ = useQuery({
    queryKey: ['empresas', org?.id], enabled: !!org,
    queryFn: async () => unwrap(await supabase.from('empresas').select('*').eq('organizacao_id', org!.id).order('razao_social')) as Empresa[],
  })
  const empresas = empQ.data ?? []
  const empresaValida = empresaId && empresas.some(e => e.id === empresaId) ? empresaId : null

  const valor = useMemo<Valor>(() => ({
    orgs, org, carregando: orgsQ.isLoading || (!!org && empQ.isLoading),
    trocarOrg: (id) => {
      setOrgId(id); gravarLS('financy.org', id); setEmpresaIdState(null); gravarLS('financy.empresa', null)
      supabase.from('profiles').update({ organizacao_ativa_id: id }).eq('user_id', user!.id).then(() => {})
      qc.invalidateQueries()
    },
    empresas, empresaId: empresaValida,
    setEmpresaId: (id) => { setEmpresaIdState(id); gravarLS('financy.empresa', id) },
    empresaIds: empresaValida ? [empresaValida] : null,
    periodo, setPeriodo: (p) => { setPeriodoState(p); gravarLS('financy.periodo', p) },
    podeEscrever: !!org && !['visualizador', 'vendedor'].includes(org.papel),
    ehVendedor: org?.papel === 'vendedor',
    podeAdministrar: !!org && ['proprietario', 'administrador'].includes(org.papel),
    ehProprietario: org?.papel === 'proprietario',
    ehAdminPlataforma: !!adminQ.data,
    recarregar: () => { orgsQ.refetch(); empQ.refetch() },
  }), [orgs, org, orgsQ, empQ, empresas, empresaValida, periodo, adminQ.data, qc, user])

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>
}

export const useOrg = () => useContext(Ctx)

/** Empresa padrão para lançamentos: a selecionada ou a primeira ativa */
export const useEmpresaPadrao = () => {
  const { empresaId, empresas } = useOrg()
  return empresaId ?? empresas.find(e => e.ativo)?.id ?? empresas[0]?.id ?? ''
}
