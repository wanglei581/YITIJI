/**
 * verify:ai-platform-degradation —— 生产缺 AI 配置时只降级 AI，不拖垮打印与支付（F-11 / 步骤 3.6a）
 *
 * 产品负责人 2026-09-29 批准的方案①：
 *   - 生产缺 OCR / AI_PROVIDER / 大模型密钥 / AIGC 生产方名称 → 不拒启动；
 *   - AI 路由 503 AI_PROVIDER_NOT_CONFIGURED，绝不回退 mock（AI_PROVIDER=mock 出现在生产也一样）；
 *   - /health 如实 degraded 且带结构化 impact；/health/ready 不因 AI 未开通变 503；
 *   - 非 AI 密钥照样拒启动（反向用例在 verify:production-runtime-gates）。
 *
 * 四段，全部实测：
 *   [A] 纯判定：evaluateAiPlatform / aiPlatformBlockFor / provider 选择 / 写标识处 fail-closed / OCR 选择器；
 *   [B] 启动接线：main.ts 把闸门返回值交给 registerAiPlatformDegradation，且在 NestFactory.create 之前；
 *       登记函数本身：降级打可搜索日志、不阻断 readiness；非生产什么都不登记；
 *   [C] 真起完整 AppModule 发 HTTP：开发态先做阳性对照（同一请求能拿到 mock 结果），
 *       再把进程切到生产口径的四种缺配置场景，逐个核对：AI 路由 503 + 错误码、没有 mock 回复、
 *       /health degraded + impact、/health/ready 200、一体机能力接口与顾问可用性如实报不可用；
 *   [D] impact 逐面实测：遍历 /health 运行时返回的 impact 键（不是写死清单），每个键必须有判据，
 *       unaffected 的面必须真的没被拦，unavailable 的面必须真的被拦。
 *
 * 为什么 [C] 不拉起 NODE_ENV=production 的子进程：生产闸门要求 PostgreSQL + COS + 腾讯短信 + 中文字体，
 * 本机与 CI 的 SQLite 库在生产口径下会被 PRODUCTION_SQLITE_FORBIDDEN 拒绝。所以先在开发口径装好应用，
 * 再在请求期把 NODE_ENV 切成 production —— AI 闸门、能力接口、isReady 都是请求期读环境，走的是真判定。
 * 「生产缺 AI 仍能过启动闸门」由 [A] 与 verify:production-runtime-gates 直接调用闸门函数证明。
 *
 * 不触网（百度 OCR 指向死端口）、不写库。
 * 运行：pnpm --filter @ai-job-print/api verify:ai-platform-degradation
 */
import 'reflect-metadata'
import 'dotenv/config'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { NestFactory } from '@nestjs/core'
import { ValidationPipe, type INestApplication } from '@nestjs/common'
import {
  AI_GENERATION_NOT_CONFIGURED_MESSAGE,
  aiPlatformBlockFor,
  evaluateAiPlatform,
  resolveAiProviderName,
  resolveOcrProviderName,
  type AiPlatformEnv,
  type AiPlatformUseKind,
} from '../src/config/ai-platform-config'
import {
  AI_PLATFORM_DEGRADED_CODE,
  aiPlatformImpact,
  registerAiPlatformDegradation,
} from '../src/common/boot/ai-platform-degradation'
import { AI_PLATFORM_SUBSYSTEM, BOOT_DEGRADED_LOG_MARKER, bootReadiness } from '../src/common/boot/boot-readiness'
import { AIGC_DEFAULT_PRODUCER, buildAigcLabelJson } from '../src/common/pdf/aigc-label'
import { OcrService } from '../src/ai/resume/ocr/ocr.service'
import { DisabledOcrProvider } from '../src/ai/resume/ocr/disabled-ocr.provider'
import { TencentOcrProvider } from '../src/ai/resume/ocr/tencent-ocr.provider.stub'
import { BaiduOcrProvider } from '../src/ai/resume/ocr/baidu-ocr.provider'
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter'
import { LlmConfigService } from '../src/ai/llm/llm-config.service'

let failures = 0
let checks = 0
function check(name: string, ok: boolean, detail = ''): void {
  checks += 1
  if (ok) { console.log(`  PASS ${name}`); return }
  failures += 1
  console.log(`  FAIL ${name}${detail ? ` —— ${detail}` : ''}`)
}

