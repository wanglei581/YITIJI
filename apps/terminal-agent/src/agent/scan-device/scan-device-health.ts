/**
 * agent/scan-device/scan-device-health.ts — 扫描仪健康探测的时机与最近一次结果
 *
 * 开机延后几秒、之后空闲每 15 分钟、每场扫描结束、以及本机 /local/scan/probe。
 * 探测用 tryAcquire：被占用就立刻记 busy，不等。正在扫描、合成、投递时跳过周期探测，
 * 避免把自己占着的锁记成 busy。
 */

import { execFileSync } from 'child_process'
import type { DeviceLock, DeviceLockHandle } from '../device-lock'
import type { WiaProbeResult } from './wia-probe'
import { commandLineIsOurWiaProcess } from './wia-script'

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

/** 本机还能看见的进程。unknown 表示这次没列出来，不能当成「已经没有残留」。 */
export type ResidualSurvey =
  | { kind: 'ok'; processes: readonly { pid: number; commandLine: string }[] }
  | { kind: 'unknown' }

export interface ProcessStopReport {
  stopUnconfirmed: boolean
  processId?: number
}

export interface ScanDeviceHealthDeps {
  clock: ScanDeviceClock
  lock: Pick<DeviceLock, 'tryAcquire'>
  runProbe: (options: { deviceName?: string }) => Promise<Pick<WiaProbeResult, 'state'> & Partial<Pick<WiaProbeResult, 'stopUnconfirmed' | 'processId'>>>
  deviceName: () => string
  /** 周期探测在这些阶段跳过。 */
  getPhase: () => string
  /** 强杀后确认旧进程是否还在。没注入时无法确认，按还在处理。 */
  isProcessAlive?: (pid: number) => boolean
  /**
   * 列出本机进程，用来核对没有 PID 时是不是还留着本程序起的 PowerShell。
   * 没注入时：Windows 上查一次，其它平台视为 unknown（不解除可疑）。
   */
  listResiduals?: () => ResidualSurvey
}

export interface ScanDeviceHealth {
  probe(options?: { periodic?: boolean; heldLock?: DeviceLockHandle }): Promise<ScanDeviceHealthSnapshot>
  arm(): void
  stop(): void
  snapshot(): ScanDeviceHealthSnapshot
  noteForceKilled(): void
  hasForceKilled(): boolean
  clearForceKilled(): void
  /**
   * 扫描和探测共用的唯一出口。stopUnconfirmed 为假时什么都不记。
   * 没有 PID 也记成可疑，不能当成进程已经不在。
   */
  noteProcessStop(report: ProcessStopReport): void
  /** 强杀没有确认进程退出。健康态记为 error，扫描和探测在解除前不再连扫描仪。 */
  noteSuspect(pid?: number): void
  hasSuspect(): boolean
  /** 已知 PID 的旧进程还在。没有 PID 的可疑不在这里，免得还没探测就把连接挡死。 */
  knownProcessAlive(): boolean
  /** 没有 PID 的未确认退出还没被一次成功探测解除。 */
  unidentifiedSuspect(): boolean
  /** 旧进程还在，或根本没有进程号、无法确认已经退出。 */
  suspectProcessAlive(): boolean
  clearSuspect(): void
}

function parseProcessList(stdout: string): { pid: number; commandLine: string }[] {
  const text = stdout.trim()
  if (!text) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    return []
  }
  const rows = Array.isArray(parsed) ? parsed : [parsed]
  const found: { pid: number; commandLine: string }[] = []
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const pid = (row as { ProcessId?: unknown }).ProcessId
    const commandLine = (row as { CommandLine?: unknown }).CommandLine
    if (typeof pid === 'number' && Number.isInteger(pid) && typeof commandLine === 'string') {
      found.push({ pid, commandLine })
    }
  }
  return found
}

