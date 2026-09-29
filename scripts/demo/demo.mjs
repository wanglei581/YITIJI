#!/usr/bin/env node
// ============================================================================
// 本地全栈演示包（P1-23）入口。
//
//   pnpm demo          体检 → 建演示库 → 灌演示数据 → 起服务端 + 一体机 + 两个后台
//   pnpm demo:reset    删除 .demo/（演示库、上传文件、演示口令），下次 pnpm demo 重新生成
//
// Windows 10/11 与 macOS 通用：只用 node 内置模块，子进程一律用当前 node 直接起
// （不经过 shell、不依赖 bash），路径全部 path.join。Ctrl+C 一次全部退出。
// 说明文档：README.md「本地演示环境（给销售）」。
// ============================================================================

import { spawn, spawnSync } from 'node:child_process'
import { createWriteStream, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  DEFAULT_PORTS,
  DEFAULT_REDIS_URL,
  DEMO_DIR_NAME,
  buildApiEnv,
  buildSeedEnv,
  buildViteEnv,
  demoPaths,
  generatePassword,
  generateSecrets,
  loadDemoData,
  readJsonIfExists,
} from './lib/demo-config.mjs'
import { startDemoBridge } from './lib/local-bridge.mjs'
import {
  DemoPreflightError,
  allocatePorts,
  checkDependencies,
  checkNodeVersion,
  probeRedis,
  resolvePackageFile,
} from './lib/preflight.mjs'

const paths = demoPaths()
const runningFile = join(paths.demoDir, 'running.json')
const children = new Map()
let bridge = null
let shuttingDown = false

function say(line = '') {
  process.stdout.write(`${line}\n`)
}

function step(index, total, text) {
  say(`[${index}/${total}] ${text}`)
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error.code === 'EPERM'
  }
}

function runningDemo() {
  const info = readJsonIfExists(runningFile)
  return info && pidAlive(info.pid) && info.pid !== process.pid ? info : null
}

// ── 子进程 ──────────────────────────────────────────────────────────────────

function pipeLines(stream, onLine) {
  let pending = ''
  stream.setEncoding('utf8')
  stream.on('data', (chunk) => {
    pending += chunk
    const lines = pending.split(/\r?\n/)
    pending = lines.pop() ?? ''
    for (const line of lines) onLine(line)
  })
  stream.on('end', () => {
    if (pending) onLine(pending)
  })
}

