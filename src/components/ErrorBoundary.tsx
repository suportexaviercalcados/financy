import { Component, type ReactNode } from 'react'

/** Evita tela em branco: um erro de renderização mostra uma mensagem em vez de derrubar o app inteiro */
export class ErrorBoundary extends Component<{ children: ReactNode }, { erro: Error | null }> {
  state = { erro: null as Error | null }
  static getDerivedStateFromError(erro: Error) { return { erro } }
  componentDidCatch(erro: Error) { console.error('Erro de interface:', erro) }
  render() {
    if (!this.state.erro) return this.props.children
    return (
      <div role="alert" className="mx-auto max-w-lg p-10 text-sm">
        <h1 className="mb-2 text-lg font-semibold">Algo deu errado nesta tela</h1>
        <p className="mb-4 text-muted-foreground">{this.state.erro.message}</p>
        <button className="rounded-lg bg-primary px-3 py-1.5 text-primary-foreground" onClick={() => location.reload()}>Recarregar</button>
      </div>
    )
  }
}
