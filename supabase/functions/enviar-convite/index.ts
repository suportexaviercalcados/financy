// Envia o e-mail de convite. O convite (linha em `convites`) é criado pelo app com RLS (somente admin).
// Usuário novo: recebe e-mail de cadastro do Supabase Auth com link para /convite/<token>.
// Usuário existente: o convite aparece ao entrar no sistema (fn_meus_convites).
import { corsHeaders, env, json, log, serviceClient, usuarioAutenticado } from '../_shared/util.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const auth = await usuarioAutenticado(req)
  if (!auth) return json({ erro: 'Não autenticado' }, 401)
  const { convite_id } = await req.json().catch(() => ({}))
  // leitura com o JWT do usuário: só administradores enxergam convites (RLS)
  const { data: c } = await auth.client.from('convites').select('id, email, token, aceito_em').eq('id', convite_id).maybeSingle()
  if (!c || c.aceito_em) return json({ erro: 'Convite não encontrado' }, 404)
  const svc = serviceClient()
  const { error } = await svc.auth.admin.inviteUserByEmail(c.email, { redirectTo: `${env('APP_URL')}/convite/${c.token}` })
  if (error) {
    if (/already|registered|exists/i.test(error.message)) return json({ enviado: false, usuario_existente: true })
    log('erro', 'convite', { erro: error.message })
    return json({ erro: error.message }, 400)
  }
  return json({ enviado: true })
})
