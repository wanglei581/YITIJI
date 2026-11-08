import type { ScanDeviceSettingsRequest, ScanSessionStatusResponse } from '@ai-job-print/shared'
import { getScanSessionStatus, switchScanSessionToPanel, updateScanDeviceSettings } from '../../services/api/scanTasks'
import { ApiHttpError } from '../../services/api/httpAdapter'
import { postLocalScanCommand } from '../../services/scan/localScanApi'
import { bumpScanDeviceEpoch } from './scanDeviceEpoch'
import { patchScanWorkbenchSession, readScanWorkbenchSession, scanLifecycleGeneration } from './scanWorkbenchSession'
import type { ScanStage } from './scanWorkbenchModel'

// 同页多入口与返回设置页共用单飞，切页也不释放在途写操作。
let inFlight = false
export function deviceRecoveryInFlight(): boolean { return inFlight }

export async function recoverDeviceSession(input: {
  action: 'retry' | 'panel'
  settings?: ScanDeviceSettingsRequest
  token: string | null
  onGoStage: (stage: ScanStage) => void
  onStatus?: (status: ScanSessionStatusResponse) => void
}): Promise<void> {
  const current = readScanWorkbenchSession()
  const live = current?.live
  if (inFlight || !live || current?.deviceAcked !== true || current.deviceUncertainCommand === 'stop') return
  inFlight = true
  const generation = scanLifecycleGeneration()
  const active = (): boolean => scanLifecycleGeneration() === generation
    && readScanWorkbenchSession()?.live?.scanTaskId === live.scanTaskId
  const uncertain = (): void => {
    if (!active()) return
    patchScanWorkbenchSession({ stage: 'progress', deviceLocalUncertain: 'unknown', deviceUncertainCommand: 'start' })
    bumpScanDeviceEpoch()
    input.onGoStage('progress')
  }
  try {
    if (input.action === 'panel') {
      const response = await switchScanSessionToPanel(live.scanTaskId, live.controlToken, input.token)
      if (!active()) return
      if (response.scanTaskId !== live.scanTaskId || response.startMode !== 'panel'
        || !Array.isArray(response.instructions) || !response.instructions.length
        || !response.instructions.every((line) => typeof line === 'string' && line.trim())
        || !Number.isFinite(Date.parse(response.expiresAt))) { uncertain(); return }
      patchScanWorkbenchSession({
        stage: 'settings', deviceFlow: undefined,
        deviceLocalUncertain: undefined, deviceUncertainCommand: undefined,
        live: { ...live, instructions: response.instructions, expiresAt: response.expiresAt },
      })
      bumpScanDeviceEpoch()
      input.onGoStage('settings')
      return
    }
    const settings = input.settings ?? current.deviceChoice
    if (!settings) { uncertain(); return }
    const response = await updateScanDeviceSettings(live.scanTaskId, live.controlToken, settings, input.token)
    if (!active()) return
    if (response.scanTaskId !== live.scanTaskId || response.startMode !== 'device' || response.deviceState !== 'ready'
      || !['flatbed', 'feeder'].includes(response.source) || !['gray', 'color'].includes(response.colorMode)
      || !Number.isFinite(Date.parse(response.expiresAt))) { uncertain(); return }
    patchScanWorkbenchSession({
      stage: 'progress', live: { ...live, expiresAt: response.expiresAt },
      deviceChoice: { source: response.source, colorMode: response.colorMode },
      deviceStartAttempted: true, deviceStartConfirmed: false,
      deviceLocalUncertain: undefined, deviceUncertainCommand: undefined,
    })
    input.onGoStage('progress')
    const result = await postLocalScanCommand('start', live.scanTaskId)
    if (!active()) { void postLocalScanCommand('abort', live.scanTaskId); return }
    if (result.ok) {
      patchScanWorkbenchSession({ deviceStartConfirmed: true })
    } else if (result.kind !== 'not-active') {
      patchScanWorkbenchSession({
        deviceLocalUncertain: result.kind === 'unreachable' ? 'unreachable' : 'unknown', deviceUncertainCommand: 'start',
      })
    }
    bumpScanDeviceEpoch()
  } catch (error) {
    if (!active()) return
    if (error instanceof ApiHttpError && error.status === 409) {
      // 409 只说明没切成。先重读真实状态，不修改 deviceFlow，不用本地猜的面板步骤。
      try {
        const status = await getScanSessionStatus(live.scanTaskId, live.controlToken, input.token)
        if (active()) {
          input.onStatus?.(status)
          patchScanWorkbenchSession({ stage: 'progress' })
          input.onGoStage('progress')
        }
      } catch { uncertain() }
    } else { uncertain() }
  } finally {
    inFlight = false
    bumpScanDeviceEpoch()
  }
}
