import { StrictMode, type ComponentProps, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { RefreshProvider } from '@ai-job-print/refresh'
import './index.css'
import { kioskRouter } from './routes'
import { AuthProvider } from './auth/AuthContext'
import {
  initializeTerminalIdentity,
  startTerminalIdentityRecovery,
  subscribeTerminalIdentity,
} from './services/api/screensaver'

type RouterErrorHandler = NonNullable<ComponentProps<typeof RouterProvider>['onError']>

const handleRouterError: RouterErrorHandler = (error, info) => {
  if (import.meta.env.DEV) {
    console.error('[kiosk-route-error:dev]', error, info.errorInfo?.componentStack)
  }
  console.error('[kiosk-route-error]', {
    pathname: info.location.pathname,
    pattern: info.pattern,
    code: 'KIOSK_ROUTE_RENDER_ERROR',
  })
}

export function KioskApp() {
  const [identityRevision, setIdentityRevision] = useState(0)

  useEffect(() => {
    const unsubscribe = subscribeTerminalIdentity(() => setIdentityRevision((revision) => revision + 1))
    startTerminalIdentityRecovery()
    return unsubscribe
  }, [])

  return (
    <AuthProvider key={identityRevision}>
      <RefreshProvider>
        <RouterProvider router={kioskRouter} onError={handleRouterError} />
      </RefreshProvider>
    </AuthProvider>
  )
}

function renderKiosk(): void {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <KioskApp />
    </StrictMode>,
  )
}

void initializeTerminalIdentity().finally(renderKiosk)
