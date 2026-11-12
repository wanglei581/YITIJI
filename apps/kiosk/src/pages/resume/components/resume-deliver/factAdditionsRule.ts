/**
 * 改写相对原文新增的数字和职责词。
 *
 * 一份规则、两份逐字节相同的副本（一体机与后端各一份）。不 import 任何模块，只使用语言内置。
 * 数字按完整数值比较，不按子串：原文有「2020」不能放过改写里的「20」或「202」。
 * 带百分号和不带百分号是两个事实。中文数字先折成数值，再和阿拉伯数字放在同一套记号里比。
 * 职责词长的先占住区间，「独立负责」不再另报里面的「负责」。
 */

export interface FactAddition {
  /** 同一事实的规范化记号。数字按值，职责词按词。例如 num:20、pct:20、duty:牵头。 */
  key: string
  /** 给人看的片段：命中处左右各最多 4 个字，遇到标点或换行就停。 */
  text: string
}

interface RawHit {
  start: number
  end: number
  key: string
  kind: 'num' | 'duty'
  word: string
}

const FALSE_PHRASES = [
  '第一时间',
  '一方面',
  '进一步',
  '一起',
  '一直',
  '一定',
  '一些',
  '一般',
  '一样',
  '一切',
  '一致',
  '一体',
  '一线',
  '一流',
  '一贯',
  '一向',
  '一旦',
  '一同',
  '一再',
  '一律',
  '一下',
  '一边',
  '统一',
  '唯一',
  '同一',
  '单一',
  '之一',
  '万一',
]

const DUTY_WORDS = [
  '独立完成',
  '独立负责',
  '全面负责',
  '季度之星',
  '主导',
  '负责',
  '牵头',
  '带领',
  '领导',
  '管理',
  '统筹',
  '主持',
  '组建',
]

const MEASURES = [
  '个月',
  '小时',
  '年',
  '月',
  '周',
  '天',
  '日',
  '人',
  '名',
  '位',
  '次',
  '项',
  '篇',
  '场',
  '届',
  '倍',
  '家',
  '所',
  '门',
  '本',
  '期',
  '批',
  '轮',
  '个',
  '余',
  '多',
  '万',
  '千',
  '百',
]

/** 「一个」「一份」太常见，几乎不是事实。种、名、位同样放过。 */
const YI_SKIP = ['个', '份', '种', '名', '位']

const SINGLE_DIGITS = '一二两三四五六七八九十'

const STOPS = '，。；：、！？,.;:!?（）()「」“”"\''

const ARABIC_WITH_PERCENT = /^(?:[0-9０-９]{1,3}(?:[,，][0-9０-９]{3})+|[0-9０-９]+)(?:[.．][0-9０-９]+)?(?:[ \t\u3000]*[%％])?/
const ARABIC_NUMBER = /^(?:[0-9０-９]{1,3}(?:[,，][0-9０-９]{3})+|[0-9０-９]+)(?:[.．][0-9０-９]+)?/

function cnDigit(ch: string): number | null {
  switch (ch) {
    case '零':
    case '〇':
      return 0
    case '一':
      return 1
    case '二':
    case '两':
      return 2
    case '三':
      return 3
    case '四':
      return 4
    case '五':
      return 5
    case '六':
      return 6
    case '七':
      return 7
    case '八':
      return 8
    case '九':
      return 9
    default:
      return null
  }
}

function cnSmall(ch: string): number | null {
  if (ch === '十') return 10
  if (ch === '百') return 100
  if (ch === '千') return 1000
  return null
}

function cnBig(ch: string): number | null {
  if (ch === '万') return 10000
  if (ch === '亿') return 100000000
  return null
}

function isCnNumChar(ch: string): boolean {
  return cnDigit(ch) !== null || cnSmall(ch) !== null || cnBig(ch) !== null
}

function isDigitChar(ch: string | undefined): boolean {
  if (!ch) return false
  const code = ch.charCodeAt(0)
  return (code >= 0x30 && code <= 0x39) || (code >= 0xff10 && code <= 0xff19)
}

function toHalfWidth(input: string): string {
  let out = ''
  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charAt(i)
    const code = ch.charCodeAt(0)
    if (code >= 0xff10 && code <= 0xff19) out += String.fromCharCode(code - 0xff10 + 0x30)
    else if (ch === '．') out += '.'
    else if (ch === '％') out += '%'
    else out += ch
  }
  return out
}

