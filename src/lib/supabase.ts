import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const configurado = Boolean(url && anon)

export const supabase = createClient(url || 'http://localhost', anon || 'anon', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
})

/** Executa uma RPC e lança erro legível (mensagem do Postgres) */
export async function rpc<T = unknown>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}

/** Lança erro se a resposta do Supabase tiver erro; devolve os dados tipados */
export function unwrap<T>(r: { data: T | null; error: { message: string } | null }): T {
  if (r.error) throw new Error(r.error.message)
  return r.data as T
}

/** Chama uma Edge Function com o JWT do usuário */
export async function edge<T = any>(nome: string, body: unknown): Promise<T> {
  const { data, error } = await supabase.functions.invoke(nome, { body: body as Record<string, unknown> })
  if (error) {
    let msg = error.message
    try { const ctx = (error as any).context; if (ctx?.json) msg = (await ctx.json()).erro ?? msg } catch { /* corpo não-JSON */ }
    throw new Error(msg)
  }
  return data as T
}
