#!/usr/bin/env node
/**
 * 一体机 AI 简历交互走查：私有 Redis + 新 SQLite + 真 AppModule + 一体机 dev，跑完按进程停干净。
 *
 * 不读本机 .env，也不使用真实密钥。端口默认 API 3110、一体机 5373、Redis 6493。
 * 收尾断言 git status --porcelain 为空（被忽略的 test-results/ 不算）。
 */
import { spawn, spawnSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import net from 'node:net'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..')
const apiRoot = join(repoRoot, 'services/api')
const kioskRoot = join(repoRoot, 'apps/kiosk')
const apiPort = Number(process.env.INTERACTION_API_PORT ?? 3110)
const kioskPort = Number(process.env.INTERACTION_KIOSK_PORT ?? 5373)
const redisPort = Number(process.env.INTERACTION_REDIS_PORT ?? 6493)
const pepper = 'dev-secret-encryption-key-replace-in-prod-min-32-chars'

const children = []
let runDir = ''

function playwrightArgs() {
  const forward = []
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--grep' && argv[i + 1]) {
      forward.push('--grep', argv[i + 1])
      i += 1
    }
  }
  return [
    'tests/interaction/ai-resume-journey.spec.ts',
    '--config',
    'playwright.interaction.config.ts',
    ...forward,
  ]
}

function keepEnvKey(key) {
  return ['PATH', 'HOME', 'USER', 'LOGNAME', 'SHELL', 'LANG', 'LC_ALL', 'TMPDIR', 'TMP', 'TEMP', 'PWD', 'CI', 'TERM', 'NODE_PATH', 'PLAYWRIGHT_BROWSERS_PATH'].includes(key)
}

function scrubbedEnv(extra) {
  const env = { ...process.env }
  for (const key of Object.keys(env)) {
    if (keepEnvKey(key)) continue
    if (/SECRET|PASSWORD|TOKEN|CREDENTIAL|DATABASE_URL|REDIS_URL|POSTGRES|COS_|OSS_|AWS_|ALIYUN|TENCENT_|BAIDU_|API_KEY|_KEY$/.test(key)) {
      delete env[key]
    }
  }
  return { ...env, ...extra }
}

function portFree(port) {
  return new Promise((resolveFree) => {
    const server = net.createServer()
    server.once('error', () => resolveFree(false))
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolveFree(true))
    })
  })
}

function track(child, kind) {
  child.journeyKind = kind
  children.push(child)
  return child
}

async function stopOwned() {
  for (const child of [...children].reverse()) {
    if (child.exitCode !== null || child.signalCode !== null || !child.pid) continue
    try { process.kill(-child.pid, 'SIGTERM') } catch { /* already gone */ }
  }
  const deadline = Date.now() + 8_000
  while (Date.now() < deadline && children.some((child) => child.exitCode === null && child.signalCode === null)) {
    await delay(200)
  }
  for (const child of children) {
    if (child.exitCode === null && child.signalCode === null && child.pid) {
      try { process.kill(-child.pid, 'SIGKILL') } catch { /* already gone */ }
    }
  }
}

function ensureCjkFont() {
  if (process.platform !== 'linux') return
  const font = '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc'
  if (existsSync(font)) return
  const installed = spawnSync('sudo', ['apt-get', 'install', '-y', '-q', 'fonts-wqy-microhei'], { stdio: 'inherit' })
  if (installed.status !== 0 || !existsSync(font)) {
    throw new Error('Linux 上没有中文字体，安装 fonts-wqy-microhei 失败')
  }
}

class StartupFailed extends Error {}

async function waitFor(label, probe, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let last = ''
  while (Date.now() < deadline) {
    try {
      if (await probe()) return
    } catch (error) {
      if (error instanceof StartupFailed) throw error
      last = error instanceof Error ? error.message : String(error)
    }
    await delay(300)
  }
  throw new Error(`${label} 未在 ${timeoutMs}ms 内就绪${last ? `：${last}` : ''}`)
}

function assertAlive(child, log) {
  if (child.exitCode === null && child.signalCode === null) return
  throw new StartupFailed(log.slice(-4000) || `${child.journeyKind ?? '进程'} 已退出`)
}

