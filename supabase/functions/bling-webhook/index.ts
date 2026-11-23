// Recebe webhooks do Bling. Autenticidade: header X-Bling-Signature-256 = "sha256=" + HMAC-SHA256(corpo bruto, client secret).
// Responde 2xx rápido (limite do Bling: 5 s) e enfileira o processamento. Eventos repetidos são ignorados (event_id único).
import { corsHeaders, env, hmacSha256Hex, igualSeguro, json, log, serviceClient } from '../_shared/util.ts'

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ erro: 'Método não suportado' }, 405)
  if (!Deno.env.get('BLING_CLIENT_SECRET')) return json({ erro: 'Integração Bling não configurada' }, 503)
  const corpo = await req.text()
  const assinatura = req.headers.get('x-bling-signature-256') ?? ''
  const esperado = 'sha256=' + await hmacSha256Hex(env('BLING_CLIENT_SECRET'), corpo)
  if (!igualSeguro(assinatura, esperado)) {
    log('aviso', 'webhook bling com assinatura inválida')
    return json({ erro: 'Assinatura inválida' }, 401)
  }
  let ev: any
  try { ev = JSON.parse(corpo) } catch { return json({ erro: 'JSON inválido' }, 400) }
  if (!ev?.eventId || !ev?.event) return json({ erro: 'Evento incompleto' }, 400)

  const svc = serviceClient()
  const { data: integ } = await svc.from('integracoes').select('id, organizacao_id, status')
    .eq('provedor', 'bling').eq('external_company_id', String(ev.companyId ?? '')).maybeSingle()
  const { error: dup } = await svc.from('webhook_eventos').insert({
    provedor: 'bling', event_id: String(ev.eventId), company_id: String(ev.companyId ?? ''), evento: ev.event, payload: ev,
    organizacao_id: integ?.organizacao_id ?? null, integracao_id: integ?.id ?? null,
    status: integ && integ.status === 'conectado' ? 'enfileirado' : 'ignorado',
  })
  if (dup) {
    if (dup.code === '23505') return json({ ok: true, duplicado: true })   // reentrega
    log('erro', 'webhook insert', { erro: dup.message }); return json({ erro: 'Falha ao registrar' }, 500)
  }
  if (!integ || integ.status !== 'conectado') return json({ ok: true, ignorado: true })

  const [recurso, acao] = String(ev.event).split('.')
  const id = ev.data?.id
  if (recurso === 'order' && id) {
    await svc.from('sync_jobs').insert({ organizacao_id: integ.organizacao_id, integracao_id: integ.id, tipo: 'webhook',
      recurso: 'venda_unica', parametros: { pedido_id: id, acao } })
  } else if (recurso === 'product') {
    await svc.rpc('fn_agendar_sync', { p_integracao: integ.id, p_tipo: 'webhook', p_recursos: ['produtos'] })
  }
  // aciona o worker em segundo plano sem atrasar a resposta ao Bling
  const disparo = fetch(`${env('SUPABASE_URL')}/functions/v1/bling-sync`, {
    method: 'POST', headers: { 'x-cron-secret': env('CRON_SECRET'), 'Content-Type': 'application/json' }, body: '{}',
  }).catch(() => undefined)
  ;(globalThis as any).EdgeRuntime?.waitUntil?.(disparo)
  return json({ ok: true })
})