/** 2.50 与 2.5 相同，05 与 5 相同。整数不带小数点。 */
function canonicalNumber(body: string): string | null {
  if (!/^\d+(?:\.\d+)?$/.test(body)) return null
  const value = Number(body)
  if (!Number.isFinite(value)) return null
  const rendered = value.toString()
  if (rendered.indexOf('e') === -1 && rendered.indexOf('E') === -1) return rendered
  return value.toFixed(8).replace(/0+$/, '').replace(/\.$/, '')
}

function startsWithWord(text: string, index: number, words: readonly string[]): string | null {
  for (let i = 0; i < words.length; i += 1) {
    if (text.startsWith(words[i], index)) return words[i]
  }
  return null
}

function readCnRun(text: string, index: number): { raw: string; end: number } | null {
  if (!isCnNumChar(text.charAt(index))) return null
  let end = index
  while (end < text.length && isCnNumChar(text.charAt(end))) end += 1
  return { raw: text.slice(index, end), end }
}

function parseChinese(raw: string): number | null {
  let hasUnit = false
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw.charAt(i)
    if (cnSmall(ch) !== null || cnBig(ch) !== null) hasUnit = true
    else if (cnDigit(ch) === null) return null
  }
  if (!hasUnit) {
    let digits = ''
    for (let i = 0; i < raw.length; i += 1) {
      const digit = cnDigit(raw.charAt(i))
      if (digit === null) return null
      digits += String(digit)
    }
    return Number(digits)
  }
  let result = 0
  let section = 0
  let number = 0
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw.charAt(i)
    const digit = cnDigit(ch)
    const small = cnSmall(ch)
    const big = cnBig(ch)
    if (digit !== null) number = digit
    else if (small !== null) {
      section += (number || 1) * small
      number = 0
    } else if (big !== null) {
      section = (section + number) * big
      result += section
      section = 0
      number = 0
    }
  }
  return result + section + number
}

function matchArabic(
  text: string,
  index: number,
  allowPercent: boolean,
): { end: number; canonical: string; percent: boolean } | null {
  if (!isDigitChar(text.charAt(index))) return null
  const matched = (allowPercent ? ARABIC_WITH_PERCENT : ARABIC_NUMBER).exec(text.slice(index))
  if (!matched || matched[0].length === 0) return null
  const raw = matched[0]
  const percent = /[%％]$/.test(raw)
  const body = toHalfWidth(raw).replace(/[%％]/g, '').replace(/[ \t\u3000,，]/g, '')
  const canonical = canonicalNumber(body)
  if (canonical === null) return null
  return { end: index + raw.length, canonical, percent }
}

/** 百分之后面允许单个汉字，不要求再跟量词。 */
function matchBareChinese(text: string, index: number): { end: number; canonical: string } | null {
  const run = readCnRun(text, index)
  if (!run) return null
  if (run.raw.length === 1) {
    const ch = run.raw
    if (cnDigit(ch) === null && ch !== '十') return null
  }
  const value = parseChinese(run.raw)
  if (value === null || !Number.isFinite(value)) return null
  const canonical = canonicalNumber(String(value))
  if (canonical === null) return null
  return { end: run.end, canonical }
}

function matchPercent(text: string, index: number): RawHit | null {
  if (!text.startsWith('百分之', index)) return null
  let cursor = index + 3
  while (cursor < text.length) {
    const ch = text.charAt(cursor)
    if (ch !== ' ' && ch !== '\t' && ch !== '\u3000') break
    cursor += 1
  }
  const arabic = matchArabic(text, cursor, false)
  const chinese = arabic ? null : matchBareChinese(text, cursor)
  const found = arabic ?? chinese
  if (!found) return null
  return { start: index, end: found.end, key: `pct:${found.canonical}`, kind: 'num', word: '' }
}

/** 「第」+ 数 + 名/等 是排名事实。单字「一」在这里也要算，用来认「第一名」。 */
function matchRank(text: string, index: number): RawHit | null {
  if (text.charAt(index) !== '第') return null
  const cursor = index + 1
  const arabic = matchArabic(text, cursor, false)
  const chinese = arabic ? null : matchBareChinese(text, cursor)
  const found = arabic ?? chinese
  if (!found) return null
  const suffix = text.charAt(found.end)
  if (suffix !== '名' && suffix !== '等') return null
  return { start: index, end: found.end + 1, key: `num:${found.canonical}`, kind: 'num', word: '' }
}

