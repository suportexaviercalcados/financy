// IA financeira via OpenRouter. Regras:
//  - Todo número vem de funções SQL pré-definidas executadas com o JWT do usuário (RLS = só a organização dele).
//  - A organização é fixada pelo servidor; o modelo nunca escolhe organização nem executa SQL livre.
//  - A IA não paga, não baixa e não exclui: apenas consulta e cria SUGESTÕES pendentes de aprovação.
//  - Limite de tokens por plano, idempotência por idempotency_key e registro de todas as execuções.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { corsHeaders, env, igualSeguro, json, log, serviceClient, usuarioAutenticado } from '../_shared/util.ts'

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions'

type Msg = { role: 'system' | 'user' | 'assistant' | 'tool'; content: string | null; tool_calls?: any[]; tool_call_id?: string }

// ------------------------------- Ferramentas (somente leitura) -------------------------------
const periodo = { inicio: { type: 'string', description: 'Data inicial YYYY-MM-DD' }, fim: { type: 'string', description: 'Data final YYYY-MM-DD' } }
const FERRAMENTAS = [
  { name: 'consultar_dre', description: 'DRE gerencial (regime de competência): receita bruta, deduções, CMV, margem de contribuição, despesas fixas, EBITDA, resultado financeiro e lucro líquido.',
    parameters: { type: 'object', properties: { ...periodo, granularidade: { type: 'string', enum: ['mes', 'trimestre', 'ano', 'total'] }, canal: { type: 'string', description: 'Nome do canal (opcional)' } }, required: ['inicio', 'fim'] } },
  { name: 'consultar_vendas_por_canal', description: 'Faturamento, pedidos, ticket médio, CMV, taxas e margem de contribuição por canal de venda.',
    parameters: { type: 'object', properties: periodo, required: ['inicio', 'fim'] } },
  { name: 'consultar_despesas_por_categoria', description: 'Despesas (competência) agrupadas por categoria do plano de contas, da maior para a menor.',
    parameters: { type: 'object', properties: { ...periodo, limite: { type: 'number' } }, required: ['inicio', 'fim'] } },
  { name: 'consultar_saldos', description: 'Saldo de cada conta bancária/caixa e total numa data.',
    parameters: { type: 'object', properties: { data: { type: 'string' } } } },
  { name: 'consultar_projecao_caixa', description: 'Projeção diária do saldo de caixa (contas em aberto) para os próximos N dias.',
    parameters: { type: 'object', properties: { dias: { type: 'number' } } } },
  { name: 'consultar_contas', description: 'Contas a pagar ou a receber em aberto/vencidas, com totais (lista limitada a 20).',
    parameters: { type: 'object', properties: { tipo: { type: 'string', enum: ['pagar', 'receber'] }, situacao: { type: 'string', enum: ['vencidas', 'a_vencer', 'todas_abertas'] }, ate: { type: 'string' } }, required: ['tipo', 'situacao'] } },
  { name: 'consultar_ranking_produtos', description: 'Produtos mais vendidos por receita, com margem.',
    parameters: { type: 'object', properties: { ...periodo, limite: { type: 'number' } }, required: ['inicio', 'fim'] } },
  { name: 'consultar_fluxo_caixa', description: 'Fluxo de caixa realizado x previsto por mês, semana ou dia (regime de caixa).',
    parameters: { type: 'object', properties: { ...periodo, granularidade: { type: 'string', enum: ['dia', 'semana', 'mes'] } }, required: ['inicio', 'fim'] } },
]

const hojeSP = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
const dataValida = (d: unknown) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : null

