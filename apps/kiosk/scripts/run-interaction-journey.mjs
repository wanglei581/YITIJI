#!/usr/bin/env node
/**
 * 一体机 AI 简历交互走查：私有 Redis + 新 SQLite + 真 AppModule + 一体机 dev，跑完按进程停干净。
 *
 * 子进程只用环境白名单，Vite 的 envDir 指到临时空目录，不读本机环境文件。
 * 端口可由 INTERACTION_REDIS_PORT、INTERACTION_API_PORT、INTERACTION_VITE_PORT 覆盖。
 * 默认 Redis 6495、API 3112、Vite 5375。被占用就直接失败，不连接别人的服务。
 * 正常和异常结束都删临时目录；测试失败或清洁检查失败时，先把 API 日志拷进 test-results/kiosk-interaction/。
 * git status 看退出码，命令失败或工作区不干净都算失败。
 */
import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, createWriteStream, existsSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
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
function portFrom(name, fallback) {
  const raw = process.env[name]
  if (raw === undefined || raw === '') return fallback
  const port = Number(raw)
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${name}=${raw} 不是可用端口`)
  }
  return port
}

const redisPort = portFrom('INTERACTION_REDIS_PORT', 6495)
const apiPort = portFrom('INTERACTION_API_PORT', 3112)
const vitePort = portFrom('INTERACTION_VITE_PORT', 5375)
const pepper = 'dev-secret-encryption-key-replace-in-prod-min-32-chars'

const children = []
let runDir = ''
let apiStream = null
const PASSTHROUGH_ENV = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'CI', 'PLAYWRIGHT_BROWSERS_PATH', 'TMPDIR', 'TMP', 'TEMP']

function playwrightArgs() {
  const argv = process.argv.slice(2)
  let spec = 'tests/interaction/ai-resume-journey.spec.ts'
  let config = 'playwright.interaction.config.ts'
  const forward = []
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--grep') {
      const value = argv[i + 1]
      if (!value || value.startsWith('--')) throw new Error('--grep 缺少模式')
      forward.push('--grep', value)
      i += 1
      continue
    }
    if (arg === '--config') {
      const value = argv[i + 1]
      if (!value || value.startsWith('--')) throw new Error('--config 缺少配置文件')
      config = value
      i += 1
      continue
    }
    if (arg.startsWith('--config=')) {
      const value = arg.slice('--config='.length)
      if (!value) throw new Error('--config 缺少配置文件')
      config = value
      continue
    }
    if (arg.startsWith('-')) throw new Error(`启动脚本不认识这个参数：${arg}`)
    spec = arg
  }
  return [spec, '--config', config, ...forward]
}

function childEnv(extra) {
  const env = {}
  for (const key of PASSTHROUGH_ENV) {
    const value = process.env[key]
    if (value) env[key] = value
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

function signalOwned(child, signal) {
  if (!child.pid) return
  try { process.kill(-child.pid, signal) } catch { /* ESRCH：进程组已经没了 */ }
  try { process.kill(child.pid, signal) } catch { /* 进程组信号没落到这个 pid 时再补一刀 */ }
}

async function stopOwned() {
  for (const child of [...children].reverse()) signalOwned(child, 'SIGTERM')
  const deadline = Date.now() + 8_000
  while (Date.now() < deadline && children.some((child) => child.exitCode === null && child.signalCode === null)) {
    await delay(200)
  }
  for (const child of children) signalOwned(child, 'SIGKILL')
}

function ensureCjkFont() {
  if (process.platform !== 'linux') return
  const font = '/usr/share/fonts/truetype/wqy/wqy-microhei.ttc'
  if (existsSync(font)) return
  const installed = spawnSync('sudo', ['apt-get', 'install', '-y', '-q', 'fonts-wqy-microhei'], { stdio: 'inherit', env: childEnv({}) })
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

function watchSpawn(child, label) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      child.off('spawn', onSpawn)
      reject(new StartupFailed(`${label} 起不来：${error instanceof Error ? error.message : String(error)}`))
    }
    const onSpawn = () => {
      child.off('error', onError)
      child.on('error', (later) => {
        console.error(`${label} 运行中出错：${later instanceof Error ? later.message : String(later)}`)
      })
      resolve()
    }
    child.once('error', onError)
    child.once('spawn', onSpawn)
  })
}

async function main() {
  for (const [name, port] of [['Redis', redisPort], ['API', apiPort], ['Vite', vitePort]]) {
    if (!(await portFree(port))) throw new Error(`${name} 端口 ${port} 已被占用，本脚本不连接别人的服务`)
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
  const emptyEnvDir = join(runDir, 'empty-env')
  mkdirSync(emptyEnvDir, { recursive: true })
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
  ], { detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: childEnv({}) }), 'redis')
  await watchSpawn(redis, 'Redis')
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
  const apiEnv = childEnv({
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
  await watchSpawn(api, 'API')
  apiStream = createWriteStream(apiLog)
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
  const kioskOrigin = `http://127.0.0.1:${vitePort}`
  const apiBase = `${apiOrigin}/api/v1`
  writeFileSync(join(emptyEnvDir, '.env.interaction'), `VITE_API_MODE=http\nVITE_API_BASE_URL=${apiBase}\nVITE_API_PROXY_TARGET=${apiOrigin}\n`)
  // Vite 会把配置打成临时 ESM。临时目录本身没有 node_modules，裸导入 'vite' 会失败。
  // 链到一体机自己的 node_modules，不把配置写进仓库。
  symlinkSync(join(kioskRoot, 'node_modules'), join(emptyEnvDir, 'node_modules'), 'dir')
  const viteConfig = join(emptyEnvDir, 'vite.interaction.config.mts')
  writeFileSync(viteConfig, `import { createRequire } from 'node:module'
import realConfig from ${JSON.stringify(join(kioskRoot, 'vite.config.ts'))}

const { mergeConfig } = createRequire(${JSON.stringify(join(kioskRoot, 'package.json'))})('vite')
const allowed = new Set(['VITE_API_MODE', 'VITE_API_BASE_URL', 'VITE_API_PROXY_TARGET'])
const expectedBase = ${JSON.stringify(apiBase)}

export default async (env) => {
  const resolved = await (typeof realConfig === 'function' ? realConfig(env) : realConfig)
  return mergeConfig(resolved, {
    envDir: ${JSON.stringify(emptyEnvDir)},
    plugins: [{
      name: 'interaction-env-lock',
      configResolved(config) {
        for (const key of Object.keys(config.env)) {
          if (key.startsWith('VITE_') && !allowed.has(key)) {
            throw new Error('Vite 环境超出白名单：' + key)
          }
        }
        if (config.env.VITE_API_MODE !== 'http' || config.env.VITE_API_BASE_URL !== expectedBase) {
          throw new Error('Vite API 没有指到本次走查的本机端口')
        }
      },
    }],
  })
}
`)
  const kiosk = track(spawn(process.execPath, [
    viteBin,
    '--config', viteConfig,
    '--mode', 'interaction',
    '--host', '127.0.0.1',
    '--port', String(vitePort),
    '--strictPort',
    kioskRoot,
  ], {
    cwd: emptyEnvDir,
    env: childEnv({
      NODE_ENV: 'development',
      VITE_API_MODE: 'http',
      VITE_API_BASE_URL: apiBase,
      VITE_API_PROXY_TARGET: apiOrigin,
    }),
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  }), 'kiosk')
  await watchSpawn(kiosk, 'Vite')
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
    const test = track(spawn(process.execPath, [playwrightCli, 'test', ...playwrightArgs()], {
      cwd: kioskRoot,
      env: childEnv({
        NODE_ENV: 'test',
        INTERACTION_KIOSK_ORIGIN: kioskOrigin,
        INTERACTION_API_ORIGIN: apiOrigin,
        INTERACTION_EVIDENCE_DIR: evidenceDir,
        INTERACTION_REDIS_URL: `redis://127.0.0.1:${redisPort}`,
        INTERACTION_SMS_PEPPER: pepper,
        SWEEP_API_LOG: apiLog,
        SWEEP_PDF: join(runDir, 'valid-2p.pdf'),
      }),
      detached: true,
      stdio: 'inherit',
    }), 'playwright')
    test.on('error', () => resolveCode(1))
    test.on('exit', (code) => resolveCode(code === null ? 1 : code))
  })
  return testCode
}

