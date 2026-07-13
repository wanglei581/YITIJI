/**
 * 证件照契约本地副本。
 * **契约源**：packages/shared/src/types/idPhoto.ts
 * services/api(CJS) 无法直接 import ESM-only 的 packages/shared —— 与
 * print-conversion.types.ts 同一约定。任何字段变更必须同时改两处。
 */

export type IdPhotoSpecId = 'one_inch' | 'small_one_inch' | 'two_inch' | 'small_two_inch'

export interface IdPhotoSpec {
  specId: IdPhotoSpecId
  label: string
  widthMm: number
  heightMm: number
  widthPx: number
  heightPx: number
}

export const ID_PHOTO_SPECS: readonly IdPhotoSpec[] = [
  { specId: 'one_inch', label: '一寸', widthMm: 25, heightMm: 35, widthPx: 295, heightPx: 413 },
  { specId: 'small_one_inch', label: '小一寸', widthMm: 22, heightMm: 32, widthPx: 260, heightPx: 378 },
  { specId: 'two_inch', label: '二寸', widthMm: 35, heightMm: 49, widthPx: 413, heightPx: 579 },
  { specId: 'small_two_inch', label: '小二寸', widthMm: 35, heightMm: 45, widthPx: 413, heightPx: 531 },
]

export interface IdPhotoLayoutSource {
  fileId: string
  fileAccessUrl: string
}

export interface IdPhotoLayoutResponse {
  fileId: string
  printFileUrl: string
  fileMd5: string
  sizeBytes: number
  pages: number
  specId: IdPhotoSpecId
  layoutCount: number
  sourceDeleteToken?: string
}
