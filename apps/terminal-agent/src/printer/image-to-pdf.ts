import fs from 'fs'
import path from 'path'
import os from 'os'
import crypto from 'crypto'
import { log, warn } from '../logger'

/**
 * image-to-pdf.ts — Phase 8.1A
 *
 * 将图片文件转换为临时 PDF，供 Method B (pdf-to-printer/SumatraPDF) 打印。
 *
 * pdfkit 原生支持：JPEG (.jpg / .jpeg) / PNG (.png)
 * BMP / TIFF：Phase 8.1A 不支持（需 sharp 预处理，Phase 8.1B+ 实现）
 *
 * 临时文件路径：
 *   Agent 任务：print_<taskId>_<uuid>.pdf（让 Windows 队列 / Event 307 可关联任务）
 *   CLI / 无任务上下文：print_<uuid>.pdf
 */

const A4_WIDTH = 595.28
const A4_HEIGHT = 841.89

/** Phase 8.1A 支持的图片类型（pdfkit 原生嵌入，无需预处理） */
const PDFKIT_NATIVE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png'])

/** PDF 用户单位是 1/72 英寸。像素 → pt 需要图片自己声明的 DPI。 */
const PDF_POINTS_PER_INCH = 72

/**
 * 图片声明的物理分辨率（DPI）。读不出来时返回 null。
 *
 * pdfkit 不读任何 DPI 元数据：doc.image() 不带宽高时按 1px = 1pt 摆放，
 * 等同于假设 72dpi。一张 300dpi 的证件照因此会被放大 4.17 倍。
 * 要实现「实际大小」就必须自己解析：
 *   PNG  → pHYs 块（每米像素数，unit=1 表示米）
 *   JPEG → JFIF APP0 段（density unit 1=每英寸, 2=每厘米）
 */
function readImageDpi(buffer: Buffer, ext: string): number | null {
  try {
    if (ext === '.png') return readPngDpi(buffer)
    return readJpegDpi(buffer)
  } catch {
    return null
  }
}

function readPngDpi(buffer: Buffer): number | null {
  // 8 字节签名后是连续的 chunk：[4B 长度][4B 类型][数据][4B CRC]
  let offset = 8
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset)
    const type = buffer.toString('ascii', offset + 4, offset + 8)
    if (type === 'pHYs') {
      const ppuX = buffer.readUInt32BE(offset + 8)
      const unit = buffer[offset + 16]
      // unit === 1 → 每米像素数；0 表示只有宽高比，无物理含义
      if (unit !== 1 || ppuX <= 0) return null
      return (ppuX * 0.0254)
    }
    if (type === 'IDAT' || type === 'IEND') return null
    offset += 12 + length
  }
  return null
}

function readJpegDpi(buffer: Buffer): number | null {
  if (buffer.readUInt16BE(0) !== 0xffd8) return null
  let offset = 2
  while (offset + 4 <= buffer.length) {
    if (buffer[offset] !== 0xff) return null
    const marker = buffer[offset + 1]
    const segmentLength = buffer.readUInt16BE(offset + 2)
    // APP0 且标识为 "JFIF\0" 时，第 8 字节是密度单位，其后是 X/Y 密度
    if (marker === 0xe0 && buffer.toString('ascii', offset + 4, offset + 8) === 'JFIF') {
      const unit = buffer[offset + 11]
      const densityX = buffer.readUInt16BE(offset + 12)
      if (densityX <= 0) return null
      if (unit === 1) return densityX           // 每英寸
      if (unit === 2) return densityX * 2.54    // 每厘米 → 每英寸
      return null                                // unit 0：只有宽高比
    }
    if (marker === 0xda) return null // 进入扫描数据，后面没有元数据了
    offset += 2 + segmentLength
  }
  return null
}

