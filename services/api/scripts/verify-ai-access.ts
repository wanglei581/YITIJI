/**
 * verify:ai-access — C6 声明拦截、C7 登录档位、C14 AI 暂停与全机维护（运行时门禁）
 *
 * 不搜源码字符串，全部真调：
 *   1. 服务层矩阵：四个开关 × 各类 AI 接口 × 匿名/会员 × 有无声明，逐格断言放行或错误码；
 *   2. Redis 故障：配置读不到时回落到环境变量（即今天的行为），不拒绝请求；
 *   3. 守卫 + 真实控制器方法：没有标记的路由零配置读取；维护模式只拦新下单与 AI，
 *      打印代理、支付回调、取件放行、订单查询与取消、删除本人数据一律放行；
 *   4. 覆盖：AI 控制器的每一个接口都必须有 @AiUse 或显式 @AiUseExempt('原因')；
 *      「绝不拦」的控制器上不许出现任何拦截标记；
 *   5. 后台切换：缺事由 400；必须先写成审计才改 Redis，审计写不进去就不改；改完清缓存。
 *
 * 不触网、不连 Redis（桩），不写库（桩）。
 * 运行：pnpm --filter @ai-job-print/api verify:ai-access
 */
import 'reflect-metadata'
import { RequestMethod } from '@nestjs/common'
import { METHOD_METADATA, MODULE_METADATA } from '@nestjs/common/constants'
import { APP_GUARD, NestFactory, Reflector } from '@nestjs/core'
import { AiAccessModule } from '../src/ai-access/ai-access.module'
import { JwtService } from '@nestjs/jwt'
import { AiAccessGuard } from '../src/ai-access/ai-access.guard'
import { AiAccessService, type AiAccessConfig } from '../src/ai-access/ai-access.service'
import { AdminAiAccessController } from '../src/ai-access/admin-ai-access.controller'
import {
  AI_USE_EXEMPT_METADATA,
  AI_USE_METADATA,
  MAINTENANCE_BLOCKED_METADATA,
  type AiUseKind,
} from '../src/ai-access/ai-access.decorator'
import { ROLES_KEY } from '../src/common/decorators/roles.decorator'
import { memberSessionKey } from '../src/common/guards/end-user-auth.guard'
import { AdvisorController } from '../src/advisor/advisor.controller'
import { AiController } from '../src/ai/ai.controller'
import { CareerPlanController } from '../src/ai/career-plan.controller'
import { FairVisitPlanController } from '../src/ai/fair-visit-plan.controller'
import { JobFitController } from '../src/ai/job-fit.controller'
import { KioskAiCapabilitiesController } from '../src/ai/kiosk-ai-capabilities.controller'
import { ResumeReportExportController } from '../src/ai/resume-report-export.controller'
import { SelfAssessmentController } from '../src/ai/self-assessment.controller'
import { DailyBriefController } from '../src/assistant/daily-brief.controller'
import { ContractReviewController } from '../src/contract-review/contract-review.controller'
import { JobAiController, MemberJobAiSessionsController } from '../src/job-ai/job-ai.controller'
import { JobMaterialsController } from '../src/job-materials/job-materials.controller'
import { MaterialsController } from '../src/materials/materials.controller'
import { MemberMockInterviewController, MockInterviewController } from '../src/mock-interview/mock-interview.controller'
import { TrtcController } from '../src/trtc/trtc.controller'
import { HealthController } from '../src/common/health.controller'
import { KioskSessionController } from '../src/kiosk-session/kiosk-session.controller'
import { LegalController } from '../src/legal/legal.controller'
import { MemberAuthController } from '../src/member-auth/member-auth.controller'
import { MemberPrintOrdersController } from '../src/member-print-orders/member-print-orders.controller'
import { PackageOrdersController } from '../src/member-print-orders/package-orders.controller'
import { OrderQuoteController } from '../src/payment/order-quote.controller'
import { PaymentController } from '../src/payment/payment.controller'
import { PrintConversionController } from '../src/print-conversion/print-conversion.controller'
import { PrintJobsController } from '../src/print-jobs/print-jobs.controller'
import { ScanTasksController } from '../src/scan-tasks/scan-tasks.controller'
import { SyncController } from '../src/sync/sync.controller'
import { TerminalsController } from '../src/terminals/terminals.controller'
import { UploadSessionsController } from '../src/upload-sessions/upload-sessions.controller'

