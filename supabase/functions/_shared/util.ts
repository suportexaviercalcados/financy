// Utilitários compartilhados pelas Edge Functions (Deno)
import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2'

export const env = (k: string, obrigatorio = true): string => {
  const v = Deno.env.get(k)
  if (!v && obrigatorio) throw new Error(`Variável de ambiente ausente: ${k}`)
  return v ?? ''
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

/** Log estruturado (JSON por linha) — visível em Supabase > Edge Functions > Logs */
export const log = (nivel: 'info' | 'aviso' | 'erro', msg: string, extra: Record<string, unknown> = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), nivel, msg, ...extra }))

export const serviceClient = (): SupabaseClient =>
  createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } })

/** Cliente com o JWT do usuário: RLS aplicado normalmente */
export const userClient = (req: Request): SupabaseClient =>
  createClient(env('SUPABASE_URL'), env('SUPABASE_ANON_KEY'), {
    auth: { persistSession: false },
    global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } },
  })

export async function usuarioAutenticado(req: Request) {
  const c = userClient(req)
  const { data, error } = await c.auth.getUser()
  if (error || !data.user) return null
  return { client: c, user: data.user }
}

// ----- Criptografia de tokens (AES-256-GCM, chave em TOKEN_ENCRYPTION_KEY base64 de 32 bytes) -----
const b64 = {
  enc: (b: Uint8Array) => btoa(String.fromCharCode(...b)),
  dec: (s: string) => Uint8Array.from(atob(s), c => c.charCodeAt(0)),
}
let chave: CryptoKey | null = null
async function getChave() {
  if (chave) return chave
  const raw = b64.dec(env('TOKEN_ENCRYPTION_KEY'))
  if (raw.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY deve ter 32 bytes em base64')
  chave = await crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt'])
  return chave
}
export async function encrypt(texto: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await getChave(), new TextEncoder().encode(texto)))
  return `v1:${b64.enc(iv)}:${b64.enc(ct)}`
}
export async function decrypt(payload: string): Promise<string> {
  const [v, iv, ct] = payload.split(':')
  if (v !== 'v1') throw new Error('Formato de token desconhecido')
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.dec(iv) }, await getChave(), b64.dec(ct))
  return new TextDecoder().decode(pt)
}

export async function hmacSha256Hex(secret: string, body: string): Promise<string> {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(body)))
  return Array.from(sig, b => b.toString(16).padStart(2, '0')).join('')
}

/** Comparação em tempo constante */
export function igualSeguro(a: string, b: string) {
  if (a.length !== b.length) return false
  let r = 0
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return r === 0
}

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
