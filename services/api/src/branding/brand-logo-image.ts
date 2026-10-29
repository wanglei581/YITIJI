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
 *   5. **索引色（颜色类型 3）逐像素核对**：反滤波（五种滤波、隔行每趟各自从零行起）后，每个像素的调色板索引必须小于 PLTE 项数
 *      （位深 1 / 2 / 4 / 8 都核，行尾的填充位不算）；PLTE 项数 ≥ 2^位深 时索引不可能越界，直接跳过这一步。tRNS 长度也核。
 *      只做索引色：别的颜色类型的像素值没有「越界」一说，不需要反滤波。
 *   6. **重新编码**：只写 IHDR、PLTE、tRNS + 一个重新压缩的 IDAT + IEND，落盘的是重编码后的文件。
 *      去掉的是辅助块（文字、EXIF、时间、内嵌色彩配置、私有块）并规整压缩流；
 *      **像素数据本身原样保留**——所以这不是「清除隐藏内容」：藏在像素里的信息（隐写）不在处理范围，不要对外这样宣称。
 *
 * 资源预算（同步执行，会占事件循环；只有管理员能上传）：
 *   - 输入 ≤ 512KB、宽高 ≤ 1024、解压输出被 maxOutputLength 卡死，最坏的扫描数据约 8 MiB（1024×1024 RGBA16）；
 *   - 重压缩用 level 4，**不用 level 9**：实测 8 MiB 稀疏噪声数据 level 9 要 3.4 秒、level 6 要 0.2 秒、level 4 不超过 0.05 秒
 *     （level 4 起用惰性匹配但搜索链只有 16，耗时有界，压缩率接近 level 6）；
 *   - 实测（本机 Apple 芯片，Node 22）：最坏规格（1024×1024 RGBA16 非隔行 / 隔行、8 位与 4 位索引色逐行 Paeth）单次 inspectBrandLogo 约 50 ms；
 *     verify-brand-logo-image 的第 7 节断言重压缩级别在 1–5、单次 < 2000 ms（只拦数量级的退化，例如改回 level 9），超了会红。
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
/** 重压缩级别。不用 9：见文件头「资源预算」。 */
const RECOMPRESS_LEVEL = 4
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
  /** 扫描行分趟：非隔行只有一趟；Adam7 是非空的各趟。每趟 width 个像素、rows 行，「上一行」在每趟开头重新从零行算起。 */
  passes: Array<{ width: number; rows: number }>
  /** 一行（含滤波字节）的长度，pixels 为这一行的像素数。 */
  rowLength: (pixels: number) => number
}

/** 按 IHDR 算出解压后的数据布局：非隔行是 height 行，隔行（Adam7）是七趟里非空的各行。 */
function layoutOf(width: number, height: number, bitsPerPixel: number, interlace: number): Layout {
  const rowLength = (pixels: number) => 1 + Math.ceil((pixels * bitsPerPixel) / 8)
  const passes: Layout['passes'] = []
  if (interlace === 0) {
    passes.push({ width, rows: height })
  } else {
    for (const [xStart, yStart, xStep, yStep] of ADAM7) {
      if (width <= xStart || height <= yStart) continue
      passes.push({ width: Math.ceil((width - xStart) / xStep), rows: Math.ceil((height - yStart) / yStep) })
    }
  }
  return { expectedBytes: passes.reduce((sum, pass) => sum + pass.rows * rowLength(pass.width), 0), passes, rowLength }
}

/** PNG 反滤波（索引色每像素 1 字节以内，滤波用的「每像素字节数」就是 1）。line 原地改写，prior 是上一行已还原的数据。 */
function unfilterRow(filter: number, line: Uint8Array, prior: Uint8Array): void {
  const n = line.length
  if (filter === 1) {
    for (let i = 1; i < n; i += 1) line[i] = (line[i]! + line[i - 1]!) & 0xff
  } else if (filter === 2) {
    for (let i = 0; i < n; i += 1) line[i] = (line[i]! + prior[i]!) & 0xff
  } else if (filter === 3) {
    for (let i = 0; i < n; i += 1) line[i] = (line[i]! + (((i > 0 ? line[i - 1]! : 0) + prior[i]!) >> 1)) & 0xff
  } else if (filter === 4) {
    for (let i = 0; i < n; i += 1) {
      const a = i > 0 ? line[i - 1]! : 0
      const b = prior[i]!
      const c = i > 0 ? prior[i - 1]! : 0
      const p = a + b - c
      const pa = Math.abs(p - a)
      const pb = Math.abs(p - b)
      const pc = Math.abs(p - c)
      line[i] = (line[i]! + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff
    }
  }
}

/** 一行里的 width 个调色板索引是否都小于 entries（位深 1 / 2 / 4 / 8；高位在前，行尾填充位不看）。 */
function indicesWithin(line: Uint8Array, width: number, bitDepth: number, entries: number): boolean {
  if (bitDepth === 8) {
    for (let x = 0; x < width; x += 1) if (line[x]! >= entries) return false
    return true
  }
  const mask = (1 << bitDepth) - 1
  for (let x = 0; x < width; x += 1) {
    const bit = x * bitDepth
    if (((line[bit >> 3]! >> (8 - bitDepth - (bit & 7))) & mask) >= entries) return false
  }
  return true
}

/**
 * 逐行核对：滤波类型字节 0–4；索引色且调色板不满时，反滤波后核对每个像素的索引没有越过 PLTE。
 * 返回 false = 文件有问题。
 */
function scanRows(raw: Buffer, layout: Layout, colorType: number, bitDepth: number, paletteEntries: number): boolean {
  const checkIndices = colorType === 3 && paletteEntries < 2 ** bitDepth
  let offset = 0
  for (const pass of layout.passes) {
    const length = layout.rowLength(pass.width)
    let prior = new Uint8Array(length - 1)
    for (let y = 0; y < pass.rows; y += 1) {
      const filter = raw[offset]!
      if (filter > 4) return false
      if (checkIndices) {
        const line = Uint8Array.from(raw.subarray(offset + 1, offset + length))
        unfilterRow(filter, line, prior)
        if (!indicesWithin(line, pass.width, bitDepth, paletteEntries)) return false
        prior = line
      }
      offset += length
    }
  }
  return true
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
  if (!scanRows(raw, layout, colorType, bitDepth, plte ? plte.length / 3 : 0)) return CORRUPT

  // ── 重新编码：只写 IHDR、PLTE、tRNS + 一个 IDAT + IEND ─────────────────────
  const parts = [PNG_SIGNATURE, chunk('IHDR', ihdr)]
  if (plte) parts.push(chunk('PLTE', plte))
  if (trns) parts.push(chunk('tRNS', trns))
  parts.push(chunk('IDAT', deflateSync(raw, { level: RECOMPRESS_LEVEL })), chunk('IEND', Buffer.alloc(0)))
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
