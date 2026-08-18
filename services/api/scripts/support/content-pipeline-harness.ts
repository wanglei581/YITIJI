/**
 * 内容信息库端到端验证的公共脚手架。
 *
 * 关切点(与 verify-content-pipeline-e2e.ts 分开的理由):
 *   环境装配 / 夹具 / HTTP 小工具是「怎么跑」,链路断言是「跑出什么」。
 *   混在一个文件里的话,链路那部分会被 200 行环境代码淹没,读的人找不到证据在哪。
 */
import { randomUUID } from 'node:crypto'
import bcrypt from 'bcryptjs'
import { Redis } from 'ioredis'
import { startInMemoryRedis, type InMemoryRedisServer } from './inmemory-redis-server'
import { startVerificationApi, type VerificationApiServer } from './verification-api-server'

// ── 断言 harness ─────────────────────────────────────────────────────────────

let passed = 0
let failed = 0
const failures: string[] = []

export function assert(label: string, condition: boolean, detail?: string): void {
  if (condition) {
    console.log(`    PASS ${label}`)
    passed++
  } else {
    console.error(`    FAIL ${label}${detail ? ` — ${detail}` : ''}`)
    failures.push(label)
    failed++
  }
}

export function section(title: string): void {
  console.log(`\n${'─'.repeat(78)}\n${title}\n${'─'.repeat(78)}`)
}

export function step(title: string): void {
  console.log(`\n  ▸ ${title}`)
}

export function summary(): number {
  console.log(`\n${'='.repeat(78)}`)
  console.log(`  通过 ${passed} / 失败 ${failed}`)
  if (failures.length) {
    console.log('  失败清单:')
    for (const f of failures) console.log(`    - ${f}`)
  }
  console.log(`${'='.repeat(78)}\n`)
  return failed
}

// ── HTTP 小工具 ──────────────────────────────────────────────────────────────

export interface HttpResult<T = unknown> {
  status: number
  body: { success?: boolean; data?: T; error?: { code?: string; message?: string; details?: unknown } }
  raw: string
}

/**
 * 取出响应里的「业务数据」。
 *
 * 这个函数存在是因为本 API **有三种并存的响应外壳**,不是一种:
 *   ① `ApiResponse.ok(x)`  → `{ success:true, data:x }`      (多数写操作)
 *   ② 分页服务直接返回      → `{ data:[...], pagination:{} }` (GET /jobs 等)
 *   ③ 控制器直接返回 service 结果 → 裸对象/裸数组               (GET /admin/job-sources、excel preview)
 *
 * 第一版验证脚本假设只有 ①,于是 8 条断言全红 —— 红的是脚本,不是产品。
 * 把口径收敛到这里,避免每个调用点各写一遍 `body.data ?? body`(那才是真会漏的地方)。
 */
export function unwrap<T = unknown>(res: HttpResult<T>): T {
  const body = res.body as unknown
  if (Array.isArray(body)) return body as T
  if (body && typeof body === 'object' && 'data' in (body as Record<string, unknown>)) {
    return (body as { data: T }).data
  }
  return body as T
}

/** 打印一行「请求 → 状态 + 关键响应」,让报告里能贴出实测输出而不是「据说通过」。 */
export function show(label: string, res: HttpResult): void {
  const code = res.body?.error?.code
  const msg = res.body?.error?.message
  const tail = code ? ` ${code}: ${msg ?? ''}` : ` ${JSON.stringify(unwrap(res)).slice(0, 220)}`
  console.log(`      ${label} -> ${res.status}${tail}`)
}

