/**
 * 格式转换（图片→PDF）契约本地副本。
 *
 * **契约源**：packages/shared/src/types/printConversion.ts
 *
 * 为什么不直接 import @ai-job-print/shared：services/api 走 commonjs + node
 * moduleResolution，而 packages/shared 是 ESM-only、exports 直指 .ts，互操作复杂。
 * decision 是把类型本地副本化、严格遵守 SSOT 注释（见 files/file.types.ts）。
 *
 * 任何字段变更必须同时改两处：
 *   1. packages/shared/src/types/printConversion.ts（前端 SSOT）
 *   2. 本文件（后端副本）
 */

export interface ConvertImageSource {
  fileId: string
  /** 上传/扫码确认后返回的内部 HMAC 签名 URL，作为该图片的访问凭证；不用于实际读取，只用于服务端校验持有权。 */
  fileAccessUrl: string
}

export interface ConvertImagesResponse {
  fileId: string
  /** 内部 HMAC 打印链路 URL（30 分钟 TTL），不是 COS 预签名 URL。 */
  printFileUrl: string
  fileMd5: string
  sizeBytes: number
  pages: number
}
