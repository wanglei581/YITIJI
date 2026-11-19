/**
 * 排版调整出站：三段先完整遮盖，再把仍然连在一起的 11 位及以上数字换成可还原占位符，
 * 最后在不切开占位符、也不留下数字前缀的位置截断原文。
 * 任一段超过遮盖入口上限就明确失败，不把后半段静默截掉。
 *
 * 残留的长数字走兜底遮盖，不走失败关闭。合同断言会把简历里的日期轴误判成残留，
 * 这里若因 strict 为 false 就回 503，没有证件号的简历也会排不了版。
 * 兜底先把全角数字折成半角。数字段之间隔着空格、制表符、各种短横和点、零宽字符，
 * 或用括号包住其中一段，合计达到 11 位的，按一整串遮。斜线、全角斜线、换行、回车
 * 把数字切成 1 到 8 位的段、合起来不少于 11 位时，也按一整串遮。
 * 这一层在送进引擎之前做，回车还在原文里。简历 JSON 再把相邻的字符串或数值字段接起来遮。
 * 占位符是本次请求才有的标记，用户原文里的形似占位符原样留下。
 * 还原只换还在出站正文里的标记，截断丢掉的号码不会被旧序号装回来。
 */
import { randomBytes } from 'node:crypto'
import { ServiceUnavailableException } from '@nestjs/common'
import { LLM_MASK_INPUT_LIMIT, maskUserTextsForLlmReversible } from '../../common/pii/llm-input-mask'
import { llmMaskPlaceholderPattern } from '../../common/pii/mask-placeholder'
import { isLayoutDateOrTime } from './layout-adjust-digit-dates'
import {
  coverAdjacentJsonValues,
  coverRealisticNumbers,
  createLayoutTokenBook,
  foldDigits,
  layoutTokenPattern,
  shieldLayoutDates,
  type LayoutDigitBook,
} from './layout-adjust-digit-cover'

export const AI_LAYOUT_ADJUST_TOO_LONG = 'AI_LAYOUT_ADJUST_TOO_LONG'
export const AI_LAYOUT_ADJUST_TOO_LONG_MESSAGE =
  '这份简历一次放不下。请先删短一些内容，再试一次；也可以直接按现在的版式导出。'

/**
 * 18 位证件号。末位可以是数字或 X。
 * 号后面紧贴数字，或号前面紧贴数字，遮盖规则的边界都对不上。
 */
const ID_BODY = String.raw`\d{6}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]`
const GLUED_ID_AFTER = new RegExp(`${ID_BODY}(?=\\d)`, 'g')
const GLUED_ID_BEFORE = new RegExp(`(?<=\\d)(?=${ID_BODY})`, 'g')
/** 11 位手机号紧贴后面的数字。只看证件号后面有没有数字，拆不开这种。 */
const GLUED_PHONE_AFTER = /(?<!\d)1[3-9]\d{9}(?=\d)/g

export function separateGluedIdNumbers(text: string, breakWith = '\n'): string {
  return text
    .replace(GLUED_ID_AFTER, (hit) => `${hit}${breakWith}`)
    .replace(GLUED_ID_BEFORE, breakWith)
    .replace(GLUED_PHONE_AFTER, (hit) => `${hit}${breakWith}`)
}

/**
 * 只作遮盖前的边界，出站前会删掉这一串，不删用户正文里的私用区字符。
 * 不用换行：换行写进 JSON 再序列化是反斜杠加字母 n。
 * 实测第二段 18 位号仍会被遮住，但身份证规则的前边界认字母，类别落到银行卡。
 * 这个字符不是数字也不是字母，序列化后还在，两段按各自的号类遮。
 */
function makeGlue(texts: readonly string[]): string {
  for (let n = 0; n < 32; n += 1) {
    const glue = `\uE001g${n.toString(16)}\uE001`
    if (texts.every((text) => !text.includes(glue))) return glue
  }
  return `\uE001g${randomBytes(3).toString('hex')}\uE001`
}

function separateGluedJsonStrings(json: string, glue: string): string {
  if (!json) return json
  try {
    return JSON.stringify(mapJsonStrings(JSON.parse(json) as unknown, glue))
  } catch {
    return separateGluedIdNumbers(json, glue)
  }
}

function mapJsonStrings(value: unknown, glue: string): unknown {
  if (typeof value === 'string') return separateGluedIdNumbers(value, glue)
  if (Array.isArray(value)) return value.map((item) => mapJsonStrings(item, glue))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = mapJsonStrings(item, glue)
    }
    return out
  }
  return value
}

function stripExact(text: string, glue: string): string {
  return text.split(glue).join('')
}

/** 用户原文里已经写着 `[类别_序号]` 的，先换成本次标记，免得和引擎占位符撞车。 */
function shieldPlaceholderLiterals(text: string, book: LayoutDigitBook): string {
  if (!text) return text
  return text.replace(llmMaskPlaceholderPattern('gu'), (token) => book.issue(token))
}

function isPlaceholderSpelling(value: string): boolean {
  return new RegExp(`^${llmMaskPlaceholderPattern('u').source}$`, 'u').test(value)
}

/** 日期标记换回原文。出站要看到日期本身，不能停在标记上。 */
function unshieldLayoutDates(text: string, extra: ReadonlyMap<string, string>): string {
  let out = text
  for (const [token, original] of extra) {
    if (!out.includes(token) || !isLayoutDateOrTime(foldDigits(original))) continue
    out = out.split(token).join(original)
  }
  return out
}

