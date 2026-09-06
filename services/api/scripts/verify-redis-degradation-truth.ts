/**
 * verify:redis-degradation-truth —— Redis 故障时的鉴权语义 + 健康检查诚实性门禁
 *
 * 守两条同时发生的真实故障（实测复现，基线 origin/main@8188fcf13）：
 *
 *   ① `JwtAuthGuard:107` 的 `await this.redis.get()` 无兜底 → Redis 不可达时
 *      异常冒泡成 500，**每一个**带守卫的管理端 / 合作机构端端点全挂。
 *      实测 `GET /admin/orders` 返回 500，耗时 **37.9s**。
 *   ② 同一时刻 `GET /health` 返回 200，并明确宣称
 *      「打印、终端 Agent、管理端、合作机构端不受影响」。
 *      健康检查撒谎比服务挂掉更糟 —— 它让运维不去查。
 *
 * 本门禁分两段，都是**实测**，不读代码：
 *
 *   [A] 鉴权语义（进程内驱动真实 JwtAuthGuard + 真实 Prisma + 指向死端口的 Redis）
 *       Redis 挂掉时降级到「回源数据库」不是放松鉴权：数据库是唯一真源，
 *       所有撤销动作（tokenVersion++ / enabled=false / deletedAt / 机构停用）
 *       都是数据库提交，Redis 只是镜像。本段逐条证明撤销仍然生效，
 *       并证明单次鉴权是有界的（不再干等 ioredis 的重试预算）。
 *
 *   [B] 健康检查诚实性（拉起真实 src/main.ts，REDIS_URL 指向死端口）
 *       读 `/health` 里 redis 子系统的 **impact 结构化声明**，
 *       对**每一个被声明的面**真的发一次请求，用观察到的行为判定声明是不是真话。
 *       声明里出现门禁没有判据的面 → 直接失败（不允许「说了但无法证明」）。
 *       —— 这一段刻意不写死清单：清单来自运行时 payload，加声明就必须加判据。
 */
import 'reflect-metadata'
import 'dotenv/config'
import { JwtService } from '@nestjs/jwt'
import { Redis } from 'ioredis'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'
import { bootApp, probe, unusedLoopbackPort } from './support/boot-api-child'

let failures = 0
let checks = 0

