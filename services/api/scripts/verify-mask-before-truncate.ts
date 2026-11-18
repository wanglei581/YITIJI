/**
 * 出站与落库先遮盖再截断。
 *
 * 证件号跨在字数上限上时，先截断会把前 10 位明文送进模型或写进库。
 * 每条用例都用「上限减 10 个乙 + 固定 18 位号」，断言出站正文或落库摘要里
 * 既没有整号，也没有前 10 位，并且出现了遮盖占位符（证明号就在截断窗口里）。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:mask-before-truncate
 */
import 'dotenv/config'
import type { LlmConfigService } from '../src/ai/llm/llm-config.service'
import type { GeneratedResume, ResumeReport } from '../src/ai/interfaces/ai-provider.interface'
import { AssistantSummaryService } from '../src/advisor/assistant-summary.service'
import { LlmAdvisorService } from '../src/advisor/llm-advisor.service'
import { LlmCareerPlanService } from '../src/ai/resume/llm-career-plan.service'
import { LlmFairVisitPlanService } from '../src/ai/resume/llm-fair-visit-plan.service'
import { LlmJobFitService } from '../src/ai/resume/llm-job-fit.service'
import { LlmResumeService } from '../src/ai/resume/llm-resume.service'
import { LlmResumeOptimizeService } from '../src/ai/resume/llm-resume-optimize.service'
import { LLM_MASK_INPUT_LIMIT, maskUserTextsForLlmReversible } from '../src/common/pii/llm-input-mask'
import { LLM_MASK_LONG_DIGIT_CATEGORY, LLM_MASK_PLACEHOLDER_CATEGORIES, llmMaskPlaceholderPattern } from '../src/common/pii/mask-placeholder'
import { layoutTokenPattern } from '../src/ai/resume/layout-adjust-digit-cover'
import { cutMaskedLayoutText, maskLayoutAdjustOutbound } from '../src/ai/resume/layout-adjust-mask'
import { JobAiLlmService } from '../src/job-ai/job-ai-llm.service'
import { MockInterviewLlmService } from '../src/mock-interview/mock-interview-llm.service'
import { MockInterviewService } from '../src/mock-interview/mock-interview.service'

process.env['AI_ENDPOINT_ALLOWLIST_EXTRA'] = [process.env['AI_ENDPOINT_ALLOWLIST_EXTRA'], 'llm.invalid']
  .filter(Boolean)
  .join(',')

const ID = '110101199003077777'
const PREFIX = '1101011990'
const PLACEHOLDER = '[身份证_'

let passCount = 0
function pass(message: string): void {
  passCount += 1
  console.log(`  PASS ${message}`)
}
function fail(message: string): never {
  console.error(`  FAIL ${message}`)
  throw new Error(message)
}

const captured: string[] = []
const realFetch = global.fetch

function installFakeLlm(): void {
  captured.length = 0
  global.fetch = (async (_url: string, init?: { body?: string }) => {
    captured.push(init?.body ?? '')
    return {
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: '{}' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      }),
    }
  }) as unknown as typeof fetch
}

function cross(limit: number): string {
  return `${'乙'.repeat(limit - 10)}${ID}`
}

function assertClean(label: string, text: string): void {
  if (text.includes(ID)) fail(`${label} 出站或落库含整号`)
  if (text.includes(PREFIX)) fail(`${label} 出站或落库含证件号前 10 位`)
  if (!text.includes(PLACEHOLDER)) fail(`${label} 没有遮盖占位符，跨边界号可能没进窗口`)
  pass(label)
}

const llmConfig = {
  getApiKey: () => 'test-key',
  getConfig: () => ({
    enabled: true,
    baseURL: 'https://llm.invalid/v1',
    model: 'stub-model',
    vendor: 'openai',
    temperature: 0.2,
    forbiddenWords: [] as string[],
  }),
  isReady: () => true,
} as unknown as LlmConfigService

