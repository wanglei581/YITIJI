export interface ApiEnvelope<T> {
  success: true
  data: T
}

export interface ApiErrorEnvelope {
  success: false
  error?: {
    code?: string
    message?: string
  }
}

export interface MemberUser {
  id: string
  phoneMasked: string
  nickname: string | null
}

export interface BackendQrCreateResult {
  ticketId: string
  claimToken: string
  qrUrl: string
  expiresInSeconds: number
}

export interface BackendQrStatusResult {
  status: 'pending' | 'confirmed'
  deviceLabel?: string
  returnTo: string
  expiresInSeconds: number
}

export interface BackendQrClaimResult {
  token: string
  user: MemberUser
}

/** POST /files/kiosk-upload 响应（Agent 以 purpose=print_doc 转发 U 盘文件时复用）。 */
export interface BackendKioskUploadResult {
  fileId: string
  filename: string
  sizeBytes: number
  mimeType: string
  sha256: string
  signedUrl?: string
  signedUrlExpiresAt?: string
}
