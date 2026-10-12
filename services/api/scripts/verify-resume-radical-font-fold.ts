/**
 * 部首字符按字体换（F-24 续，2026-10-12）。
 * 接在 verify-resume-radical-fold.ts 后面跑。前一个脚本的 75 条一条不改。
 *
 * 假的 pdf 对象自己写 getPage / getTextContent / getOperatorList / commonObjs。
 * 真引擎用仓库里现有的 PDF 夹具，字体例外前后拼出来的文字逐字相同。
 * 不把实测用的 HTML、PDF、字体放进仓库。
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { Logger } from '@nestjs/common'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import { foldCjkRadicals, foldCjkRadicalsInJsonText } from '../src/common/text/cjk-radical-fold'
import {
  cjkRadicalFontExceptionPairs,
  foldPdfTextItemsByFont,
  type FontFoldDocument,
} from '../src/common/pdf/cjk-radical-font-fold'
import { extractPdfTextItems, openUnpdfDocument, type PdfTextItem } from '../src/common/pdf/pdfjs-document'
import { ResumeExtractionService } from '../src/ai/resume/resume-extraction.service'
import { LlmResumeOptimizeService } from '../src/ai/resume/llm-resume-optimize.service'
import type { ResumeReport } from '../src/ai/interfaces/ai-provider.interface'

let passCount = 0
let failCount = 0
function pass(msg: string) { passCount += 1; console.log(`  PASS ${msg}`) }
function fail(msg: string) { failCount += 1; console.error(`  FAIL ${msg}`) }
function check(ok: boolean, msg: string) { if (ok) pass(msg); else fail(msg) }

const logLines: string[] = []
const collect = (message: unknown) => { logLines.push(typeof message === 'string' ? message : JSON.stringify(message)) }
Logger.overrideLogger({ log: collect, warn: collect, error: collect, debug: collect, verbose: collect, fatal: collect })

const RADICAL_BLOCK = /[\u2E80-\u2FDF]/u

/** 2026-10-12 GB2312 全部 6763 字实测里，换完不等于原字、并且收进例外表的每一对。期望值写死在这里。 */
const MEASURED: ReadonlyArray<{ key: string; font: string; from: string; to: string }> = [
  { key: 'PingFangSC-', font: 'PingFangSC-Regular', from: '\u2E95', to: '彐' },
  { key: 'PingFangSC-', font: 'PingFangSC-Semibold', from: '\u2E95', to: '彐' },
  { key: 'STSongti-SC-', font: 'STSongti-SC-Regular', from: '\u2F1C', to: '口' },
  { key: 'STSongti-SC-', font: 'STSongti-SC-Bold', from: '\u2F1C', to: '口' },
  { key: 'STSongti-SC-', font: 'STSongti-SC-Black', from: '\u2F1C', to: '口' },
  { key: 'STSongti-SC-', font: 'STSongti-SC-Regular', from: '\u303A', to: '卅' },
  { key: 'STSong', font: 'STSong', from: '\u2F1C', to: '口' },
  { key: 'STSong', font: 'STSong', from: '\u303A', to: '卅' },
  { key: 'STHeitiSC-', font: 'ABCDEF+STHeitiSC-Light', from: '\u2F32', to: '广' },
  { key: 'STHeitiSC-', font: 'ABCDEF+STHeitiSC-Light', from: '\u2EB4', to: '网' },
  { key: 'STHeitiSC-', font: 'ABCDEF+STHeitiSC-Light', from: '\u2FB6', to: '飘' },
  { key: 'STHeitiSC-', font: 'ABCDEF+STHeitiSC-Light', from: '\u2EBD', to: '臼' },
  { key: 'STHeitiSC-', font: 'STHeitiSC-Medium', from: '\u2F32', to: '广' },
  { key: 'STKaitiSC-', font: 'STKaitiSC-Regular', from: '\u303A', to: '卅' },
  { key: 'STKaiti', font: 'STKaiti', from: '\u303A', to: '卅' },
  { key: 'STYuanti-SC-', font: 'STYuanti-SC-Regular', from: '\u3038', to: '十' },
  { key: 'STYuanti-SC-', font: 'STYuanti-SC-Regular', from: '\u303A', to: '卅' },
  { key: 'STBaoliSC-Regular', font: 'STBaoliSC-Regular', from: '\u2F87', to: '舜' },
  { key: 'STBaoliSC-Regular', font: 'STBaoliSC-Regular', from: '\u312A', to: '万' },
  { key: 'STBaoliSC-Regular', font: 'STBaoliSC-Regular', from: '\u303A', to: '卅' },
  { key: 'STLibianSC-Regular', font: 'STLibianSC-Regular', from: '\u2F87', to: '舜' },
  { key: 'STLibianSC-Regular', font: 'STLibianSC-Regular', from: '\u312A', to: '万' },
  { key: 'STLibianSC-Regular', font: 'STLibianSC-Regular', from: '\u303A', to: '卅' },
  { key: 'STXingkaiSC-Light', font: 'STXingkaiSC-Light', from: '\u303A', to: '卅' },
]

