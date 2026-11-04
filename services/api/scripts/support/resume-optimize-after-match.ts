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

if (process.argv[1]?.endsWith('resume-optimize-after-match.ts')) {
  verifyOptimizeAfterMatch().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