/** 图片像素尺寸。读不出来返回 null。 */
function readImageSize(buffer: Buffer, ext: string): { width: number; height: number } | null {
  try {
    if (ext === '.png') {
      // IHDR 数据紧跟在 8B 签名 + 4B 长度 + 4B 类型之后
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
    }
    let offset = 2
    while (offset + 9 <= buffer.length) {
      if (buffer[offset] !== 0xff) return null
      const marker = buffer[offset + 1]
      const segmentLength = buffer.readUInt16BE(offset + 2)
      // SOF0..SOF15（排除 DHT/JPG/DAC 这几个非帧头标记）
      const isFrameHeader =
        marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
      if (isFrameHeader) {
        return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) }
      }
      if (marker === 0xda) return null
      offset += 2 + segmentLength
    }
    return null
  } catch {
    return null
  }
}

/**
 * 计算「实际大小」下图片应占的 pt 尺寸。
 * 返回 null 表示无法确定物理尺寸（无 DPI 元数据 / 超出 A4），调用方退回 'fit'。
 */
function resolveActualSize(imagePath: string, ext: string): { width: number; height: number } | null {
  const buffer = fs.readFileSync(imagePath)
  const size = readImageSize(buffer, ext)
  const dpi = readImageDpi(buffer, ext)

  if (!size || !dpi || !Number.isFinite(dpi) || dpi <= 0) {
    warn(
      `imageToPdf: scale=actual 但图片未声明可用的 DPI 元数据（${path.basename(imagePath)}），` +
        `无法确定物理尺寸，本次按 fit 铺满 A4 处理。`,
    )
    return null
  }

  const width = (size.width / dpi) * PDF_POINTS_PER_INCH
  const height = (size.height / dpi) * PDF_POINTS_PER_INCH

  if (width > A4_WIDTH || height > A4_HEIGHT) {
    warn(
      `imageToPdf: scale=actual 的物理尺寸 ${width.toFixed(1)}x${height.toFixed(1)}pt ` +
        `超出 A4（${A4_WIDTH}x${A4_HEIGHT}pt），本次按 fit 缩放处理。`,
    )
    return null
  }

  log(
    `imageToPdf: scale=actual → ${size.width}x${size.height}px @${dpi.toFixed(0)}dpi ` +
      `= ${width.toFixed(1)}x${height.toFixed(1)}pt，居中不放大`,
  )
  return { width, height }
}

/**
 * 返回临时文件目录路径（Windows 使用 %ProgramData%，其他平台降级到 os.tmpdir()）。
 */
function getTempDir(): string {
  const base = process.env['PROGRAMDATA']
    ? path.join(process.env['PROGRAMDATA'], 'AIJobPrintAgent', 'temp')
    : path.join(os.tmpdir(), 'AIJobPrintAgent', 'temp')
  return base
}

/**
 * 确保临时目录存在。
 */
function ensureTempDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

export interface ImageToPdfOptions {
  scale?: 'fit' | 'actual'
  correlationId?: string
}

/**
 * 新增一页 A4，把一张图放上去。imageToPdf（单张）与 imagesToPdf（多张）共用，
 * 单张时的 pdfkit 调用顺序与抽取前完全相同：addPage → 按需解析实际尺寸 → image。
 */
function drawImagePage(
  doc: PDFKit.PDFDocument,
  imagePath: string,
  ext: string,
  scale: 'fit' | 'actual',
): void {
  doc.addPage({ size: 'A4', margin: 0 })

  const actualSize = scale === 'actual' ? resolveActualSize(imagePath, ext) : null

  if (actualSize) {
    // 「实际大小」：按图片声明的 DPI 还原物理尺寸，居中，不放大。
    doc.image(imagePath, (A4_WIDTH - actualSize.width) / 2, (A4_HEIGHT - actualSize.height) / 2, {
      width: actualSize.width,
      height: actualSize.height,
    })
  } else {
    // 'fit' 默认路径：与历史行为完全一致，不做任何改动。
    doc.image(imagePath, 0, 0, {
      width: A4_WIDTH,
      height: A4_HEIGHT,
      fit: [A4_WIDTH, A4_HEIGHT],
      align: 'center',
      valign: 'center',
    })
  }
}

/** Build a Windows-safe spooler document name while retaining the business task id. */
export function buildImageTempPdfFileName(
  correlationId?: string,
  uuid = crypto.randomUUID(),
): string {
  const safeCorrelationId = correlationId?.replace(/[^a-zA-Z0-9_-]/g, '') ?? ''
  return safeCorrelationId
    ? `print_${safeCorrelationId}_${uuid}.pdf`
    : `print_${uuid}.pdf`
}

