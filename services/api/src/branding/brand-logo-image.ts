/**
 * 贴牌 Logo 的文件检查与清洗（不新增依赖，直接读文件头）。
 *
 * 只收 PNG 与 WebP，格式只按**文件头魔数**判断——不信扩展名，也不信 Content-Type。
 * SVG（含改了扩展名的）、JPEG、GIF 一律拒绝：SVG 能带脚本，是存储型 XSS 的入口。
 *
 * 通过检查的文件还要「清洗」再落盘：
 *   - PNG 只保留画面必需块与颜色块（IHDR PLTE tRNS IDAT IEND gAMA cHRM sRGB），
 *     丢掉文字块、EXIF、时间、内嵌色彩配置等一切元数据；
 *   - WebP 只保留 VP8X / ALPH / VP8 / VP8L，丢掉 EXIF / XMP / ICCP，并把 VP8X 里对应的标志位清零。
 * 清洗只做块级复制，不重新编码，所以画面一个像素都不会变。
 * 另外拒绝：动图（APNG / 动态 WebP）、块长度越界、CRC 不符、文件尾部有多余字节。
 *
 * 限值：不超过 512KB；宽高都不超过 1024；宽高比 1:1（允许 ±10%）。
 */
import {
  BRAND_LOGO_MAX_BYTES,
  BRAND_LOGO_MAX_PIXELS,
  type BrandLogoMimeType,
} from './branding.types'

export type BrandLogoInspection =
  | {
      ok: true
      mimeType: BrandLogoMimeType
      ext: 'png' | 'webp'
      width: number
      height: number
      /** 清洗后的文件内容，落盘的就是它。 */
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
const PNG_KEEP = new Set(['IHDR', 'PLTE', 'tRNS', 'IDAT', 'IEND', 'gAMA', 'cHRM', 'sRGB'])
/** 动图相关块。出现任何一个都拒绝，Logo 只收静态单帧。 */
const PNG_ANIMATION = new Set(['acTL', 'fcTL', 'fdAT'])
/** colorType → 允许的位深。 */
const PNG_DEPTHS: Record<number, readonly number[]> = {
  0: [1, 2, 4, 8, 16],
  2: [8, 16],
  3: [1, 2, 4, 8],
  4: [8, 16],
  6: [8, 16],
}

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

function inspectPng(buffer: Buffer): BrandLogoInspection {
  let pos = PNG_SIGNATURE.length
  const kept: Buffer[] = [PNG_SIGNATURE]
  let width = 0
  let height = 0
  let index = 0
  let sawIdat = false
  let sawPlte = false
  let colorType = -1
  let ended = false
  while (pos < buffer.length) {
    if (pos + 12 > buffer.length) return CORRUPT
    const length = buffer.readUInt32BE(pos)
    if (length > 0x7fffffff) return CORRUPT
    const typeBytes = buffer.subarray(pos + 4, pos + 8)
    const type = typeBytes.toString('latin1')
    if (!/^[A-Za-z]{4}$/.test(type)) return CORRUPT
    const end = pos + 12 + length
    if (end > buffer.length) return CORRUPT
    const body = buffer.subarray(pos + 8, pos + 8 + length)
    if (crc32(buffer.subarray(pos + 4, pos + 8 + length)) !== buffer.readUInt32BE(pos + 8 + length)) return CORRUPT
    if (PNG_ANIMATION.has(type)) {
      return fail('BRAND_LOGO_ANIMATED', 'Logo 只能是静态图片，不能是动图（APNG）')
    }
    if (index === 0) {
      if (type !== 'IHDR' || length !== 13) return CORRUPT
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      const depth = body[8]!
      colorType = body[9]!
      const compression = body[10]
      const filter = body[11]
      const interlace = body[12]
      if (!PNG_DEPTHS[colorType]?.includes(depth)) return CORRUPT
      if (compression !== 0 || filter !== 0 || (interlace !== 0 && interlace !== 1)) return CORRUPT
      const dimension = checkDimensions(width, height)
      if (dimension) return dimension
    } else if (type === 'IHDR') {
      return CORRUPT
    }
    if (type === 'PLTE') {
      if (sawIdat || length === 0 || length % 3 !== 0 || length > 768) return CORRUPT
      sawPlte = true
    }
    if (type === 'IDAT') sawIdat = true
    if (PNG_KEEP.has(type)) kept.push(buffer.subarray(pos, end))
    pos = end
    index += 1
    if (type === 'IEND') {
      if (length !== 0) return CORRUPT
      ended = true
      break
    }
  }
  // 必须以 IEND 结尾，且 IEND 之后不能再有字节（防图片后面夹带别的内容）。
  if (!ended || pos !== buffer.length || !sawIdat) return CORRUPT
  if (colorType === 3 && !sawPlte) return CORRUPT
  return { ok: true, mimeType: 'image/png', ext: 'png', width, height, sanitized: Buffer.concat(kept) }
}

const WEBP_IMAGE_CHUNKS = new Set(['VP8 ', 'VP8L'])
const WEBP_KEEP = new Set(['VP8X', 'ALPH', 'VP8 ', 'VP8L'])
/** VP8X 标志位：ICC 0x20、EXIF 0x08、XMP 0x04 要清零；动画 0x02 直接拒绝。 */
const VP8X_ANIMATION = 0x02
const VP8X_CLEAR = 0x20 | 0x08 | 0x04

interface WebpChunk {
  type: string
  data: Buffer
}

function webpImageSize(chunk: WebpChunk): { width: number; height: number } | null {
  const data = chunk.data
  if (chunk.type === 'VP8 ') {
    // 3 字节帧标签（最低位 0 = 关键帧）+ 起始码 9d 01 2a + 14 位宽 + 14 位高
    if (data.length < 10 || (data[0]! & 1) !== 0) return null
    if (data[3] !== 0x9d || data[4] !== 0x01 || data[5] !== 0x2a) return null
    return { width: data.readUInt16LE(6) & 0x3fff, height: data.readUInt16LE(8) & 0x3fff }
  }
  // VP8L：签名字节 0x2f，之后 14 位（宽-1）、14 位（高-1）、1 位透明、3 位版本（必须为 0）
  if (data.length < 5 || data[0] !== 0x2f) return null
  const bits = data.readUInt32LE(1)
  if (bits >>> 29 !== 0) return null
  return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 }
}