interface ContentItem { str?: string; fontName?: string }
interface PageSpec { content: ContentItem[]; extracted: string[]; fonts: Record<string, string> }

function textItem(str: string): PdfTextItem {
  return { str, x: 10, y: 700, width: 12, height: 12, fontSize: 12, hasEOL: false }
}

function makePdf(pages: PageSpec[]) {
  let operatorCalls = 0
  const pdf: FontFoldDocument = {
    numPages: pages.length,
    async getPage(pageNumber: number) {
      const spec = pages[pageNumber - 1]!
      return {
        async getTextContent() {
          return { items: spec.content.map((item) => ({ ...item })) }
        },
        async getOperatorList() {
          operatorCalls += 1
          return {}
        },
        commonObjs: {
          has: (id: string) => Object.prototype.hasOwnProperty.call(spec.fonts, id),
          get: (id: string) => ({ name: spec.fonts[id] }),
        },
      }
    },
  }
  const items = pages.map((page) => page.extracted.map(textItem))
  return { pdf, items, operatorCalls: () => operatorCalls }
}

function onePage(str: string, font: string, fontName = 'f1'): PageSpec {
  return { content: [{ str, fontName }], extracted: [str], fonts: { [fontName]: font } }
}

async function foldedStr(str: string, font: string): Promise<{ text: string; chars: number; calls: number }> {
  const fake = makePdf([onePage(str, font)])
  const out = await foldPdfTextItemsByFont(fake.pdf, fake.items)
  return { text: out.items[0]?.[0]?.str ?? '', chars: out.fontFoldChars, calls: fake.operatorCalls() }
}

