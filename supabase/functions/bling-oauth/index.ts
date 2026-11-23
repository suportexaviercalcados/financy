// OAuth 2.0 com o Bling (authorization code).
// POST (usuário autenticado, admin): { empresa_id, redirect_to? } -> { url } para autorizar no Bling
// GET  ?code=...&state=... (redirect do Bling) -> devolve ao app (/config/integracoes)
// POST { action: 'callback', code, state } (mesmo usuário que iniciou) -> troca o código, salva tokens criptografados e agenda a sincronização inicial
// POST { action: 'disconnect', integracao_id } -> desconecta (remove tokens)
import { BLING_AUTHORIZE_URL, BlingApi, salvarTokens, trocarCodigo } from '../_shared/bling.ts'
import { corsHeaders, env, json, log, serviceClient, usuarioAutenticado } from '../_shared/util.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const svc = serviceClient()
  const appUrl = env('APP_URL')

  // Redirect do Bling: NÃO troca o código aqui. Devolve ao app, que conclui via POST autenticado
  // (o state só é aceito se pertencer ao mesmo usuário logado que iniciou o fluxo — proteção contra CSRF/vinculação indevida).
  if (req.method === 'GET') {
    const u = new URL(req.url)
    const code = u.searchParams.get('code'); const state = u.searchParams.get('state')
    const destino = new URL(`${appUrl}/config/integracoes`)
    if (code && state) { destino.searchParams.set('bling_code', code); destino.searchParams.set('bling_state', state) }
    else { destino.searchParams.set('bling', 'erro'); destino.searchParams.set('motivo', u.searchParams.get('error') ?? 'parametros') }
    return Response.redirect(destino.toString(), 302)
  }

  if (req.method !== 'POST') return json({ erro: 'Método não suportado' }, 405)
  const auth = await usuarioAutenticado(req)
  if (!auth) return json({ erro: 'Não autenticado' }, 401)
  const body = await req.json().catch(() => ({}))

  if (body.action === 'callback') {
    const { code, state } = body as { code?: string; state?: string }
    if (!code || !state) return json({ erro: 'Parâmetros ausentes' }, 400)
    const { data: st } = await svc.from('oauth_states').select('*').eq('state', state).maybeSingle()
    if (!st || new Date(st.expires_at) < new Date()) return json({ erro: 'Autorização expirada. Clique em Conectar novamente.' }, 400)
    if (st.user_id !== auth.user.id) {
      log('aviso', 'bling callback de outro usuário', { integracao: st.integracao_id })
      return json({ erro: 'Esta autorização foi iniciada por outro usuário.' }, 403)
    }
    await svc.from('oauth_states').delete().eq('state', state)   // uso único
    try {
      // o código expira em 30 s: trocar imediatamente
      const tokens = await trocarCodigo(code)
      await salvarTokens(svc, st.integracao_id, tokens)
      const api = new BlingApi(svc, st.integracao_id)
      const emp = await api.get<{ data: { id: string; nome: string; cnpj: string } }>('/empresas/me/dados-basicos')
      const { data: integ, error } = await svc.from('integracoes').update({
        status: 'conectado', ultimo_erro: null, external_company_id: emp?.data?.id ? String(emp.data.id) : null,
      }).eq('id', st.integracao_id).select('*').single()
      if (error) throw error
      await svc.rpc('fn_agendar_sync', { p_integracao: integ.id, p_tipo: 'inicial' })
      await svc.from('sync_logs').insert({ organizacao_id: integ.organizacao_id, integracao_id: integ.id, nivel: 'info',
        mensagem: `Conta Bling conectada (${emp?.data?.nome ?? 'empresa'}). Sincronização inicial agendada.` })
      log('info', 'bling conectado', { integracao: integ.id })
      return json({ ok: true })
    } catch (e) {
      log('erro', 'bling callback', { erro: String(e), corpo: (e as any)?.corpo })
      await svc.from('integracoes').update({ status: 'erro', ultimo_erro: `Falha ao conectar: ${String(e)}` }).eq('id', st.integracao_id)
      return json({ erro: 'Não foi possível concluir a conexão com o Bling. Tente novamente.' }, 502)
    }
  }

  if (body.action === 'disconnect') {
    // update pelo cliente do usuário: RLS garante que é admin da organização
    const { data, error } = await auth.client.from('integracoes')
      .update({ status: 'desconectado', external_company_id: null }).eq('id', body.integracao_id).select('id').single()
    if (error || !data) return json({ erro: 'Sem permissão ou integração inexistente' }, 403)
    await svc.from('integracao_tokens').delete().eq('integracao_id', data.id)
    return json({ ok: true })
  }

  if (!Deno.env.get('BLING_CLIENT_ID') || !Deno.env.get('BLING_CLIENT_SECRET')) {
    return json({ erro: 'Integração Bling não configurada na plataforma (BLING_CLIENT_ID/BLING_CLIENT_SECRET). Veja docs/BLING.md.' }, 503)
  }
  const { data: emp } = await auth.client.from('empresas').select('id, organizacao_id').eq('id', body.empresa_id).single()
  if (!emp) return json({ erro: 'Empresa não encontrada' }, 404)
  // upsert com o cliente do usuário (RLS exige administrador)
  const { data: integ, error } = await auth.client.from('integracoes').upsert({
    organizacao_id: emp.organizacao_id, empresa_id: emp.id, provedor: 'bling',
    sync_inicio: body.sync_inicio ?? undefined,
  }, { onConflict: 'empresa_id,provedor' }).select('id').single()
  if (error || !integ) return json({ erro: 'Sem permissão para configurar integrações' }, 403)
  const state = crypto.randomUUID() + crypto.randomUUID().replaceAll('-', '')
  await svc.from('oauth_states').insert({ state, integracao_id: integ.id, user_id: auth.user.id })
  const url = `${BLING_AUTHORIZE_URL}?response_type=code&client_id=${encodeURIComponent(env('BLING_CLIENT_ID'))}&state=${state}`
  return json({ url, integracao_id: integ.id })
})
