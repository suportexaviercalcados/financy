import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { FileSpreadsheet } from 'lucide-react'
import { toast } from 'sonner'
import { supabase, rpc } from '@/lib/supabase'
import { useAuth } from '@/contexts/auth'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Campo } from '@/components/form'
import { Erro, Spinner } from '@/components/common'
import { useQueryClient } from '@tanstack/react-query'

function Moldura({ titulo, sub, children, rodape }: { titulo: string; sub?: string; children: ReactNode; rodape?: ReactNode }) {
  return (
    <div className="grid min-h-svh lg:grid-cols-2">
      <div className="flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2">
            <div className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground"><FileSpreadsheet className="size-4" /></div>
            <span className="text-lg font-semibold">Financy</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{titulo}</h1>
          {sub && <p className="mt-1 mb-6 text-sm text-muted-foreground">{sub}</p>}
          {children}
          {rodape && <div className="mt-6 text-sm text-muted-foreground">{rodape}</div>}
        </div>
      </div>
      <div className="hidden flex-col justify-end bg-gradient-to-br from-primary/90 to-primary p-12 text-primary-foreground lg:flex">
        <p className="text-3xl leading-tight font-semibold">Caixa, contas e vendas por canal.<br />DRE e DFC a partir dos seus lançamentos reais.</p>
        <p className="mt-4 max-w-md text-sm opacity-80">Gestão financeira para o varejo: conciliação bancária, recebíveis de cartão, integração com o Bling e uma IA que só responde com os seus números.</p>
      </div>
    </div>
  )
}

export function Login() {
  const nav = useNavigate()
  const [sp] = useSearchParams()
  const [email, setEmail] = useState(''); const [senha, setSenha] = useState('')
  const [erro, setErro] = useState<string | null>(null); const [carregando, setCarregando] = useState(false)
  const enviar = async (e: FormEvent) => {
    e.preventDefault(); setErro(null); setCarregando(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password: senha })
    setCarregando(false)
    if (error) return setErro(error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos.' : error.message)
    nav(sp.get('voltar') || '/')
  }
  return (
    <Moldura titulo="Entrar" sub="Acesse a gestão financeira da sua empresa."
      rodape={<>Ainda não tem conta? <Link className="text-primary underline" to="/cadastro">Criar conta</Link></>}>
      <form onSubmit={enviar} className="space-y-4">
        <Campo rotulo="E-mail"><Input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} /></Campo>
        <Campo rotulo="Senha"><Input type="password" autoComplete="current-password" required value={senha} onChange={e => setSenha(e.target.value)} /></Campo>
        {erro && <Erro erro={erro} />}
        <Button type="submit" className="w-full" disabled={carregando}>{carregando && <Spinner />}Entrar</Button>
        <Link to="/recuperar" className="block text-center text-sm text-muted-foreground hover:underline">Esqueci minha senha</Link>
      </form>
    </Moldura>
  )
}

export function Cadastro() {
  const nav = useNavigate()
  const [f, setF] = useState({ nome: '', email: '', senha: '', confirma: '' })
  const [erro, setErro] = useState<string | null>(null); const [carregando, setCarregando] = useState(false)
  const enviar = async (e: FormEvent) => {
    e.preventDefault(); setErro(null)
    if (f.senha.length < 8) return setErro('A senha deve ter ao menos 8 caracteres.')
    if (f.senha !== f.confirma) return setErro('As senhas não conferem.')
    setCarregando(true)
    const { data, error } = await supabase.auth.signUp({ email: f.email, password: f.senha,
      options: { data: { nome: f.nome }, emailRedirectTo: `${location.origin}/onboarding` } })
    setCarregando(false)
    if (error) return setErro(error.message)
    if (!data.session) { toast.success('Enviamos um e-mail de confirmação. Confirme para continuar.'); return nav('/login') }
    nav('/onboarding')
  }
  return (
    <Moldura titulo="Criar conta" sub="Comece configurando sua organização em poucos minutos."
      rodape={<>Já tem conta? <Link className="text-primary underline" to="/login">Entrar</Link></>}>
      <form onSubmit={enviar} className="space-y-4">
        <Campo rotulo="Seu nome"><Input required value={f.nome} onChange={e => setF({ ...f, nome: e.target.value })} /></Campo>
        <Campo rotulo="E-mail"><Input type="email" required value={f.email} onChange={e => setF({ ...f, email: e.target.value })} /></Campo>
        <Campo rotulo="Senha" ajuda="Mínimo de 8 caracteres"><Input type="password" required value={f.senha} onChange={e => setF({ ...f, senha: e.target.value })} /></Campo>
        <Campo rotulo="Confirmar senha"><Input type="password" required value={f.confirma} onChange={e => setF({ ...f, confirma: e.target.value })} /></Campo>
        {erro && <Erro erro={erro} />}
        <Button type="submit" className="w-full" disabled={carregando}>{carregando && <Spinner />}Criar conta</Button>
      </form>
    </Moldura>
  )
}