async function fontChecks(): Promise<void> {
  const exported = cjkRadicalFontExceptionPairs()
  const unique = new Map(MEASURED.map((item) => [`${item.key}\0${item.from}\0${item.to}`, item]))
  const samePairs = exported.length === unique.size
    && [...unique.values()].every((item) => exported.some((row) => row.fontKey === item.key && row.from === item.from && row.to === item.to))
    && exported.every((row) => unique.has(`${row.fontKey}\0${row.from}\0${row.to}`))
  check(samePairs, `例外表正好是实测收进来的 ${unique.size} 对，没有多收（实际 ${exported.length} 对）`)
  check(!exported.some((row) => row.fontKey.includes('DFWaWa')), '娃娃体整张编码表错位，不在例外表里')

  for (const item of MEASURED) {
    const out = await foldedStr(item.from, item.font)
    check(out.text === item.to && out.chars === 1 && out.calls === 1,
      `${item.font}：${item.from}（U+${item.from.codePointAt(0)?.toString(16).toUpperCase()}）换成 ${item.to}`)
  }

  const heiti = '\u2F32\u2EB4\u2FB6\u2EBD'
  const heitiOut = await foldedStr(heiti, 'ABCDEF+STHeitiSC-Light')
  check(heitiOut.text === '广网飘臼' && heitiOut.chars === 4 && heitiOut.calls === 1,
    '字体真名 ABCDEF+STHeitiSC-Light：⼲ ⺴ ⾶ ⺽ 变成 广 网 飘 臼')
  const medium = await foldedStr(heiti, 'STHeitiSC-Medium')
  check(medium.text === '广网飘臼' && medium.chars === 4, '黑体-简的另一个字重 STHeitiSC-Medium 同一套')

  const ping = await foldedStr(heiti, 'PingFangSC-Regular')
  check(ping.text === heiti && ping.chars === 0, '同样四个字符在 PingFangSC-Regular 下按字体不换')
  check(foldCjkRadicals(ping.text) === '干冗飛\u2EBD', '之后整表换成 干、冗、飛；⺽ 仍不在整表里，原样留下')

  const song = await foldedStr('\u2F1C', 'STSongti-SC-Regular')
  const pingAgain = await foldedStr('\u2F1C', 'PingFangSC-Regular')
  check(song.text === '口', 'STSongti-SC-Regular 下 ⼜ 换成 口')
  check(pingAgain.text === '\u2F1C' && foldCjkRadicals(pingAgain.text) === '又', 'PingFangSC-Regular 下 ⼜ 按字体不换，整表仍换成 又')

  const unknown = await foldedStr(heiti, 'TotallyUnknownFont')
  check(unknown.text === heiti && unknown.chars === 0, '不认识的字体不变')
  const heitiFamily = await foldedStr('\u2F32', 'STHeiti')
  check(heitiFamily.text === '\u2F32', 'STHeiti 不套用 STHeitiSC- 的例外')
  const songLight = await foldedStr('\u2F1C', 'STSong-Light')
  check(songLight.text === '\u2F1C', 'STSong-Light 不套用 STSong 的例外')

  const quiet = makePdf([onePage('\u2ED8岛广东', 'PingFangSC-Regular')])
  const quietOut = await foldPdfTextItemsByFont(quiet.pdf, quiet.items)
  check(quiet.operatorCalls() === 0 && quietOut.items[0]?.[0]?.str === '\u2ED8岛广东' && quietOut.fontFoldChars === 0,
    '页里没有例外字符时 getOperatorList 一次都没被调')
  const loud = makePdf([onePage('\u2F32', 'ABCDEF+STHeitiSC-Light')])
  await foldPdfTextItemsByFont(loud.pdf, loud.items)
  check(loud.operatorCalls() === 1, '有例外字符时 getOperatorList 被调了')

  const marked = makePdf([{
    content: [{ str: '\u2F32', fontName: 'f1' }, { fontName: 'mark' }, { str: '东', fontName: 'f1' }],
    extracted: ['\u2F32', '东'],
    fonts: { f1: 'ABCDEF+STHeitiSC-Light' },
  }])
  const markedOut = await foldPdfTextItemsByFont(marked.pdf, marked.items)
  check(markedOut.fontFoldMismatchPages === 0 && markedOut.items[0]?.map((item) => item.str).join('') === '广东',
    '没有 str 的标记内容不占一条，和 unpdf 滤完之后仍能对上并换字')
  const blanks = makePdf([{
    content: [{ str: '', fontName: 'f1' }, { str: '\u2F32', fontName: 'f1' }],
    extracted: ['', '\u2F32'],
    fonts: { f1: 'ABCDEF+STHeitiSC-Light' },
  }])
  const blankOut = await foldPdfTextItemsByFont(blanks.pdf, blanks.items)
  check(blankOut.fontFoldMismatchPages === 0 && blankOut.items[0]?.map((item) => item.str).join('|') === '|广',
    '空串留在条目里，不因为滤掉空串而把这一页判成对不齐')

  logLines.length = 0
  const mismatch = makePdf([
    onePage('\u2F1C', 'STSong'),
    {
      content: [
        { str: 'SENTINEL_MISMATCH_TEXT\u2F32', fontName: 'f1' },
        { str: 'SECOND', fontName: 'f1' },
      ],
      extracted: ['SENTINEL_MISMATCH_TEXT\u2F32'],
      fonts: { f1: 'DO_NOT_LOG_THIS_FONT' },
    },
  ])
  const mismatchOut = await foldPdfTextItemsByFont(mismatch.pdf, mismatch.items)
  const mismatchLog = logLines.find((line) => line.includes('fontFoldMismatchPages')) ?? ''
  check(mismatchOut.items[0]?.[0]?.str === '口' && mismatchOut.items[1]?.[0]?.str === 'SENTINEL_MISMATCH_TEXT\u2F32'
    && mismatchOut.fontFoldMismatchPages === 1 && mismatch.operatorCalls() === 1,
    '条数对不上的那一页不改，另一页照常换')
  check(mismatchLog.includes('"fontFoldMismatchPages":1') && !mismatchLog.includes('SENTINEL_MISMATCH_TEXT')
    && !mismatchLog.includes('DO_NOT_LOG_THIS_FONT') && !RADICAL_BLOCK.test(mismatchLog),
    '对不齐的页数记在日志里，日志不含原文，也不含字体名')
}

