import type { FilePurpose } from './file'

export type UploadSessionMode = 'temporary' | 'member'
export type UploadSessionStatus = 'pending' | 'uploading' | 'uploaded' | 'confirmed' | 'expired' | 'cancelled'
export type UploadSessionChannel = 'phone_h5'

export interface UploadSessionCreateRequest {
  purpose: FilePurpose
  mode: UploadSessionMode
  channel: UploadSessionChannel
  terminalId?: string | null
}

export interface UploadSessionCreateResponse {
  sessionId: string
  uploadUrl: string
  uploadToken: string
  controlToken: string
  expiresAt: string
}

export interface UploadSessionFileView {
  fileId: string
  filename: string
  sizeBytes: number
  mimeType: string
  sha256: string
  fileExpiresAt: string | null
}

export interface UploadSessionStatusResponse {
  sessionId: string
  status: UploadSessionStatus
  purpose: FilePurpose
  mode: UploadSessionMode
  file: UploadSessionFileView | null
  requiresKioskConfirmation: boolean
  expiresAt: string
}

export interface UploadSessionConfirmResponse {
  sessionId: string
  status: 'confirmed'
  file: UploadSessionFileView
}

export interface UploadSessionCancelResponse {
  sessionId: string
  status: 'cancelled'
}
