// 图片转 PDF 页的状态派生与文案。业务请求仍在 ConvertImagesPage。
// 列表数组顺序 = 用户看到的顺序 = POST sources 顺序 = PDF 页序。

import type { ConvertImagesResponse } from '@ai-job-print/shared'
import { errorCodeOf } from '../../services/api/userErrorMessage'

export const MAX_IMAGES = 20
export const MAX_SINGLE_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_TOTAL_INPUT_BYTES = 40 * 1024 * 1024
export const MAX_OUTPUT_BYTES = 15 * 1024 * 1024
export const MAX_SINGLE_PIXELS = 25_000_000

export interface SelectedImage {
  source: 'qr' | 'local'
  fileId: string
  fileAccessUrl: string
  name: string
  size: string
  sizeBytes: number
  expiresAt?: string
}

export interface ConvertIdempotency {
  key: string
  fingerprint: string
}

export interface RejectedFile {
  name: string
  detail: string
}

export type ConvertPhase =
  | 'empty'
  | 'usb'
  | 'uploading'
  | 'edit'
  | 'converting'
  | 'rechecking'
  | 'completed'
  | 'conflict'

export type ConvertErrorKind =
  | 'format'
  | 'too-large'
  | 'upload-failed'
  | 'source-unavailable'
  | 'source-expired'
  | 'total-too-large'
  | 'dimensions'
  | 'output-too-large'
  | 'known-failed'
  | 'in-progress'
  | 'result-unknown'
  | 'capability'
  | 'conflict'
  | 'generic'

export interface ConvertError {
  kind: ConvertErrorKind
  message: string
  rejected?: RejectedFile
}

