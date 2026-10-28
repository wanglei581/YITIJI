/**
 * 贴牌 Logo 的文件检查与重编码（只收 PNG，不新增依赖，用 node:zlib）。
 *
 * 为什么只收 PNG：仓库里没有图像库，WebP 只能读帧头、没法证明图像数据本身是好的；
 * PNG 的像素数据就是一条 zlib 压缩流，Node 自带解压，可以完整验证并重新编码。
 *
 * 格式只按**文件头魔数**判断——不信扩展名，也不信 Content-Type。
 * SVG（含改了扩展名的）、JPEG、GIF、WebP 一律拒绝：SVG 能带脚本，是存储型 XSS 的入口。
 *
 * 检查顺序（先便宜的、先挡会吃资源的）：
 *   1. 总长不超过 512KB；PNG 文件头；逐块核对长度与 CRC，必须以 IEND 结尾、IEND 后不得有多余字节；
 *   2. 拒动图块（acTL / fcTL / fdAT）；
 *   3. 读 IHDR 就限宽高（≤1024）与 1:1（±10%）——**在解压之前**，解压炸弹到不了下一步；
 *   4. 按 IHDR 算出「应有的解压后字节数」，用 inflateSync(maxOutputLength = 该值) 解开全部 IDAT：
 *      压缩流损坏、解压后超长或不足、压缩流结束后 IDAT 里还有夹带的字节，一律拒；
 *      每一行的滤波类型字节必须是 0–4；
 *   5. **重新编码**：只写 IHDR、PLTE、tRNS + 一个重新压缩的 IDAT + IEND，落盘的是重编码后的文件。
 *      文字块、EXIF、时间、内嵌色彩配置、未知块一概不留；像素数据（滤波后的扫描行）原样保留，画面不变。
 */
import { deflateSync, inflateSync } from 'node:zlib'
import {
  BRAND_LOGO_MAX_BYTES,
  BRAND_LOGO_MAX_PIXELS,
  type BrandLogoMimeType,
} from './branding.types'

export type BrandLogoInspection =
  | {
      ok: true
      mimeType: BrandLogoMimeType
      ext: 'png'
      width: number
      height: number
      /** 重编码后的文件内容，落盘的就是它。 */
      sanitized: Buffer
    }
  | { ok: false; code: BrandLogoErrorCode; message: string }

export type BrandLogoErrorCode =
  | 'BRAND_LOGO_EMPTY'
  | 'BRAND_LOGO_TOO_LARGE'
  | 'BRAND_LOGO_FORMAT_UNSUPPORTED'
  | 'BRAND_LOGO_CORRUPT'
  | 'BRAND_LOGO_ANIMATED'
  | 'BRAND_LOGO_DIMENSIONS_TOO_LARGE'
  | 'BRAND_LOGO_NOT_SQUARE'

function fail(code: BrandLogoErrorCode, message: string): BrandLogoInspection {
  return { ok: false, code, message }
}

const CORRUPT = fail('BRAND_LOGO_CORRUPT', '图片文件已损坏或不完整，请换一张重新导出')

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
/** 动图相关块。出现任何一个都拒绝，Logo 只收静态单帧。 */
const PNG_ANIMATION = new Set(['acTL', 'fcTL', 'fdAT'])
const PNG_CRITICAL = new Set(['IHDR', 'PLTE', 'IDAT', 'IEND'])
/** colorType → 允许的位深，以及每个像素的通道数。 */
const PNG_COLOR: Record<number, { depths: readonly number[]; channels: number }> = {
  0: { depths: [1, 2, 4, 8, 16], channels: 1 },
  2: { depths: [8, 16], channels: 3 },
  3: { depths: [1, 2, 4, 8], channels: 1 },
  4: { depths: [8, 16], channels: 2 },
  6: { depths: [8, 16], channels: 4 },
}
/** Adam7 七趟扫描：[起始列, 起始行, 列间隔, 行间隔]。 */
const ADAM7: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 0, 8, 8],
  [4, 0, 8, 8],
  [0, 4, 4, 8],
  [2, 0, 4, 4],
  [0, 2, 2, 4],
  [1, 0, 2, 2],
  [0, 1, 1, 2],
]

let crcTable: Uint32Array | null = null
function crc32(buffer: Buffer): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256)
    for (let n = 0; n < 256; n += 1) {
      let c = n
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      crcTable[n] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, crc])
}