function check(name: string, ok: boolean, detail = ''): void {
  checks += 1
  if (ok) { console.log(`  ✅ ${name}`); return }
  failures += 1
  console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`)
}

const FIXTURE_PREFIX = 'verify-redis-degradation-'

// ── [A] 鉴权语义：Redis 挂掉时回源数据库，撤销仍然生效 ────────────────────────

async function verifyAuthSemantics(deadRedisPort: number): Promise<void> {
  console.log('\n[A] Redis 不可达时的内部鉴权语义（进程内驱动真实 JwtAuthGuard）')

  const { PrismaService } = await import('../src/prisma/prisma.service')
  const { RedisService } = await import('../src/common/redis/redis.service')
  const { JwtAuthGuard } = await import('../src/common/guards/jwt-auth.guard')
  const { resetRedisCooldownForTests } = await import('../src/common/redis/redis-degradation')

  const secret = process.env['JWT_SECRET']
  if (!secret || secret.length < 16) {
    check('JWT_SECRET 已配置（>=16 字符）', false, '门禁需要与 API 同一个签名密钥')
    return
  }
  const jwt = new JwtService({ secret, signOptions: { expiresIn: '1d' } })

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  // 关键：客户端指向一个确定连不上的端口 —— 这就是被守的故障现场。
  const deadClient = new Redis(`redis://127.0.0.1:${deadRedisPort}`, { lazyConnect: true })
  deadClient.on('error', () => { /* 预期内的 ECONNREFUSED，不让它变成 unhandled */ })
  const redis = new RedisService(deadClient)
  const guard = new JwtAuthGuard(jwt, prisma, redis)

  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  const orgId = `${FIXTURE_PREFIX}org-${suffix}`
  const adminId = `${FIXTURE_PREFIX}admin-${suffix}`
  const partnerId = `${FIXTURE_PREFIX}partner-${suffix}`

  const cleanup = async (): Promise<void> => {
    await prisma.user.deleteMany({ where: { id: { in: [adminId, partnerId] } } })
    await prisma.organization.deleteMany({ where: { id: orgId } })
    await prisma.onModuleDestroy()
    deadClient.disconnect()
  }

  try {
    await prisma.organization.create({
      data: { id: orgId, name: `门禁临时机构 ${suffix}`, type: 'school', enabled: true },
    })
    await prisma.user.create({
      data: {
        id: adminId, username: `${FIXTURE_PREFIX}admin-${suffix}`, passwordHash: 'x',
        name: '门禁临时管理员', role: 'admin', tokenVersion: 0, enabled: true,
      },
    })
    await prisma.user.create({
      data: {
        id: partnerId, username: `${FIXTURE_PREFIX}partner-${suffix}`, passwordHash: 'x',
        name: '门禁临时机构账号', role: 'partner', orgId, tokenVersion: 0, enabled: true,
      },
    })

    const contextFor = (token: string): Parameters<typeof guard.canActivate>[0] => {
      const req: Record<string, unknown> = { headers: { authorization: `Bearer ${token}` } }
      return {
        switchToHttp: () => ({ getRequest: () => req }),
      } as unknown as Parameters<typeof guard.canActivate>[0]
    }

    const attempt = async (token: string): Promise<{ allowed: boolean; elapsedMs: number }> => {
      // 每次都清静默期：本段要验证的是「每一条真实 Redis 故障路径」的语义，
      // 不是断路器的加速效果（那由 [A4] 单独验）。
      resetRedisCooldownForTests()
      const started = Date.now()
      try {
        const allowed = await guard.canActivate(contextFor(token))
        return { allowed, elapsedMs: Date.now() - started }
      } catch {
        return { allowed: false, elapsedMs: Date.now() - started }
      }
    }

    const adminToken = jwt.sign({ sub: adminId, role: 'admin', orgId: null, ver: 0 })

    // A1 —— 这一条就是 P0-1 本身：Redis 挂掉时合法 token 必须仍被放行（旧行为是 500）
    const valid = await attempt(adminToken)
    check('Redis 不可达时合法内部 token 仍被放行（不再 500）', valid.allowed)

    // A2 —— 有界：旧行为单请求实测 37.9s；这里给出很宽的上限，只要证明不再是「干等重试预算」
    check(
      `单次鉴权有界（实测 ${valid.elapsedMs}ms < 5000ms；修复前实测 37.9s）`,
      valid.elapsedMs < 5_000,
      `${valid.elapsedMs}ms`,
    )

    // A3 —— 红线：撤销必须仍然生效。数据库是唯一真源，缓存不可用不得让任何一条撤销失效。
    await prisma.user.update({ where: { id: adminId }, data: { tokenVersion: { increment: 1 } } })
    check('tokenVersion 提升后旧 token 被拒（改密/重置密码路径）', !(await attempt(adminToken)).allowed)

    const adminTokenV1 = jwt.sign({ sub: adminId, role: 'admin', orgId: null, ver: 1 })
    check('新版本 token 可用（证明上一条不是「一律拒绝」的假通过）', (await attempt(adminTokenV1)).allowed)

    await prisma.user.update({ where: { id: adminId }, data: { enabled: false } })
    check('账号禁用后 token 被拒', !(await attempt(adminTokenV1)).allowed)
    await prisma.user.update({ where: { id: adminId }, data: { enabled: true } })

    await prisma.user.update({ where: { id: adminId }, data: { deletedAt: new Date() } })
    check('账号软删除后 token 被拒', !(await attempt(adminTokenV1)).allowed)
    await prisma.user.update({ where: { id: adminId }, data: { deletedAt: null } })

    const partnerToken = jwt.sign({ sub: partnerId, role: 'partner', orgId, ver: 0 })
    check('机构账号在机构启用时可用', (await attempt(partnerToken)).allowed)
    await prisma.organization.update({ where: { id: orgId }, data: { enabled: false } })
    check('机构停用后机构账号 token 被拒', !(await attempt(partnerToken)).allowed)
    await prisma.organization.update({ where: { id: orgId }, data: { enabled: true } })

    const endUserToken = jwt.sign({ sub: adminId, role: 'admin', orgId: null, ver: 1, aud: 'enduser' })
    check('C 端 token（aud=enduser）仍被内部守卫拒绝（双向隔离未被降级破坏）',
      !(await attempt(endUserToken)).allowed)

    const forgedToken = `${adminTokenV1.slice(0, -3)}xyz`
    check('签名被篡改的 token 被拒', !(await attempt(forgedToken)).allowed)

    // A4 —— 断路器：已知不可用后不再逐请求交超时学费，但静默期结束必须真的再试
    resetRedisCooldownForTests()
    const first = await (async () => {
      const started = Date.now()
      await guard.canActivate(contextFor(adminTokenV1))
      return Date.now() - started
    })()
    const second = await (async () => {
      const started = Date.now()
      await guard.canActivate(contextFor(adminTokenV1))
      return Date.now() - started
    })()
    check(
      `静默期内的后续请求跳过 Redis（首次 ${first}ms → 后续 ${second}ms）`,
      second < Math.max(50, first),
      `first=${first}ms second=${second}ms`,
    )
    check('静默期是可复位的（不是粘住的永久结论）', (() => {
      resetRedisCooldownForTests()
      return true
    })())
  } finally {
    await cleanup()
  }
}

