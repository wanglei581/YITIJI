import { useEffect, useState, useSyncExternalStore } from 'react'
import { useAuth } from '../../auth/useAuth'
import { useLocalScanProbe, useTerminalDeviceStatus } from '../../hooks/useTerminalDeviceStatus'
import { createCopyJob } from '../../services/api/copyJobs'
import { ApiHttpError } from '../../services/api/httpAdapter'
import { loadConfiguredCapabilities, type CapabilitiesLoadResult } from '../../services/api/printScanCapabilities'
import { getTerminalId, subscribeTerminalIdentity } from '../../services/api/screensaver'
import { screenScanBlockReason } from '../scan/scanProbeCopy'
import { acceptCopyReceipt, allowedCopySettings, beginCopyAttempt, clearCopySession, copyOptions, pickCopySettings, readCopySnapshot, rejectCopyAttempt, subscribeCopySession } from './copySession'

export function useCopyFlow() {
  const terminalId = useSyncExternalStore(subscribeTerminalIdentity, getTerminalId, () => '')
  const snapshot = useSyncExternalStore(subscribeCopySession, readCopySnapshot)
  const [caps, setCaps] = useState<CapabilitiesLoadResult | null>(null)
  const probe = useLocalScanProbe(true)
  const printer = useTerminalDeviceStatus()
  const { getToken } = useAuth()
  useEffect(() => {
    let active = true
    setCaps(null)
    void loadConfiguredCapabilities().then((result) => { if (active) setCaps(result) })
    return () => { active = false }
  }, [terminalId])
  useEffect(() => {
    clearCopySession()
    let lastActivity = Date.now()
    const touch = () => { lastActivity = Date.now() }
    const check = () => { if (Date.now() - lastActivity >= 180_000) { clearCopySession(); lastActivity = Date.now() } }
    const events = ['pointerdown', 'keydown'] as const
    for (const event of events) window.addEventListener(event, touch, true)
    window.addEventListener('pageshow', check)
    document.addEventListener('visibilitychange', check)
    const timer = window.setInterval(check, 1000)
    return () => {
      window.clearInterval(timer)
      for (const event of events) window.removeEventListener(event, touch, true)
      window.removeEventListener('pageshow', check)
      document.removeEventListener('visibilitychange', check)
      clearCopySession()
    }
  }, [terminalId])
  const options = copyOptions(caps?.status === 'ok' ? caps.map : {})
  const scanReason = screenScanBlockReason({ capLoading: !caps, capUnknown: caps?.status !== 'ok', capAllowed: options.screen, probe })
  const reason = scanReason?.replace(/扫描能力/g, '复印能力').replace(/屏上扫描/g, '屏上复印').replace(/面板扫描/g, '面板复印')
    ?? (printer.printerReady ? null : printer.kind === 'offline' ? '打印机离线' : '打印机状态暂时无法确认，请先用面板复印')
  const denied = caps?.status === 'ok' && !options.screen
  const start = async (): Promise<'ready' | 'off' | 'stay'> => {
    if (reason || !navigator.onLine) return denied ? 'off' : 'stay'
    if (!readCopySnapshot().attempt) pickCopySettings(allowedCopySettings(readCopySnapshot().settings, options))
    const attempt = beginCopyAttempt(terminalId)
    if (!attempt) return 'stay'
    try {
      const receipt = await createCopyJob(attempt.input, getToken(), attempt.signal)
      return acceptCopyReceipt(attempt.epoch, receipt) ? 'ready' : 'stay'
    } catch (error) {
      if (attempt.signal.aborted && readCopySnapshot().attempt !== attempt.input) return 'stay'
      const code = error instanceof ApiHttpError ? error.code : ''
      const status = error instanceof ApiHttpError ? error.status : 0
      const forbidden = status === 403 || status === 401 || code === 'COPY_CAPABILITY_REVOKED' || code === 'COPY_CAPABILITY_DISABLED' || code === 'CAPABILITY_NOT_AVAILABLE'
      rejectCopyAttempt(attempt.epoch, forbidden ? 'denied' : status === 413 ? 'limit' : status === 409 ? 'conflict' : 'unknown')
      return forbidden && readCopySnapshot().phase === 'rejected' ? 'off' : 'stay'
    }
  }
  return { snapshot, options, reason, denied, start, printer, loading: !caps }
}
