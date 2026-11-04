import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ScanSessionFileView, ScanSessionStatusResponse } from '@ai-job-print/shared'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { useAuth } from '../../auth/useAuth'
import { cancelScanSession, getScanSessionStatus } from '../../services/api/scanTasks'
import { ApiHttpError } from '../../services/api/httpAdapter'
import { postLocalScanCommand, type LocalScanCommandResult } from '../../services/scan/localScanApi'
import { formatSize } from '../upload/phoneUploadModel'
import { formatLabelFromMime } from './scanOutputFormat'
import { readScanDeviceEpoch, subscribeScanDeviceEpoch, bumpScanDeviceEpoch } from './scanDeviceEpoch'
import { selectDeviceScreen, type DeviceScreen } from './scanDeviceState'
import { deviceStartInFlight } from './useScanDeviceStart'
import {
  acknowledgeScanDelivery,
  SCAN_ACK_REFUSED_PROGRESS_REASON,
} from './scanDeliveryAck'
import { noteScanTaskStatusFromServer, revokeCreatedScanSession } from './scanSessionRevoke'
import { type ScanStage } from './scanWorkbenchModel'
import {
  patchScanWorkbenchSession,
  readScanWorkbenchSession,
  scanLifecycleGeneration,
  type ScanResultSnapshot,
} from './scanWorkbenchSession'

const POLL_MS = 3000

function fileUsable(file: ScanSessionFileView | null | undefined): file is ScanSessionFileView {
  if (!file) return false
  return file.fileId.trim().length > 0
    && file.fileUrl.trim().length > 0
    && file.filename.trim().length > 0
    && typeof file.sizeBytes === 'number'
    && file.mimeType.trim().length > 0
}

function stopReason(purged: boolean): string {
  const parts = ['已停止扫描。这次到这里为止，不会再继续。']
  if (purged) parts.push('已扫的页已从这台机器删除。')
  parts.push('请稍候再开始新的扫描。')
  return parts.join('')
}

function wantedStage(kind: DeviceScreen['kind']): ScanStage {
  if (kind === 'more') return 'device-more'
  if (kind === 'make') return 'device-make'
  return 'progress'
}

