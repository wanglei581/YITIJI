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
  /** 给人看的片段：从命中处向两侧扩到标点、换行或文本两端，每侧最多 10 个字。到了 10 个字还没遇到标点，那一侧加「…」。 */
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

/** 「一个」「一份」太常见，几乎不是事实。种、名、位同样放过。「个月」不在这里，按量词算。 */
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

/**
 * 2.50 与 2.5 相同，05 与 5 相同。整数不带小数点。
 * 按十进制字符串比，不用 Number：18 位证件号不能被吃掉末位，0.0001 也不能变成 0。
 */
function canonicalNumber(body: string): string | null {
  if (!/^\d+(?:\.\d+)?$/.test(body)) return null
  const dot = body.indexOf('.')
  let intPart = dot === -1 ? body : body.slice(0, dot)
  let frac = dot === -1 ? '' : body.slice(dot + 1)
  intPart = intPart.replace(/^0+/, '')
  if (intPart === '') intPart = '0'
  frac = frac.replace(/0+$/, '')
  if (frac === '') return intPart
  return `${intPart}.${frac}`
}

/** 十进制字符串乘 10^places。1.5 乘 10000 得到 15000，不经过 Number。 */
function shiftDecimal(canonical: string, places: number): string {
  const dot = canonical.indexOf('.')
  const intPart = dot === -1 ? canonical : canonical.slice(0, dot)
  const frac = dot === -1 ? '' : canonical.slice(dot + 1)
  if (places >= frac.length) {
    const body = (intPart + frac).replace(/^0+/, '')
    if (body === '') return '0'
    return body + '0'.repeat(places - frac.length)
  }
  const all = intPart + frac
  const point = all.length - (frac.length - places)
  let nextInt = all.slice(0, point).replace(/^0+/, '')
  if (nextInt === '') nextInt = '0'
  const nextFrac = all.slice(point).replace(/0+$/, '')
  if (nextFrac === '') return nextInt
  return `${nextInt}.${nextFrac}`
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

/** 中文数字折成十进制字符串。万先收进本组，亿再把本组乘一亿，避免「一万亿」收成一万。 */
function parseChinese(raw: string): string | null {
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
    return canonicalNumber(digits)
  }
  let result = 0n
  let group = 0n
  let section = 0n
  let number = 0n
  let pending = false
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw.charAt(i)
    const digit = cnDigit(ch)
    const small = cnSmall(ch)
    if (digit !== null) {
      number = BigInt(digit)
      pending = true
    } else if (small !== null) {
      section += (pending ? number : 1n) * BigInt(small)
      number = 0n
      pending = false
    } else if (ch === '万') {
      const current = section + (pending ? number : 0n)
      group += (current === 0n ? 1n : current) * 10000n
      section = 0n
      number = 0n
      pending = false
    } else if (ch === '亿') {
      const current = group + section + (pending ? number : 0n)
      result += (current === 0n ? 1n : current) * 100000000n
      group = 0n
      section = 0n
      number = 0n
      pending = false
    } else {
      return null
    }
  }
  return (result + group + section + (pending ? number : 0n)).toString()
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
  let canonical = canonicalNumber(body)
  if (canonical === null) return null
  let end = index + raw.length
  if (!percent) {
    const unit = text.charAt(end)
    if (unit === '万' || unit === '亿') {
      canonical = shiftDecimal(canonical, unit === '万' ? 4 : 8)
      end += 1
    }
  }
  return { end, canonical, percent }
}

