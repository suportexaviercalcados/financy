// Cria o login de um vendedor (papel 'vendedor': só acessa a área de metas).
// Quem chama precisa ser proprietário/administrador da organização (fn_can_admin com o JWT do chamador).
import { corsHeaders, json, log, serviceClient, usuarioAutenticado } from '../_shared/util.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ erro: 'Método não suportado' }, 405)
  const auth = await usuarioAutenticado(req)
  if (!auth) return json({ erro: 'Não autenticado' }, 401)

  const body = await req.json().catch(() => ({}))
  const org = String(body.organizacao_id ?? '')
  const nome = String(body.nome ?? '').trim()
  const email = String(body.email ?? '').trim().toLowerCase()
  const senha = String(body.senha ?? '')
  if (!org || nome.length < 2 || nome.length > 120) return json({ erro: 'Informe o nome do vendedor.' }, 400)
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ erro: 'E-mail inválido.' }, 400)
  if (senha.length < 8) return json({ erro: 'A senha inicial precisa ter ao menos 8 caracteres.' }, 400)

  const { data: ehAdmin, error: eAdm } = await auth.client.rpc('fn_can_admin', { org })
  if (eAdm || !ehAdmin) return json({ erro: 'Somente proprietário ou administrador pode cadastrar vendedores.' }, 403)

  const svc = serviceClient()
  const { data: criado, error } = await svc.auth.admin.createUser({ email, password: senha, email_confirm: true, user_metadata: { nome } })
  if (error || !criado.user) {
    if (/already|registered|exists/i.test(error?.message ?? '')) return json({ erro: 'Já existe um usuário com este e-mail.' }, 409)
    log('erro', 'criar vendedor', { erro: error?.message })
    return json({ erro: error?.message ?? 'Falha ao criar usuário' }, 400)
  }
  const uid = criado.user.id
  const { error: eMem } = await svc.from('membros').insert({ organizacao_id: org, user_id: uid, papel: 'vendedor' })
  if (eMem) {
    await svc.auth.admin.deleteUser(uid)   // não deixa login órfão
    log('erro', 'membro vendedor', { erro: eMem.message })
    return json({ erro: eMem.message }, 400)
  }
  await svc.from('profiles').upsert({ user_id: uid, nome, email, organizacao_ativa_id: org }, { onConflict: 'user_id' })
  await svc.from('audit_log').insert({ organizacao_id: org, user_id: auth.user.id, tabela: 'membros', registro_id: uid,
    acao: 'criar_vendedor', depois: { email, nome, papel: 'vendedor' } })
  return json({ user_id: uid })
})
