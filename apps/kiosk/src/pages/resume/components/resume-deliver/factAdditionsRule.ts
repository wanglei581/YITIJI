/**
 * 改写相对原文新增的数字和职责词。
 *
 * 一份规则、两份逐字节相同的副本（一体机与后端各一份）。不 import 任何模块，只使用语言内置。
 * 数字按完整数值比较，不按子串：原文有「2020」不能放过改写里的「20」或「202」。
 * 带百分号和不带百分号是两个事实。中文数字先折成数值，再和阿拉伯数字放在同一套记号里比。
 * 最后一个大单位（百、千、万、亿）后面只跟一个数字、中间没有「零」、这个数字自己也没有单位时，
 * 这个数字取下一级单位：一万二 = 12000，三千五 = 3500，两百五 = 250，1万2 = 12000，3千5 = 3500，2千万5 = 25000000。
 * 数字后面已经没有任何字符时同样按省略单位读。空字符串不是单位。
 * 「一万零二」有零，仍是 10002；「一万二千」末位自己带千，仍是 12000。
 * 「百分点」「百分比」「百分之」「千分之」「千分比」「万分之」里的百、千、万不是单位：1百分点 = 1。
 * 阿拉伯数字与中文单位交替、且单位逐级变小，合成一个数：3千5百 = 3500，1万2千 = 12000。
 * 单位不是逐级变小（如 5百3千）就拆开读，不合成一个数。
 * 读不准的整串不拆、不按数值比，记成 raw: 加上去掉空格、全角转半角后的原文。
 * 它只和另一边同样的整串相等。读不准包括：合并时较小单位后面还紧跟单位（3千5百万、2亿3千万、1万2千5百万）；
 * 数后面隔着空格或「多、余、来、几、左右」再接百千万亿；单位链里夹了「零」或小数又再接单位（1万零2千、1万2.5千）；
 * 中文数字和阿拉伯数字混在同一条单位链里（1万两千、3千五百万、2亿三千万、一万2千）。
 * 字段在空格或「多、余、来、几、左右」处结束、后面没有百千万亿时，仍按数值读。单字「十」后面隔着这些字或空格再接单位，同样整串读。
 * 职责词长的先占住区间，「独立负责」不再另报里面的「负责」。
 */

export interface FactAddition {
  /** 同一事实的规范化记号。数字按值，职责词按词，读不准的数按整串。例如 num:20、pct:20、raw:3千5百万、duty:牵头。 */
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

/**
 * 中文数字折成十进制字符串。万先收进本组，亿再把本组乘一亿，避免「一万亿」收成一万。
 * 末位省略单位：读完后若还剩恰好一个数字，它紧跟在百、千、万、亿后面，中间没有「零」，
 * 就乘以下一级单位，不按个位加。一万二 = 12000，不是 10002。
 */
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
  let lastUnit = 0n
  let bareAfterUnit = 0
  let zeroBreak = false
  const markUnit = (unit: bigint) => {
    lastUnit = unit
    bareAfterUnit = 0
    zeroBreak = false
  }
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw.charAt(i)
    const digit = cnDigit(ch)
    const small = cnSmall(ch)
    if (digit !== null) {
      if (lastUnit > 0n) {
        bareAfterUnit = pending ? bareAfterUnit + 1 : 1
        if (digit === 0) zeroBreak = true
      }
      number = BigInt(digit)
      pending = true
    } else if (small !== null) {
      section += (pending ? number : 1n) * BigInt(small)
      number = 0n
      pending = false
      markUnit(BigInt(small))
    } else if (ch === '万') {
      const current = section + (pending ? number : 0n)
      group += (current === 0n ? 1n : current) * 10000n
      section = 0n
      number = 0n
      pending = false
      markUnit(10000n)
    } else if (ch === '亿') {
      const current = group + section + (pending ? number : 0n)
      result += (current === 0n ? 1n : current) * 100000000n
      group = 0n
      section = 0n
      number = 0n
      pending = false
      markUnit(100000000n)
    } else {
      return null
    }
  }
  let tail = pending ? number : 0n
  // 十的下一级是个位，和直接相加相同。百及以上才把末位抬到下一级。
  if (pending && bareAfterUnit === 1 && !zeroBreak && lastUnit >= 100n) {
    tail = number * (lastUnit / 10n)
  }
  return (result + group + section + tail).toString()
}

/** 「1万2」里单位后面那一个数字。后面还有数字或单位时不吞，留给下一次匹配。 */
function omittedArabicTail(text: string, index: number, places: number): { end: number; value: string } | null {
  if (places < 1) return null
  const ch = text.charAt(index)
  if (!isDigitChar(ch)) return null
  const next = text.charAt(index + 1)
  if (isDigitChar(next)) return null
  // 文本在这里结束时 charAt 得到空字符串。indexOf('') 是 0，不能当成后面还有单位。
  if (next !== '' && '万亿千百十.．%％'.indexOf(next) !== -1) return null
  return { end: index + 1, value: shiftDecimal(toHalfWidth(ch), places - 1) }
}

