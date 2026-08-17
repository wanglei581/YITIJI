/**
 * verify:error-observability —— 异常可运维性 + 日志不泄漏 PII 门禁
 *
 * 守的是这条真实故障（实测复现，基线 origin/main@8188fcf13）：
 * 全局异常过滤器**一行日志都不写**。`requestId` 回给了客户端却从不落服务端日志 ——
 * 实测一次 500 返回 requestId=7bf03f4f…，在服务端日志里 grep 到 **0** 次。
 * 拿着 requestId 查不到任何东西，直接违反交付章程门槛④
 * 「可运维：出问题时，运维能在日志里看见原因」。
 *
 * 但「加日志」本身是一个泄漏风险：本仓刚做完 PII 脱敏收口（#646 / #649），
 * 而异常消息（尤其 Prisma 校验错误）会把参数值拼进 message，堆栈首行也是消息。
 * 所以本门禁同时守两个方向，缺一不可：
 *
 *   [A] 有日志：5xx 必须落一条带 requestId / 路由 / 方法 / 状态码 / 错误类 /
 *       耗时 / 栈帧的 error 记录；4xx 不得刷 error 级。
 *   [B] 没泄漏：用**对抗性输入**驱动真实过滤器 —— 把手机号、身份证号、邮箱、
 *       中文用户原话、Bearer token、密码同时塞进异常消息、请求体、query、
 *       header 和 URL 路径，逐个断言它们**没有一个**出现在日志里。
 *   [C] 端到端：拉起真实 src/main.ts 触发一次真实 5xx，
 *       证明响应体里的 requestId 与日志里的 requestId 真的能对上。
 */
import 'reflect-metadata'
import 'dotenv/config'
import { BadRequestException, HttpException, HttpStatus, NotFoundException } from '@nestjs/common'
import { bootApp, probe, unusedLoopbackPort } from './support/boot-api-child'

let failures = 0
let checks = 0

