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
}

/** Browser-safe identity exposed only through the loopback Origin allowlist. */
export interface LocalTerminalIdentityResponse {
  terminalId: string
  terminalCode: string
}

export interface LocalPrintWakeResponse {
  accepted: true
  coalesced: boolean
}

export type LocalUpdateDrainReason =
  | 'ready'
  | 'task_active'
  | 'scan_active'
  | 'status_receipts_pending'
  | 'database_unavailable'

export interface LocalUpdateDrainStatus {
  acceptingClaims: boolean
  activeTask: boolean
  activeScanDeliveries: number
  pendingStatusReceipts: number
  ready: boolean
  reason: LocalUpdateDrainReason
}

export interface LocalUpdateHealthStatus {
  runtimeVersion: string
  cloudConnected: boolean
  localTaskDatabaseAvailable: boolean
  credentialStatus: 'ready' | 'unauthorized'
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
