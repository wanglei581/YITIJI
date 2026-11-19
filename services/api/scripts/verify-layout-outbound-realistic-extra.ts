/**
 * 排版出站现实写法的补充用例。由 verify-layout-outbound-realistic 拉起，
 * 不单独进 CI。分段不再按固定组数列举，日期豁免和随机拼接都在这里钉住。
 */
import { layoutTokenPattern } from '../src/ai/resume/layout-adjust-digit-cover'
import { maskLayoutAdjustOutbound } from '../src/ai/resume/layout-adjust-mask'
import { llmMaskPlaceholderPattern } from '../src/common/pii/mask-placeholder'
const PHONE = '13800138000'
const ID_CARD = '110101199003072315'

type Covered = (label: string, raw: string, secretDigits: string, json?: string) => void
type Kept = (label: string, raw: string) => void

/** 扩展分隔把 1–10 位的数字段接成号码。三段都放进原文、字段值和简历 JSON。 */
export function runExtendedSegmentCases(assertCovered: Covered): void {
  assertCovered('七加四斜线手机号', '1380013/8000', PHONE)
  assertCovered('七加四换行手机号', '1380013\n8000', PHONE)
  assertCovered('身份证六四四四斜线', '110101/1990/0307/2315', ID_CARD)
  assertCovered('身份证六四四四换行', '110101\n1990\n0307\n2315', ID_CARD)
  assertCovered('固话四四四斜线', '0755/8888/8888', '075588888888')
  assertCovered('固话四四四换行', '0755\n8888\n8888', '075588888888')
  assertCovered('十加八身份证斜线', '1101011990/03072315', ID_CARD)
  assertCovered('十加八身份证换行', '1101011990\n03072315', ID_CARD)
  assertCovered('九加七银行卡斜线', '622202123/4567890', '6222021234567890')
  assertCovered('九加七银行卡换行', '622202123\n4567890', '6222021234567890')
  assertCovered('七加四回车换行手机号', '1380013\r\n8000', PHONE)
  assertCovered('十加八身份证回车换行', '1101011990\r\n03072315', ID_CARD)
  assertCovered('九加七银行卡回车换行', '622202123\r\n4567890', '6222021234567890')
  assertCovered('全角斜线手机号', '138\uFF0F0013\uFF0F8000', PHONE)
  assertCovered('通用分隔和斜线混用的手机号', '138 - 0013/8000', PHONE)
  assertCovered(
    'JSON 相邻字段各含一段斜线手机号',
    '138/0013/8000',
    PHONE,
    '{"prefix":"138/0013","suffix":"8000"}',
  )
}

/**
 * 整段像日期、时间或年份串的不遮。三段都要原样看见。
 * 月日不合法、或者根本不是日期的长数字仍然遮。
 */
export function runDateExemptionCases(assertKept: Kept, assertCovered: Covered): void {
  assertKept('不补零的点分年月日区间', '2018.9.1-2022.6.30')
  assertKept('不补零的斜线年月日区间', '2018/9/1-2022/6/30')
  assertKept('不补零的年月区间', '2018.10-2022.6')
  assertKept('紧凑日期区间', '20230501-20230505')
  assertKept('年份串', '2018-2020-2022')
  assertKept('全角分隔的年月日区间', '2018\uFF0F9\uFF0F1\uFF0D2022\uFF0E6\uFF0E30')
  assertKept('斜线年月区间仍不遮', '2020/09 - 2024/06')
  assertKept('点与破折号年月区间仍不遮', '2019.09\u20142023.06')
  assertKept('中文年月区间仍不遮', '2021年3月-2024年5月')
  assertKept('斜线年月日仍不遮', '2020/09/01')
  assertKept('钟点时间段仍不遮', '9:00-18:00')
  assertCovered('不像日期的斜线手机号仍遮', '138/0013/8000', PHONE)
  assertCovered('月日不合法的紧凑区间仍遮', '20231345-20230505', '2023134520230505')
}

type Report = {
  pass: (message: string) => void
  fail: (message: string) => never
}

/** 开括号和数字之间有空格时，开括号也要进占位符，出站不能留下孤立的「(」。 */
export function runParenCases(report: Report): void {
  assertOpeningParenInside(report, '( 010 ) 88888888', '(', '01088888888', '括号内夹空格时开括号收进占位符')
  assertOpeningParenInside(report, '（ 138 ） 0013-8000', '（', PHONE, '全角括号内夹空格时开括号收进占位符')
}

