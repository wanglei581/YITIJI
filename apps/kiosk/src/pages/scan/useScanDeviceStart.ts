import { useSyncExternalStore } from 'react'
import { createScanSession } from '../../services/api/scanTasks'
import { ApiHttpError } from '../../services/api/httpAdapter'
import { getTerminalId } from '../../services/api/screensaver'
import { postLocalScanCommand } from '../../services/scan/localScanApi'
import { panelScanType, type ScanDeviceChoice, type ScanMaterial } from './scanMaterials'
import { type ScanStage } from './scanWorkbenchModel'
import {
  acknowledgeScanDelivery,
  SCAN_ACK_REFUSED_PROGRESS_REASON,
} from './scanDeliveryAck'
import { revokeCreatedScanSession } from './scanSessionRevoke'
import { bumpScanDeviceEpoch } from './scanDeviceEpoch'
import {
  patchScanWorkbenchSession,
  patchScanWorkbenchSessionWithDurableLive,
  scanLifecycleGeneration,
} from './scanWorkbenchSession'

const UNRESOLVED_MS = 60_000
const UNRESOLVED_NOTICE = '状态未知。这一次没能确认有没有建成扫描，请先返回，过一会儿再试。不要再点开始。'
const DEFINITE_NOTICE = '这一次没有建成扫描。可以再点一次开始。'

interface StartSnap {
  phase: 'idle' | 'starting'
  notice: string
  locked: boolean
}

const IDLE: StartSnap = { phase: 'idle', notice: '', locked: false }
let snap: StartSnap = IDLE
let inflight: Promise<void> | null = null
let startFlight = false
let unresolvedUntil = 0
let lockTimer = 0
const listeners = new Set<() => void>()

function readSnap(): StartSnap {
  return snap
}

function publish(next: StartSnap): void {
  snap = next
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function deviceStartInFlight(): boolean {
  return startFlight
}

export function useScanDeviceStartState(): StartSnap {
  return useSyncExternalStore(subscribe, readSnap, () => IDLE)
}

export interface DeviceStartRequest {
  material: ScanMaterial
  choice: ScanDeviceChoice
  memberToken: string | null
  onGoStage: (stage: ScanStage) => void
}

function holdUnresolved(): void {
  unresolvedUntil = Date.now() + UNRESOLVED_MS
  window.clearTimeout(lockTimer)
  lockTimer = window.setTimeout(() => {
    if (Date.now() >= unresolvedUntil) publish({ phase: 'idle', notice: '', locked: false })
  }, UNRESOLVED_MS)
  publish({ phase: 'starting', notice: UNRESOLVED_NOTICE, locked: true })
}

/** 只从「开始扫描」的点击进来。建会话、ACK、本机 start 按这个顺序，页面卸掉也走完。 */
export function beginDeviceScan(input: DeviceStartRequest): void {
  if (inflight) return
  if (Date.now() < unresolvedUntil) {
    publish({ phase: 'idle', notice: UNRESOLVED_NOTICE, locked: true })
    return
  }
  startFlight = true
  publish({ phase: 'starting', notice: '', locked: false })
  inflight = run(input).finally(() => {
    inflight = null
    startFlight = false
    publish({ ...readSnap(), phase: 'idle', locked: Date.now() < unresolvedUntil })
  })
}

async function run(input: DeviceStartRequest): Promise<void> {
  const generation = scanLifecycleGeneration()
  const memberToken = input.memberToken
  let created: Awaited<ReturnType<typeof createScanSession>>
  try {
    created = await createScanSession({
      scanType: panelScanType(input.material),
      terminalId: getTerminalId(),
      startMode: 'device',
      source: input.choice.source,
      colorMode: input.choice.colorMode,
    }, memberToken)
  } catch (error) {
    if (scanLifecycleGeneration() !== generation) return
    if (error instanceof ApiHttpError && error.status === 0) {
      holdUnresolved()
      return
    }
    publish({ phase: 'starting', notice: DEFINITE_NOTICE, locked: false })
    return
  }

  if (scanLifecycleGeneration() !== generation) {
    revokeCreatedScanSession(created, memberToken)
    return
  }

  const live = {
    scanTaskId: created.scanTaskId,
    controlToken: created.controlToken,
    instructions: Array.isArray(created.instructions) ? created.instructions : [],
    expiresAt: created.expiresAt,
  }
  const durable = patchScanWorkbenchSessionWithDurableLive({
    stage: 'progress',
    scanType: panelScanType(input.material),
    material: input.material,
    deviceChoice: input.choice,
    deviceFlow: true,
    live,
    result: undefined,
  })
  bumpScanDeviceEpoch()
  input.onGoStage('progress')
  if (!durable) {
    revokeCreatedScanSession(live, memberToken)
    if (scanLifecycleGeneration() === generation) {
      patchScanWorkbenchSession({ stage: 'device-settings', live: undefined })
      input.onGoStage('device-settings')
    }
    holdUnresolved()
    return
  }

  const ack = await acknowledgeScanDelivery(live, memberToken)
  if (scanLifecycleGeneration() !== generation) {
    revokeCreatedScanSession(live, memberToken, ack.ok ? 'ack-compensation' : 'best-effort')
    return
  }
  if (!ack.ok) {
    if (ack.definitive) {
      revokeCreatedScanSession(live, memberToken, 'ack-compensation')
      patchScanWorkbenchSession({
        stage: 'result',
        result: { outcome: 'failed', success: false, reason: SCAN_ACK_REFUSED_PROGRESS_REASON },
      })
      bumpScanDeviceEpoch()
      input.onGoStage('result')
    } else {
      bumpScanDeviceEpoch()
    }
    return
  }

  patchScanWorkbenchSession({ deviceAcked: true, deviceStartAttempted: true })
  bumpScanDeviceEpoch()
  const local = await postLocalScanCommand('start', live.scanTaskId)
  if (scanLifecycleGeneration() !== generation) {
    void postLocalScanCommand('abort', live.scanTaskId)
    return
  }
  if (local.ok) {
    patchScanWorkbenchSession({
      deviceStartConfirmed: true,
      deviceLocalUncertain: undefined,
      deviceUncertainCommand: undefined,
    })
    bumpScanDeviceEpoch()
    return
  }
  if (local.kind === 'not-active') {
    bumpScanDeviceEpoch()
    return
  }
  patchScanWorkbenchSession({
    deviceLocalUncertain: local.kind === 'unreachable' ? 'unreachable' : 'unknown',
    deviceUncertainCommand: 'start',
  })
  bumpScanDeviceEpoch()
}
