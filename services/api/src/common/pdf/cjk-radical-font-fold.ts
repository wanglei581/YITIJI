// 按字体把 PDF 文字层里的错映射换回本字（2026-10-12）。
//
// 全局对照表按「部首长得像哪个常用字」来换。苹方里「又」存成 U+2F1C、「干」存成 U+2F32，这样换是对的。
// 宋体-简、华文宋体、黑体-简不是：同一个部首存的是另一个字。不能在全局表里加例外，只能看这一段用的字体。
//
// 实测：本机 quartz.js（NSTextView dataWithPDFInsideRect，和「打印成 PDF」同一套排版）把 GB2312
// 全部 6763 字打成 PDF，再用本仓库 openUnpdfDocument + extractPdfTextItems 读文字层。测过的字重：
// PingFangSC（Ultralight/Thin/Light/Regular/Medium/Semibold）、STSongti-SC（Light/Regular/Bold/Black）、
// STSong、STHeitiSC（Light/Medium）、STHeiti、STXihei、HiraginoSansGB（W3/W6）、STKaitiSC
// （Regular/Bold/Black）、STKaiti、STFangsong、STYuanti-SC（Light/Regular/Bold）、FZLTXHK/ZHK/THK--GBK1-0、
// SimSong（Regular/Bold）、STBaoliSC-Regular、STLibianSC-Regular、HannotateSC-W5、HanziPenSC-W3、
// WeibeiSC-Bold、STXingkaiSC-Light、DFWaWaSC-W5、YuppySC-Regular、ArialUnicodeMS。
// 没在上面出现的字体不进表。娃娃体 DFWaWaSC-W5 是整张编码表错位，不是个别字，不进表。
//
// 前缀以「-」结尾才按开头匹配，否则整名相等；多个命中取最长。这样 STSong 不会套上 STSong-Light
// 或 STSongti-SC-，STHeiti 也不会套上 STHeitiSC-。宋体-简的黑实测是齐的，前缀套上去只在替身真出现时才换。
// 表里 U+303A、U+3038、U+312A 不在部首区，是同一轮读出来的映射错。触发看表里的键，否则这三对换不到。

import { Logger } from '@nestjs/common'
import type { PdfTextItem } from './pdfjs-document'

const logger = new Logger('CjkRadicalFontFold')

const SUBSET_PREFIX = /^[A-Z]{6}\+/

interface FontException {
  key: string
  pairs: ReadonlyArray<readonly [string, string]>
}

const FONT_EXCEPTIONS: readonly FontException[] = [
  { key: 'PingFangSC-', pairs: [['\u2E95', '彐']] },
  { key: 'STSongti-SC-', pairs: [['\u2F1C', '口'], ['\u303A', '卅']] },
  { key: 'STSong', pairs: [['\u2F1C', '口'], ['\u303A', '卅']] },
  {
    key: 'STHeitiSC-',
    pairs: [['\u2F32', '广'], ['\u2EB4', '网'], ['\u2FB6', '飘'], ['\u2EBD', '臼']],
  },
  { key: 'STKaitiSC-', pairs: [['\u303A', '卅']] },
  { key: 'STKaiti', pairs: [['\u303A', '卅']] },
  { key: 'STYuanti-SC-', pairs: [['\u3038', '十'], ['\u303A', '卅']] },
  { key: 'STBaoliSC-Regular', pairs: [['\u2F87', '舜'], ['\u312A', '万'], ['\u303A', '卅']] },
  { key: 'STLibianSC-Regular', pairs: [['\u2F87', '舜'], ['\u312A', '万'], ['\u303A', '卅']] },
  { key: 'STXingkaiSC-Light', pairs: [['\u303A', '卅']] },
]

const MAPS = FONT_EXCEPTIONS.map((entry) => ({ key: entry.key, map: new Map(entry.pairs) }))

const EXCEPTION_CHARS = new Set(FONT_EXCEPTIONS.flatMap((entry) => entry.pairs.map(([from]) => from)))

export function cjkRadicalFontExceptionPairs(): Array<{ fontKey: string; from: string; to: string }> {
  return FONT_EXCEPTIONS.flatMap((entry) => entry.pairs.map(([from, to]) => ({ fontKey: entry.key, from, to })))
}

