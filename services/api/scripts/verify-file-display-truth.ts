/**
 * verify:file-display-truth —— 「文件被怎么呈现」的真值门禁（批次 REAL-FILE-PRINT）。
 *
 * 由 2026-08-17 真实文件走查产出：造真实 PDF / 图片走 上传→体检→预览，发现四类
 * **算错**（不是样式问题）。本门禁按「行为」验，不写死清单：
 *
 *   1. estimateA4Dpi：等比「适合页面」下的 DPI 必须由**先顶到边的那一轴**决定。
 *      用独立推导的参考实现逐例比对，并钉住回归方向（旧的两层 min/max 取反实现必须挂）。
 *   2. resolvePdfPageCount：压缩对象流 PDF（Word / Chrome / LaTeX / pdf-lib 默认产物）
 *      必须能读出页数；结构损坏的 PDF 必须 fail-closed，**不得**回落到字节扫描猜一个数。
 *   3. validateUpload 超限文案：必须说清实际大小、上限和可执行的下一步，
 *      不得出现「直传」等 kiosk 前台不存在的内部实现词。
 *   4. kiosk 上传页展示的上限数字必须等于服务端对 print_doc 代理上传的**实际生效**上限。
 *
 * 素材全部在本脚本内即时生成（手写 PDF 字节 / 手写 PNG 字节），不依赖仓库里的测试文件，
 * 也不落盘。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import {
  describeBlankPages,
  estimateA4Dpi,
  formatPageRanges,
  MIN_RECOMMENDED_DPI,
} from '../src/materials/image-print-quality.util'
import { countPdfPages, resolvePdfPageCount } from '../src/files/file-page-count.util'
import { PROXY_MAX_BYTES, PURPOSE_POLICY, validateUpload } from '../src/files/file-validation'

let failed = 0
let passed = 0

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed += 1
    console.log(`  PASS  ${name}`)
  } else {
    failed += 1
    console.error(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

// ── 1. A4 DPI：等比 fit + 自动方向 ─────────────────────────────────────────────

/**
 * 参考实现，**从几何独立推导**，不抄被测实现：
 * 等比缩放放进 W×H 英寸的纸，印出来的宽 = min(W, H·w/h)，DPI = w / 印出宽。
 * 自动方向取印得更大的那张（DPI 更低者）。
 */
function referenceA4Dpi(w: number, h: number): number {
  const dpiOnPage = (pageW: number, pageH: number): number => {
    const printedWidthIn = Math.min(pageW, (pageH * w) / h)
    return w / printedWidthIn
  }
  return Math.max(1, Math.round(Math.min(dpiOnPage(8.27, 11.69), dpiOnPage(11.69, 8.27))))
}

/** 走查里造过的真实素材比例 + 边界比例。 */
const DPI_CASES: Array<[string, number, number]> = [
  ['A4@300dpi 竖 2480x3508', 2480, 3508],
  ['A4@300dpi 横 3508x2480', 3508, 2480],
  ['正方形 800x800', 800, 800],
  ['竖版3:4 900x1200', 900, 1200],
  ['横版16:9 1920x1080', 1920, 1080],
  ['极宽 3000x200', 3000, 200],
  ['极高 200x3000', 200, 3000],
  ['极小 100x100', 100, 100],
  ['极大 6000x4000', 6000, 4000],
  ['1px 竖线 1x2000', 1, 2000],
  ['1px 横线 2000x1', 2000, 1],
]

console.log('\n[1] estimateA4Dpi —— 等比适合页面 + 自动方向')
for (const [label, w, h] of DPI_CASES) {
  const got = estimateA4Dpi(w, h)
  const want = referenceA4Dpi(w, h)
  check(`${label} → ${got} DPI`, got === want, `参考实现算得 ${want}`)
}

// 方向不变性：转置图片得到的 DPI 必须相同（自动方向就该如此）
for (const [label, w, h] of DPI_CASES) {
  check(`${label} 转置后 DPI 不变`, estimateA4Dpi(w, h) === estimateA4Dpi(h, w))
}

