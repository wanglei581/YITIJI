/**
 * verify:internal-login-real-redis
 *
 * 证明：在真实 src/main.ts + 临时 redis-server 上，内部账号用真实密码登录后
 * 能读到业务数据。现有两条门禁都没走过这条成功路径：
 *   - verify:redis-degradation-truth 虽拉起真实入口，但 Redis 指到死端口，
 *     登录只断言「次数核不准就 503」；
 *   - verify:admin-login-hardening 用进程内 MemoryRedis，不经过 redis-server。
 *
 * 为什么不写进那两个文件：它们各自守一种相反的故障（Redis 挂了 / 内存桩下的
 * 加固分支）。塞进任何一个都会改那条门禁在守什么，而且两个文件都已经超过
 * 500 行。启动方式复用 scripts/support/boot-api-child.ts 的 bootApp（与
 * redis-degradation-truth 同一份），临时 Redis 用
 * scripts/support/ephemeral-redis-server.ts。不改这两条门禁的源码。
 *
 * 管理员短信第二步显式关掉（ADMIN_LOGIN_SECOND_FACTOR=off）。
 * 原因：设为 sms 时，密码通过只发一次性第二步凭证，不签发登录凭证，还要真实短信。
 * 本门禁要证明的是密码本身能换到凭证并读到业务数据。短信第二步由
 * verify:admin-login-hardening 覆盖。同时清空 ADMIN_IP_ALLOWLIST：地址名单
 * 不是这里要证明的事，避免调用方环境把回环地址挡在管理员登录之外。
 *
 * 登录路由按来源 IP 每 60 秒最多 5 次，和密码失败上限同为 5。
 * 第 6 次若紧接着发，会被 IP 限流挡在登录逻辑之前，看到的是 RATE_LIMITED，
 * 不能证明账号锁定。因此 5 次错误密码之后先等这个窗口过去，再拿正确密码去撞锁定。
 *
 * 数据库不用调用方传来的库（CI 上是共享的 prisma/dev.db，文件名里的 dev 能通过
 * 隔离检查）。每次自己 mkdtemp + prisma migrate deploy 出一个临时 SQLite，用完删除。
 */
import 'reflect-metadata'
import 'dotenv/config'
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { closeSync, existsSync, mkdtempSync, openSync, rmSync, statSync, type Stats } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve, sep } from 'node:path'
import { Redis } from 'ioredis'
import * as bcrypt from 'bcryptjs'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'
import { collectEphemeralRedisSelfChecks } from './support/ephemeral-redis-self-check'
import {
  registerProcessCleanup,
  startEphemeralRedis,
  type EphemeralRedis,
} from './support/ephemeral-redis-server'
import { bootApp, probe, sleep, type BootedApp, type HttpProbeResult } from './support/boot-api-child'
import {
  PASSWORD_LOGIN_FAILURE_LIMIT,
  passwordLoginAccountKey,
  passwordLoginIdentityKey,
} from '../src/auth/password-login-attempts'
import { PASSWORD_PROOF_STATE } from '../src/auth/password-proof-state'

/** 产品规则：连续 5 次错误密码后锁定。循环次数写死这个数，不跟着实现常量走。 */
const SPEC_FAILURE_LIMIT = 5
/**
 * auth.controller.ts 登录路由 `@Throttle({ default: { ttl: 60_000, limit: 5 } })`。
 * 多等 8 秒，盖过进程繁忙时定时器晚到。
 */
const LOGIN_IP_WINDOW_WAIT_MS = 68_000
const apiRoot = join(import.meta.dirname, '..')

let failures = 0
let checks = 0

