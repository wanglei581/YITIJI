/**
 * 排版出站先遮盖再截断，粘连号码按原样还原，种子组里不留 11 位及以上连续数字。
 * 跨服务的出站截断在 verify-mask-before-truncate.ts。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:layout-mask-truncate
 */
import 'dotenv/config'
import type { GeneratedResume } from '../src/ai/interfaces/ai-provider.interface'
import { LlmResumeOptimizeService } from '../src/ai/resume/llm-resume-optimize.service'
import { LLM_MASK_INPUT_LIMIT, maskUserTextsForLlmReversible } from '../src/common/pii/llm-input-mask'
import { LLM_MASK_LONG_DIGIT_CATEGORY, LLM_MASK_PLACEHOLDER_CATEGORIES, llmMaskPlaceholderPattern } from '../src/common/pii/mask-placeholder'
import { layoutTokenPattern } from '../src/ai/resume/layout-adjust-digit-cover'
import { cutMaskedLayoutText, maskLayoutAdjustOutbound } from '../src/ai/resume/layout-adjust-mask'
import {
  ID,
  PREFIX,
  captured,
  codeOf,
  cross,
  fail,
  installFakeLlm,
  llmConfig,
  pass,
  passed,
  realFetch,
  statusOf,
} from './verify-mask-outbound-harness'

process.env['AI_ENDPOINT_ALLOWLIST_EXTRA'] = [process.env['AI_ENDPOINT_ALLOWLIST_EXTRA'], 'llm.invalid']
  .filter(Boolean)
  .join(',')

function emptyResume(): GeneratedResume {
  return {
    basic: { name: '甲' },
    intention: { position: '测试岗位' },
    summary: '',
    education: [],
    experience: [],
    projects: [],
    skills: [],
    certificates: [],
  }
}

function resumeWithDescription(description: string): GeneratedResume {
  const resume = emptyResume()
  resume.projects = [{ name: '项目甲', description }]
  return resume
}

function assertNoLongDigitRun(label: string): void {
  for (const body of captured) {
    const run = body.match(/\d{15,}/u)
    if (run) fail(`${label} 出站有 ${run[0].length} 位连续数字`)
  }
}

function hasPartialPlaceholder(text: string): boolean {
  const stripped = text.replace(llmMaskPlaceholderPattern('g'), '').replace(layoutTokenPattern('g'), '')
  return stripped.includes('[') || stripped.includes(']') || stripped.includes('⦃') || stripped.includes('⦄')
}

const ELEVEN_DIGITS = /\d{11,}/u

function assertLongDigitRoundTrip(label: string, raw: string): void {
  const original = `说明${raw}结束`
  const json = JSON.stringify({ summary: raw, projects: [{ description: raw }] })
  const out = maskLayoutAdjustOutbound({
    originalText: original,
    resumeValues: raw,
    resumeJson: json,
    maxOriginalChars: original.length + 800,
  })
  const parts = [
    ['原文', out.maskedOriginal, original],
    ['字段值', out.maskedResumeValues, raw],
    ['简历JSON', out.maskedResumeJson, json],
  ] as const
  for (const [part, masked, source] of parts) {
    const run = masked.match(ELEVEN_DIGITS)
    if (run) fail(`${label} ${part} 出站有 ${run[0].length} 位连续数字`)
    if (masked.includes(raw)) fail(`${label} ${part} 出站含整段号码`)
    if (out.restore(masked) !== source) fail(`${label} ${part} 还原后与原文不一致`)
  }
}

