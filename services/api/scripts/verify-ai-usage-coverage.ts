/**
 * verify:ai-usage-budget 的第二段（由同名 npm 脚本串联执行）—— 计量覆盖面补齐（2026-09-29）
 *
 * 为什么不写进 verify-ai-usage-budget.ts：那份已 468 行、按 [A]–[E] 覆盖 llmFetchJson 这一个出口；
 * 这里补的是 llmFetchJson **之外**的两条路径，各自要起一套不同的夹具（合同审查编排器、
 * 真 Nest HTTP + multer），放进去会把那份门禁推过 600 行。
 *
 *   [F] 合同审查的大模型调用（StrictFetchContractProviderTransport.send，不经 llmFetchJson）
 *       真跑「编排器 → 真 provider 服务 → 真 transport（fetch 注入）」：请求发出后每个结局一行账；
 *       功能键 contract_review；金额与 AiServiceLog 的估算同一口径；取不到用量记 null；
 *       行里没有合同正文；会员取任务属主、终端 / 机构如实为 null（队列作业里没有已验签终端）；
 *       即使作业碰巧跑在别的请求上下文里，也不会把那个请求的会员 / 终端记进来；
 *       白名单拒绝不入账。
 *   [G] multipart 上传类 AI 接口：真起 Nest（真 AiController + 真 AiRequestContextMiddleware +
 *       真 FileInterceptor 配置），分块慢速上传一段 WAV 到 POST /resume/voice/transcribe；
 *       在处理函数里（multer 读完流之后）读身份上下文、并真发一次 llmFetchJson 让计量器落账 ——
 *       会员号、已验签终端都不能丢。附阳性对照：同一请求里挂在原始流 'end' 事件上的回调读到的上下文。
 *
 * 不触网（fetch 注入），不连 Redis（桩）。写隔离库：VERIFICATION_DATABASE_TARGET=isolated。
 */
import 'reflect-metadata'
import 'dotenv/config'
import { randomUUID } from 'crypto'
import { request as httpRequest } from 'node:http'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

