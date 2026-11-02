import { useCallback, useEffect, useMemo } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../auth/useAuth'
import { peekScanHowContinue } from './scanHowContinue'
import { ScanDeviceSettingsPage } from './ScanDeviceSettingsPage'
import { ScanHowPage } from './ScanHowPage'
import { ScanProgressPage } from './ScanProgressPage'
import { ScanResultPage } from './ScanResultPage'
import { ScanSettingsPage } from './ScanSettingsPage'
import { ScanStartPage } from './ScanStartPage'
import {
  hasLiveScanSession,
  hasScanResult,
  readScanWorkbenchSession,
} from './scanWorkbenchSession'
import {
  parseScanStage,
  resolveScanView,
  type ScanStage,
} from './scanWorkbenchModel'

/**
 * 青序流光 18-scan-workbench：选类型 / 建会话 / 等待回传 / 结果同页分阶段。
 * 阶段切换只 replace `?stage=`，不推新的历史条目。
 * 首屏从 sessionStorage 复水，看门狗 reload 后仍停在用户原来的阶段。
 */
export function ScanWorkbenchPage() {
  const location = useLocation()
  const { isLoggedIn } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const requested = parseScanStage(searchParams.get('stage'))
  const stored = readScanWorkbenchSession()
  const continueMaterial = isLoggedIn ? peekScanHowContinue() : null
  const locationState = (location.state ?? null) as {
    scanTaskId?: unknown
    controlToken?: unknown
    outcome?: unknown
    success?: unknown
    file?: unknown
    reason?: unknown
  } | null
  const hasLiveSession = hasLiveScanSession(stored, locationState)
  const hasResult = hasScanResult(stored, locationState)
  const hasMaterialContext = !hasLiveSession && !hasResult && Boolean(stored?.material)
  const hasHowContinue = !hasLiveSession && !hasResult && continueMaterial !== null
  const view = useMemo(
    () => resolveScanView({
      requested,
      storedStage: stored?.stage ?? null,
      hasLiveSession,
      hasResult,
      hasMaterialContext,
      hasHowContinue,
    }),
    [requested, stored?.stage, hasLiveSession, hasResult, hasMaterialContext, hasHowContinue],
  )

  useEffect(() => {
    if (requested === view) return
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('stage', view)
      if (view !== 'start') next.delete('mode')
      return next
    }, { replace: true })
  }, [requested, view, setSearchParams])

  const go = useCallback((stage: ScanStage) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('stage', stage)
      if (stage !== 'start') next.delete('mode')
      return next
    }, { replace: true })
  }, [setSearchParams])

  return (
    <div data-scan-workbench="" data-scan-stage={view} style={{ display: 'contents' }}>
      {view === 'settings' ? (
        <ScanSettingsPage onGoStage={go} />
      ) : view === 'how' ? (
        <ScanHowPage onGoStage={go} />
      ) : view === 'device-settings' ? (
        <ScanDeviceSettingsPage onGoStage={go} />
      ) : view === 'progress' ? (
        <ScanProgressPage onGoStage={go} />
      ) : view === 'result' ? (
        <ScanResultPage onGoStage={go} />
      ) : (
        <ScanStartPage onGoStage={go} />
      )}
    </div>
  )
}
