import './index.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'

import App from '@/app'
import { registerWorkspaceLocalDataInvalidationListener } from '@/shared/lib/offline-sync'
import { registerPwaServiceWorker } from '@/shared/lib/pwa/register-service-worker'
import { ThemeProvider } from '@/shared/lib/theme'

const rootElement = document.getElementById('root')

if (!rootElement) {
  throw new Error('Root element was not found')
}

if (!registerWorkspaceLocalDataInvalidationListener()) {
  registerPwaServiceWorker()

  createRoot(rootElement).render(
    <StrictMode>
      <ThemeProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ThemeProvider>
    </StrictMode>,
  )
}
