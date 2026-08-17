/**
 * verify:boot-resilience —— 启动韧性门禁
 *
 * 守的是这条真实故障：Redis 不可达时 API **静默挂起** ——
 * 85 条路由注册完、Prisma 连上，然后 `MemberPrivacyScheduler.onModuleInit()` 里的
 * `queue.upsertJobScheduler()` 永不 settle（BullMQ 给自建连接强制
 * `maxRetriesPerRequest: null`，ioredis 把命令无限排进 offline queue，
 * 既不报错也不超时），`app.listen()` 永远到不了。
 * 进程活着、端口是死的、日志里没有启动失败线索 —— 运维看到的是「进程健康」。
 *
 * 本门禁**实测**启动真实的 `src/main.ts` 子进程，不是读代码，共四组：
 *   A. 静态守卫：所有 onModuleInit / onApplicationBootstrap 的外部依赖等待必须有界
 *   B. Redis 不可达：必须监听端口 + 有可搜索错误行 + health 如实降级 + ready 503
 *   C. Redis 可达：一切照旧（无降级、health ok、ready 200）
 *   D. Redis 迟到恢复：降级状态必须能自己转回 ok（不是粘住的假结论）
 *
 * C / D 需要 PATH 上有 `redis-server`（与 verify:member-data-export-download 同一约定，
 * CI 两个 job 都装了）。缺失时本门禁**失败**，不静默跳过。
 */
import 'reflect-metadata'
import 'dotenv/config'
import assert from 'node:assert/strict'
import { spawn, type ChildProcess } from 'node:child_process'
import { connect, createServer } from 'node:net'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

// 本仓 services/api 无 "type": "module"，脚本经 @swc-node/register 以 CJS 运行，
// 因此用 __dirname 而不是 import.meta.url。
const API_ROOT = join(__dirname, '..')
const SRC_ROOT = join(API_ROOT, 'src')
const MAIN_ENTRY = join(SRC_ROOT, 'main.ts')

let failures = 0
let checks = 0

function check(name: string, ok: boolean, detail = ''): void {
  checks += 1
  if (ok) {
    console.log(`  ✅ ${name}`)
    return
  }
  failures += 1
  console.log(`  ❌ ${name}${detail ? ` — ${detail}` : ''}`)
}

// ── 工具 ─────────────────────────────────────────────────────────────────────

async function unusedLoopbackPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const port = address.port
  await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())))
  return port
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

async function listTsFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true })
  const out: string[] = []
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'generated' || entry.name === 'node_modules') continue
      out.push(...(await listTsFiles(full)))
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') && !entry.name.endsWith('.test.ts')) {
      out.push(full)
    }
  }
  return out
}

interface BootedApp {
  child: ChildProcess
  port: number
  output: () => string
  stop: () => Promise<void>
}

/** 启动真实入口 src/main.ts，等到它监听端口或超时。 */
async function bootApp(env: Record<string, string>, waitMs: number): Promise<BootedApp & { listening: boolean }> {
  const port = await unusedLoopbackPort()
  let buffer = ''
  const child = spawn(process.execPath, ['-r', '@swc-node/register', MAIN_ENTRY], {
    cwd: API_ROOT,
    env: {
      ...process.env,
      ...env,
      PORT: String(port),
      NODE_ENV: 'development',
      // 明确关掉测试出纸种子，避免门禁往共享库里写打印任务。
      ENABLE_TEST_PRINT_TASK_SEED: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.on('data', (chunk: Buffer) => { buffer += chunk.toString() })
  child.stderr?.on('data', (chunk: Buffer) => { buffer += chunk.toString() })

  const stop = async (): Promise<void> => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
      await new Promise<void>((resolve) => child.once('exit', () => resolve()))
    }
  }

  const deadline = Date.now() + waitMs
  let listening = false
  while (Date.now() < deadline) {
    if (buffer.includes('AI Job Print API running')) { listening = true; break }
    if (child.exitCode !== null) break
    await sleep(250)
  }
  return { child, port, listening, output: () => buffer, stop }
}

interface HealthProbe { status: number; body: unknown }

async function probe(port: number, path: string): Promise<HealthProbe> {
  const response = await fetch(`http://127.0.0.1:${port}/api/v1${path}`, { headers: { Accept: 'application/json' } })
  return { status: response.status, body: await response.json().catch(() => null) }
}

interface RedisRuntime { child: ChildProcess; dir: string; spawnError?: Error }

async function startRedisServer(port: number): Promise<RedisRuntime> {
  const dir = await mkdtemp(join(tmpdir(), 'boot-resilience-redis-'))
  const child = spawn('redis-server', [
    '--bind', '127.0.0.1',
    '--port', String(port),
    '--save', '',
    '--appendonly', 'no',
    '--dir', dir,
  ], { stdio: 'ignore' })
  const runtime: RedisRuntime = { child, dir }
  // PATH 上没有 redis-server 时 spawn 会异步抛 ENOENT；记下来，
  // 由调用方的 check 明确失败（不静默跳过），而不是把进程打挂。
  child.on('error', (error: Error) => { runtime.spawnError = error })
  return runtime
}

async function stopRedisServer(runtime: RedisRuntime): Promise<void> {
  if (!runtime.spawnError && runtime.child.exitCode === null && runtime.child.signalCode === null) {
    runtime.child.kill('SIGTERM')
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 5_000)
      runtime.child.once('exit', () => { clearTimeout(timer); resolve() })
    })
  }
  await rm(runtime.dir, { recursive: true, force: true })
}

