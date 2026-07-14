export type ScanType = 'resume' | 'id' | 'document'
export type ScanTaskStatus = 'waiting' | 'matched' | 'completed' | 'failed' | 'expired' | 'cancelled'

export interface ScanSessionCreateRequest {
  scanType: ScanType
  terminalId: string
}

export interface ScanSessionCreateResponse {
  scanTaskId: string
  /** 明文只在本次创建响应里下发一次，后续 getStatus()/cancel() 必须带上它才能操作该会话（B1-4）。
   *  前端只应把它保存在内存态（React state/ref），不落 localStorage/sessionStorage。 */
  controlToken: string
  expiresAt: string
  /** 按 scanType 定制的操作指引（去打印机面板怎么操作），后端下发，前端不再硬编码。 */
  instructions: string[]
}

export interface ScanSessionFileView {
  fileId: string
  filename: string
  sizeBytes: number
  mimeType: string
  sha256: string
  /** 本系统 HMAC 签名内容 URL，供后续打印/AI 识别流程使用。 */
  fileUrl: string
}

export interface ScanSessionStatusResponse {
  scanTaskId: string
  status: ScanTaskStatus
  scanType: ScanType
  file: ScanSessionFileView | null
  errorCode: string | null
  errorMessage: string | null
  expiresAt: string
}

export interface ScanSessionCancelResponse {
  scanTaskId: string
  status: 'cancelled'
}