// 回归钉子：旧实现（每轴 min、方向取 max）在偏离 A4 比例时必须与现实现不同，
// 否则说明有人把算法改回去了而用例没覆盖到。
const legacyA4Dpi = (w: number, h: number): number =>
  Math.max(1, Math.round(Math.max(Math.min(w / 8.27, h / 11.69), Math.min(w / 11.69, h / 8.27))))
const legacyDiffers = DPI_CASES.filter(([, w, h]) => legacyA4Dpi(w, h) !== estimateA4Dpi(w, h))
check(
  '旧「每轴取 min」实现已被替换（偏离 A4 比例的用例结果不同）',
  legacyDiffers.length >= 5,
  `只有 ${legacyDiffers.length} 例不同`,
)

// 极端比例不得被误判为低清：3000x200 等比放进 A4 实际约 257 DPI
for (const [label, w, h] of [
  ['极宽 3000x200', 3000, 200],
  ['极高 200x3000', 200, 3000],
  ['横版16:9 1920x1080', 1920, 1080],
] as Array<[string, number, number]>) {
  check(
    `${label} 不被误报低清（≥ ${MIN_RECOMMENDED_DPI} DPI）`,
    estimateA4Dpi(w, h) >= MIN_RECOMMENDED_DPI,
    `实得 ${estimateA4Dpi(w, h)} DPI`,
  )
}

// 真正的低清必须仍然被判低清（防止「修成永远不报警」）
for (const [label, w, h] of [
  ['极小 100x100', 100, 100],
  ['正方形 800x800', 800, 800],
] as Array<[string, number, number]>) {
  check(`${label} 仍被判低清`, estimateA4Dpi(w, h) < MIN_RECOMMENDED_DPI, `实得 ${estimateA4Dpi(w, h)} DPI`)
}

check('非法尺寸不抛错且不产生 0/NaN', estimateA4Dpi(0, 0) === 1 && estimateA4Dpi(-5, 10) === 1)

// ── 2. PDF 页数：压缩对象流 + 损坏文件 ────────────────────────────────────────

/** 手写 PDF：页对象以**明文**写出（老式生产者）。 */
function plainPdf(pages: number): Buffer {
  const objs: string[] = []
  const pageIds: number[] = []
  const pagesObjId = 1
  for (let i = 0; i < pages; i++) {
    const contentId = objs.length + 2
    objs.push(`<< /Length 0 >>\nstream\n\nendstream`)
    const pageId = objs.length + 2
    objs.push(
      `<< /Type /Page /Parent ${pagesObjId} 0 R /MediaBox [0 0 595 842] /Resources << >> /Contents ${contentId} 0 R >>`,
    )
    pageIds.push(pageId)
  }
  const kids = pageIds.map((id) => `${id} 0 R`).join(' ')
  const all = [`<< /Type /Pages /Count ${pages} /Kids [${kids}] >>`, ...objs, `<< /Type /Catalog /Pages 1 0 R >>`]
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  all.forEach((body, idx) => {
    offsets.push(out.length)
    out += `${idx + 1} 0 obj\n${body}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${all.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`
  out += `trailer\n<< /Size ${all.length + 1} /Root ${all.length} 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

/**
 * 手写 PDF：页对象塞进**压缩对象流**(/Type /ObjStm) + 交叉引用流。
 * 这是 Word / Chrome「打印为 PDF」/ LaTeX / pdf-lib 的默认产物形态——
 * 页对象是 deflate 过的二进制，字节正则一个都看不见。
 */
function objectStreamPdf(pages: number): Buffer {
  // 对象编号：1=Catalog 2=Pages 3..(2+pages)=Page，全部装进 ObjStm(编号 3+pages)
  const catalogId = 1
  const pagesId = 2
  const firstPageId = 3
  const pageIds = Array.from({ length: pages }, (_, i) => firstPageId + i)
  const bodies: Array<[number, string]> = [
    [catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`],
    [pagesId, `<< /Type /Pages /Count ${pages} /Kids [${pageIds.map((i) => `${i} 0 R`).join(' ')}] >>`],
    ...pageIds.map(
      (id) => [id, `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << >> >>`] as [number, string],
    ),
  ]
  let pairs = ''
  let payload = ''
  for (const [num, body] of bodies) {
    pairs += `${num} ${payload.length} `
    payload += `${body} `
  }
  const first = pairs.length
  const objStmRaw = Buffer.from(pairs + payload, 'latin1')
  const objStmData = deflateSync(objStmRaw)
  const objStmId = firstPageId + pages
  const xrefStmId = objStmId + 1

  const head = Buffer.from('%PDF-1.5\n', 'latin1')
  const objStmHeader = Buffer.from(
    `${objStmId} 0 obj\n<< /Type /ObjStm /N ${bodies.length} /First ${first} /Filter /FlateDecode /Length ${objStmData.length} >>\nstream\n`,
    'latin1',
  )
  const objStmTail = Buffer.from('\nendstream\nendobj\n', 'latin1')
  const objStmOffset = head.length

  // 交叉引用流：type2 条目指向 ObjStm 内的索引
  const rows: number[][] = [[0, 0, 65535]]
  bodies.forEach(([, ], idx) => rows.push([2, objStmId, idx]))
  const xrefStmOffset = objStmOffset + objStmHeader.length + objStmData.length + objStmTail.length
  rows.push([1, objStmOffset, 0]) // ObjStm 自身
  rows.push([1, xrefStmOffset, 0]) // xref 流自身
  const w = [1, 4, 2]
  const xrefRaw = Buffer.concat(
    rows.map(([t, a, b]) => {
      const buf = Buffer.alloc(w[0]! + w[1]! + w[2]!)
      buf.writeUInt8(t!, 0)
      buf.writeUInt32BE(a!, 1)
      buf.writeUInt16BE(b!, 5)
      return buf
    }),
  )
  const xrefData = deflateSync(xrefRaw)
  const size = xrefStmId + 1
  const xrefStm = Buffer.concat([
    Buffer.from(
      `${xrefStmId} 0 obj\n<< /Type /XRef /Size ${size} /W [${w.join(' ')}] /Root ${catalogId} 0 R /Filter /FlateDecode /Length ${xrefData.length} >>\nstream\n`,
      'latin1',
    ),
    xrefData,
    Buffer.from('\nendstream\nendobj\n', 'latin1'),
  ])
  return Buffer.concat([
    head,
    objStmHeader,
    objStmData,
    objStmTail,
    xrefStm,
    Buffer.from(`startxref\n${xrefStmOffset}\n%%EOF\n`, 'latin1'),
  ])
}

