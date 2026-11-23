// Worker de sincronização com o Bling (fila em sync_jobs).
// Disparo: pg_cron (header x-cron-secret) a cada 10 min, ou usuário admin (POST { integracao_id }) para sincronizar agora.
// Idempotência: vendas/títulos/produtos/contatos usam (organizacao_id, origem='bling', external_id) únicos.
import type { SupabaseClient } from 'jsr:@supabase/supabase-js@2'
import { BlingApi, BlingErro, SITUACAO_PEDIDO_CANCELADO, SITUACAO_PEDIDO_EM_DIGITACAO, tipoFormaBling } from '../_shared/bling.ts'
import { corsHeaders, env, igualSeguro, json, log, serviceClient, usuarioAutenticado } from '../_shared/util.ts'

const ORCAMENTO_MS = 100_000   // tempo máximo por execução (limite de wall-clock da Edge Function) antes de salvar cursor

type Job = { id: string; organizacao_id: string; integracao_id: string; tipo: string; recurso: string;
  parametros: Record<string, any>; cursor: Record<string, any>; tentativas: number; max_tentativas: number; registros_importados: number }

const hojeSP = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' })
const somaDias = (d: string, n: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const dataHoraBling = (iso: string) => new Date(new Date(iso).getTime() - 3600_000)
  .toLocaleString('sv-SE', { timeZone: 'America/Sao_Paulo' })   // "YYYY-MM-DD HH:MM:SS", 1h de folga
const r2 = (v: number) => Math.round(v * 100) / 100

/** Janelas de no máximo 1 ano (a API retorna 400 para períodos maiores) */
function janelas(inicio: string, fim: string): [string, string][] {
  const out: [string, string][] = []
  let a = inicio
  while (a <= fim) { const b = [somaDias(a, 360), fim].sort()[0]; out.push([a, b]); a = somaDias(b, 1) }
  return out
}

class Contexto {
  importados = 0
  constructor(public svc: SupabaseClient, public api: BlingApi, public job: Job, public integ: any, private prazo: number) {}
  get org() { return this.job.organizacao_id }
  semTempo() { return Date.now() > this.prazo }
  async logar(nivel: 'info' | 'aviso' | 'erro', mensagem: string, detalhes?: unknown) {
    await this.svc.from('sync_logs').insert({ organizacao_id: this.org, integracao_id: this.integ.id, job_id: this.job.id,
      nivel, mensagem, detalhes: detalhes ?? null })
  }
  async salvarCursor(cursor: Record<string, unknown>) {
    this.job.cursor = cursor
    await this.svc.from('sync_jobs').update({ cursor, registros_importados: this.job.registros_importados + this.importados }).eq('id', this.job.id)
  }
  async mapa(tipo: string): Promise<Map<string, string | null>> {
    const { data } = await this.svc.from('integracao_mapeamentos').select('external_id, interno_id')
      .eq('integracao_id', this.integ.id).eq('tipo', tipo)
    return new Map((data ?? []).map((m: any) => [m.external_id, m.interno_id]))
  }
  async categoriaPorCodigo(codigo: string) {
    const { data } = await this.svc.from('plano_contas').select('id').eq('organizacao_id', this.org).eq('codigo', codigo).single()
    return data?.id as string
  }
}

class Pausa extends Error {}   // orçamento de tempo esgotado: retoma no próximo ciclo

// ---------------------------------------------------------------------------------------------
async function syncCadastros(c: Contexto) {
  // Formas de pagamento
  const { data: formas } = await c.svc.from('formas_pagamento').select('id, tipo, nome').eq('organizacao_id', c.org)
  const mapaFormas = await c.mapa('forma_pagamento')
  for await (const { itens } of c.api.paginas<any>('/formas-pagamentos', {})) {
    for (const f of itens) {
      let interno = mapaFormas.get(String(f.id)) ?? null
      if (!interno) {
        const tipo = tipoFormaBling(f.tipoPagamento)
        interno = formas?.find((x: any) => x.tipo === tipo && tipo !== 'outro')?.id ?? null
        if (!interno) {
          const { data } = await c.svc.from('formas_pagamento').upsert({ organizacao_id: c.org, nome: `Bling — ${f.descricao}`.slice(0, 80), tipo },
            { onConflict: 'organizacao_id,nome' }).select('id').single()
          interno = data?.id ?? null
        }
      }
      await c.svc.from('integracao_mapeamentos').upsert({ organizacao_id: c.org, integracao_id: c.integ.id, tipo: 'forma_pagamento',
        external_id: String(f.id), external_nome: f.descricao, interno_id: interno, updated_at: new Date().toISOString() },
        { onConflict: 'integracao_id,tipo,external_id' })
    }
  }
  // Lojas / canais de venda
  const { data: canais } = await c.svc.from('canais_venda').select('id, nome').eq('organizacao_id', c.org)
  const mapaLojas = await c.mapa('loja')
  const lojas: any[] = [{ id: 0, descricao: 'Bling (sem loja vinculada)', tipo: '' }]
  for await (const { itens } of c.api.paginas<any>('/canais-venda', {})) lojas.push(...itens)
  for (const l of lojas) {
    let interno = mapaLojas.get(String(l.id)) ?? null
    if (!interno) {
      interno = canais?.find((x: any) => x.nome.toLowerCase() === String(l.descricao).toLowerCase())?.id ?? null
      if (!interno) {
        const marketplace = /mercado|shopee|amazon|magalu|magazine|americanas|shein|netshoes|marketplace/i.test(`${l.descricao} ${l.tipo}`)
        const { data } = await c.svc.from('canais_venda').upsert({ organizacao_id: c.org, nome: String(l.descricao).slice(0, 80),
          tipo: l.id === 0 ? 'outro' : marketplace ? 'marketplace' : 'site' }, { onConflict: 'organizacao_id,nome' }).select('id').single()
        interno = data?.id ?? null
      }
    }
    await c.svc.from('integracao_mapeamentos').upsert({ organizacao_id: c.org, integracao_id: c.integ.id, tipo: 'loja',
      external_id: String(l.id), external_nome: l.descricao, interno_id: interno, updated_at: new Date().toISOString() },
      { onConflict: 'integracao_id,tipo,external_id' })
  }
  // Categorias financeiras (mapeamento manual pelo usuário; sem vínculo usa categoria padrão)
  for await (const { itens } of c.api.paginas<any>('/categorias/receitas-despesas', { tipo: 0 })) {
    const linhas = itens.map((k: any) => ({ organizacao_id: c.org, integracao_id: c.integ.id, tipo: 'categoria',
      external_id: String(k.id), external_nome: `${k.descricao} (${k.tipo === 1 ? 'despesa' : k.tipo === 2 ? 'receita' : 'receita/despesa'})` }))
    if (linhas.length) await c.svc.from('integracao_mapeamentos').upsert(linhas, { onConflict: 'integracao_id,tipo,external_id', ignoreDuplicates: true })
  }
}

async function syncProdutos(c: Contexto) {
  const incremental = c.job.tipo !== 'inicial' && c.integ.ultima_sincronizacao
  const params = incremental ? { dataAlteracaoInicial: dataHoraBling(c.integ.ultima_sincronizacao), criterio: 5 } : { criterio: 5 }
  for await (const { pagina, itens } of c.api.paginas<any>('/produtos', params, c.job.cursor.pagina ?? 1)) {
    const base = (p: any) => ({ organizacao_id: c.org, origem: 'bling', external_id: String(p.id), nome: p.nome,
      sku: p.codigo || null, preco: p.preco ?? 0, ativo: p.situacao !== 'I' })
    // custo só é gravado quando informado no Bling (não apaga custo cadastrado manualmente)
    const comCusto = itens.filter(p => Number(p.precoCusto) > 0).map(p => ({ ...base(p), custo: Number(p.precoCusto) }))
    const semCusto = itens.filter(p => !(Number(p.precoCusto) > 0)).map(base)
    for (const lote of [comCusto, semCusto]) {
      if (!lote.length) continue
      const { error } = await c.svc.from('produtos').upsert(lote, { onConflict: 'organizacao_id,origem,external_id', defaultToNull: false })
      if (error) throw error
    }
    c.importados += itens.length
    await c.salvarCursor({ pagina: pagina + 1 })
    if (c.semTempo()) throw new Pausa()
  }
}

async function syncContatos(c: Contexto) {
  const incremental = c.job.tipo !== 'inicial' && c.integ.ultima_sincronizacao
  const params = incremental ? { dataAlteracaoInicial: dataHoraBling(c.integ.ultima_sincronizacao) } : {}
  for await (const { pagina, itens } of c.api.paginas<any>('/contatos', params, c.job.cursor.pagina ?? 1)) {
    const linhas = itens.map(k => ({ organizacao_id: c.org, origem: 'bling', external_id: String(k.id), nome: k.nome || '(sem nome)',
      documento: k.numeroDocumento || null, telefone: k.celular || k.telefone || null }))
    if (linhas.length) {
      const { error } = await c.svc.from('contatos').upsert(linhas, { onConflict: 'organizacao_id,origem,external_id', defaultToNull: false })
      if (error) throw error
    }
    c.importados += itens.length
    await c.salvarCursor({ pagina: pagina + 1 })
    if (c.semTempo()) throw new Pausa()
  }
}

async function contatoId(c: Contexto, contato: any): Promise<string | null> {
  if (!contato?.id) return null
  const { data } = await c.svc.from('contatos').upsert({ organizacao_id: c.org, origem: 'bling', external_id: String(contato.id),
    nome: contato.nome || '(sem nome)', documento: contato.numeroDocumento || null },
    { onConflict: 'organizacao_id,origem,external_id', defaultToNull: false }).select('id').single()
  return data?.id ?? null
}

/** Importa (ou cancela) um pedido de venda do Bling. Retorna true se criou/alterou algo. */
async function importarPedido(c: Contexto, resumo: any, cache: { formas: Map<string, string | null>; lojas: Map<string, string | null>; formaPadrao: string; canalPadrao: string }) {
  const externo = String(resumo.id)
  const { data: existente } = await c.svc.from('vendas').select('id, status').eq('organizacao_id', c.org)
    .eq('origem', 'bling').eq('external_id', externo).maybeSingle()
  const situacao = Number(resumo.situacao?.valor)
  if (situacao === SITUACAO_PEDIDO_CANCELADO) {
    if (existente && existente.status !== 'cancelada') {
      const { error } = await c.svc.rpc('fn_cancelar_venda', { p_venda: existente.id })
      if (error) await c.logar('aviso', `Pedido ${resumo.numero} cancelado no Bling, mas não pôde ser cancelado aqui: ${error.message}`)
      else return true
    }
    return false
  }
  const ignorar: number[] = c.integ.config?.situacoes_ignorar ?? [SITUACAO_PEDIDO_EM_DIGITACAO]
  if (existente || ignorar.includes(situacao)) return false

  const { data: d } = await c.api.get<{ data: any }>(`/pedidos/vendas/${externo}`)
  if (!d) return false
  const produtosExt = (d.itens ?? []).map((i: any) => String(i.produto?.id ?? '')).filter((x: string) => x && x !== '0')
  const { data: prods } = produtosExt.length
    ? await c.svc.from('produtos').select('id, external_id').eq('organizacao_id', c.org).eq('origem', 'bling').in('external_id', produtosExt)
    : { data: [] as any[] }
  const mapaProd = new Map((prods ?? []).map((p: any) => [p.external_id, p.id]))

  const itens = (d.itens ?? []).map((i: any) => ({
    produto_id: mapaProd.get(String(i.produto?.id)) ?? null,
    descricao: i.descricao || i.codigo || 'Item',
    quantidade: Number(i.quantidade), preco_unitario: Number(i.valor), desconto: 0,
  }))
  if (!itens.length) { await c.logar('aviso', `Pedido ${d.numero} sem itens — ignorado.`); return false }
  const valorProdutos = r2(itens.reduce((s: number, i: any) => s + r2(i.quantidade * i.preco_unitario), 0))
  let frete = r2(Number(d.transporte?.frete ?? 0) + Number(d.outrasDespesas ?? 0))
  const total = r2(Number(d.total))
  // desconto do pedido + descontos de itens consolidados para que o total feche com o Bling
  let desconto = r2(valorProdutos + frete - total)
  if (desconto < 0) { frete = r2(frete - desconto); desconto = 0 }

  const parcelas: any[] = (d.parcelas?.length ? d.parcelas : [{ formaPagamento: { id: 0 }, valor: total, dataVencimento: d.dataPrevista || d.data }])
    .map((p: any) => ({ ...p, valor: r2(Number(p.valor)) }))
  const dif = r2(total - parcelas.reduce((s, p) => s + p.valor, 0))
  if (dif !== 0) parcelas[parcelas.length - 1].valor = r2(parcelas[parcelas.length - 1].valor + dif)

  const { data: formasTipo } = await c.svc.from('formas_pagamento').select('id, tipo').eq('organizacao_id', c.org)
  const tipoDe = new Map((formasTipo ?? []).map((f: any) => [f.id, f.tipo]))
  const pagamentos = parcelas.filter(p => p.valor > 0).map((p: any) => {
    const forma = cache.formas.get(String(p.formaPagamento?.id)) ?? cache.formaPadrao
    const cartao = ['credito', 'debito'].includes(tipoDe.get(forma) as string)
    // cartão: prazo do recebível vem da taxa do canal (adquirente); demais: vencimento do Bling
    return { forma_pagamento_id: forma, valor: p.valor, parcelas: 1, data_vencimento: cartao ? undefined : (p.dataVencimento || d.data) }
  })

  const { error } = await c.svc.rpc('fn_registrar_venda', { p: {
    organizacao_id: c.org, empresa_id: c.integ.empresa_id,
    canal_id: cache.lojas.get(String(d.loja?.id ?? 0)) ?? cache.canalPadrao,
    contato_id: await contatoId(c, d.contato), numero: String(d.numero), data_venda: d.data,
    desconto, frete_cobrado: frete, origem: 'bling', external_id: externo,
    observacoes: d.numeroLoja ? `Pedido loja ${d.numeroLoja}` : null, itens, pagamentos,
  } })
  if (error) { await c.logar('erro', `Pedido ${d.numero}: ${error.message}`, { pedido: externo }); return false }
  return true
}

async function cacheVendas(c: Contexto) {
  const formas = await c.mapa('forma_pagamento'); const lojas = await c.mapa('loja')
  const { data: fp } = await c.svc.from('formas_pagamento').select('id').eq('organizacao_id', c.org).eq('tipo', 'outro').limit(1)
  let formaPadrao = fp?.[0]?.id
  if (!formaPadrao) {
    const { data } = await c.svc.from('formas_pagamento').upsert({ organizacao_id: c.org, nome: 'Bling — a definir', tipo: 'outro' },
      { onConflict: 'organizacao_id,nome' }).select('id').single()
    formaPadrao = data!.id
  }
  let canalPadrao = lojas.get('0') ?? null
  if (!canalPadrao) {
    const { data } = await c.svc.from('canais_venda').upsert({ organizacao_id: c.org, nome: 'Bling (sem loja vinculada)', tipo: 'outro' },
      { onConflict: 'organizacao_id,nome' }).select('id').single()
    canalPadrao = data!.id
  }
  return { formas, lojas, formaPadrao, canalPadrao: canalPadrao! }
}

async function syncVendas(c: Contexto) {
  const cache = await cacheVendas(c)
  const incremental = c.job.tipo !== 'inicial' && c.integ.ultima_sincronizacao
  const lista: { params: Record<string, string>; chave: string }[] = incremental
    ? [{ chave: 'alt', params: { dataAlteracaoInicial: dataHoraBling(c.integ.ultima_sincronizacao) } }]
    : janelas(c.integ.sync_inicio ?? somaDias(hojeSP(), -365), hojeSP()).map(([a, b]) => ({ chave: a, params: { dataInicial: a, dataFinal: b } }))
  const iniJanela = lista.findIndex(j => j.chave === c.job.cursor.janela)
  for (const [idx, j] of lista.entries()) {
    if (iniJanela > idx) continue
    const pagIni = iniJanela === idx ? (c.job.cursor.pagina ?? 1) : 1
    for await (const { pagina, itens } of c.api.paginas<any>('/pedidos/vendas', j.params, pagIni)) {
      for (const p of itens) if (await importarPedido(c, p, cache)) c.importados++
      await c.salvarCursor({ janela: j.chave, pagina: pagina + 1 })
      if (c.semTempo()) throw new Pausa()
    }
  }
}

async function syncVendaUnica(c: Contexto) {
  const cache = await cacheVendas(c)
  const { data } = await c.api.get<{ data: any }>(`/pedidos/vendas/${c.job.parametros.pedido_id}`)
  if (data && await importarPedido(c, data, cache)) c.importados++
}

const SITUACAO_CONTA = { aberto: 1, pago: 2, parcial: 3, devolvido: 4, cancelado: 5 }

async function syncContas(c: Contexto, tipo: 'pagar' | 'receber') {
  const path = tipo === 'pagar' ? '/contas/pagar' : '/contas/receber'
  const mapaCat = await c.mapa('categoria')
  const catPadrao = await c.categoriaPorCodigo(tipo === 'pagar' ? '5.3.4' : '1.3')
  const contaBaixa: string | null = c.integ.config?.conta_baixa_id ?? null
  const importarVendas = c.integ.config?.importar_vendas !== false
  const hoje = hojeSP()
  const incremental = c.job.tipo !== 'inicial' && c.integ.ultima_sincronizacao
  const lista = incremental
    ? [{ chave: 'venc', params: tipo === 'pagar'
        ? { dataVencimentoInicial: somaDias(hoje, -90), dataVencimentoFinal: somaDias(hoje, 270) }
        : { tipoFiltroData: 'V', dataInicial: somaDias(hoje, -90), dataFinal: somaDias(hoje, 270) } }]
    : janelas(c.integ.sync_inicio ?? somaDias(hoje, -365), hoje).map(([a, b]) => ({ chave: a, params: tipo === 'pagar'
        ? { dataEmissaoInicial: a, dataEmissaoFinal: b } : { tipoFiltroData: 'E', dataInicial: a, dataFinal: b } }))
  const iniJanela = lista.findIndex(j => j.chave === c.job.cursor.janela)
  for (const [idx, j] of lista.entries()) {
    if (iniJanela > idx) continue
    for await (const { pagina, itens } of c.api.paginas<any>(path, j.params, iniJanela === idx ? (c.job.cursor.pagina ?? 1) : 1)) {
      for (const resumo of itens) {
        try {
          if (await importarConta(c, tipo, resumo, { mapaCat, catPadrao, contaBaixa, importarVendas })) c.importados++
        } catch (e) {
          await c.logar('erro', `Conta a ${tipo} ${resumo.id}: ${(e as Error).message}`)
        }
      }
      await c.salvarCursor({ janela: j.chave, pagina: pagina + 1 })
      if (c.semTempo()) throw new Pausa()
    }
  }
}

async function importarConta(c: Contexto, tipo: 'pagar' | 'receber', resumo: any,
  o: { mapaCat: Map<string, string | null>; catPadrao: string; contaBaixa: string | null; importarVendas: boolean }) {
  const externo = `${tipo === 'pagar' ? 'CP' : 'CR'}-${resumo.id}`
  const { data: existente } = await c.svc.from('titulos').select('id, valor, valor_pago, status').eq('organizacao_id', c.org)
    .eq('origem', 'bling').eq('external_id', externo).maybeSingle()
  const situacao = Number(resumo.situacao)
  if (situacao === SITUACAO_CONTA.cancelado || situacao === SITUACAO_CONTA.devolvido) {
    if (existente && existente.status !== 'cancelado' && Number(existente.valor_pago) === 0) {
      await c.svc.from('titulos').update({ status: 'cancelado' }).eq('id', existente.id); return true
    }
    return false
  }
  const { data: d } = await c.api.get<{ data: any }>(`/contas/${tipo}/${resumo.id}`)
  if (!d) return false
  // contas a receber geradas por pedidos de venda já entram pelos recebíveis da venda
  if (tipo === 'receber' && o.importarVendas && String(d.origem?.tipoOrigem ?? '').toLowerCase() === 'venda') return false
  const valor = r2(Number(d.valor))
  if (!(valor > 0)) return false
  const categoria = o.mapaCat.get(String(d.categoria?.id ?? '')) ?? o.catPadrao
  const comp = d.competencia || d.dataEmissao || d.vencimento
  const campos = {
    descricao: (d.historico || `${tipo === 'pagar' ? 'Conta a pagar' : 'Conta a receber'} Bling ${d.numeroDocumento ?? resumo.id}`).slice(0, 300),
    data_vencimento: d.vencimento, documento: d.numeroDocumento || null,
  }
  let tituloId = existente?.id as string | undefined
  if (!existente) {
    const { data: novo, error } = await c.svc.from('titulos').insert({
      organizacao_id: c.org, empresa_id: c.integ.empresa_id, tipo, ...campos, categoria_id: categoria,
      contato_id: await contatoId(c, d.contato), valor, data_emissao: d.dataEmissao || d.vencimento, data_competencia: comp,
      origem: 'bling', external_id: externo,
    }).select('id').single()
    if (error) throw new Error(error.message)
    tituloId = novo.id
  } else if (Number(existente.valor_pago) === 0) {
    const { error } = await c.svc.from('titulos').update({ ...campos, valor, categoria_id: categoria, data_competencia: comp }).eq('id', existente.id)
    if (error) throw new Error(error.message)
  } else {
    await c.svc.from('titulos').update(campos).eq('id', existente.id)
  }
  // Pagamentos registrados no Bling: só viram baixa se a organização definiu a conta de baixa (senão, conciliar via OFX)
  if (o.contaBaixa && (situacao === SITUACAO_CONTA.pago || situacao === SITUACAO_CONTA.parcial)) {
    const pagoBling = r2(valor - Number(d.saldo ?? 0))
    const { data: t } = await c.svc.from('titulos').select('valor_pago').eq('id', tituloId).single()
    const falta = r2(pagoBling - Number(t?.valor_pago ?? 0))
    if (falta > 0) {
      const data = [d.vencimento, hojeSP()].sort()[0]
      const { error } = await c.svc.rpc('fn_baixar_titulo', { p_titulo: tituloId, p_conta: o.contaBaixa, p_data: data,
        p_valor_principal: falta, p_observacao: 'Baixa importada do Bling', p_idempotency_key: `bling:${externo}:${pagoBling}` })
      if (error) await c.logar('aviso', `Baixa da conta ${externo} não registrada: ${error.message}`)
    }
  }
  return true
}

// ---------------------------------------------------------------------------------------------
async function processar(svc: SupabaseClient, job: Job, prazo: number) {
  const { data: integ } = await svc.from('integracoes').select('*').eq('id', job.integracao_id).single()
  if (!integ || !['conectado', 'erro'].includes(integ.status)) {
    await svc.from('sync_jobs').update({ status: 'cancelado', erro: 'Integração desconectada', finished_at: new Date().toISOString() }).eq('id', job.id)
    return
  }
  const c = new Contexto(svc, new BlingApi(svc, integ.id), job, integ, prazo)
  try {
    if (!job.cursor || Object.keys(job.cursor).length === 0) await c.logar('info', `Iniciando sincronização (${job.tipo}) de ${job.recurso}`)
    switch (job.recurso) {
      case 'cadastros': await syncCadastros(c); break
      case 'produtos': await syncProdutos(c); break
      case 'contatos': await syncContatos(c); break
      case 'vendas': await syncVendas(c); break
      case 'venda_unica': await syncVendaUnica(c); break
      case 'contas_pagar': await syncContas(c, 'pagar'); break
      case 'contas_receber': await syncContas(c, 'receber'); break
    }
    const total = job.registros_importados + c.importados
    await svc.from('sync_jobs').update({ status: 'concluido', finished_at: new Date().toISOString(), registros_importados: total, erro: null }).eq('id', job.id)
    await svc.from('integracoes').update({ ultima_sincronizacao: new Date().toISOString(), status: 'conectado', ultimo_erro: null }).eq('id', integ.id)
    await c.logar('info', `Sincronização de ${job.recurso} concluída: ${total} registro(s).`, { requisicoes: c.api.requisicoes })
  } catch (e) {
    if (e instanceof Pausa) {
      await svc.from('sync_jobs').update({ status: 'pendente', locked_at: null, tentativas: Math.max(0, job.tentativas - 1),
        registros_importados: job.registros_importados + c.importados, proxima_execucao: new Date().toISOString() }).eq('id', job.id)
      return
    }
    const msg = e instanceof BlingErro ? `${e.message}: ${JSON.stringify(e.corpo)?.slice(0, 500)}` : String((e as Error)?.message ?? e)
    const esgotou = job.tentativas >= job.max_tentativas || (e instanceof BlingErro && e.status === 401)
    // espera progressiva: 2, 4, 8, 16, 32 min
    await svc.from('sync_jobs').update({
      status: esgotou ? 'erro' : 'pendente', erro: msg, locked_at: null,
      registros_importados: job.registros_importados + c.importados,
      proxima_execucao: new Date(Date.now() + 60_000 * 2 ** job.tentativas).toISOString(),
      finished_at: esgotou ? new Date().toISOString() : null,
    }).eq('id', job.id)
    if (esgotou) await svc.from('integracoes').update({ status: e instanceof BlingErro && e.status === 401 ? 'reautorizar' : 'erro', ultimo_erro: msg }).eq('id', integ.id)
    await c.logar('erro', `Falha em ${job.recurso} (tentativa ${job.tentativas}): ${msg}`)
    log('erro', 'sync job', { job: job.id, recurso: job.recurso, erro: msg })
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  const svc = serviceClient()
  const cron = req.headers.get('x-cron-secret')
  if (cron) {
    if (!igualSeguro(cron, env('CRON_SECRET'))) return json({ erro: 'Não autorizado' }, 401)
  } else {
    const auth = await usuarioAutenticado(req)
    if (!auth) return json({ erro: 'Não autenticado' }, 401)
    const body = await req.json().catch(() => ({}))
    const { data: n, error } = await auth.client.rpc('fn_agendar_sync', { p_integracao: body.integracao_id, p_tipo: 'manual',
      p_recursos: body.recursos ?? undefined })
    if (error) return json({ erro: error.message }, 400)
    log('info', 'sync manual agendada', { integracao: body.integracao_id, jobs: n })
  }
  const prazo = Date.now() + ORCAMENTO_MS; let processados = 0
  // processa enquanto houver tempo (o restante continua no próximo disparo do cron)
  while (Date.now() < prazo - 10_000) {
    const { data: jobs, error } = await svc.rpc('fn_claim_sync_jobs', { p_limite: 3 })
    if (error) { log('erro', 'claim', { erro: error.message }); break }
    if (!jobs?.length) break
    await Promise.all((jobs as Job[]).map(j => processar(svc, j, prazo)))
    processados += jobs.length
  }
  return json({ ok: true, processados })
})
