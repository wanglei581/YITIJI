import { PolicyKeywordTooLongError, type PublishedPoliciesResult } from '../../services/api/policies'
import { policyRead } from './policyModel'

/** 关键词字数与服务端 POLICY_KEYWORD_MAX_LENGTH 同一口径：去首尾空白后的字符串长度。 */
export const POLICY_KEYWORD_MAX_LENGTH = 30
/** 和 policyRead 同一个 8 秒。到点没回来就按没连上，不一直停在正在找。 */
export const POLICY_SEARCH_TIMEOUT_MS = 8_000

/** 组字区间，下标与 input 选区一样，按 UTF-16 代码单元，end 不含。 */
export type PolicyCompositionSpan = {
  start: number
  end: number
}

/**
 * 由 compositionstart 记下的起点，和 compositionupdate 当时的选区，得到组字区间。
 * 选区盖住整段拼音时用选区；光标收在拼音末尾时，区间就在光标前；否则用组字开始时的起点。
 */
export function policyCompositionSpan(
  value: string,
  composition: string,
  selectionStart: number | null,
  selectionEnd: number | null,
  anchor: number | null,
): PolicyCompositionSpan | null {
  if (!composition) return null
  if (selectionStart !== null && selectionEnd !== null && selectionEnd > selectionStart
    && value.slice(selectionStart, selectionEnd) === composition) {
    return { start: selectionStart, end: selectionEnd }
  }
  if (selectionEnd !== null) {
    const start = selectionEnd - composition.length
    if (start >= 0 && value.slice(start, selectionEnd) === composition) return { start, end: selectionEnd }
  }
  if (anchor !== null && anchor >= 0) {
    const end = anchor + composition.length
    if (end <= value.length && value.slice(anchor, end) === composition) return { start: anchor, end }
  }
  return null
}

function withoutCompositionSpan(value: string, span: PolicyCompositionSpan): string | null {
  const { start, end } = span
  if (!Number.isInteger(start) || !Number.isInteger(end)) return null
  if (start < 0 || end <= start || end > value.length) return null
  return value.slice(0, start) + value.slice(end)
}

/**
 * 拼音还在候选栏里时，输入框的 value 带了未选的字母。
 * 有组字区间就按区间扣，区间可以在词的任何位置。没有区间时，这段拼音只出现一次就扣掉。
 */
export function committedKeyword(value: string, composition = '', span?: PolicyCompositionSpan | null): string {
  if (span) {
    const stripped = withoutCompositionSpan(value, span)
    if (stripped !== null) return stripped
  }
  if (!composition) return value
  const at = value.indexOf(composition)
  if (at < 0) return value
  const later = value.indexOf(composition, at + composition.length)
  const cut = later >= 0 && value.endsWith(composition) ? value.length - composition.length : at
  return value.slice(0, cut) + value.slice(cut + composition.length)
}

export function policyKeywordCount(value: string, composition = '', span?: PolicyCompositionSpan | null): number {
  return committedKeyword(value, composition, span).trim().length
}

export function isPolicyKeywordTooLong(error: unknown): boolean {
  return error instanceof PolicyKeywordTooLongError
    || (typeof error === 'object' && error !== null && (error as { code?: string }).code === 'POLICY_KEYWORD_TOO_LONG')
}

export type PolicySearchOutcome =
  | { status: 'idle' }
  | { status: 'too-long'; count: number; keyword: string }
  | { status: 'ready'; result: PublishedPoliciesResult; keyword: string }
  | { status: 'failed'; keyword: string }

/** 去掉首尾空白后是空的、或超过 30 字，都不发请求。400 超长不当成没连上。 */
export async function resolvePolicySearch(
  keyword: string,
  request: (word: string) => Promise<PublishedPoliciesResult>,
  timeoutMs = POLICY_SEARCH_TIMEOUT_MS,
): Promise<PolicySearchOutcome> {
  const word = keyword.trim()
  if (!word) return { status: 'idle' }
  if (word.length > POLICY_KEYWORD_MAX_LENGTH) return { status: 'too-long', count: word.length, keyword: word }
  try {
    const result = await policyRead(request(word), timeoutMs)
    return { status: 'ready', result, keyword: word }
  } catch (error) {
    if (isPolicyKeywordTooLong(error)) return { status: 'too-long', count: word.length, keyword: word }
    return { status: 'failed', keyword: word }
  }
}

/** 北京时间的日历日。截止日期当天仍算有效，过了这一天才算过了。 */
export function beijingToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now)
}

export function policyDeadlinePassed(validThrough?: string | null, now = new Date()): boolean {
  const day = validThrough?.trim() ?? ''
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false
  return day < beijingToday(now)
}

