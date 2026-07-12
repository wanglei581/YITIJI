import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

export interface RuntimeReporter {
  pass(message: string): void
  fail(message: string): void
}

export interface RuntimeCheckOptions {
  rootDir: string
  governedRel: string
  reporter: RuntimeReporter
}

type GovernedService = {
  analyzeForJobFit?: (...args: unknown[]) => Promise<unknown>
  matchForMember?: (...args: unknown[]) => Promise<unknown>
}

type GovernedConstructor = new (
  prisma: unknown,
  jobFit: unknown,
  context: unknown,
  aiLog: unknown,
  privacy: unknown,
  quota: unknown,
) => GovernedService

type Harness = {
  service: GovernedService
  sessions: Array<{ data: Record<string, unknown> }>
  updates: Array<Record<string, unknown>>
  logs: Array<Record<string, unknown>>
  tokenUsage: Record<string, number>
  analyzeCalls: number
  quotaAttempts: number
  quotaRollbacks: number
  anonymousConsentChecks: number
}

type HarnessOptions = {
  quotaFails?: boolean
  llmFails?: boolean
  jobFitFails?: boolean
  anonymousConsent?: 'active' | 'revoked' | 'legacy'
}

function harness(GovernedJobFitService: GovernedConstructor, options: HarnessOptions = {}): Harness {
  const sessions: Array<{ data: Record<string, unknown> }> = []
  const updates: Array<Record<string, unknown>> = []
  const logs: Array<Record<string, unknown>> = []
  const tokenUsage = { promptTokens: 10, completionTokens: 5, totalTokens: 15 }
  let analyzeCalls = 0
  let quotaAttempts = 0
  let quotaRollbacks = 0
  let anonymousConsentChecks = 0
  let sessionNumber = 0
  const parseExpiry = new Date(Date.now() + 30 * 60 * 1000)
  const parseFor = (requester: { endUserId?: unknown }) => ({
    endUserId: typeof requester.endUserId === 'string' ? requester.endUserId : null,
    accessTokenHash: 'hash',
    expiresAt: parseExpiry,
    jobAiConsentVersion: options.anonymousConsent === 'legacy' ? 'job_fit_anonymous_v0' : 'job_fit_anonymous_v1',
    jobAiConsentGrantedAt: new Date(Date.now() - 1_000),
    jobAiConsentRevokedAt: options.anonymousConsent === 'revoked' ? new Date(Date.now() - 500) : null,
  })
  const jobFit = {
    authorizeParseForJobFit: async (_taskId: string, requester: { endUserId?: unknown }) => parseFor(requester),
    requireActiveAnonymousJobFitConsent: (parse: { jobAiConsentVersion: string | null; jobAiConsentGrantedAt: Date | null; jobAiConsentRevokedAt: Date | null }) => {
      anonymousConsentChecks += 1
      if (parse.jobAiConsentVersion !== 'job_fit_anonymous_v1' || !parse.jobAiConsentGrantedAt || parse.jobAiConsentRevokedAt) {
        throw new Error('ANONYMOUS_CONSENT_INACTIVE')
      }
    },
    analyzeWithUsage: async () => {
      analyzeCalls += 1
      if (options.llmFails) throw new Error('LLM_STUB_FAILED')
      if (options.jobFitFails) {
        return {
          response: { taskId: 'runtime-task', status: 'failed', failReason: '受控 JobFit 失败响应' },
          provider: 'llm:stub:model', tokenUsage,
        }
      }
      return {
        response: {
          taskId: 'runtime-task', status: 'completed', fitLevel: 'reference_medium', summary: '仅供参考',
          matchPoints: [], gapPoints: [], targetedSuggestions: [],
        },
        provider: 'llm:stub:model', tokenUsage,
      }
    },
  }
  const prisma = {
    jobAiSession: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        sessionNumber += 1
        sessions.push({ data })
        return { id: `runtime-session-${sessionNumber}`, ...data, createdAt: new Date() }
      },
      update: async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data)
        return { id: 'runtime-session-1', ...data, createdAt: new Date() }
      },
    },
    jobAiRecommendation: { create: async () => ({ id: 'runtime-recommendation' }) },
  }
  const quota = {
    consume: async () => {
      quotaAttempts += 1
      if (options.quotaFails) throw new Error('QUOTA_STUB_FAILED')
      return { keys: ['runtime-quota'] }
    },
    rollback: async () => { quotaRollbacks += 1 },
  }
  const service = new GovernedJobFitService(
    prisma, jobFit,
    { buildTargetJobContext: async (jobId: string) => ({ jobId, title: '系统岗位' }) },
    { record: (entry: Record<string, unknown>) => { logs.push(entry) } },
    { requireActiveConsent: async () => undefined },
    quota,
  )
  return {
    service, sessions, updates, logs, tokenUsage,
    get analyzeCalls() { return analyzeCalls },
    get quotaAttempts() { return quotaAttempts },
    get quotaRollbacks() { return quotaRollbacks },
    get anonymousConsentChecks() { return anonymousConsentChecks },
  }
}

