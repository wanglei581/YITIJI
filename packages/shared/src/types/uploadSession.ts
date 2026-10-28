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
  /** 场景码（24 位 base64url）。一体机出码用 `/k/u/<场景码>` 短链；旧后端不带，前端回落长链。 */
  sceneToken?: string
}

/** POST /upload-sessions/scene/resolve 的回执：手机端用场景码换回会话号与上传令牌，不含控制令牌。 */
export interface UploadSessionSceneResolveResponse {
  sessionId: string
  purpose: FilePurpose
  mode: UploadSessionMode
  expiresAt: string
  uploadToken: string
}

export interface UploadSessionFileView {
  fileId: string
  filename: string
  sizeBytes: number
  mimeType: string
  sha256: string
  fileExpiresAt: string | null
  /** resume_upload / print_doc / signature_image / contract_upload 在 confirm 时携带的短时签名内容 URL。 */
  fileUrl?: string | null
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