/**
 * 将图片文件转换为临时 PDF（A4 幅面），返回临时 PDF 路径。
 *
 * 支持：.jpg / .jpeg / .png（pdfkit 原生）
 * 不支持：.bmp / .tiff（Phase 8.1B+ 实现，需 sharp 预处理）
 *
 * scale 语义（与 PrintJobParams.scale 一致）：
 *   'fit'（默认）  → 等比缩放铺满 A4。历史行为，逐字节保持不变。
 *   'actual'      → 按图片自己声明的 DPI 还原物理尺寸，居中摆放，不放大。
 *                   读不出 DPI 时无法确定物理尺寸，退回 'fit' 并 warn ——
 *                   不假装知道用户想要多大。
 *
 * 为什么必须在这里处理：SumatraPDF 的 noscale 作用于「已经生成好的 PDF 页」。
 * 图片一旦被铺满 A4 烘进 PDF，noscale 就只是 100% 打印那张已经被放大的页，
 * 用户在打印参数页选的「实际大小」对图片完全无效。
 *
 * @throws Error 若图片格式不受支持或 pdfkit 生成失败
 */
export function imageToPdf(imagePath: string, options: ImageToPdfOptions = {}): Promise<string> {
  const ext = path.extname(imagePath).toLowerCase()
  const scale = options.scale ?? 'fit'

  if (!PDFKIT_NATIVE_EXTENSIONS.has(ext)) {
    return Promise.reject(
      new Error(
        `imageToPdf: ${ext} 格式在 Phase 8.1A 中不受支持。` +
          `.bmp / .tiff 需要 sharp 预处理（Phase 8.1B+ 实现）。` +
          `当前支持：${[...PDFKIT_NATIVE_EXTENSIONS].join(', ')}`,
      ),
    )
  }

  const tempDir = getTempDir()
  ensureTempDir(tempDir)

  const tempPdfPath = path.join(tempDir, buildImageTempPdfFileName(options.correlationId))

  return new Promise<string>((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const PDFDocument = require('pdfkit') as typeof import('pdfkit')

    const doc = new PDFDocument({ autoFirstPage: false, margin: 0 })
    const stream = fs.createWriteStream(tempPdfPath)

    doc.pipe(stream)

    drawImagePage(doc, imagePath, ext, scale)

    doc.end()

    stream.on('finish', () => {
      log(`imageToPdf: 生成临时 PDF ${tempPdfPath}`)
      resolve(tempPdfPath)
    })

    stream.on('error', (e: Error) => {
      reject(new Error(`imageToPdf: 写入临时文件失败 — ${e.message}`))
    })
  })
}

// ── 多张图合成一个 PDF（屏上扫描用） ─────────────────────────────────────────

export type ImagesToPdfErrorCode =
  | 'no_images'
  | 'too_many_pages'
  | 'unsupported_type'
  | 'too_large'
  | 'write_failed'

/** imagesToPdf 的失败。code 是机器可读的原因，message 不含路径或文件名。 */
export class ImagesToPdfError extends Error {
  constructor(readonly code: ImagesToPdfErrorCode, message: string) {
    super(message)
    this.name = 'ImagesToPdfError'
  }
}

export interface ImagesToPdfOptions extends ImageToPdfOptions {
  /** 输出文件路径。不给则放进与 imageToPdf 相同的临时目录（print_<…>.pdf）。 */
  outputPath?: string
  /** 页数上限。输入张数超过就直接拒绝，不生成任何文件。 */
  maxPages?: number
  /** PDF 字节数上限。生成后超过则删掉输出并报 too_large；不会二次压缩。 */
  maxBytes?: number
}

export interface ImagesToPdfResult {
  path: string
  /** 等于输入张数：每张图恰好一页 A4。 */
  pageCount: number
  bytes: number
}

