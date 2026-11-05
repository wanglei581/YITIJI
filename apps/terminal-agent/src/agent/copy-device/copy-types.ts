import type { DeviceLock, DeviceLockHandle } from '../device-lock'
import type { AgentConfig } from '../types'
import type { ScanDeviceClock } from '../scan-device/scan-device-health'
import type { ScanTempDirHooks } from '../scan-device/scan-temp-dir'
import type { composeScanPdf } from '../scan-device/scan-pdf-compose'
import type { runWiaProbe } from '../scan-device/wia-probe'
import type { startWiaScan, WiaScanHandle, WiaScannedPage } from '../scan-device/wia-runner'
import type { WiaColor, WiaSource } from '../scan-device/wia-script'

export const COPY_DELETION_REASONS = [
  'COPY_PRINT_TERMINAL', 'COPY_RESCAN', 'COPY_USER_CANCEL', 'COPY_SESSION_CLEAR',
  'COPY_EXPIRED', 'COPY_SCAN_FAILED', 'COPY_STARTUP_RESIDUE',
] as const
export type CopyDeletionReason = (typeof COPY_DELETION_REASONS)[number]
export type CopyAction = 'start' | 'next-page' | 'finish' | 'status' | 'preview' | 'abort' | 'clear'
export interface CopyCommand {
  copyId: string
  generation: number
  operationId: string
  source?: WiaSource
  scanColor?: WiaColor
  page?: number
}
export interface CopyParameters {
  source: WiaSource
  colorMode: 'black_white' | 'color'
  duplex: 'simplex' | 'duplex_long_edge' | 'duplex_short_edge'
  copies: number
  pageCount: number
  maxPages: number
  maxCopies: number
}
/** C1 的在线许可；终端绑定由带 Agent Bearer 的 URL 与服务端归属检查保证。 */
export interface CopyPermit {
  allowed: boolean
  reason: string | null
  copyId: string
  op: 'scan' | 'print'
  generation: number
  authorizationVersion: number
  expiresAt: string
  parameters: CopyParameters
  terminalId?: string
}
export interface CopyView {
  state: 'starting' | 'scanning' | 'page_ready' | 'composing' | 'scanned' | 'cancelled' | 'cleared' | 'expired' | 'failed'
  generation: number
  pageCount: number
  errorCode: string | null
  purged?: boolean
}
export class CopyError extends Error {
  constructor(readonly status: number, readonly code: string, readonly snapshot?: CopyView) {
    super(code)
    this.name = 'CopyError'
  }
}
export interface CopySession {
  command: CopyCommand
  owner: string
  dirId: string
  dir: string
  state: CopyView['state']
  errorCode: string | null
  pages: WiaScannedPage[]
  expiresAt: number
  revoked: boolean
  purged?: boolean
  permit?: CopyPermit
  handle?: WiaScanHandle
  work?: Promise<void>
  retainedLock?: DeviceLockHandle
  suspectPid?: number
  byteBudget: number
  pageCap: number
  cleanupReason?: CopyDeletionReason
  pdfReady?: boolean
}
export interface CopyDeps {
  config: AgentConfig
  clock: ScanDeviceClock
  lock: DeviceLock
  root: string
  tempHooks: ScanTempDirHooks
  startScan: typeof startWiaScan
  compose: typeof composeScanPdf
  runProbe: typeof runWiaProbe
  permit(copyId: string): Promise<CopyPermit>
  report(copyId: string, generation: number, pageCount: number): Promise<void>
  processGone(pid?: number): boolean
}
export interface CopyRuntime {
  command(action: CopyAction, command: CopyCommand, owner: string): Promise<CopyView | Buffer>
  whenIdle(): Promise<void>
  tick(): Promise<void>
  stop(): void
}
export function copyView(s: CopySession): CopyView {
  return { state: s.state, generation: s.command.generation, pageCount: s.pages.length,
    errorCode: s.errorCode, ...(s.purged !== undefined ? { purged: s.purged } : {}) }
}