const NOT_CONFIGURED = 'AI_PROVIDER_NOT_CONFIGURED'
const AI_KEYS = [
  'NODE_ENV', 'AI_PROVIDER', 'AI_LLM_API_KEY', 'TRTC_LLM_API_KEY', 'OCR_PROVIDER',
  'BAIDU_OCR_API_KEY', 'BAIDU_OCR_SECRET_KEY', 'BAIDU_OCR_BASE_URL', 'AIGC_CONTENT_PRODUCER',
] as const
type AiKey = typeof AI_KEYS[number]

/** AI 全部开通的生产口径（只含 AI 类键；非 AI 键由 verify:production-runtime-gates 覆盖）。 */
const PROD_AI_OK: Record<AiKey, string | undefined> = {
  NODE_ENV: 'production',
  AI_PROVIDER: 'llm',
  AI_LLM_API_KEY: 'verify-llm-key',
  TRTC_LLM_API_KEY: undefined,
  OCR_PROVIDER: 'baidu',
  BAIDU_OCR_API_KEY: 'verify-baidu-api-key',
  BAIDU_OCR_SECRET_KEY: 'verify-baidu-secret-key',
  // 死端口：[D] 的 OCR 探测只看「有没有去识别」，绝不真的出网。
  BAIDU_OCR_BASE_URL: 'http://127.0.0.1:9',
  AIGC_CONTENT_PRODUCER: '示例信息技术有限公司',
}

interface Scenario {
  label: string
  env: Record<AiKey, string | undefined>
  expect: { generation: boolean; export: boolean; ocr: boolean; issues: string[] }
}

const SCENARIOS: Scenario[] = [
  {
    label: '删掉 AI_LLM_API_KEY',
    env: { ...PROD_AI_OK, AI_LLM_API_KEY: undefined },
    expect: { generation: false, export: true, ocr: true, issues: ['AI_LLM_API_KEY_MISSING'] },
  },
  {
    label: '删掉 OCR 配置',
    env: { ...PROD_AI_OK, OCR_PROVIDER: undefined },
    expect: { generation: true, export: true, ocr: false, issues: ['OCR_PROVIDER_NOT_BAIDU'] },
  },
  {
    label: '删掉 AIGC_CONTENT_PRODUCER',
    env: { ...PROD_AI_OK, AIGC_CONTENT_PRODUCER: undefined },
    expect: { generation: false, export: false, ocr: true, issues: ['AIGC_CONTENT_PRODUCER_MISSING'] },
  },
  {
    label: '生产里出现 AI_PROVIDER=mock（密钥都在）',
    env: { ...PROD_AI_OK, AI_PROVIDER: 'mock' },
    expect: { generation: false, export: true, ocr: true, issues: ['AI_PROVIDER_NOT_LLM'] },
  },
]

function withEnv<T>(env: Partial<Record<AiKey, string | undefined>>, run: () => T): T {
  const saved = Object.fromEntries(AI_KEYS.map((key) => [key, process.env[key]]))
  applyEnv(env)
  try {
    return run()
  } finally {
    applyEnv(saved)
  }
}

