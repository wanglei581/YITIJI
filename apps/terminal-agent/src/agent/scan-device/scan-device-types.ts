/**
 * agent/scan-device/scan-device-types.ts — 屏上扫描调度器对外的类型与常量
 *
 * 单独放在这里，是为了让「一轮扫描」和「本机命令」互相调用时不形成循环依赖。
 */

import type { DeviceLock } from '../device-lock'
import type { DeviceReportBody, FetchDeviceLeaseResult, DeviceReportResult } from './scan-device-backend'
import type { ScanDeviceClock, ScanDeviceHealthSnapshot } from './scan-device-health'
import type { ScanDeviceDeletionReason, ScanTempPurgeResult } from './scan-temp-dir'
import { SCAN_PDF_MAX_BYTES, type composeScanPdf } from './scan-pdf-compose'
import type { createScanTaskDir, sweepScanDeviceResidue } from './scan-temp-dir'
import type { runWiaProbe } from './wia-probe'
import type { startWiaScan } from './wia-runner'
import type { ScanDeviceErrorCode } from './wia-script'
import type { ScanDeviceReportState } from './scan-device-backend'

/** 合成 PDF 的余量。页字节累计超过 18 MiB 减这份余量就停，不再等合完才发现太大。 */
export const SCAN_PDF_COMPOSE_MARGIN_BYTES = 256 * 1024
export const SCAN_DEVICE_REPORT_ATTEMPTS = 3
export const SCAN_DEVICE_REPORT_RETRY_DELAYS_MS = [200, 400] as const

export interface ScanDeviceView {
  state: ScanDeviceReportState
  pageCount: number
  errorCode: ScanDeviceErrorCode | null
  /**
   * 这次命令有没有把页目录删掉。
   * 只有真的尝试过清理才带上：true 已删除或不存在，false 没删成（还会重试）。
   */
  purged?: boolean
}

function positiveLimit(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) return undefined
  return value
}

/**
 * 页数取本机配置和租约上限里更严的一个。字节取租约和 18 MiB 里更严的一个，再留出合成余量。
 * 租约没给、或给的不是正整数时，该项沿用原来的默认。
 */
export function resolveScanDeviceLimits(
  localMaxPages: number,
  device: { maxPages?: number; maxBytes?: number } | undefined,
): { pageCap: number; byteBudget: number } {
  const leasePages = positiveLimit(device?.maxPages)
  const pageCap = leasePages === undefined ? localMaxPages : Math.min(localMaxPages, leasePages)
  const leaseBytes = positiveLimit(device?.maxBytes)
  const byteCap = leaseBytes === undefined ? SCAN_PDF_MAX_BYTES : Math.min(SCAN_PDF_MAX_BYTES, leaseBytes)
  return { pageCap, byteBudget: Math.max(0, byteCap - SCAN_PDF_COMPOSE_MARGIN_BYTES) }
}

/** 合成前核对：页列表长度等于已经回报的页数，且页序正好是 1..n。 */
export function scanPagesAligned(pageCount: number, pages: readonly { index: number }[]): boolean {
  if (pageCount < 1 || pages.length !== pageCount) return false
  for (let i = 0; i < pages.length; i += 1) {
    if (pages[i]?.index !== i + 1) return false
  }
  return true
}

export class LocalScanError extends Error {
  readonly name = 'LocalScanError'
  constructor(
    readonly httpStatus: number,
    readonly code: string,
    readonly snapshot: ScanDeviceView,
    message: string,
  ) {
    super(message)
  }
}

export interface ScanDeviceDeliveryInput {
  scanTaskId: string
  bytes: Buffer
  deliveryLease: string
  candidateSnapshotAt: string
  origin: 'device'
}

export interface ScanDeviceRuntimeDeps {
  startScan: typeof startWiaScan
  runProbe: typeof runWiaProbe
  compose: typeof composeScanPdf
  deliver: (input: ScanDeviceDeliveryInput) => Promise<void>
  fetchLease: (now: number) => Promise<FetchDeviceLeaseResult>
  report: (taskId: string, body: DeviceReportBody) => Promise<DeviceReportResult>
  purge: (
    taskId: string,
    reason: ScanDeviceDeletionReason,
    hooks?: { root?: string },
  ) => ScanTempPurgeResult
  sweep: typeof sweepScanDeviceResidue
  createDir: typeof createScanTaskDir
  readFile: (file: string) => Promise<Buffer>
  /** 发起上传之前再让出一次，让已经受理的中止赶在上传之前被看见。 */
  beforeUpload?: () => Promise<void>
  /** 强杀后的进程还在不在。探测与下一场开始靠它确认旧进程已经退出。 */
  isProcessAlive?: (pid: number) => boolean
  clock: ScanDeviceClock
  lock: DeviceLock
  root?: string
  reportDelaysMs: readonly number[]
}

export interface ScanDeviceRuntime {
  start(scanTaskId: string): Promise<ScanDeviceView>
  nextPage(scanTaskId: string): Promise<ScanDeviceView>
  finish(scanTaskId: string): Promise<ScanDeviceView>
  abort(scanTaskId: string): Promise<ScanDeviceView>
  probe(): Promise<ScanDeviceHealthSnapshot>
  health(): ScanDeviceHealthSnapshot
  arm(): void
  stop(): void
  whenIdle(): Promise<void>
  /** 还在排队重试的目录清理。0 表示没有未完成的清理。 */
  cleanupPending(): number
}