let failed = 0
function pass(id: string) { console.log(`  PASS ${id}`) }
function fail(id: string, detail: string) { failed += 1; console.error(`  FAIL ${id} —— ${detail}`) }
function check(id: string, ok: boolean, detail = '') { if (ok) pass(id); else fail(id, detail) }

type Ctor = { name: string; prototype: Record<string, unknown> }
const reflector = new Reflector()

function routesOf(ctor: Ctor): string[] {
  return Object.getOwnPropertyNames(ctor.prototype).filter((name) => {
    const fn = ctor.prototype[name]
    return name !== 'constructor' && typeof fn === 'function' && Reflect.getMetadata(METHOD_METADATA, fn) !== undefined
  })
}
const methodMeta = (ctor: Ctor, method: string, key: string) => Reflect.getMetadata(key, ctor.prototype[method] as object)
const classMeta = (ctor: Ctor, key: string) => Reflect.getMetadata(key, ctor)

// ── 桩：会员令牌 / Redis / Prisma / 审计 ────────────────────────────────────────
const jwt = new JwtService({ secret: 'verify-ai-access-secret-0123456789' })
const MEMBER_TOKEN = `Bearer ${jwt.sign({ sub: 'member-1', jti: 'session-1' }, { audience: 'enduser', expiresIn: '10m' })}`

function makeRedis(opts: { failing?: boolean; values?: Record<string, string> } = {}) {
  const writes: Array<[string, string]> = []
  const values = { ...(opts.values ?? {}) }
  const redis = new Proxy({}, {
    get(_target, prop: string) {
      if (prop === 'writes') return writes
      if (prop === 'get') return async (key: string) => {
        if (opts.failing) throw new Error('redis down')
        if (key === memberSessionKey('session-1')) return 'member-1'
        return values[key] ?? null
      }
      if (prop === 'setEx') return async (key: string, _ttl: number, value: string) => { writes.push([key, value]); values[key] = value }
      return async () => null
    },
  })
  return redis as unknown as { writes: Array<[string, string]> }
}

function makePrisma(consents: string[] = []) {
  return {
    endUser: { findUnique: async () => ({ enabled: true, status: 'active' }) },
    userAiConsent: { findFirst: async (args: { where: { scope: string } }) => (consents.includes(args.where.scope) ? { id: 'c' } : null) },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({}),
  }
}

function makeService(opts: { redisFailing?: boolean; consents?: string[]; audit?: unknown; redisValues?: Record<string, string> } = {}) {
  const redis = makeRedis({ failing: opts.redisFailing, values: opts.redisValues })
  const audit = opts.audit ?? { writeRequired: async () => 'audit-1' }
  const service = new AiAccessService(redis as never, audit as never, jwt, makePrisma(opts.consents) as never)
  return { service, redis }
}

async function codeOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run()
    return 'PASS'
  } catch (error) {
    const body = (error as { getResponse?: () => { error?: { code?: string; missing?: string[] } } }).getResponse?.()
    const code = body?.error?.code ?? (error as Error).message
    return body?.error?.missing ? `${code}:${body.error.missing.join('+')}` : code
  }
}

const OFF: AiAccessConfig = { loginGate: 'off', declarationEnforced: false, paused: false, maintenance: false }
const ANON = { headers: {} }
const MEMBER = { headers: { authorization: MEMBER_TOKEN } }
const AGE = { 'x-age-14-plus': 'declared', 'x-age-14-plus-version': 'v1' }
const VOICE = { 'x-voice-recording': 'granted', 'x-voice-recording-version': 'v1' }