export interface ConvertPreview {
  kind: 'input' | 'output'
  index: number
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function fingerprintOf(images: SelectedImage[]): string {
  return images.map((img) => img.fileId).join('|')
}

export function mintIdempotencyKey(): string {
  return `convert-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

/** 同一有序输入复用同一个请求标识；顺序一变就换新标识。 */
export function keyForImages(
  images: SelectedImage[],
  current: ConvertIdempotency | null,
): ConvertIdempotency {
  const fingerprint = fingerprintOf(images)
  if (current && current.fingerprint === fingerprint) return current
  return { key: mintIdempotencyKey(), fingerprint }
}

export function totalBytesOf(images: SelectedImage[]): number {
  return images.reduce((sum, img) => sum + (Number.isFinite(img.sizeBytes) ? img.sizeBytes : 0), 0)
}

export function parseSizeBytes(label: string): number {
  const match = /^([\d.]+)\s*(B|KB|MB)$/i.exec(label.trim())
  if (!match) return 0
  const value = Number(match[1])
  const unit = match[2]!.toUpperCase()
  if (unit === 'MB') return Math.round(value * 1024 * 1024)
  if (unit === 'KB') return Math.round(value * 1024)
  return Math.round(value)
}

export function isExpired(expiresAt: string | undefined, now = Date.now()): boolean {
  if (!expiresAt) return false
  const ts = Date.parse(expiresAt)
  return Number.isFinite(ts) && ts <= now
}

export function classifyConvertError(
  error: unknown,
  images: SelectedImage[],
  fallback: string,
  sent: boolean,
): ConvertError {
  const code = errorCodeOf(error) ?? ''
  const expiredHit = images.some((img) => isExpired(img.expiresAt))
  if (code === 'IDEMPOTENCY_KEY_REUSED') {
    return { kind: 'conflict', message: fallback }
  }
  if (code === 'CONVERSION_IN_PROGRESS') {
    return { kind: 'in-progress', message: '上一次生成仍在进行中，请稍候重试' }
  }
  if (code === 'CONVERT_SOURCE_NOT_FOUND' && expiredHit) {
    return { kind: 'source-expired', message: '部分图片不存在或已失效' }
  }
  if (code === 'CONVERT_SOURCE_NOT_FOUND') {
    return { kind: 'source-unavailable', message: '部分图片不存在或已失效' }
  }
  if (code === 'CONVERT_TOTAL_LIMIT_EXCEEDED') {
    return { kind: 'total-too-large', message: fallback }
  }
  if (code === 'CONVERT_IMAGE_DIMENSIONS_INVALID') {
    return { kind: 'dimensions', message: fallback }
  }
  if (code === 'CONVERT_OUTPUT_TOO_LARGE') {
    return { kind: 'output-too-large', message: fallback }
  }
  if (code === 'CONVERT_SOURCE_TYPE_UNSUPPORTED') {
    return { kind: 'format', message: fallback }
  }
  if (code === 'CONVERT_SOURCE_TOO_LARGE') {
    return { kind: 'too-large', message: fallback }
  }
  if (code === 'CONVERT_FAILED') {
    return { kind: 'known-failed', message: fallback }
  }
  if (code === 'CAPABILITY_UNAVAILABLE' || code === 'CAPABILITY_NOT_CONFIGURED') {
    return { kind: 'capability', message: fallback }
  }
  if (sent && (code === 'NETWORK_ERROR' || code === '')) {
    return { kind: 'result-unknown', message: fallback }
  }
  return { kind: 'generic', message: fallback }
}

export function derivePhase(args: {
  usbOpen: boolean
  uploading: boolean
  generating: boolean
  rechecking: boolean
  result: ConvertImagesResponse | null
  error: ConvertError | null
  imageCount: number
}): ConvertPhase {
  if (args.usbOpen) return 'usb'
  if (args.result && !args.generating && !args.rechecking) return 'completed'
  if (args.generating) return 'converting'
  if (args.rechecking) return 'rechecking'
  if (args.error?.kind === 'conflict') return 'conflict'
  if (args.uploading) return 'uploading'
  if (args.imageCount === 0) return 'empty'
  return 'edit'
}

export function statusForPhase(
  phase: ConvertPhase,
  imageCount: number,
  error: ConvertError | null,
  selected: number | null,
  recovered: boolean,
): { tone: 'ok' | 'warn' | 'bad' | 'unknown'; label: string } {
  if (phase === 'converting' || phase === 'rechecking' || phase === 'uploading') {
    const label =
      phase === 'uploading'
        ? '正在上传 · 结果未确认'
        : phase === 'rechecking'
          ? '正在用同一标识再查'
          : '正在合成 · 无进度回传'
    return { tone: 'unknown', label }
  }
  if (phase === 'usb') return { tone: 'warn', label: 'U 盘来源 · 待接线' }
  if (phase === 'completed') {
    return recovered
      ? { tone: 'ok', label: '已恢复 · 没有生成第二份' }
      : { tone: 'ok', label: 'PDF 已生成' }
  }
  if (phase === 'conflict' || error?.kind === 'conflict') {
    return { tone: 'bad', label: '同标识、不同输入 · 冲突' }
  }
  if (error) {
    if (error.kind === 'format') return { tone: 'warn', label: '有图片未能加入 · 格式' }
    if (error.kind === 'too-large') return { tone: 'warn', label: '有图片未能加入 · 大小' }
    if (error.kind === 'upload-failed') return { tone: 'bad', label: '有图片没传上去' }
    if (error.kind === 'source-unavailable') return { tone: 'bad', label: '服务端取不到其中一张' }
    if (error.kind === 'source-expired') return { tone: 'warn', label: '有图片的访问链接过期' }
    if (error.kind === 'total-too-large') return { tone: 'warn', label: '这一批合计超过 40 MB' }
    if (error.kind === 'dimensions') return { tone: 'bad', label: '有图片像素超出上限' }
    if (error.kind === 'output-too-large') return { tone: 'warn', label: '合成结果超过 15 MB' }
    if (error.kind === 'in-progress') return { tone: 'warn', label: '同标识的生成还在跑' }
    if (error.kind === 'result-unknown') return { tone: 'warn', label: '结果未知 · 需同标识查询' }
    if (error.kind === 'known-failed') return { tone: 'bad', label: '明确失败 · 可原样重试' }
    return { tone: 'bad', label: '转换暂未完成' }
  }
  if (imageCount >= MAX_IMAGES) return { tone: 'warn', label: '已达 20 张上限' }
  if (selected !== null) return { tone: 'unknown', label: `已选中第 ${selected + 1} 张` }
  if (imageCount > 0) return { tone: 'unknown', label: `${imageCount} / 20 张 · 可合成` }
  return { tone: 'unknown', label: '图片转 PDF · 最多 20 张' }
}

export function advisorCopy(
  phase: ConvertPhase,
  imageCount: number,
  error: ConvertError | null,
): { ask: string; doing: string } {
  if (phase === 'usb') {
    return { ask: 'U 盘来源还没接进来。', doing: '入口和边界都写清楚了，但 U 盘里的图片现在还回不到这个列表。这里不伪造可用。' }
  }
  if (phase === 'uploading') {
    return { ask: '正在传这一张。', doing: '一次一张，没有进度百分比可显示。传成功它才进列表。' }
  }
  if (phase === 'converting') {
    return { ask: '正在合成。', doing: '一次性请求，没有进度回传。结果出来之前我不说做完了。' }
  }
  if (phase === 'rechecking') {
    return { ask: '正在再查一次。', doing: '同一个请求标识，没有新建请求。这一屏不会自己变成完成。' }
  }
  if (phase === 'completed') {
    return { ask: '合好了。', doing: `${imageCount} 张图 ${imageCount} 页，页序和你排的一样。` }
  }
  if (phase === 'conflict') {
    return { ask: '这个标识对不上。', doing: '同一个标识，顺序变了就是另一批输入。我停在这里，等你决定。' }
  }
  if (error?.kind === 'format') {
    return { ask: '这张加不进来。', doing: '只收 JPG / PNG。它没进列表，顺序没被打乱。' }
  }
  if (error?.kind === 'too-large') {
    return { ask: '这张太大了。', doing: '单张 10 MB 以内。它没进列表，顺序没被打乱。' }
  }
  if (error?.kind === 'upload-failed') {
    return { ask: '这张没传上去。', doing: '没拿到服务端确认。它没进列表，已有的还在。' }
  }
  if (error?.kind === 'in-progress') {
    return { ask: '上一次还在跑。', doing: '同一个标识下已经有一次在合成。不新建请求，拿同一个标识再查。' }
  }
  if (error?.kind === 'result-unknown') {
    return { ask: '结果不知道。', doing: '回执没送到。不能直接再发一次，得拿同一个标识去查。' }
  }
  if (error?.kind === 'known-failed') {
    return { ask: '这次明确失败。', doing: '图片和顺序都还在，不用重传。用同一个标识原样重试。' }
  }
  if (imageCount >= MAX_IMAGES) {
    return { ask: '已经 20 张了。', doing: '到上限了。想换一张，先选中列表里的某一张再移除。' }
  }
  if (imageCount > 0) {
    return { ask: '顺序你自己排。', doing: '选中一张就能上移下移；列表顺序就是 PDF 页序。' }
  }
  return { ask: '几张图，拼成一份 PDF。', doing: '只收 JPG / PNG，单张不超过 10 MB，一次最多 20 张。先加第一张。' }
}

export function outputFileName(count: number): string {
  return `格式转换-${count}张图片.pdf`
}
