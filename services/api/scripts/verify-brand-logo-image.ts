/**
 * verify:brand-logo-image —— Logo 文件检查与重编码（src/branding/brand-logo-image.ts）。纯函数，不连库、不起服务。
 *
 * Logo 由管理员上传、所有一体机公开展示，所以上传这一关要证明：落盘的一定是一张完整的、能解码的 PNG，里面没有夹带。
 * 只验块结构和 CRC 不够——CRC 对、压缩流是坏的，或压缩流后面夹带了别的字节，这样的文件能过。所以现在是：
 *   先按 IHDR 限宽高与比例（在解压之前）→ 按 IHDR 算出解压后应有的字节数 → inflateSync(maxOutputLength = 该值)
 *   → 长度必须正好、压缩流后不许有多余字节、滤波字节 0–4 → 重新编码，只写 IHDR / PLTE / tRNS + 一个 IDAT + IEND。
 *
 *   1. 格式：只认文件头；WebP / SVG / JPEG / GIF / 文本一律拒。
 *   2. 块结构：缺块、错序、CRC、长度、IEND 后夹带、动图块、关键块、调色板与透明度块的规则。
 *   3. 压缩流：CRC 对但流是坏的 / 被截断 / 流后夹带（含第二条完整压缩流）/ 解出长度不对 / 解压炸弹；
 *      并核对 maxOutputLength 恰好等于按 IHDR 算出的字节数、超大宽高与非 1:1 在解压之前就被拒（一次 inflate 都没调）。
 *   4. 扫描行布局：15 种颜色类型×位深 × 非隔行 / Adam7 隔行 × 20 种边长，逐个核对「正好放行、多一个字节拒、少一个字节拒」；
 *      Adam7 用独立的逐像素归类算法另算一遍（夹具里），6×6 RGBA8 另有手工推算的 156 字节做锚点，并用真实解码器核对。
 *   5. 调色板与透明度块的规则；6. 重编码：多块 IDAT + 一堆元数据 → 只剩 IHDR / IDAT / IEND，像素逐字节一致，幂等。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:branding（本文件是它的第一段）
 */
import { deflateSync } from 'node:zlib'
import { BRAND_LOGO_MAX_BYTES } from '../src/branding/branding.types'
import { inspectBrandLogo, type BrandLogoInspection } from '../src/branding/brand-logo-image'
import { Checker } from './support/branding-license-support'
import {
  adam7RowLengths,
  bitsPerPixel,
  buildPng,
  canvasImage,
  crc32,
  decodeSize,
  interlacedRows,
  pixelsOf,
  plainRows,
  PNG_SIG,
  pngChunk,
  pngChunks,
  pngFromSpec,
  splitInto,
} from './support/png-fixtures'

const c = new Checker()

// ── 观察 inflateSync：被测代码每次解压带了什么上限、有没有抛错 ────────────────────
// 被测模块是 swc 编译成 CommonJS 的，调用时才去 zlib 模块上取 inflateSync，所以在这里替换能观察到。
// eslint-disable-next-line @typescript-eslint/no-require-imports
const zlib = require('node:zlib') as typeof import('node:zlib')
const realInflate = zlib.inflateSync
interface InflateCall {
  maxOutputLength: number | undefined
  threw: boolean
}
let inflateCalls: InflateCall[] = []
;(zlib as unknown as { inflateSync: unknown }).inflateSync = (buffer: Buffer, options?: { maxOutputLength?: number }) => {
  try {
    const result = (realInflate as (b: Buffer, o?: unknown) => unknown)(buffer, options)
    inflateCalls.push({ maxOutputLength: options?.maxOutputLength, threw: false })
    return result
  } catch (error) {
    inflateCalls.push({ maxOutputLength: options?.maxOutputLength, threw: true })
    throw error
  }
}