async function verifyPageCounts(): Promise<void> {
  console.log('\n[2] resolvePdfPageCount —— 压缩对象流 / 损坏文件')

  for (const n of [1, 3, 30]) {
    const buf = plainPdf(n)
    check(`明文页对象 ${n} 页 → 识别 ${await resolvePdfPageCount(buf)}`, (await resolvePdfPageCount(buf)) === n)
  }

  for (const n of [3, 30]) {
    const buf = objectStreamPdf(n)
    // 前提校验：这份素材确实骗得过字节扫描，否则这条用例没有意义
    check(`压缩对象流 ${n} 页素材确实无法被字节扫描识别`, countPdfPages(buf) === null, `字节扫描得到 ${countPdfPages(buf)}`)
    const got = await resolvePdfPageCount(buf)
    check(`压缩对象流 ${n} 页 → 识别 ${got}`, got === n, `期望 ${n}`)
  }

  // 损坏：截断到一半。字节扫描会数出一个「看着合理」的数，必须 fail-closed。
  const whole = plainPdf(3)
  const truncated = whole.subarray(0, Math.floor(whole.length / 2))
  const scanGuess = countPdfPages(truncated)
  check('截断 PDF 素材确实会让字节扫描猜出一个数', scanGuess !== null && scanGuess !== 3, `字节扫描得到 ${scanGuess}`)
  check(
    `截断 PDF fail-closed（不回落字节扫描的 ${scanGuess}）`,
    (await resolvePdfPageCount(truncated)) === null,
    `实得 ${await resolvePdfPageCount(truncated)}`,
  )

  check('非 PDF 字节 → null', (await resolvePdfPageCount(Buffer.from('not a pdf at all'))) === null)
  check('空 buffer → null', (await resolvePdfPageCount(Buffer.alloc(0))) === null)
}

// ── 3 & 4. 上限文案 ───────────────────────────────────────────────────────────