async function assertServiceBodyHasNoLongDigits(
  optimize: LlmResumeOptimizeService,
  label: string,
  raw: string,
): Promise<void> {
  installFakeLlm()
  try {
    await optimize.adjustLayoutDraft({
      currentResume: resumeWithDescription(raw),
      originalText: `说明${raw}结束`,
      action: 'reformat',
    })
  } catch (error) {
    if (statusOf(error) === 500 || codeOf(error) === 'AI_LAYOUT_ADJUST_TOO_LONG') {
      fail(`${label} 出站失败 ${statusOf(error)}/${codeOf(error)}`)
    }
  }
  if (captured.length === 0) fail(`${label} 没有出站`)
  for (const body of captured) {
    const run = body.match(ELEVEN_DIGITS)
    if (run) fail(`${label} 出站正文有 ${run[0].length} 位连续数字`)
    if (body.includes(raw)) fail(`${label} 出站正文含整段号码`)
  }
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6D2B79F5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function digitsFrom(rng: () => number, length: number): string {
  let out = ''
  while (out.length < length) out += String(Math.floor(rng() * 10))
  return out
}

function randomSensitiveNumber(rng: () => number): string {
  const kind = Math.floor(rng() * 6)
  const month = String(1 + Math.floor(rng() * 12)).padStart(2, '0')
  const day = String(1 + Math.floor(rng() * 28)).padStart(2, '0')
  if (kind === 0) return `1${3 + Math.floor(rng() * 7)}${digitsFrom(rng, 9)}`
  if (kind === 1) return `${digitsFrom(rng, 6)}${digitsFrom(rng, 2)}${month}${day}${digitsFrom(rng, 3)}`
  if (kind === 4) return digitsFrom(rng, 16)
  if (kind === 5) return digitsFrom(rng, 19)
  const century = ['18', '19', '20'][Math.floor(rng() * 3)] ?? '19'
  const tail = kind === 3 ? 'X' : String(Math.floor(rng() * 10))
  return `${digitsFrom(rng, 6)}${century}${digitsFrom(rng, 2)}${month}${day}${digitsFrom(rng, 3)}${tail}`
}

function assertSeededLongDigitRoundTrips(): void {
  const rng = mulberry32(20261119)
  for (let index = 0; index < 500; index += 1) {
    const count = 2 + Math.floor(rng() * 3)
    let raw = ''
    for (let piece = 0; piece < count; piece += 1) raw += randomSensitiveNumber(rng)
    const original = `说明${raw}结束`
    const json = JSON.stringify({ summary: raw, projects: [{ description: raw }] })
    const out = maskLayoutAdjustOutbound({
      originalText: original,
      resumeValues: raw,
      resumeJson: json,
      maxOriginalChars: original.length + 800,
    })
    const outbound = `${out.maskedOriginal}\n${out.maskedResumeValues}\n${out.maskedResumeJson}`
    const run = outbound.match(ELEVEN_DIGITS)
    if (run) fail(`第 ${index} 组出站有 ${run[0].length} 位连续数字`)
    if (out.restore(out.maskedOriginal) !== original) fail(`第 ${index} 组原文还原不一致`)
    if (out.restore(out.maskedResumeValues) !== raw) fail(`第 ${index} 组字段值还原不一致`)
    if (out.restore(out.maskedResumeJson) !== json) fail(`第 ${index} 组简历 JSON 还原不一致`)
  }
}

/**
 * 排版出站改用本次请求的标记，不再出现 `[身份证_`。
 * 号码不在、标记在，这条正向断言保留。
 */
function assertLayoutMarked(label: string, text: string): void {
  if (text.includes(ID)) fail(`${label} 出站或落库含整号`)
  if (text.includes(PREFIX)) fail(`${label} 出站或落库含证件号前 10 位`)
  if (!layoutTokenPattern('u').test(text)) fail(`${label} 没有遮盖占位符，跨边界号可能没进窗口`)
  pass(label)
}

async function outboundLayout(label: string, run: () => Promise<unknown>): Promise<void> {
  installFakeLlm()
  try {
    await run()
  } catch {
    // 假模型回的是空 JSON。断言只看已经发出去的正文。
  }
  if (captured.length === 0) fail(`${label} 没有出站`)
  for (const body of captured) assertLayoutMarked(`${label}#${captured.indexOf(body) + 1}`, body)
}

async function outboundClean(label: string, run: () => Promise<unknown>, forbidden: string[]): Promise<void> {
  installFakeLlm()
  let thrown: unknown
  try {
    await run()
  } catch (error) {
    thrown = error
  }
  if (statusOf(thrown) === 500 || codeOf(thrown) === 'AI_LAYOUT_ADJUST_TOO_LONG') {
    fail(`${label} 失败 ${statusOf(thrown)}/${codeOf(thrown)}`)
  }
  if (captured.length === 0) fail(`${label} 没有出站`)
  for (const body of captured) {
    for (const secret of forbidden) {
      if (body.includes(secret)) fail(`${label} 出站含 ${secret.slice(0, 4)}…`)
    }
    if (!layoutTokenPattern('u').test(body)) fail(`${label} 没有遮盖占位符`)
  }
  pass(label)
}

async function main(): Promise<void> {
  const optimize = new LlmResumeOptimizeService(llmConfig)
  const current = emptyResume()
  const json = JSON.stringify(current)
  const values = ['甲', '测试岗位'].join('\n')
  const split = '\n<<<PII_MASK_SPLIT>>>\n'
  const room = Math.max(0, LLM_MASK_INPUT_LIMIT - json.length - values.length - split.length * 2)
  if (room <= 12000) fail(`排版夹具预算 ${room} 没有留在 12000 字截断上`)
  const layoutText = `${cross(12000)}${'丙'.repeat(40)}`
  await outboundLayout('排版原文 12000', () => optimize.adjustLayoutDraft({
    currentResume: current,
    originalText: layoutText,
    action: 'reformat',
  }))
  const id2 = '320102198805156666'
  const prefix2 = '3201021988'
  const phone = '13800138000'
  const earlier = `${ID}。${ID}。${ID}。`
  const gluedAtBoundary = `${'乙'.repeat(11990 - earlier.length)}${earlier}${ID}${id2}`
  await outboundClean('排版跨边界紧跟两个号', () => optimize.adjustLayoutDraft({
    currentResume: current,
    originalText: gluedAtBoundary,
    action: 'reformat',
  }), [ID, id2, PREFIX, prefix2, phone])

  const unit = `姓名张三丰手机${phone}证件${ID}住址北京市东城区景山前街4号`
  let dense = ''
  while (dense.length + unit.length + ID.length + id2.length < 19_000) dense += unit
  dense += `${ID}${id2}`
  await outboundClean('排版接近上限的高密度个人信息', () => optimize.adjustLayoutDraft({
    currentResume: current,
    originalText: dense,
    action: 'reformat',
  }), [ID, id2, PREFIX, prefix2, phone])

  installFakeLlm()
  let tooLongCode = ''
  let tooLongStatus = 0
  try {
    await optimize.adjustLayoutDraft({
      currentResume: current,
      originalText: `${ID}${id2}${'乙'.repeat(20_001)}`,
      action: 'reformat',
    })
  } catch (error) {
    tooLongStatus = statusOf(error)
    tooLongCode = codeOf(error)
  }
  if (captured.length !== 0) fail('排版超过遮盖入口仍出站')
  if (tooLongStatus === 500 || tooLongCode !== 'AI_LAYOUT_ADJUST_TOO_LONG') {
    fail(`排版超过遮盖入口应明确失败，实际 ${tooLongStatus}/${tooLongCode}`)
  }
  pass('排版超过遮盖入口不送半截')

  const bank = '6222021234567890'
  const idEndingX = '11010119900307887X'
  const plainResume = emptyResume()
  await outboundClean('排版原文手机号紧贴身份证', () => optimize.adjustLayoutDraft({
    currentResume: plainResume,
    originalText: `说明${phone}${ID}结束`,
    action: 'reformat',
  }), [ID, id2, PREFIX, prefix2, phone, bank])
  assertNoLongDigitRun('排版原文手机号紧贴身份证')

  await outboundClean('排版原文末位X的身份证紧贴数字', () => optimize.adjustLayoutDraft({
    currentResume: plainResume,
    originalText: `说明${idEndingX}${bank}结束`,
    action: 'reformat',
  }), [ID, id2, PREFIX, prefix2, phone, bank, idEndingX])
  assertNoLongDigitRun('排版原文末位X的身份证紧贴数字')

  installFakeLlm()
  try {
    await optimize.adjustLayoutDraft({
      currentResume: plainResume,
      originalText: `说明${phone}${bank}结束`,
      action: 'reformat',
    })
  } catch (error) {
    if (statusOf(error) === 500 || codeOf(error) === 'AI_LAYOUT_ADJUST_TOO_LONG') {
      fail(`排版原文手机号紧贴银行卡 失败 ${statusOf(error)}/${codeOf(error)}`)
    }
  }
  if (captured.length === 0) fail('排版原文手机号紧贴银行卡 没有出站')
  for (const body of captured) {
    if (body.includes(phone) || body.includes(bank)) fail('排版原文手机号紧贴银行卡 出站含号码')
    // 排版标记不再带类别名。两个不同标记才说明手机号和银行卡没有被收成同一段。
    const marks = new Set(body.match(layoutTokenPattern('g')) ?? [])
    if (marks.size < 2) fail('排版原文手机号紧贴银行卡 没有分开遮盖')
  }
  assertNoLongDigitRun('排版原文手机号紧贴银行卡')
  pass('排版原文手机号紧贴银行卡')

  await outboundClean('排版原文银行卡紧贴身份证', () => optimize.adjustLayoutDraft({
    currentResume: plainResume,
    originalText: `说明${bank}${ID}结束`,
    action: 'reformat',
  }), [ID, id2, PREFIX, prefix2, phone, bank])
  assertNoLongDigitRun('排版原文银行卡紧贴身份证')

  await outboundClean('排版简历JSON里两张身份证粘在一起', () => optimize.adjustLayoutDraft({
    currentResume: resumeWithDescription(`${ID}${id2}`),
    originalText: '说明里没有号码。',
    action: 'reformat',
  }), [ID, id2, PREFIX, prefix2, phone, bank])
  assertNoLongDigitRun('排版简历JSON里两张身份证粘在一起')

  await outboundClean('排版简历JSON里身份证粘着银行卡', () => optimize.adjustLayoutDraft({
    currentResume: resumeWithDescription(`${ID}${bank}`),
    originalText: '说明里没有号码。',
    action: 'reformat',
  }), [ID, id2, PREFIX, prefix2, phone, bank])
  assertNoLongDigitRun('排版简历JSON里身份证粘着银行卡')

  await outboundClean('排版简历JSON里手机号粘着身份证', () => optimize.adjustLayoutDraft({
    currentResume: resumeWithDescription(`${phone}${ID}`),
    originalText: '说明里没有号码。',
    action: 'reformat',
  }), [ID, id2, PREFIX, prefix2, phone, bank])
  assertNoLongDigitRun('排版简历JSON里手机号粘着身份证')

  const produced = maskUserTextsForLlmReversible([
    '姓名：张三。',
    '甲方：测试公司。',
    ID,
    phone,
    'user@example.com',
    bank,
    '住址：北京市东城区景山前街4号。',
    '统一社会信用代码：91310000MA1FL2XW30。',
  ], 'layout_placeholder_kinds')
  const seen = new Set<string>()
  for (const text of produced.texts) {
    for (const match of text.matchAll(/\[[^\]\n[]+_\d+\]/gu)) {
      const token = match[0]
      const official = llmMaskPlaceholderPattern('u')
      if (!official.test(token)) fail(`占位符 ${token} 不在遮盖函数的种类里`)
      seen.add(token.slice(1, token.lastIndexOf('_')))
    }
  }
  for (const category of LLM_MASK_PLACEHOLDER_CATEGORIES) {
    if (!seen.has(category)) fail(`遮盖没有产出 ${category}`)
  }
  if (seen.size !== LLM_MASK_PLACEHOLDER_CATEGORIES.length) fail(`遮盖多产出了占位符：${[...seen].join('、')}`)
  pass('遮盖占位符种类与截断认得的是同一份')

  const kept = cutMaskedLayoutText(`${'乙'.repeat(4)}[身份证_1]${'丙'.repeat(30)}`, 20)
  if (!kept.includes('[身份证_1]')) fail('截断丢掉了已经完整落在窗口里的占位符')
  pass('窗口里完整的占位符保留')

  for (const category of [...LLM_MASK_PLACEHOLDER_CATEGORIES, LLM_MASK_LONG_DIGIT_CATEGORY]) {
    const token = `[${category}_1]`
    const cut = cutMaskedLayoutText(`${'乙'.repeat(16)}${token}${'丙'.repeat(10)}`, 20)
    if (hasPartialPlaceholder(cut)) fail(`截断从 ${category} 占位符中间劈开`)
    if (cut.includes(token)) fail(`切点落在 ${category} 占位符里却整段留下`)
  }
  pass('截断切点落在任一占位符里都退到占位符前面')

  const straddled = maskLayoutAdjustOutbound({
    originalText: `${'乙'.repeat(16)}${ID}${'丙'.repeat(10)}`,
    resumeValues: '没有号码',
    resumeJson: JSON.stringify(emptyResume()),
    maxOriginalChars: 20,
  })
  if (straddled.maskedOriginal.includes(ID) || straddled.maskedOriginal.includes(PREFIX)) {
    fail('占位符回退出站仍有证件号')
  }
  if (/\d{15,}/u.test(straddled.maskedOriginal)) fail('占位符回退出站有 15 位以上连续数字')
  if (hasPartialPlaceholder(straddled.maskedOriginal)) fail('占位符回退出站留下半截占位符')
  pass('排版截断落在身份证占位符里时整段退回')

  const id15a = '110101900307887'
  const id15b = '320102880515666'
  const bank2 = '6214831234567890'
  const phone2 = '13900139000'
  const phone3 = '13700137000'
  const gluedCases = [
    ['两张 15 位身份证', `${id15a}${id15b}`],
    ['银行卡紧贴手机号', `${bank}${phone}`],
    ['两张银行卡', `${bank}${bank2}`],
    ['三个手机号', `${phone}${phone2}${phone3}`],
  ] as const
  for (const [label, raw] of gluedCases) {
    assertLongDigitRoundTrip(label, raw)
    await assertServiceBodyHasNoLongDigits(optimize, label, raw)
    pass(label)
  }
  assertSeededLongDigitRoundTrips()
  pass('固定种子的粘连号码 500 组还原后与原文一致，出站没有 11 位及以上连续数字')

  console.log(`verify:layout-mask-truncate ${passed()} PASS`)
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => {
    global.fetch = realFetch
  })