function assertOpeningParenInside(
  report: Report,
  raw: string,
  opener: string,
  secretDigits: string,
  label: string,
): void {
  const original = `说明${raw}结束`
  const resumeJson = JSON.stringify({ summary: raw })
  const out = maskLayoutAdjustOutbound({
    originalText: original,
    resumeValues: raw,
    resumeJson,
    maxOriginalChars: original.length + 800,
  })
  const parts = [
    ['原文', out.maskedOriginal, original],
    ['字段值', out.maskedResumeValues, raw],
    ['简历JSON', out.maskedResumeJson, resumeJson],
  ] as const
  for (const [part, masked, source] of parts) {
    if (masked.includes(opener)) report.fail(`${label} ${part} 留下了开括号`)
    if (digitsOnly(masked).includes(secretDigits)) report.fail(`${label} ${part} 还能拼出原号码`)
    if (out.restore(masked) !== source) report.fail(`${label} ${part} 还原后与原文不一致`)
  }
  report.pass(label)
}

function digitsOnly(text: string): string {
  let out = ''
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index] ?? ''
    const code = char.charCodeAt(0)
    const folded = code >= 0xff10 && code <= 0xff19 ? String.fromCharCode(code - 0xff10 + 0x30) : char
    if (folded >= '0' && folded <= '9') out += folded
  }
  return out
}

const SAMPLE_COUNT = 500
const RANDOM_SEEDS = [20261119, 20261120] as const
const WORDS = ['工作经历', '联系电话', '在校时间', '项目说明', '本人自述', '所在城市', '教育背景', '实习单位']
/** 真实换行和斜线。写进 JSON 之后仍是分隔，三段都能接上。字面量里的反斜杠加 n 再序列化会多一个反斜杠，不放进随机样本。 */
const EXTENDED_SEPARATORS = ['/', '\uFF0F', '\n', '\r\n', '\r']
const GENERIC_SEPARATORS = [' ', '-', '.', '\t', ' - ', '\u00B7', '\u2014', '\uFF0D', '\uFF0E']

/**
 * 两个固定种子各 500 组。号码按 1 到 10 位分段，混进日期和普通文字。
 * 号码不以 19 或 20 开头，避免被日期豁免放过。日期和号码之间夹着汉字，避免粘成一段。
 */
export function runRandomSegmentCases(report: Report): void {
  for (const seed of RANDOM_SEEDS) {
    const rng = mulberry32(seed)
    for (let index = 0; index < SAMPLE_COUNT; index += 1) {
      assertRandomSample(report, seed, index, buildSample(rng))
    }
    report.pass(`固定种子 ${seed} 的 ${SAMPLE_COUNT} 组随机分段`)
  }
}

function assertRandomSample(
  report: Report,
  seed: number,
  index: number,
  sample: Sample,
): void {
  const original = `说明${sample.raw}结束`
  const resumeJson = JSON.stringify({ summary: sample.raw })
  const out = maskLayoutAdjustOutbound({
    originalText: original,
    resumeValues: sample.raw,
    resumeJson,
    maxOriginalChars: original.length + 800,
  })
  const parts = [
    ['原文', out.maskedOriginal, original],
    ['字段值', out.maskedResumeValues, sample.raw],
    ['简历JSON', out.maskedResumeJson, resumeJson],
  ] as const
  for (const [part, masked, source] of parts) {
    const visible = digitsOnly(stripPlaceholders(masked, sample.dates))
    for (const secret of sample.secrets) {
      if (visible.includes(secret)) {
        report.fail(`种子 ${seed} 第 ${index} 组 ${part} 还能拼出原号码 ${preview(sample.raw)}`)
      }
    }
    for (const date of sample.dates) {
      if (!masked.includes(date)) {
        report.fail(
          `种子 ${seed} 第 ${index} 组 ${part} 日期被收成占位符 ${preview(date)} 原文 ${preview(sample.raw)} 出站 ${preview(masked)}`,
        )
      }
    }
    if (out.restore(masked) !== source) {
      report.fail(`种子 ${seed} 第 ${index} 组 ${part} 还原后与原文不一致`)
    }
  }
}

type Sample = { raw: string; dates: string[]; secrets: string[] }

function buildSample(rng: () => number): Sample {
  const pieces: Array<{ kind: 'date' | 'number'; text: string; secret?: string }> = []
  const countNumbers = 1 + Math.floor(rng() * 2)
  const countDates = 1 + Math.floor(rng() * 2)
  for (let index = 0; index < countNumbers; index += 1) {
    const secret = randomSecret(rng)
    const text = formatSecret(secret, rng)
    pieces.push({ kind: 'number', text, secret })
  }
  for (let index = 0; index < countDates; index += 1) {
    pieces.push({ kind: 'date', text: randomDate(rng) })
  }
  const dates: string[] = []
  const secrets: string[] = []
  let raw = pick(WORDS, rng)
  for (const piece of shuffle(pieces, rng)) {
    raw += piece.text
    raw += pick(WORDS, rng)
    if (piece.kind === 'date') dates.push(piece.text)
    else if (piece.secret) secrets.push(piece.secret)
  }
  return { raw, dates, secrets }
}