function writeImagesPdf(
  imagePaths: readonly string[],
  exts: readonly string[],
  outputPath: string,
  scale: 'fit' | 'actual',
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const PDFDocument = require('pdfkit') as typeof import('pdfkit')
    const doc = new PDFDocument({ autoFirstPage: false, margin: 0 })
    const stream = fs.createWriteStream(outputPath)
    let settled = false
    const fail = (message: string): void => {
      if (settled) return
      settled = true
      // 先关掉写流，等它真正关闭后再 reject，调用方才能放心删除半成品文件。
      doc.unpipe(stream)
      stream.once('close', () => reject(new ImagesToPdfError('write_failed', message)))
      stream.destroy()
    }

    stream.on('finish', () => {
      if (settled) return
      settled = true
      resolve()
    })
    stream.on('error', (e: Error) => fail(`写入失败 — ${e.message}`))

    try {
      doc.pipe(stream)
      imagePaths.forEach((imagePath, index) => drawImagePage(doc, imagePath, exts[index], scale))
      doc.end()
    } catch (e) {
      fail(`生成失败 — ${e instanceof Error ? e.message : String(e)}`)
    }
  })
}

/**
 * 把若干张 JPEG / PNG 合成一个 PDF：一张图一页 A4，等比适配（scale 默认 'fit'），
 * 页序同输入顺序。`imageToPdf` 的单张行为不受影响。
 *
 * 失败一律抛 ImagesToPdfError，并且不留半成品文件：
 *   no_images / too_many_pages / unsupported_type  — 生成之前就拒绝，不写任何文件
 *   too_large   — 已生成但超过 maxBytes，输出已删除；这里不做二次压缩
 *   write_failed — pdfkit 或磁盘出错，输出已尽力删除
 */
export async function imagesToPdf(
  imagePaths: readonly string[],
  options: ImagesToPdfOptions = {},
): Promise<ImagesToPdfResult> {
  const scale = options.scale ?? 'fit'
  if (imagePaths.length === 0) {
    throw new ImagesToPdfError('no_images', 'imagesToPdf: 没有输入图片')
  }
  if (options.maxPages !== undefined && imagePaths.length > options.maxPages) {
    throw new ImagesToPdfError(
      'too_many_pages',
      `imagesToPdf: ${imagePaths.length} 张超过页数上限 ${options.maxPages}`,
    )
  }
  const exts = imagePaths.map((p) => path.extname(p).toLowerCase())
  const unsupported = exts.find((ext) => !PDFKIT_NATIVE_EXTENSIONS.has(ext))
  if (unsupported !== undefined) {
    throw new ImagesToPdfError(
      'unsupported_type',
      `imagesToPdf: ${unsupported || '(无扩展名)'} 格式不受支持，当前支持：${[...PDFKIT_NATIVE_EXTENSIONS].join(', ')}`,
    )
  }

  let outputPath = options.outputPath
  if (outputPath === undefined) {
    const tempDir = getTempDir()
    ensureTempDir(tempDir)
    outputPath = path.join(tempDir, buildImageTempPdfFileName(options.correlationId))
  }

  try {
    await writeImagesPdf(imagePaths, exts, outputPath, scale)
  } catch (e) {
    cleanupTempPdf(outputPath)
    throw e
  }

  const bytes = fs.statSync(outputPath).size
  if (options.maxBytes !== undefined && bytes > options.maxBytes) {
    cleanupTempPdf(outputPath)
    throw new ImagesToPdfError(
      'too_large',
      `imagesToPdf: 合成后 ${bytes} 字节超过上限 ${options.maxBytes}，已删除，不做二次压缩`,
    )
  }
  log(`imagesToPdf: 生成 ${imagePaths.length} 页 PDF，${bytes} 字节`)
  return { path: outputPath, pageCount: imagePaths.length, bytes }
}

/**
 * 删除临时 PDF 文件。静默忽略所有错误（不抛异常）。
 */
export function cleanupTempPdf(tempPdfPath: string): void {
  try {
    if (fs.existsSync(tempPdfPath)) {
      fs.unlinkSync(tempPdfPath)
      log(`cleanupTempPdf: 已删除 ${tempPdfPath}`)
    }
  } catch (e) {
    warn(
      `cleanupTempPdf: 删除失败（忽略）${tempPdfPath} — ${e instanceof Error ? e.message : String(e)}`,
    )
  }
}