async function executarFerramenta(db: SupabaseClient, org: string, empresas: string[] | null, nome: string, a: any) {
  const ini = dataValida(a.inicio), fim = dataValida(a.fim)
  const exigePeriodo = () => { if (!ini || !fim) throw new Error('Período inválido: use YYYY-MM-DD') }
  const rpc = async (fn: string, p: Record<string, unknown>) => {
    const { data, error } = await db.rpc(fn, p); if (error) throw new Error(error.message); return data
  }
  switch (nome) {
    case 'consultar_dre': {
      exigePeriodo()
      let canal = null
      if (a.canal) {
        const { data } = await db.from('canais_venda').select('id, nome').eq('organizacao_id', org).ilike('nome', `%${a.canal}%`).limit(1)
        if (!data?.length) return { erro: `Canal "${a.canal}" não encontrado` }
        canal = data[0].id
      }
      return await rpc('fn_dre', { p_org: org, p_empresas: empresas, p_ini: ini, p_fim: fim, p_gran: a.granularidade ?? 'total', p_canal: canal })
    }
    case 'consultar_vendas_por_canal': exigePeriodo(); return await rpc('fn_vendas_por_canal', { p_org: org, p_empresas: empresas, p_ini: ini, p_fim: fim })
    case 'consultar_despesas_por_categoria': {
      exigePeriodo()
      const d = await rpc('fn_dre_categorias', { p_org: org, p_empresas: empresas, p_ini: ini, p_fim: fim, p_gran: 'total' }) as any[]
      return d.filter(x => ['despesa_fixa', 'despesa_variavel', 'despesa_financeira', 'cmv', 'deducoes_impostos'].includes(x.grupo))
        .sort((x, y) => y.valor - x.valor).slice(0, Math.min(a.limite ?? 15, 50))
        .map(x => ({ categoria: x.categoria, grupo: x.grupo, valor: x.valor, orcado: x.orcado }))
    }
    case 'consultar_saldos': {
      const s = await rpc('fn_saldos_contas', { p_org: org, p_empresas: empresas, p_data: dataValida(a.data) ?? hojeSP() }) as any[]
      return { contas: s.map(x => ({ conta: x.nome, saldo: x.saldo })), total: s.reduce((t, x) => t + Number(x.saldo), 0) }
    }
    case 'consultar_projecao_caixa': {
      const dias = Math.min(Math.max(Number(a.dias) || 30, 1), 180)
      const p = await rpc('fn_projecao_diaria', { p_org: org, p_empresas: empresas, p_dias: dias }) as any[]
      const neg = p.find(x => Number(x.saldo) < 0)
      return { saldo_hoje: p[0]?.saldo, saldo_final: p.at(-1)?.saldo, menor_saldo: Math.min(...p.map(x => Number(x.saldo))),
        primeiro_dia_negativo: neg?.data ?? null, semanas: p.filter((_, i) => i % 7 === 0).map(x => ({ data: x.data, saldo: x.saldo })) }
    }
    case 'consultar_contas': {
      let q = db.from('titulos').select('descricao, valor, valor_pago, data_vencimento, contatos(nome)').eq('organizacao_id', org)
        .eq('tipo', a.tipo === 'receber' ? 'receber' : 'pagar').in('status', ['aberto', 'parcial']).order('data_vencimento').limit(200)
      if (empresas) q = q.in('empresa_id', empresas)
      if (a.situacao === 'vencidas') q = q.lt('data_vencimento', hojeSP())
      if (a.situacao === 'a_vencer') q = q.gte('data_vencimento', hojeSP())
      if (dataValida(a.ate)) q = q.lte('data_vencimento', a.ate)
      const { data, error } = await q
      if (error) throw new Error(error.message)
      const itens = (data ?? []).map((t: any) => ({ descricao: t.descricao, contato: t.contatos?.nome ?? null, vencimento: t.data_vencimento,
        saldo: Math.round((Number(t.valor) - Number(t.valor_pago)) * 100) / 100 }))
      return { quantidade: itens.length, total: Math.round(itens.reduce((s, t) => s + t.saldo, 0) * 100) / 100, primeiros: itens.slice(0, 20) }
    }
    case 'consultar_ranking_produtos': exigePeriodo(); return await rpc('fn_ranking_produtos', { p_org: org, p_empresas: empresas, p_ini: ini, p_fim: fim, p_limite: Math.min(a.limite ?? 10, 50) })
    case 'consultar_fluxo_caixa': exigePeriodo(); return await rpc('fn_fluxo_caixa', { p_org: org, p_empresas: empresas, p_ini: ini, p_fim: fim, p_gran: a.granularidade ?? 'mes' })
  }
  return { erro: 'Ferramenta desconhecida' }
}

