/**
 * agent/scan-device/scan-device-types.ts — 屏上扫描调度器对外的类型与常量
 *
 * 单独放在这里，是为了让「一轮扫描」和「本机命令」互相调用时不形成循环依赖。
 */

import type { DeviceLock } from '../device-lock'
import type { DeviceReportBody, FetchDeviceLeaseResult, DeviceReportResult } from './scan-device-backend'
import type { ScanDeviceClock, ScanDeviceHealthSnapshot } from './scan-device-health'
import type { ScanDeviceDeletionReason, ScanTempPurgeResult } from './scan-temp-dir'
import type { composeScanPdf } from './scan-pdf-compose'
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
}