let failures = 0
let checks = 0
function check(name: string, ok: boolean, detail = ''): void {
  checks += 1
  if (ok) { console.log(`  ✅ ${name}`); return }
  failures += 1
  console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`)
}

async function main(): Promise<void> {
  assertIsolatedVerificationDatabase()
  process.env['AI_DAILY_BUDGET_CNY'] = '100'
  delete process.env['AI_UNMEASURED_CALL_COST_CNY']
  delete process.env['AI_ENDPOINT_ALLOWLIST']
  delete process.env['AI_ENDPOINT_ALLOWLIST_EXTRA']

  const { Module } = await import('@nestjs/common')
  const { NestFactory } = await import('@nestjs/core')
  const { JwtService } = await import('@nestjs/jwt')
  const { PrismaService } = await import('../src/prisma/prisma.service')
  const { RedisService } = await import('../src/common/redis/redis.service')
  const { memberSessionKey } = await import('../src/common/guards/end-user-auth.guard')
  const { llmFetchJson } = await import('../src/ai/llm/llm-http')
  const meter = await import('../src/ai/usage/ai-usage-meter')
  const ctxMod = await import('../src/ai/usage/ai-usage-context')
  const { AiRequestContextMiddleware } = await import('../src/ai/usage/ai-request-context.middleware')
  const { AiBudgetService } = await import('../src/ai/usage/ai-budget.service')
  const { AiUsageModule } = await import('../src/ai/usage/ai-usage.module')
  const { estimateCostCny } = await import('../src/ai/usage/ai-pricing')
  const { TerminalSessionService } = await import('../src/terminals/terminal-session.service')
  const provider = await import('../src/contract-review/contract-review-provider.service')
  const { ContractReviewOrchestratorService, createContractReviewExtractionFingerprint } = await import('../src/contract-review/contract-review-orchestrator.service')
  const { AiController } = await import('../src/ai/ai.controller')
  const { AiService } = await import('../src/ai/ai.service')
  const { AiLogService } = await import('../src/ai/ai-log.service')
  const { AuditService } = await import('../src/audit/audit.service')
  const { AsrService } = await import('../src/asr/asr.service')
  const { BenefitRedemptionService } = await import('../src/benefit-redemption/benefit-redemption.service')
  const { AiPublicQuotaService } = await import('../src/ai/ai-public-quota.service')
  const { MemberPrivacyService } = await import('../src/member-privacy/member-privacy.service')
  const { AssistantSummaryService } = await import('../src/advisor/assistant-summary.service')

  const runId = randomUUID().slice(0, 8)
  const baseDayMs = Date.UTC(2095, 0, 1) + Math.floor(Math.random() * 20_000) * 86_400_000
  let now = new Date(baseDayMs + 4 * 3_600_000)
  meter.setAiUsageClockForTests(() => now)
  const usedDays = new Set<string>()
  let dayN = 0
  /** 每个用例一天：按 dayKey 取行，互不串账。 */
  const nextDay = () => { dayN += 1; now = new Date(baseDayMs + dayN * 86_400_000 + 4 * 3_600_000); const d = meter.beijingDayKey(now); usedDays.add(d); return d }

  const app = await NestFactory.createApplicationContext(AiUsageModule, { logger: false })
  const budget = app.get(AiBudgetService)
  const prisma = app.get(PrismaService)

  const owner = await prisma.endUser.create({ data: { phoneHash: `verify-ai-usage-cov-${runId}-owner`, phoneEnc: 'x' } })
  const other = await prisma.endUser.create({ data: { phoneHash: `verify-ai-usage-cov-${runId}-other`, phoneEnc: 'x' } })
  const orgId = `verify-ai-usage-cov-org-${runId}`
  await prisma.organization.create({ data: { id: orgId, name: '门禁机构', type: 'school' } })
  const terminalA = `verify-ai-usage-cov-t-${runId}`
  await prisma.terminal.create({ data: { id: terminalA, terminalCode: terminalA, agentToken: `tok-${terminalA}`, deviceFingerprint: 'fp', orgId } })
  const rowsOn = async (dayKey: string) => { await meter.flushAiUsageMeter(); return prisma.aiUsageRecord.findMany({ where: { dayKey } }) }

  // ── [F] 合同审查 ────────────────────────────────────────────────────────────
  console.log('\n[F] 合同审查的大模型调用计量')
  const CONTRACT_MARK = `合同正文标记${runId}`
  const contractEnv = {
    CONTRACT_REVIEW_PROVIDER: 'deepseek',
    CONTRACT_REVIEW_BASE_URL: 'https://api.deepseek.com/',
    CONTRACT_REVIEW_MODEL: 'deepseek-v4-pro',
    CONTRACT_REVIEW_API_KEY: 'verify-contract-key-0123456789abcdef',
  }
  let fetchCalls = 0
  let lastRedirect: RequestRedirect | undefined
  type FetchLike = (input: string, init: RequestInit) => Promise<Response>
  const upstream = (status: number, usage?: unknown): FetchLike => async (_url, init) => {
    fetchCalls += 1
    lastRedirect = init.redirect
    const json = { choices: [{ message: { content: JSON.stringify({ findings: [] }) } }], ...(usage ? { usage } : {}) }
    return new Response(JSON.stringify(status >= 200 && status < 300 ? json : { error: { message: 'x' } }), { status, headers: { 'content-type': 'application/json' } })
  }
  const hanging: FetchLike = (_url, init) => {
    fetchCalls += 1
    return new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted'))))
  }
  const makeProvider = (fetchImpl: FetchLike, maxTimeoutMs?: number) => new provider.ContractReviewProviderService({
    env: () => contractEnv,
    approvalGate: { assertApproved: () => undefined },
    transport: new provider.StrictFetchContractProviderTransport(fetchImpl, maxTimeoutMs),
  })

  // 编排器夹具：与 contract-review-orchestrator.test.ts 同一形状，provider 换成真的。
  const extracted = {
    sourceSha256: 'a'.repeat(64), sourceSizeBytes: 128, ocrProvider: null,
    mode: 'text_layer', totalPages: 1, analyzedPages: 1, truncated: false, ocrConfidence: null,
    pages: [{ pageNumber: 1, text: `试用期为六个月。${CONTRACT_MARK}`, source: 'text_layer', ocrConfidence: null }],
  } as const
  const candidate = {
    priorityCheckCount: 0, attentionCount: 0, insufficientInfoCount: 0, coverage: 'complete', ocrConfidence: 'high',
    disclaimerVersion: 'disclaimer-v1', rulePackVersion: 'labor-contract-cn-p0-v1', generatedByAi: true, findings: [],
  }
  const aiLogs: Array<Record<string, unknown>> = []
  const orchestratorFor = (runtime: unknown, endUserId: string | null) => {
    let current: Record<string, unknown> = {
      id: 'task-1', sourceFileId: 'file-1', endUserId, status: 'rule_checking', confirmedAt: now,
      contractType: 'labor_contract', disclaimerVersion: 'disclaimer-v1', schemaVersion: 'contract-review-v1',
      rulePackVersion: 'labor-contract-cn-p0-v1', resultJson: null, ocrConfidence: null, analyzedPages: 1, errorCode: null,
      extractionFingerprint: createContractReviewExtractionFingerprint('file-1', extracted as never, 'contract-review-v1'),
      expiresAt: new Date(now.getTime() + 3_600_000),
    }
    const delegate = {
      findUnique: async () => structuredClone(current),
      updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        const status = where['status']
        if (typeof status === 'string' && status !== current['status']) return { count: 0 }
        if (status && typeof status === 'object' && Array.isArray((status as { in?: unknown[] }).in) && !(status as { in: unknown[] }).in.includes(current['status'])) return { count: 0 }
        current = { ...current, ...data }
        return { count: 1 }
      },
    }
    const fakePrisma = { contractReviewTask: delegate, $transaction: async <T>(work: (tx: unknown) => Promise<T>) => work({ contractReviewTask: delegate }) }
    return new ContractReviewOrchestratorService(
      fakePrisma as never,
      { extract: async () => extracted } as never,
      { merge: () => ({ facts: {}, hasFieldConflict: false }) } as never,
      { evaluate: () => [] } as never,
      { mapRules: () => [], mapAi: () => [], composeResult: () => candidate } as never,
      { validate: () => candidate } as never,
      runtime as never,
      { record: (entry: Record<string, unknown>) => { aiLogs.push(entry) } } as never,
      { now: () => new Date(now) },
    )
  }
  const settle = async (op: () => Promise<unknown>) => { try { await op(); return 'PASS' } catch (error) { return (error as Error).message } }

  {
    const d = nextDay()
    const usage = { prompt_tokens: 10_000, completion_tokens: 2_000, total_tokens: 12_000 }
    const logsBefore = aiLogs.length
    const result = await settle(() => orchestratorFor(makeProvider(upstream(200, usage)), owner.id).analyze('task-1'))
    const rows = await rowsOn(d)
    const row = rows[0]
    check('F1 合同审查成功：主流程照常完成', result === 'PASS', result)
    check('F1 请求发出后恰好记一行账', rows.length === 1, `rows=${rows.length}`)
    check('F1 字段：功能 contract_review / 厂商 deepseek / 型号 deepseek-v4-pro / ok / 200',
      row?.featureKey === 'contract_review' && row?.vendor === 'deepseek' && row?.model === 'deepseek-v4-pro' && row?.status === 'ok' && row?.httpStatus === 200, JSON.stringify(row))
    // 10000×9 + 2000×27 元/百万 tokens（DeepSeek V4-Pro 高峰价）= 0.144
    check('F1 金额按共用价目折算（V4-Pro 高峰价 0.144 元）且标为已计量', row?.promptTokens === 10_000 && row?.completionTokens === 2_000 && row?.costCny === 0.144 && row?.costMeasured === true, `cost=${row?.costCny}`)
    const log = aiLogs.slice(logsBefore).find((entry) => entry['operation'] === 'contractReview')
    const logCost = log ? estimateCostCny(String(log['provider']), log['tokenUsage'] as never) : undefined
    check('F1 与 AiServiceLog 同一口径：后台 AI 服务日志的估算金额 = 计量账金额', logCost !== undefined && logCost === row?.costCny, `aiLog=${logCost} usage=${row?.costCny}`)
    check('F1 会员记任务属主；终端 / 机构如实为 null（队列作业里没有已验签终端）',
      row?.endUserId === owner.id && row?.terminalId === null && row?.terminalVerified === false && row?.orgId === null, JSON.stringify(row))
    check('F1 行里没有合同正文', row !== undefined && !JSON.stringify(row).includes(CONTRACT_MARK))
    check('F1 出站仍是 redirect: error', lastRedirect === 'error', String(lastRedirect))
    const spent = await budget.spent(d, { kind: 'member', id: owner.id })
    const global = await budget.spent(d, { kind: 'global', id: null })
    check('F1 这笔花费计入全站额度与属主会员额度', spent === 0.144 && global === 0.144, `member=${spent} global=${global}`)
  }
  {
    const d = nextDay()
    // 作业碰巧跑在另一个请求的上下文里（ALS 从建连接的请求漏进来）：不能把那个请求的会员 / 终端记进账
    const foreign = { endUserId: other.id, terminalId: terminalA, terminalVerified: true, orgId }
    await ctxMod.runWithAiRequestContext(ctxMod.lazyAiRequestContext(async () => foreign), () =>
      settle(() => orchestratorFor(makeProvider(upstream(200, { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 })), owner.id).analyze('task-1')))
    const [row] = await rowsOn(d)
    check('F2 作业上下文由任务决定：记属主会员、不沿用外来请求的会员 / 终端 / 机构',
      row !== undefined && row.endUserId === owner.id && row.terminalId === null && row.terminalVerified === false && row.orgId === null, JSON.stringify(row))
  }
  {
    const d = nextDay()
    await settle(() => orchestratorFor(makeProvider(upstream(200, { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 })), null).analyze('task-1'))
    const [row] = await rowsOn(d)
    check('F3 匿名任务：会员如实为 null', row !== undefined && row.endUserId === null && row.featureKey === 'contract_review', JSON.stringify(row))
  }
  {
    const d = nextDay()
    await settle(() => orchestratorFor(makeProvider(upstream(200)), owner.id).analyze('task-1'))
    const [row] = await rowsOn(d)
    check('F4 上游没回 usage：costCny 为 null（不是 0）、未计量', row !== undefined && row.costCny === null && row.costMeasured === false && row.promptTokens === null, JSON.stringify(row))
  }
  {
    const d = nextDay()
    const r = await settle(() => makeProvider(upstream(500)).reviewWithIdentity({ pages: [{ pageNumber: 1, text: '试用期为六个月。' }], partyFacts: { hasPartyA: true, hasPartyB: true, hasEmployer: true, hasWorker: true, hasUscc: false, hasBankAccount: false } }))
    const [row] = await rowsOn(d)
    check('F5 上游 500：原错误码照抛，记 upstream_error / 500', r === 'CONTRACT_PROVIDER_TRANSPORT_FAILED' && row?.status === 'upstream_error' && row?.httpStatus === 500 && row?.costCny === null, `${r} ${JSON.stringify(row)}`)
    const d2 = nextDay()
    const r429 = await settle(() => makeProvider(upstream(429)).reviewWithIdentity({ pages: [{ pageNumber: 1, text: '试用期为六个月。' }], partyFacts: { hasPartyA: true, hasPartyB: true, hasEmployer: true, hasWorker: true, hasUscc: false, hasBankAccount: false } }))
    const [busy] = await rowsOn(d2)
    check('F5 上游 429：记 busy', r429 === 'CONTRACT_PROVIDER_TRANSPORT_FAILED' && busy?.status === 'busy' && busy?.httpStatus === 429, JSON.stringify(busy))
  }
  {
    const d = nextDay()
    const r = await settle(() => makeProvider(hanging, 50).reviewWithIdentity({ pages: [{ pageNumber: 1, text: '试用期为六个月。' }], partyFacts: { hasPartyA: true, hasPartyB: true, hasEmployer: true, hasWorker: true, hasUscc: false, hasBankAccount: false } }))
    const [row] = await rowsOn(d)
    check('F6 超时：原错误码照抛，记 timeout、未计量', r === 'CONTRACT_PROVIDER_TIMEOUT' && row?.status === 'timeout' && row?.costMeasured === false && row?.httpStatus === null, `${r} ${JSON.stringify(row)}`)
    const d2 = nextDay()
    const net = await settle(() => makeProvider(async () => { fetchCalls += 1; throw new TypeError('fetch failed') }).reviewWithIdentity({ pages: [{ pageNumber: 1, text: '试用期为六个月。' }], partyFacts: { hasPartyA: true, hasPartyB: true, hasEmployer: true, hasWorker: true, hasUscc: false, hasBankAccount: false } }))
    const [netRow] = await rowsOn(d2)
    check('F6 网络错误：记 network_error', net === 'CONTRACT_PROVIDER_TRANSPORT_FAILED' && netRow?.status === 'network_error', JSON.stringify(netRow))
  }
  {
    const d = nextDay()
    const before = fetchCalls
    const transport = new provider.StrictFetchContractProviderTransport(upstream(200))
    const r = await settle(() => transport.send({ url: 'https://llm.not-allowed.example/chat/completions', apiKey: contractEnv.CONTRACT_REVIEW_API_KEY, payload: { model: 'deepseek-v4-pro', messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }], response_format: { type: 'json_object' }, temperature: 0 }, timeoutMs: 5_000 }))
    const rows = await rowsOn(d)
    check('F7 出站白名单拒绝：原错误照抛、一个请求都没发、不入账', r === 'CONTRACT_PROVIDER_ENDPOINT_NOT_ALLOWED' && fetchCalls === before && rows.length === 0, `${r} fetch+${fetchCalls - before} rows=${rows.length}`)
  }

  // ── [G] multipart 上传类 AI 接口：multer 读完流后身份上下文还在不在 ───────────────
  console.log('\n[G] multipart 上传后身份上下文')
  {
    const d = nextDay()
    const jwt = new JwtService({ secret: 'verify-ai-usage-coverage-secret-0123456789' })
    const sessions: Record<string, string> = { [memberSessionKey(`sid-${runId}`)]: owner.id }
    // 'then' 必须是 undefined：Nest 会把带 then 的 useValue 当 Promise 等待，桩就永远等不到。
    const redis = new Proxy({}, { get: (_t, prop: string) => (prop === 'then' ? undefined : prop === 'get' ? async (key: string) => sessions[key] ?? null : async () => null) })
    const terminalSessions = { validate: async (id: string | undefined, token: string | undefined) => { if (!id || token !== `good-${id}`) throw new Error('TERMINAL_SESSION_INVALID') } }
    const FEATURE = `vf-multipart-${runId}`
    let handlerIdentity: import('../src/ai/usage/ai-usage-context').AiCallerIdentity | null | undefined = null
    let streamEndHadContext: boolean | null = null
    let chunkEvents = 0
    const asr = {
      activeProviderName: 'verify-asr',
      async recognizeWav() {
        // 「计量回调」所在的位置：处理函数里、multer 已经把整个请求体读完之后。
        handlerIdentity = await ctxMod.currentAiRequestContext()?.identity()
        await llmFetchJson('https://api.deepseek.com/v1/chat/completions', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'deepseek-v4-flash', messages: [{ role: 'user', content: '整理一下' }] }),
        }, { timeoutMs: 5_000, fetchImpl: (async () => new Response(JSON.stringify({ choices: [{ message: { content: '好' } }], usage: { prompt_tokens: 100, completion_tokens: 100, total_tokens: 200 } }), { status: 200 })) as typeof fetch, contentModeration: { feature: FEATURE } })
        return { ok: true, text: '你好' }
      },
    }
    /** 阳性对照：挂在原始请求流 'end' 事件上的回调里读上下文（不读数据，不改变流的状态）。 */
    class StreamEndProbe {
      use(req: { on: (event: string, cb: () => void) => void }, _res: unknown, next: () => void) {
        req.on('end', () => { streamEndHadContext = ctxMod.currentAiRequestContext() !== undefined })
        next()
      }
    }
    class ProbeModule {
      configure(consumer: { apply: (...mws: unknown[]) => { forRoutes: (...routes: string[]) => unknown } }) {
        consumer.apply(AiRequestContextMiddleware, StreamEndProbe).forRoutes('*path')
      }
    }
    Module({
      controllers: [AiController],
      providers: [
        AiRequestContextMiddleware,
        StreamEndProbe,
        { provide: JwtService, useValue: jwt },
        { provide: RedisService, useValue: redis },
        { provide: PrismaService, useValue: prisma },
        { provide: TerminalSessionService, useValue: terminalSessions },
        { provide: AsrService, useValue: asr },
        { provide: AiLogService, useValue: { record: () => undefined } },
        { provide: AiService, useValue: {} },
        { provide: AuditService, useValue: { write: async () => undefined } },
        { provide: BenefitRedemptionService, useValue: {} },
        { provide: AiPublicQuotaService, useValue: {} },
        { provide: MemberPrivacyService, useValue: {} },
        { provide: AssistantSummaryService, useValue: {} },
      ],
    })(ProbeModule)
    const http = await NestFactory.create(ProbeModule, { logger: false })
    await http.listen(0, '127.0.0.1')
    const address = http.getHttpServer().address() as { port: number }

    // 2 MB 的 WAV，64 KB 一块、块间隔 5 ms：请求体一定是分多次 socket 读到的，multer 的收尾事件
    // 发生在后到的数据块上，而不是中间件同步调用栈里。
    const audio = Buffer.alloc(2 * 1024 * 1024, 0)
    audio.write('RIFF', 0, 'ascii')
    audio.write('WAVE', 8, 'ascii')
    const boundary = `----verify${runId}`
    const head = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="a.wav"\r\nContent-Type: audio/wav\r\n\r\n`)
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`)
    const payload = Buffer.concat([head, audio, tail])
    const token = jwt.sign({ sub: owner.id, jti: `sid-${runId}` }, { audience: 'enduser', expiresIn: '10m' })
    const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = httpRequest({
        host: '127.0.0.1', port: address.port, method: 'POST', path: '/resume/voice/transcribe',
        headers: {
          'content-type': `multipart/form-data; boundary=${boundary}`, 'content-length': String(payload.length),
          authorization: `Bearer ${token}`, 'x-terminal-id': terminalA, 'x-terminal-session-token': `good-${terminalA}`,
        },
      }, (res) => {
        let body = ''
        res.on('data', (c: Buffer) => { body += c.toString('utf8') })
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }))
      })
      req.on('error', reject)
      req.setTimeout(60_000, () => { req.destroy(new Error('multipart request timed out')) })
      let offset = 0
      const pump = () => {
        if (offset >= payload.length) { req.end(); return }
        req.write(payload.subarray(offset, offset + 64 * 1024))
        offset += 64 * 1024
        chunkEvents += 1
        setTimeout(pump, 5)
      }
      pump()
    })
    await http.close()
    const [row] = (await rowsOn(d)).filter((r) => r.featureKey === FEATURE)
    check('G1 真实接口 POST /resume/voice/transcribe 分块上传成功（multer 真读完了流）', response.status === 201 && response.body.includes('你好') && chunkEvents > 20, `${response.status} ${response.body.slice(0, 120)} chunks=${chunkEvents}`)
    check('G2 multer 读完流之后，处理函数里的身份上下文仍在：会员号没丢', handlerIdentity !== undefined && handlerIdentity !== null && (handlerIdentity as { endUserId: string | null }).endUserId === owner.id, JSON.stringify(handlerIdentity))
    check('G2 已验签终端与所属机构也没丢', (handlerIdentity as { terminalId?: string | null } | null)?.terminalId === terminalA && (handlerIdentity as { orgId?: string | null } | null)?.orgId === orgId, JSON.stringify(handlerIdentity))
    check('G3 计量账那一行记上了会员、终端、机构', row !== undefined && row.endUserId === owner.id && row.terminalId === terminalA && row.terminalVerified === true && row.orgId === orgId, JSON.stringify(row))
    console.log(`  ℹ️  阳性对照：原始请求流 'end' 回调里${streamEndHadContext === null ? '未触发' : streamEndHadContext ? '仍有上下文' : '读不到上下文（事件回调不继承 ALS）'}；处理函数里靠 FileInterceptor 的 await 续上`)
  }

  // ── 清理 ─────────────────────────────────────────────────────────────────────
  await prisma.aiUsageRecord.deleteMany({ where: { dayKey: { in: [...usedDays] } } })
  await prisma.terminal.deleteMany({ where: { id: terminalA } })
  await prisma.organization.deleteMany({ where: { id: orgId } })
  await prisma.endUser.deleteMany({ where: { id: { in: [owner.id, other.id] } } })
  await app.close()
  meter.setAiUsageClockForTests(null)

  console.log(`\n${failures === 0 ? '✅' : '❌'} verify:ai-usage-budget（覆盖面）${checks - failures}/${checks} 通过`)
  if (failures > 0) process.exitCode = 1
}

main().catch((error) => {
  console.error('❌ verify:ai-usage-budget（覆盖面）崩溃：', error)
  process.exitCode = 1
}).finally(() => setTimeout(() => process.exit(process.exitCode ?? 0), 50))
