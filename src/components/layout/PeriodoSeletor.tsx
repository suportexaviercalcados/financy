import { useOrg } from '@/contexts/org'
import { fimMes, hoje, inicioMes, somaDias, somaMeses } from '@/lib/format'
import { Seletor } from '@/components/form'
import { Input } from '@/components/ui/input'

const PRESETS: Record<string, () => { inicio: string; fim: string }> = {
  mes: () => ({ inicio: inicioMes(hoje()), fim: fimMes(hoje()) }),
  mes_anterior: () => { const i = somaMeses(inicioMes(hoje()), -1); return { inicio: i, fim: fimMes(i) } },
  d30: () => ({ inicio: somaDias(hoje(), -29), fim: hoje() }),
  trimestre: () => {
    const h = hoje(); const m = Math.floor((Number(h.slice(5, 7)) - 1) / 3) * 3 + 1
    const i = `${h.slice(0, 4)}-${String(m).padStart(2, '0')}-01`; return { inicio: i, fim: fimMes(somaMeses(i, 2)) }
  },
  ano: () => ({ inicio: hoje().slice(0, 4) + '-01-01', fim: hoje().slice(0, 4) + '-12-31' }),
  ano_anterior: () => { const y = Number(hoje().slice(0, 4)) - 1; return { inicio: `${y}-01-01`, fim: `${y}-12-31` } },
  m12: () => ({ inicio: somaMeses(inicioMes(hoje()), -11), fim: fimMes(hoje()) }),
}
const ROTULOS: Record<string, string> = { mes: 'Este mês', mes_anterior: 'Mês anterior', d30: 'Últimos 30 dias', trimestre: 'Este trimestre',
  ano: 'Este ano', ano_anterior: 'Ano anterior', m12: 'Últimos 12 meses', custom: 'Personalizado' }

export function PeriodoSeletor() {
  const { periodo, setPeriodo } = useOrg()
  const atual = Object.keys(PRESETS).find(k => { const p = PRESETS[k](); return p.inicio === periodo.inicio && p.fim === periodo.fim }) ?? 'custom'
  return (
    // no celular os filhos entram direto no cabeçalho (contents) e vão para depois dos botões
    <div className="flex flex-wrap items-center gap-1.5 max-md:contents">
      <Seletor aria-label="Período" className="w-auto max-md:order-last" value={atual}
        onChange={e => e.target.value !== 'custom' && setPeriodo(PRESETS[e.target.value]())}
        opcoes={Object.entries(ROTULOS).map(([value, label]) => ({ value, label }))} />
      <span className="flex items-center gap-1.5 max-md:order-last">
      <Input type="date" aria-label="Data inicial" className="w-36" value={periodo.inicio}
        onChange={e => e.target.value && setPeriodo({ inicio: e.target.value, fim: e.target.value > periodo.fim ? e.target.value : periodo.fim })} />
      <span className="text-xs text-muted-foreground">até</span>
      <Input type="date" aria-label="Data final" className="w-36" value={periodo.fim}
        onChange={e => e.target.value && setPeriodo({ inicio: e.target.value < periodo.inicio ? e.target.value : periodo.inicio, fim: e.target.value })} />
      </span>
    </div>
  )
}