async function serviceMatrix(): Promise<void> {
  const { service } = makeService()
  const run = (kind: AiUseKind | undefined, blocked: boolean, req: object, config: AiAccessConfig) =>
    codeOf(() => service.enforce(kind, blocked, req as never, config))
  const grid: Array<[string, AiUseKind | undefined, boolean, object, AiAccessConfig, string]> = [
    ['默认全关：匿名生成放行', 'generate', false, ANON, OFF, 'PASS'],
    ['默认全关：匿名语音放行', 'voice', false, ANON, OFF, 'PASS'],
    ['默认全关：新下单放行', undefined, true, ANON, OFF, 'PASS'],
    ['暂停：生成被拦', 'generate', false, ANON, { ...OFF, paused: true }, 'AI_PAUSED'],
    ['暂停：只读放行', 'read', false, ANON, { ...OFF, paused: true }, 'PASS'],
    ['暂停：打印下单照常', undefined, true, ANON, { ...OFF, paused: true }, 'PASS'],
    ['维护：新下单被拦', undefined, true, ANON, { ...OFF, maintenance: true }, 'MAINTENANCE_MODE'],
    ['维护：生成被拦', 'generate', false, MEMBER, { ...OFF, maintenance: true }, 'MAINTENANCE_MODE'],
    ['维护：只读放行', 'read', false, ANON, { ...OFF, maintenance: true }, 'PASS'],
    ['开始 AI 前登录：匿名生成被拦', 'generate', false, ANON, { ...OFF, loginGate: 'before_generate' }, 'AI_LOGIN_REQUIRED'],
    ['开始 AI 前登录：匿名语音被拦', 'voice', false, ANON, { ...OFF, loginGate: 'before_generate' }, 'AI_LOGIN_REQUIRED'],
    ['开始 AI 前登录：匿名导出也被拦（更严的一档覆盖导出）', 'export', false, ANON, { ...OFF, loginGate: 'before_generate' }, 'AI_LOGIN_REQUIRED'],
    ['开始 AI 前登录：会员生成放行', 'generate', false, MEMBER, { ...OFF, loginGate: 'before_generate' }, 'PASS'],
    ['导出前登录：匿名导出被拦', 'export', false, ANON, { ...OFF, loginGate: 'before_export' }, 'AI_LOGIN_REQUIRED'],
    ['导出前登录：匿名生成放行', 'generate', false, ANON, { ...OFF, loginGate: 'before_export' }, 'PASS'],
    ['导出前登录：会员导出放行', 'export', false, MEMBER, { ...OFF, loginGate: 'before_export' }, 'PASS'],
    ['声明：匿名无声明生成被拦', 'generate', false, ANON, { ...OFF, declarationEnforced: true }, 'AI_DECLARATION_REQUIRED:age_14_plus'],
    ['声明：匿名带年龄声明生成放行', 'generate', false, { headers: AGE }, { ...OFF, declarationEnforced: true }, 'PASS'],
    ['声明：语音只带年龄声明被拦', 'voice', false, { headers: AGE }, { ...OFF, declarationEnforced: true }, 'AI_DECLARATION_REQUIRED:voice_recording'],
    ['声明：语音两项声明都带放行', 'voice', false, { headers: { ...AGE, ...VOICE } }, { ...OFF, declarationEnforced: true }, 'PASS'],
    ['声明：导出不要求声明', 'export', false, ANON, { ...OFF, declarationEnforced: true }, 'PASS'],
  ]
  for (const [id, kind, blocked, req, config, expected] of grid) {
    const got = await run(kind, blocked, req, config)
    check(`matrix:${id}`, got === expected, `期望 ${expected}，实际 ${got}`)
  }
  const consented = makeService({ consents: ['age_14_plus', 'voice_recording'] }).service
  check('matrix:声明：会员已有同意记录、不带请求头也放行',
    (await codeOf(() => consented.enforce('voice', false, MEMBER as never, { ...OFF, declarationEnforced: true }))) === 'PASS')
  check('matrix:声明：会员没有同意记录、不带请求头被拦',
    (await codeOf(() => service.enforce('generate', false, MEMBER as never, { ...OFF, declarationEnforced: true }))) === 'AI_DECLARATION_REQUIRED:age_14_plus')
}