function intent(data: Record<string, unknown>): Record<string, unknown> | null {
  if (typeof data.intentJson !== 'string') return null
  try {
    const value = JSON.parse(data.intentJson) as unknown
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  } catch {
    return null
  }
}

async function rejects(call: () => Promise<unknown>): Promise<boolean> {
  try {
    await call()
    return false
  } catch {
    return true
  }
}

function sameTokenUsage(actual: unknown, expected: Record<string, number>): boolean {
  if (actual === null || typeof actual !== 'object') return false
  const usage = actual as Record<string, unknown>
  return usage.promptTokens === expected.promptTokens
    && usage.completionTokens === expected.completionTokens
    && usage.totalTokens === expected.totalTokens
}

type JobFitConsentService = {
  authorizeParseForJobFit: (taskId: string, requester: { endUserId: string | null; accessToken: string | null }) => Promise<unknown>
  requireActiveAnonymousJobFitConsent?: (parse: unknown) => unknown
}

type JobFitConstructor = new (prisma: unknown, llm: unknown, extraction: unknown, audit: unknown) => JobFitConsentService

async function checkJobFitConsent(rootDir: string, reporter: RuntimeReporter): Promise<void> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require(join(rootDir, 'src/ai/resume/job-fit.service.ts')) as { JobFitService?: unknown }
    if (typeof loaded.JobFitService !== 'function') {
      reporter.fail('JobFitService 运行时导出缺失，无法验证匿名 consent boundary')
      return
    }
    const JobFitService = loaded.JobFitService as JobFitConstructor
    const token = 'runtime-anonymous-consent-token'
    const accessTokenHash = createHash('sha256').update(token, 'utf8').digest('hex')
    const verify = async (mode: 'active' | 'revoked' | 'legacy'): Promise<boolean> => {
      const service = new JobFitService({
        aiResumeResult: {
          findUnique: async () => ({
            endUserId: null, accessTokenHash, expiresAt: new Date(Date.now() + 60_000),
            jobAiConsentVersion: mode === 'legacy' ? 'job_fit_anonymous_v0' : 'job_fit_anonymous_v1',
            jobAiConsentGrantedAt: new Date(Date.now() - 1_000),
            jobAiConsentRevokedAt: mode === 'revoked' ? new Date(Date.now() - 500) : null,
          }),
        },
      }, {}, {}, {})
      if (typeof service.requireActiveAnonymousJobFitConsent !== 'function') return false
      const parse = await service.authorizeParseForJobFit('runtime-consent-task', { endUserId: null, accessToken: token })
      return rejects(() => Promise.resolve().then(() => service.requireActiveAnonymousJobFitConsent!(parse)))
    }
    const activeRejected = await verify('active')
    const revokedRejected = await verify('revoked')
    const legacyRejected = await verify('legacy')
    if (activeRejected || !revokedRejected || !legacyRejected) {
      reporter.fail('真实 JobFitService：active 应通过，revoked/legacy parse consent 必须拒绝')
    } else {
      reporter.pass('真实 JobFitService：active 通过，revoked/legacy parse consent 均拒绝')
    }
  } catch (error) {
    reporter.fail(`真实 JobFitService 匿名 consent 内存验证失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

type JobFitController = { analyze: (dto: unknown, req: unknown) => Promise<unknown> }

async function checkControllerQuota(rootDir: string, governedRel: string, reporter: RuntimeReporter): Promise<void> {
  if (!existsSync(join(rootDir, governedRel))) return
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('reflect-metadata')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require(join(rootDir, 'src/ai/job-fit.controller.ts')) as { JobFitController?: unknown }
    if (typeof loaded.JobFitController !== 'function') {
      reporter.fail('JobFitController 运行时导出缺失，无法验证 quota context 透传')
      return
    }
    const Controller = loaded.JobFitController as unknown as new (...args: unknown[]) => JobFitController
    const parameterTypes = Reflect.getMetadata('design:paramtypes', Controller) as Array<{ name?: string }> | undefined
    if (!parameterTypes?.length || !parameterTypes.some((type) => type.name === 'GovernedJobFitService')) {
      reporter.fail('JobFitController constructor 未注入可反射的 GovernedJobFitService')
      return
    }
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { JwtService } = require('@nestjs/jwt') as { JwtService: new (options: unknown) => { sign(payload: unknown, options?: unknown): string } }
    const jwt = new JwtService({ secret: 'runtime-job-fit-controller-secret-at-least-32', signOptions: { audience: 'enduser' } })
    const memberToken = jwt.sign({ sub: 'runtime-member', jti: 'runtime-session' }, { audience: 'enduser' })
    const calls: unknown[][] = []
    const expected = { taskId: 'runtime-job-fit', status: 'completed', providerName: 'runtime' }
    const governed = { analyzeForJobFit: async (...args: unknown[]) => { calls.push(args); return expected } }
    const service = {
      analyze: async () => { throw new Error('JobFitController 不应绕过 governed 直调 JobFitService.analyze') },
      grantJobFitConsent: async () => undefined, getJobFitConsentStatus: async () => undefined, revokeJobFitConsent: async () => undefined,
    }
    const redis = { get: async (key: string) => key === 'member:session:runtime-session' ? 'runtime-member' : null }
    const dependencies = parameterTypes.map((type) => {
      if (type.name === 'GovernedJobFitService') return governed
      if (type.name === 'JobFitService') return service
      if (type.name === 'JwtService') return jwt
      if (type.name === 'RedisService') return redis
      return {}
    })
    const controller = new Controller(...dependencies)
    const dto = { taskId: 'runtime-job-fit', jobId: 'runtime-job' }
    const request = (headers: Record<string, string>) => controller.analyze(dto, { headers })
    const anonymous = await request({
      'x-resume-access-token': 'runtime-resume-token', 'x-terminal-id': 'runtime-terminal',
      'x-forwarded-for': '198.51.100.10, 198.51.100.11',
    })
    const member = await request({
      authorization: `Bearer ${memberToken}`, 'x-terminal-id': 'runtime-terminal',
      'x-forwarded-for': '198.51.100.10, 198.51.100.11',
    })
    const valid = (index: number, endUserId: string | null, accessToken: string | null): boolean => {
      const [input, requester, quota] = calls[index] ?? []
      const context = quota as { member?: unknown; terminal?: unknown; ip?: unknown } | undefined
      return input === dto
        && requester !== null && typeof requester === 'object'
        && (requester as { endUserId?: unknown }).endUserId === endUserId
        && (requester as { accessToken?: unknown }).accessToken === accessToken
        && context?.member === endUserId && context.terminal === 'runtime-terminal' && context.ip === '198.51.100.10'
    }
    if (anonymous !== expected || member !== expected || calls.length !== 2 || !valid(0, null, 'runtime-resume-token') || !valid(1, 'runtime-member', null)) {
      reporter.fail('JobFitController runtime spy 未保留匿名/会员 requester 与 member/terminal/XFF 首地址 quota context')
    } else {
      reporter.pass('JobFitController runtime spy 保留匿名/会员 requester 与同策略三维 quota context')
    }
  } catch (error) {
    reporter.fail(`JobFitController quota context 内存验证失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function checkGovernedBehavior(rootDir: string, governedRel: string, reporter: RuntimeReporter): Promise<void> {
  const governedAbs = join(rootDir, governedRel)
  if (!existsSync(governedAbs)) return
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require(governedAbs) as { GovernedJobFitService?: unknown }
    if (typeof loaded.GovernedJobFitService !== 'function') {
      reporter.fail('GovernedJobFitService 运行时导出缺失')
      return
    }
    const Constructor = loaded.GovernedJobFitService as GovernedConstructor
    const prototype = Constructor.prototype as Record<string, unknown>
    const missing = ['analyzeForJobFit', 'matchForMember'].filter((name) => typeof prototype[name] !== 'function')
    if (missing.length > 0) {
      reporter.fail(`GovernedJobFitService 运行时公开方法缺失: ${missing.join(' | ')}`)
      return
    }
    reporter.pass('GovernedJobFitService 可运行时加载并公开两个治理入口')

    const projection = harness(Constructor)
    await projection.service.analyzeForJobFit!.call(projection.service,
      { taskId: 'runtime-anonymous', manualJob: { title: '手填目标岗位', requirements: '不得写入会话的敏感原文' } },
      { endUserId: null, accessToken: 'runtime-token' }, { member: null, terminal: 'runtime-terminal', ip: '198.51.100.1' },
    )
    await projection.service.matchForMember!.call(projection.service, {
      jobId: 'runtime-system-job', resumeTaskId: 'runtime-member', requester: { endUserId: 'runtime-member', accessToken: null },
      terminalId: 'runtime-terminal', quotaContext: { member: 'runtime-member', terminal: 'runtime-terminal', ip: '198.51.100.2' },
    })
    const manual = projection.sessions.map((row) => intent(row.data)).find((value) => value?.title === '手填目标岗位')
    const system = projection.sessions.map((row) => intent(row.data)).find((value) => value?.jobId === 'runtime-system-job')
    if (!manual || Object.keys(manual).length !== 1 || manual.requirements !== undefined || !system || Object.keys(system).length !== 1) {
      reporter.fail('内存 harness：manual/system session intent 必须分别且只能存 title/jobId')
    } else {
      reporter.pass('内存 harness：manual/system session intent 均为最小投影')
    }
    const successLog = projection.logs.find((entry) => entry.operation === 'jobMatch' && entry.status === 'success')
    if (!successLog || successLog.provider !== 'llm:stub:model' || !sameTokenUsage(successLog.tokenUsage, projection.tokenUsage)) {
      reporter.fail('内存 harness：成功路径必须记录 jobMatch、真实 provider 与等值 tokenUsage')
    } else {
      reporter.pass('内存 harness：成功路径将真实 provider 与等值 tokenUsage 写入 AiLog')
    }

    for (const anonymousConsent of ['revoked', 'legacy'] as const) {
      const rejected = harness(Constructor, { anonymousConsent })
      const didReject = await rejects(() => rejected.service.analyzeForJobFit!.call(rejected.service,
        { taskId: `runtime-${anonymousConsent}`, manualJob: { title: `${anonymousConsent} 授权岗位` } },
        { endUserId: null, accessToken: 'runtime-token' }, { member: null, terminal: 'runtime-terminal', ip: '198.51.100.20' },
      ))
      if (!didReject || rejected.anonymousConsentChecks !== 1 || rejected.sessions.length || rejected.quotaAttempts || rejected.analyzeCalls) {
        reporter.fail(`内存 harness：${anonymousConsent} 匿名 consent 必须在 session/quota/LLM 前拒绝`)
      } else {
        reporter.pass(`内存 harness：${anonymousConsent} 匿名 consent 在副作用前拒绝`)
      }
    }

    const anonymousMember = harness(Constructor)
    const anonymousMemberRejected = await rejects(() => anonymousMember.service.matchForMember!.call(anonymousMember.service, {
      jobId: 'runtime-system-job', resumeTaskId: 'runtime-anonymous-member-match', requester: { endUserId: null, accessToken: 'runtime-token' },
      terminalId: 'runtime-terminal', quotaContext: { member: null, terminal: 'runtime-terminal', ip: '198.51.100.21' },
    }))
    if (!anonymousMemberRejected || anonymousMember.sessions.length || anonymousMember.quotaAttempts || anonymousMember.analyzeCalls) {
      reporter.fail('内存 harness：matchForMember 收到匿名 requester 必须在 session/quota/LLM 前拒绝')
    } else {
      reporter.pass('内存 harness：matchForMember 拒绝匿名 requester，未产生副作用')
    }

    const quotaFailure = harness(Constructor, { quotaFails: true })
    const quotaRejected = await rejects(() => quotaFailure.service.analyzeForJobFit!.call(quotaFailure.service,
      { taskId: 'runtime-quota', manualJob: { title: '配额失败岗位' } },
      { endUserId: null, accessToken: 'runtime-token' }, { member: null, terminal: 'runtime-terminal', ip: '198.51.100.3' },
    ))
    if (!quotaRejected || quotaFailure.quotaAttempts !== 1 || quotaFailure.analyzeCalls !== 0 || !quotaFailure.updates.some((data) => data.status === 'failed')) {
      reporter.fail('内存 harness：配额失败不得调用 LLM，且已创建的会话必须收敛为 failed')
    } else {
      reporter.pass('内存 harness：配额失败不触发 LLM，session 收敛为 failed')
    }

    const jobFitFailure = harness(Constructor, { jobFitFails: true })
    let jobFitResponse: unknown
    const jobFitRejected = await rejects(async () => {
      jobFitResponse = await jobFitFailure.service.analyzeForJobFit!.call(jobFitFailure.service,
        { taskId: 'runtime-job-fit-failed', manualJob: { title: '受控失败岗位' } },
        { endUserId: null, accessToken: 'runtime-token' }, { member: null, terminal: 'runtime-terminal', ip: '198.51.100.31' },
      )
    })
    const response = jobFitResponse !== null && typeof jobFitResponse === 'object'
      ? jobFitResponse as { status?: unknown; failReason?: unknown }
      : {}
    const failedSession = jobFitFailure.updates.some((data) => data.status === 'failed')
    const failedScenarioSuccessLog = jobFitFailure.logs.some((entry) => entry.operation === 'jobMatch' && entry.status === 'success')
    const failedLog = jobFitFailure.logs.some((entry) => entry.operation === 'jobMatch' && entry.status === 'failed')
    if (
      jobFitRejected
      || response.status !== 'failed'
      || typeof response.failReason !== 'string'
      || jobFitFailure.analyzeCalls !== 1
      || jobFitFailure.quotaAttempts !== 1
      || !failedSession
      || jobFitFailure.quotaRollbacks < 1
      || failedScenarioSuccessLog
      || !failedLog
    ) {
      reporter.fail('内存 harness：JobFit failed 响应必须先消费配额并实际分析一次，原样返回、失败会话/日志且回滚 quota，不能记成功')
    } else {
      reporter.pass('内存 harness：JobFit failed 响应保留 raw 语义，session/log failed 且 quota 已回滚')
    }

    const llmFailure = harness(Constructor, { llmFails: true })
    const llmRejected = await rejects(() => llmFailure.service.analyzeForJobFit!.call(llmFailure.service,
      { taskId: 'runtime-llm', manualJob: { title: '模型失败岗位' } },
      { endUserId: null, accessToken: 'runtime-token' }, { member: null, terminal: 'runtime-terminal', ip: '198.51.100.4' },
    ))
    if (!llmRejected || llmFailure.analyzeCalls !== 1 || llmFailure.quotaRollbacks < 1 || !llmFailure.updates.some((data) => data.status === 'failed')) {
      reporter.fail('内存 harness：LLM 失败必须回滚已消费配额并将会话收敛为 failed')
    } else {
      reporter.pass('内存 harness：LLM 失败回滚配额，session 收敛为 failed')
    }
  } catch (error) {
    reporter.fail(`GovernedJobFitService 内存验证失败: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function runGovernedJobFitRuntimeChecks(options: RuntimeCheckOptions): Promise<void> {
  await checkJobFitConsent(options.rootDir, options.reporter)
  await checkControllerQuota(options.rootDir, options.governedRel, options.reporter)
  await checkGovernedBehavior(options.rootDir, options.governedRel, options.reporter)
}
