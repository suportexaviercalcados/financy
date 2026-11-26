/** Separa a seleção do lote: excluir (manual/planilha sem baixa), cancelar (Bling, empréstimos etc. sem baixa), pular (com baixa ou de venda) */
export function separarExclusaoLote<T extends { origem: string; valor_pago: number; venda_id: string | null; status: string }>(ts: T[]) {
  const r = { excluir: [] as T[], cancelar: [] as T[], pular: [] as T[] }
  for (const t of ts) {
    if (Number(t.valor_pago) > 0 || t.venda_id) r.pular.push(t)
    else if (t.origem === 'manual') r.excluir.push(t)
    else if (t.status !== 'cancelado') r.cancelar.push(t)
    else r.pular.push(t)
  }
  return r
}