function inspectWebp(buffer: Buffer): BrandLogoInspection {
  if (buffer.length < 20) return CORRUPT
  // RIFF 总长必须等于文件长度：不许尾部夹带，也不许截断。
  if (buffer.readUInt32LE(4) + 8 !== buffer.length) return CORRUPT
  const chunks: WebpChunk[] = []
  let pos = 12
  while (pos < buffer.length) {
    if (pos + 8 > buffer.length) return CORRUPT
    const type = buffer.toString('latin1', pos, pos + 4)
    const size = buffer.readUInt32LE(pos + 4)
    const next = pos + 8 + size + (size & 1)
    if (pos + 8 + size > buffer.length || next > buffer.length) return CORRUPT
    chunks.push({ type, data: buffer.subarray(pos + 8, pos + 8 + size) })
    pos = next
  }
  const first = chunks[0]
  if (!first || !(first.type === 'VP8X' || WEBP_IMAGE_CHUNKS.has(first.type))) return CORRUPT
  const imageChunk = chunks.find((chunk) => WEBP_IMAGE_CHUNKS.has(chunk.type))
  if (chunks.some((chunk) => chunk.type === 'ANIM' || chunk.type === 'ANMF')) {
    return fail('BRAND_LOGO_ANIMATED', 'Logo 只能是静态图片，不能是动图（动态 WebP）')
  }
  let extended: WebpChunk | null = null
  if (first.type === 'VP8X') {
    extended = first
    if (first.data.length !== 10) return CORRUPT
    if (first.data[0]! & VP8X_ANIMATION) {
      return fail('BRAND_LOGO_ANIMATED', 'Logo 只能是静态图片，不能是动图（动态 WebP）')
    }
  }
  if (!imageChunk) return CORRUPT
  const size = webpImageSize(imageChunk)
  if (!size) return CORRUPT
  let { width, height } = size
  if (extended) {
    const canvasWidth = extended.data.readUIntLE(4, 3) + 1
    const canvasHeight = extended.data.readUIntLE(7, 3) + 1
    // 单帧 WebP 的画布必须与图像本身同尺寸，不一致按损坏处理（防用画布尺寸绕过检查）。
    if (canvasWidth !== width || canvasHeight !== height) return CORRUPT
    width = canvasWidth
    height = canvasHeight
  }
  const dimension = checkDimensions(width, height)
  if (dimension) return dimension

  const out: Buffer[] = []
  for (const chunk of chunks) {
    if (!WEBP_KEEP.has(chunk.type)) continue
    let data = chunk.data
    if (chunk.type === 'VP8X') {
      data = Buffer.from(data)
      data[0] = data[0]! & ~VP8X_CLEAR
    }
    const header = Buffer.alloc(8)
    header.write(chunk.type, 0, 'latin1')
    header.writeUInt32LE(data.length, 4)
    out.push(header, data)
    if (data.length & 1) out.push(Buffer.from([0]))
  }
  const body = Buffer.concat(out)
  const riff = Buffer.alloc(12)
  riff.write('RIFF', 0, 'latin1')
  riff.writeUInt32LE(body.length + 4, 4)
  riff.write('WEBP', 8, 'latin1')
  return { ok: true, mimeType: 'image/webp', ext: 'webp', width, height, sanitized: Buffer.concat([riff, body]) }
}

/** 检查并清洗一张 Logo。只看内容，不看文件名与 Content-Type。 */
export function inspectBrandLogo(buffer: Buffer): BrandLogoInspection {
  if (buffer.length === 0) return fail('BRAND_LOGO_EMPTY', '上传的文件是空的')
  if (buffer.length > BRAND_LOGO_MAX_BYTES) {
    return fail('BRAND_LOGO_TOO_LARGE', `Logo 不能超过 ${Math.round(BRAND_LOGO_MAX_BYTES / 1024)}KB`)
  }
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return inspectPng(buffer)
  if (
    buffer.length >= 12 &&
    buffer.toString('latin1', 0, 4) === 'RIFF' &&
    buffer.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return inspectWebp(buffer)
  }
  return fail('BRAND_LOGO_FORMAT_UNSUPPORTED', 'Logo 只支持 PNG 或 WebP 图片（不支持 SVG、JPG、GIF）')
}
