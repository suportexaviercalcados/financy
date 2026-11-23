import { useParams, Navigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { CrudPage, type CrudConfig } from '@/components/CrudPage'
import { Aviso, Dinheiro, Status } from '@/components/common'
import { useOrg } from '@/contexts/org'
import { useAdquirentes, useCanais, useCategorias, useCentros, useContasBancarias, useContatos, useFormas, useProdutos, opcoes, opcoesCategoria } from '@/hooks/lookups'
import { brl, cnpj, cnpjValido, data, hoje, pct, soDigitos } from '@/lib/format'
import { rpc } from '@/lib/supabase'
import { TIPOS_CONTA } from './Onboarding'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

const SIM_NAO = (v: boolean) => (v ? 'Sim' : 'Não')
const ativo = (r: any) => (r.ativo ? <Badge variant="secondary">Ativo</Badge> : <Badge variant="outline">Inativo</Badge>)

export const DRE_GRUPOS = [
  { value: 'receita_bruta', label: 'Receita bruta' }, { value: 'deducoes_impostos', label: 'Deduções — impostos sobre vendas' },
  { value: 'deducoes_devolucoes', label: 'Deduções — devoluções e descontos' }, { value: 'cmv', label: 'CMV' },
  { value: 'despesa_variavel', label: 'Despesas variáveis de venda' }, { value: 'despesa_fixa', label: 'Despesas fixas' },
  { value: 'depreciacao', label: 'Depreciação' }, { value: 'receita_financeira', label: 'Receitas financeiras' },
  { value: 'despesa_financeira', label: 'Despesas financeiras' }, { value: 'impostos_lucro', label: 'IRPJ/CSLL' },
  { value: 'nao_dre', label: 'Não entra na DRE' },
]
export const DFC_GRUPOS = [{ value: 'operacional', label: 'Operacional' }, { value: 'investimento', label: 'Investimento' },
  { value: 'financiamento', label: 'Financiamento' }, { value: 'nao_dfc', label: 'Sem efeito caixa' }]
const rotulo = (l: { value: string; label: string }[], v: string) => l.find(x => x.value === v)?.label ?? v

export default function Cadastros() {
  const { pagina } = useParams()
  const { empresas } = useOrg()
  const qc = useQueryClient()
  const cats = useCategorias(); const contatos = useContatos(); const centros = useCentros(); const canais = useCanais()
  const formas = useFormas(); const adq = useAdquirentes(); const contas = useContasBancarias(); const prods = useProdutos()
  const empOpc = empresas.map(e => ({ value: e.id, label: e.nome_fantasia || e.razao_social }))
  const nomeDe = (l: { id: string; nome: string }[] | undefined, id?: string | null) => l?.find(x => x.id === id)?.nome ?? '—'

  const configs: Record<string, CrudConfig> = {
    empresas: {
      tabela: 'empresas', titulo: 'Empresas', singular: 'Empresa', ordem: 'razao_social',
      descricao: 'CNPJs da organização, com regime tributário e alíquota usada para estimar impostos sobre vendas na DRE.',
      campos: [
        { nome: 'razao_social', rotulo: 'Razão social', tipo: 'texto', obrigatorio: true },
        { nome: 'nome_fantasia', rotulo: 'Nome fantasia', tipo: 'texto' },
        { nome: 'cnpj', rotulo: 'CNPJ', tipo: 'texto' },
        { nome: 'regime_tributario', rotulo: 'Regime tributário', tipo: 'selecao', obrigatorio: true, padrao: 'simples',
          opcoes: [{ value: 'simples', label: 'Simples Nacional' }, { value: 'presumido', label: 'Lucro Presumido' }, { value: 'real', label: 'Lucro Real' }] },
        { nome: 'aliquota_imposto_vendas', rotulo: 'Alíquota efetiva sobre vendas (%)', tipo: 'percentual', padrao: 0 },
        { nome: 'imposto_vendas_modo', rotulo: 'Impostos sobre vendas na DRE', tipo: 'selecao', padrao: 'estimado',
          opcoes: [{ value: 'estimado', label: 'Estimar pela alíquota' }, { value: 'lancado', label: 'Usar guias lançadas' }] },
        { nome: 'ativo', rotulo: 'Ativa', tipo: 'booleano', padrao: true },
      ],
      validar: (r) => (r.cnpj && !cnpjValido(r.cnpj) ? 'CNPJ inválido.' : null),
      preparar: (r) => ({ ...r, cnpj: r.cnpj ? soDigitos(r.cnpj) : null }),
      aposSalvar: () => qc.invalidateQueries({ queryKey: ['empresas'] }),
      colunas: [
        { id: 'razao', titulo: 'Razão social', celula: r => r.razao_social, valor: r => r.razao_social },
        { id: 'cnpj', titulo: 'CNPJ', celula: r => cnpj(r.cnpj), valor: r => r.cnpj },
        { id: 'regime', titulo: 'Regime', celula: r => ({ simples: 'Simples', presumido: 'Presumido', real: 'Real' } as any)[r.regime_tributario], valor: r => r.regime_tributario },
        { id: 'aliq', titulo: 'Alíquota', alinhar: 'right', celula: r => pct(r.aliquota_imposto_vendas, 2), valor: r => Number(r.aliquota_imposto_vendas) },
        { id: 'ativo', titulo: 'Status', celula: ativo },
      ],
    },
    'plano-contas': {
      tabela: 'plano_contas', titulo: 'Plano de contas', singular: 'Categoria', ordem: 'codigo', ordemInicial: { id: 'codigo' },
      descricao: 'Estrutura hierárquica classificada para a DRE (competência) e para a DFC (caixa). Categorias de sistema alimentam os cálculos automáticos.',
      campos: [
        { nome: 'codigo', rotulo: 'Código', tipo: 'texto', obrigatorio: true, ajuda: 'Ex.: 5.3.5' },
        { nome: 'nome', rotulo: 'Nome', tipo: 'texto', obrigatorio: true },
        { nome: 'parent_id', rotulo: 'Categoria pai', tipo: 'selecao', vazio: '(nível raiz)', opcoes: (cats.data ?? []).filter(c => !c.aceita_lancamento).map(c => ({ value: c.id, label: `${c.codigo} ${c.nome}` })) },
        { nome: 'natureza', rotulo: 'Natureza', tipo: 'selecao', obrigatorio: true, padrao: 'saida', opcoes: [{ value: 'entrada', label: 'Entrada (receita)' }, { value: 'saida', label: 'Saída (despesa)' }] },
        { nome: 'dre_grupo', rotulo: 'Linha da DRE', tipo: 'selecao', obrigatorio: true, padrao: 'despesa_fixa', opcoes: DRE_GRUPOS, desabilitado: r => !!r.chave_sistema },
        { nome: 'dfc_grupo', rotulo: 'Atividade na DFC', tipo: 'selecao', obrigatorio: true, padrao: 'operacional', opcoes: DFC_GRUPOS, desabilitado: r => !!r.chave_sistema },
        { nome: 'aceita_lancamento', rotulo: 'Aceita lançamentos (categoria analítica)', tipo: 'booleano', padrao: true },
        { nome: 'ativo', rotulo: 'Ativa', tipo: 'booleano', padrao: true },
      ],
      podeExcluir: r => !r.chave_sistema,
      aposSalvar: () => qc.invalidateQueries({ queryKey: ['plano_contas'] }),
      colunas: [
        { id: 'codigo', titulo: 'Código', celula: r => <span className="tabular text-muted-foreground">{r.codigo}</span>, valor: r => r.codigo },
        { id: 'nome', titulo: 'Categoria', valor: r => r.nome, celula: r => (
          <span className={cn(!r.aceita_lancamento && 'font-semibold')} style={{ paddingLeft: `${(r.codigo.split('.').length - 1) * 16}px` }}>
            {r.nome}{r.chave_sistema && <Badge variant="outline" className="ml-2 text-[10px]">sistema</Badge>}
          </span>) },
        { id: 'dre', titulo: 'DRE', celula: r => rotulo(DRE_GRUPOS, r.dre_grupo), valor: r => rotulo(DRE_GRUPOS, r.dre_grupo) },
        { id: 'dfc', titulo: 'DFC', celula: r => rotulo(DFC_GRUPOS, r.dfc_grupo), valor: r => rotulo(DFC_GRUPOS, r.dfc_grupo) },
        { id: 'ativo', titulo: 'Status', celula: ativo },
      ],
    },
    'centros-custo': {
      tabela: 'centros_custo', titulo: 'Centros de custo', singular: 'Centro de custo',
      campos: [{ nome: 'codigo', rotulo: 'Código', tipo: 'texto' }, { nome: 'nome', rotulo: 'Nome', tipo: 'texto', obrigatorio: true },
        { nome: 'ativo', rotulo: 'Ativo', tipo: 'booleano', padrao: true }],
      colunas: [{ id: 'cod', titulo: 'Código', celula: r => r.codigo, valor: r => r.codigo }, { id: 'nome', titulo: 'Nome', celula: r => r.nome, valor: r => r.nome },
        { id: 'ativo', titulo: 'Status', celula: ativo }],
    },
    'contas-bancarias': {
      tabela: 'contas_bancarias', titulo: 'Contas bancárias e caixas', singular: 'Conta',
      descricao: 'O saldo inicial representa o saldo na data de corte; movimentos anteriores a essa data não são aceitos.',
      campos: [
        { nome: 'empresa_id', rotulo: 'Empresa', tipo: 'selecao', obrigatorio: true, opcoes: empOpc, padrao: empOpc[0]?.value },
        { nome: 'nome', rotulo: 'Nome', tipo: 'texto', obrigatorio: true },
        { nome: 'tipo', rotulo: 'Tipo', tipo: 'selecao', obrigatorio: true, opcoes: TIPOS_CONTA, padrao: 'corrente' },
        { nome: 'banco', rotulo: 'Banco', tipo: 'texto' }, { nome: 'agencia', rotulo: 'Agência', tipo: 'texto' }, { nome: 'numero', rotulo: 'Número', tipo: 'texto' },
        { nome: 'saldo_inicial', rotulo: 'Saldo inicial', tipo: 'dinheiro', padrao: 0 },
        { nome: 'data_saldo_inicial', rotulo: 'Data do saldo inicial', tipo: 'data', obrigatorio: true, padrao: hoje },
        { nome: 'ativo', rotulo: 'Ativa', tipo: 'booleano', padrao: true },
      ],
      aposSalvar: () => qc.invalidateQueries({ queryKey: ['contas_bancarias'] }),
      colunas: [
        { id: 'nome', titulo: 'Conta', celula: r => r.nome, valor: r => r.nome },
        { id: 'emp', titulo: 'Empresa', celula: r => empOpc.find(e => e.value === r.empresa_id)?.label, valor: r => empOpc.find(e => e.value === r.empresa_id)?.label },
        { id: 'tipo', titulo: 'Tipo', celula: r => rotulo(TIPOS_CONTA, r.tipo), valor: r => r.tipo },
        { id: 'banco', titulo: 'Banco / agência / conta', celula: r => [r.banco, r.agencia, r.numero].filter(Boolean).join(' · ') || '—' },
        { id: 'si', titulo: 'Saldo inicial', alinhar: 'right', celula: r => <Dinheiro v={r.saldo_inicial} />, valor: r => Number(r.saldo_inicial) },
        { id: 'dt', titulo: 'Data do saldo', celula: r => data(r.data_saldo_inicial), valor: r => r.data_saldo_inicial },
        { id: 'ativo', titulo: 'Status', celula: ativo },
      ],
    },
    'formas-pagamento': {
      tabela: 'formas_pagamento', titulo: 'Formas de pagamento', singular: 'Forma de pagamento',
      campos: [{ nome: 'nome', rotulo: 'Nome', tipo: 'texto', obrigatorio: true },
        { nome: 'tipo', rotulo: 'Tipo', tipo: 'selecao', obrigatorio: true, opcoes: TIPOS_FORMA }, { nome: 'ativo', rotulo: 'Ativa', tipo: 'booleano', padrao: true }],
      aposSalvar: () => qc.invalidateQueries({ queryKey: ['formas_pagamento'] }),
      colunas: [{ id: 'nome', titulo: 'Nome', celula: r => r.nome, valor: r => r.nome },
        { id: 'tipo', titulo: 'Tipo', celula: r => rotulo(TIPOS_FORMA, r.tipo), valor: r => r.tipo }, { id: 'ativo', titulo: 'Status', celula: ativo }],
    },
    adquirentes: {
      tabela: 'adquirentes', titulo: 'Adquirentes, maquininhas e gateways', singular: 'Adquirente',
      descricao: 'Usados nos recebíveis de cartão. As taxas e prazos ficam em Canais e taxas.',
      campos: [{ nome: 'nome', rotulo: 'Nome', tipo: 'texto', obrigatorio: true },
        { nome: 'tipo', rotulo: 'Tipo', tipo: 'selecao', obrigatorio: true, padrao: 'maquininha', opcoes: [{ value: 'maquininha', label: 'Maquininha' }, { value: 'gateway', label: 'Gateway' }, { value: 'marketplace', label: 'Marketplace' }, { value: 'outro', label: 'Outro' }] },
        { nome: 'ativo', rotulo: 'Ativo', tipo: 'booleano', padrao: true }],
      aposSalvar: () => qc.invalidateQueries({ queryKey: ['adquirentes'] }),
      colunas: [{ id: 'nome', titulo: 'Nome', celula: r => r.nome, valor: r => r.nome }, { id: 'tipo', titulo: 'Tipo', celula: r => r.tipo, valor: r => r.tipo }, { id: 'ativo', titulo: 'Status', celula: ativo }],
    },
    contatos: {
      tabela: 'contatos', titulo: 'Clientes e fornecedores', singular: 'Contato', permissao: 'escrita',
      campos: [{ nome: 'nome', rotulo: 'Nome', tipo: 'texto', obrigatorio: true },
        { nome: 'tipo', rotulo: 'Tipo', tipo: 'selecao', padrao: 'ambos', obrigatorio: true, opcoes: [{ value: 'cliente', label: 'Cliente' }, { value: 'fornecedor', label: 'Fornecedor' }, { value: 'ambos', label: 'Cliente e fornecedor' }] },
        { nome: 'documento', rotulo: 'CPF/CNPJ', tipo: 'texto' }, { nome: 'email', rotulo: 'E-mail', tipo: 'texto' }, { nome: 'telefone', rotulo: 'Telefone', tipo: 'texto' }],
      aposSalvar: () => qc.invalidateQueries({ queryKey: ['contatos'] }),
      colunas: [{ id: 'nome', titulo: 'Nome', celula: r => r.nome, valor: r => r.nome }, { id: 'tipo', titulo: 'Tipo', celula: r => r.tipo, valor: r => r.tipo },
        { id: 'doc', titulo: 'Documento', celula: r => r.documento ?? '—', valor: r => r.documento }, { id: 'email', titulo: 'E-mail', celula: r => r.email ?? '—', valor: r => r.email },
        { id: 'origem', titulo: 'Origem', celula: r => r.origem === 'bling' ? <Badge variant="outline">Bling</Badge> : 'Manual', valor: r => r.origem }],
    },
    produtos: {
      tabela: 'produtos', titulo: 'Produtos e custos', singular: 'Produto', permissao: 'escrita',
      descricao: 'O custo é usado para calcular o CMV de cada venda. Produtos sem custo deixam o CMV e a margem incompletos.',
      topo: (prods.data?.filter(p => p.ativo && p.custo == null).length ?? 0) > 0
        ? <Aviso className="mb-4">{prods.data!.filter(p => p.ativo && p.custo == null).length} produto(s) ativo(s) sem custo cadastrado — as vendas desses itens aparecem com CMV incompleto.</Aviso> : undefined,
      campos: [{ nome: 'nome', rotulo: 'Nome', tipo: 'texto', obrigatorio: true, largo: true }, { nome: 'sku', rotulo: 'SKU / código', tipo: 'texto' },
        { nome: 'preco', rotulo: 'Preço de venda', tipo: 'dinheiro', padrao: 0 }, { nome: 'custo', rotulo: 'Custo unitário', tipo: 'dinheiro', ajuda: 'Deixe vazio se não souber (o sistema sinaliza o dado faltante).' },
        { nome: 'ativo', rotulo: 'Ativo', tipo: 'booleano', padrao: true }],
      aposSalvar: () => qc.invalidateQueries({ queryKey: ['produtos'] }),
      colunas: [{ id: 'sku', titulo: 'SKU', celula: r => r.sku ?? '—', valor: r => r.sku }, { id: 'nome', titulo: 'Produto', celula: r => r.nome, valor: r => r.nome },
        { id: 'preco', titulo: 'Preço', alinhar: 'right', celula: r => brl(r.preco), valor: r => Number(r.preco) },
        { id: 'custo', titulo: 'Custo', alinhar: 'right', celula: r => r.custo == null ? <Badge variant="destructive">sem custo</Badge> : brl(r.custo), valor: r => r.custo == null ? -1 : Number(r.custo) },
        { id: 'margem', titulo: 'Margem', alinhar: 'right', celula: r => r.custo == null || !Number(r.preco) ? '—' : pct(100 * (r.preco - r.custo) / r.preco), valor: r => r.custo == null || !Number(r.preco) ? -999 : (r.preco - r.custo) / r.preco },
        { id: 'origem', titulo: 'Origem', celula: r => r.origem === 'bling' ? <Badge variant="outline">Bling</Badge> : 'Manual', valor: r => r.origem },
        { id: 'ativo', titulo: 'Status', celula: ativo }],
    },
    recorrencias: {
      tabela: 'recorrencias', titulo: 'Lançamentos recorrentes', singular: 'Recorrência', permissao: 'escrita', ordem: 'descricao',
      descricao: 'Aluguel, salários, assinaturas… Os títulos são gerados automaticamente para os próximos 12 meses (rotina diária).',
      campos: [
        { nome: 'empresa_id', rotulo: 'Empresa', tipo: 'selecao', obrigatorio: true, opcoes: empOpc, padrao: empOpc[0]?.value },
        { nome: 'tipo', rotulo: 'Tipo', tipo: 'selecao', obrigatorio: true, padrao: 'pagar', opcoes: [{ value: 'pagar', label: 'A pagar' }, { value: 'receber', label: 'A receber' }] },
        { nome: 'descricao', rotulo: 'Descrição', tipo: 'texto', obrigatorio: true, largo: true },
        { nome: 'categoria_id', rotulo: 'Categoria', tipo: 'selecao', obrigatorio: true, opcoes: opcoesCategoria(cats.data) },
        { nome: 'contato_id', rotulo: 'Fornecedor / cliente', tipo: 'selecao', opcoes: opcoes(contatos.data), vazio: '—' },
        { nome: 'centro_custo_id', rotulo: 'Centro de custo', tipo: 'selecao', opcoes: opcoes(centros.data), vazio: '—' },
        { nome: 'valor', rotulo: 'Valor', tipo: 'dinheiro', obrigatorio: true },
        { nome: 'frequencia', rotulo: 'Frequência', tipo: 'selecao', padrao: 'mensal', opcoes: [{ value: 'semanal', label: 'Semanal' }, { value: 'mensal', label: 'Mensal' }, { value: 'anual', label: 'Anual' }] },
        { nome: 'dia_vencimento', rotulo: 'Dia do vencimento', tipo: 'numero', mostrar: r => r.frequencia === 'mensal' },
        { nome: 'data_inicio', rotulo: 'Início', tipo: 'data', obrigatorio: true, padrao: hoje },
        { nome: 'data_fim', rotulo: 'Fim (opcional)', tipo: 'data' },
        { nome: 'ativo', rotulo: 'Ativa', tipo: 'booleano', padrao: true },
      ],
      validar: r => (r.dia_vencimento != null && (r.dia_vencimento < 1 || r.dia_vencimento > 31) ? 'Dia do vencimento entre 1 e 31.' : null),
      aposSalvar: async () => {
        const n = await rpc<number>('fn_gerar_recorrencias', {}).catch((e) => { toast.error(e.message); return 0 })
        if (n) toast.success(`${n} título(s) gerado(s).`)
        qc.invalidateQueries({ queryKey: ['titulos'] })
      },
      colunas: [
        { id: 'desc', titulo: 'Descrição', celula: r => r.descricao, valor: r => r.descricao },
        { id: 'tipo', titulo: 'Tipo', celula: r => r.tipo === 'pagar' ? 'A pagar' : 'A receber', valor: r => r.tipo },
        { id: 'cat', titulo: 'Categoria', celula: r => cats.data?.find(c => c.id === r.categoria_id)?.nome, valor: r => cats.data?.find(c => c.id === r.categoria_id)?.nome },
        { id: 'freq', titulo: 'Frequência', celula: r => r.frequencia + (r.dia_vencimento ? ` (dia ${r.dia_vencimento})` : ''), valor: r => r.frequencia },
        { id: 'valor', titulo: 'Valor', alinhar: 'right', celula: r => brl(r.valor), valor: r => Number(r.valor) },
        { id: 'per', titulo: 'Vigência', celula: r => `${data(r.data_inicio)} — ${r.data_fim ? data(r.data_fim) : 'indeterminado'}` },
        { id: 'ativo', titulo: 'Status', celula: ativo },
      ],
    },
  }

    const canaisCfg: CrudConfig = {
      tabela: 'canais_venda', titulo: 'Canais de venda', singular: 'Canal',
      descricao: 'Comissão, taxa de marketplace (descontada do repasse) e custo de frete são aplicados automaticamente a cada venda do canal.',
      campos: [
        { nome: 'nome', rotulo: 'Nome', tipo: 'texto', obrigatorio: true },
        { nome: 'tipo', rotulo: 'Tipo', tipo: 'selecao', obrigatorio: true, padrao: 'loja_fisica', opcoes: TIPOS_CANAL },
        { nome: 'comissao_percentual', rotulo: 'Comissão de vendedores (%)', tipo: 'percentual', padrao: 0 },
        { nome: 'taxa_marketplace_percentual', rotulo: 'Taxa de marketplace (%)', tipo: 'percentual', padrao: 0 },
        { nome: 'custo_frete_percentual', rotulo: 'Custo de frete estimado (% da venda)', tipo: 'percentual', padrao: 0 },
        { nome: 'rateio_percentual', rotulo: 'Rateio manual das despesas fixas (%)', tipo: 'percentual', ajuda: 'Usado na DRE por canal quando o rateio da organização for manual.' },
        { nome: 'ativo', rotulo: 'Ativo', tipo: 'booleano', padrao: true },
      ],
      aposSalvar: () => qc.invalidateQueries({ queryKey: ['canais_venda'] }),
      colunas: [
        { id: 'nome', titulo: 'Canal', celula: r => r.nome, valor: r => r.nome },
        { id: 'tipo', titulo: 'Tipo', celula: r => rotulo(TIPOS_CANAL, r.tipo), valor: r => r.tipo },
        { id: 'com', titulo: 'Comissão', alinhar: 'right', celula: r => pct(r.comissao_percentual, 2), valor: r => Number(r.comissao_percentual) },
        { id: 'mkt', titulo: 'Marketplace', alinhar: 'right', celula: r => pct(r.taxa_marketplace_percentual, 2), valor: r => Number(r.taxa_marketplace_percentual) },
        { id: 'frete', titulo: 'Frete', alinhar: 'right', celula: r => pct(r.custo_frete_percentual, 2), valor: r => Number(r.custo_frete_percentual) },
        { id: 'rateio', titulo: 'Rateio manual', alinhar: 'right', celula: r => r.rateio_percentual == null ? '—' : pct(r.rateio_percentual, 2) },
        { id: 'ativo', titulo: 'Status', celula: ativo },
      ],
    }
    const taxasCfg: CrudConfig = {
      tabela: 'canal_taxas', titulo: 'Taxas por forma de pagamento', singular: 'Taxa', ordem: 'parcelas_min',
      descricao: 'Taxa da maquininha/gateway por forma de pagamento e faixa de parcelas, com prazo de recebimento. Sem canal = vale para todos.',
      campos: [
        { nome: 'canal_id', rotulo: 'Canal', tipo: 'selecao', opcoes: opcoes(canais.data), vazio: 'Todos os canais' },
        { nome: 'forma_pagamento_id', rotulo: 'Forma de pagamento', tipo: 'selecao', obrigatorio: true, opcoes: opcoes(formas.data) },
        { nome: 'adquirente_id', rotulo: 'Adquirente', tipo: 'selecao', opcoes: opcoes(adq.data), vazio: '—' },
        { nome: 'conta_bancaria_id', rotulo: 'Conta de recebimento', tipo: 'selecao', opcoes: opcoes(contas.data), vazio: '—' },
        { nome: 'parcelas_min', rotulo: 'Parcelas de', tipo: 'numero', padrao: 1, obrigatorio: true },
        { nome: 'parcelas_max', rotulo: 'Parcelas até', tipo: 'numero', padrao: 1, obrigatorio: true },
        { nome: 'taxa_percentual', rotulo: 'Taxa (%)', tipo: 'percentual', padrao: 0 },
        { nome: 'taxa_fixa', rotulo: 'Taxa fixa por transação', tipo: 'dinheiro', padrao: 0 },
        { nome: 'prazo_dias', rotulo: 'Prazo da 1ª parcela (dias)', tipo: 'numero', padrao: 30 },
        { nome: 'intervalo_parcelas_dias', rotulo: 'Intervalo entre parcelas (dias)', tipo: 'numero', padrao: 30 },
      ],
      validar: r => (r.parcelas_max < r.parcelas_min ? '"Parcelas até" deve ser maior ou igual a "Parcelas de".' : null),
      colunas: [
        { id: 'canal', titulo: 'Canal', celula: r => r.canal_id ? nomeDe(canais.data, r.canal_id) : <span className="text-muted-foreground">Todos</span>, valor: r => nomeDe(canais.data, r.canal_id) },
        { id: 'forma', titulo: 'Forma', celula: r => nomeDe(formas.data, r.forma_pagamento_id), valor: r => nomeDe(formas.data, r.forma_pagamento_id) },
        { id: 'parc', titulo: 'Parcelas', celula: r => r.parcelas_min === r.parcelas_max ? `${r.parcelas_min}x` : `${r.parcelas_min}x a ${r.parcelas_max}x` },
        { id: 'taxa', titulo: 'Taxa', alinhar: 'right', celula: r => `${pct(r.taxa_percentual, 2)}${Number(r.taxa_fixa) ? ' + ' + brl(r.taxa_fixa) : ''}`, valor: r => Number(r.taxa_percentual) },
        { id: 'prazo', titulo: 'Prazo', alinhar: 'right', celula: r => `D+${r.prazo_dias}`, valor: r => r.prazo_dias },
        { id: 'adq', titulo: 'Adquirente', celula: r => r.adquirente_id ? nomeDe(adq.data, r.adquirente_id) : '—' },
        { id: 'conta', titulo: 'Conta', celula: r => r.conta_bancaria_id ? nomeDe(contas.data, r.conta_bancaria_id) : '—' },
      ],
    }
  if (pagina === 'canais') return <div className="space-y-12"><CrudPage cfg={canaisCfg} /><CrudPage cfg={taxasCfg} /></div>
  const cfg = configs[pagina ?? '']
  if (!cfg) return <Navigate to="/" replace />
  return <CrudPage key={pagina} cfg={cfg} />
}

export const TIPOS_FORMA = [{ value: 'dinheiro', label: 'Dinheiro' }, { value: 'pix', label: 'PIX' }, { value: 'debito', label: 'Cartão de débito' },
  { value: 'credito', label: 'Cartão de crédito' }, { value: 'boleto', label: 'Boleto' }, { value: 'transferencia', label: 'Transferência' },
  { value: 'marketplace', label: 'Repasse de marketplace' }, { value: 'crediario', label: 'Crediário' }, { value: 'outro', label: 'Outro' }]
export const TIPOS_CANAL = [{ value: 'loja_fisica', label: 'Loja física' }, { value: 'site', label: 'Site / e-commerce' }, { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'instagram', label: 'Instagram' }, { value: 'marketplace', label: 'Marketplace' }, { value: 'outro', label: 'Outro' }]

void SIM_NAO; void Status