function joined(items: readonly (readonly PdfTextItem[])[]): string {
  return items.map((page) => page.map((item) => item.str).join('')).join('\n')
}

async function compareOpened(label: string, data: Uint8Array): Promise<void> {
  const pdf = await openUnpdfDocument<FontFoldDocument & { destroy?: () => Promise<void> }>(data)
  try {
    const extracted = await extractPdfTextItems(pdf)
    const folded = await foldPdfTextItemsByFont(pdf, extracted.items)
    check(joined(extracted.items) === joined(folded.items) && folded.fontFoldMismatchPages === 0,
      `${label}：字体例外前后拼出来的文字逐字相同，没有对不齐的页`)
  } finally {
    await pdf.destroy?.()
  }
}

async function buildTextLayerPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([595, 842])
  const lines = [
    'Engine check line one ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789',
    'Engine check line two abcdefghijklmnopqrstuvwxyz 9876543210',
    'Engine check line three contract review text layer sample',
  ]
  lines.forEach((line, index) => page.drawText(line, { x: 48, y: 780 - index * 28, size: 14, font }))
  return doc.save()
}

function buildHeitiRadicalPdf(): Buffer {
  const cmap = [
    '/CIDInit /ProcSet findresource begin',
    '12 dict begin',
    'begincmap',
    '/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def',
    '/CMapName /Adobe-Identity-UCS def',
    '/CMapType 2 def',
    '1 begincodespacerange',
    '<0000> <FFFF>',
    'endcodespacerange',
    '1 beginbfchar',
    '<0001> <2F32>',
    'endbfchar',
    'endcmap',
    'CMapName currentdict /CMap defineresource pop',
    'end',
    'end',
  ].join('\n')
  const content = [
    'BT',
    '/F1 12 Tf',
    '72 720 Td',
    '(Engine check line one ABCDEFGHIJKLMNOPQRSTUVWXYZ 0123456789) Tj',
    '/F2 12 Tf',
    '0 -20 Td',
    '<0001> Tj',
    'ET',
  ].join('\n')
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>',
    `<< /Length ${Buffer.byteLength(content, 'utf8')} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type0 /BaseFont /STHeitiSC-Light /Encoding /Identity-H /DescendantFonts [7 0 R] /ToUnicode 8 0 R >>',
    '<< /Type /Font /Subtype /CIDFontType2 /BaseFont /STHeitiSC-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /DW 1000 /CIDToGIDMap /Identity >>',
    `<< /Length ${Buffer.byteLength(cmap, 'utf8')} >>\nstream\n${cmap}\nendstream`,
  ]
  const header = '%PDF-1.4\n'
  let body = header
  const offsets: number[] = []
  objects.forEach((obj, index) => {
    offsets.push(Buffer.byteLength(body, 'utf8'))
    body += `${index + 1} 0 obj\n${obj}\nendobj\n`
  })
  const xrefStart = Buffer.byteLength(body, 'utf8')
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  offsets.forEach((offset) => { xref += `${String(offset).padStart(10, '0')} 00000 n \n` })
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`
  return Buffer.from(body + xref + trailer, 'utf8')
}