// ------------------------------- OpenRouter -------------------------------
async function chamarModelo(modelo: string, mensagens: Msg[], extra: Record<string, unknown> = {}) {
  const r = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env('OPENROUTER_API_KEY')}`, 'Content-Type': 'application/json',
      'HTTP-Referer': Deno.env.get('APP_URL') ?? 'https://financy.app', 'X-Title': 'Financy' },
    body: JSON.stringify({ model: modelo, messages: mensagens, temperature: 0.1, usage: { include: true }, ...extra }),
  })
  const corpo = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(`OpenRouter ${r.status}: ${JSON.stringify(corpo?.error ?? corpo).slice(0, 300)}`)
  return corpo as { choices: { message: Msg & { tool_calls?: any[] } }[]; usage?: { prompt_tokens: number; completion_tokens: number; cost?: number } }
}

function extrairJson(texto: string): any {
  const m = texto.match(/```(?:json)?\s*([\s\S]*?)```/) ?? [null, texto]
  const bruto = m[1]!.trim()
  const i = Math.min(...['[', '{'].map(c => bruto.indexOf(c)).filter(x => x >= 0))
  return JSON.parse(bruto.slice(i))
}

// ------------------------------- Handler -------------------------------
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (req.method !== 'POST') return json({ erro: 'Método não suportado' }, 405)
  const svc = serviceClient()
  const body = await req.json().catch(() => ({}))
  const acao: string = body.acao ?? 'chat'

  // Disparo agendado (alertas semanais de todas as organizações com IA ativa)
  const cron = req.headers.get('x-cron-secret')
  if (cron) {
    if (!igualSeguro(cron, env('CRON_SECRET'))) return json({ erro: 'Não autorizado' }, 401)
    if (!Deno.env.get('OPENROUTER_API_KEY')) return json({ ok: false, motivo: 'IA não configurada' })
    const { data: orgs } = await svc.from('ia_config').select('organizacao_id').eq('alertas_ativos', true)
    const res = []
    for (const o of orgs ?? []) res.push(await executar(svc, svc, o.organizacao_id, null, 'alertas', {}, `alertas:${hojeSP()}`).catch(e => ({ erro: String(e) })))
    return json({ ok: true, organizacoes: res.length })
  }

  const auth = await usuarioAutenticado(req)
  if (!auth) return json({ erro: 'Não autenticado' }, 401)
  const org = body.organizacao_id as string
  const { data: membro } = await auth.client.from('organizacoes').select('id').eq('id', org).maybeSingle()
  if (!membro) return json({ erro: 'Sem acesso a esta organização' }, 403)
  if (!Deno.env.get('OPENROUTER_API_KEY')) {
    return json({ erro: 'A IA ainda não foi configurada nesta plataforma (OPENROUTER_API_KEY ausente). Veja docs/OPENROUTER.md.' }, 503)
  }
  try {
    const r = await executar(svc, auth.client, org, auth.user.id, acao, body, body.idempotency_key ?? null)
    return json(r, (r as any).status ?? 200)
  } catch (e) {
    log('erro', 'ia', { erro: String(e), acao, org })
    return json({ erro: (e as Error).message }, 500)
  }
})

async function executar(svc: SupabaseClient, db: SupabaseClient, org: string, userId: string | null, acao: string, body: any, chave: string | null) {
  // limite do plano
  const { data: uso } = await svc.rpc('fn_ia_uso_mes', { p_org: org })
  if (uso && Number(uso.tokens) >= Number(uso.limite)) {
    await svc.from('ia_execucoes').insert({ organizacao_id: org, user_id: userId, tipo: tipoExec(acao), status: 'bloqueado',
      erro: 'Limite mensal de IA do plano atingido' })
    return { erro: 'Limite mensal de uso de IA do seu plano foi atingido.', status: 429 }
  }
  // idempotência / proteção contra execução duplicada
  if (chave) {
    const { data: ex } = await svc.from('ia_execucoes').select('status, saida').eq('organizacao_id', org).eq('idempotency_key', chave).maybeSingle()
    if (ex?.status === 'sucesso') return { ...ex.saida, reaproveitado: true }
    if (ex?.status === 'executando') return { erro: 'Esta solicitação já está em processamento.', status: 409 }
    if (ex) await svc.from('ia_execucoes').delete().eq('organizacao_id', org).eq('idempotency_key', chave)
  }
  const [{ data: plat }, { data: cfg }] = await Promise.all([
    svc.from('ia_config_plataforma').select('*').single(),
    svc.from('ia_config').select('*').eq('organizacao_id', org).maybeSingle(),
  ])
  const modelo = cfg?.modelo || plat.modelo_padrao
  const sistema = [plat.prompt_sistema, `Data de hoje: ${hojeSP()} (fuso America/Sao_Paulo).`, cfg?.instrucoes ? `Instruções da empresa: ${cfg.instrucoes}` : ''].filter(Boolean).join('\n\n')
  const { data: exec, error: eIns } = await svc.from('ia_execucoes').insert({ organizacao_id: org, user_id: userId, tipo: tipoExec(acao),
    modelo, idempotency_key: chave, entrada: acao === 'chat' ? { mensagens: body.mensagens?.slice(-10) } : { acao, ...body, mensagens: undefined } }).select('id').single()
  if (eIns) { if (eIns.code === '23505') return { erro: 'Esta solicitação já está em processamento.', status: 409 }; throw eIns }
  const t0 = Date.now(); const tokens = { p: 0, c: 0, custo: 0 }; const ferramentas: any[] = []
  const contabilizar = (u?: { prompt_tokens: number; completion_tokens: number; cost?: number }) => {
    tokens.p += u?.prompt_tokens ?? 0; tokens.c += u?.completion_tokens ?? 0; tokens.custo += u?.cost ?? 0
  }
  const empresas: string[] | null = Array.isArray(body.empresa_ids) && body.empresa_ids.length ? body.empresa_ids : null
  try {
    let saida: any
    if (acao === 'chat') saida = await chat(db, org, empresas, modelo, sistema, body.mensagens ?? [], contabilizar, ferramentas)
    else if (acao === 'resumo') saida = await resumo(db, org, empresas, modelo, sistema, body, contabilizar, ferramentas)
    else if (acao === 'categorizar') saida = await categorizar(svc, db, org, modelo, sistema, body, cfg, exec.id, contabilizar)
    else if (acao === 'conciliar') saida = await conciliar(svc, db, org, modelo, sistema, body, exec.id, contabilizar)
    else if (acao === 'alertas') saida = await alertasIA(svc, db, org, modelo, sistema, contabilizar, ferramentas)
    else throw new Error('Ação inválida')
    await svc.from('ia_execucoes').update({ status: 'sucesso', saida, ferramentas, prompt_tokens: tokens.p, completion_tokens: tokens.c,
      custo_usd: tokens.custo, duracao_ms: Date.now() - t0 }).eq('id', exec.id)
    return saida
  } catch (e) {
    await svc.from('ia_execucoes').update({ status: 'erro', erro: String((e as Error).message ?? e), ferramentas,
      prompt_tokens: tokens.p, completion_tokens: tokens.c, custo_usd: tokens.custo, duracao_ms: Date.now() - t0 }).eq('id', exec.id)
    throw e
  }
}

const tipoExec = (a: string) => ({ chat: 'chat', resumo: 'resumo', categorizar: 'categorizacao', conciliar: 'conciliacao', alertas: 'alertas' } as any)[a] ?? 'chat'

async function chat(db: SupabaseClient, org: string, empresas: string[] | null, modelo: string, sistema: string, historico: any[],
  conta: (u: any) => void, ferramentas: any[]) {
  const msgs: Msg[] = [{ role: 'system', content: sistema + '\n\nUse as ferramentas para obter qualquer número. Se a pergunta não puder ser respondida com elas, diga que não há dados suficientes.' },
    ...historico.slice(-10).filter((m: any) => ['user', 'assistant'].includes(m.role)).map((m: any) => ({ role: m.role, content: String(m.content).slice(0, 4000) }))]
  const tools = FERRAMENTAS.map(f => ({ type: 'function', function: f }))
  for (let rodada = 0; rodada < 6; rodada++) {
    const r = await chamarModelo(modelo, msgs, { tools, tool_choice: 'auto' })
    conta(r.usage)
    const m = r.choices[0].message
    if (!m.tool_calls?.length) return { resposta: m.content ?? '', fontes: ferramentas.map(f => f.nome) }
    msgs.push({ role: 'assistant', content: m.content ?? null, tool_calls: m.tool_calls })
    for (const tc of m.tool_calls) {
      let args: any = {}; try { args = JSON.parse(tc.function.arguments || '{}') } catch { /* argumentos inválidos */ }
      let resultado: unknown
      try { resultado = await executarFerramenta(db, org, empresas, tc.function.name, args) }
      catch (e) { resultado = { erro: (e as Error).message } }
      ferramentas.push({ nome: tc.function.name, argumentos: args })
      msgs.push({ role: 'tool', tool_call_id: tc.id, content: JSON.stringify(resultado).slice(0, 20000) })
    }
  }
  return { resposta: 'Não consegui concluir a análise com as consultas disponíveis. Reformule a pergunta.', fontes: ferramentas.map(f => f.nome) }
}

async function resumo(db: SupabaseClient, org: string, empresas: string[] | null, modelo: string, sistema: string, body: any,
  conta: (u: any) => void, ferramentas: any[]) {
  const ini = dataValida(body.inicio) ?? hojeSP().slice(0, 8) + '01'
  const fim = dataValida(body.fim) ?? hojeSP()
  const dias = Math.round((Date.parse(fim) - Date.parse(ini)) / 86400000) + 1
  const antIni = new Date(Date.parse(ini) - dias * 86400000).toISOString().slice(0, 10)
  const antFim = new Date(Date.parse(ini) - 86400000).toISOString().slice(0, 10)
  const dados = {
    periodo: { inicio: ini, fim },
    dre: await executarFerramenta(db, org, empresas, 'consultar_dre', { inicio: ini, fim }),
    dre_periodo_anterior: await executarFerramenta(db, org, empresas, 'consultar_dre', { inicio: antIni, fim: antFim }),
    canais: await executarFerramenta(db, org, empresas, 'consultar_vendas_por_canal', { inicio: ini, fim }),
    despesas: await executarFerramenta(db, org, empresas, 'consultar_despesas_por_categoria', { inicio: ini, fim, limite: 8 }),
    saldos: await executarFerramenta(db, org, empresas, 'consultar_saldos', {}),
    projecao: await executarFerramenta(db, org, empresas, 'consultar_projecao_caixa', { dias: 60 }),
  }
  ferramentas.push({ nome: 'pacote_resumo', argumentos: { ini, fim } })
  const r = await chamarModelo(modelo, [
    { role: 'system', content: sistema },
    { role: 'user', content: `Explique em linguagem simples, para o dono de uma loja, o resultado do período e o que mudou em relação ao período anterior. ` +
      `Use SOMENTE os dados JSON abaixo (não invente números). Estruture em: 1) Resumo em 3 frases; 2) O que melhorou; 3) O que piorou; ` +
      `4) Caixa nos próximos 60 dias; 5) Três ações recomendadas. Se algum dado estiver zerado ou ausente, diga isso.\n\n${JSON.stringify(dados)}` },
  ])
  conta(r.usage)
  return { resposta: r.choices[0].message.content ?? '', dados }
}

async function categorizar(svc: SupabaseClient, db: SupabaseClient, org: string, modelo: string, sistema: string, body: any, cfg: any,
  execId: string, conta: (u: any) => void) {
  const alvo = body.alvo === 'transacoes_bancarias' ? 'transacoes_bancarias' : 'titulos'
  const ids: string[] = (body.ids ?? []).slice(0, 40)
  if (!ids.length) return { sugestoes: 0 }
  const { data: itens } = alvo === 'titulos'
    ? await db.from('titulos').select('id, tipo, descricao, valor, contatos(nome)').in('id', ids).eq('organizacao_id', org)
    : await db.from('transacoes_bancarias').select('id, descricao, valor, data').in('id', ids).eq('organizacao_id', org)
  const { data: cats } = await db.from('plano_contas').select('id, codigo, nome, natureza').eq('organizacao_id', org)
    .eq('aceita_lancamento', true).eq('ativo', true).order('codigo')
  if (!itens?.length || !cats?.length) return { sugestoes: 0 }
  const r = await chamarModelo(modelo, [
    { role: 'system', content: sistema },
    { role: 'user', content: `Classifique cada lançamento em UMA categoria do plano de contas (use o código). ` +
      `Responda apenas JSON: [{"id":"...","codigo":"...","confianca":0.0-1.0,"justificativa":"..."}]. ` +
      `Confiança baixa (<0.6) quando a descrição for ambígua.\n\nPlano de contas:\n${cats.map(c => `${c.codigo} ${c.nome} (${c.natureza})`).join('\n')}` +
      `\n\nLançamentos:\n${JSON.stringify(itens.map((i: any) => ({ id: i.id, descricao: i.descricao, valor: i.valor, tipo: i.tipo ?? (i.valor > 0 ? 'entrada' : 'saida'), contato: i.contatos?.nome })))}` },
  ])
  conta(r.usage)
  const resp = extrairJson(r.choices[0].message.content ?? '[]') as any[]
  let n = 0, aplicadas = 0
  for (const s of resp) {
    const item = itens.find((i: any) => i.id === s.id); const cat = cats.find(c => c.codigo === String(s.codigo))
    if (!item || !cat) continue
    const confianca = Math.max(0, Math.min(1, Number(s.confianca) || 0))
    // aplicação automática somente para categoria de títulos, acima do nível configurado (nunca cria baixas)
    const auto = alvo === 'titulos' && cfg?.auto_aplicar && confianca >= Number(cfg.nivel_confianca)
    await svc.from('ia_sugestoes').delete().eq('alvo_tabela', alvo).eq('alvo_id', s.id).eq('tipo', 'categoria').eq('status', 'pendente')
    await svc.from('ia_sugestoes').insert({ organizacao_id: org, execucao_id: execId, tipo: 'categoria', alvo_tabela: alvo, alvo_id: s.id,
      sugestao: { categoria_id: cat.id, categoria: `${cat.codigo} ${cat.nome}`, justificativa: s.justificativa }, confianca,
      status: auto ? 'aplicada_auto' : 'pendente', decidido_em: auto ? new Date().toISOString() : null })
    if (auto) { const { error } = await db.from('titulos').update({ categoria_id: cat.id }).eq('id', s.id); if (!error) aplicadas++ }
    n++
  }
  return { sugestoes: n, aplicadas_automaticamente: aplicadas }
}

async function conciliar(svc: SupabaseClient, db: SupabaseClient, org: string, modelo: string, sistema: string, body: any,
  execId: string, conta: (u: any) => void) {
  const { data: trs } = await db.from('transacoes_bancarias').select('id, data, valor, descricao, conta_bancaria_id, contas_bancarias(empresa_id)')
    .eq('organizacao_id', org).eq('conta_bancaria_id', body.conta_bancaria_id).eq('status', 'pendente').order('data').limit(30)
  if (!trs?.length) return { sugestoes: 0 }
  const casos = []
  for (const t of trs as any[]) {
    const v = Math.abs(Number(t.valor))
    const d0 = new Date(Date.parse(t.data) - 30 * 864e5).toISOString().slice(0, 10), d1 = new Date(Date.parse(t.data) + 30 * 864e5).toISOString().slice(0, 10)
    const { data: cands } = await db.from('titulos').select('id, descricao, valor, valor_pago, data_vencimento, contatos(nome)')
      .eq('organizacao_id', org).eq('empresa_id', t.contas_bancarias.empresa_id).eq('tipo', Number(t.valor) > 0 ? 'receber' : 'pagar')
      .in('status', ['aberto', 'parcial']).gte('data_vencimento', d0).lte('data_vencimento', d1).limit(50)
    const proximos = (cands ?? []).map((c: any) => ({ id: c.id, descricao: c.descricao, contato: c.contatos?.nome, vencimento: c.data_vencimento,
      saldo: Math.round((Number(c.valor) - Number(c.valor_pago)) * 100) / 100 }))
      .filter(c => Math.abs(c.saldo - v) <= Math.max(0.05 * v, 1)).slice(0, 5)
    if (proximos.length) casos.push({ transacao: { id: t.id, data: t.data, valor: t.valor, descricao: t.descricao }, candidatos: proximos })
  }
  if (!casos.length) return { sugestoes: 0 }
  const r = await chamarModelo(modelo, [
    { role: 'system', content: sistema },
    { role: 'user', content: `Para cada transação bancária, escolha o título candidato que corresponde ao mesmo pagamento/recebimento, ou nenhum. ` +
      `Responda apenas JSON: [{"transacao_id":"...","titulo_id":"..."|null,"confianca":0.0-1.0,"justificativa":"..."}].\n\n${JSON.stringify(casos)}` },
  ])
  conta(r.usage)
  const resp = extrairJson(r.choices[0].message.content ?? '[]') as any[]
  let n = 0
  for (const s of resp) {
    const caso = casos.find(c => c.transacao.id === s.transacao_id)
    if (!caso || !s.titulo_id || !caso.candidatos.some(c => c.id === s.titulo_id)) continue
    await svc.from('ia_sugestoes').delete().eq('alvo_tabela', 'transacoes_bancarias').eq('alvo_id', s.transacao_id).eq('tipo', 'conciliacao').eq('status', 'pendente')
    await svc.from('ia_sugestoes').insert({ organizacao_id: org, execucao_id: execId, tipo: 'conciliacao', alvo_tabela: 'transacoes_bancarias',
      alvo_id: s.transacao_id, sugestao: { alvo_tipo: 'titulo', alvo_id: s.titulo_id, justificativa: s.justificativa },
      confianca: Math.max(0, Math.min(1, Number(s.confianca) || 0)) })
    n++
  }
  return { sugestoes: n }
}

async function alertasIA(svc: SupabaseClient, db: SupabaseClient, org: string, modelo: string, sistema: string,
  conta: (u: any) => void, ferramentas: any[]) {
  const hoje = hojeSP(); const iniMes = hoje.slice(0, 8) + '01'
  const tres = new Date(Date.parse(iniMes) - 90 * 864e5).toISOString().slice(0, 10)
  const ontem = new Date(Date.parse(iniMes) - 864e5).toISOString().slice(0, 10)
  const dados = {
    mes_atual: { dre: await executarFerramenta(db, org, null, 'consultar_dre', { inicio: iniMes, fim: hoje }),
      canais: await executarFerramenta(db, org, null, 'consultar_vendas_por_canal', { inicio: iniMes, fim: hoje }),
      despesas: await executarFerramenta(db, org, null, 'consultar_despesas_por_categoria', { inicio: iniMes, fim: hoje }) },
    tres_meses_anteriores: { dre_mensal: await executarFerramenta(db, org, null, 'consultar_dre', { inicio: tres, fim: ontem, granularidade: 'mes' }),
      canais: await executarFerramenta(db, org, null, 'consultar_vendas_por_canal', { inicio: tres, fim: ontem }),
      despesas: await executarFerramenta(db, org, null, 'consultar_despesas_por_categoria', { inicio: tres, fim: ontem }) },
    projecao: await executarFerramenta(db, org, null, 'consultar_projecao_caixa', { dias: 45 }),
    vencidas: await executarFerramenta(db, org, null, 'consultar_contas', { tipo: 'pagar', situacao: 'vencidas' }),
  }
  ferramentas.push({ nome: 'pacote_alertas', argumentos: { iniMes, hoje } })
  const r = await chamarModelo(modelo, [
    { role: 'system', content: sistema },
    { role: 'user', content: `Analise os dados e produza um resumo financeiro semanal e até 3 alertas relevantes ` +
      `(despesas fora do padrão, queda de margem por canal, risco de caixa negativo). Considere que o mês atual está parcial (hoje ${hoje}). ` +
      `Use apenas números presentes nos dados. Responda JSON: {"resumo":"...","alertas":[{"titulo":"...","mensagem":"...","severidade":"info|aviso|critico"}]}\n\n${JSON.stringify(dados)}` },
  ])
  conta(r.usage)
  const out = extrairJson(r.choices[0].message.content ?? '{}')
  const semana = `${hoje.slice(0, 4)}-S${Math.ceil((Date.parse(hoje) - Date.parse(hoje.slice(0, 4) + '-01-01')) / 6048e5)}`
  const linhas = [{ tipo: 'resumo_semanal', severidade: 'info', titulo: 'Resumo financeiro da semana', mensagem: String(out.resumo ?? '').slice(0, 4000), chave: `ia:resumo:${semana}` },
    ...(out.alertas ?? []).slice(0, 3).map((a: any, i: number) => ({ tipo: 'ia', severidade: ['info', 'aviso', 'critico'].includes(a.severidade) ? a.severidade : 'aviso',
      titulo: String(a.titulo).slice(0, 200), mensagem: String(a.mensagem).slice(0, 2000), chave: `ia:${semana}:${i}` }))]
    .filter(l => l.mensagem)
  if (linhas.length) await svc.from('alertas').upsert(linhas.map(l => ({ ...l, organizacao_id: org, origem: 'ia' })), { onConflict: 'organizacao_id,chave', ignoreDuplicates: true })
  return { resumo: out.resumo, alertas: linhas.length }
}