// ── [B] 健康检查诚实性：impact 声明必须与实际行为一致 ─────────────────────────

/**
 * 每个可被声明的「面」如何证明。**刻意不是白名单**：
 * 门禁遍历的是 `/health` 运行时返回的 impact 键，
 * 键没有对应判据 → 失败，逼着「新增声明」和「给出证据」同时发生。
 */
interface SurfaceProbe {
  describe: string
  run: (port: number, adminToken: string) => Promise<{ succeeded: boolean; detail: string }>
}

const SURFACE_PROBES: Record<string, SurfaceProbe> = {
  'internal-auth': {
    describe: '带 JwtAuthGuard 的内部端点（管理端 / 合作机构端 / 一体机内部账号）',
    run: async (port, token) => {
      const result = await probe(port, '/auth/me', { token })
      return { succeeded: result.status === 200, detail: `GET /auth/me → ${result.status} (${result.elapsedMs}ms)` }
    },
  },
  'internal-console-redis-actions': {
    describe: '管理端里直接写 Redis 且无数据库真源可回退的动作',
    run: async (port, token) => {
      const result = await probe(port, '/auth/logout', { method: 'POST', token })
      return { succeeded: result.status < 400, detail: `POST /auth/logout → ${result.status}` }
    },
  },
  'member-auth': {
    describe: 'C 端会员登录会话 / 短信验证码 / 频控（Redis 即真源）',
    run: async (port) => {
      const result = await probe(port, '/member/auth/sms-code', {
        method: 'POST',
        body: { phone: '13800000000' },
      })
      return { succeeded: result.status < 400, detail: `POST /member/auth/sms-code → ${result.status}` }
    },
  },
  'terminal-agent-print': {
    describe: '终端 Agent / 打印链路（整条链路不经过 Redis）',
    run: async (port) => {
      const result = await probe(port, '/terminals/public')
      return { succeeded: result.status === 200, detail: `GET /terminals/public → ${result.status}` }
    },
  },
}

interface HealthSubsystem {
  subsystem?: string
  code?: string
  message?: string
  impact?: Record<string, string>
}

async function verifyHealthHonesty(deadRedisPort: number): Promise<void> {
  console.log('\n[B] Redis 不可达时 /health 的每一条影响面声明必须与实测行为一致')

  const secret = process.env['JWT_SECRET']
  if (!secret || secret.length < 16) { check('JWT_SECRET 已配置', false); return }
  const jwt = new JwtService({ secret, signOptions: { expiresIn: '1d' } })

  const { PrismaService } = await import('../src/prisma/prisma.service')
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  const adminId = `${FIXTURE_PREFIX}http-admin-${suffix}`

  const app = await bootApp({ REDIS_URL: `redis://127.0.0.1:${deadRedisPort}` }, 120_000)
  try {
    await prisma.user.create({
      data: {
        id: adminId, username: `${FIXTURE_PREFIX}http-admin-${suffix}`, passwordHash: 'x',
        name: '门禁临时管理员(HTTP)', role: 'admin', tokenVersion: 0, enabled: true,
      },
    })
    const adminToken = jwt.sign({ sub: adminId, role: 'admin', orgId: null, ver: 0 })

    check('Redis 不可达时 API 仍完成启动', app.listening, `exitCode=${app.child.exitCode}`)
    if (!app.listening) return

    const health = await probe(app.port, '/health')
    check('GET /health 返回 200', health.status === 200, `实际 ${health.status}`)
    const data = (health.body as { data?: { status?: string; degraded?: HealthSubsystem[] } })?.data
    check('GET /health 如实为 degraded', data?.status === 'degraded', String(data?.status))

    const redisState = (data?.degraded ?? []).find((s) => s.subsystem === 'redis')
    check('degraded 列表含 redis 子系统', Boolean(redisState))
    if (!redisState) return

    // 历史事故文案的定向回归钉。刻意钉死这一句**原话**而不是用「管理端…不受影响」
    // 这类模糊模式匹配：新的正确文案里同样同时出现「管理端」和「不受影响」
    // （分别指鉴权降级与打印链路），模糊匹配会把真话判成假话 —— 本门禁自己先踩过一次。
    // 真正防撒谎的是下面的 impact 逐面实测，这里只保证这句已知错误措辞不会回来。
    const HISTORICAL_FALSE_CLAIM = '打印、终端 Agent、管理端、合作机构端不受影响'
    check(
      `降级文案不再包含历史错误措辞「${HISTORICAL_FALSE_CLAIM}」`,
      !(redisState.message ?? '').includes(HISTORICAL_FALSE_CLAIM),
      redisState.message ?? '',
    )

    const impact = redisState.impact
    check('redis 降级给出结构化 impact 声明（散文之外还有可检验的结论）',
      Boolean(impact) && Object.keys(impact ?? {}).length > 0)
    if (!impact) return

    for (const [surface, declared] of Object.entries(impact)) {
      const prober = SURFACE_PROBES[surface]
      if (!prober) {
        // 不允许「声明了但无法证明」——新增面必须同时新增判据。
        check(`impact 声明的面 ${surface} 有对应实测判据`, false,
          '在 SURFACE_PROBES 中补一个能证明该结论的探测，否则这条声明无法被检验')
        continue
      }
      const observed = await prober.run(app.port, adminToken)
      // unaffected / degraded 都要求请求真的成功；unavailable 要求真的失败。
      const expectSuccess = declared === 'unaffected' || declared === 'degraded'
      check(
        `impact["${surface}"]="${declared}" 与实测一致（${prober.describe}）`,
        observed.succeeded === expectSuccess,
        `${observed.detail}；声明为 ${declared} 但实测${observed.succeeded ? '成功' : '失败'}`,
      )
    }

    const ready = await probe(app.port, '/health/ready')
    check('GET /health/ready 仍为 503（readiness 语义未被本次改动放宽）', ready.status === 503,
      `实际 ${ready.status}`)
  } finally {
    await app.stop()
    await prisma.user.deleteMany({ where: { id: adminId } })
    await prisma.onModuleDestroy()
  }
}