async function engineChecks(): Promise<void> {
  const root = path.join(__dirname, '../fixtures')
  await compareOpened('fixtures/zh-cmap.pdf', new Uint8Array(readFileSync(path.join(root, 'zh-cmap.pdf'))))
  await compareOpened('fixtures/ccitt-g4-scan.pdf', new Uint8Array(readFileSync(path.join(root, 'ccitt-g4-scan.pdf'))))
  await compareOpened('pdf-lib 英文文字层（与 verify:pdfjs-engine 同一份三行，脚本里现生成）', await buildTextLayerPdf())

  logLines.length = 0
  const buffer = buildHeitiRadicalPdf()
  const files = {
    readContentForEndUser: async () => ({
      buffer, mimeType: 'application/pdf', filename: 'resume.pdf', purpose: 'resume_upload' as const,
    }),
  }
  const ocr = { activeProviderName: 'disabled' as const, recognize: async () => ({ ok: false }) }
  const service = new ResumeExtractionService(files as never, ocr as never)
  const extracted = await service.extractResumeText({ fileId: 'file_heiti_font', endUserId: null })
  const okLine = logLines.find((line) => line.includes('extract.ok')) ?? ''
  check(extracted.ok === true && (extracted.text ?? '').includes('广') && !(extracted.text ?? '').includes('\u2F32')
    && !(extracted.text ?? '').includes('干') && (extracted.text ?? '').includes('Engine check line one'),
    '真引擎：黑体-简文字层里的 ⼲ 抽出来是 广，不是整表换成的 干')
  check(okLine.includes('"fontFoldChars":1') && !okLine.includes('STHeiti') && !RADICAL_BLOCK.test(okLine),
    '抽取成功那一行记下按字体改了几个字，不记字体名，也不记原文')
}

const RESUME_PLAIN = [
  '李明远',
  '求职意向：仓储物流专员 · 期望城市：青岛',
  '教育经历',
  '青岛职业技术学院 · 物流管理（大专） 2020.09 – 2023.06',
  '主修课程：仓储与配送管理、运输管理实务、供应链基础',
  '工作经历',
  '青岛海润物流有限公司 · 仓储专员 2023.07 – 2025.08',
  '负责快消品仓约 1200 个库位的日常收货、上架、拣货和发货，日均处理出库单 180 单左右。',
  '每月参与一次全仓盘点，配合主管把账实差异从 0.8% 降到 0.3% 以内。',
  '城阳分拣中心 · 分拣员（实习） 2022.11 – 2023.02',
  '夜班负责小件分拣和装车扫描，熟悉手持终端的收发货操作。',
  '技能与证书',
  '熟练使用 Excel、手持终端。',
  '叉车证（N1，2023 年取得）；物流服务师（四级）；C1 驾照。',
  '自我评价',
  '做事细，账和货对不上会一直查到对上为止。',
].join('\n')

function faithfulOutput(): Record<string, unknown> {
  return {
    resume: {
      basic: { name: '李明远', phone: '', email: '', city: '青岛' },
      intention: { position: '仓储物流专员', city: '青岛' },
      summary: '两年仓库一线经验，做事细致。',
      education: [{ school: '青岛职业技术学院', major: '物流管理', degree: '大专', period: '2020.09 – 2023.06', description: '主修仓储与配送管理、运输管理实务、供应链基础。' }],
      experience: [
        { company: '青岛海润物流有限公司', role: '仓储专员', period: '2023.07 – 2025.08', description: '负责约 1200 个库位的日常收货、上架、拣货和发货，日均处理出库单 180 单左右；每月参与全仓盘点，把账实差异从 0.8% 降到 0.3% 以内。' },
        { company: '城阳分拣中心', role: '分拣员（实习）', period: '2022.11 – 2023.02', description: '夜班负责小件分拣和装车扫描，熟悉手持终端的收发货操作。' },
      ],
      projects: [],
      skills: ['Excel', '手持终端'],
      certificates: ['叉车证（N1，2023 年取得）', '物流服务师（四级）', 'C1 驾照'],
    },
    modules: [],
  }
}

