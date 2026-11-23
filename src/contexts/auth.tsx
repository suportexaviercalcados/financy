import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'

const Ctx = createContext<{ session: Session | null; user: User | null; carregando: boolean; sair: () => Promise<void> }>({
  session: null, user: null, carregando: true, sair: async () => {},
})

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [carregando, setCarregando] = useState(true)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setCarregando(false) })
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])
  const sair = async () => { await supabase.auth.signOut(); localStorage.removeItem('financy.org') }
  return <Ctx.Provider value={{ session, user: session?.user ?? null, carregando, sair }}>{children}</Ctx.Provider>
}

export const useAuth = () => useContext(Ctx)
