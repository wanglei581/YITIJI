import { ConsoleLogger, Logger } from '@nestjs/common'
import type { ResumeReport } from '../../src/ai/interfaces/ai-provider.interface'
import { LlmResumeOptimizeService, OPTIMIZE_RETRY_HINT, OPTIMIZE_SYSTEM_PROMPT } from '../../src/ai/resume/llm-resume-optimize.service'
import { resumeFieldIncludes } from '../../src/ai/resume/resume-optimize-after-align'

/**
 * 与一体机 resumeDecisions.ts 的 resumeContainsText 同一判据。
 * 门禁自己写一份，避免服务端把判据改松后用例跟着放水。
 */
function kioskIncludes(resume: unknown, text: string): boolean {
  if (!text) return false
  if (typeof resume === 'string') return resume.includes(text)
  if (Array.isArray(resume)) return resume.some((value) => kioskIncludes(value, text))
  if (resume && typeof resume === 'object') {
    return Object.values(resume as Record<string, unknown>).some((value) => kioskIncludes(value, text))
  }
  return false
}

function pass(message: string) { console.log(`  PASS ${message}`) }
function fail(message: string): never { throw new Error(message) }

const VERBATIM = '独立完成门店日结，逐笔核对收银差异，并整理晚班货架。'
const LEDGER = '按到货清单完成收货验收，并登记入库台账。'
const LEDGER_AFTER = `  ${LEDGER}\n`
const RESET_FIELD = '协调晚班理货，保证常温货位在打烊前复位。'
const RESET_AFTER = '协调晚班理货,保证常温货位在打烊前复位.'
const SHELF_FIELD = '把常温饮料按动销补到货架前端。'
const SHELF_AFTER = '把常温饮料按动销补到货架前端.'
const SPLIT_AFTER = `${LEDGER}${RESET_FIELD}`

const BEFORE_DAY = '负责门店日结，核对收银差异，并整理晚班货架。'
const BEFORE_LEDGER = '负责收货验收并登记台账。'
const BEFORE_NIGHT = '同时安排晚班理货。'
const BEFORE_SHELF = '按动销把常温饮料补到货架前端。'
const BEFORE_SPLIT = '收银对账与货架陈列'
const BEFORE_CERT = '食品从业人员健康证明'

const SOURCE = [
  '陈敬之',
  '求职意向 门店运营',
  '个人简介',
  '做过茶饮门店和仓储收货，想继续做门店运营。',
  '教育经历',
  '杭州开放大学 工商管理 专科 2016.09-2019.06',
  '工作经历',
  '临安青禾茶饮店 店员 2019.08-2022.03',
  BEFORE_DAY,
  '余杭北苑仓储中心 收货员 2022.04-2025.11',
  BEFORE_LEDGER,
  BEFORE_NIGHT,
  '项目经历',
  `常温饮料补货 2023.05-2023.06`,
  BEFORE_SHELF,
  '技能',
  BEFORE_SPLIT,
  '证书',
  BEFORE_CERT,
].join('\n')

function modelPayload(): string {
  return JSON.stringify({
    resume: {
      basic: { name: '陈敬之', phone: '', email: '', city: '' },
      intention: { position: '门店运营', city: '' },
      summary: SHELF_FIELD,
      education: [{
        school: '杭州开放大学', major: '工商管理', degree: '专科', period: '2016.09-2019.06',
        description: RESET_FIELD,
      }],
      experience: [
        { company: '临安青禾茶饮店', role: '店员', period: '2019.08-2022.03', description: VERBATIM },
        { company: '余杭北苑仓储中心', role: '收货员', period: '2022.04-2025.11', description: LEDGER },
      ],
      projects: [{ name: '常温饮料补货', role: '补货', description: SHELF_FIELD }],
      skills: [BEFORE_SPLIT],
      certificates: [BEFORE_CERT],
    },
    modules: [
      { title: '日结对账', before: BEFORE_DAY, after: VERBATIM },
      { title: '收货台账', before: BEFORE_LEDGER, after: LEDGER_AFTER },
      { title: '晚班复位', before: BEFORE_NIGHT, after: RESET_AFTER },
      { title: '货架补位', before: BEFORE_SHELF, after: SHELF_AFTER },
      { title: '两段并成一句', before: BEFORE_SPLIT, after: SPLIT_AFTER },
      { title: '健康证明', before: BEFORE_CERT, after: '' },
    ],
  })
}