async function redisFailure(): Promise<void> {
  const saved = process.env['AI_PAUSED']
  try {
    delete process.env['AI_PAUSED']
    const { service } = makeService({ redisFailing: true })
    check('redis:故障时回落到环境默认（全关），生成照常', (await codeOf(() => service.enforce('generate', false, ANON as never))) === 'PASS')
    process.env['AI_PAUSED'] = 'on'
    const paused = makeService({ redisFailing: true }).service
    check('redis:故障时仍按环境变量生效（AI_PAUSED=on）', (await codeOf(() => paused.enforce('generate', false, ANON as never))) === 'AI_PAUSED')
    const override = makeService({ redisValues: { 'system:ai-access:paused': 'off' } }).service
    check('redis:后台切换值优先于环境变量', (await codeOf(() => override.enforce('generate', false, ANON as never))) === 'PASS')
    const savedGate = process.env['AI_LOGIN_GATE']
    process.env['AI_LOGIN_GATE'] = 'before_generate'
    delete process.env['AI_PAUSED']
    const gateOff = makeService({ redisValues: { 'system:ai-access:loginGate': 'off' } }).service
    check('redis:环境设了登录档位、后台切成 off 也要生效', (await codeOf(() => gateOff.enforce('generate', false, ANON as never))) === 'PASS')
    if (savedGate === undefined) delete process.env['AI_LOGIN_GATE']; else process.env['AI_LOGIN_GATE'] = savedGate
  } finally {
    if (saved === undefined) delete process.env['AI_PAUSED']; else process.env['AI_PAUSED'] = saved
  }
}

function contextFor(ctor: Ctor, method: string, req: object) {
  return {
    getHandler: () => ctor.prototype[method],
    getClass: () => ctor,
    switchToHttp: () => ({ getRequest: () => req }),
  } as never
}

async function guardOnRealRoutes(): Promise<void> {
  let reads = 0
  let config: AiAccessConfig = OFF
  const { service } = makeService()
  ;(service as unknown as { getConfig: () => Promise<AiAccessConfig> }).getConfig = async () => { reads += 1; return config }
  const guard = new AiAccessGuard(reflector, service)
  const through = (ctor: Ctor, method: string, req: object = ANON) => codeOf(() => guard.canActivate(contextFor(ctor, method, req)))

  reads = 0
  await through(PaymentController as unknown as Ctor, 'callback')
  await through(TerminalsController as unknown as Ctor, 'heartbeat')
  check('guard:无标记路由零配置读取（支付回调、终端心跳）', reads === 0, `读取了 ${reads} 次`)

  config = { ...OFF, maintenance: true }
  const blocked: Array<[Ctor, string]> = [
    [PrintJobsController as unknown as Ctor, 'create'],
    [MemberPrintOrdersController as unknown as Ctor, 'create'],
    [ScanTasksController as unknown as Ctor, 'create'],
    [AiController as unknown as Ctor, 'chatWithAssistant'],
    [AdvisorController as unknown as Ctor, 'run'],
  ]
  for (const [ctor, method] of blocked) {
    check(`guard:维护模式拦 ${ctor.name}.${method}`, (await through(ctor, method)) === 'MAINTENANCE_MODE')
  }
  const allowed: Array<[Ctor, string]> = [
    [PrintJobsController as unknown as Ctor, 'releasePickup'],
    [PrintJobsController as unknown as Ctor, 'getStatus'],
    [MemberPrintOrdersController as unknown as Ctor, 'cancel'],
    [MemberPrintOrdersController as unknown as Ctor, 'list'],
    [TerminalsController as unknown as Ctor, 'claimTasks'],
    [TerminalsController as unknown as Ctor, 'getTerminalConfig'],
    [PaymentController as unknown as Ctor, 'callback'],
    [PaymentController as unknown as Ctor, 'wechatRefundNotify'],
    [SyncController as unknown as Ctor, 'webhook'],
    [MemberMockInterviewController as unknown as Ctor, 'remove'],
    [MemberJobAiSessionsController as unknown as Ctor, 'remove'],
    [ContractReviewController as unknown as Ctor, 'remove'],
    [KioskAiCapabilitiesController as unknown as Ctor, routesOf(KioskAiCapabilitiesController as unknown as Ctor)[0]!],
  ]
  for (const [ctor, method] of allowed) {
    check(`guard:维护模式放行 ${ctor.name}.${method}`, (await through(ctor, method)) === 'PASS')
  }
  config = { ...OFF, paused: true }
  check('guard:AI 暂停拦顾问生成（run）', (await through(AdvisorController as unknown as Ctor, 'run')) === 'AI_PAUSED')
  check('guard:AI 暂停拦岗位 AI 解读（explain）', (await through(JobAiController as unknown as Ctor, 'explain')) === 'AI_PAUSED')
  check('guard:AI 暂停不拦打印下单', (await through(PrintJobsController as unknown as Ctor, 'create')) === 'PASS')
  check('guard:AI 暂停不拦删除本人面试记录', (await through(MemberMockInterviewController as unknown as Ctor, 'remove')) === 'PASS')
}

