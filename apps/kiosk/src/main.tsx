import { StrictMode, type ComponentProps } from 'react'
import { createRoot } from 'react-dom/client'
import { RouterProvider } from 'react-router-dom'
import { RefreshProvider } from '@ai-job-print/refresh'
import './index.css'
import { kioskRouter } from './routes'
import { AuthProvider } from './auth/AuthContext'

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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AuthProvider>
      <RefreshProvider>
        <RouterProvider router={kioskRouter} onError={handleRouterError} />
      </RefreshProvider>
    </AuthProvider>
  </StrictMode>,
)