function hasExceptionChar(text: string): boolean {
  return Array.from(text).some((ch) => EXCEPTION_CHARS.has(ch))
}

function mapForFont(name: string): ReadonlyMap<string, string> | undefined {
  const bare = name.replace(SUBSET_PREFIX, '')
  let best: { key: string; map: ReadonlyMap<string, string> } | undefined
  for (const entry of MAPS) {
    const hit = entry.key.endsWith('-') ? bare.startsWith(entry.key) : bare === entry.key
    if (!hit) continue
    if (!best || entry.key.length > best.key.length) best = entry
  }
  return best?.map
}

function applyMap(text: string, map: ReadonlyMap<string, string>): { text: string; changed: number } {
  if (!Array.from(text).some((ch) => map.has(ch))) return { text, changed: 0 }
  let changed = 0
  const next = Array.from(text).map((ch) => {
    const to = map.get(ch)
    if (to === undefined || to === ch) return ch
    changed += 1
    return to
  }).join('')
  return { text: next, changed }
}

interface TextContentItem {
  str?: string
  fontName?: string
}

interface FontFoldPage {
  getTextContent(): Promise<{ items?: TextContentItem[] }>
  getOperatorList(): Promise<unknown>
  commonObjs?: {
    has?(id: string): boolean
    get(id: string): { name?: unknown } | undefined
  }
}

export interface FontFoldDocument {
  numPages?: number
  getPage(pageNumber: number): Promise<FontFoldPage>
}

export interface FontFoldOutcome {
  items: PdfTextItem[][]
  fontFoldChars: number
  fontFoldMismatchPages: number
}

function fontBaseName(page: FontFoldPage, fontKey: string | undefined): string {
  if (!fontKey || !page.commonObjs) return ''
  const objs = page.commonObjs
  if (typeof objs.has === 'function' && !objs.has(fontKey)) return ''
  const data = objs.get(fontKey)
  const name = data && typeof data.name === 'string' ? data.name : ''
  return name.replace(SUBSET_PREFIX, '')
}

/** 与 unpdf getPageTextItems 相同：留下 str 不是 null/undefined 的项（含空串），丢掉标记内容。 */
function visibleItems(content: { items?: TextContentItem[] } | undefined): TextContentItem[] {
  return (content?.items ?? []).filter((item) => item.str != null)
}

/**
 * 用 extractPdfTextItems 的条目做底，只替换 str。
 * 某一页两边条数对不上：这一页不改，也不去查字体。
 * 这一页的文字里没有例外表的键：不调 getOperatorList。
 */
export async function foldPdfTextItemsByFont(
  pdf: FontFoldDocument,
  items: readonly (readonly PdfTextItem[])[],
): Promise<FontFoldOutcome> {
  const next = items.map((page) => page.map((item) => ({ ...item })))
  let fontFoldChars = 0
  let fontFoldMismatchPages = 0
  const pageCount = typeof pdf.numPages === 'number' ? pdf.numPages : items.length
  const limit = Math.max(pageCount, items.length)
  for (let index = 0; index < limit; index += 1) {
    if (index >= pageCount || index >= next.length) {
      fontFoldMismatchPages += 1
      continue
    }
    const page = await pdf.getPage(index + 1)
    const contentItems = visibleItems(await page.getTextContent())
    const extracted = next[index] ?? []
    if (contentItems.length !== extracted.length) {
      fontFoldMismatchPages += 1
      continue
    }
    const pageText = `${contentItems.map((item) => item.str ?? '').join('')}${extracted.map((item) => item.str).join('')}`
    if (!hasExceptionChar(pageText)) continue
    await page.getOperatorList()
    for (let j = 0; j < extracted.length; j += 1) {
      const map = mapForFont(fontBaseName(page, contentItems[j]?.fontName))
      if (!map) continue
      const item = extracted[j]
      if (!item) continue
      const applied = applyMap(item.str, map)
      extracted[j] = { ...item, str: applied.text }
      fontFoldChars += applied.changed
    }
  }
  if (fontFoldMismatchPages > 0) logger.log(JSON.stringify({ fontFoldMismatchPages }))
  return { items: next, fontFoldChars, fontFoldMismatchPages }
}
