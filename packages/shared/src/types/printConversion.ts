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