async function doFinish(code) {
  await stopOwned()
  if (apiStream) {
    const stream = apiStream
    apiStream = null
    await new Promise((resolve) => stream.end(resolve))
  }
  const git = spawnSync('git', ['status', '--porcelain'], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: childEnv({}),
  })
  const dirty = git.stdout ?? ''
  const gitFailed = Boolean(git.error) || git.status !== 0
  if ((code !== 0 || gitFailed || dirty.trim()) && runDir) {
    const destDir = join(repoRoot, 'test-results/kiosk-interaction')
    mkdirSync(destDir, { recursive: true })
    const src = join(runDir, 'api.log')
    if (existsSync(src)) copyFileSync(src, join(destDir, 'api.log'))
  }
  if (runDir && existsSync(runDir)) rmSync(runDir, { recursive: true, force: true })
  runDir = ''
  if (git.error || git.status !== 0) {
    console.error(`git status 失败（退出码 ${git.status ?? '无'}）\n${git.stderr ?? ''}${git.error ? git.error.message : ''}`)
    process.exitCode = 1
    return
  }
  if (dirty.trim()) {
    console.error(`跑完后工作区不干净（被跟踪文件或未忽略的新文件）：\n${dirty}`)
    process.exitCode = 1
    return
  }
  process.exitCode = code === 0 ? 0 : code
}

let finishPromise = null
function requestFinish(code) {
  if (!finishPromise) finishPromise = doFinish(code)
  return finishPromise
}

process.on('SIGINT', () => {
  requestFinish(130).finally(() => process.exit(process.exitCode ?? 130))
})
process.on('SIGTERM', () => {
  requestFinish(143).finally(() => process.exit(process.exitCode ?? 143))
})

let testCode = 1
try {
  testCode = await main()
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  testCode = 1
}
await requestFinish(testCode)