function check(name: string, ok: boolean, detail = ''): void {
  checks += 1
  if (ok) { console.log(`  ✅ ${name}`); return }
  failures += 1
  console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`)
}

/**
 * 对抗性载荷。每一条都是「真被写进日志就等于事故」的东西。
 * 门禁不检查「有没有脱敏」，而是检查它们**根本没进过日志**。
 */
const PII_PROBES: Record<string, string> = {
  手机号: '13912345678',
  身份证号: '110101199001011234',
  邮箱: 'zhangsan@example.com',
  用户原话: '我叫张三想找一份运营岗位',
  Bearer凭证: 'eyJhbGciOiJIUzI1NiJ9.secret-token-value.sig',
  密码: 'MyS3cretPassw0rd!',
  银行卡号: '6222021234567890123',
}

const PII_VALUES = Object.values(PII_PROBES)

interface CapturedLog { level: string; text: string }

/** 用假的 ArgumentsHost / Response 驱动真实过滤器，并截获它写的每一条日志。 */
async function driveFilter(options: {
  exception: unknown
  requestId?: string
  method?: string
  routePath?: string
  originalUrl?: string
  body?: unknown
  query?: unknown
  headers?: Record<string, string>
}): Promise<{ logs: CapturedLog[]; status: number; payload: unknown }> {
  const { HttpExceptionFilter } = await import('../src/common/filters/http-exception.filter')
  const filter = new HttpExceptionFilter()

  const logs: CapturedLog[] = []
  const logger = (filter as unknown as { logger: Record<string, unknown> }).logger
  for (const level of ['error', 'warn', 'debug', 'log', 'verbose'] as const) {
    logger[level] = (message: unknown): void => { logs.push({ level, text: String(message) }) }
  }

  let status = 0
  let payload: unknown = null
  const request = {
    requestId: options.requestId ?? 'req-fixture-0001',
    requestStartedAt: Date.now() - 42,
    method: options.method ?? 'POST',
    route: options.routePath ? { path: options.routePath } : undefined,
    baseUrl: '/api/v1',
    originalUrl: options.originalUrl ?? '/api/v1/fixture',
    path: options.originalUrl ?? '/api/v1/fixture',
    body: options.body,
    query: options.query,
    headers: options.headers ?? {},
  }
  const response = {
    status(code: number) { status = code; return this },
    json(value: unknown) { payload = value; return this },
  }
  const host = {
    switchToHttp: () => ({ getResponse: () => response, getRequest: () => request }),
  }

  filter.catch(options.exception, host as never)
  return { logs, status, payload }
}

// ── [A] 有日志：5xx 必须留下可定位的痕迹 ─────────────────────────────────────

async function verifyErrorsAreLogged(): Promise<void> {
  console.log('\n[A] 异常必须在服务端留痕（此前 500 是零痕迹）')

  const boom = new TypeError("Cannot read properties of undefined (reading 'write')")
  const { logs, status, payload } = await driveFilter({
    exception: boom,
    requestId: 'req-a-0001',
    method: 'GET',
    routePath: '/admin/orders/:id',
  })

  check('未预期异常仍塌成 500 + 通用文案（响应契约未变）', status === 500)
  check('响应体仍带 requestId（原有契约未变）',
    (payload as { requestId?: string })?.requestId === 'req-a-0001')

  const errorLogs = logs.filter((l) => l.level === 'error')
  check('500 写且只写一条 error 级日志', errorLogs.length === 1, `实际 ${errorLogs.length} 条`)
  const line = errorLogs[0]?.text ?? ''
  check('日志含 requestId（拿着 requestId 能反查到这一行）', line.includes('requestId=req-a-0001'), line)
  check('日志含 HTTP 方法', line.includes('method=GET'), line)
  check('日志含路由模板（不是带用户数据的原始 URL）', line.includes('route=/api/v1/admin/orders/:id'), line)
  check('日志含状态码', line.includes('status=500'), line)
  check('日志含错误类（运维据此判断是哪一类故障）', line.includes('errorType=TypeError'), line)
  check('日志含耗时（区分「立刻失败」与「等外部依赖等死」）', /durationMs=\d+/.test(line), line)
  check('日志含可 grep 的固定前缀', line.includes('REQUEST_FAILED'), line)
  check('日志含栈帧（给出原因在哪一行）', line.includes('\n  at '), line.slice(0, 200))

  // 栈帧要有，但**首行消息不能有** —— 这正是「记堆栈」最容易踩的泄漏点。
  check('日志不含堆栈首行的异常消息', !line.includes('Cannot read properties'), line.slice(0, 200))
}

// ── [B] 分级：4xx 是客户端问题，不该刷 error ──────────────────────────────────

async function verifyLevels(): Promise<void> {
  console.log('\n[B] 4xx / 5xx 分级正确（400 不该刷 error 把真故障淹掉）')

  const cases: Array<{ name: string; exception: HttpException; expectError: boolean }> = [
    {
      name: '400 校验失败',
      exception: new BadRequestException({ error: { code: 'VALIDATION_FAILED', message: '参数不合法' } }),
      expectError: false,
    },
    { name: '404 未找到', exception: new NotFoundException({ error: { code: 'NOT_FOUND', message: '不存在' } }), expectError: false },
    {
      name: '503 依赖降级（服务端自己判定的失败）',
      exception: new HttpException({ error: { code: 'HEALTH_DEPENDENCY_DEGRADED', message: '降级' } }, HttpStatus.SERVICE_UNAVAILABLE),
      expectError: true,
    },
  ]

  for (const testCase of cases) {
    const { logs } = await driveFilter({ exception: testCase.exception })
    const errorCount = logs.filter((l) => l.level === 'error').length
    check(
      `${testCase.name} → ${testCase.expectError ? '记 error' : '不记 error'}`,
      (errorCount > 0) === testCase.expectError,
      `error 级 ${errorCount} 条，全部级别：${logs.map((l) => l.level).join(',')}`,
    )
    check(`${testCase.name} 至少留下一条痕迹（任何级别）`, logs.length > 0)
  }
}

// ── [C] 不泄漏：对抗性输入一条都不许进日志 ───────────────────────────────────

async function verifyNoPiiLeak(): Promise<void> {
  console.log('\n[C] 对抗性输入：PII / 凭证 / 用户原话一条都不得进日志')

  // 把每一处可能被顺手记进日志的位置全部塞满敏感数据。
  const poisoned = new Error(
    `数据库写入失败 phone=${PII_PROBES['手机号']} idCard=${PII_PROBES['身份证号']} `
    + `email=${PII_PROBES['邮箱']} note=${PII_PROBES['用户原话']} card=${PII_PROBES['银行卡号']}`,
  )

  const { logs } = await driveFilter({
    exception: poisoned,
    method: 'POST',
    routePath: '/member/profile/:id',
    originalUrl: `/api/v1/member/profile/${PII_PROBES['手机号']}?note=${encodeURIComponent(PII_PROBES['用户原话'])}`,
    body: { resumeText: PII_PROBES['用户原话'], phone: PII_PROBES['手机号'], password: PII_PROBES['密码'] },
    query: { keyword: PII_PROBES['用户原话'], email: PII_PROBES['邮箱'] },
    headers: {
      authorization: `Bearer ${PII_PROBES['Bearer凭证']}`,
      cookie: `session=${PII_PROBES['Bearer凭证']}`,
      'x-real-ip': '203.0.113.7',
    },
  })

  const combined = logs.map((l) => l.text).join('\n')
  check('该异常确实被记了下来（否则本段是空跑的假通过）', logs.length > 0)
  for (const [label, value] of Object.entries(PII_PROBES)) {
    check(`日志不含${label}`, !combined.includes(value), combined.slice(0, 300))
  }
  check('日志不含 Cookie 值', !combined.includes('session='), combined.slice(0, 300))

  // 路由未匹配时（404 等）退回请求路径 —— 此时路径里的用户可控内容必须被挡住。
  const unmatched = await driveFilter({
    exception: new NotFoundException({ error: { code: 'NOT_FOUND', message: '不存在' } }),
    routePath: undefined,
    originalUrl: `/api/v1/search/${encodeURIComponent(PII_PROBES['用户原话'])}`,
  })
  const unmatchedText = unmatched.logs.map((l) => l.text).join('\n')
  check('未匹配路由时不把用户可控路径原样写进日志',
    !unmatchedText.includes(PII_PROBES['用户原话'])
    && !unmatchedText.includes(encodeURIComponent(PII_PROBES['用户原话'])),
    unmatchedText.slice(0, 300))

  // 客户端可控的 X-Request-Id 同样是一条写日志的通道，必须先过字符集。
  const { RequestIdMiddleware } = await import('../src/common/middleware/request-id.middleware')
  const middleware = new RequestIdMiddleware()
  const captured: Record<string, string> = {}
  const req = {
    header: (name: string) => (name.toLowerCase() === 'x-request-id' ? PII_PROBES['用户原话'] : undefined),
  } as unknown as Parameters<typeof middleware.use>[0]
  const res = { setHeader: (k: string, v: string) => { captured[k] = v } } as unknown as Parameters<typeof middleware.use>[1]
  middleware.use(req, res, () => undefined)
  const assignedId = (req as unknown as { requestId?: string }).requestId ?? ''
  check('客户端塞进 X-Request-Id 的中文原话被拒收（不给外部一条写日志的通道）',
    !assignedId.includes(PII_PROBES['用户原话']) && assignedId.length > 0, assignedId)
  check('中间件记录了请求起点（异常日志的耗时来源）',
    typeof (req as unknown as { requestStartedAt?: number }).requestStartedAt === 'number')
}

// ── [D] 端到端：响应里的 requestId 必须能在日志里查到 ────────────────────────

async function verifyEndToEnd(): Promise<void> {
  console.log('\n[D] 端到端：真实 5xx 的 requestId 必须真的能在服务端日志里查到')

  const deadRedisPort = await unusedLoopbackPort()
  const app = await bootApp({ REDIS_URL: `redis://127.0.0.1:${deadRedisPort}` }, 120_000)
  try {
    check('测试实例已启动', app.listening, `exitCode=${app.child.exitCode}`)
    if (!app.listening) return

    // Redis 是 C 端会话的真源，不可达时这条链路必然失败 —— 一个确定可复现的 5xx，
    // 不需要为了触发错误往生产代码里加测试专用路由。
    const failed = await probe(app.port, '/member/auth/sms-code', {
      method: 'POST',
      body: { phone: PII_PROBES['手机号'] },
      timeoutMs: 120_000,
    })
    check('该请求确实失败为 5xx（本段有东西可验）', failed.status >= 500, `实际 ${failed.status}`)

    const requestId = (failed.body as { requestId?: string })?.requestId ?? ''
    check('5xx 响应体带 requestId', requestId.length > 0)
    if (!requestId) return

    // 日志是异步写的，给一点时间落盘。
    let log = ''
    for (let i = 0; i < 20 && !log.includes(requestId); i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 250))
      log = app.output()
    }
    check('服务端日志里能按 requestId 查到这次失败（此前实测 0 次命中）',
      log.includes(requestId), `requestId=${requestId}`)

    const failureLines = log.split('\n').filter((l) => l.includes('REQUEST_FAILED') && l.includes(requestId))
    check('该记录带可 grep 前缀 REQUEST_FAILED', failureLines.length > 0)
    check('该记录给出错误类（运维据此判断故障归属）',
      failureLines.some((l) => /errorType=\w+/.test(l)), failureLines.join(' | ').slice(0, 300))
    check('该记录给出耗时', failureLines.some((l) => /durationMs=\d+/.test(l)))

    check('日志不含请求里的手机号', !log.includes(PII_PROBES['手机号']))
  } finally {
    await app.stop()
  }
}

async function main(): Promise<void> {
  console.log('=== 异常可运维性 + 日志不泄漏 PII 门禁 verify:error-observability ===')
  await verifyErrorsAreLogged()
  await verifyLevels()
  await verifyNoPiiLeak()
  await verifyEndToEnd()

  console.log(`\n结果：${checks - failures}/${checks} 通过`)
  if (failures > 0) {
    console.error(`❌ ${failures} 项失败`)
    process.exit(1)
  }
  console.log('✅ 全部通过')
  process.exit(0)
}

void main()