/** 脱敏样本走真实 optimize()：最终返回给一体机的 modules 按 includes(after) 验收。 */
export async function verifyOptimizeAfterMatch(): Promise<void> {
  console.log('\n=== 优化建议 after 必须能在最终稿里逐字找到 ===')
  if (!OPTIMIZE_SYSTEM_PROMPT.includes('逐字一致') || !OPTIMIZE_SYSTEM_PROMPT.includes('不得拆开写进两个字段')) {
    fail('提示词未要求 after 与优化稿同一个字段逐字一致')
  }
  if (!OPTIMIZE_RETRY_HINT.includes('同一个字符串字段')) fail('重试提示未要求 after 落在同一个字段')
  pass('提示词要求每条 after 逐字落在同一个字段')

  const logs: string[] = []
  const originalFetch = globalThis.fetch
  let calls = 0
  Logger.overrideLogger({
    log: (message: unknown) => { logs.push(String(message)) },
    error: () => undefined,
    warn: () => undefined,
    debug: () => undefined,
    verbose: () => undefined,
    fatal: () => undefined,
  })
  globalThis.fetch = async () => {
    calls += 1
    return new Response(JSON.stringify({ choices: [{ message: { content: modelPayload() } }] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  try {
    const svc = new LlmResumeOptimizeService({
      getApiKey: () => 'stub-key',
      getConfig: () => ({
        enabled: true, vendor: 'deepseek', model: 'stub',
        baseURL: 'https://api.deepseek.com/v1', forbiddenWords: [],
      }),
    } as never)
    const report = { sections: [], suggestions: [] } as ResumeReport
    const result = await svc.optimize(SOURCE, report)
    if (calls !== 1) fail(`这条样本一次就能返回，实际打了 ${calls} 次模型`)

    const byTitle = new Map(result.modules.map((module) => [module.title, module.after]))
    const found = (title: string): boolean => {
      const after = byTitle.get(title)
      if (after === undefined) fail(`返回的建议里没有「${title}」`)
      return kioskIncludes(result.optimizedResume, after)
    }

    if (!found('日结对账') || byTitle.get('日结对账') !== VERBATIM) fail('逐字命中的日结对账应能换上，且 after 保持原文')
    if (!found('收货台账') || byTitle.get('收货台账') !== LEDGER) fail('首尾空白差异应规范成稿里的收货台账原文')
    if (!found('晚班复位') || byTitle.get('晚班复位') !== RESET_FIELD) fail('唯一的全半角标点差异应规范成稿里的晚班复位原文')
    if (found('货架补位') || byTitle.get('货架补位') !== SHELF_AFTER) fail('两处相似的货架补位不得规范，应保持只能手改')
    if (found('两段并成一句') || byTitle.get('两段并成一句') !== SPLIT_AFTER) fail('跨字段拆开的改写应保持只能手改')
    if (byTitle.has('健康证明') || result.modules.some((module) => module.after === '')) {
      fail('空 after 不应出现在返回给一体机的建议里')
    }
    if (kioskIncludes(result.optimizedResume, '')) fail('空 after 被判成能在稿里找到')

    for (const module of result.modules) {
      const same = resumeFieldIncludes(result.optimizedResume, module.after) === kioskIncludes(result.optimizedResume, module.after)
      if (!same) fail(`服务端判据和一体机不一致：${module.title}`)
    }

    const resumeJson = JSON.stringify(result.optimizedResume)
    const shelfCount = resumeJson.split(SHELF_FIELD).length - 1
    if (shelfCount !== 2) fail(`货架补位的相似句应仍是稿里原有的两处，实际 ${shelfCount} 处`)
    if (resumeJson.includes(SHELF_AFTER) || resumeJson.includes(RESET_AFTER) || resumeJson.includes(SPLIT_AFTER)) {
      fail('有界修复改写了优化稿正文')
    }
    if (!resumeJson.includes(LEDGER) || resumeJson.includes(LEDGER_AFTER)) fail('收货台账字段不应被改成带首尾空白的 after')

    const log = logs.find((line) => line.includes('resume optimize: after-match'))
    if (!log) fail('没有写下 after 通过率')
    const matched = result.modules.filter((module) => kioskIncludes(result.optimizedResume, module.after)).length
    if (!log.includes(`total=${result.modules.length}`) || !log.includes(`pass=${matched}`)) {
      fail(`通过率条数和返回结果不一致：${log}`)
    }
    if (log.includes('陈敬之') || log.includes('临安青禾') || log.includes(VERBATIM) || log.includes('stub-key')) {
      fail('通过率日志写入了简历正文或令牌')
    }
    pass(`6 类样本：能换上 ${matched} 条，只能手改 ${result.modules.length - matched} 条，空 after 已丢弃；模型调用 ${calls} 次`)
  } finally {
    globalThis.fetch = originalFetch
    Logger.overrideLogger(new ConsoleLogger())
  }
}

/**
 * 优化这条路：模型把简介写成 300 字以上时，返回稿里的简介必须整段留下。
 * 2026-11-12 起排版调整也不再把简介截在 300 字，320 字必须整段留下。
 */
export async function verifyOptimizeSummaryLimit(): Promise<void> {
  console.log('\n=== 优化稿与排版调整的简介超过 300 字时都完整保留 ===')
  const sentence = '熟悉门店日常运营并保持货架整洁。'
  const longSummary = sentence.repeat(20)
  if (longSummary.length <= 300) fail(`夹具简介应超过 300 字，实际 ${longSummary.length}`)
  const original = ['陈敬之', '门店运营', '临安青禾茶饮店', '独立完成门店日结核对。', longSummary].join('\n')
  const optimizePayload = JSON.stringify({
    resume: {
      basic: { name: '陈敬之', phone: '', email: '', city: '' },
      intention: { position: '门店运营', city: '' },
      summary: `  ${longSummary}\n`,
      education: [],
      experience: [{ company: '临安青禾茶饮店', role: '店员', period: '2019.08-2022.03', description: '独立完成门店日结核对。' }],
      projects: [],
      skills: [],
      certificates: [],
    },
    modules: [{ title: '日结', before: '独立完成门店日结核对。', after: '独立完成门店日结核对。' }],
  })
  const currentResume = {
    basic: { name: '陈敬之' },
    intention: { position: '门店运营' },
    summary: '短简介',
    education: [],
    experience: [],
    projects: [],
    skills: [],
    certificates: [],
  }
  const layoutPayload = JSON.stringify({
    resume: {
      ...currentResume,
      summary: longSummary,
    },
    warnings: [],
  })

  const originalFetch = globalThis.fetch
  const run = async (content: string, callsExpected: number, use: (svc: LlmResumeOptimizeService) => Promise<void>) => {
    let calls = 0
    globalThis.fetch = async () => {
      calls += 1
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    const svc = new LlmResumeOptimizeService({
      getApiKey: () => 'stub-key',
      getConfig: () => ({
        enabled: true, vendor: 'deepseek', model: 'stub',
        baseURL: 'https://api.deepseek.com/v1', forbiddenWords: [],
      }),
    } as never)
    try {
      await use(svc)
    } finally {
      globalThis.fetch = originalFetch
    }
    if (calls !== callsExpected) fail(`模型调用次数应为 ${callsExpected}，实际 ${calls}`)
  }

  Logger.overrideLogger({ log: () => undefined, error: () => undefined, warn: () => undefined, debug: () => undefined, verbose: () => undefined, fatal: () => undefined })
  try {
    await run(optimizePayload, 1, async (svc) => {
      const report = { sections: [], suggestions: [] } as ResumeReport
      const result = await svc.optimize(original, report)
      if (result.optimizedResume.summary !== longSummary) {
        fail(`优化稿简介应完整保留 ${longSummary.length} 字，实际 ${result.optimizedResume.summary.length} 字`)
      }
    })
    pass(`优化稿简介 ${longSummary.length} 字完整保留，没有截在 300 字`)

    await run(layoutPayload, 1, async (svc) => {
      const result = await svc.adjustLayoutDraft({
        currentResume: currentResume as never,
        originalText: original,
        action: 'reformat',
      })
      if (result.resume.summary !== longSummary || result.resume.summary.length !== 320) {
        fail(`排版调整简介应整段保留 320 字，实际 ${result.resume.summary.length} 字`)
      }
    })
    pass('排版调整简介 320 字完整保留（2026-11-12 起不再截在 300 字）')
  } finally {
    globalThis.fetch = originalFetch
    Logger.overrideLogger(new ConsoleLogger())
  }
}

const SAME_TEXT_NAME = '陈敬之'
const SAME_NORMAL_BEFORE = '负责门店公众号的选题和排版。'
const SAME_NORMAL_AFTER = '负责门店公众号的选题、排版和推送。'
const SAME_EXACT = '协助组织迎新志愿服务。'
const SAME_SPACED = '整理活动签到表和物资。'

function sameTextResume(summary: string, skills: string[] = []): Record<string, unknown> {
  return {
    basic: { name: SAME_TEXT_NAME, phone: '', email: '', city: '' },
    intention: { position: '门店运营', city: '' },
    summary,
    education: [],
    experience: [],
    projects: [],
    skills,
    certificates: [],
  }
}

async function runOptimize(
  original: string,
  content: string,
  logs: string[],
): Promise<Awaited<ReturnType<LlmResumeOptimizeService['optimize']>>> {
  const originalFetch = globalThis.fetch
  Logger.overrideLogger({
    log: (message: unknown) => { logs.push(String(message)) },
    error: () => undefined,
    warn: (message: unknown) => { logs.push(String(message)) },
    debug: () => undefined,
    verbose: () => undefined,
    fatal: () => undefined,
  })
  globalThis.fetch = async () => new Response(JSON.stringify({
    choices: [{ message: { content } }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  try {
    const svc = new LlmResumeOptimizeService({
      getApiKey: () => 'stub-key',
      getConfig: () => ({
        enabled: true, vendor: 'deepseek', model: 'stub',
        baseURL: 'https://api.deepseek.com/v1', forbiddenWords: [],
      }),
    } as never)
    return await svc.optimize(original, { sections: [], suggestions: [] } as ResumeReport)
  } finally {
    globalThis.fetch = originalFetch
    Logger.overrideLogger(new ConsoleLogger())
  }
}

/**
 * 同文条目在对齐之后丢掉：改写与原文逐字相同、只差首尾空白的都不返回。
 * 稿子本身不因多了这两条而改字。对齐把句号折回原文之后才相同的，另测一条。
 */
export async function verifyOptimizeSameTextEntries(): Promise<void> {
  console.log('\n=== 同文条目不返回，优化稿一字不改 ===')
  const original = [SAME_TEXT_NAME, SAME_NORMAL_BEFORE, SAME_EXACT, SAME_SPACED].join('\n')
  const summary = `${SAME_NORMAL_AFTER}${SAME_EXACT}${SAME_SPACED}`
  const resume = sameTextResume(summary)
  const normalModule = { title: '选题改写', before: SAME_NORMAL_BEFORE, after: SAME_NORMAL_AFTER }
  const withSame = JSON.stringify({
    resume,
    modules: [
      normalModule,
      { title: '逐字相同', before: SAME_EXACT, after: SAME_EXACT },
      { title: '只差空白', before: SAME_SPACED, after: `  ${SAME_SPACED}\n` },
    ],
  })
  const withoutSame = JSON.stringify({ resume, modules: [normalModule] })
  const logs: string[] = []
  const kept = await runOptimize(original, withSame, logs)
  const plain = await runOptimize(original, withoutSame, [])
  if (kept.modules.length !== 1 || kept.modules[0]?.before !== SAME_NORMAL_BEFORE || kept.modules[0]?.after !== SAME_NORMAL_AFTER) {
    fail(`同文条目应只留下正常改写，实际 ${kept.modules.map((item) => item.title).join('、') || '空'}`)
  }
  if (JSON.stringify(kept.optimizedResume) !== JSON.stringify(plain.optimizedResume)) {
    fail('去掉同文条目后，优化稿必须与从不返回这两条时逐字相同')
  }
  const logged = logs.join('\n')
  if (!logged.includes('sameText=2')) fail(`日志应记下 sameText=2，实际 ${logged}`)
  for (const sentence of [SAME_NORMAL_BEFORE, SAME_NORMAL_AFTER, SAME_EXACT, SAME_SPACED]) {
    if (logged.includes(sentence)) fail('同文计数日志不得记下正文')
  }
  pass('逐字相同和只差首尾空白的条目被去掉，优化稿不变，日志只有 sameText=2')

  const punctBefore = SAME_SPACED
  const punctSummary = `${SAME_NORMAL_AFTER}${punctBefore}`
  const punctResume = sameTextResume(punctSummary)
  const punctLogs: string[] = []
  const aligned = await runOptimize(original, JSON.stringify({
    resume: punctResume,
    modules: [
      normalModule,
      { title: '只差句号', before: punctBefore, after: punctBefore.replace('。', '.') },
    ],
  }), punctLogs)
  const alignedPlain = await runOptimize(original, JSON.stringify({
    resume: punctResume,
    modules: [normalModule],
  }), [])
  if (aligned.modules.length !== 1 || aligned.modules[0]?.after !== SAME_NORMAL_AFTER) {
    fail(`对齐后才相同的条目仍被返回：${aligned.modules.map((item) => item.title).join('、')}`)
  }
  if (JSON.stringify(aligned.optimizedResume) !== JSON.stringify(alignedPlain.optimizedResume)) {
    fail('对齐后丢掉的同文条目不得改动优化稿')
  }
  const punctLogged = punctLogs.join('\n')
  if (!punctLogged.includes('sameText=1')) fail(`对齐后同文应记 sameText=1，实际 ${punctLogged}`)
  if (punctLogged.includes(punctBefore) || punctLogged.includes(SAME_NORMAL_AFTER)) fail('对齐同文的日志不得记下正文')
  pass('对齐把句号折回原文之后，同文条目同样不返回')

  // 只差首尾空白，但带空白的 after 已经是稿里某个字段的子串：对齐走逐字命中，原样留下 after，不会把空白收成 before。
  // 这时仍须按去掉首尾空白后与原文相同来丢掉。改成比原始字符串 module.after !== module.before 会把这一条留下。
  const paddedAfter = `  ${SAME_SPACED}\n`
  const hostSummary = `${SAME_NORMAL_AFTER}活动之后仍要${paddedAfter}请本人核对。`
  if (!hostSummary.includes(paddedAfter)) fail('夹具应让带首尾空白的 after 整段出现在简介里')
  if (paddedAfter.trim() !== SAME_SPACED || paddedAfter === SAME_SPACED) fail('这条夹具必须只差首尾空白')
  const untouchedResume = sameTextResume(hostSummary)
  const spacedLogs: string[] = []
  const spaced = await runOptimize([SAME_TEXT_NAME, SAME_NORMAL_BEFORE, SAME_SPACED].join('\n'), JSON.stringify({
    resume: untouchedResume,
    modules: [
      normalModule,
      { title: '只差空白未对齐', before: SAME_SPACED, after: paddedAfter },
    ],
  }), spacedLogs)
  const spacedPlain = await runOptimize([SAME_TEXT_NAME, SAME_NORMAL_BEFORE, SAME_SPACED].join('\n'), JSON.stringify({
    resume: untouchedResume,
    modules: [normalModule],
  }), [])
  if (spaced.modules.some((item) => item.title === '只差空白未对齐' || item.after === paddedAfter)) {
    fail(`对齐没有收掉首尾空白时，同文条目仍应丢掉，实际 ${spaced.modules.map((item) => item.title).join('、')}`)
  }
  if (spaced.modules.length !== 1 || spaced.modules[0]?.after !== SAME_NORMAL_AFTER) {
    fail(`应只留下正常改写，实际 ${spaced.modules.map((item) => `${item.title}:${item.after}`).join('、') || '空'}`)
  }
  if (JSON.stringify(spaced.optimizedResume) !== JSON.stringify(spacedPlain.optimizedResume)) {
    fail('丢掉这条同文时不得改优化稿')
  }
  const spacedSummary = spaced.optimizedResume.summary
  if (!spacedSummary.includes(paddedAfter)) {
    fail(`稿里那处带首尾空白的原文应原样留下，说明对齐没有改写 after，实际简介：${JSON.stringify(spacedSummary)}`)
  }
  const spacedLogged = spacedLogs.join('\n')
  if (!spacedLogged.includes('sameText=1')) fail(`只差空白且对齐未处理应记 sameText=1，实际 ${spacedLogged}`)
  if (spacedLogged.includes(SAME_SPACED) || spacedLogged.includes(paddedAfter.trim())) fail('这条同文的日志不得记下正文')
  pass('只差首尾空白、对齐不处理的条目仍不返回，优化稿不变')
}

/** 优化这条路的技能不再截在 40 字。60 字整段留下，不按句号拆开。 */
export async function verifyOptimizeSkillKept(): Promise<void> {
  console.log('\n=== 优化稿技能超过 40 字时完整保留 ===')
  const skill = '熟悉门店的收银对账。'.repeat(6)
  if (skill.length !== 60) fail(`技能夹具应为 60 字，实际 ${skill.length}`)
  const original = [SAME_TEXT_NAME, skill, '做过茶饮门店。'].join('\n')
  const result = await runOptimize(original, JSON.stringify({
    resume: sameTextResume('做过茶饮门店。', [skill]),
    modules: [],
  }), [])
  if (result.optimizedResume.skills[0] !== skill || result.optimizedResume.skills[0]?.length !== 60) {
    fail(`优化稿技能应完整保留 60 字，实际 ${result.optimizedResume.skills[0]?.length ?? 0} 字`)
  }
  pass('优化稿技能 60 字完整保留，没有截在 40 字')
}

/** 原文里有的 70 字证书必须整段留下。先截成 60 再查原文会只留下前缀。 */
export async function verifyOptimizeLongCertificateKept(): Promise<void> {
  console.log('\n=== 优化稿证书超过 60 字时完整保留 ===')
  const certificate = '持普通话水平测试二级甲等证书'.repeat(5)
  if (certificate.length !== 70) fail(`证书夹具应为 70 字，实际 ${certificate.length}`)
  const original = [SAME_TEXT_NAME, certificate, '做过茶饮门店。'].join('\n')
  const result = await runOptimize(original, JSON.stringify({
    resume: { ...sameTextResume('做过茶饮门店。'), certificates: [certificate] },
    modules: [],
  }), [])
  const kept = result.optimizedResume.certificates[0] ?? ''
  if (kept !== certificate || kept.length !== 70) {
    fail(`优化稿证书应完整保留 70 字，实际 ${kept.length} 字`)
  }
  pass('原文里有的 70 字证书完整保留，没有截在 60 字')
}

const ENTRY_MARKS = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸', '子', '丑', '寅', '卯'] as const

/**
 * 原文 10 段经历、14 段项目时，模型只交回前 8 段和前 6 段，其余按原文补回。
 * 14 段项目超过导出上限 12，多出来的两段并进最后一条描述，句子仍在。
 * 技能、证书整段非空就不补单行，所以模型必须交回全部 25 项和 18 个，解析上限不能再把它们切掉。
 */
export async function verifyOptimizeEntryCountsKept(): Promise<void> {
  console.log('\n=== 优化稿经历、项目、技能、证书条数不丢原文 ===')
  const experiences = ENTRY_MARKS.slice(0, 10).map((mark, index) => {
    const company = `青州${mark}厂有限公司`
    const month = String(index + 1).padStart(2, '0')
    return {
      company,
      line: `${company} 2018.${month} - 2018.12`,
      original: `维护${mark}号车间的设备台账。`,
      rewrite: `改写${mark}号车间的设备台账。`,
    }
  })
  const projects = ENTRY_MARKS.map((mark, index) => {
    const name = `青州${mark}项`
    const year = 2020 + index
    return {
      name,
      line: `${name} ${year}.03 - ${year}.06`,
      original: `整理${mark}号同学的投稿说明。`,
      rewrite: `改写${mark}号同学的投稿说明。`,
    }
  })
  const skills = Array.from({ length: 25 }, (_, index) => `技能条目${String(index + 1).padStart(2, '0')}`)
  const certificates = Array.from({ length: 18 }, (_, index) => `资格证书${String(index + 1).padStart(2, '0')}`)
  const original = [
    '周启明',
    '工作经历',
    ...experiences.flatMap((item) => [item.line, item.original]),
    '项目经历',
    ...projects.flatMap((item) => [item.line, item.original]),
    '技能',
    ...skills,
    '证书',
    ...certificates,
  ].join('\n')
  const result = await runOptimize(original, JSON.stringify({
    resume: {
      basic: { name: '周启明', phone: '', email: '', city: '' },
      intention: { position: '', city: '' },
      summary: '做过校园媒体。',
      education: [],
      experience: experiences.slice(0, 8).map((item) => ({
        company: item.company, role: '', period: '', description: item.rewrite,
      })),
      projects: projects.slice(0, 6).map((item) => ({
        name: item.name, role: '', description: item.rewrite,
      })),
      skills,
      certificates,
    },
    modules: [],
  }), [])
  const resume = result.optimizedResume
  if (resume.experience.length !== 10) fail(`经历应为 10 条，实际 ${resume.experience.length}`)
  experiences.forEach((item, index) => {
    const text = `${resume.experience[index]?.company ?? ''}\n${resume.experience[index]?.description ?? ''}`
    const expected = index < 8 ? item.rewrite : item.original
    if (!text.includes(item.company) || !text.includes(expected)) {
      fail(`第 ${index + 1} 段经历应保留「${expected}」，实际 ${text}`)
    }
  })
  if (resume.projects.length !== 12) fail(`项目超过导出上限后应为 12 条，实际 ${resume.projects.length}`)
  const projectText = JSON.stringify(resume.projects)
  projects.forEach((item, index) => {
    const expected = index < 6 ? item.rewrite : item.original
    if (!projectText.includes(expected)) fail(`第 ${index + 1} 段项目的「${expected}」不在优化稿里`)
  })
  if (resume.skills.length !== skills.length || skills.some((skill, index) => resume.skills[index] !== skill)) {
    fail(`技能应为原文 25 项，实际 ${resume.skills.length} 项`)
  }
  if (resume.certificates.length !== certificates.length || certificates.some((cert, index) => resume.certificates[index] !== cert)) {
    fail(`证书应为原文 18 个，实际 ${resume.certificates.length} 个`)
  }
  pass('10 段经历、14 段项目的句子都在，25 项技能和 18 个证书逐条保留')
}

if (process.argv[1]?.endsWith('resume-optimize-after-match.ts')) {
  verifyOptimizeAfterMatch()
    .then(() => verifyOptimizeSummaryLimit())
    .then(() => verifyOptimizeSameTextEntries())
    .then(() => verifyOptimizeSkillKept())
    .then(() => verifyOptimizeLongCertificateKept())
    .then(() => verifyOptimizeEntryCountsKept())
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error)
      process.exit(1)
    })
}