/** Windows 上按命令行列出 powershell。列不出来就当 unknown，不当成已经干净。 */
export function defaultListResidualProcesses(): ResidualSurvey {
  if (process.platform !== 'win32') return { kind: 'unknown' }
  try {
    const stdout = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        "Get-CimInstance Win32_Process -Filter \"Name = 'powershell.exe'\" | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress",
      ],
      { timeout: 5_000, windowsHide: true, encoding: 'utf8' },
    )
    return { kind: 'ok', processes: parseProcessList(stdout) }
  } catch {
    return { kind: 'unknown' }
  }
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
  /** 这次未确认退出没有进程号。解除前必须探测成功，并且残留列表是空的。 */
  let unidentified = false
  let timer: unknown
  let stopped = false

  const processAlive = (pid: number): boolean => {
    if (!deps.isProcessAlive) return true
    return deps.isProcessAlive(pid)
  }

  const listResiduals = (): ResidualSurvey => (deps.listResiduals ?? defaultListResidualProcesses)()

  const residualKind = (): 'empty' | 'found' | 'unknown' => {
    const listed = listResiduals()
    if (listed.kind !== 'ok') return 'unknown'
    return listed.processes.some((row) => commandLineIsOurWiaProcess(row.commandLine)) ? 'found' : 'empty'
  }

  const knownAlive = (): boolean => suspect && suspectPid !== undefined && processAlive(suspectPid)

  const suspectAlive = (): boolean => {
    if (!suspect) return false
    if (suspectPid !== undefined) return processAlive(suspectPid)
    return true
  }

  const record = (next: ScanDeviceHealthState): ScanDeviceHealthSnapshot => {
    health = next
    observedAt = iso(deps.clock.now())
    return { health, observedAt }
  }

  const noteProcessStop = (report: ProcessStopReport): void => {
    if (!report.stopUnconfirmed) return
    suspect = true
    forceKilled = true
    if (report.processId === undefined) {
      unidentified = true
      suspectPid = undefined
    } else {
      unidentified = false
      suspectPid = report.processId
    }
    record('error')
  }

  const clearSuspectNow = (): void => {
    suspect = false
    suspectPid = undefined
    unidentified = false
    forceKilled = false
  }

  const probe = async (options?: { periodic?: boolean; heldLock?: DeviceLockHandle }): Promise<ScanDeviceHealthSnapshot> => {
    const phase = deps.getPhase()
    if (
      options?.periodic &&
      (phase === 'scanning' || phase === 'composing' || phase === 'delivering')
    ) {
      return { health, observedAt }
    }
    if (knownAlive()) return record('error')
    if (unidentified) {
      const residuals = residualKind()
      if (residuals !== 'empty') return record('error')
    }
    let handle: DeviceLockHandle | undefined
    try {
      handle = options?.heldLock ?? deps.lock.tryAcquire('scan-probe')
    } catch {
      handle = undefined
    }
    if (!handle) return record('busy')
    try {
      const result = await deps.runProbe({ deviceName: deps.deviceName() || undefined })
      if (result.stopUnconfirmed) {
        noteProcessStop({
          stopUnconfirmed: true,
          ...(result.processId !== undefined ? { processId: result.processId } : {}),
        })
        return { health, observedAt }
      }
      if (suspect && result.state === 'ready') {
        if (unidentified || suspectPid === undefined) {
          if (residualKind() === 'empty') clearSuspectNow()
        } else if (!processAlive(suspectPid)) {
          clearSuspectNow()
        }
      }
      return record(result.state)
    } catch {
      return record('error')
    } finally {
      if (!options?.heldLock) handle.release()
    }
  }

  const arm = (): void => {
    stopped = false
    if (timer !== undefined) deps.clock.clearTimeout(timer)
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
    noteProcessStop,
    noteSuspect: (pid?: number) => {
      noteProcessStop({ stopUnconfirmed: true, ...(pid !== undefined ? { processId: pid } : {}) })
    },
    hasSuspect: () => suspect,
    knownProcessAlive: () => knownAlive(),
    unidentifiedSuspect: () => unidentified && suspect,
    suspectProcessAlive: () => suspectAlive(),
    clearSuspect: () => {
      suspect = false
      suspectPid = undefined
      unidentified = false
    },
  }
}

/** 同一设备锁对应唯一 WIA 隔离状态；复印与屏上扫描不能各自遗忘旧进程。 */
const sharedHealth = new WeakMap<ScanDeviceHealthDeps['lock'], { health: ScanDeviceHealth; deps: ScanDeviceHealthDeps }>()

/** 拿锁后的最后一道 WIA 闸门。探测借用本次锁，不能重新竞争或提前放锁。 */
export async function scanDeviceStartHealth(health: ScanDeviceHealth, heldLock: DeviceLockHandle): Promise<'ready' | 'busy' | 'not_ready'> {
  if (health.knownProcessAlive()) return 'busy'
  if (!health.hasSuspect() && !health.hasForceKilled()) return 'ready'
  const probed = await health.probe({ heldLock })
  if (health.hasSuspect()) return 'busy'
  if (probed.health !== 'ready') return probed.health === 'busy' ? 'busy' : 'not_ready'
  health.clearForceKilled()
  return 'ready'
}

export function sharedScanDeviceHealth(deps: ScanDeviceHealthDeps, bindOwner = false): ScanDeviceHealth {
  let entry = sharedHealth.get(deps.lock)
  if (!entry) {
    const sharedDeps = { ...deps }
    entry = { health: createScanDeviceHealth(sharedDeps), deps: sharedDeps }
    sharedHealth.set(deps.lock, entry)
  } else if (bindOwner) Object.assign(entry.deps, { listResiduals: undefined }, deps)
  return entry.health
}