function coverage(): void {
  const aiControllers: Ctor[] = [
    AiController, CareerPlanController, FairVisitPlanController, JobFitController, SelfAssessmentController,
    ResumeReportExportController, KioskAiCapabilitiesController, AdvisorController, MockInterviewController,
    MemberMockInterviewController, ContractReviewController, JobAiController, MemberJobAiSessionsController,
    MaterialsController, DailyBriefController, TrtcController, JobMaterialsController,
  ] as unknown as Ctor[]
  // 挂了 admin / partner 角色的方法是后台接口（统计、日志、配置），不属于用户侧 AI 使用，不在覆盖范围内。
  const backOffice = (ctor: Ctor, method: string) => {
    const roles = (methodMeta(ctor, method, ROLES_KEY) ?? classMeta(ctor, ROLES_KEY) ?? []) as string[]
    return roles.includes('admin') || roles.includes('partner')
  }
  for (const ctor of aiControllers) {
    const missing = routesOf(ctor).filter((method) => !backOffice(ctor, method) &&
      methodMeta(ctor, method, AI_USE_METADATA) === undefined && methodMeta(ctor, method, AI_USE_EXEMPT_METADATA) === undefined)
    check(`coverage:${ctor.name} 每个接口都有 @AiUse 或显式豁免`, missing.length === 0, `缺：${missing.join('、')}`)
  }
  const neverBlocked: Ctor[] = [
    TerminalsController, PaymentController, SyncController, KioskSessionController, HealthController,
    MemberAuthController, LegalController, OrderQuoteController,
  ] as unknown as Ctor[]
  for (const ctor of neverBlocked) {
    const marked = routesOf(ctor).filter((method) =>
      methodMeta(ctor, method, AI_USE_METADATA) !== undefined || methodMeta(ctor, method, MAINTENANCE_BLOCKED_METADATA) !== undefined)
    const classMarked = classMeta(ctor, AI_USE_METADATA) !== undefined || classMeta(ctor, MAINTENANCE_BLOCKED_METADATA) !== undefined
    check(`coverage:${ctor.name} 不许有任何拦截标记`, marked.length === 0 && !classMarked, `被标记：${marked.join('、')}${classMarked ? '（类级）' : ''}`)
  }
  const onlyCreate: Array<[Ctor, string[]]> = [
    [PrintJobsController as unknown as Ctor, ['create']],
    [MemberPrintOrdersController as unknown as Ctor, ['create']],
    [PackageOrdersController as unknown as Ctor, ['create']],
    [ScanTasksController as unknown as Ctor, ['create']],
    [UploadSessionsController as unknown as Ctor, ['create']],
    [PrintConversionController as unknown as Ctor, ['imagesToPdf']],
  ]
  for (const [ctor, expected] of onlyCreate) {
    const marked = routesOf(ctor).filter((method) => methodMeta(ctor, method, MAINTENANCE_BLOCKED_METADATA) === true).sort()
    check(`coverage:${ctor.name} 只有新建入口受维护拦截`, JSON.stringify(marked) === JSON.stringify([...expected].sort())
      && classMeta(ctor, MAINTENANCE_BLOCKED_METADATA) === undefined, `实际：${marked.join('、') || '无'}`)
  }
  // AI 控制器里所有 DELETE（撤回、删除本人数据）都必须显式豁免：暂停、维护、登录档位、声明都不能挡用户删自己的东西
  for (const ctor of aiControllers) {
    const blockedDeletes = routesOf(ctor).filter((method) =>
      methodMeta(ctor, method, METHOD_METADATA) === RequestMethod.DELETE && typeof methodMeta(ctor, method, AI_USE_EXEMPT_METADATA) !== 'string')
    check(`coverage:${ctor.name} 的删除 / 撤回接口全部显式豁免`, blockedDeletes.length === 0, `未豁免：${blockedDeletes.join('、')}`)
  }
  check('coverage:结束语音会话（止损）显式豁免', typeof methodMeta(TrtcController as unknown as Ctor, 'stopSession', AI_USE_EXEMPT_METADATA) === 'string')
  const providers = (Reflect.getMetadata(MODULE_METADATA.PROVIDERS, AiAccessModule) ?? []) as Array<{ provide?: unknown; useClass?: unknown; useExisting?: unknown }>
  check('wiring:AiAccessGuard 注册为全局守卫（APP_GUARD）', providers.some((p) => p && p.provide === APP_GUARD && (p.useClass === AiAccessGuard || p.useExisting === AiAccessGuard)),
    '没有 APP_GUARD 时守卫只是一个没人调用的类，整套拦截在线上都不生效')
  const exemptDeletes: Array<[Ctor, string]> = [
    [MemberMockInterviewController as unknown as Ctor, 'remove'],
    [MemberJobAiSessionsController as unknown as Ctor, 'remove'],
    [ContractReviewController as unknown as Ctor, 'remove'],
    [ContractReviewController as unknown as Ctor, 'abandonReport'],
  ]
  for (const [ctor, method] of exemptDeletes) {
    check(`coverage:${ctor.name}.${method}（删除本人数据）显式豁免`,
      typeof methodMeta(ctor, method, AI_USE_EXEMPT_METADATA) === 'string' && methodMeta(ctor, method, AI_USE_METADATA) === undefined)
  }
}

