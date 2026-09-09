import { useEffect, useMemo } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
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
  const [searchParams, setSearchParams] = useSearchParams()
  const requested = parseScanStage(searchParams.get('stage'))
  const stored = readScanWorkbenchSession()
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
  const view = useMemo(
    () => resolveScanView({
      requested,
      storedStage: stored?.stage ?? null,
      hasLiveSession,
      hasResult,
    }),
    [requested, stored?.stage, hasLiveSession, hasResult],
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

  const go = (stage: ScanStage) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('stage', stage)
      if (stage !== 'start') next.delete('mode')
      return next
    }, { replace: true })
  }

  return (
    <div data-scan-workbench="" data-scan-stage={view} style={{ display: 'contents' }}>
      {view === 'settings' ? (
        <ScanSettingsPage onGoStage={go} />
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
