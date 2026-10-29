/**
 * PNG 测试夹具（只给门禁用）。
 *
 * 夹具按 PNG 规范手工拼装，**不调用被测代码（src/branding/brand-logo-image.ts）里的任何函数**：
 * 被测的是它对块结构、压缩流、扫描行布局的判断，用它自己的函数造夹具等于拿尺子量尺子。
 * Adam7 的每趟扫描行长度在这里用「逐像素归类再数个数」的办法另算一遍，
 * 与被测代码的「按趟算宽高」是两种算法，两边对得上才算数。
 */
import { deflateSync } from 'node:zlib'

let table: Uint32Array | null = null
export function crc32(buffer: Buffer): number {
  if (!table) {
    table = new Uint32Array(256)
    for (let n = 0; n < 256; n += 1) {
      let c = n
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      table[n] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (const byte of buffer) crc = table[(crc ^ byte) & 0xff]! ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

export const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** 一个 PNG 块：长度 + 类型 + 数据 + CRC（CRC 一定是对的，坏数据靠数据本身造）。 */
export function pngChunk(type: string, data: Buffer = Buffer.alloc(0)): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0)
  return Buffer.concat([head, data, crc])
}

/** 把一个（合法的）PNG 拆成块，读落盘结果用。 */
export function pngChunks(png: Buffer): Array<{ type: string; raw: Buffer; data: Buffer }> {
  const out: Array<{ type: string; raw: Buffer; data: Buffer }> = []
  let pos = 8
  while (pos < png.length) {
    const length = png.readUInt32BE(pos)
    const type = png.toString('latin1', pos + 4, pos + 8)
    out.push({ type, raw: png.subarray(pos, pos + 12 + length), data: png.subarray(pos + 8, pos + 8 + length) })
    pos += 12 + length
  }
  return out
}

/** 每种颜色类型每个像素的通道数。 */
export const PNG_CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }

export function bitsPerPixel(colorType: number, bitDepth: number): number {
  return (PNG_CHANNELS[colorType] ?? 4) * bitDepth
}

function rowBytes(pixels: number, bpp: number): number {
  return 1 + Math.ceil((pixels * bpp) / 8)
}

/** 非隔行图像的扫描行（含每行开头的滤波字节）。数据字节随行列变化，免得整张压成一团零。 */
export function plainRows(width: number, height: number, bpp: number, filterByte = 0): Buffer {
  const length = rowBytes(width, bpp)
  const raw = Buffer.alloc(length * height)
  for (let y = 0; y < height; y += 1) {
    raw[y * length] = filterByte
    for (let i = 1; i < length; i += 1) raw[y * length + i] = (y * 31 + i * 7) & 0xff
  }
  return raw
}

/**
 * Adam7 参考实现：先把每个像素归到七趟之一，再数「每一趟的每一行有几个像素」，
 * 返回按文件顺序排列的各扫描行长度（含滤波字节）。
 * 归类规则来自 PNG 规范的 Adam7 图（趟号 / 列起点 / 行起点 / 列间隔 / 行间隔：
 * 1: 0,0,8,8  2: 4,0,8,8  3: 0,4,4,8  4: 2,0,4,4  5: 0,2,2,4  6: 1,0,2,2  7: 0,1,1,2）。
 */
export function adam7PassOf(x: number, y: number): number {
  if (y % 8 === 0 && x % 8 === 0) return 0
  if (y % 8 === 4 && x % 4 === 0) return 2
  if (y % 8 === 0 && x % 8 === 4) return 1
  if (y % 4 === 0 && x % 4 === 2) return 3
  if (y % 4 === 2 && x % 2 === 0) return 4
  if (y % 2 === 0 && x % 2 === 1) return 5
  return 6
}

/** Adam7 每一趟里各行包含哪些像素（按文件里的顺序：趟序、行序、行内从左到右）。 */
export function adam7Positions(width: number, height: number): Array<Array<Array<[number, number]>>> {
  const passes: Array<Map<number, Array<[number, number]>>> = Array.from({ length: 7 }, () => new Map())
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const rows = passes[adam7PassOf(x, y)]!
      const row = rows.get(y) ?? []
      row.push([x, y])
      rows.set(y, row)
    }
  }
  return passes.map((rows) => [...rows.keys()].sort((a, b) => a - b).map((y) => rows.get(y)!))
}

export function adam7RowLengths(width: number, height: number, bpp: number): number[] {
  const passOf = adam7PassOf
  const counts: Array<Map<number, number>> = Array.from({ length: 7 }, () => new Map<number, number>())
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pass = counts[passOf(x, y)]!
      pass.set(y, (pass.get(y) ?? 0) + 1)
    }
  }
  return counts.flatMap((pass) => [...pass.keys()].sort((a, b) => a - b).map((y) => rowBytes(pass.get(y)!, bpp)))
}