export function useScanDeviceFlow(onGoStage: (stage: ScanStage) => void) {
  const { getToken } = useAuth()
  const epoch = useSyncExternalStore(subscribeScanDeviceEpoch, readScanDeviceEpoch, () => 0)
  const session = readScanWorkbenchSession()
  const live = session?.live
  const getTokenRef = useRef(getToken)
  getTokenRef.current = getToken
  const [cloud, setCloud] = useState<{ status: ScanSessionStatusResponse | null; unreadable: boolean }>({
    status: null,
    unreadable: false,
  })
  const [pollNonce, setPollNonce] = useState(0)
  const [armed, setArmed] = useState(false)
  const [stopping, setStopping] = useState(false)
  const [commandBusy, setCommandBusy] = useState(false)
  const stoppingRef = useRef(false)

  const screen = selectDeviceScreen({
    status: cloud.status,
    cloudUnreadable: cloud.unreadable,
    startConfirmed: session?.deviceStartConfirmed === true,
    startInFlight: deviceStartInFlight(),
    localUncertain: session?.deviceLocalUncertain ?? null,
    uncertainCommand: session?.deviceUncertainCommand ?? null,
  })

  useBusyLock(Boolean(live) && screen.kind !== 'terminal')

  useEffect(() => {
    if (!armed) return undefined
    const timer = window.setTimeout(() => setArmed(false), 6000)
    return () => window.clearTimeout(timer)
  }, [armed])

  useEffect(() => {
    const current = readScanWorkbenchSession()
    const credentials = current?.live
    if (!credentials || current?.deviceAcked === true || deviceStartInFlight()) return undefined
    const generation = scanLifecycleGeneration()
    const memberToken = getToken()
    let stale = false
    void acknowledgeScanDelivery(credentials, memberToken).then((outcome) => {
      if (stale || scanLifecycleGeneration() !== generation) {
        if (outcome.ok) revokeCreatedScanSession(credentials, memberToken, 'ack-compensation')
        return
      }
      if (readScanWorkbenchSession()?.deviceAcked === true) return
      if (outcome.ok) {
        patchScanWorkbenchSession({ deviceAcked: true })
        bumpScanDeviceEpoch()
        return
      }
      if (!outcome.definitive || readScanWorkbenchSession()?.result) return
      revokeCreatedScanSession(credentials, memberToken, 'ack-compensation')
      patchScanWorkbenchSession({
        stage: 'result',
        result: { outcome: 'failed', success: false, reason: SCAN_ACK_REFUSED_PROGRESS_REASON },
      })
      onGoStage('result')
    })
    return () => { stale = true }
  }, [epoch, getToken, onGoStage])

  useEffect(() => {
    const credentials = readScanWorkbenchSession()?.live
    if (!credentials) return undefined
    const generation = scanLifecycleGeneration()
    let cancelled = false
    let misses = 0
    const tick = async (): Promise<void> => {
      if (cancelled || readScanWorkbenchSession()?.result) return
      try {
        const status = await getScanSessionStatus(
          credentials.scanTaskId,
          credentials.controlToken,
          getTokenRef.current(),
        )
        if (cancelled || scanLifecycleGeneration() !== generation) return
        misses = 0
        noteScanTaskStatusFromServer(status.scanTaskId, status.status)
        setCloud({ status, unreadable: false })
      } catch {
        if (cancelled) return
        misses += 1
        if (misses >= 2) setCloud({ status: null, unreadable: true })
      }
    }
    void tick()
    const timer = window.setInterval(() => void tick(), POLL_MS)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [live?.scanTaskId, pollNonce, epoch])

  const screenKind = screen.kind
  useEffect(() => {
    if (screenKind === 'terminal') return
    const wanted = wantedStage(screenKind)
    const current = readScanWorkbenchSession()
    if (!current?.live || current.result || current.stage === wanted) return
    patchScanWorkbenchSession({ stage: wanted })
    onGoStage(wanted)
  }, [screenKind, onGoStage])

  useEffect(() => {
    if (screen.kind !== 'terminal') return
    const current = readScanWorkbenchSession()
    if (!current?.live || current.result) return
    const file = cloud.status?.file
    const snapshot: ScanResultSnapshot = {
      outcome: screen.result.outcome,
      success: screen.result.success,
      reason: screen.result.reason,
    }
    if (screen.result.success && fileUsable(file)) {
      snapshot.file = {
        fileId: file.fileId,
        fileUrl: file.fileUrl,
        name: file.filename,
        size: formatSize(file.sizeBytes),
        pages: screen.result.pages,
        format: formatLabelFromMime(file.mimeType),
        mimeType: file.mimeType,
      }
    }
    patchScanWorkbenchSession({ stage: 'result', result: snapshot })
    onGoStage('result')
  }, [screen, cloud.status, onGoStage])

  const applyCommand = (command: 'next' | 'finish', result: LocalScanCommandResult): void => {
    const current = readScanWorkbenchSession()
    if (stoppingRef.current || current?.deviceUncertainCommand === 'stop' || current?.result) return
    if (!result.ok) {
      if (result.kind === 'not-active') {
        setPollNonce((value) => value + 1)
        return
      }
      patchScanWorkbenchSession({
        deviceLocalUncertain: result.kind === 'unreachable' ? 'unreachable' : 'unknown',
        deviceUncertainCommand: command,
      })
      bumpScanDeviceEpoch()
      return
    }
    patchScanWorkbenchSession({ deviceLocalUncertain: undefined, deviceUncertainCommand: undefined })
    bumpScanDeviceEpoch()
    setPollNonce((value) => value + 1)
  }

  const send = (command: 'next-page' | 'finish'): void => {
    if (!live || commandBusy || stopping || screen.kind !== 'more') return
    if (command === 'next-page' && screen.maxPages != null && screen.pages != null && screen.pages >= screen.maxPages) return
    const generation = scanLifecycleGeneration()
    const taskId = live.scanTaskId
    setCommandBusy(true)
    void postLocalScanCommand(command, taskId).then((result) => {
      if (scanLifecycleGeneration() !== generation) return
      applyCommand(command === 'next-page' ? 'next' : 'finish', result)
    }).finally(() => setCommandBusy(false))
  }

  const confirmStop = (): void => {
    if (!live || stoppingRef.current || session?.deviceUncertainCommand === 'stop') return
    stoppingRef.current = true
    setStopping(true)
    setArmed(false)
    const taskId = live.scanTaskId
    const controlToken = live.controlToken
    const memberToken = getToken()
    void (async () => {
      const [abortOutcome, cancelOutcome] = await Promise.allSettled([
        postLocalScanCommand('abort', taskId),
        cancelScanSession(taskId, controlToken, memberToken),
      ])
      const abort: LocalScanCommandResult = abortOutcome.status === 'fulfilled'
        ? abortOutcome.value
        : { ok: false, kind: 'unreachable', code: null }
      let cancelSure = cancelOutcome.status === 'fulfilled'
      const cancelError = cancelOutcome.status === 'rejected' ? cancelOutcome.reason : null
      const cancelUnreachable = !cancelSure && cancelError instanceof ApiHttpError && cancelError.status === 0
      if (cancelUnreachable) {
        try {
          await cancelScanSession(taskId, controlToken, memberToken)
          cancelSure = true
        } catch {
          cancelSure = false
        }
      }
      if (readScanWorkbenchSession()?.result) {
        stoppingRef.current = false
        setStopping(false)
        return
      }
      const abortSure = (abort.ok && abort.state === 'aborted') || (!abort.ok && abort.kind === 'not-active')
      const purged = abort.ok && abort.purged === true
      if (abortSure && cancelSure) {
        patchScanWorkbenchSession({
          stage: 'result',
          result: { outcome: 'failed', success: false, reason: stopReason(purged) },
        })
        onGoStage('result')
        return
      }
      const unreachable = (!abort.ok && abort.kind === 'unreachable') || cancelUnreachable
      patchScanWorkbenchSession({
        deviceLocalUncertain: unreachable ? 'unreachable' : 'unknown',
        deviceUncertainCommand: 'stop',
      })
      bumpScanDeviceEpoch()
      stoppingRef.current = false
      setStopping(false)
    })()
  }

  return {
    ready: Boolean(live),
    screen,
    armed,
    stopping,
    commandBusy,
    stopLocked: session?.deviceUncertainCommand === 'stop',
    pressStop: () => {
      if (stopping || session?.deviceUncertainCommand === 'stop') return
      if (!armed) {
        setArmed(true)
        return
      }
      confirmStop()
    },
    sendNext: () => send('next-page'),
    sendFinish: () => send('finish'),
  }
}