function applyEnv(env: Partial<Record<string, string | undefined>>): void {
  for (const key of AI_KEYS) {
    const value = env[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
}

function errorCodeOf(error: unknown): string {
  const body = (error as { getResponse?: () => { error?: { code?: string } } }).getResponse?.()
  return body?.error?.code ?? (error instanceof Error ? error.message : String(error))
}

// ── [A] 纯判定 ────────────────────────────────────────────────────────────────

async function pureDecisions(): Promise<void> {
  console.log('\n[A] 纯判定')

  const dev = evaluateAiPlatform({ NODE_ENV: 'development', AI_PROVIDER: 'mock' })
  check('非生产：不执行开通检查（CI 的 AI_PROVIDER=mock 行为不变）',
    !dev.enforced && dev.generationAvailable && dev.issues.length === 0)
  check('非生产：AI 路由闸门对 generate 一律放行', aiPlatformBlockFor('generate', dev) === null)

  const ok = evaluateAiPlatform(PROD_AI_OK as AiPlatformEnv)
  check('生产全部配置齐全：无降级', ok.enforced && ok.generationAvailable && ok.ocrConfigured && ok.issues.length === 0)

  for (const scenario of SCENARIOS) {
    const state = evaluateAiPlatform(scenario.env as AiPlatformEnv)
    const codes = state.issues.map((issue) => issue.code).sort().join(',')
    check(`${scenario.label}：问题码 = ${scenario.expect.issues.join(',')}`, codes === [...scenario.expect.issues].sort().join(','), codes)
    const matrix: Array<[AiPlatformUseKind, boolean]> = [
      ['generate', scenario.expect.generation],
      ['voice', scenario.expect.generation],
      ['export', scenario.expect.export],
      ['read', true],
    ]
    for (const [kind, allowed] of matrix) {
      const block = aiPlatformBlockFor(kind, state)
      check(`${scenario.label}：${kind} ${allowed ? '放行' : `拦成 ${NOT_CONFIGURED}`}`,
        allowed ? block === null : block?.code === NOT_CONFIGURED, JSON.stringify(block))
    }
  }

  // 任何 detail 都不得回显密钥或认不出的取值（有人把密钥误填进 AI_PROVIDER 时不能进日志与 /health）
  const leaky = evaluateAiPlatform({ ...PROD_AI_OK, AI_PROVIDER: 'sk-secret-typed-into-provider', OCR_PROVIDER: 'sk-ocr-secret' } as AiPlatformEnv)
  check('detail 不回显认不出的取值', !JSON.stringify(leaky.issues).includes('sk-'), JSON.stringify(leaky.issues))
  check('detail 不回显任何密钥', !JSON.stringify(evaluateAiPlatform(SCENARIOS[0]!.env as AiPlatformEnv)).includes('verify-baidu'))

  check('provider 选择：非生产原样读 AI_PROVIDER', resolveAiProviderName({ NODE_ENV: 'test', AI_PROVIDER: 'mock' }) === 'mock')
  check('provider 选择：非生产缺省 mock（今天的行为）', resolveAiProviderName({ NODE_ENV: 'development' }) === 'mock')
  check('provider 选择：生产里 AI_PROVIDER=mock 也不选 mock', resolveAiProviderName({ NODE_ENV: 'production', AI_PROVIDER: 'mock' }) === 'llm')
  check('provider 选择：生产里填错也不在依赖注入阶段抛错', resolveAiProviderName({ NODE_ENV: 'production', AI_PROVIDER: 'not-a-provider' }) === 'llm')
  check('OCR 选择：生产填错落到 disabled', resolveOcrProviderName({ NODE_ENV: 'production', OCR_PROVIDER: 'not-a-provider' }) === 'disabled')
  check('OCR 选择：生产大小写与空白按规范化', resolveOcrProviderName({ NODE_ENV: 'production', OCR_PROVIDER: ' Baidu ' }) === 'baidu')
  check('OCR 选择：非生产原样读（未知值仍由 OcrService 抛 OCR_PROVIDER_INVALID）',
    resolveOcrProviderName({ NODE_ENV: 'development', OCR_PROVIDER: 'Baidu' }) === 'Baidu')

  // OcrService 真构造：生产填错 OCR_PROVIDER 不再让整站起不来，且只会如实报「未配置」
  const ocrProviders = () => [new DisabledOcrProvider(), new TencentOcrProvider(), new BaiduOcrProvider()] as const
  const prodBadOcr = withEnv({ NODE_ENV: 'production', OCR_PROVIDER: 'not-a-provider' }, () => {
    try { return new OcrService(...ocrProviders()).activeProviderName } catch (error) { return `THROW:${errorCodeOf(error)}` }
  })
  check('OcrService：生产填错 OCR_PROVIDER 构造不抛、落到 disabled', prodBadOcr === 'disabled', prodBadOcr)
  const devBadOcr = withEnv({ NODE_ENV: 'development', OCR_PROVIDER: 'not-a-provider' }, () => {
    try { return new OcrService(...ocrProviders()).activeProviderName } catch (error) { return `THROW:${errorCodeOf(error)}` }
  })
  check('OcrService：非生产填错照旧抛 OCR_PROVIDER_INVALID', devBadOcr === 'THROW:OCR_PROVIDER_INVALID', devBadOcr)

  // 写 AI 文件的隐式标识：生产缺内容制作方 → 拒绝（最后一道防线），非生产照旧用产品名
  const prodAigc = withEnv({ NODE_ENV: 'production', AIGC_CONTENT_PRODUCER: undefined }, () => {
    try { return buildAigcLabelJson('verify-task') } catch (error) { return `THROW:${errorCodeOf(error)}` }
  })
  check(`写标识：生产缺 AIGC_CONTENT_PRODUCER 拒绝（${NOT_CONFIGURED}）`, prodAigc === `THROW:${NOT_CONFIGURED}`, prodAigc)
  const prodAigcProduct = withEnv({ NODE_ENV: 'production', AIGC_CONTENT_PRODUCER: AIGC_DEFAULT_PRODUCER }, () => {
    try { return buildAigcLabelJson('verify-task') } catch (error) { return `THROW:${errorCodeOf(error)}` }
  })
  check('写标识：生产填产品名同样拒绝', prodAigcProduct === `THROW:${NOT_CONFIGURED}`, prodAigcProduct)
  const prodAigcOk = withEnv({ NODE_ENV: 'production', AIGC_CONTENT_PRODUCER: '示例信息技术有限公司' }, () => buildAigcLabelJson('verify-task'))
  check('写标识：生产配好时照常写入', JSON.parse(prodAigcOk).ContentProducer === '示例信息技术有限公司')
  // LlmConfigService.isReady：顾问可用性、助手标签等都读它。用一份「已启用 + 有密钥」的功能位跑真方法体：
  // 开发口径必须 true（阳性对照：HTTP 段的测试库没配模型密钥，只看那里测不出这一条），生产缺 AI 必须 false。
  const readyCfg = { cache: { assistant_chat: { enabled: true, apiKeyEncrypted: 'verify-encrypted' } }, resolveFeature: () => 'assistant_chat' }
  const isReady = () => LlmConfigService.prototype.isReady.call(readyCfg as never, 'assistant_chat')
  check('isReady 阳性对照：开发口径下已启用且有密钥即就绪', withEnv({ NODE_ENV: 'development' }, isReady) === true)
  check('isReady：生产配置齐全时就绪', withEnv(PROD_AI_OK, isReady) === true)
  for (const scenario of SCENARIOS) {
    check(`isReady：${scenario.label}时${scenario.expect.generation ? '仍就绪' : '一律未就绪（可用性接口据此报不可用）'}`,
      withEnv(scenario.env, isReady) === scenario.expect.generation)
  }

  const devAigc = withEnv({ NODE_ENV: 'development', AIGC_CONTENT_PRODUCER: undefined }, () => buildAigcLabelJson('verify-task'))
  check('写标识：非生产未设置照旧回落产品名', JSON.parse(devAigc).ContentProducer === AIGC_DEFAULT_PRODUCER)
}

// ── [B] 启动接线 ──────────────────────────────────────────────────────────────

function bootWiring(): void {
  console.log('\n[B] 启动接线与登记')
  const mainSource = readFileSync(join(__dirname, '..', 'src', 'main.ts'), 'utf8')
  const wiring = mainSource.indexOf('registerAiPlatformDegradation(assertProductionRuntimeGates().aiPlatform)')
  const create = mainSource.indexOf('await NestFactory.create')
  check('main.ts 把启动闸门的 AI 状态交给 registerAiPlatformDegradation', wiring >= 0)
  check('登记发生在 NestFactory.create 之前', wiring >= 0 && create > wiring)

  const lines: string[] = []
  const log = { error: (line: string) => { lines.push(line) } }

  bootReadiness.reset()
  registerAiPlatformDegradation(evaluateAiPlatform({ NODE_ENV: 'development' }), log)
  check('非生产：不登记任何 AI 子系统、不打日志', bootReadiness.snapshot().length === 0 && lines.length === 0)

  registerAiPlatformDegradation(evaluateAiPlatform(PROD_AI_OK as AiPlatformEnv), log)
  const okState = bootReadiness.snapshot().find((s) => s.subsystem === AI_PLATFORM_SUBSYSTEM)
  check('生产配置齐全：登记为 ok', okState?.status === 'ok' && lines.length === 0)

  registerAiPlatformDegradation(evaluateAiPlatform(SCENARIOS[0]!.env as AiPlatformEnv), log)
  const degraded = bootReadiness.snapshot().find((s) => s.subsystem === AI_PLATFORM_SUBSYSTEM)
  check('生产缺大模型密钥：登记为 degraded + 结构化 impact',
    degraded?.status === 'degraded' && degraded.code === AI_PLATFORM_DEGRADED_CODE && degraded.impact?.['ai-generation'] === 'unavailable')
  check('降级不阻断 readiness', degraded?.blocksReadiness === false && bootReadiness.readinessBlocking().length === 0)
  check('启动日志有可搜索的降级标记且只含问题码',
    lines.length === 1 && lines[0]!.startsWith(BOOT_DEGRADED_LOG_MARKER) && lines[0]!.includes('AI_LLM_API_KEY_MISSING')
      && !lines[0]!.includes('verify-'), lines.join(' | '))
  bootReadiness.reset()
}

// ── [C][D] 真起 AppModule ─────────────────────────────────────────────────────

interface Probe { status: number; code: string; body: unknown }

async function request(base: string, method: string, path: string, body?: unknown): Promise<Probe> {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json = await res.json().catch(() => null) as { error?: { code?: string } } | null
  return { status: res.status, code: json?.error?.code ?? '', body: json }
}

/** 「被 AI 未开通拦下」的唯一判据：503 + AI_PROVIDER_NOT_CONFIGURED。其它 4xx 说明请求走到了后面的业务逻辑。 */
const blockedByAi = (p: Probe) => p.status === 503 && p.code === NOT_CONFIGURED
/** 「照常」：没有被 AI 闸门拦，也没有 5xx。 */
const workingNormally = (p: Probe) => !blockedByAi(p) && p.status < 500

/** /assistant/chat 直接返回对话体（不包 data）；两种形状都认，免得形状一变「没有回复」恒真。 */
function replyOf(p: Probe): string | undefined {
  const body = p.body as { reply?: string; data?: { reply?: string } } | null
  return body?.reply ?? body?.data?.reply
}

interface SurfaceProbe {
  describe: string
  run: (base: string) => Promise<{ succeeded: boolean; detail: string }>
}

/**
 * 每个可被声明的面如何证明。遍历的是 /health 运行时返回的 impact 键 ——
 * 新增一个面而这里没有判据，门禁直接失败（与 verify:redis-degradation-truth 同一写法）。
 */
const SURFACE_PROBES: Record<string, SurfaceProbe> = {
  'ai-generation': {
    describe: '小青文字对话 POST /assistant/chat',
    run: async (base) => {
      const p = await request(base, 'POST', '/assistant/chat', { message: '你好' })
      return { succeeded: workingNormally(p), detail: `→ ${p.status} ${p.code}` }
    },
  },
  'ai-file-export': {
    describe: '已有 AI 报告导出 POST /resume/records/:taskId/export（不存在的任务号：没被拦就会走到 4xx 业务错误）',
    run: async (base) => {
      const p = await request(base, 'POST', '/resume/records/verify-ai-platform-missing/export', { kind: 'diagnosis' })
      return { succeeded: workingNormally(p), detail: `→ ${p.status} ${p.code}` }
    },
  },
  'ocr-recognition': {
    describe: '按当前环境新构造的 OcrService 识别一张图（死端口，只看「有没有去识别」）',
    run: async () => {
      const ocr = new OcrService(new DisabledOcrProvider(), new TencentOcrProvider(), new BaiduOcrProvider())
      const result = await ocr.recognize({ buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]), mimeType: 'image/png' })
      return { succeeded: result.errorCode !== 'OCR_NOT_CONFIGURED', detail: `provider=${ocr.activeProviderName} → ${result.ok ? 'ok' : result.errorCode}` }
    },
  },
  'print-scan': {
    describe: '打印下单 POST /print/jobs 与打印前材料检查 POST /materials/tasks（@AiUseExempt）',
    run: async (base) => {
      const print = await request(base, 'POST', '/print/jobs', {})
      const materials = await request(base, 'POST', '/materials/tasks', {})
      return {
        succeeded: workingNormally(print) && workingNormally(materials),
        detail: `print → ${print.status} ${print.code}；materials → ${materials.status} ${materials.code}`,
      }
    },
  },
  payment: {
    describe: '支付回调 POST /payment/callback/wechat',
    run: async (base) => {
      const p = await request(base, 'POST', '/payment/callback/wechat', {})
      return { succeeded: workingNormally(p), detail: `→ ${p.status} ${p.code}` }
    },
  },
  'internal-console': {
    describe: '内部账号接口 GET /auth/me（未带令牌：走到 JwtAuthGuard 的 401，说明全局 AI 闸门已放行）',
    run: async (base) => {
      const p = await request(base, 'GET', '/auth/me')
      return { succeeded: workingNormally(p) && p.status === 401, detail: `→ ${p.status} ${p.code}` }
    },
  },
}