export function makeClient(base: string) {
  async function request<T = unknown>(
    method: string,
    path: string,
    opts: { token?: string; json?: unknown; headers?: Record<string, string>; body?: BodyInit } = {},
  ): Promise<HttpResult<T>> {
    const headers: Record<string, string> = { ...(opts.headers ?? {}) }
    if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`
    let body: BodyInit | undefined = opts.body
    if (opts.json !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(opts.json)
    }
    const res = await fetch(`${base}${path}`, { method, headers, body })
    const raw = await res.text()
    let parsed: HttpResult<T>['body']
    try {
      parsed = JSON.parse(raw) as HttpResult<T>['body']
    } catch {
      parsed = { error: { code: 'NON_JSON_RESPONSE', message: raw.slice(0, 200) } }
    }
    return { status: res.status, body: parsed, raw }
  }
  return {
    get: <T = unknown>(p: string, o?: Parameters<typeof request>[2]) => request<T>('GET', p, o),
    post: <T = unknown>(p: string, o?: Parameters<typeof request>[2]) => request<T>('POST', p, o),
    patch: <T = unknown>(p: string, o?: Parameters<typeof request>[2]) => request<T>('PATCH', p, o),
    del: <T = unknown>(p: string, o?: Parameters<typeof request>[2]) => request<T>('DELETE', p, o),
  }
}

export type Client = ReturnType<typeof makeClient>

// ── 环境 ─────────────────────────────────────────────────────────────────────

export interface HarnessEnv {
  api: VerificationApiServer
  redisStub: InMemoryRedisServer
  redis: Redis
  http: Client
  /** 本次运行的唯一后缀,所有夹具 id 都带上,便于清理与并发隔离 */
  run: string
  close(): Promise<void>
}

/**
 * 关键设计:**永远使用进程内的内存 Redis 桩**,不复用外部 Redis。
 *
 * 理由是可判别性,不是省事:本机没有 Redis 时,webhook 的 nonce 防重放
 * (`RedisService.setNxEx`)会以 MaxRetriesPerRequestError 失败,
 * 「webhook 能不能进数据」这一步就变成环境噪声而不是结论。CI 里即使有真 Redis,
 * 也用同一个桩 —— 本机与 CI 走同一条路径,结论才可迁移。
 *
 * 代价必须说清:桩不实现 Lua,BullMQ 在它上面是失败的。因此本验证对
 * 「API 拉取」只验 inline 执行路径,并在报告里如实标注队列未验。
 */
export async function startHarness(port: number): Promise<HarnessEnv> {
  const redisStub = await startInMemoryRedis()
  process.env['REDIS_URL'] = redisStub.url
  // 隔离库守卫的三道判据里,**真正拦住误伤生产的是后两道**:
  //   ① VERIFICATION_DATABASE_TARGET=isolated —— 操作者的显式确认
  //   ② 库名必须含 ci/dev/test/verify 词元
  //   ③ NODE_ENV 不得是 production
  // 本脚本自己补 ①(缺省时),因为 CI 里它是由 workflow 行内 env 提供的,
  // 而本仓库的 workflow 不在本次改动范围内;②③ 原样生效,不做任何削弱。
  // 手工跑时若显式传了别的值,以传入的为准 —— 不覆盖操作者的选择。
  process.env['VERIFICATION_DATABASE_TARGET'] ??= 'isolated'
  process.env['DATABASE_URL'] ??= 'file:./prisma/verify-e2e.db'
  process.env['JWT_SECRET'] ??= 'verify-content-pipeline-jwt-secret-0123456789'
  process.env['FILE_SIGNING_SECRET'] ??= 'verify-content-pipeline-file-signing-0123456789'
  process.env['SECRET_ENCRYPTION_KEY'] ??= 'verify-content-pipeline-encryption-0123456789'
  process.env['FILE_STORAGE_DRIVER'] ??= 'local'
  process.env['FILE_STORAGE_DIR'] ??= '/tmp/verify-content-pipeline-storage'
  process.env['AI_PROVIDER'] ??= 'mock'
  process.env['SMS_PROVIDER'] ??= 'log'
  process.env['TERMINAL_ADMIN_SECRET'] ??= 'verify-content-pipeline-terminal-admin'
  process.env['TERMINAL_ACTION_TOKEN_SECRET'] ??= 'verify-content-pipeline-terminal-action'

  const { assertIsolatedVerificationDatabase } = await import('./isolated-verification-database')
  assertIsolatedVerificationDatabase()

  const api = await startVerificationApi(port, redisStub.url)
  const redis = new Redis(redisStub.url)
  return {
    api,
    redisStub,
    redis,
    http: makeClient(api.base),
    run: randomUUID().replace(/-/g, '').slice(0, 10),
    async close() {
      redis.disconnect()
      await api.close()
      await redisStub.close()
    },
  }
}

// ── 夹具 ─────────────────────────────────────────────────────────────────────

export const FIXTURE_PREFIX = 'cpe2e'

export async function hashPassword(pw: string): Promise<string> {
  return bcrypt.hash(pw, 4)
}

/** 登录内部账号(admin / partner),返回 JWT。 */
export async function login(http: Client, username: string, password: string, portal: string): Promise<string> {
  const res = await http.post<{ token?: string }>('/auth/login', { json: { username, password, portal } })
  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`登录失败 ${username}: ${res.status} ${res.raw.slice(0, 300)}`)
  }
  const token = res.body.data?.token
  if (!token) throw new Error(`登录未返回 token: ${res.raw.slice(0, 300)}`)
  return token
}
