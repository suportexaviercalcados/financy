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
