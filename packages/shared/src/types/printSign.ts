// packages/shared/src/types/printSign.ts
//
// 签名盖章（图形排版）契约 SSOT。后端在
// services/api/src/print-sign/print-sign.types.ts 保留本地副本（原因见
// print-conversion.types.ts 顶部注释：API 是 commonjs，shared 是 ESM-only）。
// 任何字段变更必须同时改两处。

export type SignStampPosition =
  | 'top-left' | 'top-center' | 'top-right'
  | 'middle-left' | 'center' | 'middle-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right'

export type SignStampSize = 'small' | 'medium' | 'large'

export interface SignStampSource {
  fileId: string
  /** 上传/扫码确认后返回的内部 HMAC 签名 URL，作为访问凭证；不用于实际读取。会员路径以登录态归属为准、不校验此 URL（与 print-conversion 同语义）。 */
  fileAccessUrl: string
}

export interface SignStampPlacement {
  /** 1-based 页码 */
  page: number
  position: SignStampPosition
  size: SignStampSize
}

export interface SignInspectRequest {
  terminalId: string
  document: SignStampSource
}

export interface SignInspectResponse {
  pages: number
}

export interface SignComposeRequest {
  terminalId: string
  document: SignStampSource
  stamp: SignStampSource
  placement: SignStampPlacement
  /** 用户勾选"本人拥有该签名/印章图片的使用授权"；必须为 true */
  authorizationConfirmed: boolean
}

export interface SignComposeResponse {
  fileId: string
  /** 内部 HMAC 打印链路 URL（30 分钟 TTL），非 COS 预签名；可作为下一轮 document.fileAccessUrl 凭证（"再加一处"循环） */
  printFileUrl: string
  fileMd5: string
  sizeBytes: number
  pages: number
}

export type SignComposeErrorCode =
  | 'SIGN_SOURCE_NOT_FOUND'
  | 'SIGN_DOC_TYPE_UNSUPPORTED'
  | 'SIGN_DOC_UNSUPPORTED'
  | 'SIGN_DOC_HAS_DIGITAL_SIGNATURE'
  | 'SIGN_DOC_TOO_LARGE'
  | 'SIGN_DOC_TOO_MANY_PAGES'
  | 'SIGN_STAMP_TYPE_UNSUPPORTED'
  | 'SIGN_STAMP_UNSUPPORTED'
  | 'SIGN_STAMP_TOO_LARGE'
  | 'SIGN_PLACEMENT_INVALID'
  | 'SIGN_OUTPUT_TOO_LARGE'
  | 'SIGN_IN_PROGRESS'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'SIGN_FAILED'
