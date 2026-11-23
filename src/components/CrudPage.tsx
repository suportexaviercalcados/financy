// CRUD genérico dirigido por configuração (cadastros). Persistência direta no Supabase com RLS.
import { useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { supabase, unwrap } from '@/lib/supabase'
import { useOrg } from '@/contexts/org'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Campo, EntradaValor, Grade, Seletor } from './form'
import { Confirmar, PageHeader, Spinner } from './common'
import { DataTable, type Coluna } from './DataTable'

export type CampoDef = {
  nome: string; rotulo: string; tipo: 'texto' | 'numero' | 'dinheiro' | 'percentual' | 'data' | 'selecao' | 'booleano' | 'textarea'
  obrigatorio?: boolean; opcoes?: { value: string; label: string }[]; ajuda?: string; largo?: boolean; padrao?: unknown
  desabilitado?: (reg: any) => boolean; mostrar?: (reg: any) => boolean; vazio?: string
}

export interface CrudConfig {
  tabela: string; titulo: string; descricao?: string; singular: string
  campos: CampoDef[]; colunas: Coluna<any>[]
  select?: string; ordem?: string; ordemDesc?: boolean
  permissao?: 'admin' | 'escrita'
  validar?: (reg: any) => string | null
  preparar?: (reg: any) => any            // transforma antes de salvar
  podeExcluir?: (reg: any) => boolean
  filtro?: (q: any) => any
  acoesExtras?: (reg: any) => ReactNode
  aposSalvar?: (reg: any) => void
  topo?: ReactNode
  ordemInicial?: { id: string; desc?: boolean }
}