function verifyLimitCopy(): void {
  console.log('\n[3] 超限文案面向终端用户')
  const effectiveMaxBytes = Math.min(PURPOSE_POLICY.print_doc.maxBytes, PROXY_MAX_BYTES)
  const res = validateUpload({
    purpose: 'print_doc',
    mimeType: 'image/png',
    filename: 'big.png',
    sizeBytes: effectiveMaxBytes + 1024 * 1024,
    mode: 'proxy',
  })
  check('超限被拒', res.ok === false && res.code === 'FILE_TOO_LARGE')
  const message = res.ok === false ? res.message : ''
  check(`文案含实际生效上限 ${Math.round(effectiveMaxBytes / 1024 / 1024)}MB`, message.includes(`${Math.round(effectiveMaxBytes / 1024 / 1024)}MB`), message)
  check('文案告知文件实际大小', /\d+(\.\d+)?MB，/.test(message), message)
  check('文案不出现内部实现词「直传」', !message.includes('直传'), message)
  check('文案给出可执行下一步', /压缩|分成|重试/.test(message), message)

  console.log('\n[4] kiosk 上传页展示的上限 == 服务端实际生效上限')
  const uploadPage = readFileSync(
    join(__dirname, '../../../apps/kiosk/src/pages/print/PrintUploadPage.tsx'),
    'utf8',
  )
  const declared = uploadPage.match(/export const PRINT_UPLOAD_MAX_MB\s*=\s*(\d+)/)
  check('kiosk 导出了 PRINT_UPLOAD_MAX_MB 常量', Boolean(declared))
  if (declared) {
    check(
      `kiosk 声明 ${declared[1]}MB == 服务端 ${Math.round(effectiveMaxBytes / 1024 / 1024)}MB`,
      Number(declared[1]) === Math.round(effectiveMaxBytes / 1024 / 1024),
    )
  }
  // 页面**渲染文案**里不得再出现手抄的、与实际生效上限不一致的 MB 数字。
  // 只看代码，不看注释——注释里引用历史错误文案（如本轮的修复说明）是正当的。
  const uploadPageCode = uploadPage
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1')
  const strayLimits = [...uploadPageCode.matchAll(/不超过\s*(\d+)\s*MB/g)].map((m) => Number(m[1]))
  check(
    '页面无手抄且与实际不符的上限数字',
    strayLimits.every((v) => v === Math.round(effectiveMaxBytes / 1024 / 1024)),
    `发现 ${JSON.stringify(strayLimits)}`,
  )
}

function verifyBlankPageCopy(): void {
  console.log('\n[5] 疑似空白页文案：可读 + 交代扫描范围')
  check('短列表逐个列出', formatPageRanges([1, 3, 5]) === '1、3、5', formatPageRanges([1, 3, 5]))
  const long = formatPageRanges([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])
  check('长连续列表折叠成区间', long === '1-10', long)
  const mixed = formatPageRanges([1, 2, 3, 5, 7, 8, 9, 12])
  check('混合列表按区间折叠', mixed === '1-3、5、7-9、12', mixed)
  check('乱序去重后仍正确', formatPageRanges([3, 1, 2, 2]) === '1、2、3', formatPageRanges([3, 1, 2, 2]))

  const twentyOfThirty = describeBlankPages(Array.from({ length: 20 }, (_, i) => i + 1), 30, 20)
  check('不再逐个罗列 20 个页码', !twentyOfThirty.includes('、10、'), twentyOfThirty)
  check('只扫了一部分时交代扫描范围', /仅检查前 20 页，共 30 页/.test(twentyOfThirty), twentyOfThirty)
  const fullyScanned = describeBlankPages([2], 3, 3)
  check('全部扫完时不加范围说明', !fullyScanned.includes('仅检查'), fullyScanned)
  const unknownTotal = describeBlankPages([2], null, 2)
  check('页数未识别时不编造总页数', !unknownTotal.includes('共'), unknownTotal)
}

async function main(): Promise<void> {
  await verifyPageCounts()
  verifyLimitCopy()
  verifyBlankPageCopy()
  console.log(`\n=== verify:file-display-truth — ${passed} PASS / ${failed} FAIL ===`)
  if (failed > 0) process.exit(1)
}

void main()