/** 隔行（Adam7）图像的扫描行；`fill` 给出每个数据字节的取值，默认按行号变化。 */
export function interlacedRows(width: number, height: number, bpp: number, fill?: (rowIndex: number, byteIndex: number) => number): Buffer {
  const lengths = adam7RowLengths(width, height, bpp)
  const total = lengths.reduce((sum, n) => sum + n, 0)
  const raw = Buffer.alloc(total)
  let offset = 0
  lengths.forEach((length, row) => {
    raw[offset] = 0
    for (let i = 1; i < length; i += 1) raw[offset + i] = fill ? fill(row, i) : (row * 29 + i * 5) & 0xff
    offset += length
  })
  return raw
}

export interface PngSpec {
  width: number
  height: number
  bitDepth?: number
  colorType?: number
  interlace?: number
  compression?: number
  filterMethod?: number
  /** 整个 IHDR 数据直接给（造长度不对的 IHDR 用）；给了就忽略上面的宽高等字段。 */
  ihdrData?: Buffer
  /** 未压缩的扫描行；不给就按非隔行的默认内容生成。 */
  raw?: Buffer
  /** 直接给每个 IDAT 块里的数据（可多块）；给了就不再压缩 raw。 */
  idat?: Buffer[]
  /** IHDR 之后、第一个 IDAT 之前的块（PLTE / tRNS / 元数据 / 动图块等）。 */
  beforeIdat?: Buffer[]
  /** 最后一个 IDAT 之后、IEND 之前的块。 */
  afterIdat?: Buffer[]
  /** 默认 true；false 则不写 IEND（造「没有结尾」的文件）。 */
  iend?: boolean
}

export function pngFromSpec(spec: PngSpec): Buffer {
  const bitDepth = spec.bitDepth ?? 8
  const colorType = spec.colorType ?? 6
  let ihdr = spec.ihdrData
  if (!ihdr) {
    ihdr = Buffer.alloc(13)
    ihdr.writeUInt32BE(spec.width >>> 0, 0)
    ihdr.writeUInt32BE(spec.height >>> 0, 4)
    ihdr[8] = bitDepth
    ihdr[9] = colorType
    ihdr[10] = spec.compression ?? 0
    ihdr[11] = spec.filterMethod ?? 0
    ihdr[12] = spec.interlace ?? 0
  }
  // 给了 idat 就不再生成扫描行（造 65535×65535 之类的超大宽高时，不能真的分配那么多）。
  const compressed = spec.idat ?? [deflateSync(spec.raw ?? plainRows(spec.width, spec.height, bitsPerPixel(colorType, bitDepth)))]
  const idat = compressed.map((data) => pngChunk('IDAT', data))
  return Buffer.concat([
    PNG_SIG,
    pngChunk('IHDR', ihdr),
    ...(spec.beforeIdat ?? []),
    ...idat,
    ...(spec.afterIdat ?? []),
    ...(spec.iend === false ? [] : [pngChunk('IEND')]),
  ])
}

/** 纯色 8 位 RGBA PNG。宽高任意（deflate 会把纯色压得很小，1024×1024 也只有几 KB）。 */
export function buildPng(width: number, height: number, extra: { afterIhdr?: Buffer[]; beforeIend?: Buffer[] } = {}): Buffer {
  const row = Buffer.alloc(1 + width * 4, 0)
  for (let x = 0; x < width; x += 1) {
    row[1 + x * 4] = 0x00
    row[2 + x * 4] = 0x88
    row[3 + x * 4] = 0xcc
    row[4 + x * 4] = 0xff
  }
  const raw = Buffer.concat(Array.from({ length: height }, () => row))
  return pngFromSpec({ width, height, raw, beforeIdat: extra.afterIhdr, afterIdat: extra.beforeIend })
}

/** 把一段数据切成 n 份（最后一份可能更短），拼多个 IDAT 用。 */
export function splitInto(data: Buffer, parts: number): Buffer[] {
  const size = Math.ceil(data.length / parts)
  return Array.from({ length: parts }, (_, i) => data.subarray(i * size, Math.min(data.length, (i + 1) * size))).filter((piece) => piece.length > 0)
}

// ── 真实编码器与解码器（@napi-rs/canvas）──────────────────────────────────────

type CanvasModule = typeof import('@napi-rs/canvas')
function canvasModule(): CanvasModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('@napi-rs/canvas') as CanvasModule
}