/** 用当前 node 直接起子进程；输出全量写日志，只把需要人看的行转到终端。 */
function startChild(name, args, { cwd, env, echo = () => false }) {
  const logFile = join(paths.logDir, `${name}.log`)
  const log = createWriteStream(logFile, { flags: 'a' })
  const child = spawn(process.execPath, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  const tail = []
  const onLine = (line) => {
    log.write(`${line}\n`)
    tail.push(line)
    if (tail.length > 40) tail.shift()
    if (!shuttingDown && echo(line)) say(`  [${name}] ${line}`)
  }
  pipeLines(child.stdout, onLine)
  pipeLines(child.stderr, onLine)
  const record = { name, child, logFile, tail }
  children.set(name, record)
  child.on('exit', (code, signal) => {
    log.end()
    if (!shuttingDown) {
      say(`\n× ${name} 意外退出（${signal ?? `退出码 ${code}`}）。最后几行输出：`)
      for (const line of tail.slice(-15)) say(`    ${line}`)
      say(`  完整日志：${logFile}`)
      void shutdown(1)
    }
  })
  return record
}

/** 一次性命令（生成客户端、推表结构、灌数据）：失败就把输出原样打出来并退出。 */
function runOnce(label, args, { cwd, env }) {
  const result = spawnSync(process.execPath, args, { cwd, env, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  writeFileSync(join(paths.logDir, `${label}.log`), output)
  if (result.status !== 0) {
    say(`× ${label} 失败。输出：`)
    for (const line of output.trim().split(/\r?\n/).slice(-25)) say(`    ${line}`)
    throw new DemoPreflightError(`${label} 失败，完整输出见 ${join(paths.logDir, `${label}.log`)}`)
  }
  return output
}

function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true)
  return new Promise((resolvePromise) => {
    const timer = setTimeout(() => resolvePromise(false), timeoutMs)
    child.once('exit', () => {
      clearTimeout(timer)
      resolvePromise(true)
    })
  })
}

async function stopChild({ child }) {
  if (child.exitCode !== null || child.signalCode !== null) return
  if (process.platform === 'win32') {
    // Windows 没有信号：按进程树结束（vite 下面还挂着 esbuild）。
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' })
  } else {
    child.kill('SIGTERM')
  }
  if (!(await waitForExit(child, 8_000))) {
    child.kill('SIGKILL')
    await waitForExit(child, 3_000)
  }
}

async function shutdown(code) {
  if (shuttingDown) return
  shuttingDown = true
  say('\n正在停止演示环境……')
  await Promise.all([...children.values()].map(stopChild))
  if (bridge) await bridge.close().catch(() => {})
  try {
    const info = readJsonIfExists(runningFile)
    if (info?.pid === process.pid) rmSync(runningFile, { force: true })
  } catch {
    // 退出时清不掉占用标记不影响下次启动：下次会按进程号判断它已失效。
  }
  say(code === 0 ? '已全部停止。' : '已停止。')
  process.exit(code)
}

// ── 等待就绪 ────────────────────────────────────────────────────────────────

async function waitForHttp(url, { timeoutMs, record }) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (shuttingDown) throw new DemoPreflightError('已停止')
    if (record && record.child.exitCode !== null) throw new DemoPreflightError(`${record.name} 启动失败`)
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(3_000) })
      if (response.ok) return
    } catch {
      // 还没起来，接着等。
    }
    await new Promise((r) => setTimeout(r, 1_000))
  }
  throw new DemoPreflightError(`等待 ${url} 超时（${Math.round(timeoutMs / 1000)} 秒）。日志：${record?.logFile ?? ''}`)
}

