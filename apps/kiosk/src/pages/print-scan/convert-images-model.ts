// 图片转 PDF 页的状态派生与文案。业务请求仍在 ConvertImagesPage。
// 列表数组顺序 = 用户看到的顺序 = POST sources 顺序 = PDF 页序。

import type { ConvertImagesResponse } from '@ai-job-print/shared'
import { errorCodeOf } from '../../services/api/userErrorMessage'

export const MAX_IMAGES = 20
export const MAX_SINGLE_IMAGE_BYTES = 10 * 1024 * 1024
export const MAX_TOTAL_INPUT_BYTES = 40 * 1024 * 1024
export const MAX_OUTPUT_BYTES = 15 * 1024 * 1024
export const MAX_SINGLE_PIXELS = 25_000_000
/** 一批合计像素上限，和稿上「2 亿像素」是同一个数。 */
export const MAX_TOTAL_PIXELS = 200_000_000

export interface SelectedImage {
  source: 'qr' | 'local'
  fileId: string
  fileAccessUrl: string
  name: string
  size: string
  sizeBytes: number
  expiresAt?: string
  /** 读得到才有。读不到不写，不拿文件名猜。 */
  format?: string
  width?: number
  height?: number
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

/** 声明类型或文件名能对上 JPG / PNG 才返回。对不上就空着。 */
export function imageFormatLabel(mime: string | undefined, name: string): string | undefined {
  const raw = (mime ?? '').trim().toLowerCase()
  if (raw === 'image/jpeg' || raw === 'image/jpg' || raw === 'jpg' || raw === 'jpeg') return 'JPG'
  if (raw === 'image/png' || raw === 'png') return 'PNG'
  const ext = name.split('.').pop()?.toLowerCase()
  if (ext === 'jpg' || ext === 'jpeg') return 'JPG'
  if (ext === 'png') return 'PNG'
  return undefined
}

function sniffImageMime(bytes: Uint8Array): 'image/jpeg' | 'image/png' | undefined {
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png'
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg'
  return undefined
}

async function bitmapSize(blob: Blob): Promise<{ width: number; height: number } | null> {
  try {
    const bitmap = await createImageBitmap(blob)
    const size = { width: bitmap.width, height: bitmap.height }
    bitmap.close()
    if (!size.width || !size.height) return null
    return size
  } catch {
    return null
  }
}

/**
 * 从本机文件读格式和像素。格式以文件头为准，和声明的类型不一致时用文件头。
 * 解不开、认不出就不填，调用方不许补一个假尺寸。
 */
export async function readImageFacts(file: Blob): Promise<{ width?: number; height?: number; format?: string }> {
  let sniffed: 'image/jpeg' | 'image/png' | undefined
  try {
    sniffed = sniffImageMime(new Uint8Array(await file.slice(0, 16).arrayBuffer()))
  } catch {
    sniffed = undefined
  }
  const format = sniffed ? imageFormatLabel(sniffed, '') : undefined
  const declared = file.type
  let size = await bitmapSize(sniffed && sniffed !== declared ? new Blob([await file.arrayBuffer()], { type: sniffed }) : file)
  if (!size && sniffed && sniffed !== declared) size = await bitmapSize(file)
  if (!size) return { format }
  return { width: size.width, height: size.height, format }
}

/** 万像素，四舍五入。和稿上 `Math.round(w*h/10000)` 同一算法。 */
export function wanPixelsOf(width: number, height: number): number {
  return Math.round((width * height) / 10_000)
}

/** 每一张都读到宽高才合计；少一张就整项不写。 */
export function totalWanPixels(images: SelectedImage[]): number | null {
  if (images.length === 0 || images.some((img) => !img.width || !img.height)) return null
  const sum = images.reduce((acc, img) => acc + wanPixelsOf(img.width!, img.height!), 0)
  return Math.round(sum)
}

export function imageMetaLine(img: SelectedImage): string {
  const parts = [img.size]
  if (img.format) parts.push(img.format)
  if (img.width && img.height) parts.push(`${img.width}×${img.height}`)
  if (!img.format && !(img.width && img.height)) {
    parts.push(img.source === 'qr' ? '手机扫码上传' : '本机上传')
  }
  return parts.join(' · ')
}

export function listCountsLabel(images: SelectedImage[]): string {
  const total = totalBytesOf(images)
  const size = total >= 1024 * 1024 ? `${(total / (1024 * 1024)).toFixed(1)} MB` : formatBytes(total)
  const px = totalWanPixels(images)
  const pxPart = px === null ? '' : ` · ${px} 万 / 2 亿像素`
  return `${images.length} / ${MAX_IMAGES} 张 · 合计 ${size} / 40 MB${pxPart}`
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
  hasEndUser?: boolean,
): { tone: 'ok' | 'warn' | 'bad' | 'unknown'; label: string } {
  if (phase === 'converting' || phase === 'rechecking' || phase === 'uploading') {
    const label =
      phase === 'uploading'
        ? '正在上传 · 结果未确认'
        : phase === 'rechecking'
          ? '正在再查刚才那一次'
          : '正在合成 · 无进度回传'
    return { tone: 'unknown', label }
  }
  if (phase === 'usb') return { tone: 'warn', label: 'U 盘里的图还不能直接加进来' }
  if (phase === 'completed') {
    if (recovered) return { tone: 'ok', label: '已恢复 · 没有生成第二份' }
    if (hasEndUser === true) return { tone: 'ok', label: 'PDF 已生成 · 已进我的文档' }
    if (hasEndUser === false) return { tone: 'warn', label: '已生成 · 未登录不留存' }
    return { tone: 'ok', label: 'PDF 已生成' }
  }
  if (phase === 'conflict' || error?.kind === 'conflict') {
    return { tone: 'bad', label: '顺序和刚才那一次对不上' }
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
    if (error.kind === 'in-progress') return { tone: 'warn', label: '上一次的合成还在跑' }
    if (error.kind === 'result-unknown') return { tone: 'warn', label: '结果未知 · 先查刚才那一次' }
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
  hasEndUser?: boolean,
): { ask: string; doing: string } {
  // ask / doing 里的 em、b 是固定稿面标记，只由本函数写出，视图按这两个标签拆，不跑用户内容。
  if (phase === 'usb') {
    return {
      ask: 'U 盘来源<em>还没接进来</em>。',
      doing: '入口和边界都写清楚了，但 U 盘里的图片现在还回不到这个列表。<b>这里不伪造可用。</b>',
    }
  }
  if (phase === 'uploading') {
    return {
      ask: '正在<em>传这一张</em>。',
      doing: '一次一张，没有进度百分比可显示。<b>传成功它才进列表。</b>',
    }
  }
  if (phase === 'converting') {
    return {
      ask: '正在<em>合成</em>。',
      doing: '已经交给系统，没有进度回传。<b>结果出来之前我不说做完了。</b>',
    }
  }
  if (phase === 'rechecking') {
    return {
      ask: '正在<em>再查一次</em>。',
      doing: '查的是刚才那一次，没有重新提交。<b>这一屏不会自己变成完成。</b>',
    }
  }
  if (phase === 'completed') {
    const pages = `${imageCount} 张图 ${imageCount} 页，页序和你排的一样`
    if (hasEndUser === true) {
      return { ask: '<em>合好了</em>。', doing: `${pages}，已经进「我的文档」。` }
    }
    if (hasEndUser === false) {
      return { ask: '<em>合好了</em>。', doing: `${pages}。没登录，这份不会进「我的文档」。` }
    }
    return { ask: '<em>合好了</em>。', doing: `${pages}。` }
  }
  if (phase === 'conflict') {
    return {
      ask: '这一批<em>对不上</em>。',
      doing: '顺序变了，就不是刚才那一批了。<b>我停在这里，等你决定。</b>',
    }
  }
  if (error?.kind === 'format') {
    return { ask: '这张<em>加不进来</em>。', doing: '只收 JPG / PNG。<b>它没进列表，顺序没被打乱。</b>' }
  }
  if (error?.kind === 'too-large') {
    return { ask: '这张<em>太大了</em>。', doing: '单张 10 MB 以内。<b>它没进列表，顺序没被打乱。</b>' }
  }
  if (error?.kind === 'upload-failed') {
    return { ask: '这张<em>没传上去</em>。', doing: '没拿到已经确认。<b>它没进列表，已有的还在。</b>' }
  }
  if (error?.kind === 'in-progress') {
    return { ask: '上一次<em>还在跑</em>。', doing: '刚才那一次已经在合成了。<b>不重新提交，过一会儿再查它。</b>' }
  }
  if (error?.kind === 'result-unknown') {
    return { ask: '结果<em>还不知道</em>。', doing: '上一次的结果还没确认，<b>先别重复生成。</b>' }
  }
  if (error?.kind === 'known-failed') {
    return {
      ask: '这次<em>明确失败</em>。',
      doing: '图片和顺序都还在，不用重传。<b>直接原样重试就行。</b>',
    }
  }
  if (imageCount >= MAX_IMAGES) {
    return { ask: '已经<em>20 张了</em>。', doing: '到上限了。想换一张，先选中列表里的某一张再移除。' }
  }
  if (imageCount > 0) {
    return {
      ask: '顺序<em>你自己排</em>。',
      doing: '选中一张就能上移下移；<b>列表顺序就是 PDF 页序。</b>',
    }
  }
  return {
    ask: '几张图，<em>拼成一份 PDF</em>。',
    doing: '只收 JPG / PNG，单张不超过 10 MB，一次最多 20 张。<b>先加第一张。</b>',
  }
}

export function outputFileName(count: number): string {
  return `格式转换-${count}张图片.pdf`
}