/** 经真实全局错误过滤器：缺了哪几项声明要真的出现在响应体里（details），客户端才能只补问缺的那几项。 */
async function declarationSurvivesFilter(): Promise<void> {
  const { HttpExceptionFilter } = await import('../src/common/filters/http-exception.filter')
  const { service } = makeService()
  let thrown: unknown = null
  try {
    await service.enforce('voice', false, ANON as never, { ...OFF, declarationEnforced: true })
  } catch (error) {
    thrown = error
  }
  let status = 0
  let body: { error?: { code?: string; details?: unknown } } = {}
  const response = { status: (s: number) => { status = s; return response }, json: (b: typeof body) => { body = b } }
  const host = { switchToHttp: () => ({ getResponse: () => response, getRequest: () => ({ headers: {}, method: 'POST', url: '/ai/voice' }) }) }
  new HttpExceptionFilter().catch(thrown, host as never)
  check('filter:声明缺失经全局过滤器后仍带出缺哪几项（details）',
    status === 403 && body.error?.code === 'AI_DECLARATION_REQUIRED'
      && JSON.stringify(body.error?.details) === JSON.stringify(['age_14_plus', 'voice_recording']),
    JSON.stringify({ status, body }))
}

async function adminSwitch(): Promise<void> {
  const roles = Reflect.getMetadata(ROLES_KEY, AdminAiAccessController) as string[] | undefined
  check('admin:切换接口只许 admin', JSON.stringify(roles) === JSON.stringify(['admin']), JSON.stringify(roles))
  const { service } = makeService()
  check('admin:缺事由 400 REASON_REQUIRED', (await codeOf(() => service.update({ paused: true }, 'admin-1', '  '))) === 'REASON_REQUIRED')

  const failingAudit = { writeRequired: async () => { throw new Error('audit down') } }
  const broken = makeService({ audit: failingAudit })
  const code = await codeOf(() => broken.service.update({ paused: true }, 'admin-1', '演练'))
  check('admin:审计写不进去时不改 Redis', code !== 'PASS' && broken.redis.writes.length === 0, `结果 ${code}，Redis 写了 ${broken.redis.writes.length} 次`)

  const calls: Array<{ actorId: string | null; action: string }> = []
  const okAudit = { writeRequired: async (_tx: unknown, args: { actorId: string | null; action: string }) => { calls.push(args); return 'a' } }
  const ok = makeService({ audit: okAudit })
  const before = await ok.service.getConfig()
  const after = await ok.service.update({ paused: true }, 'admin-1', '演练暂停')
  check('admin:先写审计（操作人是管理员账号）再改 Redis',
    calls.length === 1 && calls[0]?.actorId === 'admin-1' && calls[0]?.action === 'ai.access_switch_changed' && ok.redis.writes.some(([key, value]) => key === 'system:ai-access:paused' && value === 'on'))
  check('admin:改完清缓存，立即读到新值', before.paused === false && after.paused === true)
}

