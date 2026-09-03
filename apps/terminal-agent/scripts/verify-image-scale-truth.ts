// ============================================================
// 门禁：图片打印必须尊重 scale，「实际大小」不得被放大铺满 A4。
//
// 守的回归：imageToPdf 曾经硬编码 fit:[A4_WIDTH, A4_HEIGHT] 并完全忽略
// scale 参数。用户在打印参数页选「实际大小」，一张 25×35mm 的证件照
// 仍会被放大到 210×294mm 打出来 —— 选项存在但对图片完全无效。
//
// 为什么必须在生成 PDF 时处理：SumatraPDF 的 noscale 作用于「已经生成好的
// PDF 页」。图片一旦铺满 A4 烘进 PDF，noscale 只是 100% 打印那张已被放大
// 的页。打印侧那段链路是通的，断的就是这一段。
//
// 本门禁是行为门禁：真正调用 imageToPdf，把生成的 PDF 内容流里的 cm 变换
// 矩阵解出来，量图片实际占了多少 pt。不读源码字符串，不硬编码期望清单 ——
// 用例矩阵由 DPI × 像素尺寸算出应有的物理尺寸再比对。
// 全程只写临时目录，不碰打印机、不碰 Windows 打印后台。
// ============================================================

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import { imageToPdf } from '../src/printer/image-to-pdf'

const A4_WIDTH = 595.28
const A4_HEIGHT = 841.89
const PT_PER_INCH = 72

// ── 生成带 / 不带 DPI 元数据的最小 PNG ────────────────────────────────
function crc32(buf: Buffer): number {
  let c: number
  let crc = 0xffffffff
  for (let n = 0; n < buf.length; n += 1) {
    c = (crc ^ buf[n]) & 0xff
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    crc = (crc >>> 8) ^ c
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typed = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typed))
  return Buffer.concat([len, typed, crc])
}

function makePng(width: number, height: number, dpi: number | null): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 2
  const raw = Buffer.alloc(height * (1 + width * 3), 0)
  const parts = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr)]
  if (dpi !== null) {
    const ppm = Math.round(dpi / 0.0254)
    const phys = Buffer.alloc(9)
    phys.writeUInt32BE(ppm, 0)
    phys.writeUInt32BE(ppm, 4)
    phys[8] = 1
    parts.push(chunk('pHYs', phys))
  }
  parts.push(chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)))
  return Buffer.concat(parts)
}

/** 从 PDF 内容流里解出图片实际摆放尺寸（pt）。 */
function readPlacement(pdfPath: string): { width: number; height: number } | null {
  const buffer = fs.readFileSync(pdfPath)
  let index = 0
  while ((index = buffer.indexOf('\nstream', index)) !== -1) {
    let start = index + 7
    if (buffer[start] === 0x0d) start += 1
    if (buffer[start] === 0x0a) start += 1
    const end = buffer.indexOf('endstream', start)
    if (end === -1) break
    try {
      const text = zlib.inflateSync(buffer.subarray(start, end)).toString('latin1')
      const match = text.match(/([\d.-]+) 0 0 ([\d.-]+) ([\d.-]+) ([\d.-]+) cm\s*\/\w+ Do/)
      if (match) return { width: Number(match[1]), height: Math.abs(Number(match[2])) }
    } catch {
      /* 非 flate 流，跳过 */
    }
    index = end
  }
  return null
}

interface Case {
  label: string
  pixelWidth: number
  pixelHeight: number
  dpi: number | null
}

// 用例矩阵：期望值由 px/dpi*72 现算，不是抄来的常量
const CASES: Case[] = [
  { label: '一寸证件照 @300dpi', pixelWidth: 295, pixelHeight: 413, dpi: 300 },
  { label: '二寸证件照 @300dpi', pixelWidth: 413, pixelHeight: 579, dpi: 300 },
  { label: '小图 @600dpi', pixelWidth: 600, pixelHeight: 600, dpi: 600 },
  { label: '无 DPI 元数据', pixelWidth: 295, pixelHeight: 413, dpi: null },
  { label: '物理尺寸超出 A4 @72dpi', pixelWidth: 1200, pixelHeight: 1700, dpi: 72 },
]

