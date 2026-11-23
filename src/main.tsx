import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App'
import { ThemeProvider } from '@/contexts/theme'
import { AuthProvider } from '@/contexts/auth'
import { OrgProvider } from '@/contexts/org'
import { Toaster } from '@/components/ui/sonner'

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 15_000 } } })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <OrgProvider>
            <App />
            <Toaster richColors position="top-right" />
          </OrgProvider>
        </AuthProvider>
      </QueryClientProvider>
    </ThemeProvider>
  </StrictMode>,
)