/** 引擎遮完再换回用户原文。还原函数不再认 `[类别_序号]`，这段字就留在正文里。 */
function unshieldPlaceholderLiterals(text: string, extra: ReadonlyMap<string, string>): string {
  let out = text
  for (const [token, original] of extra) {
    if (!isPlaceholderSpelling(original) || !out.includes(token)) continue
    out = out.split(token).join(original)
  }
  return out
}

/** 引擎占位符换成同一套标记。还原值不是标记自己，说明这是引擎刚遮上的。 */
function rewriteEngineTokens(
  text: string,
  engineRestore: (value: string) => string,
  book: LayoutDigitBook,
  occurrences: Map<string, string[]>,
): string {
  return text.replace(llmMaskPlaceholderPattern('gu'), (token) => {
    const queue = occurrences.get(token)
    const queued = queue && queue.length > 0 ? queue.shift() : undefined
    const secret = queued ?? engineRestore(token)
    if (secret === token) return token
    // 通用银行卡规则会把 20230501-20230505 收进去。整段是日期或时间就留原文。
    if (isLayoutDateOrTime(foldDigits(secret))) return secret
    return book.issue(secret)
  })
}

function dropAbsentTokens(extra: Map<string, string>, texts: readonly string[]): void {
  for (const token of [...extra.keys()]) {
    if (texts.every((text) => !text.includes(token))) extra.delete(token)
  }
}

/** 只换还在映射里的本次标记。不跑引擎的 `[类别_序号]` 替换，避免把用户原文换掉。 */
function restoreTokens(extra: ReadonlyMap<string, string>): (value: string) => string {
  return (value: string): string => {
    if (typeof value !== 'string' || value.length === 0 || extra.size === 0) return value
    let out = value
    for (const [token, original] of extra) {
      if (!out.includes(token)) continue
      out = out.split(token).join(original)
    }
    return out
  }
}

function tooLong(): never {
  throw new ServiceUnavailableException({
    error: { code: AI_LAYOUT_ADJUST_TOO_LONG, message: AI_LAYOUT_ADJUST_TOO_LONG_MESSAGE },
  })
}

/** 截到 limit。切点落在占位符里就退到占位符前面；末尾剩下的数字整段丢掉。 */
/** 事实核对前去掉本次标记。标记里的十六进制和序号不是简历上的数字。 */
export function stripLayoutTokensForFacts(text: string): string {
  return text.replace(layoutTokenPattern('gu'), '')
}

export function cutMaskedLayoutText(text: string, limit: number): string {
  if (limit <= 0) return ''
  if (text.length <= limit) return text
  let cut = limit
  const re = new RegExp(`${llmMaskPlaceholderPattern().source}|${layoutTokenPattern().source}`, 'gu')
  for (const match of text.matchAll(re)) {
    const start = match.index ?? 0
    const end = start + match[0].length
    if (end <= cut) continue
    if (start < cut) cut = start
    break
  }
  return text.slice(0, cut).replace(/\d+$/u, '')
}

export function maskLayoutAdjustOutbound(input: {
  originalText: string
  resumeValues: string
  resumeJson: string
  maxOriginalChars: number
}): {
  maskedOriginal: string
  maskedResumeValues: string
  maskedResumeJson: string
  restore: (value: string) => string
} {
  const sources = [input.originalText, input.resumeValues, input.resumeJson]
  const { book, extra } = createLayoutTokenBook(sources)
  const shielded = sources.map((text) => shieldPlaceholderLiterals(text, book))
  const glue = makeGlue(shielded)
  const glued = [
    separateGluedIdNumbers(shielded[0] ?? '', glue),
    separateGluedIdNumbers(shielded[1] ?? '', glue),
    separateGluedJsonStrings(shielded[2] ?? '', glue),
  ]
  if (glued.some((text) => text.length > LLM_MASK_INPUT_LIMIT)) tooLong()
  // 引擎会把 \r\n 收成 \n。先遮住，占位符里留的才是用户原文。
  // 日期也先换走：带标签的手机号规则会把年份串切掉一位。
  const prepared = glued.map((text) => shieldLayoutDates(coverRealisticNumbers(text, book), book))
  const masked = maskUserTextsForLlmReversible(prepared, 'resume_layout_adjust')
  const occurrences = new Map<string, string[]>()
  for (const [token, list] of masked.occurrences) occurrences.set(token, [...list])
  const cover = (text: string) => coverRealisticNumbers(
    rewriteEngineTokens(stripExact(text, glue), masked.restore, book, occurrences),
    book,
  )
  const [engineOriginal = '', engineValues = '', engineJson = ''] = masked.texts
  // 原文先领序号。贴着字数上限的证件号要换成 10 字标记，才不会被截出窗口。
  const finish = (text: string): string => unshieldLayoutDates(unshieldPlaceholderLiterals(text, extra), extra)
  const coveredOriginal = finish(cover(engineOriginal))
  const maskedResumeValues = finish(cover(engineValues))
  const maskedResumeJson = finish(coverAdjacentJsonValues(cover(engineJson), book))
  const maskedOriginal = cutMaskedLayoutText(coveredOriginal, input.maxOriginalChars)
  dropAbsentTokens(extra, [maskedOriginal, maskedResumeValues, maskedResumeJson])
  return {
    maskedOriginal,
    maskedResumeValues,
    maskedResumeJson,
    restore: restoreTokens(extra),
  }
}
