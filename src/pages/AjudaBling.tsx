// Manual público da integração com o Bling (usado como "Link do manual" no cadastro do aplicativo no Bling)
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeftRight, CheckCircle2, FileSpreadsheet, KeyRound, Link2, RefreshCw, ShieldCheck, Unplug, Wrench } from 'lucide-react'
import { useAuth } from '@/contexts/auth'
import { Card } from '@/components/ui/card'

const Secao = ({ id, icone: Icone, titulo, children }: { id: string; icone: typeof Link2; titulo: string; children: ReactNode }) => (
  <section id={id} className="scroll-mt-20">
    <h2 className="mb-3 flex items-center gap-2 text-xl font-semibold tracking-tight"><Icone className="size-5 text-primary" />{titulo}</h2>
    <div className="space-y-3 text-[15px] leading-relaxed text-foreground/90">{children}</div>
  </section>
)

const Passo = ({ n, titulo, children }: { n: number; titulo: string; children: ReactNode }) => (
  <li className="flex gap-3">
    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">{n}</span>
    <div><p className="font-medium">{titulo}</p><div className="mt-1 text-muted-foreground">{children}</div></div>
  </li>
)

const IMPORTA = [
  ['Pedidos de venda', 'Viram vendas no Financy, com itens, CMV, taxas e recebíveis. Pedidos cancelados no Bling são cancelados aqui.'],
  ['Produtos', 'Nome, código e preço. O preço de custo do Bling alimenta o CMV; um custo cadastrado manualmente nunca é apagado.'],
  ['Clientes e fornecedores', 'Contatos usados nas vendas e nas contas.'],
  ['Formas de pagamento', 'Associadas automaticamente às formas do Financy (PIX, crédito, débito, boleto…), com ajuste manual.'],
  ['Lojas / canais de venda', 'Cada loja do Bling é associada a um canal de venda do Financy.'],
  ['Contas a pagar e a receber', 'Viram títulos, com vencimento, competência e categoria. Contas a receber geradas por pedidos não são duplicadas.'],
  ['Categorias financeiras', 'Podem ser associadas ao plano de contas do Financy para a DRE.'],
]

