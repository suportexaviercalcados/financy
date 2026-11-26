// Cliente da API oficial Bling v3 (https://developer.bling.com.br)
// Endpoints/auth conferidos no OpenAPI oficial: base https://api.bling.com.br/Api/v3,
// OAuth2 authorization code em https://bling.com.br/Api/v3/oauth/{authorize,token},
// credenciais do app via HTTP Basic, limite 3 req/s e 120.000/dia (HTTP 429 ao exceder).
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { decrypt, encrypt, env, log, sleep } from './util.ts'

export const BLING_AUTHORIZE_URL = 'https://bling.com.br/Api/v3/oauth/authorize'
export const BLING_TOKEN_URL = 'https://bling.com.br/Api/v3/oauth/token'
export const BLING_API = 'https://api.bling.com.br/Api/v3'

export interface TokenResposta { access_token: string; refresh_token: string; expires_in: number }

export class BlingErro extends Error {
  constructor(msg: string, public status: number, public corpo?: unknown) { super(msg) }
}

async function postToken(body: Record<string, string>): Promise<TokenResposta> {
  const basic = btoa(`${env('BLING_CLIENT_ID')}:${env('BLING_CLIENT_SECRET')}`)
  const r = await fetch(BLING_TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: '1.0' },
    body: new URLSearchParams(body),
  })
  const corpo = await r.json().catch(() => ({}))
  if (!r.ok) throw new BlingErro(`Falha no token Bling (${r.status})`, r.status, corpo)
  return corpo as TokenResposta
}

export const trocarCodigo = (code: string) => postToken({ grant_type: 'authorization_code', code })
export const renovarToken = (refresh: string) => postToken({ grant_type: 'refresh_token', refresh_token: refresh })

export async function salvarTokens(svc: SupabaseClient, integracaoId: string, t: TokenResposta) {
  const { error } = await svc.from('integracao_tokens').upsert({
    integracao_id: integracaoId,
    access_token_enc: await encrypt(t.access_token),
    refresh_token_enc: await encrypt(t.refresh_token),
    expires_at: new Date(Date.now() + (t.expires_in ?? 21600) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  })
  if (error) throw error
}

/** Cliente por integração: renova token, respeita 3 req/s, faz retry com espera progressiva */
export class BlingApi {
  private ultimo = 0
  private token: string | null = null
  private expira = 0
  public requisicoes = 0

  constructor(private svc: SupabaseClient, private integracaoId: string) {}

  private async accessToken(forcar = false): Promise<string> {
    if (!forcar && this.token && Date.now() < this.expira - 120_000) return this.token
    const { data, error } = await this.svc.from('integracao_tokens').select('*').eq('integracao_id', this.integracaoId).single()
    if (error || !data) throw new BlingErro('Integração sem tokens. Reconecte o Bling.', 401)
    const expira = new Date(data.expires_at).getTime()
    if (!forcar && Date.now() < expira - 120_000) {
      this.token = await decrypt(data.access_token_enc); this.expira = expira
      return this.token
    }
    try {
      const novo = await renovarToken(await decrypt(data.refresh_token_enc))
      await salvarTokens(this.svc, this.integracaoId, novo)
      this.token = novo.access_token; this.expira = Date.now() + novo.expires_in * 1000
      return this.token
    } catch (e) {
      if (e instanceof BlingErro && (e.status === 400 || e.status === 401)) {
        // O refresh token do Bling é de uso único: se outra execução renovou ao mesmo tempo,
        // o nosso falha mas o token novo já está (ou estará em instantes) gravado. Usa ele.
        for (let i = 0; i < 3; i++) {
          const { data: atual } = await this.svc.from('integracao_tokens').select('*').eq('integracao_id', this.integracaoId).single()
          if (atual && atual.updated_at !== data.updated_at) {
            this.token = await decrypt(atual.access_token_enc); this.expira = new Date(atual.expires_at).getTime()
            return this.token
          }
          await sleep(1000)
        }
        await this.svc.from('integracoes').update({ status: 'reautorizar', ultimo_erro: 'Refresh token inválido ou expirado. Reconecte a conta Bling.' }).eq('id', this.integracaoId)
      }
      throw e
    }
  }

  async get<T = any>(path: string, params: Record<string, string | number | undefined | (string | number)[]> = {}): Promise<T> {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === '') continue
      if (Array.isArray(v)) v.forEach(x => qs.append(k, String(x)))
      else qs.set(k, String(v))
    }
    const url = `${BLING_API}${path}${qs.size ? '?' + qs : ''}`
    let tentativa = 0; let renovou = false
    while (true) {
      // limite de 3 req/s por conta: espaçamento mínimo de 350 ms
      const espera = this.ultimo + 350 - Date.now()
      if (espera > 0) await sleep(espera)
      this.ultimo = Date.now(); this.requisicoes++
      const r = await fetch(url, { headers: { Authorization: `Bearer ${await this.accessToken()}`, Accept: 'application/json' } })
      if (r.ok) return await r.json() as T
      const corpo = await r.json().catch(() => null)
      if (r.status === 401 && !renovou) { renovou = true; await this.accessToken(true); continue }
      if ((r.status === 429 || r.status >= 500) && tentativa < 5) {
        const ms = Math.min(30_000, 1000 * 2 ** tentativa) + Math.floor(Math.random() * 300)
        log('aviso', 'Bling retry', { status: r.status, path, tentativa, ms })
        tentativa++; await sleep(ms); continue
      }
      if (r.status === 404) return { data: null } as T
      throw new BlingErro(`Bling ${r.status} em ${path}`, r.status, corpo)
    }
  }

  /** Itera páginas (limite 100). `inicio` permite retomar de uma página salva no cursor do job. */
  async *paginas<T = any>(path: string, params: Record<string, any>, inicio = 1): AsyncGenerator<{ pagina: number; itens: T[] }> {
    for (let pagina = inicio; ; pagina++) {
      const r = await this.get<{ data: T[] }>(path, { ...params, pagina, limite: 100 })
      const itens = r?.data ?? []
      yield { pagina, itens }
      if (itens.length < 100) return
    }
  }
}