export function CrudPage({ cfg }: { cfg: CrudConfig }) {
  const { org, podeAdministrar, podeEscrever } = useOrg()
  const qc = useQueryClient()
  const pode = cfg.permissao === 'escrita' ? podeEscrever : podeAdministrar
  const [edit, setEdit] = useState<any | null>(null)
  const [excluir, setExcluir] = useState<any | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  const q = useQuery({
    queryKey: [cfg.tabela, org?.id, cfg.select ?? '*', 'crud'],
    enabled: !!org,
    queryFn: async () => {
      let query = supabase.from(cfg.tabela).select(cfg.select ?? '*').eq('organizacao_id', org!.id)
        .order(cfg.ordem ?? 'nome', { ascending: !cfg.ordemDesc })
      if (cfg.filtro) query = cfg.filtro(query)
      return unwrap(await query) as any[]
    },
  })

  const salvar = useMutation({
    mutationFn: async (reg: any) => {
      const msg = cfg.validar?.(reg)
      if (msg) throw new Error(msg)
      for (const c of cfg.campos) {
        if (c.obrigatorio && (c.mostrar?.(reg) ?? true) && (reg[c.nome] === undefined || reg[c.nome] === null || reg[c.nome] === '' || Number.isNaN(reg[c.nome])))
          throw new Error(`Preencha o campo "${c.rotulo}".`)
      }
      const dados: any = {}
      for (const c of cfg.campos) {
        let v = reg[c.nome]
        if (v === '' || (typeof v === 'number' && Number.isNaN(v))) v = null
        dados[c.nome] = v
      }
      const final = cfg.preparar ? cfg.preparar({ ...dados, id: reg.id }) : dados
      delete final.id
      const r = reg.id
        ? await supabase.from(cfg.tabela).update(final).eq('id', reg.id).select().single()
        : await supabase.from(cfg.tabela).insert({ ...final, organizacao_id: org!.id }).select().single()
      return unwrap(r)
    },
    onSuccess: (r) => {
      toast.success(`${cfg.singular} salvo(a).`); setEdit(null); setErro(null)
      qc.invalidateQueries({ queryKey: [cfg.tabela] }); cfg.aposSalvar?.(r)
    },
    onError: (e: Error) => setErro(traduzirErro(e.message)),
  })

  const remover = useMutation({
    mutationFn: async (reg: any) => unwrap(await supabase.from(cfg.tabela).delete().eq('id', reg.id)),
    onSuccess: () => { toast.success('Excluído.'); setExcluir(null); qc.invalidateQueries({ queryKey: [cfg.tabela] }) },
    onError: (e: Error) => { toast.error(traduzirErro(e.message)); setExcluir(null) },
  })

  const novo = () => {
    const r: any = {}
    for (const c of cfg.campos) if (c.padrao !== undefined) r[c.nome] = typeof c.padrao === 'function' ? (c.padrao as () => unknown)() : c.padrao
    setErro(null); setEdit(r)
  }

  const colunas: Coluna<any>[] = [
    ...cfg.colunas,
    ...(pode ? [{
      id: '_acoes', titulo: '', alinhar: 'right' as const, className: 'w-px whitespace-nowrap',
      celula: (r: any) => (
        <div className="flex justify-end gap-1" onClick={e => e.stopPropagation()}>
          {cfg.acoesExtras?.(r)}
          <Button size="icon-sm" variant="ghost" aria-label="Editar" onClick={() => { setErro(null); setEdit({ ...r }) }}><Pencil /></Button>
          {(cfg.podeExcluir?.(r) ?? true) && <Button size="icon-sm" variant="ghost" aria-label="Excluir" onClick={() => setExcluir(r)}><Trash2 /></Button>}
        </div>
      ),
    }] : []),
  ]

  return (
    <div>
      <PageHeader titulo={cfg.titulo} descricao={cfg.descricao}
        acoes={pode && <Button onClick={novo}><Plus />Novo(a) {cfg.singular.toLowerCase()}</Button>} />
      {cfg.topo}
      <DataTable colunas={colunas} linhas={q.data} carregando={q.isLoading} onLinha={pode ? (r) => { setErro(null); setEdit({ ...r }) } : undefined}
        exportar={{ nome: cfg.tabela, titulo: cfg.titulo }} ordemInicial={cfg.ordemInicial} />

      <Dialog open={!!edit} onOpenChange={(o) => !o && setEdit(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader><DialogTitle>{edit?.id ? 'Editar' : 'Novo(a)'} {cfg.singular.toLowerCase()}</DialogTitle></DialogHeader>
          {edit && (
            <form id="crud-form" onSubmit={(e) => { e.preventDefault(); salvar.mutate(edit) }} className="max-h-[65vh] overflow-y-auto pr-1">
              <Grade>
                {cfg.campos.filter(c => c.mostrar?.(edit) ?? true).map(c => (
                  <Campo key={c.nome} rotulo={c.rotulo} obrigatorio={c.obrigatorio} ajuda={c.ajuda} className={c.largo ? 'sm:col-span-2' : ''}>
                    <EntradaCampo c={c} reg={edit} onChange={(v) => setEdit((r: any) => ({ ...r, [c.nome]: v }))} />
                  </Campo>
                ))}
              </Grade>
              {erro && <p role="alert" className="mt-4 text-sm text-destructive">{erro}</p>}
            </form>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEdit(null)}>Cancelar</Button>
            <Button type="submit" form="crud-form" disabled={salvar.isPending}>{salvar.isPending && <Spinner />}Salvar</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Confirmar aberto={!!excluir} titulo={`Excluir ${cfg.singular.toLowerCase()}?`} perigo carregando={remover.isPending}
        descricao="Esta ação não pode ser desfeita. Registros vinculados podem impedir a exclusão; nesse caso, desative o cadastro."
        textoBotao="Excluir" onFechar={() => setExcluir(null)} onConfirmar={() => remover.mutate(excluir)} />
    </div>
  )
}

function EntradaCampo({ c, reg, onChange }: { c: CampoDef; reg: any; onChange: (v: any) => void }) {
  const v = reg[c.nome]
  const dis = c.desabilitado?.(reg)
  switch (c.tipo) {
    case 'textarea': return <Textarea value={v ?? ''} onChange={e => onChange(e.target.value)} disabled={dis} />
    case 'selecao': return <Seletor value={v ?? ''} onChange={e => onChange(e.target.value || null)} opcoes={c.opcoes ?? []} vazio={c.vazio ?? 'Selecione…'} disabled={dis} />
    case 'booleano': return <Switch checked={!!v} onCheckedChange={onChange} disabled={dis} />
    case 'dinheiro': return <EntradaValor valor={v ?? null} onChange={onChange} disabled={dis} />
    case 'numero': case 'percentual':
      return <Input type="number" step="any" value={v ?? ''} onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))} disabled={dis}
        className="tabular" placeholder={c.tipo === 'percentual' ? '%' : undefined} />
    case 'data': return <Input type="date" value={v ?? ''} onChange={e => onChange(e.target.value)} disabled={dis} />
    default: return <Input value={v ?? ''} onChange={e => onChange(e.target.value)} disabled={dis} />
  }
}

/** Mensagens do Postgres mais amigáveis */
export function traduzirErro(m: string) {
  if (/duplicate key|unique/i.test(m)) return 'Já existe um registro com esses dados.'
  if (/foreign key/i.test(m) && /delete|update/i.test(m)) return 'Este registro está em uso por outros lançamentos e não pode ser excluído. Desative-o.'
  if (/violates foreign key/i.test(m)) return 'Referência inválida (cadastro de outra organização ou inexistente).'
  if (/row-level security|permission denied/i.test(m)) return 'Você não tem permissão para esta ação.'
  if (/check constraint/i.test(m)) return 'Algum valor está fora do permitido. Revise os campos.'
  return m
}