/** 阿拉伯数字紧跟着的中文单位。0 表示这里不是单位，空字符串也不是。 */
function arabicUnitPlaces(ch: string): number {
  if (ch === '百') return 2
  if (ch === '千') return 3
  if (ch === '万') return 4
  if (ch === '亿') return 8
  return 0
}

/** 这几个词里的百、千、万是「分」的说法，不是 100、1000、10000。 */
const NOT_UNIT_PHRASES = ['百分点', '百分比', '百分之', '千分之', '千分比', '万分之']

function isNotUnitPhrase(text: string, index: number): boolean {
  for (let i = 0; i < NOT_UNIT_PHRASES.length; i += 1) {
    if (text.startsWith(NOT_UNIT_PHRASES[i], index)) return true
  }
  return false
}

function readArabicUnitPlaces(text: string, index: number): number {
  if (isNotUnitPhrase(text, index)) return 0
  return arabicUnitPlaces(text.charAt(index))
}

const HEDGE_WORDS = ['左右', '多', '余', '来', '几']

function skipSpaces(text: string, index: number): number {
  let cursor = index
  while (cursor < text.length) {
    const ch = text.charAt(cursor)
    if (ch !== ' ' && ch !== '\t' && ch !== '\u3000') break
    cursor += 1
  }
  return cursor
}

/** 去掉空格、全角数字转半角。多、余这些字留在整串里，不和没有它们的写法相等。 */
function rawBody(text: string, start: number, end: number): string {
  return toHalfWidth(text.slice(start, end)).replace(/[ \t\u3000]/g, '')
}

/**
 * 数和单位之间隔着空格或「多、余、来、几、左右」。
 * 紧贴着的单位不算，那是读得准的「300万」。
 */
function hedgeUnitEnd(text: string, index: number): number | null {
  const spaced = skipSpaces(text, index)
  let cursor = spaced
  let usedHedge = false
  for (let i = 0; i < HEDGE_WORDS.length; i += 1) {
    const word = HEDGE_WORDS[i]
    if (text.startsWith(word, cursor)) {
      cursor += word.length
      usedHedge = true
      break
    }
  }
  const after = skipSpaces(text, cursor)
  if (!usedHedge && after === index) return null
  if (isNotUnitPhrase(text, after)) return null
  // 文本在这里结束时 charAt 得到空字符串。indexOf('') 是 0，不能当成后面还有单位。
  if (after >= text.length || '百千万亿'.indexOf(text.charAt(after)) === -1) return null
  let end = after + 1
  while (end < text.length && '百千万亿'.indexOf(text.charAt(end)) !== -1 && !isNotUnitPhrase(text, end)) end += 1
  return end
}

/** 单位链后面还连着读不准的一段：隔着说法再接单位、零后再接单位、小数后再接单位。 */
function rawTailEnd(text: string, from: number): number | null {
  const hedge = hedgeUnitEnd(text, from)
  if (hedge !== null) return hedge
  const lead = text.charAt(from)
  if (lead === '零' || lead === '〇') {
    let cursor = from + 1
    if (!isDigitChar(text.charAt(cursor))) return null
    while (isDigitChar(text.charAt(cursor)) || text.charAt(cursor) === '.' || text.charAt(cursor) === '．') cursor += 1
    if (readArabicUnitPlaces(text, cursor) <= 0) return null
    return cursor + 1
  }
  if (!isDigitChar(lead)) return null
  const matched = ARABIC_NUMBER.exec(text.slice(from))
  if (!matched || !/[.．]/.test(matched[0])) return null
  const unitAt = from + matched[0].length
  if (readArabicUnitPlaces(text, unitAt) <= 0) return null
  return unitAt + 1
}

function consumeUncertainChain(text: string, from: number): number {
  let cursor = from
  while (cursor < text.length) {
    const ch = text.charAt(cursor)
    if (isDigitChar(ch) || '十百千万亿'.indexOf(ch) !== -1) {
      cursor += 1
      continue
    }
    const tail = rawTailEnd(text, cursor)
    if (tail !== null && tail > cursor) {
      cursor = tail
      continue
    }
    break
  }
  return cursor
}

function chineseUnitChainEnd(text: string, from: number): number | null {
  const lead = text.charAt(from)
  if (cnDigit(lead) === null && lead !== '十') return null
  const run = readCnRun(text, from)
  if (!run) return null
  for (let i = 0; i < run.raw.length; i += 1) {
    if (cnSmall(run.raw.charAt(i)) !== null || cnBig(run.raw.charAt(i)) !== null) return run.end
  }
  return null
}

function arabicUnitChainEnd(text: string, from: number): number | null {
  if (!isDigitChar(text.charAt(from))) return null
  const matched = ARABIC_NUMBER.exec(text.slice(from))
  if (!matched) return null
  let end = from + matched[0].length
  if (readArabicUnitPlaces(text, end) <= 0) return null
  end += 1
  while (end < text.length && readArabicUnitPlaces(text, end) > 0) end += 1
  while (isDigitChar(text.charAt(end)) && !isDigitChar(text.charAt(end + 1)) && readArabicUnitPlaces(text, end + 1) > 0) {
    end += 2
    while (end < text.length && readArabicUnitPlaces(text, end) > 0) end += 1
  }
  return end
}