interface HealthState { subsystem?: string; status?: string; code?: string; message?: string; impact?: Record<string, string>; blocksReadiness?: boolean }

async function realApp(): Promise<void> {
  console.log('\n[C] 真起 AppModule：开发态阳性对照 → 生产口径四种缺配置')
  const savedEnv = Object.fromEntries(AI_KEYS.map((key) => [key, process.env[key]]))
  process.env['AI_PROVIDER'] = 'mock'
  process.env['NODE_ENV'] = 'development'
  const { AppModule } = await import('../src/app.module')
  const app: INestApplication = await NestFactory.create(AppModule, { logger: false })
  app.setGlobalPrefix('api/v1')
  app.useGlobalFilters(new HttpExceptionFilter())
  // 与 main.ts 同口径的校验管道：没有它，空请求体会直接打进业务层变成 500，探针就分不清「被拦」和「没校验」。
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
  try {
    await app.listen(0)
    const base = `${(await app.getUrl()).replace('[::1]', '127.0.0.1')}/api/v1`

    // 阳性对照：开发口径下同一请求拿得到 mock 回复 —— 证明后面的 503 是本次闸门造成的，
    // 也证明「不拦就会出 mock 结果」这件事是真的（否则「没出 mock」的断言测不出任何东西）。
    const devChat = await request(base, 'POST', '/assistant/chat', { message: '你好' })
    const devReply = replyOf(devChat)
    check('阳性对照：开发口径下 /assistant/chat 返回 mock 回复', devChat.status < 300 && typeof devReply === 'string' && devReply.length > 0,
      `→ ${devChat.status} ${devChat.code} ${JSON.stringify(devChat.body).slice(0, 200)}`)
    const devHealth = await request(base, 'GET', '/health')
    const devAi = ((devHealth.body as { data?: { degraded?: HealthState[] } } | null)?.data?.degraded ?? [])
      .find((s) => s.subsystem === AI_PLATFORM_SUBSYSTEM)
    check('阳性对照：开发口径下 /health 没有 ai-platform 降级', devHealth.status === 200 && !devAi)
    const devReady = await request(base, 'GET', '/health/ready')
    check('前置：本机其它子系统健康（/health/ready 200），后面 ready 的结论才有意义', devReady.status === 200, `→ ${devReady.status}`)

    for (const scenario of SCENARIOS) {
      console.log(`\n  —— 场景：${scenario.label}`)
      applyEnv(scenario.env)
      // 与 main.ts 同一个函数、同一个入参来源（闸门返回值就是 evaluateAiPlatform(process.env)）
      registerAiPlatformDegradation(evaluateAiPlatform(), { error: () => undefined })

      const chat = await request(base, 'POST', '/assistant/chat', { message: '你好' })
      const reply = replyOf(chat)
      if (!scenario.expect.generation) {
        check(`${scenario.label}：AI 对话 503 ${NOT_CONFIGURED}`, blockedByAi(chat), `→ ${chat.status} ${chat.code}`)
        check(`${scenario.label}：响应里没有任何回复内容（没有回退 mock）`, reply === undefined, String(reply))
        const message = (chat.body as { error?: { message?: string } } | null)?.error?.message
        check(`${scenario.label}：提示用户话，说清打印扫描照常`, message === AI_GENERATION_NOT_CONFIGURED_MESSAGE, String(message))
      } else {
        check(`${scenario.label}：AI 对话不被拦`, !blockedByAi(chat), `→ ${chat.status} ${chat.code}`)
      }

      const health = await request(base, 'GET', '/health')
      const data = (health.body as { data?: { status?: string; degraded?: HealthState[] } } | null)?.data
      const ai = (data?.degraded ?? []).find((s) => s.subsystem === AI_PLATFORM_SUBSYSTEM)
      check(`${scenario.label}：/health 200 且如实 degraded`, health.status === 200 && data?.status === 'degraded' && ai?.code === AI_PLATFORM_DEGRADED_CODE,
        `→ ${health.status} ${data?.status}`)
      check(`${scenario.label}：impact 与判定同源`, JSON.stringify(ai?.impact) === JSON.stringify(aiPlatformImpact(evaluateAiPlatform())))
      check(`${scenario.label}：/health 文案点名缺的配置码`, scenario.expect.issues.every((code) => (ai?.message ?? '').includes(code)), ai?.message)
      const ready = await request(base, 'GET', '/health/ready')
      check(`${scenario.label}：/health/ready 仍 200（发布不会因 AI 未开通被回退）`, ready.status === 200, `→ ${ready.status} ${ready.code}`)

      const caps = await request(base, 'GET', '/kiosk/ai/capabilities')
      const items = ((caps.body as { data?: { items?: Array<{ key: string; status: string; reason?: string }> } } | null)?.data?.items ?? [])
      const llmItems = items.filter((item) => item.key !== 'print_param_prefill' && item.reason !== '后续接入，当前尚未开放')
      const prefill = items.find((item) => item.key === 'print_param_prefill')
      if (!scenario.expect.generation) {
        check(`${scenario.label}：一体机能力接口把大模型能力如实报 off「AI 服务暂未开通」`,
          llmItems.length > 0 && llmItems.every((item) => item.status === 'off' && item.reason === 'AI 服务暂未开通'),
          JSON.stringify(llmItems.slice(0, 3)))
        const advisor = await request(base, 'GET', '/advisor/availability')
        const available = (advisor.body as { available?: boolean; data?: { available?: boolean } } | null)
        check(`${scenario.label}：顾问可用性如实报不可用`, advisor.status === 200 && (available?.available ?? available?.data?.available) === false,
          `→ ${advisor.status} ${JSON.stringify(available)}`)
      } else {
        check(`${scenario.label}：一体机能力接口没有误报「AI 服务暂未开通」`, llmItems.every((item) => item.reason !== 'AI 服务暂未开通'))
      }
      check(`${scenario.label}：打印参数预填（确定性规则）不受 AI 开通状态影响`, prefill?.reason !== 'AI 服务暂未开通', JSON.stringify(prefill))

      // [D] impact 逐面实测
      for (const [surface, declared] of Object.entries(ai?.impact ?? {})) {
        const prober = SURFACE_PROBES[surface]
        if (!prober) {
          check(`${scenario.label}：impact 声明的面 ${surface} 有对应实测判据`, false, '在 SURFACE_PROBES 中补一个能证明该结论的探测')
          continue
        }
        const observed = await prober.run(base)
        const expectSuccess = declared === 'unaffected' || declared === 'degraded'
        check(`${scenario.label}：impact["${surface}"]="${declared}" 与实测一致（${prober.describe}；实测 ${observed.detail}）`,
          observed.succeeded === expectSuccess, `${observed.detail}；实测${observed.succeeded ? '可用' : '不可用'}`)
      }
    }
  } finally {
    applyEnv(savedEnv)
    bootReadiness.reset()
    await app.close()
  }
}

void (async () => {
  try {
    await pureDecisions()
    bootWiring()
    await realApp()
  } catch (error) {
    check('runtime', false, error instanceof Error ? error.stack ?? error.message : String(error))
  }
  console.log(failures === 0
    ? `\nverify:ai-platform-degradation：ALL PASS（${checks} 项）`
    : `\nverify:ai-platform-degradation：${failures} FAIL / ${checks} 项`)
  process.exit(failures === 0 ? 0 : 1)
})()
