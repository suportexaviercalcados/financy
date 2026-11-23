// Importação de contas a pagar/receber por planilha Excel, com prévia e correção de categoria por linha
import { useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, Download, FileSpreadsheet, Upload, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { supabase, rpc } from '@/lib/supabase'
import { useEmpresaPadrao, useOrg } from '@/contexts/org'
import { useCategorias, useCentros, useContatos } from '@/hooks/lookups'
import { baixarModelo, categoriasValidas, lerPlanilha, normalizar, rotuloCategoria, validarPlanilha, type LinhaPlanilha, type TipoConta } from '@/lib/planilhaContas'
import { brl, data } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Seletor } from './form'
import { Erro, Spinner } from './common'
import { cn } from '@/lib/utils'

const sha256 = async (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', buf)), b => b.toString(16).padStart(2, '0')).join('')

export function ImportarContas({ tipo, onFechar }: { tipo: TipoConta; onFechar: () => void }) {
  const { org, empresas } = useOrg()
  const empresaPadrao = useEmpresaPadrao()
  const qc = useQueryClient()
  const cats = useCategorias(); const centros = useCentros(); const contatos = useContatos()
  const [arquivo, setArquivo] = useState<{ nome: string; hash: string } | null>(null)
  const [linhas, setLinhas] = useState<LinhaPlanilha[] | null>(null)
  const [catManual, setCatManual] = useState<Record<number, string>>({})
  const [erro, setErro] = useState<string | null>(null)
  const [baixando, setBaixando] = useState(false)
  const [progresso, setProgresso] = useState<{ feitas: number; total: number } | null>(null)
  const [resultado, setResultado] = useState<{ ok: number; repetidas: number[]; falhas: { linha: number; msg: string }[] } | null>(null)
  const titulo = tipo === 'pagar' ? 'contas a pagar' : 'contas a receber'
  const opcoesCat = useMemo(() => categoriasValidas(cats.data ?? [], tipo).map(c => ({ value: c.id, label: rotuloCategoria(c) })), [cats.data, tipo])

  // aplica a categoria escolhida manualmente e remove o erro de categoria da linha
  const efetivas = useMemo(() => (linhas ?? []).map(l => {
    const manual = catManual[l.linha]
    return manual ? { ...l, categoria_id: manual, erros: l.erros.filter(e => !e.startsWith('Categoria')) } : l
  }), [linhas, catManual])
  const validas = efetivas.filter(l => !l.erros.length)
  const comErro = efetivas.filter(l => l.erros.length)
  const total = validas.reduce((s, l) => s + l.valor, 0)

  const modelo = async () => {
    setBaixando(true)
    try { await baixarModelo({ tipo, categorias: cats.data ?? [], centros: centros.data ?? [], empresas }) }
    catch (e) { toast.error((e as Error).message) }
    finally { setBaixando(false) }
  }

  const ler = async (f: File) => {
    setErro(null); setLinhas(null); setResultado(null); setCatManual({})
    if (f.size > 5 * 1024 * 1024) return setErro('Arquivo maior que 5 MB.')
    try {
      const buf = await f.arrayBuffer()
      const matriz = await lerPlanilha(buf)
      const r = validarPlanilha(matriz, { tipo, categorias: cats.data ?? [], centros: centros.data ?? [], contatos: contatos.data ?? [], empresas, empresaPadrao })
      if (!r.length) return setErro('Nenhuma linha preenchida encontrada na planilha.')
      setArquivo({ nome: f.name, hash: (await sha256(buf)).slice(0, 16) }); setLinhas(r)
    } catch (e) { setErro((e as Error).message) }
  }

  const importar = async () => {
    if (!arquivo || !org) return
    setProgresso({ feitas: 0, total: validas.length })
    const falhas: { linha: number; msg: string }[] = []
    const repetidas: number[] = []
    let ok = 0
    // cadastra fornecedores/clientes novos (uma vez por nome)
    const novos = new Map<string, string>()
    for (const nome of [...new Set(validas.filter(l => l.novoContato).map(l => l.contatoTexto))]) {
      const r = await supabase.from('contatos').insert({ organizacao_id: org.id, nome, tipo: tipo === 'pagar' ? 'fornecedor' : 'cliente' }).select('id').single()
      if (!r.error) novos.set(nome, r.data.id)
    }
    // chave por conteúdo da linha (+ ocorrência repetida no arquivo): reimportar a mesma conta não duplica,
    // mesmo que a planilha tenha sido salva de novo ou as linhas mudado de posição
    const vistas = new Map<string, number>()
    const chaves = await Promise.all(validas.map(l => sha256(new TextEncoder().encode(
      [normalizar(l.descricao), l.valor.toFixed(2), l.vencimento, l.categoria_id, normalizar(l.contatoTexto), normalizar(l.documento), l.parcelas, l.empresa_id].join('|')).buffer as ArrayBuffer)))
    for (const [i, l] of validas.entries()) {
      const base = chaves[i].slice(0, 24); const n = (vistas.get(base) ?? 0) + 1; vistas.set(base, n)
      try {
        await rpc('fn_criar_titulos', { p: {
          organizacao_id: org.id, empresa_id: l.empresa_id, tipo, descricao: l.descricao,
          contato_id: l.contato_id ?? novos.get(l.contatoTexto) ?? null, categoria_id: l.categoria_id,
          centro_custo_id: l.centro_custo_id, valor: l.valor, parcelas: l.parcelas, data_vencimento: l.vencimento,
          data_competencia: l.competencia, documento: l.documento || null, observacoes: l.observacoes || null,
          origem: 'manual', external_id: `planilha:${base}:${n}`,
        } })
        ok++
      } catch (e) {
        const m = (e as Error).message
        if (/duplicate|unique/i.test(m)) repetidas.push(l.linha); else falhas.push({ linha: l.linha, msg: m })
      }
      setProgresso(p => p && { ...p, feitas: p.feitas + 1 })
    }
    setProgresso(null); setResultado({ ok, repetidas, falhas })
    qc.invalidateQueries({ queryKey: ['titulos'] }); qc.invalidateQueries({ queryKey: ['contatos'] }); qc.invalidateQueries({ queryKey: ['dashboard'] })
    if (ok) toast.success(`${ok} ${titulo} importada(s).`)
  }

  return (
    <Dialog open onOpenChange={o => !o && !progresso && onFechar()}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle>Importar {titulo} por planilha</DialogTitle>
          <DialogDescription>Baixe o modelo, preencha no Excel (categorias em lista suspensa) e envie. Você confere tudo antes de gravar.</DialogDescription>
        </DialogHeader>
        <div className="max-h-[68vh] space-y-4 overflow-y-auto pr-1">
          {!resultado && (
            <div className="grid gap-3 sm:grid-cols-2">
              <button type="button" onClick={modelo} disabled={baixando || cats.isLoading}
                className="flex items-center gap-3 rounded-xl border p-4 text-left hover:bg-muted/40 disabled:opacity-50">
                {baixando ? <Spinner className="size-5" /> : <Download className="size-5 text-primary" />}
                <span><span className="block font-medium">1. Baixar modelo</span><span className="text-xs text-muted-foreground">Excel com as categorias do seu plano de contas em lista</span></span>
              </button>
              <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed p-4 hover:bg-muted/40">
                <Upload className="size-5 text-primary" />
                <span><span className="block font-medium">2. Enviar planilha preenchida</span><span className="text-xs text-muted-foreground">{arquivo ? arquivo.nome : '.xlsx, .xls ou .csv'}</span></span>
                <input type="file" className="sr-only" accept=".xlsx,.xls,.csv" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) ler(f) }} />
              </label>
            </div>
          )}
          {erro && <Erro erro={erro} />}

          {linhas && !resultado && (
            <>
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <span className="flex items-center gap-1 text-positivo"><CheckCircle2 className="size-4" />{validas.length} pronta(s) para importar · {brl(total)}</span>
                {comErro.length > 0 && <span className="flex items-center gap-1 text-negativo"><XCircle className="size-4" />{comErro.length} com erro (serão ignoradas)</span>}
                {validas.some(l => l.novoContato) && <span className="text-muted-foreground">{new Set(validas.filter(l => l.novoContato).map(l => l.contatoTexto)).size} {tipo === 'pagar' ? 'fornecedor(es)' : 'cliente(s)'} novo(s) serão cadastrados</span>}
              </div>
              <div className="overflow-x-auto rounded-xl border">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead className="w-12">Linha</TableHead><TableHead>Descrição</TableHead><TableHead>{tipo === 'pagar' ? 'Fornecedor' : 'Cliente'}</TableHead>
                    <TableHead className="min-w-64">Categoria</TableHead><TableHead className="text-right">Valor</TableHead><TableHead>Vencimento</TableHead>
                    <TableHead className="text-right">Parc.</TableHead><TableHead>Situação</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {efetivas.map(l => (
                      <TableRow key={l.linha} className={cn(l.erros.length > 0 && 'bg-destructive/5')}>
                        <TableCell className="tabular text-muted-foreground">{l.linha}</TableCell>
                        <TableCell>{l.descricao || '—'}</TableCell>
                        <TableCell>{l.contatoTexto || '—'}{l.novoContato && <span className="ml-1 rounded bg-primary/10 px-1 text-[10px] text-primary">novo</span>}</TableCell>
                        <TableCell>
                          <Seletor aria-label={`Categoria da linha ${l.linha}`} value={l.categoria_id ?? ''} vazio={l.categoriaTexto ? `"${l.categoriaTexto}" — escolha…` : 'Escolha…'}
                            opcoes={opcoesCat} onChange={e => setCatManual(m => ({ ...m, [l.linha]: e.target.value }))} />
                        </TableCell>
                        <TableCell className="text-right tabular">{Number.isNaN(l.valor) ? '—' : brl(l.valor)}</TableCell>
                        <TableCell>{data(l.vencimento)}</TableCell>
                        <TableCell className="text-right tabular">{l.parcelas}x</TableCell>
                        <TableCell className="text-xs">{l.erros.length ? <span className="text-negativo">{l.erros.join('; ')}</span> : <span className="text-positivo">OK</span>}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </>
          )}

          {progresso && <div className="space-y-1"><Progress value={(100 * progresso.feitas) / Math.max(progresso.total, 1)} />
            <p className="text-xs text-muted-foreground">Importando {progresso.feitas} de {progresso.total}…</p></div>}

          {resultado && (
            <div className="space-y-3">
              <p className="flex items-center gap-2 text-sm"><FileSpreadsheet className="size-4 text-primary" /><b>{resultado.ok}</b> {titulo} importada(s){resultado.repetidas.length ? `, ${resultado.repetidas.length} já existia(m) e foi(ram) ignorada(s) (linhas ${resultado.repetidas.join(', ')})` : ''}{resultado.falhas.length ? `, ${resultado.falhas.length} com falha` : ''}.</p>
              {resultado.falhas.length > 0 && <ul className="space-y-1 rounded-lg border p-3 text-sm">{resultado.falhas.map(f => <li key={f.linha}>Linha {f.linha}: <span className="text-negativo">{f.msg}</span></li>)}</ul>}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onFechar} disabled={!!progresso}>{resultado ? 'Fechar' : 'Cancelar'}</Button>
          {linhas && !resultado && <Button onClick={importar} disabled={!validas.length || !!progresso}>{progresso && <Spinner />}Importar {validas.length} conta(s)</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