/** 有截止日期才写。没有就不写，也不写「已过期」。 */
export function policyDeadlineLabel(validThrough?: string | null): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(validThrough?.trim() ?? '')
  if (!match) return undefined
  return `${Number(match[2])} 月 ${Number(match[3])} 日截止`
}

/** 一行大约能放下的字。两行放得下就整段显示，放不下才出「展开全文」。 */
export const POLICY_EXCERPT_LINE_CHARS = 34

export function policyExcerptFits(content: string, lineChars = POLICY_EXCERPT_LINE_CHARS): boolean {
  let visual = 0
  for (const line of content.split(/\r?\n/)) {
    visual += Math.max(1, Math.ceil(Array.from(line).length / lineChars))
    if (visual > 2) return false
  }
  return true
}

/** 去掉空白后的字数，四舍五入到十位。 */
export function policyExcerptAbout(content: string): string {
  const count = Array.from(content.replace(/\s/g, '')).length
  return `约 ${(Math.round(count / 10) * 10).toLocaleString('zh-CN')} 字`
}

/** 阅读框大约能放 23 行，留一行，避免末行被裁。 */
export const POLICY_READ_VISUAL_LINES = 22

/** 按屏高翻。一行放不下就换页；比一整页还长的一行按字切开，不插入换行。 */
export function policyExcerptPages(
  content: string,
  visualLinesPerPage = POLICY_READ_VISUAL_LINES,
  lineChars = POLICY_EXCERPT_LINE_CHARS,
): string[] {
  const budget = Math.max(1, visualLinesPerPage)
  const width = Math.max(1, lineChars)
  const pages: string[] = []
  let page = ''
  let used = 0
  const flush = () => {
    pages.push(page)
    page = ''
    used = 0
  }
  for (const line of content.split('\n')) {
    const chars = Array.from(line)
    const whole = Math.max(1, Math.ceil(chars.length / width))
    if (used > 0 && whole <= budget && used + whole > budget) flush()
    let index = 0
    let first = true
    do {
      if (used >= budget) flush()
      const piece = chars.slice(index, index + (budget - used) * width).join('')
      page += (page && first ? '\n' : '') + piece
      used += Math.max(1, Math.ceil(Array.from(piece).length / width))
      index += Array.from(piece).length
      first = false
    } while (index < chars.length)
  }
  if (pages.length === 0 || page) pages.push(page)
  return pages
}

export type PolicyGoneCopy = {
  title: string
  eyebrow: string
  heading: string
  items: string[]
  note?: string
}

/** 打开时已经 404，和正在看时过了截止日期，是两句不同的话。 */
export function policyGoneCopy(
  kind: 'missing' | 'expired',
  meta?: { sourceName?: string; validThrough?: string } | null,
): PolicyGoneCopy {
  if (kind === 'expired') {
    const when = policyDeadlineLabel(meta?.validThrough)?.replace(/截止$/, '').trim() || '这一天'
    const source = meta?.sourceName?.trim() || '发布机构未提供'
    return {
      title: '这条政策已过截止日期',
      eyebrow: `${source}发布 · ${policyDeadlineLabel(meta?.validThrough) ?? '截止日期未提供'}`,
      heading: `${when}已截止`,
      items: [
        `发布机构写的截止日期是 ${when}，过了这一天，这里不再显示`,
        '不再显示正文、原文二维码和办事清单',
        '还要办理的，以发布机构原文和官方渠道为准',
      ],
    }
  }
  return {
    title: '这条政策现在看不到了',
    eyebrow: '查政策',
    heading: '可能是这几种情况',
    items: [
      '发布机构写的截止日期已经过了',
      '发布机构已经撤下这一条',
      '这一条不在本机的显示范围里',
    ],
    note: '不再显示旧正文、原文二维码和办事清单。',
  }
}

/** 按字面切分，不把关键词当正则。标出的是文字节点，不插入原文里的标签。 */
export function policyKeywordMarks(text: string, keyword: string): Array<{ text: string; hit: boolean }> {
  const word = keyword.trim()
  if (!word) return [{ text, hit: false }]
  const parts: Array<{ text: string; hit: boolean }> = []
  let rest = text
  while (rest.length > 0) {
    const at = rest.indexOf(word)
    if (at < 0) {
      parts.push({ text: rest, hit: false })
      break
    }
    if (at > 0) parts.push({ text: rest.slice(0, at), hit: false })
    parts.push({ text: word, hit: true })
    rest = rest.slice(at + word.length)
  }
  return parts
}