async function main(): Promise<void> {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-image-scale-'))
  const failures: string[] = []
  let checks = 0

  const check = (condition: boolean, message: string): void => {
    checks += 1
    if (!condition) failures.push(message)
  }

  try {
    for (const testCase of CASES) {
      const imagePath = path.join(workDir, `${testCase.pixelWidth}x${testCase.pixelHeight}-${testCase.dpi ?? 'nodpi'}.png`)
      fs.writeFileSync(imagePath, makePng(testCase.pixelWidth, testCase.pixelHeight, testCase.dpi))

      // ── 'fit'：历史行为，必须无回归（等比铺满 A4）────────────────────
      const fitPdf = await imageToPdf(imagePath, { scale: 'fit' })
      const fitPlacement = readPlacement(fitPdf)
      fs.rmSync(fitPdf, { force: true })
      check(fitPlacement !== null, `${testCase.label}: fit 未解析到摆放矩阵`)
      if (fitPlacement) {
        const filledAxis =
          Math.abs(fitPlacement.width - A4_WIDTH) < 0.5 || Math.abs(fitPlacement.height - A4_HEIGHT) < 0.5
        check(filledAxis, `${testCase.label}: fit 不再铺满 A4（默认行为回归）`)
        const inputRatio = testCase.pixelWidth / testCase.pixelHeight
        const outputRatio = fitPlacement.width / fitPlacement.height
        check(
          Math.abs(inputRatio - outputRatio) < 0.01,
          `${testCase.label}: fit 下宽高比被改变（图片变形）`,
        )
      }

      // ── 'actual'：按声明 DPI 还原物理尺寸，绝不放大 ──────────────────
      const actualPdf = await imageToPdf(imagePath, { scale: 'actual' })
      const actualPlacement = readPlacement(actualPdf)
      fs.rmSync(actualPdf, { force: true })
      check(actualPlacement !== null, `${testCase.label}: actual 未解析到摆放矩阵`)
      if (!actualPlacement) continue

      const expectedWidth = testCase.dpi ? (testCase.pixelWidth / testCase.dpi) * PT_PER_INCH : null
      const expectedHeight = testCase.dpi ? (testCase.pixelHeight / testCase.dpi) * PT_PER_INCH : null
      const fitsOnA4 =
        expectedWidth !== null && expectedHeight !== null &&
        expectedWidth <= A4_WIDTH && expectedHeight <= A4_HEIGHT

      if (fitsOnA4) {
        check(
          Math.abs(actualPlacement.width - (expectedWidth as number)) < 0.5 &&
            Math.abs(actualPlacement.height - (expectedHeight as number)) < 0.5,
          `${testCase.label}: actual 应为 ${(expectedWidth as number).toFixed(1)}x` +
            `${(expectedHeight as number).toFixed(1)}pt，实得 ` +
            `${actualPlacement.width.toFixed(1)}x${actualPlacement.height.toFixed(1)}pt`,
        )
        // 核心断言：不得被放大铺满 A4
        check(
          actualPlacement.width < A4_WIDTH - 1,
          `${testCase.label}: actual 仍被放大铺满 A4 —— 用户排好的版被撑大了`,
        )
      } else {
        // 无 DPI 或物理尺寸超出 A4：无法诚实还原，退回 fit 是允许的
        check(
          Math.abs(actualPlacement.width - A4_WIDTH) < 0.5 ||
            Math.abs(actualPlacement.height - A4_HEIGHT) < 0.5,
          `${testCase.label}: 无法确定物理尺寸时应退回 fit`,
        )
      }
    }

    // ── 默认参数必须是 fit（服务端默认值，红线：不得改变默认行为）──────
    const defaultImage = path.join(workDir, 'default.png')
    fs.writeFileSync(defaultImage, makePng(295, 413, 300))
    const defaultPdf = await imageToPdf(defaultImage)
    const defaultPlacement = readPlacement(defaultPdf)
    fs.rmSync(defaultPdf, { force: true })
    check(
      defaultPlacement !== null && Math.abs(defaultPlacement.width - A4_WIDTH) < 0.5,
      '不传 scale 时默认行为不再是 fit —— 违反「不得改变现有 A4 打印默认行为」',
    )

    // ── print.ts 必须把 scale 透传下来，否则这里再对也没用 ─────────────
    const printSource = fs.readFileSync(path.join(__dirname, '../src/printer/print.ts'), 'utf8')
    check(
      /imageToPdf\(\s*filePath\s*,\s*\{[\s\S]*?scale:/.test(printSource),
      'print.ts 调用 imageToPdf 时未透传 scale —— 参数在这一层就被丢了',
    )
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true })
  }

  if (failures.length > 0) {
    console.error(`FAIL image scale truth: ${failures.length}/${checks}`)
    for (const failure of failures) console.error(`- ${failure}`)
    process.exit(1)
  }
  assert.equal(failures.length, 0)
  console.log(`PASS image scale truth: ${checks} checks across ${CASES.length} fixtures`)
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