async function registerDemoTerminal({ ports, secrets, terminal }) {
  const response = await fetch(`http://127.0.0.1:${ports.api}/api/v1/auth/terminal/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({
      terminalCode: terminal.terminalCode,
      deviceFingerprint: `demo-fingerprint-${terminal.terminalCode}`,
      displayName: terminal.displayName,
      locationLabel: terminal.locationLabel,
      adminSecret: secrets.terminalAdminSecret,
    }),
    signal: AbortSignal.timeout(10_000),
  })
  const payload = await response.json().catch(() => ({}))
  const data = payload && typeof payload === 'object' && 'data' in payload ? payload.data : payload
  if (!response.ok || !data?.terminalId || !data?.terminalToken) {
    throw new DemoPreflightError(`演示终端注册失败：HTTP ${response.status} ${JSON.stringify(payload?.error ?? payload).slice(0, 200)}`)
  }
  return { terminalId: data.terminalId, agentToken: data.terminalToken }
}

// ── 状态（密钥与演示口令，只存在被 git 忽略的 .demo/）─────────────────────────

function loadOrCreateState() {
  const existing = readJsonIfExists(paths.stateFile)
  if (existing?.secrets && existing?.passwords) return { state: existing, created: false }
  const state = {
    createdAt: new Date().toISOString(),
    secrets: generateSecrets(),
    passwords: { admin: generatePassword(), partner: generatePassword() },
  }
  writeFileSync(paths.stateFile, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
  return { state, created: true }
}

function writeAccountsFile({ urls, passwords, users }) {
  const admin = users.find((u) => u.role === 'admin')
  const partner = users.find((u) => u.role === 'partner')
  const text = [
    '职易达 · 本地演示环境（所有数据均为演示数据）',
    '',
    `一体机前台：${urls.kiosk}`,
    `管理员后台：${urls.admin}`,
    `  账号：${admin.username}    口令：${passwords.admin}`,
    `机构后台：  ${urls.partner}`,
    `  账号：${partner.username}  口令：${passwords.partner}`,
    `服务端：    ${urls.api}`,
    '',
    '口令只保存在本机这个文件夹里（已被 git 忽略）。pnpm demo:reset 会删掉它并在下次启动时重新生成。',
    '',
  ].join('\n')
  writeFileSync(paths.accountsFile, text, { mode: 0o600 })
}

// ── 命令：start ──────────────────────────────────────────────────────────────

async function start() {
  const TOTAL = 6
  say('职易达 · 本地演示环境（所有数据均为演示数据）\n')

  step(1, TOTAL, '体检：Node.js、依赖、Redis、端口')
  checkNodeVersion()
  checkDependencies(paths)
  const other = runningDemo()
  if (other) throw new DemoPreflightError(`已经有一个演示环境在运行（进程 ${other.pid}）。先在那个窗口按 Ctrl+C 停掉再启动。`)
  const redisUrl = (process.env['DEMO_REDIS_URL'] ?? '').trim() || DEFAULT_REDIS_URL
  const redis = await probeRedis(redisUrl)
  say(`  Redis 可用：${redis.host}:${redis.port}，库号 ${redis.db}`)
  const { ports, moved } = await allocatePorts(DEFAULT_PORTS)
  for (const line of moved) say(`  端口调整：${line}`)

  mkdirSync(paths.logDir, { recursive: true })
  mkdirSync(paths.storageDir, { recursive: true })
  writeFileSync(runningFile, JSON.stringify({ pid: process.pid, ports, startedAt: new Date().toISOString() }))
  // dotenv 指向这个空文件：services/api/.env 里开发者的真实配置在演示里完全不生效。
  writeFileSync(paths.dotenvFile, '# 演示包专用：刻意留空。演示服务端的全部配置由 scripts/demo/lib/demo-config.mjs 传入。\n')

  const { state, created } = loadOrCreateState()
  const data = loadDemoData()
  const apiEnv = buildApiEnv({ paths, ports, redisUrl, secrets: state.secrets })
  const prismaCli = resolvePackageFile(paths.apiDir, 'prisma', 'build/index.js')

  step(2, TOTAL, `准备演示库 ${join(DEMO_DIR_NAME, 'demo.db')}（与开发库完全分开）`)
  runOnce('prisma-generate', [prismaCli, 'generate'], { cwd: paths.apiDir, env: apiEnv })
  runOnce('prisma-db-push', [prismaCli, 'db', 'push', '--accept-data-loss'], { cwd: paths.apiDir, env: apiEnv })

  step(3, TOTAL, created ? '灌入演示数据（首次启动，已生成新的演示口令）' : '灌入演示数据（沿用上次的演示口令）')
  const seedOutput = runOnce('demo-seed', ['-r', '@swc-node/register', join(paths.repoRoot, 'scripts', 'demo', 'seed-demo.ts')], {
    cwd: paths.apiDir,
    env: buildSeedEnv({ apiEnv, passwords: state.passwords }),
  })
  const seedLine = seedOutput.split(/\r?\n/).find((line) => line.startsWith('[demo-seed]'))
  if (seedLine) say(`  ${seedLine.replace('[demo-seed] ', '')}`)

  step(4, TOTAL, `启动服务端（端口 ${ports.api}，需 1–3 分钟）`)
  const api = startChild('api', ['-r', '@swc-node/register', join('src', 'main.ts')], {
    cwd: paths.apiDir,
    env: apiEnv,
    echo: (line) => line.includes('[DEV 短信]') || /\b(FATAL|ERROR)\b/.test(line),
  })
  await waitForHttp(`http://127.0.0.1:${ports.api}/api/v1/health`, { timeoutMs: 240_000, record: api })

  step(5, TOTAL, '登记演示终端并启动本机演示网桥')
  const terminal = data.terminals[0]
  const credential = await registerDemoTerminal({ ports, secrets: state.secrets, terminal })
  bridge = await startDemoBridge({
    port: ports.bridge,
    allowedOrigins: [`http://127.0.0.1:${ports.kiosk}`, `http://localhost:${ports.kiosk}`],
    bridgeToken: state.secrets.bridgeToken,
    apiBaseUrl: `http://127.0.0.1:${ports.api}/api/v1`,
    terminalId: credential.terminalId,
    terminalCode: terminal.terminalCode,
    agentToken: credential.agentToken,
    log: (line) => say(`  [网桥] ${line}`),
  })
  say(`  演示终端 ${terminal.terminalCode} 已登记`)

  step(6, TOTAL, '启动一体机前台、管理员后台、机构后台')
  const vites = ['kiosk', 'admin', 'partner'].map((app) => {
    const viteBin = resolvePackageFile(paths.appDir(app), 'vite', 'bin/vite.js')
    return startChild(app, [viteBin, '--host', '127.0.0.1', '--port', String(ports[app]), '--strictPort'], {
      cwd: paths.appDir(app),
      env: buildViteEnv(app, { ports, secrets: state.secrets }),
      echo: (line) => /\berror\b/i.test(line),
    })
  })
  await Promise.all(vites.map((record) => waitForHttp(`http://127.0.0.1:${ports[record.name]}/`, { timeoutMs: 120_000, record })))

  const urls = {
    kiosk: `http://127.0.0.1:${ports.kiosk}/`,
    admin: `http://127.0.0.1:${ports.admin}/`,
    partner: `http://127.0.0.1:${ports.partner}/`,
    api: `http://127.0.0.1:${ports.api}/api/v1/health`,
  }
  writeAccountsFile({ urls, passwords: state.passwords, users: data.users })
  const admin = data.users.find((u) => u.role === 'admin')
  const partner = data.users.find((u) => u.role === 'partner')

  say('')
  say('──────────────────────────────────────────────────────────────')
  say(' 演示环境已就绪（页面上的机构、终端、政策、法务文档都标有「演示」）')
  say('──────────────────────────────────────────────────────────────')
  say(` 一体机前台   ${urls.kiosk}`)
  say(` 管理员后台   ${urls.admin}   账号 ${admin.username}  口令 ${state.passwords.admin}`)
  say(` 机构后台     ${urls.partner}   账号 ${partner.username}  口令 ${state.passwords.partner}`)
  say(` 服务端       ${urls.api}`)
  say('')
  say(` 演示账号也写在：${paths.accountsFile}`)
  say(' 说明：AI 为模拟结果（未连接真实 AI 服务）；没有连接打印机，不会真的出纸；')
  say('       线上支付未开通；手机号登录的验证码会显示在本窗口。')
  say(' 按 Ctrl+C 停止全部服务。')
  say('──────────────────────────────────────────────────────────────')
}

// ── 命令：reset ──────────────────────────────────────────────────────────────

function reset() {
  const other = runningDemo()
  if (other) {
    throw new DemoPreflightError(`演示环境正在运行（进程 ${other.pid}）。先在那个窗口按 Ctrl+C 停掉，再运行 pnpm demo:reset。`)
  }
  const target = resolve(paths.demoDir)
  if (target !== resolve(paths.repoRoot, DEMO_DIR_NAME)) throw new Error('拒绝删除：目标不是仓库内的 .demo 目录')
  if (!existsSync(target)) {
    say('没有可清空的演示数据（.demo/ 不存在）。运行 pnpm demo 会重新建立。')
    return
  }
  rmSync(target, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  say('已清空演示环境：演示库、上传文件、日志、演示口令都已删除。')
  say('Redis 里的演示会话会在 30 分钟内自然过期，无需处理。')
  say('重新开始请运行：pnpm demo（会生成新的演示口令）')
}

// ── 入口 ────────────────────────────────────────────────────────────────────

const command = process.argv[2] ?? 'start'

process.on('SIGINT', () => void shutdown(0))
process.on('SIGTERM', () => void shutdown(0))
if (process.platform === 'win32') process.on('SIGBREAK', () => void shutdown(0))

try {
  if (command === 'start') {
    await start()
  } else if (command === 'reset') {
    reset()
  } else {
    say('用法：pnpm demo（启动）｜ pnpm demo:reset（清空演示数据）')
    process.exitCode = 2
  }
} catch (error) {
  if (error instanceof DemoPreflightError) {
    say(`\n× ${error.message}`)
  } else {
    say(`\n× 演示环境启动失败：${error instanceof Error ? error.stack : String(error)}`)
  }
  if (command === 'start') await shutdown(1)
  else process.exitCode = 1
}