// Mapeamento de tipoPagamento (Bling) -> tipo de forma de pagamento do Financy
export function tipoFormaBling(tipoPagamento: number): string {
  switch (tipoPagamento) {
    case 1: return 'dinheiro'
    case 3: case 5: return 'credito'
    case 4: return 'debito'
    case 15: return 'boleto'
    case 16: case 18: return 'transferencia'
    case 17: case 20: return 'pix'
    case 14: return 'crediario'
    default: return 'outro'
  }
}

export const SITUACAO_PEDIDO_CANCELADO = 2   // situacao.valor: 0 aberto, 1 atendido, 2 cancelado, 3 em andamento...
export const SITUACAO_PEDIDO_EM_DIGITACAO = 10
// situacao.valor do pedido de venda (OpenAPI Bling v3)
export const SITUACOES_PEDIDO: Record<number, string> = { 0: 'Em aberto', 1: 'Atendido', 2: 'Cancelado', 3: 'Em andamento',
  5: 'Faturado parcialmente', 6: 'Atendido parcialmente', 7: 'Aguardando pagamento', 8: 'Pagamento confirmado',
  10: 'Em digitação', 11: 'Verificado', 12: 'Checkout parcial' }
export const SITUACOES_IMPORTAR_PADRAO = [1, 11, 8, 3]   // Atendido, Verificado, Pagamento confirmado, Em andamento

/**
 * Compara a listagem de pedidos do Bling num período com as vendas locais do mesmo período.
 * - revisar: pedidos que faltam aqui (em situação importável) ou cuja situação mudou (inclui os cancelados lá);
 * - sumidas: vendas ativas aqui que não vieram na listagem (candidatas a pedido excluído no Bling).
 */
export function conciliarPedidos<P extends { id: string | number; situacao?: { valor?: number } }, L extends { external_id: string; status: string; situacao_externa: number | null }>(
  pedidos: P[], locais: L[], permitidas: number[]): { revisar: P[]; sumidas: L[] } {
  const loc = new Map(locais.map(l => [l.external_id, l]))
  const revisar = pedidos.filter(p => {
    const l = loc.get(String(p.id)); const s = Number(p.situacao?.valor)
    return l ? l.situacao_externa !== s : permitidas.includes(s)
  })
  const ids = new Set(pedidos.map(p => String(p.id)))
  const sumidas = locais.filter(l => l.status !== 'cancelada' && l.situacao_externa !== SITUACAO_PEDIDO_CANCELADO && !ids.has(l.external_id))
  return { revisar, sumidas }
}
