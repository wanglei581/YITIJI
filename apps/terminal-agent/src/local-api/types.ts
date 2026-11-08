import type { MemberUser } from './wire'
import type { PrinterStatus, ScanInputHealthReason, ScanInputHealthStatus } from '../agent/types'

export interface LocalQrCreateRequest {
  deviceId?: string
  deviceLabel?: string
  returnTo?: string
}

export interface LocalQrCreateResponse {
  ticketId: string
  qrUrl: string
  expiresInSeconds: number
  returnTo: string
}

export interface LocalQrClaimRequest {
  ticketId?: string
}

export interface LocalQrClaimResponse {
  token: string
  user: MemberUser
}

export interface LocalApiError {
  code: string
  message: string
  /** 屏上扫描命令被拒时，带上当时的本机状态，方便一体机显示。其它接口不填。 */
  state?: string
  pageCount?: number
  errorCode?: string | null
  /** 屏上扫描：这次有没有把已扫页删掉。没尝试清理时不带。 */
  purged?: boolean
}

/** Browser-safe identity exposed only through the loopback Origin allowlist. */
export interface LocalTerminalIdentityResponse {
  terminalId: string
  terminalCode: string
}

/** One-minute bootstrap ticket; Agent credentials never leave the loopback server. */
export interface LocalTerminalBootTicketResponse {
  bootTicket: string
  expiresInSeconds: number
}

export interface LocalPrintWakeResponse {
  accepted: true
  coalesced: boolean
}

/** PII-safe snapshot rendered by the read-only loopback status panel. */
export interface LocalAgentPanelStatus {
  runtimeVersion: string
  terminalCode: string
  serviceState: 'running'
  cloudConnected: boolean
  lastHeartbeatAt: string | null
  printerStatus: PrinterStatus
  localTaskDatabaseAvailable: boolean
  scanInputStatus: ScanInputHealthStatus
  scanInputReason: ScanInputHealthReason
  credentialStatus: 'ready' | 'unauthorized'
}

// ── U 盘导入（Task 9） ──────────────────────────────────────────────────────

export interface LocalUsbStatusResponse {
  present: boolean
  driveLabel: string | null
}

export interface LocalUsbFileItem {
  safeId: string
  filename: string
  extension: string
  sizeBytes: number
}

export interface LocalUsbListResponse extends LocalUsbStatusResponse {
  files: LocalUsbFileItem[]
}

export interface LocalUsbUploadRequest {
  safeId?: string
  purpose?: 'print_doc' | 'resume_upload'
}

export interface LocalUsbUploadResponse {
  fileId: string
  filename: string
  sizeBytes: number
  mimeType: string
  sha256: string
  fileUrl: string | null
  fileUrlExpiresAt: string | null
}
