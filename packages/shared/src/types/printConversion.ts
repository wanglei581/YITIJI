export interface ConvertImageSource {
  fileId: string
  /** 上传/扫码确认后返回的内部 HMAC 签名 URL，作为该图片的访问凭证；不用于实际读取，只用于服务端校验持有权。 */
  fileAccessUrl: string
}

export interface ConvertImagesRequest {
  sources: ConvertImageSource[]
}

export interface ConvertImagesResponse {
  fileId: string
  /** 内部 HMAC 打印链路 URL（30 分钟 TTL），不是 COS 预签名 URL。 */
  printFileUrl: string
  fileMd5: string
  sizeBytes: number
  pages: number
}

export type ConvertImagesErrorCode =
  | 'CONVERT_INPUT_INVALID'
  | 'CONVERT_TOO_MANY_IMAGES'
  | 'CONVERT_SOURCE_NOT_FOUND'
  | 'CONVERT_SOURCE_TYPE_UNSUPPORTED'
  | 'CONVERT_SOURCE_TOO_LARGE'
  | 'CONVERT_IMAGE_DIMENSIONS_INVALID'
  | 'CONVERT_TOTAL_LIMIT_EXCEEDED'
  | 'CONVERT_OUTPUT_TOO_LARGE'
  | 'CONVERSION_IN_PROGRESS'
  | 'IDEMPOTENCY_KEY_REUSED'
  | 'CONVERT_FAILED'

// ── 签名盖章：目标文件 + 签名/印章素材合成 ──────────────────────────

/** 待签的目标文件（purpose=print_doc，与格式转换同款访问凭证契约）。 */
export interface SignatureOverlayTarget {
  fileId: string
  fileAccessUrl: string
}

/** 签名 / 印章素材图片（purpose=signature_source）。 */
export interface SignatureOverlaySignature {
  fileId: string
  fileAccessUrl: string
}

/** 叠加位置预设（不支持自由拖拽）。 */
export type OverlayPosition = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center'

/** 叠加大小预设，相对目标页面宽度的比例档位。 */
export type OverlaySize = 'small' | 'medium' | 'large'

export interface ComposeSignatureOverlayRequest {
  target: SignatureOverlayTarget
  signature: SignatureOverlaySignature
  position: OverlayPosition
  size: OverlaySize
}

export interface ComposeSignatureOverlayResponse {
  fileId: string
  /** 内部 HMAC 打印链路 URL（30 分钟 TTL），不是 COS 预签名 URL。 */
  printFileUrl: string
  fileMd5: string
  sizeBytes: number
  pages: number
}

export type ComposeSignatureOverlayErrorCode =
  | 'SIGN_OVERLAY_INPUT_INVALID'
  | 'SIGN_OVERLAY_TARGET_NOT_FOUND'
  | 'SIGN_OVERLAY_SIGNATURE_NOT_FOUND'
  | 'SIGN_OVERLAY_TARGET_TYPE_UNSUPPORTED'
  | 'SIGN_OVERLAY_SIGNATURE_TYPE_UNSUPPORTED'
  | 'SIGN_OVERLAY_TARGET_TOO_LARGE'
  | 'SIGN_OVERLAY_SIGNATURE_TOO_LARGE'
  | 'SIGN_OVERLAY_IMAGE_DIMENSIONS_INVALID'
  | 'SIGN_OVERLAY_FAILED'
