import { useCallback, useEffect, useMemo } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { peekScanHowContinue } from './scanHowContinue'
import { ScanDeviceDonePage } from './ScanDeviceDonePage'
import { ScanDeviceFlowPage } from './ScanDeviceFlowPage'
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
  const [searchParams, setSearchParams] = useSearchParams()
  const requested = parseScanStage(searchParams.get('stage'))
  const stored = readScanWorkbenchSession()
  /* 「怎么扫」登录续接记号：这里只看有没有，不读登录态。
   * 本页不订阅登录上下文：登录、退出、忙碌标记一变，整页就会重渲染、重读会话存储，
   * 设置页或等待页会多挂一次，投递确认、轮询、撤销跟着多发。
   * 记号只够打开「怎么扫」；是不是本人登录回来、要不要接着用它，由 ScanHowPage 自己读登录态决定
   * （没登录不消费记号，没有材料就退回选材料）。 */
  const continueMaterial = peekScanHowContinue()
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
      hasDeviceFlow: stored?.deviceFlow === true,
    }),
    [requested, stored?.stage, stored?.deviceFlow, hasLiveSession, hasResult, hasMaterialContext, hasHowContinue],
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
      ) : (view === 'progress' && stored?.deviceFlow) || view === 'device-more' || view === 'device-make' ? (
        <ScanDeviceFlowPage onGoStage={go} />
      ) : view === 'progress' ? (
        <ScanProgressPage onGoStage={go} />
      ) : view === 'result' && stored?.deviceFlow === true && stored.result?.success === true && stored.result.outcome === 'completed' ? (
        <ScanDeviceDonePage onGoStage={go} />
      ) : view === 'result' ? (
        <ScanResultPage onGoStage={go} />
      ) : (
        <ScanStartPage onGoStage={go} />
      )}
    </div>
  )
}