function matchChinese(text: string, index: number): RawHit | null {
  const run = readCnRun(text, index)
  if (!run) return null
  if (run.raw.length === 1) {
    if (SINGLE_DIGITS.indexOf(run.raw) === -1) return null
    if (run.raw === '一' && startsWithWord(text, run.end, YI_SKIP)) return null
    const rank = text.startsWith('等', run.end)
    const measure = startsWithWord(text, run.end, MEASURES)
    if (!rank && !measure) return null
  }
  const value = parseChinese(run.raw)
  if (value === null || !Number.isFinite(value)) return null
  const canonical = canonicalNumber(String(value))
  if (canonical === null) return null
  return { start: index, end: run.end, key: `num:${canonical}`, kind: 'num', word: '' }
}

function matchDuty(text: string, index: number): RawHit | null {
  const word = startsWithWord(text, index, DUTY_WORDS)
  if (!word) return null
  return { start: index, end: index + word.length, key: `duty:${word}`, kind: 'duty', word }
}

function falsePhraseEnd(text: string, index: number): number {
  let end = index
  for (let i = 0; i < FALSE_PHRASES.length; i += 1) {
    const phrase = FALSE_PHRASES[i]
    const next = index + phrase.length
    if (next > end && text.startsWith(phrase, index)) end = next
  }
  return end
}

function scan(text: string): RawHit[] {
  const hits: RawHit[] = []
  let index = 0
  while (index < text.length) {
    const skipped = falsePhraseEnd(text, index)
    if (skipped > index) {
      index = skipped
      continue
    }
    const percent = matchPercent(text, index)
    if (percent) {
      hits.push(percent)
      index = percent.end
      continue
    }
    const rank = matchRank(text, index)
    if (rank) {
      hits.push(rank)
      index = rank.end
      continue
    }
    const arabic = matchArabic(text, index, true)
    if (arabic) {
      hits.push({
        start: index,
        end: arabic.end,
        key: `${arabic.percent ? 'pct' : 'num'}:${arabic.canonical}`,
        kind: 'num',
        word: '',
      })
      index = arabic.end
      continue
    }
    const chinese = matchChinese(text, index)
    if (chinese) {
      hits.push(chinese)
      index = chinese.end
      continue
    }
    const duty = matchDuty(text, index)
    if (duty) {
      hits.push(duty)
      index = duty.end
      continue
    }
    index += 1
  }
  return hits
}

function snippet(text: string, start: number, end: number, blocked: Array<[number, number]>): string {
  // 旁边如果还有另一条事实，窗口停在它的边界上。否则「带领」会把紧挨着的「十」吞进同一片段，数字就丢了。
  const blockedAt = (index: number) => blocked.some(([from, to]) => index >= from && index < to)
  let left = start
  let taken = 0
  while (left > 0 && taken < 4) {
    const prev = left - 1
    const ch = text.charAt(prev)
    if (ch === '\n' || ch === '\r' || STOPS.indexOf(ch) !== -1 || blockedAt(prev)) break
    left -= 1
    taken += 1
  }
  let right = end
  taken = 0
  while (right < text.length && taken < 4) {
    const ch = text.charAt(right)
    if (ch === '\n' || ch === '\r' || STOPS.indexOf(ch) !== -1 || blockedAt(right)) break
    right += 1
    taken += 1
  }
  const core = text.slice(start, end)
  const clipped = text.slice(left, right).trim()
  if (clipped.indexOf(core) === -1) return core
  return clipped
}

export function findFactAdditions(afterText: string, beforeText: string): FactAddition[] {
  const beforeKeys = new Set<string>()
  const beforeHits = scan(beforeText)
  for (let i = 0; i < beforeHits.length; i += 1) {
    if (beforeHits[i].kind === 'num') beforeKeys.add(beforeHits[i].key)
  }
  const fresh: RawHit[] = []
  const afterHits = scan(afterText)
  for (let i = 0; i < afterHits.length; i += 1) {
    const hit = afterHits[i]
    if (hit.kind === 'num') {
      if (beforeKeys.has(hit.key)) continue
    } else if (beforeText.includes(hit.word)) {
      continue
    }
    fresh.push(hit)
  }
  const seen = new Set<string>()
  const additions: FactAddition[] = []
  for (let i = 0; i < fresh.length; i += 1) {
    const hit = fresh[i]
    const blocked: Array<[number, number]> = []
    for (let j = 0; j < fresh.length; j += 1) {
      if (j !== i) blocked.push([fresh[j].start, fresh[j].end])
    }
    const text = snippet(afterText, hit.start, hit.end, blocked)
    if (seen.has(text)) continue
    seen.add(text)
    additions.push({ key: hit.key, text })
  }
  return additions
}