/** 用 @napi-rs/canvas 生成真实编码器出的 PNG / WebP（可解码）。 */
export function canvasImage(width: number, height: number, mime: 'image/png' | 'image/webp'): Buffer {
  const canvas = canvasModule().createCanvas(width, height)
  const context = canvas.getContext('2d')
  context.fillStyle = '#0088cc'
  context.fillRect(0, 0, width, height)
  context.fillStyle = '#ffffff'
  context.fillRect(width / 4, height / 4, width / 2, height / 2)
  return canvas.toBuffer(mime)
}

/** 用 @napi-rs/canvas 解码，返回尺寸；解不出来抛错。 */
export async function decodeSize(buffer: Buffer): Promise<{ width: number; height: number }> {
  const image = await canvasModule().loadImage(buffer)
  return { width: image.width, height: image.height }
}

/** 解码后逐像素的 RGBA 字节；两张图「画面一样」就是这两段字节相等。 */
export async function pixelsOf(buffer: Buffer): Promise<Buffer> {
  const { createCanvas, loadImage } = canvasModule()
  const image = await loadImage(buffer)
  const canvas = createCanvas(image.width, image.height)
  const context = canvas.getContext('2d')
  context.drawImage(image, 0, 0)
  return Buffer.from(context.getImageData(0, 0, image.width, image.height).data.buffer)
}

// ── 滤波编码与索引色图像（独立于被测代码的反滤波）──────────────────────────────

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

/**
 * 把「还原后的各行」（不含滤波字节）按每行指定的滤波类型编码，拼成带滤波字节的扫描行。
 * filters 循环取用（filters[y % filters.length]）。隔行图像每趟各调一次（每趟的「上一行」从零行起）。
 */
export function filterRows(rows: Uint8Array[], filters: number[], bytesPerPixel = 1): Buffer {
  const out: Buffer[] = []
  let prior = new Uint8Array(rows[0]?.length ?? 0)
  rows.forEach((row, y) => {
    const filter = filters[y % filters.length]!
    const line = Buffer.alloc(1 + row.length)
    line[0] = filter
    for (let i = 0; i < row.length; i += 1) {
      const a = i >= bytesPerPixel ? row[i - bytesPerPixel]! : 0
      const b = prior[i]!
      const c = i >= bytesPerPixel ? prior[i - bytesPerPixel]! : 0
      const predicted = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : paeth(a, b, c)
      line[1 + i] = (row[i]! - predicted) & 0xff
    }
    out.push(line)
    prior = row
  })
  return Buffer.concat(out)
}

/** 调色板索引按位深打包成一行：高位在前，行尾补 0。 */
export function packIndices(indices: number[], bitDepth: number): Uint8Array {
  const row = new Uint8Array(Math.ceil((indices.length * bitDepth) / 8))
  indices.forEach((value, x) => {
    const bit = x * bitDepth
    row[bit >> 3]! |= (value & ((1 << bitDepth) - 1)) << (8 - bitDepth - (bit & 7))
  })
  return row
}

export interface PaletteImageSpec {
  width: number
  height: number
  bitDepth: 1 | 2 | 4 | 8
  /** PLTE 的项数。 */
  entries: number
  interlace?: 0 | 1
  /** 每行的滤波类型，循环使用；默认全部 0。 */
  filters?: number[]
  /** 像素 (x, y) 的调色板索引。 */
  index: (x: number, y: number) => number
  /** tRNS 的项数（不给 = 没有 tRNS）。 */
  trnsEntries?: number
}

/** 索引色 PNG：PLTE 有 entries 项，像素索引由 spec.index 给，按指定滤波编码。 */
export function paletteImage(spec: PaletteImageSpec): Buffer {
  const interlace = spec.interlace ?? 0
  const filters = spec.filters ?? [0]
  const rowsOf = (positions: Array<[number, number]>): Uint8Array => packIndices(positions.map(([x, y]) => spec.index(x, y)), spec.bitDepth)
  let raw: Buffer
  if (interlace === 0) {
    const rows = Array.from({ length: spec.height }, (_, y) => rowsOf(Array.from({ length: spec.width }, (_, x) => [x, y] as [number, number])))
    raw = filterRows(rows, filters)
  } else {
    raw = Buffer.concat(adam7Positions(spec.width, spec.height).map((pass) => filterRows(pass.map(rowsOf), filters)))
  }
  const palette = Buffer.alloc(spec.entries * 3)
  for (let i = 0; i < spec.entries; i += 1) palette.writeUIntBE(((i * 53) % 256) * 65536 + ((i * 97) % 256) * 256 + ((i * 29) % 256), i * 3, 3)
  return pngFromSpec({
    width: spec.width, height: spec.height, bitDepth: spec.bitDepth, colorType: 3, interlace, raw,
    beforeIdat: [pngChunk('PLTE', palette), ...(spec.trnsEntries ? [pngChunk('tRNS', Buffer.alloc(spec.trnsEntries, 0x80))] : [])],
  })
}
