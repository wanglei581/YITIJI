/**
 * verify:ai-usage-budget —— P1-2a AI 逐次计量账 + 每日金额硬上限（2026-09-29）
 *
 * 全部真跑，不搜源码字符串（写隔离库：VERIFICATION_DATABASE_TARGET=isolated）：
 *   [A] 计量：注入 fetch 让 llmFetchJson 真跑；每次**发出**的调用各写一行、字段正确；
 *       未验签终端号不入账；取不到用量 costCny 为 null 而不是 0；白名单拒绝、输入拦截、
 *       并发闸门拒绝不入账；写账失败不影响返回；行里没有提示词。
 *   [B] 上限：全局 / 终端 / 会员三档各自触顶后 generate、voice 被拒（503 AI_BUDGET_EXHAUSTED），
 *       read、export 不拦；打印前材料检查在「额度耗尽」与「核不了额度」时都照常建任务；
 *       未计量调用按保守单价计入；北京时间跨零点换新的一天；非法 env 回落默认；
 *       读不到花费时失败关闭（503 AI_BUDGET_UNAVAILABLE）；缓存期内本进程新记的金额立即计入；
 *       首次触顶打一条固定标记日志、会员号不进日志。
 *   [C] 同一会员从「一体机上下文」与「小程序上下文」各调一次：同一 endUserId，合并计会员额度。
 *   [D] 后台汇总：字段白名单、不含会员号、触顶判断；仅管理员。
 *   [E] 接线：计量去处由模块初始化注册；中间件挂在 app.module 的同一条链上；
 *       AiAccessService 的额度依赖是必注入（未标 @Optional）。
 *
 * 不触网（fetch 注入），不连 Redis（桩）。
 * 运行：VERIFICATION_DATABASE_TARGET=isolated pnpm --filter @ai-job-print/api verify:ai-usage-budget
 */
import 'reflect-metadata'
import 'dotenv/config'
import { randomUUID } from 'crypto'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

