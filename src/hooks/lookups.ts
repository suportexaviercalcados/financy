// Cadastros usados em formulários e filtros (cache do TanStack Query por organização)
import { useQuery } from '@tanstack/react-query'
import { supabase, unwrap } from '@/lib/supabase'
import { useOrg } from '@/contexts/org'

export interface Categoria { id: string; parent_id: string | null; codigo: string; nome: string; natureza: 'entrada' | 'saida';
  dre_grupo: string; dfc_grupo: string; chave_sistema: string | null; aceita_lancamento: boolean; ativo: boolean }
export interface ContaBancaria { id: string; empresa_id: string; nome: string; tipo: string; banco: string | null; agencia: string | null;
  numero: string | null; saldo_inicial: number; data_saldo_inicial: string; ativo: boolean }

function useTabela<T>(tabela: string, select = '*', ordem = 'nome', extra?: (q: any) => any) {
  const { org } = useOrg()
  return useQuery({
    queryKey: [tabela, org?.id, select],
    enabled: !!org,
    staleTime: 60_000,
    queryFn: async () => {
      let q = supabase.from(tabela).select(select).eq('organizacao_id', org!.id).order(ordem)
      if (extra) q = extra(q)
      return unwrap(await q) as T[]
    },
  })
}

export const useCategorias = () => useTabela<Categoria>('plano_contas', '*', 'codigo')
export const useContasBancarias = () => useTabela<ContaBancaria>('contas_bancarias')
export const useContatos = () => useTabela<{ id: string; nome: string; tipo: string; documento: string | null }>('contatos', 'id, nome, tipo, documento')
export const useCentros = () => useTabela<{ id: string; nome: string; ativo: boolean }>('centros_custo')
export const useCanais = () => useTabela<{ id: string; nome: string; tipo: string; ativo: boolean; comissao_percentual: number;
  taxa_marketplace_percentual: number; custo_frete_percentual: number; rateio_percentual: number | null }>('canais_venda')
export const useFormas = () => useTabela<{ id: string; nome: string; tipo: string; ativo: boolean }>('formas_pagamento')
export const useAdquirentes = () => useTabela<{ id: string; nome: string; tipo: string }>('adquirentes')
export const useProdutos = () => useTabela<{ id: string; nome: string; sku: string | null; preco: number; custo: number | null; ativo: boolean }>(
  'produtos', 'id, nome, sku, preco, custo, ativo')

/** Opções de categoria para lançamento: só folhas ativas, filtradas pela natureza */
export const opcoesCategoria = (cats: Categoria[] | undefined, natureza?: 'entrada' | 'saida') =>
  (cats ?? []).filter(c => c.aceita_lancamento && c.ativo && (!natureza || c.natureza === natureza))
    .map(c => ({ value: c.id, label: `${c.codigo} — ${c.nome}` }))

export const opcoes = <T extends { id: string; nome: string }>(l: T[] | undefined) => (l ?? []).map(x => ({ value: x.id, label: x.nome }))