async function waitForRedis(port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const reachable = await new Promise<boolean>((resolve) => {
      const socket = connect({ host: '127.0.0.1', port })
      socket.once('connect', () => { socket.destroy(); resolve(true) })
      socket.once('error', () => { socket.destroy(); resolve(false) })
    })
    if (reachable) return true
    await sleep(150)
  }
  return false
}

// ── A. 静态守卫：启动期钩子的外部依赖等待必须有界 ─────────────────────────────

/**
 * 允许不经 withBootTimeout 的启动期钩子，必须写明理由。
 * 新增 onModuleInit / onApplicationBootstrap 且等待外部资源时，
 * 要么包 withBootTimeout，要么在这里补一条经过论证的豁免。
 */
const BOUNDED_WAIT_EXEMPTIONS: Record<string, string> = {
  'terminals/terminals-agent.service.ts':
    'onModuleInit 只在 TERMINAL_SEED_TEST_PRINT_TASK 显式开启时写一次种子数据（数据库=硬依赖，已在 PrismaService.$connect 处有界），其余只挂 unref 定时器，不等待外部资源。',
}

async function verifyBoundedBootHooks(): Promise<void> {
  console.log('\n[A] 静态守卫：启动期钩子的外部依赖等待必须有界')
  const files = await listTsFiles(SRC_ROOT)
  const hookFiles: string[] = []
  for (const file of files) {
    const source = await readFile(file, 'utf8')
    if (/\basync\s+onModuleInit\s*\(|\basync\s+onApplicationBootstrap\s*\(/.test(source)) {
      hookFiles.push(file)
    }
  }
  check('至少发现一个启动期钩子（守卫本身没有失效）', hookFiles.length > 0, `发现 ${hookFiles.length} 个`)

  for (const file of hookFiles) {
    const rel = relative(SRC_ROOT, file).split('\\').join('/')
    const source = await readFile(file, 'utf8')
    const bounded = source.includes('withBootTimeout')
    const exemption = BOUNDED_WAIT_EXEMPTIONS[rel]
    check(
      `${rel} 的启动期等待有界`,
      bounded || Boolean(exemption),
      '既没走 withBootTimeout，也没有在 BOUNDED_WAIT_EXEMPTIONS 中登记豁免理由',
    )
    if (!bounded && exemption) console.log(`     ↳ 已登记豁免：${exemption}`)
  }

  // 注释与行为一致性：redis.module.ts 不得再声称「不会阻塞应用启动」而无任何兜底。
  const redisModule = await readFile(join(SRC_ROOT, 'common/redis/redis.module.ts'), 'utf8')
  check(
    'redis.module.ts 显式声明 degraded-start 启动语义',
    redisModule.includes('degraded-start'),
    '注释必须写清启动语义，且与实际行为一致',
  )
  check(
    'redis.module.ts 记录了 BullMQ maxRetriesPerRequest: null 这条真实成因',
    redisModule.includes('maxRetriesPerRequest: null'),
  )
}

// ── B. Redis 不可达：必须显式降级、绝不静默挂起 ───────────────────────────────

async function verifyUnreachableRedis(): Promise<void> {
  console.log('\n[B] Redis 不可达：进程必须监听端口并显式降级')
  const deadPort = await unusedLoopbackPort()
  const app = await bootApp({ REDIS_URL: `redis://127.0.0.1:${deadPort}` }, 90_000)
  try {
    check('Redis 不可达时仍完成启动并监听端口（不再静默挂起）', app.listening,
      `90s 内未出现 "AI Job Print API running"；进程 exitCode=${app.child.exitCode}`)
    if (!app.listening) return

    const log = app.output()
    check('日志含可搜索错误行 BOOT_DEPENDENCY_DEGRADED subsystem=redis',
      log.includes('BOOT_DEPENDENCY_DEGRADED subsystem=redis'))
    check('日志含可搜索错误行 BOOT_DEPENDENCY_DEGRADED subsystem=member-privacy-scheduler',
      log.includes('BOOT_DEPENDENCY_DEGRADED subsystem=member-privacy-scheduler'))
    check('日志给出排查方向（REDIS_URL / 进程 / 防火墙）', log.includes('REDIS_URL') && log.includes('防火墙'))
    check('降级结论同时写到启动摘要', log.includes('API 以降级状态启动'))
    check('日志不回显 REDIS_URL 凭证', !/redis:\/\/[^\s]*:[^\s]*@/.test(log))

    const health = await probe(app.port, '/health')
    const healthData = (health.body as { data?: { status?: string; degraded?: Array<{ subsystem?: string }> } })?.data
    check('GET /health 仍返回 200（Redis 降级不把一体机判成断网）', health.status === 200, `实际 ${health.status}`)
    check('GET /health 如实返回 status=degraded（不撒谎回 ok）', healthData?.status === 'degraded',
      `实际 ${String(healthData?.status)}`)
    const subsystems = (healthData?.degraded ?? []).map((s) => s.subsystem)
    check('GET /health 列出 redis 降级', subsystems.includes('redis'), JSON.stringify(subsystems))
    check('GET /health 列出隐私清理调度降级', subsystems.includes('member-privacy-scheduler'), JSON.stringify(subsystems))

    const ready = await probe(app.port, '/health/ready')
    const readyError = (ready.body as { error?: { code?: string; details?: string[] } })?.error
    check('GET /health/ready 返回 503', ready.status === 503, `实际 ${ready.status}`)
    check('readiness 错误码为 HEALTH_DEPENDENCY_DEGRADED', readyError?.code === 'HEALTH_DEPENDENCY_DEGRADED')
    check('readiness details 为非空字符串数组（不是被过滤成空的空壳）',
      Array.isArray(readyError?.details) && readyError.details.length > 0 &&
      readyError.details.every((d) => typeof d === 'string' && d.length > 0))

    check('进程仍存活（degraded-start 语义：不因软依赖退出）', app.child.exitCode === null)

    // 软依赖降级不得变成「延迟崩溃」：Redis 持续不可达时 BullMQ / ioredis 会不停
    // 重连并 emit error，必须确认没有哪个无监听者的 error 事件把进程打挂。
    await sleep(15_000)
    check('持续不可达 15s 后进程仍存活（降级不是延迟崩溃）', app.child.exitCode === null,
      `exitCode=${app.child.exitCode}`)
    const stillServing = await probe(app.port, '/health')
    check('持续不可达 15s 后仍能服务 /health', stillServing.status === 200, `实际 ${stillServing.status}`)
  } finally {
    await app.stop()
  }
}

// ── C. Redis 可达：一切照旧 ───────────────────────────────────────────────────

async function verifyReachableRedis(): Promise<void> {
  console.log('\n[C] Redis 可达：正常路径无回归')
  const redisPort = await unusedLoopbackPort()
  const redis = await startRedisServer(redisPort)
  const up = await waitForRedis(redisPort, 15_000)
  check('测试用 redis-server 已就绪（缺失请安装 redis-server；本门禁不静默跳过）', up,
    redis.spawnError ? `spawn 失败：${redis.spawnError.message}` : '端口未在 15s 内就绪')
  if (!up) { await stopRedisServer(redis); return }

  const app = await bootApp({ REDIS_URL: `redis://127.0.0.1:${redisPort}` }, 90_000)
  try {
    check('Redis 可达时正常启动并监听端口', app.listening, `进程 exitCode=${app.child.exitCode}`)
    if (!app.listening) return

    const log = app.output()
    check('正常路径无任何降级日志', !log.includes('BOOT_DEPENDENCY_DEGRADED'),
      log.split('\n').filter((l) => l.includes('BOOT_DEPENDENCY_DEGRADED')).join(' | '))
    check('正常路径记录 Redis 可达', log.includes('Redis 可达'))

    const health = await probe(app.port, '/health')
    const healthData = (health.body as { data?: { status?: string; degraded?: unknown[]; db?: string } })?.data
    check('GET /health 返回 200', health.status === 200, `实际 ${health.status}`)
    check('GET /health status=ok', healthData?.status === 'ok', `实际 ${String(healthData?.status)}`)
    check('GET /health degraded 为空数组', Array.isArray(healthData?.degraded) && healthData.degraded.length === 0)
    check('GET /health 仍返回 dbKind（原有契约不变）', typeof healthData?.db === 'string')

    const ready = await probe(app.port, '/health/ready')
    const readyData = (ready.body as { data?: { status?: string; subsystems?: Array<{ subsystem?: string; status?: string }> } })?.data
    check('GET /health/ready 返回 200', ready.status === 200, `实际 ${ready.status}`)
    check('readiness status=ready', readyData?.status === 'ready')
    const okSubsystems = (readyData?.subsystems ?? []).filter((s) => s.status === 'ok').map((s) => s.subsystem)
    check('readiness 列出 redis 为 ok', okSubsystems.includes('redis'), JSON.stringify(okSubsystems))
    check('readiness 列出隐私清理调度为 ok', okSubsystems.includes('member-privacy-scheduler'), JSON.stringify(okSubsystems))
  } finally {
    await app.stop()
    await stopRedisServer(redis)
  }
}

// ── D. 迟到恢复：降级结论不得粘住 ────────────────────────────────────────────

async function verifyLateRecovery(): Promise<void> {
  console.log('\n[D] Redis 迟到恢复：降级状态必须能转回 ok')
  const redisPort = await unusedLoopbackPort()
  // 先在 Redis 尚未启动的地址上把 API 拉起来 —— 复刻「Redis 比 API 晚起来」的部署现场。
  const app = await bootApp({ REDIS_URL: `redis://127.0.0.1:${redisPort}` }, 90_000)
  let redis: RedisRuntime | undefined
  try {
    check('Redis 未起时 API 先行启动成功', app.listening, `进程 exitCode=${app.child.exitCode}`)
    if (!app.listening) return
    const before = await probe(app.port, '/health')
    check('恢复前 health 为 degraded',
      (before.body as { data?: { status?: string } })?.data?.status === 'degraded')

    redis = await startRedisServer(redisPort)
    const up = await waitForRedis(redisPort, 15_000)
    check('测试用 redis-server 已就绪', up)
    if (!up) return

    // 两件事都要转回来：
    // 1. redis 探针（靠 ioredis 的 'ready' 事件）
    // 2. 隐私清理调度（靠 ioredis 把 offline queue 里那条 upsertJobScheduler 补发出去
    //    —— 已单独实测：maxRetriesPerRequest:null 的命令在连接恢复时会被自动 flush 并 settle）
    let redisRecovered = false
    let schedulerRecovered = false
    let last = ''
    const deadline = Date.now() + 60_000
    while (Date.now() < deadline) {
      const health = await probe(app.port, '/health')
      const data = (health.body as { data?: { status?: string; degraded?: Array<{ subsystem?: string }> } })?.data
      last = JSON.stringify(data?.degraded ?? [])
      const stillDegraded = (data?.degraded ?? []).map((s) => s.subsystem)
      redisRecovered = redisRecovered || !stillDegraded.includes('redis')
      schedulerRecovered = schedulerRecovered || !stillDegraded.includes('member-privacy-scheduler')
      if (redisRecovered && schedulerRecovered) break
      await sleep(1_000)
    }
    check('Redis 起来后 health 里的 redis 降级自动清除（结论不是粘住的）', redisRecovered, last)
    check('隐私清理调度在 Redis 恢复后自动补注册（与降级文案的承诺一致）', schedulerRecovered, last)
    check('日志出现恢复行 BOOT_DEPENDENCY_RECOVERED subsystem=redis',
      app.output().includes('BOOT_DEPENDENCY_RECOVERED subsystem=redis'))
    check('日志出现恢复行 BOOT_DEPENDENCY_RECOVERED subsystem=member-privacy-scheduler',
      app.output().includes('BOOT_DEPENDENCY_RECOVERED subsystem=member-privacy-scheduler'))

    const ready = await probe(app.port, '/health/ready')
    check('恢复后 readiness 转为 200', ready.status === 200, `实际 ${ready.status}`)
  } finally {
    await app.stop()
    if (redis) await stopRedisServer(redis)
  }
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('=== 启动韧性门禁 verify:boot-resilience ===')
  await verifyBoundedBootHooks()
  await verifyUnreachableRedis()
  await verifyReachableRedis()
  await verifyLateRecovery()

  console.log(`\n结果：${checks - failures}/${checks} 通过`)
  if (failures > 0) {
    console.error(`❌ ${failures} 项失败`)
    process.exit(1)
  }
  console.log('✅ 全部通过')
  process.exit(0)
}

void main()