export default function AjudaBling() {
  const { user } = useAuth()
  return (
    <div className="min-h-svh bg-background">
      <header className="sticky top-0 z-10 border-b bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-4 py-3">
          <Link to="/" className="flex items-center gap-2">
            <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground"><FileSpreadsheet className="size-4" /></span>
            <span className="font-semibold">Financy</span>
            <span className="hidden text-sm text-muted-foreground sm:inline">· Central de ajuda</span>
          </Link>
          <Link to={user ? '/config/integracoes' : '/login'} className="text-sm text-primary hover:underline">{user ? 'Ir para a integração' : 'Entrar'}</Link>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 py-10">
        <p className="text-sm font-medium text-primary">Manual da integração</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight md:text-4xl">Como conectar o Bling ao Financy</h1>
        <p className="mt-3 max-w-2xl text-muted-foreground">
          O Financy usa a API oficial do Bling (v3) para trazer suas vendas, produtos e contas automaticamente,
          alimentando o fluxo de caixa, a DRE, a DFC e o dashboard sem digitação.
        </p>

        <nav aria-label="Nesta página" className="mt-8 grid gap-2 rounded-xl border bg-card p-4 text-sm sm:grid-cols-2">
          {[['requisitos', 'Antes de começar'], ['conectar', 'Conectar em 4 passos'], ['importacao', 'O que é importado'], ['ajustes', 'Ajustes recomendados'],
            ['sincronizacao', 'Sincronização'], ['seguranca', 'Segurança e permissões'], ['desconectar', 'Desconectar'], ['problemas', 'Solução de problemas']]
            .map(([id, r]) => <a key={id} href={`#${id}`} className="text-primary hover:underline">{r}</a>)}
        </nav>

        <div className="mt-10 space-y-12">
          <Secao id="requisitos" icone={CheckCircle2} titulo="Antes de começar">
            <ul className="list-disc space-y-1 pl-5">
              <li>Uma conta ativa no Financy com perfil <b>Proprietário</b> ou <b>Administrador</b> da organização.</li>
              <li>Acesso de administrador à conta do Bling que você vai conectar.</li>
              <li>A empresa (CNPJ) já cadastrada no Financy. Cada empresa se conecta a uma conta do Bling.</li>
            </ul>
          </Secao>

          <Secao id="conectar" icone={Link2} titulo="Conectar em 4 passos">
            <ol className="space-y-5">
              <Passo n={1} titulo="Abra a integração">No Financy, acesse <b>Configurações → Integração Bling</b>. Na configuração inicial, a mesma opção aparece na etapa “Bling”.</Passo>
              <Passo n={2} titulo="Escolha o início do histórico">Informe a partir de qual data os pedidos e as contas devem ser importados (padrão: últimos 12 meses).</Passo>
              <Passo n={3} titulo="Autorize no Bling">Clique em <b>Conectar Bling</b>. Você será levado ao site do Bling: entre na sua conta e confirme a autorização. O Financy nunca vê nem guarda a sua senha do Bling.</Passo>
              <Passo n={4} titulo="Pronto">Você volta automaticamente ao Financy com a mensagem “Conta Bling conectada”. A primeira importação começa em segundo plano e pode levar alguns minutos, conforme o volume de dados.</Passo>
            </ol>
          </Secao>

          <Secao id="importacao" icone={ArrowLeftRight} titulo="O que é importado">
            <div className="overflow-hidden rounded-xl border">
              {IMPORTA.map(([o, d]) => (
                <div key={o} className="grid gap-1 border-b px-4 py-3 last:border-0 sm:grid-cols-[220px_1fr]">
                  <span className="font-medium">{o}</span><span className="text-muted-foreground">{d}</span>
                </div>
              ))}
            </div>
            <p className="text-sm text-muted-foreground">A importação é somente leitura: o Financy não cria, altera nem exclui nada na sua conta do Bling.</p>
          </Secao>

          <Secao id="ajustes" icone={Wrench} titulo="Ajustes recomendados após conectar">
            <ul className="list-disc space-y-2 pl-5">
              <li><b>Mapeamentos</b> (aba dentro da integração): confira para qual canal vai cada loja do Bling, as formas de pagamento e, se quiser, associe as categorias financeiras do Bling ao seu plano de contas.</li>
              <li><b>Taxas por canal</b> (Cadastros → Canais e taxas): informe as taxas e os prazos da maquininha, do gateway e do marketplace. Com isso, os recebíveis dos pedidos importados já entram com o valor líquido e a data correta.</li>
              <li><b>Custo dos produtos</b>: produtos sem preço de custo no Bling aparecem com aviso de “CMV incompleto”. Cadastre o custo no Bling ou no Financy.</li>
              <li><b>Pagamentos registrados no Bling</b>: por padrão, contas pagas no Bling entram em aberto e são baixadas pela conciliação do extrato bancário (OFX), que é a fonte mais confiável do caixa. Se preferir, escolha uma conta bancária para registrar esses pagamentos automaticamente.</li>
            </ul>
          </Secao>

          <Secao id="sincronizacao" icone={RefreshCw} titulo="Sincronização">
            <ul className="list-disc space-y-1 pl-5">
              <li>Automática a cada 10 minutos, trazendo apenas o que mudou.</li>
              <li>Pedidos e produtos também chegam quase em tempo real pelos avisos (webhooks) do Bling.</li>
              <li>Para atualizar na hora, use <b>Sincronizar agora</b>.</li>
              <li>Reimportar o mesmo pedido ou conta nunca gera duplicidade.</li>
              <li>As abas <b>Execuções</b> e <b>Logs</b> mostram a data da última sincronização, a quantidade de registros e eventuais erros.</li>
            </ul>
          </Secao>

          <Secao id="seguranca" icone={ShieldCheck} titulo="Segurança e permissões">
            <ul className="list-disc space-y-1 pl-5">
              <li>A conexão usa o padrão OAuth 2.0 do próprio Bling: você autoriza o acesso sem compartilhar a senha.</li>
              <li>As chaves de acesso ficam criptografadas no servidor e nunca aparecem no navegador.</li>
              <li>Só proprietários e administradores da organização podem conectar ou desconectar.</li>
              <li>Os dados de cada empresa ficam isolados: nenhuma outra organização do Financy tem acesso a eles.</li>
              <li>O Financy acessa apenas os recursos listados em “O que é importado”, em modo de leitura.</li>
            </ul>
          </Secao>

          <Secao id="desconectar" icone={Unplug} titulo="Desconectar">
            <p>Em <b>Configurações → Integração Bling</b>, clique em <b>Desconectar</b>. As chaves de acesso são apagadas imediatamente e a sincronização para. Os dados já importados continuam no Financy. Você também pode revogar o acesso pelo próprio Bling, na lista de aplicativos autorizados.</p>
          </Secao>

          <Secao id="problemas" icone={KeyRound} titulo="Solução de problemas">
            <div className="space-y-3">
              {[
                ['“Integração Bling não configurada na plataforma”', 'O aplicativo do Financy ainda não foi ativado neste ambiente. Entre em contato com o suporte.'],
                ['“Autorização expirada”', 'A autorização do Bling vale por poucos segundos. Clique em Conectar Bling novamente e conclua sem interromper.'],
                ['“Esta autorização foi iniciada por outro usuário”', 'A conexão precisa ser concluída pela mesma pessoa que clicou em Conectar, logada no Financy no mesmo navegador.'],
                ['Status “Reautorizar”', 'O acesso expirou ou foi revogado no Bling. Clique em Reautorizar para gerar uma nova autorização.'],
                ['Pedidos sem taxa ou com recebimento na data errada', 'Cadastre as taxas e os prazos em Cadastros → Canais e taxas e confira o mapeamento das formas de pagamento.'],
                ['Valores diferentes do Bling', 'Confira a data inicial do histórico e o mapeamento das lojas. Pedidos “em digitação” não são importados.'],
              ].map(([p, r]) => (
                <Card key={p} className="gap-1 p-4"><p className="font-medium">{p}</p><p className="text-sm text-muted-foreground">{r}</p></Card>
              ))}
            </div>
          </Secao>
        </div>

        <footer className="mt-16 border-t pt-6 text-sm text-muted-foreground">
          Bling é marca de seu respectivo titular. O Financy utiliza a API pública oficial do Bling (developer.bling.com.br).
        </footer>
      </main>
    </div>
  )
}
