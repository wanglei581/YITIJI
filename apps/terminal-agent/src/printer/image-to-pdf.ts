import fs from 'fs'
import path from 'path'
import os from 'os'
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
 *   Windows：%ProgramData%\AIJobPrintAgent\temp\print_<uuid>.pdf
 *   macOS/Linux（开发/测试）：<tmpdir>/AIJobPrintAgent/temp/print_<uuid>.pdf
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
export function imageToPdf(imagePath: string, scale: 'fit' | 'actual' = 'fit'): Promise<string> {
  const ext = path.extname(imagePath).toLowerCase()

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

  // crypto.randomUUID() 在 Node.js 15+ 中原生可用（本项目要求 >=18）
  const uuid = crypto.randomUUID()
  const tempPdfPath = path.join(tempDir, `print_${uuid}.pdf`)

  return new Promise<string>((resolve, reject) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const PDFDocument = require('pdfkit') as typeof import('pdfkit')

    const doc = new PDFDocument({ autoFirstPage: false, margin: 0 })
    const stream = fs.createWriteStream(tempPdfPath)

    doc.pipe(stream)

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

/**
 * 清理临时目录中超过 1 小时的残留 PDF 文件。
 * 在 Agent 启动时调用，兜底清理意外残留。
 */
export function cleanupStaleTempPdfs(): void {
  const tempDir = getTempDir()
  if (!fs.existsSync(tempDir)) return

  const oneHourAgo = Date.now() - 60 * 60 * 1000
  try {
    const files = fs.readdirSync(tempDir)
    for (const file of files) {
      if (!file.startsWith('print_') || !file.endsWith('.pdf')) continue
      const filePath = path.join(tempDir, file)
      const stat = fs.statSync(filePath)
      if (stat.mtimeMs < oneHourAgo) {
        fs.unlinkSync(filePath)
        log(`cleanupStaleTempPdfs: 已清理过期残留文件 ${file}`)
      }
    }
  } catch (e) {
    warn(
      `cleanupStaleTempPdfs: 清理失败（忽略）— ${e instanceof Error ? e.message : String(e)}`,
    )
  }
}