function check(name: string, ok: boolean, detail = ''): void {
  checks += 1
  if (ok) { console.log(`  ✅ ${name}`); return }
  failures += 1
  console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`)
}

function errorCode(body: unknown): string {
  if (!body || typeof body !== 'object') return ''
  const error = (body as { error?: { code?: unknown } }).error
  return typeof error?.code === 'string' ? error.code : ''
}

function tokenOf(body: unknown): string {
  if (!body || typeof body !== 'object') return ''
  const data = (body as { data?: { token?: unknown } }).data
  const token = data?.token
  return typeof token === 'string' ? token : ''
}

function describe(result: HttpProbeResult): string {
  return `HTTP ${result.status} ${errorCode(result.body)}`
}

/**
 * Nest 对没有 @HttpCode 的 POST 默认回 201。
 * 登录和改密认的是「成功，并且正文里有凭证 / success」，不把 201 当成失败。
 * 业务读取接口仍必须是 200。
 */
function isPostSuccess(status: number): boolean {
  return status === 200 || status === 201
}

interface IsolatedDatabase {
  directory: string
  databasePath: string
  databaseUrl: string
  cleanup: () => void
}

function inheritedFileDatabasePath(): string | null {
  const databaseUrl = process.env['DATABASE_URL']?.trim()
  if (!databaseUrl?.startsWith('file:')) return null
  const raw = databaseUrl.slice('file:'.length).split(/[?#]/, 1)[0] ?? ''
  if (!raw || raw === ':memory:') return null
  return isAbsolute(raw) ? raw : resolve(apiRoot, raw)
}

function prismaCli(): string {
  const candidates = [
    join(apiRoot, 'node_modules', 'prisma', 'build', 'index.js'),
    join(apiRoot, '..', '..', 'node_modules', 'prisma', 'build', 'index.js'),
  ]
  const found = candidates.find((path) => existsSync(path))
  if (!found) throw new Error(`找不到 Prisma CLI：${candidates.join(' , ')}`)
  return found
}

function deployIsolatedSqlite(): IsolatedDatabase {
  if (process.env['NODE_ENV']?.trim().toLowerCase() === 'production') {
    throw new Error('VERIFICATION_DATABASE_PRODUCTION_FORBIDDEN')
  }
  const directory = mkdtempSync(join(tmpdir(), 'verify-internal-login-real-redis-'))
  const databasePath = join(directory, 'verify.db')
  closeSync(openSync(databasePath, 'a'))
  const databaseUrl = `file:${databasePath}`
  const cleanup = (): void => {
    rmSync(directory, { recursive: true, force: true })
  }
  registerProcessCleanup(cleanup)
  process.env['DATABASE_URL'] = databaseUrl
  process.env['VERIFICATION_DATABASE_TARGET'] = 'isolated'
  try {
    assertIsolatedVerificationDatabase()
  } catch (error) {
    cleanup()
    throw error
  }
  try {
    execFileSync(process.execPath, [prismaCli(), 'migrate', 'deploy'], {
      cwd: apiRoot,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    cleanup()
    const err = error as { stderr?: string; stdout?: string; message?: string }
    throw new Error(`prisma migrate deploy 失败：${(err.stderr || err.stdout || err.message || '').trim()}`)
  }
  return { directory, databasePath, databaseUrl, cleanup }
}

async function bootApi(env: Record<string, string>): Promise<BootedApp> {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const app = await bootApp(env, 120_000)
    if (app.port < 4100 || app.port > 4199) return app
    await app.stop()
  }
  throw new Error('API 端口连续落在 4100-4199，本门禁不占用这段端口')
}

function login(port: number, loginId: string, password: string, portal: 'admin' | 'partner'): Promise<HttpProbeResult> {
  return probe(port, '/auth/login', {
    method: 'POST',
    body: { loginId, password, portal },
    timeoutMs: 20_000,
  })
}

async function redisCount(redis: Redis, key: string): Promise<number | null> {
  const raw = await redis.get(key)
  if (raw === null || !/^\d+$/.test(raw)) return null
  return Number(raw)
}

function finish(code: number): void {
  console.log(`\nverify:internal-login-real-redis：${checks - failures}/${checks} 通过`)
  if (code !== 0) console.error(`❌ ${failures} 项失败`)
  else console.log('✅ 全部通过')
  process.exit(code)
}

async function main(): Promise<void> {
  console.log('=== 真 Redis 内部账号密码登录 verify:internal-login-real-redis ===')
  const inheritedDatabasePath = inheritedFileDatabasePath()
  const inheritedBefore: Stats | null = inheritedDatabasePath && existsSync(inheritedDatabasePath)
    ? statSync(inheritedDatabasePath)
    : null
  for (const item of await collectEphemeralRedisSelfChecks()) {
    check(item.name, item.ok, item.detail ?? '')
  }
  if (failures > 0) finish(1)

  const database = deployIsolatedSqlite()
  const sharedDevDb = resolve(apiRoot, 'prisma', 'dev.db')
  check(
    '登录门禁用的是独立临时库，不是 prisma/dev.db',
    resolve(database.databasePath) !== sharedDevDb && database.databasePath.endsWith(`${sep}verify.db`),
    database.databasePath,
  )
  check(
    '密码失败上限常量仍是 5（规格；实现把上限改大时，不能靠把循环也改大来放过）',
    PASSWORD_LOGIN_FAILURE_LIMIT === SPEC_FAILURE_LIMIT,
    `实现为 ${PASSWORD_LOGIN_FAILURE_LIMIT}`,
  )

  const suffix = randomBytes(4).toString('hex')
  const orgId = `vilr-org-${suffix}`
  const adminId = `vilr-admin-${suffix}`
  const partnerId = `vilr-partner-${suffix}`
  const orgName = `门禁机构${suffix}`
  const adminLogin = `vilr-admin-${suffix}`
  const partnerLogin = `vilr-partner-${suffix}`
  const adminPassword = `Verify-${suffix}-Aa1!`
  const partnerPassword = `Verify-${suffix}-Bb2!`
  const adminNextPassword = `Changed-${suffix}-Cc3!`
  const wrongPassword = `Wrong-${suffix}-Dd4!`

  let redisServer: EphemeralRedis | null = null
  let inspector: Redis | null = null
  let app: BootedApp | null = null
  let prisma: {
    onModuleInit: () => Promise<void>
    onModuleDestroy: () => Promise<void>
    organization: { create: (args: unknown) => Promise<unknown>; deleteMany: (args: unknown) => Promise<unknown> }
    user: { create: (args: unknown) => Promise<unknown>; deleteMany: (args: unknown) => Promise<unknown> }
    auditLog: { deleteMany: (args: unknown) => Promise<unknown> }
  } | null = null

  registerProcessCleanup(() => {
    const child = app?.child
    if (child && child.exitCode === null && typeof child.pid === 'number') {
      try { child.kill('SIGKILL') } catch { /* 子进程已经没了 */ }
    }
  })

  const removeFixtures = async (): Promise<void> => {
    if (!prisma) return
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { actorId: { startsWith: 'vilr-' } },
          { targetId: { startsWith: 'vilr-' } },
        ],
      },
    })
    await prisma.user.deleteMany({ where: { id: { startsWith: 'vilr-' } } })
    await prisma.organization.deleteMany({ where: { id: { startsWith: 'vilr-' } } })
  }

  try {
    redisServer = await startEphemeralRedis()
    check(
      `临时 redis-server 在 127.0.0.1:${redisServer.port}（不在 4100-4199，也不是共享实例）`,
      redisServer.port < 4100 || redisServer.port > 4199,
    )
    inspector = new Redis(redisServer.url, { maxRetriesPerRequest: 2, enableOfflineQueue: false, lazyConnect: true })
    inspector.on('error', () => { /* 断线由下面的断言表现，不把进程打成未处理异常 */ })
    await inspector.connect()
    const pong = await inspector.ping()
    check('门禁进程用独立 ioredis 连上的是这个临时 Redis', pong === 'PONG', pong)

    const { PrismaService } = await import('../src/prisma/prisma.service')
    prisma = new PrismaService()
    await prisma.onModuleInit()
    await removeFixtures()
    const adminHash = await bcrypt.hash(adminPassword, 10)
    const partnerHash = await bcrypt.hash(partnerPassword, 10)
    await prisma.organization.create({
      data: { id: orgId, name: orgName, type: 'school', enabled: true },
    })
    await prisma.user.create({
      data: {
        id: adminId,
        username: adminLogin,
        passwordHash: adminHash,
        passwordProofState: PASSWORD_PROOF_STATE.OWNER_MANAGED,
        name: '门禁管理员',
        role: 'admin',
        tokenVersion: 0,
        enabled: true,
      },
    })
    await prisma.user.create({
      data: {
        id: partnerId,
        username: partnerLogin,
        passwordHash: partnerHash,
        passwordProofState: PASSWORD_PROOF_STATE.OWNER_MANAGED,
        name: '门禁机构账号',
        role: 'partner',
        orgId,
        tokenVersion: 0,
        enabled: true,
      },
    })

    console.log('  … 子进程 ADMIN_LOGIN_SECOND_FACTOR=off：短信第二步不签发登录凭证，且要真实短信，本门禁不测那一步')
    app = await bootApi({
      REDIS_URL: redisServer.url,
      DATABASE_URL: database.databaseUrl,
      VERIFICATION_DATABASE_TARGET: 'isolated',
      ADMIN_LOGIN_SECOND_FACTOR: 'off',
      ADMIN_IP_ALLOWLIST: '',
      TRUST_PROXY_HOPS: '',
    })
    check('真实 src/main.ts 已监听', app.listening, app.listening ? '' : app.output().slice(-800))
    if (!app.listening) return

    const health = await probe(app.port, '/health', { timeoutMs: 20_000 })
    const degraded = (health.body as { data?: { degraded?: Array<{ subsystem?: string }> } } | null)?.data?.degraded ?? []
    const redisDegraded = degraded.some((item) => item.subsystem === 'redis')
    check('GET /health 没有把 Redis 标成降级（登录走的是活着的 Redis）', health.status === 200 && !redisDegraded,
      describe(health))
    if (health.status !== 200 || redisDegraded) return

    const identityKey = passwordLoginIdentityKey(partnerLogin, 'partner')
    const accountKey = passwordLoginAccountKey(partnerId, 'partner')
    let wrongPasswordsOk = true
    for (let attempt = 1; attempt <= SPEC_FAILURE_LIMIT; attempt += 1) {
      const result = await login(app.port, partnerLogin, wrongPassword, 'partner')
      const ok = result.status === 401 && errorCode(result.body) === 'AUTH_LOGIN_FAILED'
      if (!ok) {
        wrongPasswordsOk = false
        check(`第 ${attempt} 次错误密码是 401 AUTH_LOGIN_FAILED（尚未被 IP 限流或提前锁定）`, false, describe(result))
        break
      }
    }
    if (wrongPasswordsOk) {
      check(`连续 ${SPEC_FAILURE_LIMIT} 次错误密码都是 401 AUTH_LOGIN_FAILED`, true)
    }

    const identityBefore = await redisCount(inspector, identityKey)
    const accountBefore = await redisCount(inspector, accountKey)
    check(
      '真 Redis 里身份失败计数等于 5（键由登录路径写入，不是内存桩）',
      identityBefore === SPEC_FAILURE_LIMIT,
      `实际 ${identityBefore ?? '无此键'}`,
    )
    check(
      '真 Redis 里账号失败计数等于 5（换登录名也绕不过这一把）',
      accountBefore === SPEC_FAILURE_LIMIT,
      `实际 ${accountBefore ?? '无此键'}`,
    )

    console.log('  … 等待登录路由的 60 秒 IP 窗口过去，再拿正确密码验证锁定（避免第 6 次被限流截走）')
    await sleep(LOGIN_IP_WINDOW_WAIT_MS)

    let locked = await login(app.port, partnerLogin, partnerPassword, 'partner')
    if (locked.status === 429 && errorCode(locked.body) === 'RATE_LIMITED') {
      // 触发限流的那一次已经把这个 IP 封住 blockDuration（等于窗口 60 秒）。
      // 只再等十几秒仍会看到 RATE_LIMITED，必须再等一个完整窗口。
      console.log('  … IP 窗口尚未让出，再等一个完整窗口后重试这一次')
      await sleep(LOGIN_IP_WINDOW_WAIT_MS)
      locked = await login(app.port, partnerLogin, partnerPassword, 'partner')
    }
    check(
      '正确密码在锁定后也登不上（429 AUTH_LOGIN_LOCKED，不是 IP 限流）',
      locked.status === 429 && errorCode(locked.body) === 'AUTH_LOGIN_LOCKED',
      describe(locked),
    )
    const identityAfter = await redisCount(inspector, identityKey)
    const accountAfter = await redisCount(inspector, accountKey)
    check(
      '锁定没有清掉 Redis 计数（两个键仍是 5；登录成功才会删键）',
      identityAfter === SPEC_FAILURE_LIMIT && accountAfter === SPEC_FAILURE_LIMIT,
      `身份 ${identityAfter ?? '无'} / 账号 ${accountAfter ?? '无'}`,
    )

    // 锁定已经由 HTTP 与 Redis 双重证明。清掉计数只为了用同一个机构账号继续走成功路径，
    // 不代替上面的锁定断言。锁定期是 15 分钟，不清的话本轮就看不到「正确密码能登录」。
    await inspector.del(identityKey, accountKey)

    const partnerSession = await login(app.port, partnerLogin, partnerPassword, 'partner')
    const partnerToken = tokenOf(partnerSession.body)
    check('机构账号用正确密码登录并拿到凭证', isPostSuccess(partnerSession.status) && partnerToken.length > 0,
      partnerToken ? describe(partnerSession) : `${describe(partnerSession)}（响应里没有凭证）`)

    const profile = await probe(app.port, '/partner/profile', { token: partnerToken, timeoutMs: 20_000 })
    const profileId = (profile.body as { id?: unknown } | null)?.id
    const profileName = (profile.body as { name?: unknown } | null)?.name
    check(
      '机构凭证读取本机构资料返回 200，且就是刚造的那一家',
      profile.status === 200 && profileId === orgId && profileName === orgName,
      `${describe(profile)} id=${String(profileId)}`,
    )

    const partnerOnAdmin = await probe(app.port, '/admin/orgs', { token: partnerToken, timeoutMs: 20_000 })
    check(
      '机构凭证调用管理员机构列表被拒（403 AUTH_ROLE_FORBIDDEN）',
      partnerOnAdmin.status === 403 && errorCode(partnerOnAdmin.body) === 'AUTH_ROLE_FORBIDDEN',
      describe(partnerOnAdmin),
    )

    const adminSession = await login(app.port, adminLogin, adminPassword, 'admin')
    const adminToken = tokenOf(adminSession.body)
    check('管理员用正确密码登录并拿到凭证', isPostSuccess(adminSession.status) && adminToken.length > 0,
      adminToken ? describe(adminSession) : `${describe(adminSession)}（响应里没有凭证）`)

    const orgs = await probe(app.port, '/admin/orgs', { token: adminToken, timeoutMs: 20_000 })
    const orgRows = Array.isArray(orgs.body) ? orgs.body as Array<{ id?: string; name?: string }> : []
    check(
      '管理员机构列表返回 200，且包含刚造的机构',
      orgs.status === 200 && orgRows.some((row) => row.id === orgId && row.name === orgName),
      describe(orgs),
    )

    const changed = await probe(app.port, '/auth/password/change', {
      method: 'POST',
      token: adminToken,
      body: { currentPassword: adminPassword, newPassword: adminNextPassword },
      timeoutMs: 20_000,
    })
    const changedOk = (changed.body as { data?: { success?: unknown } } | null)?.data?.success === true
    check('管理员改密成功', isPostSuccess(changed.status) && changedOk, describe(changed))

    const stale = await probe(app.port, '/admin/orgs', { token: adminToken, timeoutMs: 20_000 })
    check(
      '改密前的凭证再读机构列表被拒（401 AUTH_TOKEN_INVALID）',
      stale.status === 401 && errorCode(stale.body) === 'AUTH_TOKEN_INVALID',
      describe(stale),
    )

    const refreshed = await login(app.port, adminLogin, adminNextPassword, 'admin')
    const refreshedToken = tokenOf(refreshed.body)
    const refreshedOrgs = await probe(app.port, '/admin/orgs', { token: refreshedToken, timeoutMs: 20_000 })
    const refreshedRows = Array.isArray(refreshedOrgs.body) ? refreshedOrgs.body as Array<{ id?: string }> : []
    check(
      '新密码登录后机构列表仍返回 200 并包含该机构（上面的拒绝不是服务整体不可用）',
      isPostSuccess(refreshed.status) && refreshedToken.length > 0
        && refreshedOrgs.status === 200 && refreshedRows.some((row) => row.id === orgId),
      `${describe(refreshed)} / ${describe(refreshedOrgs)}`,
    )
  } finally {
    if (app) await app.stop().catch(() => undefined)
    if (prisma) await prisma.onModuleDestroy().catch(() => undefined)
    database.cleanup()
    check(
      '临时数据库已删除',
      !existsSync(database.databasePath) && !existsSync(database.directory),
      database.databasePath,
    )
    if (inheritedBefore && inheritedDatabasePath && existsSync(inheritedDatabasePath)) {
      const inheritedAfter = statSync(inheritedDatabasePath)
      check(
        '没有写入调用方传来的数据库',
        inheritedBefore.size === inheritedAfter.size && inheritedBefore.mtimeMs === inheritedAfter.mtimeMs,
        inheritedDatabasePath,
      )
    }
    if (inspector) inspector.disconnect()
    if (redisServer) await redisServer.stop().catch(() => undefined)
  }

  finish(failures > 0 ? 1 : 0)
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error)
  process.exit(1)
})