/** 真起完整 AppModule 发 HTTP：证明线上装配里守卫确实在拦（手动 new 守卫的测试测不出「没注册」）。 */
async function realApp(): Promise<void> {
  const saved = process.env['MAINTENANCE_MODE']
  process.env['MAINTENANCE_MODE'] = 'on'
  const { AppModule } = await import('../src/app.module')
  const app = await NestFactory.create(AppModule, { logger: false })
  app.setGlobalPrefix('api/v1')
  try {
    await app.listen(0)
    const base = `${(await app.getUrl()).replace('[::1]', '127.0.0.1')}/api/v1`
    const post = (path: string, body: unknown) => fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const codeOfResponse = async (res: Response) => ((await res.json().catch(() => ({}))) as { error?: { code?: string } }).error?.code ?? ''
    const chat = await post('/assistant/chat', { message: '你好' })
    check('app:维护模式下小青对话被拦（503 MAINTENANCE_MODE）', chat.status === 503 && (await codeOfResponse(chat)) === 'MAINTENANCE_MODE', `实际 ${chat.status}`)
    const print = await post('/print/jobs', {})
    check('app:维护模式下打印下单被拦', print.status === 503 && (await codeOfResponse(print)) === 'MAINTENANCE_MODE', `实际 ${print.status}`)
    const callback = await post('/payment/callback/wechat', {})
    check('app:维护模式下支付回调不被维护拦截', (await codeOfResponse(callback)) !== 'MAINTENANCE_MODE', `实际 ${callback.status}`)
    const health = await fetch(`${base}/health`)
    check('app:维护模式下健康检查照常', health.status !== 503 || (await codeOfResponse(health)) !== 'MAINTENANCE_MODE', `实际 ${health.status}`)
  } finally {
    await app.close()
    if (saved === undefined) delete process.env['MAINTENANCE_MODE']; else process.env['MAINTENANCE_MODE'] = saved
  }
}

void (async () => {
  try {
    await serviceMatrix()
    await redisFailure()
    await guardOnRealRoutes()
    coverage()
    await adminSwitch()
    await declarationSurvivesFilter()
    await realApp()
  } catch (error) {
    fail('runtime', error instanceof Error ? error.stack ?? error.message : String(error))
  }
  console.log(failed === 0 ? '\nverify:ai-access：ALL PASS' : `\nverify:ai-access：${failed} FAIL`)
  process.exit(failed === 0 ? 0 : 1)
})()