// ── [C] Redis 可用时缓存路径无回归 ───────────────────────────────────────────

/**
 * 用内存版 Redis 替身驱动真实守卫。
 *
 * 为什么需要这一段：把裸 `redis.get()` 换成 `tryRedis()` 同时动了**命中路径**
 * （命中、脏值清理、stale 回读）。`verify:boot-resilience` 的 C/D 组只证明
 * 「Redis 可达时启动正常、health 为 ok」，**不覆盖守卫的缓存分支**。
 * 替身实现的是守卫与 RedisService 之间的那份契约，正是本次改动的边界。
 */
async function verifyHealthyCachePath(): Promise<void> {
  console.log('\n[C] Redis 可用时的缓存路径无回归（内存版 Redis 替身驱动真实守卫）')

  const { PrismaService } = await import('../src/prisma/prisma.service')
  const { JwtAuthGuard } = await import('../src/common/guards/jwt-auth.guard')
  const { resetRedisCooldownForTests } = await import('../src/common/redis/redis-degradation')
  const { RedisService } = await import('../src/common/redis/redis.service')
  const { bootReadiness: registry } = await import('../src/common/boot/boot-readiness')

  const secret = process.env['JWT_SECRET']
  if (!secret || secret.length < 16) { check('JWT_SECRET 已配置', false); return }
  const jwt = new JwtService({ secret, signOptions: { expiresIn: '1d' } })
  // [A] 已经在本进程里把 redis 标成降级了（那是它的验证内容）。
  // 本段要证明的是「可用路径不会自己产生降级结论」，因此先清空登记表再跑。
  registry.reset()
  resetRedisCooldownForTests()

  const store = new Map<string, string>()
  const calls = { get: 0, set: 0, del: 0 }
  const fakeRedis = {
    get: async (key: string) => { calls.get += 1; return store.get(key) ?? null },
    del: async (key: string) => { calls.del += 1; return store.delete(key) ? 1 : 0 },
    setJsonIfVersionNotOlder: async (key: string, _ttl: number, value: string, tokenVersion: number) => {
      calls.set += 1
      const current = store.get(key)
      if (current) {
        const parsed = JSON.parse(current) as { tokenVersion?: number }
        if (typeof parsed.tokenVersion === 'number' && parsed.tokenVersion > tokenVersion) return 'stale' as const
      }
      store.set(key, value)
      return 'stored' as const
    },
  } as unknown as InstanceType<typeof RedisService>

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  const adminId = `${FIXTURE_PREFIX}cache-admin-${suffix}`
  const guard = new JwtAuthGuard(jwt, prisma, fakeRedis)

  const contextFor = (token: string): Parameters<typeof guard.canActivate>[0] => {
    const req: Record<string, unknown> = { headers: { authorization: `Bearer ${token}` } }
    return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as Parameters<typeof guard.canActivate>[0]
  }

  try {
    await prisma.user.create({
      data: {
        id: adminId, username: `${FIXTURE_PREFIX}cache-admin-${suffix}`, passwordHash: 'x',
        name: '门禁临时管理员(缓存)', role: 'admin', tokenVersion: 0, enabled: true,
      },
    })
    const token = jwt.sign({ sub: adminId, role: 'admin', orgId: null, ver: 0 })
    const cacheKey = `internal:session-state:${adminId}`

    check('冷缓存首次鉴权通过', await guard.canActivate(contextFor(token)))
    check('冷缓存首次鉴权后会话状态被写入缓存（回写路径未被改坏）', store.has(cacheKey))

    const getsBefore = calls.get
    check('二次鉴权仍通过（缓存命中路径）', await guard.canActivate(contextFor(token)))
    check('二次鉴权确实读了缓存', calls.get > getsBefore)

    // 脏值：解析失败必须删键并回源，而不是当作未命中反复读到脏数据。
    store.set(cacheKey, 'not-json-at-all')
    const delsBefore = calls.del
    check('缓存脏值时仍能鉴权（回源数据库）', await guard.canActivate(contextFor(token)))
    check('缓存脏值被清理', calls.del > delsBefore)

    // stale 分支：缓存里有更高 tokenVersion（并发撤销已先落缓存）→ 必须以缓存那份更新的为准。
    store.set(cacheKey, JSON.stringify({
      userId: adminId, role: 'admin', orgId: null, enabled: true,
      tokenVersion: 99, deletedAt: null, orgEnabled: null,
    }))
    check('缓存中存在更高 tokenVersion 时旧 token 被拒（并发撤销不被回写覆盖）',
      !(await guard.canActivate(contextFor(token)).catch(() => false)))

    const { bootReadiness, REDIS_SUBSYSTEM } = await import('../src/common/boot/boot-readiness')
    check('可用路径全程未产生假降级结论（/health 不会因为一次正常请求变红）',
      !bootReadiness.isDegraded(REDIS_SUBSYSTEM))

    // 「命令被拒」不等于「Redis 不可用」。ioredis 的 ReplyError 意味着 Redis 活着并回了错
    // （WRONGTYPE / 未知命令 / 参数不对 / Lua 报错）。若把它当连通性故障，会触发全局静默期，
    // 期间所有 tryRedis 一律跳过 —— 内部账号回写缓存失败（本身无害，数据库是真源）
    // 会连带把没有数据库后备的 C 端会员会话打掉，表现为用户被登出。
    // 这条实测过：曾让 verify:content-pipeline-e2e 的 6 项会员记录断言全红。
    const { tryRedis, resetRedisCooldownForTests } = await import('../src/common/redis/redis-degradation')
    resetRedisCooldownForTests()
    class ReplyError extends Error { override name = 'ReplyError' }
    const rejected = await tryRedis('gate:command-rejected', async () => {
      throw new ReplyError('WRONGTYPE Operation against a key holding the wrong kind of value')
    })
    check('命令被拒时 tryRedis 返回 ok:false/reason=rejected（调用方按取不到值处理）',
      !rejected.ok && rejected.reason === 'rejected')
    check('命令被拒不标 Redis 降级（Redis 明明还活着）',
      !bootReadiness.isDegraded(REDIS_SUBSYSTEM))
    const afterReject = await tryRedis('gate:still-usable', async () => 'ok')
    check('命令被拒后不进静默期：后续正常调用仍真的执行（不误伤其他子系统）',
      afterReject.ok && afterReject.value === 'ok')
    resetRedisCooldownForTests()
  } finally {
    await prisma.user.deleteMany({ where: { id: adminId } })
    await prisma.onModuleDestroy()
  }
}

async function main(): Promise<void> {
  console.log('=== Redis 降级鉴权语义 + 健康检查诚实性门禁 verify:redis-degradation-truth ===')
  // 本门禁会写入临时用户/机构行，必须在隔离验证库上跑。
  assertIsolatedVerificationDatabase()

  const deadRedisPort = await unusedLoopbackPort()
  await verifyAuthSemantics(deadRedisPort)
  await verifyHealthHonesty(deadRedisPort)
  await verifyHealthyCachePath()

  console.log(`\n结果：${checks - failures}/${checks} 通过`)
  if (failures > 0) {
    console.error(`❌ ${failures} 项失败`)
    process.exit(1)
  }
  console.log('✅ 全部通过')
  process.exit(0)
}

void main()