export function Recuperar() {
  const [email, setEmail] = useState(''); const [ok, setOk] = useState(false); const [erro, setErro] = useState<string | null>(null)
  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/nova-senha` })
    if (error) setErro(error.message); else setOk(true)
  }
  return (
    <Moldura titulo="Recuperar senha" sub="Enviaremos um link para redefinir sua senha." rodape={<Link className="text-primary underline" to="/login">Voltar ao login</Link>}>
      {ok ? <p className="text-sm">Se o e-mail estiver cadastrado, você receberá o link em instantes.</p> : (
        <form onSubmit={enviar} className="space-y-4">
          <Campo rotulo="E-mail"><Input type="email" required value={email} onChange={e => setEmail(e.target.value)} /></Campo>
          {erro && <Erro erro={erro} />}
          <Button type="submit" className="w-full">Enviar link</Button>
        </form>
      )}
    </Moldura>
  )
}

export function NovaSenha() {
  const nav = useNavigate(); const [senha, setSenha] = useState(''); const [erro, setErro] = useState<string | null>(null)
  const enviar = async (e: FormEvent) => {
    e.preventDefault()
    if (senha.length < 8) return setErro('A senha deve ter ao menos 8 caracteres.')
    const { error } = await supabase.auth.updateUser({ password: senha })
    if (error) return setErro(error.message)
    toast.success('Senha alterada.'); nav('/')
  }
  return (
    <Moldura titulo="Definir nova senha">
      <form onSubmit={enviar} className="space-y-4">
        <Campo rotulo="Nova senha"><Input type="password" required value={senha} onChange={e => setSenha(e.target.value)} /></Campo>
        {erro && <Erro erro={erro} />}
        <Button type="submit" className="w-full">Salvar</Button>
      </form>
    </Moldura>
  )
}

/** Aceite de convite: /convite/:token (usuário precisa estar logado com o e-mail convidado) */
export function AceitarConvite() {
  const { token } = useParams(); const { user, carregando } = useAuth(); const nav = useNavigate(); const qc = useQueryClient()
  const [erro, setErro] = useState<string | null>(null)
  useEffect(() => {
    if (carregando) return
    if (!user) { nav(`/login?voltar=/convite/${token}`); return }
    rpc<string>('fn_aceitar_convite', { p_token: token })
      .then(async (org) => { localStorage.setItem('financy.org', JSON.stringify(org)); await qc.invalidateQueries({ queryKey: ['orgs'] }); toast.success('Convite aceito!'); nav('/') })
      .catch(e => setErro(e.message))
  }, [user, carregando, token, nav, qc])
  return (
    <Moldura titulo="Convite">
      {erro ? <><Erro erro={erro} /><p className="mt-4 text-sm">Se você criou a conta pelo link do e-mail, defina uma senha em <Link className="text-primary underline" to="/nova-senha">Definir senha</Link>.</p></> : <Spinner />}
    </Moldura>
  )
}
