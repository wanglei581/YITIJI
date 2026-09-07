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
  getTerminalId,
} from './services/api/screensaver'
import { initializeTerminalSession } from './services/terminalAuth'

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
    // 首次拿到身份（'' → 有值，Agent 晚于浏览器启动）只补终端会话，不换 key 重挂整棵树——
    // 否则登录态 / 上传中的 state 会被静默清空（SES-04）。只有 terminalId 从 A 换成 B 才重挂。
    let lastTerminalId = getTerminalId()
    const unsubscribe = subscribeTerminalIdentity(() => {
      void initializeTerminalSession()
      const next = getTerminalId()
      const switched = lastTerminalId !== '' && next !== '' && next !== lastTerminalId
      lastTerminalId = next
      if (switched) setIdentityRevision((revision) => revision + 1)
    })
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

void initializeTerminalIdentity().then(initializeTerminalSession).finally(renderKiosk)
