import type { LocalScanCommandResult } from '../../services/scan/localScanApi'

/** 只保存收尾事实，不保存控制凭据、身份或材料。须有原工作台 live 才能按 id 读取。 */
const STOP_KEY = 'ai-job-print:scan-device-stop-receipt'
export interface DeviceStopReceipt {
  scanTaskId: string
  abort: 'pending' | 'confirmed' | 'unknown'
  cancel: 'pending' | 'confirmed' | 'unknown'
  purged: boolean
  /** 本地截止只由服务端两时间之差换算，持久化后刷新不重置。 */
  countdownEndsAt: number | null
}

export function readQuietDeadline(response: unknown, receivedAt: number): number | null {
  if (!response || typeof response !== 'object') return null
  const raw = response as { quietPeriodEndsAt?: unknown; serverNow?: unknown }
  if (typeof raw.quietPeriodEndsAt !== 'string' || typeof raw.serverNow !== 'string') return null
  const end = Date.parse(raw.quietPeriodEndsAt)
  const now = Date.parse(raw.serverNow)
  if (!Number.isFinite(end) || !Number.isFinite(now)) return null
  return receivedAt + Math.max(0, end - now)
}

export function remainingQuietSeconds(receipt: DeviceStopReceipt, now: number): number | null {
  if (receipt.countdownEndsAt === null) return null
  return Math.max(0, Math.ceil((receipt.countdownEndsAt - now) / 1000))
}

export function stopConfirmed(receipt: DeviceStopReceipt): boolean {
  return receipt.abort === 'confirmed' && receipt.cancel === 'confirmed'
}

export function abortedReceipt(receipt: DeviceStopReceipt, result: LocalScanCommandResult): DeviceStopReceipt {
  return {
    ...receipt,
    abort: result.ok && result.state === 'aborted' ? 'confirmed' : 'unknown',
    purged: result.ok && result.state === 'aborted' && result.purged === true,
  }
}

export function cancelledReceipt(receipt: DeviceStopReceipt, response: unknown, now: number): DeviceStopReceipt {
  const raw = response as { scanTaskId?: unknown; status?: unknown } | null
  const confirmed = raw?.scanTaskId === receipt.scanTaskId && raw?.status === 'cancelled'
  return {
    ...receipt,
    cancel: confirmed ? 'confirmed' : 'unknown',
    countdownEndsAt: confirmed ? readQuietDeadline(response, now) : null,
  }
}

export function readDeviceStopReceipt(scanTaskId: string | undefined): DeviceStopReceipt | null {
  try {
    const raw = JSON.parse(window.sessionStorage.getItem(STOP_KEY) ?? 'null') as DeviceStopReceipt | null
    if (!scanTaskId || raw?.scanTaskId !== scanTaskId) {
      window.sessionStorage.removeItem(STOP_KEY)
      return null
    }
    if (!['pending', 'confirmed', 'unknown'].includes(raw.abort)
      || !['pending', 'confirmed', 'unknown'].includes(raw.cancel)
      || typeof raw.purged !== 'boolean'
      || !(raw.countdownEndsAt === null || (typeof raw.countdownEndsAt === 'number' && Number.isFinite(raw.countdownEndsAt)))) return null
    return raw
  } catch { return null }
}

export function saveDeviceStopReceipt(receipt: DeviceStopReceipt): void {
  try { window.sessionStorage.setItem(STOP_KEY, JSON.stringify(receipt)) } catch { /* 内存仍可安全显示 */ }
}

/** 两边各自限时、各自登记；一边拒绝不能阻止另一边发出。 */
export async function settleDeviceStop(input: {
  scanTaskId: string
  abort: () => Promise<LocalScanCommandResult>
  cancel: () => Promise<unknown>
  onReceipt: (receipt: DeviceStopReceipt) => void
  now?: () => number
  timeoutMs?: number
}): Promise<DeviceStopReceipt> {
  let receipt: DeviceStopReceipt = {
    scanTaskId: input.scanTaskId, abort: 'pending', cancel: 'pending', purged: false, countdownEndsAt: null,
  }
  const publish = (): void => input.onReceipt({ ...receipt })
  const bounded = async <T,>(run: () => Promise<T>): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        Promise.resolve().then(run),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('unconfirmed')), input.timeoutMs ?? 8000) }),
      ])
    } finally { clearTimeout(timer) }
  }
  publish()
  await Promise.allSettled([
    bounded(input.abort).then((result) => {
      receipt = abortedReceipt(receipt, result)
    }, () => { receipt = { ...receipt, abort: 'unknown', purged: false } }).then(publish),
    bounded(input.cancel).then((response) => {
      receipt = cancelledReceipt(receipt, response, (input.now ?? Date.now)())
    }, () => { receipt = { ...receipt, cancel: 'unknown' } }).then(publish),
  ])
  return receipt
}
