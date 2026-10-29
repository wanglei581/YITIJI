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
          ? '正在用同一标记再查'
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
    return { tone: 'bad', label: '同一标记、不同输入 · 冲突' }
  }
  if (error) {
    if (error.kind === 'format') return { tone: 'warn', label: '有图片未能加入 · 格式' }
    if (error.kind === 'too-large') return { tone: 'warn', label: '有图片未能加入 · 大小' }
    if (error.kind === 'upload-failed') return { tone: 'bad', label: '有图片没传上去' }
    if (error.kind === 'source-unavailable') return { tone: 'bad', label: '系统取不到其中一张' }
    if (error.kind === 'source-expired') return { tone: 'warn', label: '有图片的访问链接过期' }
    if (error.kind === 'total-too-large') return { tone: 'warn', label: '这一批合计超过 40 MB' }
    if (error.kind === 'dimensions') return { tone: 'bad', label: '有图片像素超出上限' }
    if (error.kind === 'output-too-large') return { tone: 'warn', label: '合成结果超过 15 MB' }
    if (error.kind === 'in-progress') return { tone: 'warn', label: '同一标记的生成还在进行' }
    if (error.kind === 'result-unknown') return { tone: 'warn', label: '结果未知 · 需同一标记查询' }
    if (error.kind === 'known-failed') return { tone: 'bad', label: '明确失败 · 可原样重试' }
    return { tone: 'bad', label: '转换暂未完成' }
  }
  if (imageCount >= MAX_IMAGES) return { tone: 'warn', label: '已达 20 张上限' }
  if (selected !== null) return { tone: 'unknown', label: `已选中第 ${selected + 1} 张` }
  if (imageCount > 0) return { tone: 'unknown', label: `${imageCount} / 20 张 · 可合成` }
  return { tone: 'unknown', label: '图片转 PDF · 最多 20 张' }
}

/**
 * 意图带的标题与副标题，逐态照稿 18「照片合成 PDF」。
 * 空态的标题仍是「图片转 PDF」：路由就绪锚点（h1）和路由巡检都按这个名字找这一页。
 */
export function convertBandCopy(
  phase: ConvertPhase,
  images: SelectedImage[],
  error: ConvertError | null,
): { title: string; sub: string } {
  if (error?.kind === 'capability') return { title: '图片转 PDF：本机暂未开通', sub: '这项现在不能合成' }
  if (phase === 'usb') return { title: 'U 盘图片还没接到这里', sub: '这一页现在只接了手机扫码' }
  if (phase === 'uploading') return { title: '正在接收这一张', sub: '取消就停下这一张' }
  if (phase === 'converting') return { title: '正在合成', sub: '合成好了，这一页才会换成结果' }
  if (phase === 'rechecking') return { title: '正在用同一标记查询', sub: '不另起一次合成' }
  if (phase === 'completed') return { title: 'PDF 已经合成', sub: '页数等于这次的张数' }
  if (phase === 'conflict') return { title: '这个标记和上一次撞了', sub: '可以换一个新标识，或恢复上一次的顺序' }
  if (error?.kind === 'result-unknown' || error?.kind === 'in-progress') {
    return { title: '这一次的结果没有确认', sub: '用同一个标记再查，不重新合成' }
  }
  if (phase === 'empty') return { title: '图片转 PDF', sub: '还没有图片。加上之后才能合成' }
  return {
    title: '排好顺序再合成',
    sub: `已有 ${images.length} 张 · 合计 ${formatBytes(totalBytesOf(images))} · 最多 ${MAX_IMAGES} 张`,
  }
}

export function outputFileName(count: number): string {
  return `格式转换-${count}张图片.pdf`
}
