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
 * @throws Error 若图片格式不受支持或 pdfkit 生成失败
 */
export function imageToPdf(imagePath: string): Promise<string> {
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

    // A4 页面，图片居中填充（保持宽高比）
    doc.addPage({ size: 'A4', margin: 0 })
    doc.image(imagePath, 0, 0, {
      width: A4_WIDTH,
      height: A4_HEIGHT,
      fit: [A4_WIDTH, A4_HEIGHT],
      align: 'center',
      valign: 'center',
    })

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