/** 宽高都在 1..1024 之内、且 0.9 ≤ 宽/高 ≤ 1.1。整数运算，避免浮点边界误差。 */
function checkDimensions(width: number, height: number): BrandLogoInspection | null {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) return CORRUPT
  if (width > BRAND_LOGO_MAX_PIXELS || height > BRAND_LOGO_MAX_PIXELS) {
    return fail(
      'BRAND_LOGO_DIMENSIONS_TOO_LARGE',
      `Logo 宽高都不能超过 ${BRAND_LOGO_MAX_PIXELS} 像素（当前 ${width}×${height}）`,
    )
  }
  // 0.9 ≤ w/h ≤ 1.1  ⇔  9h ≤ 10w 且 10w ≤ 11h
  if (10 * width < 9 * height || 10 * width > 11 * height) {
    return fail('BRAND_LOGO_NOT_SQUARE', `Logo 需要是正方形（宽高比 1:1，允许上下 10%），当前 ${width}×${height}`)
  }
  return null
}

interface Layout {
  /** 解压后应有的总字节数（含每行开头的滤波类型字节）。 */
  expectedBytes: number
  /** 每一行（含滤波字节）的长度，按文件里出现的顺序；用来逐行核对滤波类型字节。 */
  rowLengths: number[]
}

/** 按 IHDR 算出解压后的数据布局：非隔行是 height 行，隔行（Adam7）是七趟里非空的各行。 */
function layoutOf(width: number, height: number, bitsPerPixel: number, interlace: number): Layout {
  const rowBytes = (pixels: number) => 1 + Math.ceil((pixels * bitsPerPixel) / 8)
  const rowLengths: number[] = []
  if (interlace === 0) {
    for (let y = 0; y < height; y += 1) rowLengths.push(rowBytes(width))
  } else {
    for (const [xStart, yStart, xStep, yStep] of ADAM7) {
      if (width <= xStart || height <= yStart) continue
      const passWidth = Math.ceil((width - xStart) / xStep)
      const passHeight = Math.ceil((height - yStart) / yStep)
      for (let y = 0; y < passHeight; y += 1) rowLengths.push(rowBytes(passWidth))
    }
  }
  return { expectedBytes: rowLengths.reduce((sum, n) => sum + n, 0), rowLengths }
}