async function outbound(label: string, run: () => Promise<unknown>, layout = false): Promise<void> {
  installFakeLlm()
  try {
    await run()
  } catch {
    // 假模型回的是空 JSON。断言只看已经发出去的正文。
  }
  if (captured.length === 0) fail(`${label} 没有出站`)
  for (const body of captured) {
    if (layout) assertLayoutMarked(`${label}#${captured.indexOf(body) + 1}`, body)
    else assertClean(`${label}#${captured.indexOf(body) + 1}`, body)
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

async function main(): Promise<void> {
  const summary = new AssistantSummaryService(
    {} as never,
    {} as never,
    llmConfig,
    {} as never,
    {} as never,
    {} as never,
  )
  await outbound('小青摘要用户轮 800', () =>
    (summary as unknown as {
      condense: (turns: Array<{ role: 'user' | 'assistant'; content: string }>) => Promise<unknown>
    }).condense([{ role: 'user', content: cross(800) }]))

  const jobs = new JobAiLlmService(llmConfig)
  await outbound('岗位推荐简历 6000', () => jobs.recommend(cross(6000), [{
    jobId: 'job-1',
    title: '测试岗位',
    company: '来源企业',
    sourceName: '来源平台',
    sourceUrl: 'https://example.invalid/job',
    externalId: 'ext-1',
    skills: [],
    city: '上海',
  }]))

  const advisor = new LlmAdvisorService(llmConfig)
  await outbound('比对材料 8000', () => advisor.compare(cross(8000), '岗位要求：能独立完成工作'))
  await outbound('比对要求 4000', () => advisor.compare('材料里写了项目经历', cross(4000)))

  const interviewLlm = new MockInterviewLlmService(llmConfig)
  const questionBase = {
    interviewerType: 'hr',
    industry: '软件',
    position: '测试岗位',
    experience: 'y1_3',
    difficulty: 'standard',
    questionTarget: 4,
    askedCount: 1,
  }
  await outbound('面试出题摘要 3000', () => interviewLlm.nextQuestion({
    ...questionBase,
    resumeDigest: cross(3000),
    transcript: [],
  }))
  await outbound('面试出题回答 500', () => interviewLlm.nextQuestion({
    ...questionBase,
    resumeDigest: null,
    transcript: [{ role: 'candidate', content: cross(500) }],
  }))
  await outbound('面试报告摘要 3000', () => interviewLlm.buildReport({
    ...questionBase,
    resumeDigest: cross(3000),
    transcript: [{ role: 'candidate', content: '做过一个内部工具' }],
  }))
  await outbound('面试报告回答 800', () => interviewLlm.buildReport({
    ...questionBase,
    resumeDigest: null,
    transcript: [{ role: 'candidate', content: cross(800) }],
  }))

  let storedDigest = ''
  const interviews = new MockInterviewService(
    {
      fileObject: { findUnique: async () => ({ endUserId: 'member-1' }) },
      mockInterviewSession: {
        create: async ({ data }: { data: { resumeDigest?: string | null; interviewerType: string; durationMin: number; questionTarget: number } }) => {
          storedDigest = data.resumeDigest ?? ''
          return { id: 'iv-1', interviewerType: data.interviewerType, durationMin: data.durationMin, questionTarget: data.questionTarget }
        },
      },
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    { extractResumeText: async () => ({ ok: true, text: cross(6000) }) } as never,
    { write: async () => undefined } as never,
    {} as never,
    {} as never,
  )
  await interviews.createSession({
    interviewerType: 'hr',
    industry: '软件',
    position: '测试岗位',
    experience: 'y1_3',
    difficulty: 'standard',
    durationMin: 5,
    resumeFileId: 'file-1',
  }, { endUserId: 'member-1', accessToken: null })
  assertClean('面试摘要落库 6000', storedDigest)

  const fair = new LlmFairVisitPlanService(llmConfig)
  await outbound('参会准备简历 8000', () => fair.build({
    resumeText: cross(8000),
    mode: 'preparation',
    fair: {
      id: 'fair-1',
      title: '春季招聘会',
      sourceName: '来源机构',
      sourceUrl: 'https://example.invalid/fair',
      startAt: '2026-04-01T01:00:00.000Z',
      endAt: '2026-04-01T09:00:00.000Z',
      venue: '来源场馆',
      city: '上海',
    },
    fairCompanies: [],
  }))

  const diagnosis = new LlmResumeService(llmConfig)
  await outbound('简历诊断 12000', () => diagnosis.diagnose(cross(12000)))

  const fit = new LlmJobFitService(llmConfig)
  await outbound('岗位对照简历 8000', () => fit.analyze(cross(8000), { title: '测试岗位' }))

  const career = new LlmCareerPlanService(llmConfig)
  await outbound('职业规划简历 8000', () => career.build({ resumeText: cross(8000) }))

  const optimize = new LlmResumeOptimizeService(llmConfig)
  const report = { sections: [], suggestions: [] } as ResumeReport
  await outbound('简历优化 12000', () => optimize.optimize(cross(12000), report))

  const current = emptyResume()
  const json = JSON.stringify(current)
  const values = ['甲', '测试岗位'].join('\n')
  const split = '\n<<<PII_MASK_SPLIT>>>\n'
  const room = Math.max(0, LLM_MASK_INPUT_LIMIT - json.length - values.length - split.length * 2)
  if (room <= 12000) fail(`排版夹具预算 ${room} 没有留在 12000 字截断上`)
  const layoutText = `${cross(12000)}${'丙'.repeat(40)}`
  await outbound('排版原文 12000', () => optimize.adjustLayoutDraft({
    currentResume: current,
    originalText: layoutText,
    action: 'reformat',
  }), true)

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

  console.log(`verify:mask-before-truncate ${passCount} PASS`)
}

function statusOf(error: unknown): number {
  if (!error || typeof error !== 'object' || !('getStatus' in error)) return 0
  const getStatus = (error as { getStatus?: () => number }).getStatus
  return typeof getStatus === 'function' ? getStatus.call(error) : 0
}

function codeOf(error: unknown): string {
  if (!error || typeof error !== 'object' || !('getResponse' in error)) return ''
  const getResponse = (error as { getResponse?: () => unknown }).getResponse
  if (typeof getResponse !== 'function') return ''
  const body = getResponse.call(error) as { error?: { code?: string } }
  return typeof body?.error?.code === 'string' ? body.error.code : ''
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

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
  })
  .finally(() => {
    global.fetch = realFetch
  })