/** 中文数字和阿拉伯数字混在同一条单位链里。firstCn 表示下一段是中文数字。 */
function mixedUnitChainEnd(text: string, from: number, firstCn: boolean): number | null {
  let cursor = from
  let expectCn = firstCn
  let consumed = false
  while (cursor < text.length) {
    const end = expectCn ? chineseUnitChainEnd(text, cursor) : arabicUnitChainEnd(text, cursor)
    if (end === null) break
    cursor = end
    consumed = true
    expectCn = !expectCn
  }
  return consumed ? cursor : null
}

function matchArabic(
  text: string,
  index: number,
  allowPercent: boolean,
): { end: number; canonical: string; percent: boolean; raw: string | null } | null {
  if (!isDigitChar(text.charAt(index))) return null
  const matched = (allowPercent ? ARABIC_WITH_PERCENT : ARABIC_NUMBER).exec(text.slice(index))
  if (!matched || matched[0].length === 0) return null
  const token = matched[0]
  const percent = /[%％]$/.test(token)
  const body = toHalfWidth(token).replace(/[%％]/g, '').replace(/[ \t\u3000,，]/g, '')
  let canonical = canonicalNumber(body)
  if (canonical === null) return null
  let end = index + token.length
  if (percent) return { end, canonical, percent, raw: null }
  const asRaw = (rawEnd: number) => ({
    end: rawEnd,
    canonical: '',
    percent: false,
    raw: rawBody(text, index, rawEnd),
  })
  const unitPlaces = readArabicUnitPlaces(text, end)
  if (unitPlaces === 0) {
    const awkward = rawTailEnd(text, end)
    if (awkward !== null) return asRaw(awkward)
    return { end, canonical, percent: false, raw: null }
  }
  canonical = shiftDecimal(canonical, unitPlaces)
  end += 1
  let magnitude = unitPlaces
  const bigger = readArabicUnitPlaces(text, end)
  if (bigger > unitPlaces && !canonical.includes('.')) {
    canonical = shiftDecimal(canonical, bigger)
    end += 1
    magnitude += bigger
  }
  // 3千5百、1万2千：后面每段都是「一个数字 + 更小的单位」，合进同一个数。
  // 5百3千这种单位变大的，停在这个数字前面，留给下一次各自确认。
  // 较小单位后面还紧跟单位（3千5百万）读不准，整段改记整串，不再拆成两个数。
  let uncertainFrom: number | null = null
  while (!canonical.includes('.')) {
    if (!isDigitChar(text.charAt(end)) || isDigitChar(text.charAt(end + 1))) break
    const smaller = readArabicUnitPlaces(text, end + 1)
    if (!(smaller > 0 && smaller < magnitude)) break
    if (readArabicUnitPlaces(text, end + 2) > 0) {
      uncertainFrom = end
      break
    }
    const part = shiftDecimal(toHalfWidth(text.charAt(end)), smaller)
    if (part.includes('.')) break
    canonical = (BigInt(canonical) + BigInt(part)).toString()
    end += 2
    magnitude = smaller
  }
  if (uncertainFrom !== null) return asRaw(consumeUncertainChain(text, uncertainFrom))
  const tail = omittedArabicTail(text, end, magnitude)
  if (tail && !canonical.includes('.') && !tail.value.includes('.')) {
    canonical = (BigInt(canonical) + BigInt(tail.value)).toString()
    end = tail.end
  }
  const awkward = rawTailEnd(text, end)
  if (awkward !== null) return asRaw(awkward)
  const mixed = mixedUnitChainEnd(text, end, true)
  if (mixed !== null) return asRaw(mixed)
  return { end, canonical, percent: false, raw: null }
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
  if (arabic?.raw) return { start: index, end: arabic.end, key: `raw:${arabic.raw}`, kind: 'num', word: '' }
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
    const key = arabic?.raw ? `raw:${arabic.raw}` : `num:${found.canonical}`
    return { start: index, end, key, kind: 'num', word: '' }
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
    if (!rank && !measure && rawTailEnd(text, run.end) === null) return null
  }
  const canonical = parseChinese(run.raw)
  if (canonical === null) return null
  const mixed = mixedUnitChainEnd(text, run.end, false)
  if (mixed !== null) {
    return { start: index, end: mixed, key: `raw:${rawBody(text, index, mixed)}`, kind: 'num', word: '' }
  }
  const tail = rawTailEnd(text, run.end)
  if (tail !== null) {
    return { start: index, end: tail, key: `raw:${rawBody(text, index, tail)}`, kind: 'num', word: '' }
  }
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
        key: arabic.raw ? `raw:${arabic.raw}` : `${arabic.percent ? 'pct' : 'num'}:${arabic.canonical}`,
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