let failures = 0
let checks = 0
function check(name: string, ok: boolean, detail = ''): void {
  checks += 1
  if (ok) { console.log(`  ✅ ${name}`); return }
  failures += 1
  console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`)
}

async function outcome(op: () => Promise<unknown>): Promise<string> {
  try {
    await op()
    return 'PASS'
  } catch (error) {
    const body = (error as { getResponse?: () => { error?: { code?: string; scope?: string } } }).getResponse?.()
    const status = (error as { getStatus?: () => number }).getStatus?.()
    if (body?.error?.code) return `${status}:${body.error.code}${body.error.scope ? `:${body.error.scope}` : ''}`
    return (error as Error).name
  }
}

async function main(): Promise<void> {
  assertIsolatedVerificationDatabase()
  // 三档上限压到很小，好在门禁里触顶；保守单价取默认 0.05。
  process.env['AI_DAILY_BUDGET_CNY'] = '1'
  process.env['AI_TERMINAL_DAILY_BUDGET_CNY'] = '0.5'
  process.env['AI_MEMBER_DAILY_BUDGET_CNY'] = '0.2'
  delete process.env['AI_UNMEASURED_CALL_COST_CNY']
  delete process.env['AI_ENDPOINT_ALLOWLIST']
  delete process.env['AI_ENDPOINT_ALLOWLIST_EXTRA']

  const { Logger, RequestMethod } = await import('@nestjs/common')
  const { NestFactory, Reflector } = await import('@nestjs/core')
  const { JwtService } = await import('@nestjs/jwt')
  const { PATH_METADATA, METHOD_METADATA, GUARDS_METADATA } = await import('@nestjs/common/constants')
  const { PrismaService } = await import('../src/prisma/prisma.service')
  const { memberSessionKey } = await import('../src/common/guards/end-user-auth.guard')
  const { llmFetchJson, llmRequestAbort, LlmConcurrencyGate, LlmBusyError, LlmTimeoutError } = await import('../src/ai/llm/llm-http')
  const { AiContentBlockedError } = await import('../src/ai/llm/llm-guard')
  const { AiEndpointNotAllowedError } = await import('../src/common/outbound/ai-endpoint-allowlist')
  const meter = await import('../src/ai/usage/ai-usage-meter')
  const ctxMod = await import('../src/ai/usage/ai-usage-context')
  const { AiRequestContextMiddleware } = await import('../src/ai/usage/ai-request-context.middleware')
  const { AiBudgetService, readAiBudgetLimits, AI_BUDGET_DEFAULTS } = await import('../src/ai/usage/ai-budget.service')
  const { AiUsageModule } = await import('../src/ai/usage/ai-usage.module')
  const { AdminAiUsageController } = await import('../src/ai/usage/admin-ai-usage.controller')
  const { buildAiUsageDailySummary } = await import('../src/ai/usage/ai-usage-summary')
  const { estimateCostCny, priceTokens } = await import('../src/ai/usage/ai-pricing')
  const { AiAccessService } = await import('../src/ai-access/ai-access.service')
  const { AiAccessGuard } = await import('../src/ai-access/ai-access.guard')
  const { ROLES_KEY } = await import('../src/common/decorators/roles.decorator')
  const { MaterialsController } = await import('../src/materials/materials.controller')
  const { AiController } = await import('../src/ai/ai.controller')
  const { MockInterviewController } = await import('../src/mock-interview/mock-interview.controller')
  const { ResumeReportExportController } = await import('../src/ai/resume-report-export.controller')

  // ── 捕获日志（首次触顶标记、写账失败 warn）──────────────────────────────────
  const logLines: string[] = []
  const capture = (message: unknown) => { logLines.push(String(message)) }
  const captureLogs = () => Logger.overrideLogger({ log: () => undefined, error: capture, warn: capture, debug: () => undefined, verbose: () => undefined, fatal: capture })

  // ── 本次运行独占的「日期」：2090 年后随机一段，互不串账 ─────────────────────
  const runId = randomUUID().slice(0, 8)
  const baseDayMs = Date.UTC(2090, 0, 1) + Math.floor(Math.random() * 20_000) * 86_400_000
  const dayAt = (n: number, beijingHour = 12) => new Date(baseDayMs + n * 86_400_000 + (beijingHour - 8) * 3_600_000)
  let now = dayAt(0)
  meter.setAiUsageClockForTests(() => now)
  const usedDays = new Set<string>()
  const setDay = (n: number, hour = 12) => { now = dayAt(n, hour); usedDays.add(meter.beijingDayKey(now)); return meter.beijingDayKey(now) }

  // ── 真库 + 真模块初始化（证明计量去处是 onModuleInit 注册的）───────────────────
  const app = await NestFactory.createApplicationContext(AiUsageModule, { logger: false })
  captureLogs() // 建上下文会改写全局 logger，之后再接管
  const budget = app.get(AiBudgetService)
  const prisma = app.get(PrismaService)
  // 独立连接：清理与「模块关闭后」的回读用，不受 app.close() 影响
  const cleanup = new PrismaService()
  await cleanup.onModuleInit()

  const memberA = await prisma.endUser.create({ data: { phoneHash: `verify-ai-usage-${runId}-a`, phoneEnc: 'x' } })
  const memberB = await prisma.endUser.create({ data: { phoneHash: `verify-ai-usage-${runId}-b`, phoneEnc: 'x' } })
  const orgId = `verify-ai-usage-org-${runId}`
  await prisma.organization.create({ data: { id: orgId, name: '门禁机构', type: 'school' } })
  const terminalA = `verify-ai-usage-t1-${runId}`
  const terminalB = `verify-ai-usage-t2-${runId}`
  for (const [id, org] of [[terminalA, orgId], [terminalB, null]] as const) {
    await prisma.terminal.create({ data: { id, terminalCode: id, agentToken: `tok-${id}`, deviceFingerprint: 'fp', orgId: org } })
  }

  // ── 身份解析依赖：真 JWT、Redis 桩（会员会话）、真库（终端机构）、终端验签桩 ──────
  const jwt = new JwtService({ secret: 'verify-ai-usage-budget-secret-0123456789' })
  const tokenFor = (memberId: string, sid: string) => `Bearer ${jwt.sign({ sub: memberId, jti: sid }, { audience: 'enduser', expiresIn: '10m' })}`
  const sessions: Record<string, string> = { [memberSessionKey('sid-a')]: memberA.id, [memberSessionKey('sid-b')]: memberB.id }
  const redis = new Proxy({}, { get: (_t, prop: string) => (prop === 'get' ? async (key: string) => sessions[key] ?? null : async () => null) }) as never
  const terminalSessions = {
    validate: async (id: string | undefined, token: string | undefined) => {
      if (!id || token !== `good-${id}`) throw new Error('TERMINAL_SESSION_INVALID')
    },
  }
  const middleware = new AiRequestContextMiddleware(jwt, redis, prisma, terminalSessions as never)
  /** 走真实中间件：在它放进 ALS 的上下文里跑 fn（与生产同一条路径）。 */
  const viaMiddleware = <T>(headers: Record<string, string>, fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => middleware.use({ headers } as never, {} as never, () => { fn().then(resolve, reject) }))
  const withIdentity = <T>(identity: import('../src/ai/usage/ai-usage-context').AiCallerIdentity, fn: () => Promise<T>) =>
    ctxMod.runWithAiRequestContext(ctxMod.lazyAiRequestContext(async () => identity), fn)

  const kioskHeaders = { authorization: tokenFor(memberA.id, 'sid-a'), 'x-terminal-id': terminalA, 'x-terminal-session-token': `good-${terminalA}` }

  // ── LLM 假上游 ──────────────────────────────────────────────────────────────
  const DEEPSEEK = 'https://api.deepseek.com/v1/chat/completions'
  const QWEN = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions'
  const PROMPT_MARK = `SECRET-PROMPT-${runId}`
  const body = (model = 'deepseek-v4-flash', content = `请看看我的简历 ${PROMPT_MARK}`) =>
    JSON.stringify({ model, messages: [{ role: 'user', content }], temperature: 0.2, stream: false })
  const init = (model?: string, content?: string) => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body(model, content) })
  let fetchCalls = 0
  const reply = (status: number, json: unknown): typeof fetch => (async () => {
    fetchCalls += 1
    return new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
  const okJson = (usage?: unknown, content = '好的，这是建议。') => ({ choices: [{ message: { content } }], ...(usage ? { usage } : {}) })
  const hanging: typeof fetch = ((_url: unknown, reqInit?: RequestInit) => {
    fetchCalls += 1
    return new Promise((_resolve, reject) => reqInit?.signal?.addEventListener('abort', () => reject(reqInit.signal?.reason ?? new Error('aborted'))))
  }) as typeof fetch
  const feature = (name: string) => `vf-${name}-${runId}`
  const call = (name: string, fetchImpl: typeof fetch, extra: Partial<Parameters<typeof llmFetchJson>[2]> = {}, url = DEEPSEEK, reqInit = init()) =>
    llmFetchJson(url, reqInit, { timeoutMs: 5_000, fetchImpl, contentModeration: { feature: feature(name) }, ...extra })
  const rowsOf = async (name: string) => { await meter.flushAiUsageMeter(); return prisma.aiUsageRecord.findMany({ where: { featureKey: feature(name) } }) }

  console.log('\n[A] 逐次计量')
  const dayA = setDay(0)
  {
    const res = await viaMiddleware(kioskHeaders, () => call('ok', reply(200, okJson({ prompt_tokens: 1000, completion_tokens: 500, total_tokens: 1500 }))))
    const rows = await rowsOf('ok')
    const row = rows[0]
    check('A1 成功调用：结果照常返回', res.ok && res.status === 200)
    check('A1 成功调用：恰好记一行', rows.length === 1, `rows=${rows.length}`)
    check('A1 字段：功能 / 厂商 / 型号 / 状态 / HTTP 状态 / 日期', row?.featureKey === feature('ok') && row?.vendor === 'deepseek' && row?.model === 'deepseek-v4-flash' && row?.status === 'ok' && row?.httpStatus === 200 && row?.dayKey === dayA,
      JSON.stringify(row))
    // 1000×2 + 500×8 元/百万 tokens（DeepSeek Flash 高峰价）= 0.006
    check('A1 金额按共用价目折算（DeepSeek Flash 高峰价）且标为已计量', row?.promptTokens === 1000 && row?.completionTokens === 500 && row?.costCny === 0.006 && row?.costMeasured === true, `cost=${row?.costCny}`)
    check('A1 已验签终端、所属机构、会员都记上', row?.terminalId === terminalA && row?.terminalVerified === true && row?.orgId === orgId && row?.endUserId === memberA.id, JSON.stringify(row))
    check('A1 行里没有提示词正文', row !== undefined && !JSON.stringify(row).includes(PROMPT_MARK))
  }
  {
    await viaMiddleware({ ...kioskHeaders, 'x-terminal-session-token': 'forged' }, () => call('forged', reply(200, okJson({ prompt_tokens: 10, completion_tokens: 10 }))))
    const row = (await rowsOf('forged'))[0]
    check('A2 终端会话令牌验不过：终端号不入账（null）、机构不记', row !== undefined && row.terminalId === null && row.terminalVerified === false && row.orgId === null, JSON.stringify(row))
    check('A2 会员照常记（令牌有效）', row?.endUserId === memberA.id)
    await viaMiddleware({ 'x-terminal-id': terminalA }, () => call('claim-only', reply(200, okJson())))
    const claim = (await rowsOf('claim-only'))[0]
    check('A2 只带终端号不带令牌：终端号不入账', claim !== undefined && claim.terminalId === null && claim.terminalVerified === false, JSON.stringify(claim))
  }
  {
    await call('no-usage', reply(200, okJson()))
    const row = (await rowsOf('no-usage'))[0]
    check('A3 取不到用量：costCny 为 null（不是 0）、未计量、tokens 为空', row !== undefined && row.costCny === null && row.costMeasured === false && row.promptTokens === null, JSON.stringify(row))
    check('A3 没有请求上下文：会员 / 终端都为空', row?.endUserId === null && row?.terminalId === null)
  }
  {
    const r500 = await call('upstream-500', reply(500, { error: { message: 'x' } }))
    const r429 = await call('upstream-429', reply(429, { error: { message: 'x' } }))
    const [e500] = await rowsOf('upstream-500')
    const [e429] = await rowsOf('upstream-429')
    check('A4 上游 500：调用方照常拿到 !ok，记 upstream_error', !r500.ok && e500?.status === 'upstream_error' && e500?.httpStatus === 500 && e500?.costCny === null)
    check('A4 上游 429：记 busy', !r429.ok && e429?.status === 'busy' && e429?.httpStatus === 429)
  }
  {
    const timeout = await outcome(() => call('timeout', hanging, { timeoutMs: 50 }))
    const [row] = await rowsOf('timeout')
    check('A5 超时：抛 LlmTimeoutError，记 timeout、未计量', timeout === 'LlmTimeoutError' && row?.status === 'timeout' && row?.costMeasured === false, `${timeout} ${JSON.stringify(row)}`)
    const network = await outcome(() => call('network', (async () => { fetchCalls += 1; throw new TypeError('fetch failed') }) as typeof fetch))
    const [net] = await rowsOf('network')
    check('A5 网络错误：原错误照抛，记 network_error', network === 'TypeError' && net?.status === 'network_error')
    const controller = new AbortController()
    const aborted = llmRequestAbort.run(controller.signal, () => outcome(() => call('aborted', hanging)))
    setTimeout(() => controller.abort(), 20)
    await aborted
    const [ab] = await rowsOf('aborted')
    check('A5 客户端断开：记 aborted', ab?.status === 'aborted', JSON.stringify(ab))
  }
  {
    const blocked = await outcome(() => call('out-blocked', reply(200, okJson({ prompt_tokens: 100, completion_tokens: 100 }, '这里有违禁词汇')), { contentModeration: { feature: feature('out-blocked'), forbiddenWords: ['违禁词汇'] } }))
    const [row] = await rowsOf('out-blocked')
    check('A6 输出被拦：请求已发出、钱已花，记 blocked 且按用量计价', blocked === 'AiContentBlockedError' && row?.status === 'blocked' && row?.costMeasured === true && (row?.costCny ?? 0) > 0, `${blocked} ${JSON.stringify(row)}`)
  }
  {
    const before = fetchCalls
    const inBlocked = await outcome(() => call('in-blocked', reply(200, okJson()), { contentModeration: { feature: feature('in-blocked'), forbiddenWords: ['违禁词汇'] } }, DEEPSEEK, init('deepseek-v4-flash', '违禁词汇')))
    const denied = await outcome(() => call('allowlist', reply(200, okJson()), {}, 'https://llm.not-allowed.example/v1/chat/completions'))
    const gate = new LlmConcurrencyGate(1)
    gate.acquire()
    const busy = await outcome(() => call('gate', reply(200, okJson()), { gate }))
    check('A7 三种「没发出」各自抛出原有错误', inBlocked === 'AiContentBlockedError' && denied === 'AiEndpointNotAllowedError' && busy === 'LlmBusyError', `${inBlocked} ${denied} ${busy}`)
    check('A7 且确实一个上游请求都没发', fetchCalls === before, `fetch 多调了 ${fetchCalls - before} 次`)
    const none = [...await rowsOf('in-blocked'), ...await rowsOf('allowlist'), ...await rowsOf('gate')]
    check('A7 输入拦截 / 白名单拒绝 / 并发闸门拒绝都不入账', none.length === 0, `rows=${none.length}`)
    void [AiContentBlockedError, AiEndpointNotAllowedError, LlmBusyError, LlmTimeoutError]
  }
  {
    const unregister = meter.registerAiUsageSink({ persist: async () => { throw Object.assign(new Error('db down'), { code: 'P1001' }) } })
    const logsBefore = logLines.length
    const res = await call('sink-fails', reply(200, okJson({ prompt_tokens: 1, completion_tokens: 1 })))
    await meter.flushAiUsageMeter()
    unregister()
    meter.registerAiUsageSink(budget)
    check('A8 写账失败：本次 AI 结果照常返回', res.ok && res.status === 200)
    check('A8 写账失败只记一条 warn（不带正文）', logLines.slice(logsBefore).some((l) => l.includes('AI usage record write failed') && !l.includes(PROMPT_MARK)))
  }
  {
    await llmFetchJson(DEEPSEEK, init(), { timeoutMs: 5_000, fetchImpl: reply(200, okJson()) })
    await meter.flushAiUsageMeter()
    const unknown = await prisma.aiUsageRecord.findFirst({ where: { dayKey: dayA, featureKey: 'unknown' } })
    check('A9 拿不到功能名：记 unknown', unknown !== null)
    await call('qwen', reply(200, okJson({ prompt_tokens: 1000, completion_tokens: 1000 })), {}, QWEN, init('qwen-plus'))
    const [q] = await rowsOf('qwen')
    // 1000×0.8 + 1000×2 元/百万 tokens（qwen-plus ≤128K 非思考）= 0.0028
    check('A9 百炼主机映射为 qwen，按 qwen-plus 价目', q?.vendor === 'qwen' && q?.model === 'qwen-plus' && q?.costCny === 0.0028, JSON.stringify(q))
  }
  {
    check('A10 价目共用：AiServiceLog 的估算与计量账同一份（DeepSeek Flash）', estimateCostCny('llm:deepseek:deepseek-v4-flash', { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 }) === priceTokens('deepseek:deepseek-v4-flash', { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 }))
    check('A10 认不出型号按同厂最贵一档（DeepSeek V4-Pro 高峰价）', priceTokens('deepseek:deepseek-unknown', { promptTokens: 1_000_000, completionTokens: 0, totalTokens: 1_000_000 }) === 9)
    check('A10 计量账没有 mock 短路：主机名含 mock 的真实请求不记成免费', priceTokens('mock.example:x', { promptTokens: 1, completionTokens: 1, totalTokens: 2 }) === undefined)
  }

  // ── [B] 额度 ────────────────────────────────────────────────────────────────
  console.log('\n[B] 每日金额上限')
  const OFF = { loginGate: 'off' as const, declarationEnforced: false, paused: false, maintenance: false }
  const auditStub = { writeRequired: async () => 'a', write: async () => undefined }
  const accessWith = (b: unknown) => new AiAccessService(redis, auditStub as never, jwt, prisma, b as never)
  const access = accessWith(budget)
  const enforce = (kind: 'generate' | 'voice' | 'read' | 'export') => outcome(() => access.enforce(kind, false, { headers: {} }, OFF))
  const seed = async (dayKey: string, rows: Array<{ cost: number | null; terminalId?: string | null; endUserId?: string | null }>) => {
    await prisma.aiUsageRecord.createMany({
      data: rows.map((r) => ({ dayKey, featureKey: feature('seed'), vendor: 'deepseek', model: 'deepseek-v4-flash', status: 'ok', costCny: r.cost, costMeasured: r.cost !== null, terminalId: r.terminalId ?? null, terminalVerified: Boolean(r.terminalId), endUserId: r.endUserId ?? null })),
    })
    budget.resetForTests()
  }
  const ANON = { endUserId: null, terminalId: null, terminalVerified: false, orgId: null }
  const asMember = (id: string) => ({ ...ANON, endUserId: id })
  // 行尾分号不能省：下一行以 `{` 开头的块会被 TypeScript 解析器当成箭头函数体
  const asTerminal = (id: string) => ({ ...ANON, terminalId: id, terminalVerified: true, orgId });

  {
    const d = setDay(1)
    await seed(d, [{ cost: 0.15, endUserId: memberA.id }, { cost: 0.05, endUserId: memberA.id }])
    check('B1 会员已花 0.2 = 上限：生成被拒 503 AI_BUDGET_EXHAUSTED', await withIdentity(asMember(memberA.id), () => enforce('generate')) === '503:AI_BUDGET_EXHAUSTED:member')
    check('B1 会员触顶：语音同样被拒', await withIdentity(asMember(memberA.id), () => enforce('voice')) === '503:AI_BUDGET_EXHAUSTED:member')
    check('B1 会员触顶：只读、导出不拦', await withIdentity(asMember(memberA.id), () => enforce('read')) === 'PASS' && await withIdentity(asMember(memberA.id), () => enforce('export')) === 'PASS')
    check('B1 别的会员、匿名照常', await withIdentity(asMember(memberB.id), () => enforce('generate')) === 'PASS' && await withIdentity(ANON, () => enforce('generate')) === 'PASS')
    const reached = logLines.filter((l) => l.startsWith('AI_DAILY_BUDGET_REACHED scope=member'))
    check('B1 首次触顶记一条固定标记日志（limit / day），第二次不重复', reached.length === 1 && reached[0] === `AI_DAILY_BUDGET_REACHED scope=member limit=0.2 day=${d}`, JSON.stringify(reached))
    check('B1 日志里没有会员号', !logLines.some((l) => l.includes(memberA.id)))
  }
  {
    const d = setDay(2)
    await seed(d, [{ cost: 0.3, terminalId: terminalA }, { cost: 0.2, terminalId: terminalA }])
    check('B2 终端已花 0.5 = 上限：该机生成被拒', await withIdentity(asTerminal(terminalA), () => enforce('generate')) === '503:AI_BUDGET_EXHAUSTED:terminal')
    check('B2 终端触顶：语音被拒、只读 / 导出不拦', await withIdentity(asTerminal(terminalA), () => enforce('voice')) === '503:AI_BUDGET_EXHAUSTED:terminal'
      && await withIdentity(asTerminal(terminalA), () => enforce('read')) === 'PASS' && await withIdentity(asTerminal(terminalA), () => enforce('export')) === 'PASS')
    check('B2 另一台机器照常', await withIdentity(asTerminal(terminalB), () => enforce('generate')) === 'PASS')
    check('B2 标记日志可带终端号', logLines.includes(`AI_DAILY_BUDGET_REACHED scope=terminal terminal=${terminalA} limit=0.5 day=${d}`))
  }
  {
    const d = setDay(3)
    await seed(d, [{ cost: 0.6 }, { cost: 0.4 }])
    check('B3 全站已花 1 = 上限：匿名生成被拒（global）', await withIdentity(ANON, () => enforce('generate')) === '503:AI_BUDGET_EXHAUSTED:global')
    check('B3 全站触顶：会员 / 终端也被拒', await withIdentity({ ...asTerminal(terminalB), endUserId: memberB.id }, () => enforce('voice')) === '503:AI_BUDGET_EXHAUSTED:global')
    check('B3 全站触顶：只读 / 导出不拦', await withIdentity(ANON, () => enforce('read')) === 'PASS' && await withIdentity(ANON, () => enforce('export')) === 'PASS')
  }
  {
    const d = setDay(4)
    await seed(d, [{ cost: null, endUserId: memberA.id }, { cost: null, endUserId: memberA.id }, { cost: null, endUserId: memberA.id }])
    const three = await budget.spent(d, { kind: 'member', id: memberA.id })
    check('B4 3 次未计量 = 3 × 0.05 = 0.15（保守计入，不当 0），仍放行', three === 0.15 && await withIdentity(asMember(memberA.id), () => enforce('generate')) === 'PASS', `spent=${three}`)
    await seed(d, [{ cost: null, endUserId: memberA.id }])
    check('B4 第 4 次未计量把会员额度计满 0.2：拒', await withIdentity(asMember(memberA.id), () => enforce('generate')) === '503:AI_BUDGET_EXHAUSTED:member')
  }
  {
    const d = setDay(5)
    await seed(d, [{ cost: 0.1, endUserId: memberB.id }])
    check('B5 缓存生效前：会员 0.1 放行', await withIdentity(asMember(memberB.id), () => enforce('generate')) === 'PASS')
    // 不清缓存：本进程新记的金额必须立即叠加，而不是等 10 秒缓存过期
    await withIdentity(asMember(memberB.id), () => call('overlay', reply(200, okJson({ prompt_tokens: 0, completion_tokens: 12_500, total_tokens: 12_500 })))) // 12500×8/1e6 = 0.1
    await meter.flushAiUsageMeter()
    check('B5 缓存期内本进程新记 0.1：立即计入并拒', await withIdentity(asMember(memberB.id), () => enforce('generate')) === '503:AI_BUDGET_EXHAUSTED:member')
  }
  {
    const late = setDay(6, 23.99)
    await seed(late, [{ cost: 0.2, endUserId: memberB.id }])
    check('B6 北京时间 23:59：当天会员额度已满，拒', await withIdentity(asMember(memberB.id), () => enforce('generate')) === '503:AI_BUDGET_EXHAUSTED:member')
    const next = setDay(7, 0.01)
    check('B6 过零点（北京时间 00:00）换新的一天：放行', next !== late && await withIdentity(asMember(memberB.id), () => enforce('generate')) === 'PASS', `${late} → ${next}`)
    check('B6 日期按北京时间：UTC 15:59:59 仍是当天，16:00:00 已是次日', meter.beijingDayKey(new Date('2026-09-29T15:59:59Z')) === '2026-09-29' && meter.beijingDayKey(new Date('2026-09-29T16:00:00Z')) === '2026-09-30')
  }
  {
    const bad = readAiBudgetLimits({ AI_DAILY_BUDGET_CNY: 'abc', AI_TERMINAL_DAILY_BUDGET_CNY: '-1', AI_MEMBER_DAILY_BUDGET_CNY: '   ', AI_UNMEASURED_CALL_COST_CNY: '0' } as NodeJS.ProcessEnv)
    check('B7 非法 env（非数字 / 负数 / 空白 / 未计量单价 0）回落默认', JSON.stringify(bad) === JSON.stringify(AI_BUDGET_DEFAULTS), JSON.stringify(bad))
    const huge = readAiBudgetLimits({ AI_DAILY_BUDGET_CNY: 'Infinity', AI_TERMINAL_DAILY_BUDGET_CNY: '1e12', AI_MEMBER_DAILY_BUDGET_CNY: 'NaN', AI_UNMEASURED_CALL_COST_CNY: '-0.05' } as NodeJS.ProcessEnv)
    check('B7 Infinity / 超大值 / NaN 不会变成「不限」，回落默认', JSON.stringify(huge) === JSON.stringify(AI_BUDGET_DEFAULTS), JSON.stringify(huge))
    const zero = readAiBudgetLimits({ AI_DAILY_BUDGET_CNY: '0' } as NodeJS.ProcessEnv)
    check('B7 全局 0 元是合法值（当天 AI 全停），不是「不限」', zero.globalCny === 0)
    check('B7 未配置时默认 100 / 30 / 5 / 0.05', JSON.stringify(readAiBudgetLimits({} as NodeJS.ProcessEnv)) === JSON.stringify({ globalCny: 100, terminalCny: 30, memberCny: 5, unmeasuredCallCostCny: 0.05 }))
  }
  // 读不到花费：库挂了
  const brokenPrisma = new Proxy({}, { get: () => ({ groupBy: async () => { throw Object.assign(new Error('db down'), { code: 'P1001' }) } }) })
  const brokenBudget = new AiBudgetService(brokenPrisma as never)
  const brokenAccess = accessWith(brokenBudget)
  {
    setDay(8)
    const r = (kind: 'generate' | 'voice' | 'read' | 'export') => withIdentity(asMember(memberA.id), () => outcome(() => brokenAccess.enforce(kind, false, { headers: {} }, OFF)))
    check('B8 读不到当日花费：生成失败关闭 503 AI_BUDGET_UNAVAILABLE', await r('generate') === '503:AI_BUDGET_UNAVAILABLE')
    check('B8 读不到当日花费：语音同样失败关闭', await r('voice') === '503:AI_BUDGET_UNAVAILABLE')
    check('B8 读不到当日花费：只读、导出不拦', await r('read') === 'PASS' && await r('export') === 'PASS')
  }
  // 守卫 + 真实控制器：生成 / 语音接口被拦，材料检查两处写入口在「耗尽」与「核不了」时都照常
  {
    const d = setDay(9)
    await seed(d, [{ cost: 1 }])
    const reflector = new Reflector()
    const ctxOf = (ctor: { prototype: object }, method: string) => ({
      getHandler: () => (ctor.prototype as Record<string, unknown>)[method],
      getClass: () => ctor,
      switchToHttp: () => ({ getRequest: () => ({ headers: {} }) }),
    }) as never
    const guardFor = (a: InstanceType<typeof AiAccessService>) => {
      const configured = Object.assign(Object.create(Object.getPrototypeOf(a)), a, { getConfig: async () => OFF })
      return new AiAccessGuard(reflector, configured)
    }
    const exhaustedGuard = guardFor(access)
    const unavailableGuard = guardFor(brokenAccess)
    check('B9 守卫：简历解析（generate）在全站触顶时被拒', await outcome(() => exhaustedGuard.canActivate(ctxOf(AiController, 'submitResumeParse'))) === '503:AI_BUDGET_EXHAUSTED:global')
    check('B9 守卫：面试语音转写（voice）在核不了额度时被拒', await outcome(() => unavailableGuard.canActivate(ctxOf(MockInterviewController, 'transcribe'))) === '503:AI_BUDGET_UNAVAILABLE')
    check('B9 守卫：报告导出（export）两种情况都放行', await outcome(() => exhaustedGuard.canActivate(ctxOf(ResumeReportExportController, 'export'))) === 'PASS' && await outcome(() => unavailableGuard.canActivate(ctxOf(ResumeReportExportController, 'export'))) === 'PASS')
    for (const method of ['createTask', 'decidePiiFindings']) {
      check(`B9 材料检查 ${method}：额度耗尽时守卫放行`, await outcome(() => exhaustedGuard.canActivate(ctxOf(MaterialsController, method))) === 'PASS')
      check(`B9 材料检查 ${method}：核不了额度时守卫放行`, await outcome(() => unavailableGuard.canActivate(ctxOf(MaterialsController, method))) === 'PASS')
    }
    // 真的建任务：守卫放行后控制器照常把任务交给材料服务并成功返回
    let created = 0
    const materials = { createTask: async () => { created += 1; return { id: `task-${created}`, status: 'queued' } } }
    const controller = new MaterialsController(materials as never, {} as never, jwt, redis, prisma)
    for (const guard of [exhaustedGuard, unavailableGuard]) {
      const pass = await outcome(() => guard.canActivate(ctxOf(MaterialsController, 'createTask')))
      const res = pass === 'PASS' ? await controller.createTask({} as never, { headers: { 'x-material-task-token': 'anon-token' } } as never) : null
      check(`B9 材料检查建任务成功（${guard === exhaustedGuard ? '额度耗尽' : '核不了额度'}）`, res?.success === true && (res.data as { id?: string }).id?.startsWith('task-') === true, `${pass}`)
    }
  }

  // ── [C] 同一会员两个前端合并计 ────────────────────────────────────────────────
  console.log('\n[C] 一体机与小程序同一会员同一本账')
  {
    const d = setDay(10)
    budget.resetForTests()
    const tokens = { prompt_tokens: 0, completion_tokens: 15_000, total_tokens: 15_000 } // 15000×8/1e6 = 0.12
    await viaMiddleware(kioskHeaders, () => call('kiosk-member', reply(200, okJson(tokens))))
    await viaMiddleware({ authorization: tokenFor(memberA.id, 'sid-a') }, () => call('miniapp-member', reply(200, okJson(tokens))))
    const [k] = await rowsOf('kiosk-member')
    const [m] = await rowsOf('miniapp-member')
    check('C1 一体机调用：会员 + 已验签终端', k?.endUserId === memberA.id && k?.terminalId === terminalA)
    check('C1 小程序调用：同一会员、无终端', m?.endUserId === memberA.id && m?.terminalId === null)
    const spent = await budget.spent(d, { kind: 'member', id: memberA.id })
    check('C1 会员额度合并计：0.12 + 0.12 = 0.24', spent === 0.24, `spent=${spent}`)
    check('C1 单边都没到 0.2，合起来超了：小程序上下文再调被拒', await viaMiddleware({ authorization: tokenFor(memberA.id, 'sid-a') }, () => enforce('generate')) === '503:AI_BUDGET_EXHAUSTED:member')
    check('C1 一体机上下文同样被拒', await viaMiddleware(kioskHeaders, () => enforce('generate')) === '503:AI_BUDGET_EXHAUSTED:member')
  }

  // ── [D] 后台汇总 ──────────────────────────────────────────────────────────────
  console.log('\n[D] 后台只读汇总')
  {
    const d = setDay(11)
    await seed(d, [
      { cost: 0.3, terminalId: terminalA, endUserId: memberA.id },
      { cost: 0.25, terminalId: terminalA },
      { cost: null, endUserId: memberB.id },
      { cost: 0.5, endUserId: memberB.id },
    ])
    const summary = await buildAiUsageDailySummary(prisma, d, budget.limits)
    const json = JSON.stringify(summary)
    check('D1 顶层字段白名单', JSON.stringify(Object.keys(summary).sort()) === JSON.stringify(['byFeature', 'byOrg', 'byTerminal', 'byVendor', 'day', 'limits', 'reached', 'totals']), Object.keys(summary).join(','))
    const bucketKeys = JSON.stringify(['calls', 'chargedCostCny', 'key', 'measuredCostCny', 'unmeasuredCalls'])
    check('D1 各维度桶字段白名单', [...summary.byFeature, ...summary.byVendor, ...summary.byTerminal, ...summary.byOrg].every((b) => JSON.stringify(Object.keys(b).sort()) === bucketKeys))
    check('D1 不含会员号，只给会员数', !json.includes(memberA.id) && !json.includes(memberB.id) && summary.totals.memberCount === 2)
    check('D1 合计：4 次、1 次未计量、实测 1.05、计入 1.1', summary.totals.calls === 4 && summary.totals.unmeasuredCalls === 1 && summary.totals.measuredCostCny === 1.05 && summary.totals.chargedCostCny === 1.1, JSON.stringify(summary.totals))
    check('D1 触顶：全站（1.1 ≥ 1）、终端 A（0.55 ≥ 0.5）、会员 2 人（0.3 与 0.55 都 ≥ 0.2）', summary.reached.global === true && JSON.stringify(summary.reached.terminalIds) === JSON.stringify([terminalA]) && summary.reached.memberCount === 2, JSON.stringify(summary.reached))
    check('D1 上限随汇总给出', summary.limits.globalCny === 1 && summary.limits.terminalCny === 0.5 && summary.limits.memberCny === 0.2 && summary.limits.unmeasuredCallCostCny === 0.05)
    const controller = new AdminAiUsageController(prisma, budget)
    check('D2 日期格式不对：400 AI_USAGE_DAY_INVALID', await outcome(() => controller.daily('2026-9-1')) === '400:AI_USAGE_DAY_INVALID')
    check('D2 仅管理员：类上有 JwtAuthGuard + RolesGuard 且 roles=[admin]', JSON.stringify(Reflect.getMetadata(ROLES_KEY, AdminAiUsageController)) === '["admin"]'
      && (Reflect.getMetadata(GUARDS_METADATA, AdminAiUsageController) as Array<{ name: string }>).map((g) => g.name).join(',') === 'JwtAuthGuard,RolesGuard')
    check('D2 路由 GET /admin/ai-usage/daily', Reflect.getMetadata(PATH_METADATA, AdminAiUsageController) === 'admin/ai-usage' && Reflect.getMetadata(PATH_METADATA, AdminAiUsageController.prototype.daily) === 'daily' && Reflect.getMetadata(METHOD_METADATA, AdminAiUsageController.prototype.daily) === RequestMethod.GET)
  }

  // ── [E] 接线 ──────────────────────────────────────────────────────────────────
  console.log('\n[E] 接线')
  {
    const { AppModule } = await import('../src/app.module')
    const applied: unknown[] = []
    const consumer = { apply: (...mws: unknown[]) => { applied.push(...mws); return { forRoutes: () => consumer, exclude: () => ({ forRoutes: () => consumer }) } } }
    new AppModule().configure(consumer as never)
    check('E1 app.module 的中间件链上挂着 AiRequestContextMiddleware', applied.includes(AiRequestContextMiddleware))
    const params = Reflect.getMetadata('design:paramtypes', AiAccessService) as unknown[]
    const optional = (Reflect.getMetadata('optional:paramtypes', AiAccessService) as number[] | undefined) ?? []
    const idx = params.indexOf(AiBudgetService)
    check('E2 AiAccessService 由 Nest 注入 AiBudgetService，且未标 @Optional（缺了启动即报错）', idx >= 0 && !optional.includes(idx))
    const { AiAccessModule } = await import('../src/ai-access/ai-access.module')
    check('E3 AiAccessModule 导入 AiUsageModule', ((Reflect.getMetadata('imports', AiAccessModule) as unknown[]) ?? []).includes(AiUsageModule))
    // A1 那一行就是经由 createApplicationContext(AiUsageModule) → onModuleInit 注册的去处落的库
    await app.close()
    await call('after-close', reply(200, okJson()))
    await meter.flushAiUsageMeter()
    const afterClose = await cleanup.aiUsageRecord.count({ where: { featureKey: feature('after-close') } })
    check('E4 计量去处随模块生命周期注册 / 注销（关闭后不再写，并告警「未计量」）', afterClose === 0 && logLines.some((l) => l.includes('NOT being metered')), `count=${afterClose}`)
  }

  // ── 清理本次运行的数据 ─────────────────────────────────────────────────────────
  await cleanup.aiUsageRecord.deleteMany({ where: { dayKey: { in: [...usedDays] } } })
  await cleanup.terminal.deleteMany({ where: { id: { in: [terminalA, terminalB] } } })
  await cleanup.organization.deleteMany({ where: { id: orgId } })
  await cleanup.endUser.deleteMany({ where: { id: { in: [memberA.id, memberB.id] } } })
  await cleanup.onModuleDestroy()
  meter.setAiUsageClockForTests(null)

  console.log(`\n${failures === 0 ? '✅' : '❌'} verify:ai-usage-budget ${checks - failures}/${checks} 通过`)
  if (failures > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error('❌ verify:ai-usage-budget 崩溃：', error)
  process.exitCode = 1
}).finally(() => setTimeout(() => process.exit(process.exitCode ?? 0), 50))
