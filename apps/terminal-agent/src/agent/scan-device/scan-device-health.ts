/**
 * agent/scan-device/scan-device-health.ts — 扫描仪健康探测的时机与最近一次结果
 *
 * 开机延后几秒、之后空闲每 15 分钟、每场扫描结束、以及本机 /local/scan/probe。
 * 探测用 tryAcquire：被占用就立刻记 busy，不等。正在扫描、合成、投递时跳过周期探测，
 * 避免把自己占着的锁记成 busy。
 */

import type { DeviceLock, DeviceLockHandle } from '../device-lock'
import type { WiaProbeResult } from './wia-probe'

export const SCAN_DEVICE_PROBE_START_DELAY_MS = 5_000
export const SCAN_DEVICE_PROBE_INTERVAL_MS = 15 * 60 * 1000

export type ScanDeviceHealthState = 'ready' | 'busy' | 'not_found' | 'error' | 'unknown'

export interface ScanDeviceHealthSnapshot {
  health: ScanDeviceHealthState
  observedAt: string
}

export interface ScanDeviceClock {
  now(): number
  setTimeout(callback: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

export interface ScanDeviceHealthDeps {
  clock: ScanDeviceClock
  lock: Pick<DeviceLock, 'tryAcquire'>
  runProbe: (options: { deviceName?: string }) => Promise<Pick<WiaProbeResult, 'state'>>
  deviceName: () => string
  /** 周期探测在这些阶段跳过。 */
  getPhase: () => string
  /** 强杀后确认旧进程是否还在。没注入时无法确认，按还在处理。 */
  isProcessAlive?: (pid: number) => boolean
}

export interface ScanDeviceHealth {
  probe(options?: { periodic?: boolean }): Promise<ScanDeviceHealthSnapshot>
  arm(): void
  stop(): void
  snapshot(): ScanDeviceHealthSnapshot
  noteForceKilled(): void
  hasForceKilled(): boolean
  clearForceKilled(): void
  /** 强杀没有确认进程退出。健康态记为 error，扫描和探测在解除前不再连扫描仪。 */
  noteSuspect(pid?: number): void
  hasSuspect(): boolean
  /** 旧进程还在，或根本没有进程号、无法确认已经退出。 */
  suspectProcessAlive(): boolean
  clearSuspect(): void
}

/** 进程不存在才算退出。权限不够（EPERM）仍当作还在。 */
export function defaultScanProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return true
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function iso(ms: number): string {
  return new Date(ms).toISOString()
}

export function createScanDeviceHealth(deps: ScanDeviceHealthDeps): ScanDeviceHealth {
  let health: ScanDeviceHealthState = 'unknown'
  let observedAt = iso(deps.clock.now())
  let forceKilled = false
  let suspect = false
  let suspectPid: number | undefined
  let timer: unknown
  let stopped = false

  const processAlive = (pid: number): boolean => {
    if (!deps.isProcessAlive) return true
    return deps.isProcessAlive(pid)
  }

  const suspectAlive = (): boolean => {
    if (!suspect) return false
    if (suspectPid === undefined) return true
    return processAlive(suspectPid)
  }

  const record = (next: ScanDeviceHealthState): ScanDeviceHealthSnapshot => {
    health = next
    observedAt = iso(deps.clock.now())
    return { health, observedAt }
  }

  const probe = async (options?: { periodic?: boolean }): Promise<ScanDeviceHealthSnapshot> => {
    const phase = deps.getPhase()
    if (
      options?.periodic &&
      (phase === 'scanning' || phase === 'composing' || phase === 'delivering')
    ) {
      return { health, observedAt }
    }
    if (suspectAlive()) return record('error')
    let handle: DeviceLockHandle | undefined
    try {
      handle = deps.lock.tryAcquire('scan-probe')
    } catch {
      handle = undefined
    }
    if (!handle) return record('busy')
    try {
      const result = await deps.runProbe({ deviceName: deps.deviceName() || undefined })
      if (suspect && result.state === 'ready' && !suspectAlive()) {
        suspect = false
        suspectPid = undefined
        forceKilled = false
      }
      return record(result.state)
    } catch {
      return record('error')
    } finally {
      handle.release()
    }
  }

  const arm = (): void => {
    const kick = (): void => {
      if (stopped) return
      void probe({ periodic: true }).finally(() => {
        if (stopped) return
        timer = deps.clock.setTimeout(kick, SCAN_DEVICE_PROBE_INTERVAL_MS)
      })
    }
    timer = deps.clock.setTimeout(kick, SCAN_DEVICE_PROBE_START_DELAY_MS)
  }

  return {
    probe,
    arm,
    stop: () => {
      stopped = true
      if (timer !== undefined) deps.clock.clearTimeout(timer)
      timer = undefined
    },
    snapshot: () => ({ health, observedAt }),
    noteForceKilled: () => {
      forceKilled = true
    },
    hasForceKilled: () => forceKilled,
    clearForceKilled: () => {
      forceKilled = false
    },
    noteSuspect: (pid?: number) => {
      suspect = true
      suspectPid = pid
      forceKilled = true
      record('error')
    },
    hasSuspect: () => suspect,
    suspectProcessAlive: () => suspectAlive(),
    clearSuspect: () => {
      suspect = false
      suspectPid = undefined
    },
  }
}
