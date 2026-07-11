import type { MemberUser } from './wire'

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
