// Exportação de tabelas para Excel (xlsx) e PDF (jspdf-autotable)
import * as XLSX from 'xlsx'
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

export interface ColunaExport { titulo: string; valor: (linha: any) => string | number | null | undefined }

export function exportarExcel(nome: string, colunas: ColunaExport[], linhas: any[]) {
  const dados = [colunas.map(c => c.titulo), ...linhas.map(l => colunas.map(c => c.valor(l) ?? ''))]
  const ws = XLSX.utils.aoa_to_sheet(dados)
  ws['!cols'] = colunas.map(c => ({ wch: Math.max(12, c.titulo.length + 2) }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, nome.slice(0, 31))
  XLSX.writeFile(wb, `${nome}.xlsx`)
}

export function exportarPDF(nome: string, titulo: string, subtitulo: string, colunas: ColunaExport[], linhas: any[],
  destaque?: (linha: any) => boolean) {
  const doc = new jsPDF({ orientation: colunas.length > 6 ? 'landscape' : 'portrait' })
  doc.setFontSize(14); doc.text(titulo, 14, 16)
  doc.setFontSize(9); doc.setTextColor(110); doc.text(subtitulo, 14, 22)
  autoTable(doc, {
    startY: 27,
    head: [colunas.map(c => c.titulo)],
    body: linhas.map(l => colunas.map(c => String(c.valor(l) ?? ''))),
    styles: { fontSize: 8, cellPadding: 1.8 },
    headStyles: { fillColor: [55, 65, 140] },
    columnStyles: Object.fromEntries(colunas.map((_, i) => [i, { halign: i === 0 ? 'left' : 'right' }])),
    didParseCell: (d) => { if (d.section === 'body' && destaque?.(linhas[d.row.index])) d.cell.styles.fontStyle = 'bold' },
  })
  doc.save(`${nome}.pdf`)
}
