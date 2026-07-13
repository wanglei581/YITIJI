// packages/shared/src/types/idPhoto.ts
// ============================================================
// 证件照打印契约（SSOT）。
// 服务端镜像：services/api/src/id-photo/id-photo.types.ts —— 任何字段变更必须同时改两处。
// 设计：docs/superpowers/specs/2026-07-12-id-photo-design.md
// ============================================================

export type IdPhotoSpecId = 'one_inch' | 'small_one_inch' | 'two_inch' | 'small_two_inch'

export interface IdPhotoSpec {
  specId: IdPhotoSpecId
  label: string
  widthMm: number
  heightMm: number
  /** 300dpi 裁剪产物必须精确等于的像素尺寸（服务端硬校验锚点） */
  widthPx: number
  heightPx: number
}

export const ID_PHOTO_SPECS: readonly IdPhotoSpec[] = [
  { specId: 'one_inch', label: '一寸', widthMm: 25, heightMm: 35, widthPx: 295, heightPx: 413 },
  { specId: 'small_one_inch', label: '小一寸', widthMm: 22, heightMm: 32, widthPx: 260, heightPx: 378 },
  { specId: 'two_inch', label: '二寸', widthMm: 35, heightMm: 49, widthPx: 413, heightPx: 579 },
  { specId: 'small_two_inch', label: '小二寸', widthMm: 35, heightMm: 45, widthPx: 413, heightPx: 531 },
]

export function getIdPhotoSpec(specId: string): IdPhotoSpec | undefined {
  return ID_PHOTO_SPECS.find((s) => s.specId === specId)
}

export interface IdPhotoLayoutSource {
  fileId: string
  /** 上传确认后返回的内部 HMAC 签名 URL，作为访问凭证；服务端不用它读取，只校验持有权。 */
  fileAccessUrl: string
}

export interface IdPhotoLayoutRequest {
  source: IdPhotoLayoutSource
  specId: IdPhotoSpecId
  terminalId: string
}

export interface IdPhotoLayoutResponse {
  fileId: string
  /** 内部 HMAC 打印链路 URL（30 分钟 TTL），不是 COS 预签名 URL。 */
  printFileUrl: string
  fileMd5: string
  sizeBytes: number
  pages: number
  specId: IdPhotoSpecId
  /** 每版张数（整版排满） */
  layoutCount: number
  /** 仅游客返回：源文件（裁剪产物）的删除 action token，与读取 URL 不可互换。 */
  sourceDeleteToken?: string
}