function randomSecret(rng: () => number): string {
  const kind = Math.floor(rng() * 4)
  if (kind === 0) return `1${3 + Math.floor(rng() * 6)}${digitsFrom(rng, 9)}`
  if (kind === 1) return `110${digitsFrom(rng, 15)}`
  if (kind === 2) return `6222${digitsFrom(rng, 12 + Math.floor(rng() * 4))}`
  const landline = Math.floor(rng() * 3)
  if (landline === 0) return `010${digitsFrom(rng, 8)}`
  if (landline === 1) return `0755${digitsFrom(rng, 7)}`
  return `0755${digitsFrom(rng, 8)}`
}

/** 每段 1 到 10 位，至少跨过一次扩展分隔。括号只包后面的段，避免把开括号留在段外。 */
function formatSecret(secret: string, rng: () => number): string {
  const parts = splitDigits(secret, rng)
  const extendedAt = Math.floor(rng() * (parts.length - 1))
  let out = parts[0] ?? ''
  for (let index = 1; index < parts.length; index += 1) {
    const separator = index - 1 === extendedAt || rng() < 0.5
      ? pick(EXTENDED_SEPARATORS, rng)
      : pick(GENERIC_SEPARATORS, rng)
    out += separator + wrapSegment(parts[index] ?? '', rng)
  }
  return out
}

function splitDigits(secret: string, rng: () => number): string[] {
  const parts: string[] = []
  let index = 0
  while (index < secret.length) {
    const remain = secret.length - index
    const max = Math.min(10, remain)
    const length = 1 + Math.floor(rng() * max)
    parts.push(secret.slice(index, index + length))
    index += length
  }
  return parts
}

function wrapSegment(segment: string, rng: () => number): string {
  if (rng() >= 0.15) return segment
  const open = rng() < 0.5 ? '(' : '（'
  const close = open === '(' ? ')' : '）'
  const pad = rng() < 0.5 ? ' ' : ''
  return `${open}${pad}${segment}${pad}${close}`
}

function randomDate(rng: () => number): string {
  const kind = Math.floor(rng() * 6)
  const y1 = 1980 + Math.floor(rng() * 50)
  const y2 = 1980 + Math.floor(rng() * 50)
  const y3 = 1980 + Math.floor(rng() * 50)
  const m1 = 1 + Math.floor(rng() * 12)
  const m2 = 1 + Math.floor(rng() * 12)
  const d1 = 1 + Math.floor(rng() * 28)
  const d2 = 1 + Math.floor(rng() * 28)
  if (kind === 0) return `${y1}.${m1}.${d1}-${y2}.${m2}.${d2}`
  if (kind === 1) return `${y1}/${m1}/${d1}-${y2}/${m2}/${d2}`
  if (kind === 2) return yearMonthRange(y1, m1, y2, m2)
  if (kind === 3) {
    return `${compactDate(y1, m1, d1)}-${compactDate(y2, m2, d2)}`
  }
  if (kind === 4) return `${y1}-${y2}-${y3}`
  const h1 = Math.floor(rng() * 24)
  const h2 = Math.floor(rng() * 24)
  return `${h1}:${pad2(Math.floor(rng() * 60))}-${h2}:${pad2(Math.floor(rng() * 60))}`
}

/** 年月区间补足到 11 位，豁免不成立时这组会把日期遮掉。 */
function yearMonthRange(y1: number, m1: number, y2: number, m2: number): string {
  const left = m1 < 10 ? 10 : m1
  return `${y1}.${left}-${y2}.${m2}`
}

function compactDate(year: number, month: number, day: number): string {
  return `${year}${pad2(month)}${pad2(day)}`
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function stripPlaceholders(text: string, dates: readonly string[]): string {
  let probe = text.replace(layoutTokenPattern('gu'), '').replace(llmMaskPlaceholderPattern('gu'), '')
  const sorted = [...dates].sort((left, right) => right.length - left.length)
  for (const date of sorted) probe = probe.split(date).join('')
  return probe
}

function preview(text: string): string {
  return text.replace(/\r/gu, '\\r').replace(/\n/gu, '\\n').replace(/\t/gu, '\\t').slice(0, 160)
}

function pick<T>(items: readonly T[], rng: () => number): T {
  return items[Math.floor(rng() * items.length)] ?? items[0] as T
}

function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const copy = [...items]
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1))
    const current = copy[index] as T
    copy[index] = copy[swap] as T
    copy[swap] = current
  }
  return copy
}

function digitsFrom(rng: () => number, length: number): string {
  let out = ''
  while (out.length < length) out += String(Math.floor(rng() * 10))
  return out
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6D2B79F5) | 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}
