import { describe, it, expect } from 'vitest'
import { separarExclusaoLote } from './contasLote'

describe('exclusão de contas em lote', () => {
  it('exclui manuais sem baixa, cancela Bling/empréstimo e pula pagas, de venda e já canceladas', () => {
    const t = (id: string, origem: string, valor_pago = 0, status = 'aberto', venda_id: string | null = null) => ({ id, origem, valor_pago, status, venda_id })
    const r = separarExclusaoLote([
      t('manual', 'manual'), t('manual-cancelada', 'manual', 0, 'cancelado'), t('bling', 'bling'), t('emp', 'emprestimo'),
      t('paga', 'manual', 10, 'parcial'), t('venda', 'venda', 0, 'aberto', 'v1'), t('bling-cancelada', 'bling', 0, 'cancelado'),
    ])
    expect(r.excluir.map(x => x.id)).toEqual(['manual', 'manual-cancelada'])
    expect(r.cancelar.map(x => x.id)).toEqual(['bling', 'emp'])
    expect(r.pular.map(x => x.id)).toEqual(['paga', 'venda', 'bling-cancelada'])
  })
})