type Accepted = Extract<BrandLogoInspection, { ok: true }>
function inspect(buffer: Buffer): { result: BrandLogoInspection; calls: InflateCall[] } {
  inflateCalls = []
  const result = inspectBrandLogo(buffer)
  return { result, calls: [...inflateCalls] }
}
const codeOf = (result: BrandLogoInspection): string => (result.ok ? 'OK' : result.code)
function rejects(name: string, buffer: Buffer, code: string): { result: BrandLogoInspection; calls: InflateCall[] } {
  const seen = inspect(buffer)
  c.equal(`拒绝：${name}`, codeOf(seen.result), code)
  return seen
}
function accepts(name: string, buffer: Buffer): Accepted | null {
  const { result } = inspect(buffer)
  c.check(`放行：${name}`, result.ok, result.ok ? '' : `${result.code} ${result.message}`)
  return result.ok ? result : null
}
const typesOf = (png: Buffer): string[] => pngChunks(png).map((chunk) => chunk.type)
const chunkOf = (png: Buffer, type: string): Buffer => pngChunks(png).find((chunk) => chunk.type === type)!.data
const idatData = (png: Buffer): Buffer => Buffer.concat(pngChunks(png).filter((chunk) => chunk.type === 'IDAT').map((chunk) => chunk.data))
const RGBA = bitsPerPixel(6, 8)

