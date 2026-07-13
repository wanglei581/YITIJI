/**
 * 签名盖章契约本地副本。
 * **契约源**：packages/shared/src/types/printSign.ts（原因与双改规则见
 * print-conversion.types.ts 顶部注释）。
 */

export type SignStampPosition =
  | 'top-left' | 'top-center' | 'top-right'
  | 'middle-left' | 'center' | 'middle-right'
  | 'bottom-left' | 'bottom-center' | 'bottom-right'

export const SIGN_STAMP_POSITIONS: readonly SignStampPosition[] = [
  'top-left', 'top-center', 'top-right',
  'middle-left', 'center', 'middle-right',
  'bottom-left', 'bottom-center', 'bottom-right',
]

export type SignStampSize = 'small' | 'medium' | 'large'
export const SIGN_STAMP_SIZES: readonly SignStampSize[] = ['small', 'medium', 'large']

export interface SignStampSource {
  fileId: string
  fileAccessUrl: string
}

export interface SignStampPlacement {
  page: number
  position: SignStampPosition
  size: SignStampSize
}

export interface SignInspectResponse {
  pages: number
}

export interface SignComposeResponse {
  fileId: string
  printFileUrl: string
  fileMd5: string
  sizeBytes: number
  pages: number
}