function inspectPng(buffer: Buffer): BrandLogoInspection {
  let pos = PNG_SIGNATURE.length
  let index = 0
  let ended = false
  let ihdr: Buffer | null = null
  let plte: Buffer | null = null
  let trns: Buffer | null = null
  const idat: Buffer[] = []
  let idatClosed = false
  while (pos < buffer.length) {
    if (pos + 12 > buffer.length) return CORRUPT
    const length = buffer.readUInt32BE(pos)
    if (length > 0x7fffffff) return CORRUPT
    const type = buffer.toString('latin1', pos + 4, pos + 8)
    if (!/^[A-Za-z]{4}$/.test(type)) return CORRUPT
    const end = pos + 12 + length
    if (end > buffer.length) return CORRUPT
    const body = buffer.subarray(pos + 8, pos + 8 + length)
    if (crc32(buffer.subarray(pos + 4, pos + 8 + length)) !== buffer.readUInt32BE(pos + 8 + length)) return CORRUPT
    if (PNG_ANIMATION.has(type)) {
      return fail('BRAND_LOGO_ANIMATED', 'Logo 只能是静态图片，不能是动图（APNG）')
    }
    // 类型首字母大写 = 关键块。PNG 只有 IHDR / PLTE / IDAT / IEND 四种关键块，别的关键块规范要求解码器拒绝。
    if (/^[A-Z]/.test(type) && !PNG_CRITICAL.has(type)) return CORRUPT
    if (index === 0) {
      if (type !== 'IHDR' || length !== 13) return CORRUPT
      ihdr = body
    } else if (type === 'IHDR') {
      return CORRUPT
    }
    if (type === 'PLTE') {
      // PLTE 只能出现一次，且必须在 tRNS 与第一个 IDAT 之前。
      if (plte || trns || idat.length > 0 || length === 0 || length % 3 !== 0 || length > 768) return CORRUPT
      plte = body
    } else if (type === 'tRNS') {
      if (trns || idat.length > 0) return CORRUPT
      trns = body
    } else if (type === 'IDAT') {
      // 多个 IDAT 必须连续；中间夹了别的块再出现 IDAT 按损坏处理。
      if (idatClosed) return CORRUPT
      idat.push(body)
    } else if (idat.length > 0) {
      idatClosed = true
    }
    pos = end
    index += 1
    if (type === 'IEND') {
      if (length !== 0) return CORRUPT
      ended = true
      break
    }
  }
  // 必须以 IEND 结尾，且 IEND 之后不能再有字节（防图片后面夹带别的内容）。
  if (!ended || pos !== buffer.length || !ihdr || idat.length === 0) return CORRUPT

  // ── 解压之前：IHDR 自洽 + 限宽高 + 限比例 ──────────────────────────────────
  const width = ihdr.readUInt32BE(0)
  const height = ihdr.readUInt32BE(4)
  const bitDepth = ihdr[8]!
  const colorType = ihdr[9]!
  const compression = ihdr[10]
  const filter = ihdr[11]
  const interlace = ihdr[12]!
  const color = PNG_COLOR[colorType]
  if (!color || !color.depths.includes(bitDepth)) return CORRUPT
  if (compression !== 0 || filter !== 0 || (interlace !== 0 && interlace !== 1)) return CORRUPT
  const dimension = checkDimensions(width, height)
  if (dimension) return dimension
  if (colorType === 3 && !plte) return CORRUPT
  if (plte && (colorType === 0 || colorType === 4)) return CORRUPT
  if (colorType === 3 && plte && plte.length / 3 > 2 ** bitDepth) return CORRUPT
  // tRNS 的长度随颜色类型而定；灰度 + 透明、真彩 + 透明本身已带 alpha，不允许再有 tRNS。
  if (trns) {
    const ok =
      (colorType === 0 && trns.length === 2) ||
      (colorType === 2 && trns.length === 6) ||
      (colorType === 3 && plte !== null && trns.length <= plte.length / 3)
    if (!ok) return CORRUPT
  }

  // ── 完整解压：长度必须正好、压缩流后面不许有多余字节 ──────────────────────
  const layout = layoutOf(width, height, color.channels * bitDepth, interlace)
  const compressed = Buffer.concat(idat)
  let raw: Buffer
  try {
    // info: true 时 Node 返回 { buffer, engine }；@types/node 没有这个重载，按实际返回形状断言。
    const result = inflateSync(compressed, { info: true, maxOutputLength: layout.expectedBytes }) as unknown as {
      buffer: Buffer
      engine: { bytesWritten: number }
    }
    // engine.bytesWritten = 解压引擎实际吃掉的输入字节数；小于总长说明压缩流结束后还有夹带的字节。
    if (result.engine.bytesWritten !== compressed.length) return CORRUPT
    raw = result.buffer
  } catch {
    // 压缩流损坏、被截断，或解压后超过应有长度（解压炸弹）。
    return CORRUPT
  }
  if (raw.length !== layout.expectedBytes) return CORRUPT
  let offset = 0
  for (const rowLength of layout.rowLengths) {
    if (raw[offset]! > 4) return CORRUPT
    offset += rowLength
  }

  // ── 重新编码：只写 IHDR、PLTE、tRNS + 一个 IDAT + IEND ─────────────────────
  const parts = [PNG_SIGNATURE, chunk('IHDR', ihdr)]
  if (plte) parts.push(chunk('PLTE', plte))
  if (trns) parts.push(chunk('tRNS', trns))
  parts.push(chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)))
  const sanitized = Buffer.concat(parts)
  if (sanitized.length > BRAND_LOGO_MAX_BYTES) {
    return fail('BRAND_LOGO_TOO_LARGE', `Logo 不能超过 ${Math.round(BRAND_LOGO_MAX_BYTES / 1024)}KB`)
  }
  return { ok: true, mimeType: 'image/png', ext: 'png', width, height, sanitized }
}

/** 检查并重编码一张 Logo。只看内容，不看文件名与 Content-Type。 */
export function inspectBrandLogo(buffer: Buffer): BrandLogoInspection {
  if (buffer.length === 0) return fail('BRAND_LOGO_EMPTY', '上传的文件是空的')
  if (buffer.length > BRAND_LOGO_MAX_BYTES) {
    return fail('BRAND_LOGO_TOO_LARGE', `Logo 不能超过 ${Math.round(BRAND_LOGO_MAX_BYTES / 1024)}KB`)
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return inspectPng(buffer)
  return fail('BRAND_LOGO_FORMAT_UNSUPPORTED', 'Logo 只支持 PNG 图片（不支持 WebP、SVG、JPG、GIF）')
}
