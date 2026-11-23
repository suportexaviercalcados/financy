import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

type Tema = 'light' | 'dark' | 'system'
const Ctx = createContext<{ theme: Tema; resolved: 'light' | 'dark'; setTheme: (t: Tema) => void }>({
  theme: 'system', resolved: 'light', setTheme: () => {},
})

const ler = (): Tema => { try { return (localStorage.getItem('financy.tema') as Tema) || 'system' } catch { return 'system' } }

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTema] = useState<Tema>(ler)
  const [sistemaEscuro, setSistemaEscuro] = useState(() => window.matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const f = () => setSistemaEscuro(mq.matches)
    mq.addEventListener('change', f); return () => mq.removeEventListener('change', f)
  }, [])
  const resolved = theme === 'system' ? (sistemaEscuro ? 'dark' : 'light') : theme
  useEffect(() => { document.documentElement.classList.toggle('dark', resolved === 'dark') }, [resolved])
  const setTheme = (t: Tema) => { setTema(t); try { localStorage.setItem('financy.tema', t) } catch { /* sem storage */ } }
  return <Ctx.Provider value={{ theme, resolved, setTheme }}>{children}</Ctx.Provider>
}

export const useTheme = () => useContext(Ctx)