async function modelChecks(): Promise<void> {
  const spaced = '{ "school": "青岛职业技术学院" }'
  check(foldCjkRadicalsInJsonText(spaced) === spaced, '能解析、字符串里没有部首：原样返回，空格不动')
  check(foldCjkRadicalsInJsonText('不是 JSON 的\u2ED8') === '不是 JSON 的青', '解析不了：按纯文本换')

  const config = {
    vendor: 'deepseek', model: 'stub', baseURL: 'http://127.0.0.1/v1', systemPrompt: '', roleScope: '',
    forbiddenWords: [] as string[], temperature: 0.3, enabled: true,
  }
  const service = new LlmResumeOptimizeService({ getApiKey: () => 'verify-key', getConfig: () => config, isReady: () => true } as never)
  let reply = ''
  const prompts: string[] = []
  const savedFetch = globalThis.fetch
  ;(globalThis as { fetch: unknown }).fetch = async (_url: string, init: RequestInit) => {
    prompts.push(String(init.body))
    return { ok: true, status: 200, statusText: 'OK', json: async () => ({ choices: [{ message: { content: reply } }] }) } as Response
  }
  try {
    const escaped = JSON.stringify(faithfulOutput()).replaceAll('青', '\\u2ED8')
    check(escaped.includes('\\u2ED8') && !RADICAL_BLOCK.test(escaped), '阳性对照：模型回复里写的是 \\u2ED8 这六个字符，不是部首本身')
    reply = escaped
    prompts.length = 0
    const result = await service.optimize(RESUME_PLAIN, {
      sections: [
        { key: 'basic', label: '基础信息完整度', score: 8, maxScore: 10 },
        { key: 'experience', label: '经历表达清晰度', score: 6, maxScore: 10 },
      ] as ResumeReport['sections'],
      suggestions: ['经历描述建议动词开头并量化成果'],
    })
    const resume = result.optimizedResume
    const schools = resume.education.map((item) => item.school)
    const companies = resume.experience.map((item) => item.company)
    const certs = resume.certificates
    const packed = JSON.stringify(result)
    check(schools.length === 1 && schools[0] === '青岛职业技术学院'
      && companies.filter((item) => item === '青岛海润物流有限公司').length === 1
      && companies.filter((item) => item === '城阳分拣中心').length === 1
      && certs.filter((item) => item === '叉车证（N1，2023 年取得）').length === 1
      && certs.filter((item) => item === '物流服务师（四级）').length === 1
      && certs.filter((item) => item === 'C1 驾照').length === 1
      && !RADICAL_BLOCK.test(packed),
      '模型用 \\u 转义写「青」：拿得到优化稿，学校、公司、证书各只一次，结果里没有部首字符')

    const radicalReport: ResumeReport = {
      sections: [
        { key: 'basic', label: '基础\u2ED8息完整度', score: 8, maxScore: 10 },
        { key: 'experience', label: '经历表达清晰度', score: 6, maxScore: 10 },
      ] as ResumeReport['sections'],
      suggestions: ['把\u2ED8岛的经历写具体'],
    }
    check(RADICAL_BLOCK.test(radicalReport.suggestions?.[0] ?? '') && RADICAL_BLOCK.test(radicalReport.sections[0]?.label ?? ''),
      '阳性对照：改进建议和栏目名里确实有部首字符')
    reply = JSON.stringify(faithfulOutput())
    prompts.length = 0
    await service.optimize(RESUME_PLAIN, radicalReport)
    check(prompts.length >= 1 && prompts.every((body) => !RADICAL_BLOCK.test(body)),
      '改进建议里带部首字符时，送给假模型的请求正文里一个部首字符都没有')
  } finally {
    ;(globalThis as { fetch: unknown }).fetch = savedFetch
  }
}

async function main(): Promise<void> {
  console.log('\n=== 部首字符按字体换 ===')
  await fontChecks()
  await engineChecks()
  await modelChecks()
  console.log(`\nverify:resume-radical-font-fold ${failCount === 0 ? '通过' : '未通过'}：PASS ${passCount} / FAIL ${failCount}`)
  if (failCount > 0) process.exitCode = 1
}

main().catch((error) => { console.error(error); process.exitCode = 1 })
