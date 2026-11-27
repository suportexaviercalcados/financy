// Andamento da meta mensal de um vendedor (dias corridos do mês, fuso de Brasília)
import { diffDias, fimMes, inicioMes } from './format'

export interface Andamento {
  pct: number; falta: number
  diasMes: number; diasDecorridos: number; diasRestantes: number
  ritmoAtual: number        // vendido ÷ dias decorridos
  ritmoNecessario: number   // falta ÷ dias restantes (contando hoje)
  projecao: number          // vendido no ritmo atual até o fim do mês
}

export function andamento(meta: number, vendido: number, mes: string, hoje: string): Andamento {
  const ini = inicioMes(mes); const fim = fimMes(mes)
  const diasMes = diffDias(ini, fim) + 1
  const diasDecorridos = hoje < ini ? 0 : hoje > fim ? diasMes : diffDias(ini, hoje) + 1
  // hoje ainda conta como dia para vender
  const diasRestantes = hoje < ini ? diasMes : hoje > fim ? 0 : diasMes - diasDecorridos + 1
  const falta = Math.max(0, meta - vendido)
  const ritmoAtual = diasDecorridos ? vendido / diasDecorridos : 0
  return {
    pct: meta > 0 ? (vendido / meta) * 100 : 0, falta, diasMes, diasDecorridos, diasRestantes,
    ritmoAtual, ritmoNecessario: diasRestantes ? falta / diasRestantes : falta, projecao: ritmoAtual * diasMes,
  }
}

// ----- Metas em 3 níveis: a meta digitada é a Alcançável; as outras são um acréscimo percentual sobre ela -----
export interface NiveisConfig { pct_desejavel: number; pct_super: number; com_alcancavel: number; com_desejavel: number; com_super: number }
export const NIVEIS_PADRAO: NiveisConfig = { pct_desejavel: 20, pct_super: 30, com_alcancavel: 1, com_desejavel: 1.5, com_super: 2 }

export interface Nivel { nome: string; meta: number; comissaoPct: number; pctBase: number }   // pctBase: % da Alcançável (100, 120, 130)

const r2 = (v: number) => Math.round(v * 100) / 100

export function niveisDaMeta(base: number, c: NiveisConfig): Nivel[] {
  const nivel = (nome: string, acrescimo: number, comissaoPct: number): Nivel =>
    ({ nome, meta: r2(base * (1 + Number(acrescimo) / 100)), comissaoPct: Number(comissaoPct), pctBase: 100 + Number(acrescimo) })
  return [nivel('Alcançável', 0, c.com_alcancavel), nivel('Desejável', c.pct_desejavel, c.com_desejavel), nivel('Supermeta', c.pct_super, c.com_super)]
}

/** Nível atingido e comissão: o percentual do nível vale sobre todo o valor vendido; abaixo da Alcançável não há comissão. */
export function comissaoDaMeta(base: number, vendido: number, c: NiveisConfig) {
  const niveis = niveisDaMeta(base, c)
  const atingidos = base > 0 ? niveis.filter(n => vendido >= n.meta).length : 0
  const atual = atingidos ? niveis[atingidos - 1] : null
  return { niveis, atual, proximo: niveis[atingidos] ?? null, comissao: atual ? r2(vendido * atual.comissaoPct / 100) : 0 }
}