/** 百分之后面允许单个汉字，不要求再跟量词。 */
function matchBareChinese(text: string, index: number): { end: number; canonical: string } | null {
  const run = readCnRun(text, index)
  if (!run) return null
  if (run.raw.length === 1) {
    const ch = run.raw
    if (cnDigit(ch) === null && ch !== '十') return null
  }
  const canonical = parseChinese(run.raw)
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

/**
 * 「第」+ 数，后面是「名 / 等」，或紧跟标点、换行、文本结尾，都是排名。
 * 「第一次」「第一年」后面还跟着别的字，不算排名，并把「第」和数字一起吞掉，避免再报成「一次」「一年」。
 * 单字「一」在这里也要算，用来认「第一名」。
 */
function matchRank(text: string, index: number): RawHit | { skipEnd: number } | null {
  if (text.charAt(index) !== '第') return null
  const cursor = index + 1
  const arabic = matchArabic(text, cursor, false)
  const chinese = arabic ? null : matchBareChinese(text, cursor)
  const found = arabic ?? chinese
  if (!found) return null
  const next = found.end < text.length ? text.charAt(found.end) : ''
  const boundary = next === '' || next === '\n' || next === '\r' || STOPS.indexOf(next) !== -1
  if (next === '名' || next === '等' || boundary) {
    const end = next === '名' || next === '等' ? found.end + 1 : found.end
    return { start: index, end, key: `num:${found.canonical}`, kind: 'num', word: '' }
  }
  return { skipEnd: found.end }
}

function matchChinese(text: string, index: number): RawHit | null {
  const run = readCnRun(text, index)
  if (!run) return null
  if (run.raw.length === 1) {
    if (SINGLE_DIGITS.indexOf(run.raw) === -1) return null
    const month = run.raw === '一' && text.startsWith('个月', run.end)
    if (!month && run.raw === '一' && startsWithWord(text, run.end, YI_SKIP)) return null
    const rank = text.startsWith('等', run.end)
    const measure = startsWithWord(text, run.end, MEASURES)
    if (!rank && !measure) return null
  }
  const canonical = parseChinese(run.raw)
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
      if ('skipEnd' in rank) {
        index = rank.skipEnd
        continue
      }
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

const SNIPPET_SIDE = 10

function isStop(ch: string): boolean {
  return ch === '\n' || ch === '\r' || STOPS.indexOf(ch) !== -1
}

function expandWindow(text: string, start: number, end: number): {
  left: number
  right: number
  ellipsisLeft: boolean
  ellipsisRight: boolean
} {
  let left = start
  let taken = 0
  while (left > 0 && taken < SNIPPET_SIDE) {
    const ch = text.charAt(left - 1)
    if (isStop(ch)) break
    left -= 1
    taken += 1
  }
  const ellipsisLeft = taken === SNIPPET_SIDE && left > 0 && !isStop(text.charAt(left - 1))
  let right = end
  taken = 0
  while (right < text.length && taken < SNIPPET_SIDE) {
    const ch = text.charAt(right)
    if (isStop(ch)) break
    right += 1
    taken += 1
  }
  const ellipsisRight = taken === SNIPPET_SIDE && right < text.length && !isStop(text.charAt(right))
  return { left, right, ellipsisLeft, ellipsisRight }
}

function renderWindow(
  text: string,
  left: number,
  right: number,
  ellipsisLeft: boolean,
  ellipsisRight: boolean,
  core: string,
): string {
  let body = text.slice(left, right).trim()
  if (body.indexOf(core) === -1) body = core
  if (ellipsisLeft) body = `…${body}`
  if (ellipsisRight) body = `${body}…`
  return body
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
  fresh.sort((a, b) => a.start - b.start || a.end - b.end)
  interface Windowed {
    hit: RawHit
    left: number
    right: number
    ellipsisLeft: boolean
    ellipsisRight: boolean
  }
  const windowed: Windowed[] = []
  for (let i = 0; i < fresh.length; i += 1) {
    const hit = fresh[i]
    windowed.push({ hit, ...expandWindow(afterText, hit.start, hit.end) })
  }
  const groups: Windowed[][] = []
  for (let i = 0; i < windowed.length; i += 1) {
    const item = windowed[i]
    const last = groups.length > 0 ? groups[groups.length - 1] : null
    if (!last) {
      groups.push([item])
      continue
    }
    let clusterRight = last[0].right
    for (let j = 1; j < last.length; j += 1) {
      if (last[j].right > clusterRight) clusterRight = last[j].right
    }
    if (item.left <= clusterRight) last.push(item)
    else groups.push([item])
  }
  const seen = new Set<string>()
  const additions: FactAddition[] = []
  for (let g = 0; g < groups.length; g += 1) {
    const group = groups[g]
    let left = group[0].left
    let right = group[0].right
    let ellipsisLeft = group[0].ellipsisLeft
    let ellipsisRight = group[0].ellipsisRight
    for (let i = 1; i < group.length; i += 1) {
      const item = group[i]
      if (item.left < left) {
        left = item.left
        ellipsisLeft = item.ellipsisLeft
      } else if (item.left === left) {
        ellipsisLeft = ellipsisLeft || item.ellipsisLeft
      }
      if (item.right > right) {
        right = item.right
        ellipsisRight = item.ellipsisRight
      } else if (item.right === right) {
        ellipsisRight = ellipsisRight || item.ellipsisRight
      }
    }
    for (let i = 0; i < group.length; i += 1) {
      const hit = group[i].hit
      const core = afterText.slice(hit.start, hit.end)
      const text = renderWindow(afterText, left, right, ellipsisLeft, ellipsisRight, core)
      const id = `${hit.key}\n${text}`
      if (seen.has(id)) continue
      seen.add(id)
      additions.push({ key: hit.key, text })
    }
  }
  return additions
}
