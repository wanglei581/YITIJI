/**
 * A-6 AI 成本可见性覆盖验证（静态代码分析，不触网，可进 CI）。
 *
 * 验证内容：
 *  1. 后端 AiOperation 联合类型包含所有15个能力
 *  2. NON_TOKEN_BILLED_OPERATIONS 声明 voiceTranscribe / voiceSynthesize
 *  3. careerPlan / fairVisitPlan 的 service 层存在 recordAiLog 模式
 *  4. interviewQuestion / interviewReport 的 service 层存在 recordAiLog 模式
 *  5. voiceTranscribe / voiceSynthesize 的 controller 层存在 aiLog.record 调用
 *  6. 前端 Admin AiOperation 类型与后端保持同步
 *  7. OPERATION_LABELS 覆盖所有新增操作
 *  8. callCount === 0 guard 存在于关键 service 层
 *
 * 运行：pnpm --filter @ai-job-print/api verify:ai-cost-coverage
 */
import { existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const ROOT = join(__dirname, '..')
const APPS_ROOT = join(ROOT, '..', '..', 'apps')

let passCount = 0
let failCount = 0

function pass(msg: string) { passCount += 1; console.log(`  PASS ${msg}`) }
function fail(msg: string) { failCount += 1; console.error(`  FAIL ${msg}`) }

function read(rel: string): string {
  const path = join(ROOT, rel)
  if (!existsSync(path)) { fail(`文件不存在: ${rel}`); return '' }
  return readFileSync(path, 'utf8')
}

function readApps(rel: string): string {
  const path = join(APPS_ROOT, rel)
  if (!existsSync(path)) { fail(`文件不存在: apps/${rel}`); return '' }
  return readFileSync(path, 'utf8')
}

function assertContains(src: string, pattern: string | RegExp, label: string) {
  const ok = typeof pattern === 'string' ? src.includes(pattern) : pattern.test(src)
  ok ? pass(label) : fail(label)
}

function assertNotContains(src: string, pattern: string | RegExp, label: string) {
  const bad = typeof pattern === 'string' ? src.includes(pattern) : pattern.test(src)
  bad ? fail(label) : pass(label)
}

// ─── 1. 后端 AiOperation 联合类型 ─────────────────────────────────────────────

const logSvc = read('src/ai/ai-log.service.ts')

// ⚠️ 这里过去写死 7 个 operation，而真值源 AiOperation 有 16 个 —— 名为 coverage
// 实则只守一半。selfAssessment 这条**付费**调用零 token 落账、Admin 渲染成 ¥0.0000
// 就是从这个缺口漏过去的。改为从联合类型**派生**：新增 operation 自动纳管，
// 忘了接线就红，不再依赖「有人记得回来加一行」。
const ALL_OPS = (() => {
  const block = logSvc.match(/export type AiOperation =([\s\S]*?)\n\n/u)?.[1] ?? ''
  return [...block.matchAll(/\|\s*'([A-Za-z]+)'/gu)].map((m) => m[1] as string)
})()

if (ALL_OPS.length >= 16) pass(`AiOperation 派生成功: ${ALL_OPS.length} 个 operation`)
else fail(`AiOperation 派生失败: 只解析出 ${ALL_OPS.length} 个（解析规则已失效，必须修门禁）`)

// 保留原有 7 个的逐条断言（不删、不放宽），其余由下面的派生清单覆盖
const NEW_OPS = ['careerPlan', 'fairVisitPlan', 'interviewQuestion', 'interviewReport', 'voiceTranscribe', 'voiceSynthesize', 'adjustResumeLayout']

for (const op of NEW_OPS) {
  assertContains(logSvc, `'${op}'`, `后端 AiOperation 包含: ${op}`)
}

// ─── 1b. 派生：每个按 token 计费的 operation 都必须真的收 token ──────────────
//
// 这是本门禁原来最大的洞：它只按名字检查 7 个 operation 的接线，
// 完全没有「每个 operation 都得有 token 落账」这条横向断言。
// 结果 selfAssessment 这条**付费**调用零 token 落账，
// Admin 却把它当 token 计费能力渲染成 ¥0.0000 + 「按 token 用量」。
//
// 规则：token 计费 operation 的每个落账点所在文件都必须有 token 管路
// （tokenUsage 字段）。没有 → 必须在 KNOWN_ZERO_COST_GAPS 显式登记并写明原因。

function walkTs(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${entry.name}`
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'generated') continue
      walkTs(rel, acc)
    } else if (entry.name.endsWith('.ts') && !rel.includes('__tests__')) acc.push(rel)
  }
  return acc
}

const SRC_FILES = walkTs('src').map((rel) => ({ rel, src: readFileSync(join(ROOT, rel), 'utf8') }))
const NON_TOKEN_BILLED = ['voiceTranscribe', 'voiceSynthesize']

/**
 * 已知「按 token 计费但当前零 token 落账」的缺口。
 *
 * ⚠️ 这不是豁免清单，是**欠账清单**：登记在此的 operation 今天在 Admin 上
 * 仍然显示为 ¥0.0000，即对真实付费调用少算成本。登记只是为了让它可见、
 * 可追踪、不再静默扩张 —— 不代表它已经修好。
 *
 * MAX_GAPS 是棘轮：**只允许调低**。想加新欠账，先还一条旧的。
 */
const KNOWN_ZERO_COST_GAPS: Record<string, string> = {
  parseResume:
    '落账点 src/ai/ai.service.ts 走 AiProvider 抽象，provider 层（llm.provider.ts）不回传 token usage，' +
    '且 provider 标签恒为 "llm"（不含厂商名），estimateCostCny 因此永远匹配不到单价。' +
    '修复需改 AiProvider 接口并同步 mock provider，属独立范围。',
  optimizeResume: '同 parseResume：经 AiProvider 抽象落账，provider 层不回传 token usage，标签恒为 "llm"。',
  adjustResumeLayout: '同 parseResume：经 AiProvider 抽象落账，provider 层不回传 token usage，标签恒为 "llm"。',
  generateResume: '同 parseResume：经 AiProvider 抽象落账，provider 层不回传 token usage，标签恒为 "llm"。',
  chatAssistant:
    '双落账点：src/advisor/advisor.service.ts 已带 token usage；' +
    'src/ai/ai.service.ts 这一路经 AiProvider 抽象，仍不带 token，需与 parseResume 一并修。',
  classifyIntent:
    '当前没有任何直接落账点：它是 normalizeOperation 的兜底取值，' +
    '真实意图分类调用被记在 chatAssistant 名下。需先确认该 operation 是否还应保留。',
}
const MAX_GAPS = 6 // 棘轮：只允许调低

if (Object.keys(KNOWN_ZERO_COST_GAPS).length <= MAX_GAPS) {
  pass(`零成本欠账未超上限（${Object.keys(KNOWN_ZERO_COST_GAPS).length}/${MAX_GAPS}）`)
} else {
  fail(`零成本欠账超上限（${Object.keys(KNOWN_ZERO_COST_GAPS).length}/${MAX_GAPS}）—— 该上限只允许调低`)
}

for (const op of ALL_OPS) {
  if (NON_TOKEN_BILLED.includes(op)) continue
  const sites = SRC_FILES.filter(
    (f) => (f.src.includes('.record(') || f.src.includes('recordAiLog')) && f.src.includes(`'${op}'`),
  )
  const unplumbed = sites.filter((f) => !f.src.includes('tokenUsage')).map((f) => f.rel)
  const registered = KNOWN_ZERO_COST_GAPS[op]
  const healthy = sites.length > 0 && unplumbed.length === 0

  if (healthy) {
    pass(`成本管路: ${op} 的所有落账点都收 token`)
    if (registered) fail(`成本管路: ${op} 已收 token，请从 KNOWN_ZERO_COST_GAPS 删除该条陈旧欠账`)
    continue
  }
  if (!registered) {
    const why = sites.length === 0 ? '找不到任何落账点' : `落账点无 token 管路: ${unplumbed.join(', ')}`
    fail(`成本管路: ${op} ${why} —— 付费调用会在 Admin 显示 ¥0.0000，必须修或显式登记欠账`)
    continue
  }
  if (registered.length < 20) fail(`成本管路: ${op} 的欠账理由过短，必须写清为什么还没修`)
  else pass(`成本管路: ${op} 已登记零成本欠账（仍显示 ¥0.0000，未修复）`)
}

// 陈旧欠账：登记了一个已经不存在的 operation
for (const op of Object.keys(KNOWN_ZERO_COST_GAPS)) {
  if (!ALL_OPS.includes(op)) fail(`成本管路: KNOWN_ZERO_COST_GAPS 登记的 ${op} 已不在 AiOperation，请删除该条`)
}

// ─── 1c. selfAssessment 回归锚（本批次修复的那条）────────────────────────────
//
// 改回去必须红：这条是**付费** LLM 调用，此前完全不收 token。

const selfAssessSvc = read('src/ai/resume/self-assessment.service.ts')
assertContains(selfAssessSvc, 'AiUsageAccumulator', 'self-assessment: 使用 AiUsageAccumulator')
assertContains(selfAssessSvc, 'onLlmCall: usage.add', 'self-assessment: 把 usage sink 传给 LLM 服务')
assertContains(selfAssessSvc, 'tokenUsage: usage.tokenUsage', 'self-assessment: 落账带真实 token')
assertContains(selfAssessSvc, 'usage.callCount > 0', 'self-assessment: callCount 守卫存在（没真调用就不落账）')

const llmSelfAssess = read('src/ai/resume/llm-self-assessment.service.ts')
assertContains(llmSelfAssess, 'normalizeLlmUsage(data.usage)', 'llm-self-assessment: 从上游回包读取 token usage')
assertContains(llmSelfAssess, 'onLlmCall?.({ provider: providerLabel, tokenUsage:', 'llm-self-assessment: 回调带 provider + token')
assertContains(llmSelfAssess, '`llm:${cfg.vendor}:${cfg.model}`', 'llm-self-assessment: provider 标签含厂商名（否则单价匹配不到）')
// selfAssessment 是 token 计费能力，绝不能被塞进「非 token 计费」名单来掩盖 ¥0
assertNotContains(logSvc, /NON_TOKEN_BILLED_OPERATIONS[\s\S]{0,200}selfAssessment/u, 'self-assessment: 未被误列入非 token 计费名单')

// ─── 2. NON_TOKEN_BILLED_OPERATIONS ──────────────────────────────────────────

assertContains(logSvc, 'NON_TOKEN_BILLED_OPERATIONS', 'NON_TOKEN_BILLED_OPERATIONS 已声明')
assertContains(logSvc, "'voiceTranscribe'", 'voiceTranscribe 在 NON_TOKEN_BILLED_OPERATIONS')
assertContains(logSvc, "'voiceSynthesize'", 'voiceSynthesize 在 NON_TOKEN_BILLED_OPERATIONS')

// ─── 3. careerPlan 日志覆盖（service 层）────────────────────────────────────

const careerSvc = read('src/ai/resume/career-plan.service.ts')
assertContains(careerSvc, 'AiUsageAccumulator', 'career-plan: 使用 AiUsageAccumulator')
assertContains(careerSvc, 'recordAiLog', 'career-plan: 存在 recordAiLog 方法')
assertContains(careerSvc, "operation: 'careerPlan'", "career-plan: operation='careerPlan'")
assertContains(careerSvc, 'callCount === 0', 'career-plan: callCount === 0 guard 存在')

// ─── 4. fairVisitPlan 日志覆盖（service 层）─────────────────────────────────

const fairVisitSvc = read('src/ai/resume/fair-visit-plan.service.ts')
assertContains(fairVisitSvc, 'AiUsageAccumulator', 'fair-visit-plan: 使用 AiUsageAccumulator')
assertContains(fairVisitSvc, 'recordAiLog', 'fair-visit-plan: 存在 recordAiLog 方法')
assertContains(fairVisitSvc, "operation: 'fairVisitPlan'", "fair-visit-plan: operation='fairVisitPlan'")
assertContains(fairVisitSvc, 'callCount === 0', 'fair-visit-plan: callCount === 0 guard 存在')

// ─── 5. interviewQuestion / interviewReport 日志覆盖（service 层）───────────

const interviewSvc = read('src/mock-interview/mock-interview.service.ts')
assertContains(interviewSvc, 'AiUsageAccumulator', 'mock-interview service: 使用 AiUsageAccumulator')
assertContains(interviewSvc, 'recordAiLog', 'mock-interview service: 存在 recordAiLog 方法')
assertContains(interviewSvc, "'interviewQuestion'", "mock-interview service: operation='interviewQuestion'")
assertContains(interviewSvc, "'interviewReport'", "mock-interview service: operation='interviewReport'")
assertContains(interviewSvc, 'callCount === 0', 'mock-interview service: callCount === 0 guard 存在')

// ─── 6. voiceTranscribe 日志覆盖（controller 层）────────────────────────────

const mockInterviewCtrl = read('src/mock-interview/mock-interview.controller.ts')
assertContains(mockInterviewCtrl, "'voiceTranscribe'", 'mock-interview ctrl: voiceTranscribe 日志')
assertContains(mockInterviewCtrl, 'asrStartedAt', 'mock-interview ctrl: asrStartedAt 计时')
assertContains(mockInterviewCtrl, 'tokenUsage: undefined', 'mock-interview ctrl: ASR tokenUsage 明确为 undefined')

// voiceTranscribe 也在 ai.controller.ts（简历语音转写入口）
const aiCtrl = read('src/ai/ai.controller.ts')
assertContains(aiCtrl, "'voiceTranscribe'", 'ai.controller: voiceTranscribe 日志')
assertContains(aiCtrl, 'asrStartedAt', 'ai.controller: asrStartedAt 计时')

// ─── 7. voiceSynthesize 日志覆盖（controller 层）────────────────────────────

assertContains(mockInterviewCtrl, "'voiceSynthesize'", 'mock-interview ctrl: voiceSynthesize 日志')
assertContains(mockInterviewCtrl, 'ttsStartedAt', 'mock-interview ctrl: ttsStartedAt 计时')
assertContains(mockInterviewCtrl, 'tts:tencent', 'mock-interview ctrl: TTS provider label 存在')

// ─── 8. 前端 Admin AiOperation 同步 ──────────────────────────────────────────

const adminTypes = readApps('admin/src/services/api/types.ts')
for (const op of NEW_OPS) {
  assertContains(adminTypes, `'${op}'`, `Admin types: AiOperation 包含 ${op}`)
}
assertContains(adminTypes, 'Record<AiOperation, number>', 'Admin types: byOperation 改用 Record<AiOperation, number>')

// ─── 9. OPERATION_LABELS 覆盖新增操作 ────────────────────────────────────────

const aiServicesRoute = readApps('admin/src/routes/ai-services/index.tsx')
for (const op of NEW_OPS) {
  assertContains(aiServicesRoute, op, `ai-services route: OPERATION_LABELS 覆盖 ${op}`)
}

// ─── 10. 合规：服务端不编造 ASR/TTS 成本（禁止 estimatedCostCny = 0 for NON_TOKEN_BILLED）

// ASR / TTS record 调用里 estimatedCostCny 字段不应存在（undefined 即忽略），
// 而不是 "0"（0 意味着「免费」，是编造）。
const asr_record_block = (() => {
  const idx = mockInterviewCtrl.indexOf("'voiceTranscribe'")
  return idx >= 0 ? mockInterviewCtrl.slice(Math.max(0, idx - 300), idx + 300) : ''
})()
assertNotContains(asr_record_block, 'estimatedCostCny: 0', 'ASR log block 未编造 estimatedCostCny: 0')

const tts_record_block = (() => {
  const idx = mockInterviewCtrl.indexOf("'voiceSynthesize'")
  return idx >= 0 ? mockInterviewCtrl.slice(Math.max(0, idx - 300), idx + 300) : ''
})()
assertNotContains(tts_record_block, 'estimatedCostCny: 0', 'TTS log block 未编造 estimatedCostCny: 0')

// ─── 10b. Admin 全量 operation 明细表 + 成本诚实标注 ─────────────────────────
//
// 页面顶部卡片只覆盖 6 个高频能力。若没有全量明细表，
// 职业规划 / 参会计划 / 模拟面试 / 语音这些能力的花费在 Admin 侧就是不可见的，
// A-6 等于没做完。同时守住：非 token 计费能力不得显示 ¥0（等于谎称免费）。

assertContains(aiServicesRoute, 'NON_TOKEN_BILLED_OPS', 'ai-services route: 声明 NON_TOKEN_BILLED_OPS')
assertContains(aiServicesRoute, 'operationRows', 'ai-services route: 存在全量 operation 明细表数据')
assertContains(aiServicesRoute, '未估算', 'ai-services route: 非 token 计费能力显示「未估算」而非 ¥0')
assertContains(
  aiServicesRoute,
  /分能力调用量与成本/,
  'ai-services route: 明细表分区标题存在',
)
// 明细表的成本单元格必须按 tokenBilled 分支渲染，不能无条件 toFixed 成金额
assertContains(aiServicesRoute, 'row.tokenBilled', 'ai-services route: 成本按 tokenBilled 分支渲染')

// ─── 11. 运行时：ASR / TTS 日志真的落进 AiServiceLog ──────────────────────────
//
// 静态 grep 只能证明代码写了 record()；证明不了运行时真的落行：
// provider 标签可能写错、异常可能在 record() 之前抛出、guard 可能误拦。
// 这里直接构造 controller（stub ASR/TTS + stub service），走真实 record 路径，
// 再回读 AiServiceLog 断言 operation / status / provider / 成本字段。
//
// 为什么必须覆盖：ASR/TTS 是唯一「日志写在 controller 层」的两个能力
//（写进 AsrService/TtsService 会造成 AiModule ↔ AsrModule 循环依赖），
// 也就是唯一无法靠 service 层 verify 顺带覆盖的两条链路。

async function runtimeChecks(): Promise<void> {
  const { PrismaService } = await import('../src/prisma/prisma.service')
  const { AiLogService } = await import('../src/ai/ai-log.service')
  const { MockInterviewController } = await import('../src/mock-interview/mock-interview.controller')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const aiLog = new AiLogService(prisma)

  // 只保留本次运行产生的行：用唯一 taskId 前缀无法过滤（taskId 不落库），
  // 改用「跑前时间戳」切分。
  const since = new Date()
  await new Promise((r) => setTimeout(r, 5))

  const okAsr = {
    activeProviderName: 'asr:baidu',
    enabled: true,
    recognizeWav: async () => ({ ok: true as const, text: '这是一段转写文本' }),
  }
  const failAsr = {
    activeProviderName: 'asr:tencent',
    enabled: true,
    recognizeWav: async () => ({ ok: false as const, errorCode: 'ASR_UPSTREAM_ERROR', errorMessage: '上游失败' }),
  }
  const okTts = {
    enabled: true,
    synthesize: async () => ({ ok: true as const, audio: 'AAAA' }),
  }
  const failTts = {
    enabled: true,
    synthesize: async () => ({ ok: false as const, errorMessage: '上游失败' }),
  }

  const stubService = {
    getSession: async () => ({
      turns: [{ idx: 0, role: 'interviewer', content: '请做个自我介绍。' }],
    }),
  }
  // requesterOf 依赖 jwt/redis/prisma 解析可选会员；无 authorization 头时
  // resolveOptionalEndUser 返回 null，走匿名 accessToken 分支，不需要真 redis。
  const stubJwt = {} as never
  const stubRedis = {} as never
  const req = { headers: {} } as never

  function ctrl(asr: unknown, tts: unknown) {
    return new MockInterviewController(
      stubService as never,
      asr as never,
      tts as never,
      stubJwt,
      stubRedis,
      prisma,
      aiLog,
    )
  }

  const audio = { buffer: Buffer.alloc(2048) } as Express.Multer.File

  // ASR 成功
  await ctrl(okAsr, okTts).transcribe('rt-asr-ok', audio, req)
  // ASR 失败（必须仍落一条 failed，不能因为抛 400 就丢账）
  await ctrl(failAsr, okTts).transcribe('rt-asr-fail', audio, req).then(
    () => fail('运行时: ASR 失败应抛 400'),
    () => undefined,
  )
  // TTS 成功
  await ctrl(okAsr, okTts).questionAudio('rt-tts-ok', '0', req)
  // TTS 失败
  await ctrl(okAsr, failTts).questionAudio('rt-tts-fail', '0', req).then(
    () => fail('运行时: TTS 失败应抛 400'),
    () => undefined,
  )

  // record() 内部 persist 是 fire-and-forget（不阻塞请求），必须等它真的落库再回读。
  // 这里不能用固定 sleep：SQLite 下写是进程内文件操作（微秒级）怎么都能过，
  // PG 下这几条 INSERT 各自可能要新建连接（TCP + SCRAM 握手），在 CI 的 CPU 争用下
  // 耗时抖动很大，而回读能捡到池里已暖的连接直接返回 —— 读会跑到写前面，偶发漏读。
  await aiLog.flush()

  const rows = await prisma.aiServiceLog.findMany({
    where: { createdAt: { gte: since }, operation: { in: ['voiceTranscribe', 'voiceSynthesize'] } },
    orderBy: { createdAt: 'asc' },
  })

  function findRow(operation: string, status: string) {
    return rows.find((r) => r.operation === operation && r.status === status)
  }

  const cases: Array<{ op: string; status: string; provider: string; errorCode: string | null; label: string }> = [
    { op: 'voiceTranscribe', status: 'success', provider: 'asr:baidu', errorCode: null, label: 'ASR 成功' },
    { op: 'voiceTranscribe', status: 'failed', provider: 'asr:tencent', errorCode: 'ASR_UPSTREAM_ERROR', label: 'ASR 失败' },
    { op: 'voiceSynthesize', status: 'success', provider: 'tts:tencent', errorCode: null, label: 'TTS 成功' },
    { op: 'voiceSynthesize', status: 'failed', provider: 'tts:tencent', errorCode: 'TTS_FAILED', label: 'TTS 失败' },
  ]

  for (const c of cases) {
    const row = findRow(c.op, c.status)
    if (!row) {
      fail(`运行时: ${c.label} 未落 AiServiceLog(${c.op}/${c.status})`)
      continue
    }
    pass(`运行时: ${c.label} 已落 AiServiceLog(${c.op}/${c.status})`)

    if (row.provider === c.provider) pass(`运行时: ${c.label} provider=${c.provider}`)
    else fail(`运行时: ${c.label} provider 应为 ${c.provider}，实际 ${String(row.provider)}`)

    if (row.errorCode === c.errorCode) pass(`运行时: ${c.label} errorCode=${String(c.errorCode)}`)
    else fail(`运行时: ${c.label} errorCode 应为 ${String(c.errorCode)}，实际 ${String(row.errorCode)}`)

    // 按时长/字符计费 → 不编造成本，必须是 null（不是 0）
    if (row.estimatedCostCny === null) pass(`运行时: ${c.label} estimatedCostCny 为 null（未编造单价）`)
    else fail(`运行时: ${c.label} estimatedCostCny 应为 null，实际 ${String(row.estimatedCostCny)}`)

    // 按 token 计费的字段必须为空对象，不能塞假 token
    if (row.tokenUsageJson === '{}') pass(`运行时: ${c.label} tokenUsage 为空（ASR/TTS 无 token）`)
    else fail(`运行时: ${c.label} tokenUsageJson 应为 {}，实际 ${row.tokenUsageJson}`)

    if (row.latencyMs !== null && row.latencyMs >= 0) pass(`运行时: ${c.label} latencyMs 已记录`)
    else fail(`运行时: ${c.label} latencyMs 缺失`)
  }

  // getUsage 必须把这些行计入 byOperation（Admin 侧真的看得见）
  const usage = await aiLog.getUsage('AiServiceLog')
  if (usage.byOperation.voiceTranscribe >= 2) pass('运行时: getUsage.byOperation.voiceTranscribe 已计数')
  else fail(`运行时: getUsage.byOperation.voiceTranscribe 应 ≥2，实际 ${usage.byOperation.voiceTranscribe}`)
  if (usage.byOperation.voiceSynthesize >= 2) pass('运行时: getUsage.byOperation.voiceSynthesize 已计数')
  else fail(`运行时: getUsage.byOperation.voiceSynthesize 应 ≥2，实际 ${usage.byOperation.voiceSynthesize}`)

  // 清理本次运行时产生的行，保持脚本幂等
  await prisma.aiServiceLog.deleteMany({
    where: { createdAt: { gte: since }, operation: { in: ['voiceTranscribe', 'voiceSynthesize'] } },
  })
  await prisma.onModuleDestroy()
}

// ─── 结果 ─────────────────────────────────────────────────────────────────────

void (async () => {
  try {
    await runtimeChecks()
  } catch (error) {
    fail(`运行时检查异常: ${error instanceof Error ? error.message : String(error)}`)
  }

  console.log(`\nA-6 成本覆盖验证: ${passCount} PASS, ${failCount} FAIL`)
  if (failCount > 0) {
    process.exit(1)
  }
})()