async function main(): Promise<void> {
  // ── 1. 格式只认文件头，只收 PNG ─────────────────────────────────────────────
  console.log('\n[1] 格式：只收 PNG')
  const realPng = canvasImage(256, 256, 'image/png')
  const okReal = accepts('真实编码器出的 256×256 PNG', realPng)
  c.check('结果：image/png、png、256×256、落盘内容以 PNG 文件头开头',
    !!okReal && okReal.mimeType === 'image/png' && okReal.ext === 'png' && okReal.width === 256 && okReal.height === 256 && okReal.sanitized.subarray(0, 8).equals(PNG_SIG))
  c.check('重编码后画面与原图逐像素一致', !!okReal && (await pixelsOf(okReal.sanitized)).equals(await pixelsOf(realPng)))
  const webp = rejects('真实 WebP（不再收）', canvasImage(300, 300, 'image/webp'), 'BRAND_LOGO_FORMAT_UNSUPPORTED')
  c.check('WebP 的拒绝文案点明只收 PNG', !webp.result.ok && webp.result.message.includes('PNG'))
  rejects('SVG（带脚本）', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), 'BRAND_LOGO_FORMAT_UNSUPPORTED')
  rejects('JPEG', Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1]), 'BRAND_LOGO_FORMAT_UNSUPPORTED')
  rejects('GIF', Buffer.from('GIF89a\x01\x00\x01\x00'), 'BRAND_LOGO_FORMAT_UNSUPPORTED')
  rejects('文本冒充图片', Buffer.from('not an image at all'), 'BRAND_LOGO_FORMAT_UNSUPPORTED')
  rejects('空文件', Buffer.alloc(0), 'BRAND_LOGO_EMPTY')
  const tooLarge = rejects('超过 512KB', Buffer.concat([buildPng(64, 64), Buffer.alloc(BRAND_LOGO_MAX_BYTES + 1)]), 'BRAND_LOGO_TOO_LARGE')
  c.equal('超大文件在解析之前就拒（没有解压）', tooLarge.calls.length, 0)
  rejects('只有 8 字节 PNG 文件头', PNG_SIG, 'BRAND_LOGO_CORRUPT')

  // ── 2. 块结构 ───────────────────────────────────────────────────────────────
  console.log('\n[2] 块结构')
  const base = buildPng(64, 64)
  const flip = (buffer: Buffer, at: number): Buffer => { const b = Buffer.from(buffer); b[at]! ^= 0xff; return b }
  rejects('PNG 头部被改一个字节（块校验不过）', flip(base, 40), 'BRAND_LOGO_CORRUPT')
  rejects('PNG 数据区被改一个字节（结构合法，只有块校验 CRC 能发现）', flip(base, 45), 'BRAND_LOGO_CORRUPT')
  rejects('PNG 被截断', base.subarray(0, 60), 'BRAND_LOGO_CORRUPT')
  rejects('PNG 结尾夹带脚本（IEND 之后还有字节）', Buffer.concat([base, Buffer.from('<script>alert(1)</script>')]), 'BRAND_LOGO_CORRUPT')
  rejects('没有 IEND', pngFromSpec({ width: 64, height: 64, iend: false }), 'BRAND_LOGO_CORRUPT')
  rejects('IEND 带数据', Buffer.concat([pngFromSpec({ width: 64, height: 64, iend: false }), pngChunk('IEND', Buffer.from('x'))]), 'BRAND_LOGO_CORRUPT')
  rejects('没有 IDAT', Buffer.concat([PNG_SIG, pngChunks(base)[0]!.raw, pngChunk('IEND')]), 'BRAND_LOGO_CORRUPT')
  rejects('第一块不是 IHDR', Buffer.concat([PNG_SIG, pngChunk('tEXt', Buffer.from('a\0b')), ...pngChunks(base).map((chunk) => chunk.raw)]), 'BRAND_LOGO_CORRUPT')
  rejects('两个 IHDR', Buffer.concat([PNG_SIG, pngChunks(base)[0]!.raw, pngChunks(base)[0]!.raw, ...pngChunks(base).slice(1).map((chunk) => chunk.raw)]), 'BRAND_LOGO_CORRUPT')
  rejects('IHDR 长度不是 13', pngFromSpec({ width: 64, height: 64, ihdrData: Buffer.alloc(12) }), 'BRAND_LOGO_CORRUPT')
  rejects('块类型不是四个字母', Buffer.concat([PNG_SIG, pngChunks(base)[0]!.raw, pngChunk('ab1d', Buffer.alloc(1)), ...pngChunks(base).slice(1).map((chunk) => chunk.raw)]), 'BRAND_LOGO_CORRUPT')
  const lying = Buffer.from(base)
  lying.writeUInt32BE(0x7fffffff, 8 + 12 + 13)
  rejects('块长度声称比整个文件还大', lying, 'BRAND_LOGO_CORRUPT')
  const stream = deflateSync(plainRows(64, 64, RGBA))
  const [half1, half2] = splitInto(stream, 2) as [Buffer, Buffer]
  rejects('IDAT 被别的块隔开（IDAT, tEXt, IDAT）', Buffer.concat([PNG_SIG, pngChunks(base)[0]!.raw, pngChunk('IDAT', half1), pngChunk('tEXt', Buffer.from('a\0b')), pngChunk('IDAT', half2), pngChunk('IEND')]), 'BRAND_LOGO_CORRUPT')
  accepts('连续的多个 IDAT 是合法的', pngFromSpec({ width: 64, height: 64, idat: [half1, half2] }))
  rejects('动图 acTL', buildPng(64, 64, { afterIhdr: [pngChunk('acTL', Buffer.alloc(8))] }), 'BRAND_LOGO_ANIMATED')
  rejects('动图 fcTL', buildPng(64, 64, { beforeIend: [pngChunk('fcTL', Buffer.alloc(26))] }), 'BRAND_LOGO_ANIMATED')
  rejects('动图 fdAT', buildPng(64, 64, { beforeIend: [pngChunk('fdAT', Buffer.alloc(8))] }), 'BRAND_LOGO_ANIMATED')
  rejects('不认识的关键块（首字母大写）', buildPng(64, 64, { afterIhdr: [pngChunk('XTRA', Buffer.alloc(4))] }), 'BRAND_LOGO_CORRUPT')
  accepts('不认识的辅助块（首字母小写）会被丢掉而不是拒绝', buildPng(64, 64, { afterIhdr: [pngChunk('prVT', Buffer.from('SECRET'))] }))

  // ── 3. 压缩流 ───────────────────────────────────────────────────────────────
  console.log('\n[3] 压缩流：块校验对，不等于图是好的')
  const raw64 = plainRows(64, 64, RGBA)
  const EXPECT64 = 64 * (1 + 64 * 4)
  const withStream = (data: Buffer | Buffer[]): Buffer => pngFromSpec({ width: 64, height: 64, idat: Array.isArray(data) ? data : [data] })
  const garbage = rejects('IDAT 里是垃圾（块校验是对的）', withStream(Buffer.from('this is definitely not a zlib stream')), 'BRAND_LOGO_CORRUPT')
  c.check('  垃圾流：解压被调用过且抛错', garbage.calls.length === 1 && garbage.calls[0]!.threw)
  const good = deflateSync(raw64)
  let broken: Buffer | null = null
  for (let i = Math.floor(good.length / 2); i < good.length - 4 && !broken; i += 1) {
    const candidate = Buffer.from(good)
    candidate[i]! ^= 0x5a
    try { realInflate(candidate) } catch { broken = candidate }
  }
  c.check('夹具自检：翻一个字节的压缩流确实解不开', broken !== null)
  const brokenSeen = rejects('压缩流中间坏了一个字节（块校验仍是对的）', withStream(broken!), 'BRAND_LOGO_CORRUPT')
  c.check('  坏流：解压被调用过且抛错', brokenSeen.calls.length === 1 && brokenSeen.calls[0]!.threw)
  rejects('压缩流被截断（少了校验尾巴）', withStream(good.subarray(0, good.length - 6)), 'BRAND_LOGO_CORRUPT')
  rejects('压缩流只剩两字节头', withStream(good.subarray(0, 2)), 'BRAND_LOGO_CORRUPT')

  const trailingScript = Buffer.concat([good, Buffer.from('<script>alert(1)</script>')])
  c.check('夹具自检：压缩流后夹带脚本，单独 inflate 不报错、结果完整（只能靠「吃掉的字节数」发现）', realInflate(trailingScript).equals(raw64))
  rejects('IDAT 里压缩流结束后夹带脚本', withStream(trailingScript), 'BRAND_LOGO_CORRUPT')
  const twoStreams = Buffer.concat([good, deflateSync(Buffer.from('hidden second payload'))])
  c.check('夹具自检：两条压缩流首尾相接，单独 inflate 只解第一条且不报错', realInflate(twoStreams).equals(raw64))
  rejects('IDAT 里首尾相接了第二条完整压缩流', withStream(twoStreams), 'BRAND_LOGO_CORRUPT')
  rejects('压缩流后只多一个零字节', withStream(Buffer.concat([good, Buffer.from([0])])), 'BRAND_LOGO_CORRUPT')
  const [part1, part2] = splitInto(good, 2) as [Buffer, Buffer]
  rejects('夹带藏在最后一个 IDAT 块的末尾', withStream([part1, Buffer.concat([part2, Buffer.from('tail')])]), 'BRAND_LOGO_CORRUPT')

  const exact = inspect(withStream(good))
  c.check('放行：压缩流恰好等于应有长度', exact.result.ok)
  c.check('  放行时解压只调用一次，上限恰好等于按 IHDR 算出的字节数，没有抛错',
    exact.calls.length === 1 && exact.calls[0]!.maxOutputLength === EXPECT64 && !exact.calls[0]!.threw)
  rejects('解出来少一行（压缩流本身完好）', withStream(deflateSync(raw64.subarray(0, raw64.length - 257))), 'BRAND_LOGO_CORRUPT')
  rejects('解出来少一个字节', withStream(deflateSync(raw64.subarray(0, raw64.length - 1))), 'BRAND_LOGO_CORRUPT')
  rejects('解出来多一行', withStream(deflateSync(Buffer.concat([raw64, raw64.subarray(0, 257)]))), 'BRAND_LOGO_CORRUPT')
  rejects('解出来多一个字节', withStream(deflateSync(Buffer.concat([raw64, Buffer.from([0])]))), 'BRAND_LOGO_CORRUPT')

  const bomb = deflateSync(Buffer.alloc(100 * 1024 * 1024))
  c.check(`夹具自检：100MB 全零的压缩流只有 ${Math.round(bomb.length / 1024)}KB，能通过 512KB 的文件大小检查`, bomb.length < BRAND_LOGO_MAX_BYTES)
  const bombSeen = rejects('解压炸弹：IHDR 说 64×64，流里是 100MB', withStream(bomb), 'BRAND_LOGO_CORRUPT')
  c.check('  炸弹：解压上限就是 64×64 该有的字节数，且被拦下（抛错而不是吐出 100MB）',
    bombSeen.calls.length === 1 && bombSeen.calls[0]!.maxOutputLength === EXPECT64 && bombSeen.calls[0]!.threw)
  const bombBig = rejects('解压炸弹：IHDR 说 1024×1024，流里是 100MB', pngFromSpec({ width: 1024, height: 1024, idat: [bomb] }), 'BRAND_LOGO_CORRUPT')
  c.check('  上限随 IHDR 走：1024×1024 RGBA8 该有 4195328 字节', bombBig.calls[0]?.maxOutputLength === 1024 * (1 + 1024 * 4) && bombBig.calls[0]!.threw)

  // 宽高与比例在解压之前就拒：一次 inflate 都不许调
  const tinyStream = deflateSync(Buffer.alloc(8))
  for (const [label, width, height, code, real] of [
    ['1025×1025', 1025, 1025, 'BRAND_LOGO_DIMENSIONS_TOO_LARGE', true],
    ['65535×65535（IDAT 只有几字节）', 65535, 65535, 'BRAND_LOGO_DIMENSIONS_TOO_LARGE', false],
    ['4294967295×4294967295', 0xffffffff, 0xffffffff, 'BRAND_LOGO_DIMENSIONS_TOO_LARGE', false],
    ['2048×1（先报超大）', 2048, 1, 'BRAND_LOGO_DIMENSIONS_TOO_LARGE', false],
    ['200×100 不是 1:1', 200, 100, 'BRAND_LOGO_NOT_SQUARE', true],
    ['111×100 刚好越界', 111, 100, 'BRAND_LOGO_NOT_SQUARE', true],
    ['100×112 刚好越界', 100, 112, 'BRAND_LOGO_NOT_SQUARE', true],
    ['0×0', 0, 0, 'BRAND_LOGO_CORRUPT', false],
    ['64×0', 64, 0, 'BRAND_LOGO_CORRUPT', false],
  ] as const) {
    const seen = rejects(label, real ? buildPng(width, height) : pngFromSpec({ width, height, idat: [tinyStream] }), code)
    c.equal(`  ${label}：在解压之前就拒，没有调用 inflate`, seen.calls.length, 0)
  }
  for (const [label, width, height] of [['1024×1024 恰好上限', 1024, 1024], ['110×100 比例恰好 1.1', 110, 100], ['100×110 比例约 0.909', 100, 110], ['1×1', 1, 1]] as const) {
    accepts(label, buildPng(width, height))
  }

  // 滤波类型字节只许 0–4
  rejects('第一行滤波类型 5', pngFromSpec({ width: 8, height: 8, raw: (() => { const r = plainRows(8, 8, RGBA); r[0] = 5; return r })() }), 'BRAND_LOGO_CORRUPT')
  rejects('最后一行滤波类型 255', pngFromSpec({ width: 8, height: 8, raw: (() => { const r = plainRows(8, 8, RGBA); r[7 * 33] = 255; return r })() }), 'BRAND_LOGO_CORRUPT')
  accepts('各行滤波类型 0–4 轮流出现', pngFromSpec({ width: 8, height: 8, raw: (() => { const r = plainRows(8, 8, RGBA); for (let y = 0; y < 8; y += 1) r[y * 33] = y % 5; return r })() }))
  const interlacedBad = interlacedRows(16, 16, RGBA)
  interlacedBad[interlacedBad.length - (1 + 16 * 4)] = 9
  rejects('隔行图像最后一趟里有一行滤波类型 9', pngFromSpec({ width: 16, height: 16, interlace: 1, raw: interlacedBad }), 'BRAND_LOGO_CORRUPT')

  // IHDR 字段合法性
  for (const [label, spec] of [
    ['位深 3', { bitDepth: 3 }], ['颜色类型 1', { colorType: 1 }], ['调色板图像位深 16', { colorType: 3, bitDepth: 16 }],
    ['真彩色位深 4', { colorType: 2, bitDepth: 4 }], ['压缩方法 1', { compression: 1 }], ['滤波方法 1', { filterMethod: 1 }], ['隔行方式 2', { interlace: 2 }],
  ] as const) {
    rejects(`IHDR：${label}`, pngFromSpec({ width: 16, height: 16, raw: Buffer.alloc(16 * 65), beforeIdat: 'colorType' in spec && spec.colorType === 3 ? [pngChunk('PLTE', Buffer.alloc(3))] : [], ...spec }), 'BRAND_LOGO_CORRUPT')
  }

  // ── 4. 扫描行布局：颜色类型 × 位深 × 隔行 × 边长 ─────────────────────────────
  console.log('\n[4] 扫描行布局')
  const lengths66 = adam7RowLengths(6, 6, RGBA)
  c.equal('Adam7 参考实现：6×6 RGBA8 各行长度（手工推算 5+5+9+5+5+13×4+25×3）', lengths66, [5, 5, 9, 5, 5, 13, 13, 13, 13, 25, 25, 25])
  c.equal('  合计 156 字节', lengths66.reduce((a, b) => a + b, 0), 156)
  const solid66 = interlacedRows(6, 6, RGBA, (_row, i) => [0x00, 0x88, 0xcc, 0xff][(i - 1) % 4]!)
  const interlaced66 = pngFromSpec({ width: 6, height: 6, interlace: 1, raw: solid66 })
  c.check('真实解码器认这份 156 字节的隔行 6×6（夹具自检）', (await decodeSize(interlaced66)).width === 6)
  const interlaced66Pixels = await pixelsOf(interlaced66)
  c.check('  解出来 36 个像素全是同一种纯色（行布局与解码器的理解一致）', interlaced66Pixels.length === 36 * 4 && [...interlaced66Pixels].every((v, i) => v === [0x00, 0x88, 0xcc, 0xff][i % 4]))
  const okInterlaced = accepts('隔行 6×6 RGBA8', interlaced66)
  c.check('  重编码后仍是同一张图（隔行标志保留）', !!okInterlaced && (await pixelsOf(okInterlaced.sanitized)).equals(interlaced66Pixels) && chunkOf(okInterlaced.sanitized, 'IHDR')[12] === 1)
  // 参考实现再用真实解码器核对别的边长：解得开、且仍是纯色，才说明行布局没算错
  const solidColor = (_row: number, i: number): number => [0x00, 0x88, 0xcc, 0xff][(i - 1) % 4]!
  const decoderDisagrees: number[] = []
  for (const n of [3, 7, 9, 11, 16, 17, 30]) {
    const pixels = await pixelsOf(pngFromSpec({ width: n, height: n, interlace: 1, raw: interlacedRows(n, n, RGBA, solidColor) })).catch(() => Buffer.alloc(0))
    if (pixels.length !== n * n * 4 || ![...pixels].every((v, i) => v === [0x00, 0x88, 0xcc, 0xff][i % 4])) decoderDisagrees.push(n)
  }
  c.check('真实解码器核对 Adam7 参考实现：3 / 7 / 9 / 11 / 16 / 17 / 30 边长的隔行图都解得开且是纯色', decoderDisagrees.length === 0, `不一致的边长：${decoderDisagrees}`)
  rejects('隔行 6×6 但按非隔行的 150 字节给', pngFromSpec({ width: 6, height: 6, interlace: 1, raw: plainRows(6, 6, RGBA) }), 'BRAND_LOGO_CORRUPT')
  rejects('非隔行 6×6 但给了隔行的 156 字节', pngFromSpec({ width: 6, height: 6, interlace: 0, raw: solid66 }), 'BRAND_LOGO_CORRUPT')

  const combos: Array<[number, number]> = [[0, 1], [0, 2], [0, 4], [0, 8], [0, 16], [2, 8], [2, 16], [3, 1], [3, 2], [3, 4], [3, 8], [4, 8], [4, 16], [6, 8], [6, 16]]
  const sizes = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 15, 16, 17, 23, 24, 25, 31, 33]
  let sweepCases = 0
  const sweepWrong: string[] = []
  for (const [colorType, bitDepth] of combos) {
    for (const interlace of [0, 1]) {
      for (const n of sizes) {
        const bpp = bitsPerPixel(colorType, bitDepth)
        const raw = interlace ? interlacedRows(n, n, bpp) : plainRows(n, n, bpp)
        const palette = colorType === 3 ? [pngChunk('PLTE', Buffer.alloc(3 * Math.min(256, 2 ** bitDepth)))] : []
        const make = (data: Buffer): Buffer => pngFromSpec({ width: n, height: n, bitDepth, colorType, interlace, raw: data, beforeIdat: palette })
        const label = `颜色类型 ${colorType} 位深 ${bitDepth} ${interlace ? '隔行' : '非隔行'} ${n}×${n}`
        sweepCases += 1
        if (!inspect(make(raw)).result.ok) sweepWrong.push(`${label}：该放行却拒了`)
        if (inspect(make(Buffer.concat([raw, Buffer.from([0])]))).result.ok) sweepWrong.push(`${label}：多一个字节却放行了`)
        if (inspect(make(raw.subarray(0, raw.length - 1))).result.ok) sweepWrong.push(`${label}：少一个字节却放行了`)
      }
    }
  }
  c.check(`布局扫描：${sweepCases} 种组合，每种「正好放行 / 多一个字节拒 / 少一个字节拒」`, sweepWrong.length === 0, sweepWrong.slice(0, 5).join('；'))

  // ── 5. 调色板与透明度 ───────────────────────────────────────────────────────
  console.log('\n[5] 调色板与透明度')
  const PLTE4 = pngChunk('PLTE', Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]))
  const rows16 = Buffer.concat(Array.from({ length: 16 }, (_, y) => Buffer.from([0, ...Array.from({ length: 16 }, (_, x) => (x + y) % 4)])))
  const paletteSpec = { width: 16, height: 16, bitDepth: 8, colorType: 3, raw: rows16 }
  const paletteOriginal = pngFromSpec({ ...paletteSpec, beforeIdat: [PLTE4, pngChunk('tRNS', Buffer.from([255, 0x80]))] })
  const okPalette = accepts('调色板图像 + tRNS', paletteOriginal)
  c.check('  落盘只剩 IHDR / PLTE / tRNS / IDAT / IEND，画面（含半透明）逐像素一致',
    !!okPalette && typesOf(okPalette.sanitized).join() === 'IHDR,PLTE,tRNS,IDAT,IEND' && (await pixelsOf(okPalette.sanitized)).equals(await pixelsOf(paletteOriginal)))
  c.check('  夹具自检：第二个调色板项确实是半透明（alpha 0x80），且重编码后仍是', !!okPalette && (await pixelsOf(paletteOriginal))[7] === 0x80 && (await pixelsOf(okPalette.sanitized))[7] === 0x80)
  accepts('灰度 + tRNS（2 字节）', pngFromSpec({ width: 8, height: 8, bitDepth: 8, colorType: 0, beforeIdat: [pngChunk('tRNS', Buffer.from([0, 7]))] }))
  accepts('真彩色 + tRNS（6 字节）', pngFromSpec({ width: 8, height: 8, bitDepth: 8, colorType: 2, beforeIdat: [pngChunk('tRNS', Buffer.alloc(6))] }))
  accepts('真彩色带建议调色板 PLTE', pngFromSpec({ width: 8, height: 8, bitDepth: 8, colorType: 2, beforeIdat: [PLTE4] }))
  const withPalette = (extra: Partial<Parameters<typeof pngFromSpec>[0]>): Buffer => pngFromSpec({ ...paletteSpec, ...extra })
  const T2 = pngChunk('tRNS', Buffer.from([255, 0x80]))
  rejects('调色板图像没有 PLTE', withPalette({ beforeIdat: [] }), 'BRAND_LOGO_CORRUPT')
  rejects('PLTE 长度不是 3 的倍数', withPalette({ beforeIdat: [pngChunk('PLTE', Buffer.alloc(4))] }), 'BRAND_LOGO_CORRUPT')
  rejects('PLTE 为空', withPalette({ beforeIdat: [pngChunk('PLTE', Buffer.alloc(0))] }), 'BRAND_LOGO_CORRUPT')
  rejects('PLTE 超过 256 项', withPalette({ beforeIdat: [pngChunk('PLTE', Buffer.alloc(3 * 257))] }), 'BRAND_LOGO_CORRUPT')
  rejects('位深 2 的调色板有 5 项（最多 4 项）', pngFromSpec({ width: 8, height: 8, bitDepth: 2, colorType: 3, beforeIdat: [pngChunk('PLTE', Buffer.alloc(15))] }), 'BRAND_LOGO_CORRUPT')
  rejects('tRNS 比调色板项数还多', withPalette({ beforeIdat: [PLTE4, pngChunk('tRNS', Buffer.alloc(5))] }), 'BRAND_LOGO_CORRUPT')
  rejects('两个 PLTE', withPalette({ beforeIdat: [PLTE4, PLTE4] }), 'BRAND_LOGO_CORRUPT')
  rejects('PLTE 在 tRNS 之后', withPalette({ beforeIdat: [T2, PLTE4] }), 'BRAND_LOGO_CORRUPT')
  rejects('PLTE 在 IDAT 之后', withPalette({ beforeIdat: [], afterIdat: [PLTE4] }), 'BRAND_LOGO_CORRUPT')
  rejects('tRNS 在 IDAT 之后', withPalette({ beforeIdat: [PLTE4], afterIdat: [T2] }), 'BRAND_LOGO_CORRUPT')
  rejects('两个 tRNS', withPalette({ beforeIdat: [PLTE4, T2, T2] }), 'BRAND_LOGO_CORRUPT')
  rejects('灰度图像带 PLTE', pngFromSpec({ width: 8, height: 8, bitDepth: 8, colorType: 0, beforeIdat: [PLTE4] }), 'BRAND_LOGO_CORRUPT')
  rejects('灰度 + alpha 图像带 PLTE', pngFromSpec({ width: 8, height: 8, bitDepth: 8, colorType: 4, beforeIdat: [PLTE4] }), 'BRAND_LOGO_CORRUPT')
  rejects('带 alpha 的 RGBA 图像再带 tRNS', pngFromSpec({ width: 8, height: 8, bitDepth: 8, colorType: 6, beforeIdat: [T2] }), 'BRAND_LOGO_CORRUPT')
  rejects('灰度 + alpha 再带 tRNS', pngFromSpec({ width: 8, height: 8, bitDepth: 8, colorType: 4, beforeIdat: [T2] }), 'BRAND_LOGO_CORRUPT')
  rejects('灰度 tRNS 长度 1', pngFromSpec({ width: 8, height: 8, bitDepth: 8, colorType: 0, beforeIdat: [pngChunk('tRNS', Buffer.alloc(1))] }), 'BRAND_LOGO_CORRUPT')
  rejects('真彩色 tRNS 长度 2', pngFromSpec({ width: 8, height: 8, bitDepth: 8, colorType: 2, beforeIdat: [T2] }), 'BRAND_LOGO_CORRUPT')

  // ── 6. 重编码：元数据与多块 IDAT ────────────────────────────────────────────
  console.log('\n[6] 重编码')
  const source = canvasImage(128, 128, 'image/png')
  const sourceIhdr = pngChunks(source)[0]!.raw
  const sourceStream = idatData(source)
  const pieces = splitInto(sourceStream, 3)
  c.check('夹具自检：真实 PNG 的压缩流被切成 3 块 IDAT', pieces.length === 3 && Buffer.concat(pieces).equals(sourceStream))
  const dirty = Buffer.concat([
    PNG_SIG, sourceIhdr,
    pngChunk('gAMA', Buffer.alloc(4)), pngChunk('cHRM', Buffer.alloc(32)), pngChunk('sRGB', Buffer.alloc(1)), pngChunk('pHYs', Buffer.alloc(9)),
    pngChunk('tEXt', Buffer.from('Comment\0SECRET-GPS-1234')), pngChunk('zTXt', Buffer.from('Key\0\0SECRET-Z')), pngChunk('iTXt', Buffer.from('Key\0\0\0\0\0SECRET-I')),
    pngChunk('iCCP', Buffer.from('icc\0\0SECRET-ICC')), pngChunk('sBIT', Buffer.alloc(4)),
    pngChunk('IDAT', pieces[0]!), pngChunk('IDAT', pieces[1]!), pngChunk('IDAT', pieces[2]!),
    pngChunk('eXIf', Buffer.from('Exif\0\0SECRET-EXIF')), pngChunk('tIME', Buffer.alloc(7)), pngChunk('prVT', Buffer.from('SECRET-PRIVATE')),
    pngChunk('IEND'),
  ])
  const okDirty = accepts('带 10 种元数据块、IDAT 切成三块的 PNG', dirty)
  const out = okDirty!.sanitized
  c.equal('落盘只剩 IHDR / IDAT / IEND', typesOf(out), ['IHDR', 'IDAT', 'IEND'])
  c.check('  不含任何秘密字符串', !out.includes('SECRET'))
  c.check('  IHDR 原样保留，IDAT 只有一块', chunkOf(out, 'IHDR').equals(chunkOf(source, 'IHDR')) && typesOf(out).filter((t) => t === 'IDAT').length === 1)
  c.check('  压缩前的扫描行与原图逐字节相同', realInflate(idatData(out)).equals(realInflate(sourceStream)))
  c.check('  画面逐像素一致，仍是 128×128', (await pixelsOf(out)).equals(await pixelsOf(source)) && (await decodeSize(out)).width === 128)
  c.check('  每一块的长度与 CRC 都对，文件恰好结束在 IEND', (() => {
    let pos = 8
    for (const chunk of pngChunks(out)) {
      if (crc32(chunk.raw.subarray(4, chunk.raw.length - 4)) !== chunk.raw.readUInt32BE(chunk.raw.length - 4)) return false
      pos += chunk.raw.length
    }
    return pos === out.length
  })())
  c.check('  比带元数据的原文件小', out.length < dirty.length)
  const again = inspect(out)
  c.check('  对落盘结果再检查一遍：仍放行，且字节不变（重编码幂等）', again.result.ok && again.result.sanitized.equals(out))
  c.check('  已是干净 PNG 的输入：输出也不含多余块', typesOf(okReal!.sanitized).join() === 'IHDR,IDAT,IEND')

  c.finish('verify:brand-logo-image')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