async function main() {
  for (const [name, port] of [['API', apiPort], ['一体机', kioskPort], ['Redis', redisPort]]) {
    if (!(await portFree(port))) throw new Error(`${name} 端口 ${port} 已被占用，本脚本不结束别人的进程`)
  }
  ensureCjkFont()
  runDir = join(tmpdir(), `kiosk-interaction-${Date.now()}`)
  mkdirSync(runDir, { recursive: true })
  const dbPath = join(runDir, 'journey.db')
  const storageDir = join(runDir, 'storage')
  const redisDir = join(runDir, 'redis')
  mkdirSync(storageDir, { recursive: true })
  mkdirSync(redisDir, { recursive: true })
  const emptyEnv = join(runDir, 'empty.env')
  writeFileSync(emptyEnv, '')
  const apiLog = join(runDir, 'api.log')
  const evidenceDir = join(repoRoot, 'test-results/kiosk-interaction/evidence/ai-resume')
  mkdirSync(evidenceDir, { recursive: true })

  const redis = track(spawn('redis-server', [
    '--bind', '127.0.0.1',
    '--port', String(redisPort),
    '--dir', redisDir,
    '--dbfilename', 'dump.rdb',
    '--daemonize', 'no',
    '--save', '',
    '--appendonly', 'no',
    '--protected-mode', 'yes',
  ], { detached: true, stdio: ['ignore', 'pipe', 'pipe'] }), 'redis')
  let redisLog = ''
  redis.stdout.on('data', (chunk) => { redisLog = `${redisLog}${chunk}`.slice(-4000) })
  redis.stderr.on('data', (chunk) => { redisLog = `${redisLog}${chunk}`.slice(-4000) })
  await waitFor('Redis', async () => {
    assertAlive(redis, redisLog)
    return /Ready to accept connections/.test(redisLog)
  }, 15_000)

  const apiRequire = createRequire(join(apiRoot, 'package.json'))
  const prismaCli = apiRequire.resolve('prisma/build/index.js')
  const swcRegister = apiRequire.resolve('@swc-node/register')
  const databaseUrl = `file:${dbPath}`
  const apiEnv = scrubbedEnv({
    NODE_ENV: 'test',
    DOTENV_CONFIG_PATH: emptyEnv,
    DATABASE_URL: databaseUrl,
    PORT: String(apiPort),
    REDIS_URL: `redis://127.0.0.1:${redisPort}`,
    AI_PROVIDER: 'mock',
    SMS_PROVIDER: 'log',
    OCR_PROVIDER: 'disabled',
    ASR_PROVIDER: 'disabled',
    AI_IMAGE_PROVIDER: 'disabled',
    CONVERSION_ENGINE: 'disabled',
    AI_LOGIN_GATE: 'off',
    AI_DECLARATION_ENFORCEMENT: 'off',
    AI_PAUSED: 'off',
    PAYMENT_PROVIDER: 'sandbox',
    FILE_STORAGE_DRIVER: 'local',
    FILE_STORAGE_DIR: storageDir,
    JWT_SECRET: 'dev-only-secret-please-replace-in-prod-min-16-chars',
    FILE_SIGNING_SECRET: 'dev-file-signing-secret-replace-in-prod-must-be-min-32-chars',
    SECRET_ENCRYPTION_KEY: pepper,
    PAYMENT_SESSION_SECRET: 'dev-payment-session-secret-replace-in-prod-min-32-chars',
    SANDBOX_PAYMENT_SECRET: 'dev-sandbox-payment-secret-replace-me',
    TERMINAL_ADMIN_SECRET: 'ci-only-terminal-admin-secret',
    TERMINAL_ACTION_TOKEN_SECRET: 'ci-only-terminal-action-secret',
    TERMINAL_LEGACY_REGISTER_ENABLED: 'true',
    RECRUITMENT_CONTENT_HOSTING_ENABLED: 'false',
  })
  const generated = spawnSync(process.execPath, [prismaCli, 'generate'], {
    cwd: apiRoot,
    env: apiEnv,
    encoding: 'utf8',
  })
  if (generated.status !== 0) {
    throw new Error(`prisma generate 失败\n${generated.stdout ?? ''}\n${generated.stderr ?? ''}`)
  }
  const pushed = spawnSync(process.execPath, [prismaCli, 'db', 'push', '--accept-data-loss', '--url', databaseUrl], {
    cwd: apiRoot,
    env: apiEnv,
    encoding: 'utf8',
  })
  if (pushed.status !== 0) {
    throw new Error(`prisma db push 失败\n${pushed.stdout ?? ''}\n${pushed.stderr ?? ''}`)
  }

  const api = track(spawn(process.execPath, ['-r', swcRegister, 'src/main.ts'], {
    cwd: apiRoot,
    env: apiEnv,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  }), 'api')
  const apiStream = createWriteStream(apiLog)
  let apiTail = ''
  const capture = (chunk) => {
    apiStream.write(chunk)
    apiTail = `${apiTail}${chunk}`.slice(-8000)
  }
  api.stdout.on('data', capture)
  api.stderr.on('data', capture)
  const apiOrigin = `http://127.0.0.1:${apiPort}`
  await waitFor('API', async () => {
    assertAlive(api, apiTail)
    const response = await fetch(`${apiOrigin}/api/v1/health`, { signal: AbortSignal.timeout(1500) })
    if (!response.ok) throw new Error(`health ${response.status}`)
    return true
  }, 90_000)

  const kioskRequire = createRequire(join(kioskRoot, 'package.json'))
  const viteBin = join(dirname(kioskRequire.resolve('vite/package.json')), 'bin/vite.js')
  const kioskOrigin = `http://127.0.0.1:${kioskPort}`
  const kiosk = track(spawn(process.execPath, [viteBin, '--host', '127.0.0.1', '--port', String(kioskPort), '--strictPort'], {
    cwd: kioskRoot,
    env: scrubbedEnv({
      NODE_ENV: 'development',
      VITE_API_MODE: 'http',
      VITE_API_BASE_URL: `${apiOrigin}/api/v1`,
      VITE_API_PROXY_TARGET: apiOrigin,
    }),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  }), 'kiosk')
  let kioskLog = ''
  kiosk.stdout.on('data', (chunk) => { kioskLog = `${kioskLog}${chunk}`.slice(-4000) })
  kiosk.stderr.on('data', (chunk) => { kioskLog = `${kioskLog}${chunk}`.slice(-4000) })
  await waitFor('一体机', async () => {
    assertAlive(kiosk, kioskLog)
    const response = await fetch(kioskOrigin, { signal: AbortSignal.timeout(1500) })
    return response.ok
  }, 60_000)

  const playwrightCli = join(dirname(kioskRequire.resolve('@playwright/test/package.json')), 'cli.js')
  // 必须异步起 Playwright：spawnSync 会堵住事件循环，API / Redis 的日志管道写满后请求会挂死。
  const testCode = await new Promise((resolveCode) => {
    const test = spawn(process.execPath, [playwrightCli, 'test', ...playwrightArgs()], {
      cwd: kioskRoot,
      env: scrubbedEnv({
        NODE_ENV: 'test',
        INTERACTION_KIOSK_ORIGIN: kioskOrigin,
        INTERACTION_API_ORIGIN: apiOrigin,
        INTERACTION_EVIDENCE_DIR: evidenceDir,
        INTERACTION_REDIS_URL: `redis://127.0.0.1:${redisPort}`,
        INTERACTION_SMS_PEPPER: pepper,
        SWEEP_API_LOG: apiLog,
        SWEEP_PDF: join(runDir, 'valid-2p.pdf'),
      }),
      stdio: 'inherit',
    })
    test.on('error', () => resolveCode(1))
    test.on('exit', (code) => resolveCode(code === null ? 1 : code))
  })
  return testCode
}

let testCode = 1
try {
  testCode = await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  testCode = 1
} finally {
  await stopOwned()
}

let dirty = ''
try {
  dirty = spawnSync('git', ['status', '--porcelain'], { cwd: repoRoot, encoding: 'utf8' }).stdout ?? ''
} catch (error) {
  dirty = error instanceof Error ? error.message : String(error)
}
if (dirty.trim()) {
  console.error(`跑完后工作区不干净（被跟踪文件或未忽略的新文件）：\n${dirty}`)
  process.exitCode = 1
} else if (testCode !== 0) {
  process.exitCode = testCode
}
