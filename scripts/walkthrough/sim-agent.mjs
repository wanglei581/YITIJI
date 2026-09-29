#!/usr/bin/env node
// ============================================================================
// 走查用模拟 Windows 终端程序（sim-agent）。不连接任何真实打印机、扫描仪或 U 盘。
//
//   node scripts/walkthrough/sim-agent.mjs bind --api http://127.0.0.1:4300/api/v1 --code <绑定码>
//   node scripts/walkthrough/sim-agent.mjs run  --api http://127.0.0.1:4300/api/v1 --bridge-port 4350 \
//        --kiosk-origin http://127.0.0.1:4310 --bridge-token <令牌>
//   node scripts/walkthrough/sim-agent.mjs status
//   node scripts/walkthrough/sim-agent.mjs boot-url
//   node scripts/walkthrough/sim-agent.mjs printer paper_empty
//   node scripts/walkthrough/sim-agent.mjs scan-drop ./sample.pdf
//
// 数据目录 ${SIM_AGENT_DIR:-~/.cache/walk0929/sim-agent}；用法与和真实终端程序的差异见 README.md
// 「模拟终端程序（sim-agent）」一节。只用 Node 22 内置模块。
// ============================================================================

import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs'
import { basename, extname, join, resolve } from 'node:path'
import {
  HttpError, PRINTER_MODES, SIM_AGENT_VERSION, SIM_DISPLAY_NAME, apiRequest, clearUnauthorized, ensureDirs, errorText,
  info, initAuthState, initLog, isUnauthorized, loadCredential, loadOrCreateDevice, parseArgs, readJson, readPrinterMode,
  saveCredential, shanghaiIso, simPaths, warn, writeJsonPrivate,
} from './sim-agent-lib/common.mjs'
import { heartbeatPrinterStatus, startPrinterRuntime } from './sim-agent-lib/printer.mjs'
import { startBridge } from './sim-agent-lib/bridge.mjs'
import { fetchScanLease, isAcceptedScanName, startScanInbox } from './sim-agent-lib/scan.mjs'

const DEFAULT_API = 'http://127.0.0.1:4300/api/v1'
const DEFAULT_KIOSK_ORIGIN = 'http://127.0.0.1:4310'
const DEFAULT_BRIDGE_PORT = 4350

const { positional, options } = parseArgs(process.argv.slice(2))
const command = positional[0] ?? 'help'
const paths = simPaths()

function opt(name, fallback) {
  const v = options[name]
  if (v === undefined) return fallback
  return Array.isArray(v) ? v[v.length - 1] : v
}
function optList(name, fallback) {
  const v = options[name]
  if (v === undefined) return fallback
  return [].concat(v).flatMap((x) => String(x).split(',')).map((x) => x.trim()).filter(Boolean)
}
function envMs(name, fallback) {
  const n = Number(process.env[name])
  return Number.isFinite(n) && n > 0 ? n : fallback
}
function apiBase(credential) {
  return String(opt('api', credential?.apiBaseUrl ?? DEFAULT_API)).replace(/\/+$/, '')
}
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return err.code === 'EPERM'
  }
}
function die(message) {
  process.stderr.write(`${message}\n`)
  process.exit(1)
}

// ── bind ────────────────────────────────────────────────────────────────────
async function cmdBind() {
  ensureDirs(paths)
  initLog(paths)
  let code = opt('code', process.env['SIM_AGENT_BIND_CODE'])
  if (code === '-') code = readFileSync(0, 'utf8').split(/\r?\n/)[0]
  code = String(code ?? '').trim()
  if (!code || code === 'true') die('缺少绑定码：--code <管理员后台生成的一次性绑定码>（或 --code - 从标准输入读）')
  const api = apiBase(null)
  const device = loadOrCreateDevice(paths)
  const body = {
    bindCode: code,
    deviceFingerprint: device.deviceFingerprint,
    displayName: String(opt('display-name', SIM_DISPLAY_NAME)),
    macAddress: device.macAddress,
    agentVersion: SIM_AGENT_VERSION,
    ...(opt('location') ? { locationLabel: String(opt('location')) } : {}),
  }
  let result
  try {
    // 安装脚本 Exchange-BindCode：一次性码，响应丢了不能重发（码已被核销），所以不重试。
    result = await apiRequest({ apiBaseUrl: api, method: 'POST', path: '/auth/terminal/exchange-bind-code', body, retries: 0 })
  } catch (err) {
    die(`绑定失败：${errorText(err)}${err instanceof HttpError && err.code === 'BIND_CODE_USED' ? '（这张码已用过，请在后台重新生成）' : ''}`)
  }
  for (const field of ['terminalId', 'terminalCode', 'terminalToken']) {
    if (typeof result?.[field] !== 'string' || !result[field].trim()) die(`绑定响应缺少 ${field}，未保存任何凭证`)
  }
  const credential = {
    terminalId: result.terminalId.trim(),
    terminalCode: result.terminalCode.trim(),
    terminalToken: result.terminalToken.trim(),
    expiresAt: result.expiresAt ?? null,
    credentialId: result.credentialId ?? null,
    generation: result.generation ?? null,
    apiBaseUrl: api,
    boundAt: shanghaiIso(),
  }
  saveCredential(paths, credential)
  clearUnauthorized(paths) // 与安装脚本一致：换上新凭证后解除 401 闩
  info('bind.ok', `绑定成功：${credential.terminalCode}（${credential.terminalId}），凭证第 ${credential.generation ?? '?'} 代，有效期至 ${credential.expiresAt ?? '?'}`, {
    terminalId: credential.terminalId, terminalCode: credential.terminalCode, credentialId: credential.credentialId, generation: credential.generation, expiresAt: credential.expiresAt,
  })
  process.stdout.write(`凭证已保存到 ${paths.credential}（权限 0600）\n`)
  const run = readJson(paths.run)
  if (run && pidAlive(run.pid)) process.stdout.write(`注意：正在运行的模拟终端（pid ${run.pid}）还拿着旧凭证，请重启 run。\n`)
}

// ── run ─────────────────────────────────────────────────────────────────────
async function cmdRun() {
  ensureDirs(paths)
  initLog(paths)
  const credential = loadCredential(paths)
  if (!credential) die(`还没有终端凭证：先执行 bind --api ... --code <绑定码>（数据目录 ${paths.dir}）`)
  const existing = readJson(paths.run)
  if (existing && existing.pid !== process.pid && pidAlive(existing.pid)) die(`已有一个模拟终端在运行（pid ${existing.pid}），同一数据目录只能跑一个（真实终端程序同样单实例）`)
  initAuthState(paths)
  if (!existsSync(paths.printer)) writeFileSync(paths.printer, 'ready\n')

  const apiBaseUrl = apiBase(credential)
  const bridgePort = Number(opt('bridge-port', DEFAULT_BRIDGE_PORT))
  const kioskOrigins = optList('kiosk-origin', [DEFAULT_KIOSK_ORIGIN])
  const bridgeToken = String(opt('bridge-token', process.env['SIM_AGENT_BRIDGE_TOKEN'] ?? '')).trim()
  const device = loadOrCreateDevice(paths)
  if (isUnauthorized()) warn('run.unauthorized', `上次运行时终端凭证已被服务端拒绝（${paths.unauthorized} 存在）：心跳与领任务停止，重新 bind 后才恢复`)

  const scan = startScanInbox({
    paths, apiBaseUrl, credential,
    pollMs: envMs('SIM_AGENT_SCAN_POLL_MS', 1_000),
    stabilityIntervalMs: envMs('SIM_AGENT_SCAN_STABLE_MS', 1_000),
  })
  const runtime = startPrinterRuntime({
    paths, apiBaseUrl, credential,
    macAddress: device.macAddress,
    getScanTelemetry: () => scan.getTelemetry(),
    heartbeatIntervalMs: envMs('SIM_AGENT_HEARTBEAT_MS', 30_000),
    claimIntervalMs: envMs('SIM_AGENT_CLAIM_MS', 5_000),
    printMs: envMs('SIM_AGENT_PRINT_MS', 1_500),
    unconfirmedMs: envMs('SIM_AGENT_UNCONFIRMED_MS', 20_000),
    offlineRetryMs: envMs('SIM_AGENT_OFFLINE_RETRY_MS', 60_000),
  })
  let bridge
  try {
    bridge = await startBridge({
      port: bridgePort,
      allowedOrigins: kioskOrigins,
      bridgeToken,
      apiBaseUrl,
      credential,
      paths,
      wakePrintQueue: () => runtime.wake(),
      getPanelStatus: () => ({
        terminalCode: credential.terminalCode,
        cloudConnected: runtime.observation.connected,
        lastHeartbeatAt: runtime.observation.lastHeartbeatAt,
        printerStatus: runtime.observation.printerStatus,
        credentialStatus: isUnauthorized() ? 'unauthorized' : 'ready',
      }),
    })
  } catch (err) {
    await runtime.close()
    await scan.close()
    die(`本机网桥起不来（127.0.0.1:${bridgePort}）：${errorText(err)}`)
  }
  writeJsonPrivate(paths.run, {
    pid: process.pid, startedAt: shanghaiIso(), apiBaseUrl, bridgePort: bridge.port, kioskOrigins,
    bridgeTokenConfigured: Boolean(bridgeToken), terminalId: credential.terminalId, terminalCode: credential.terminalCode,
  })
  info('run.ready', `模拟终端 ${credential.terminalCode} 运行中：API ${apiBaseUrl}，网桥 127.0.0.1:${bridge.port}，数据目录 ${paths.dir}。Ctrl+C 停止。`)

  let stopping = false
  const stop = async (signal) => {
    if (stopping) return
    stopping = true
    info('run.stop', `收到 ${signal}，模拟终端退出`)
    await Promise.allSettled([runtime.close(), scan.close(), bridge.close()])
    const current = readJson(paths.run)
    if (current?.pid === process.pid) writeJsonPrivate(paths.run, { ...current, stoppedAt: shanghaiIso(), pid: null })
    process.exit(0)
  }
  process.on('SIGINT', () => void stop('SIGINT'))
  process.on('SIGTERM', () => void stop('SIGTERM'))
  process.on('unhandledRejection', (reason) => warn('run.unhandled', `未处理的异步错误：${errorText(reason)}`))
}

// ── status ──────────────────────────────────────────────────────────────────
function cmdStatus() {
  const credential = loadCredential(paths)
  const heartbeat = readJson(paths.heartbeat)
  const run = readJson(paths.run)
  const state = readJson(paths.state, {})
  const printer = readPrinterMode(paths)
  const lines = []
  lines.push(`数据目录        ${paths.dir}`)
  if (credential) {
    lines.push(`终端            ${credential.terminalCode}（terminalId ${credential.terminalId}）`)
    lines.push(`凭证            第 ${credential.generation ?? '?'} 代，credentialId ${credential.credentialId ?? '?'}，有效期至 ${credential.expiresAt ?? '?'}，绑定于 ${credential.boundAt ?? '?'}`)
    lines.push(`API             ${credential.apiBaseUrl ?? DEFAULT_API}`)
  } else {
    lines.push('终端            未绑定（先执行 bind）')
  }
  lines.push(`凭证状态        ${existsSync(paths.unauthorized) ? '已被服务端拒绝（401），需要重新 bind' : '未发现 401'}`)
  lines.push(`运行进程        ${run?.pid && pidAlive(run.pid) ? `pid ${run.pid}，启动于 ${run.startedAt}，网桥 127.0.0.1:${run.bridgePort}，来源 ${run.kioskOrigins?.join(', ')}` : '未运行'}`)
  lines.push(`打印机模式      ${printer.mode}${printer.valid ? '' : `（控制文件内容「${printer.raw}」不认识，按 ready 处理）`} → 心跳上报 ${heartbeatPrinterStatus(printer.mode)}`)
  if (heartbeat) {
    lines.push(`最近一次心跳    ${heartbeat.at}  ${heartbeat.ok ? '成功' : `失败：${heartbeat.message ?? ''}`}（当时打印机 ${heartbeat.printerStatus}${heartbeat.serverConfig?.claimIntervalMs ? `，服务端领任务间隔 ${heartbeat.serverConfig.claimIntervalMs}ms` : ''}）`)
  } else {
    lines.push('最近一次心跳    还没有发过')
  }
  const tasks = Object.entries(state.tasks ?? {})
  lines.push(`本机任务记录    ${tasks.length} 条；待重试回写 ${(state.pendingPatches ?? []).length} 条；放弃回写 ${(state.deadLetters ?? []).length} 条`)
  for (const [id, t] of tasks.slice(-5)) lines.push(`                ${id}  ${t.status}  ${t.at}`)
  const count = (dir) => {
    try {
      return readdirSync(dir).filter((n) => !n.startsWith('.') && !n.endsWith('.json') && n !== '_unclaimed' && n !== '_not-printed').length
    } catch {
      return 0
    }
  }
  lines.push(`模拟出纸        ${count(paths.printed)} 份（${paths.printed}）；未出纸存档 ${count(paths.rejected)} 份`)
  lines.push(`扫描收件箱      待处理 ${count(paths.scanInbox)} 个，已隔离 ${count(paths.scanUnclaimed)} 个`)
  lines.push(`模拟 U 盘       ${count(paths.usb) > 0 || existsSync(paths.usbMarker) ? '已插入' : '未插入'}（${paths.usb}）`)
  process.stdout.write(`${lines.join('\n')}\n`)
}

// ── boot-url ────────────────────────────────────────────────────────────────
async function cmdBootUrl() {
  const credential = loadCredential(paths)
  if (!credential) die('还没有终端凭证：先执行 bind')
  const origin = String(opt('kiosk-origin', DEFAULT_KIOSK_ORIGIN)).replace(/\/+$/, '')
  let ticket
  try {
    ticket = await apiRequest({ apiBaseUrl: apiBase(credential), method: 'POST', path: '/terminals/boot-ticket', credential, retries: 0, timeoutMs: 5_000 })
  } catch (err) {
    die(`换启动票失败：${errorText(err)}`)
  }
  if (!ticket?.bootTicket) die('服务端没有返回启动票')
  process.stdout.write(`${origin}/?boot_ticket=${encodeURIComponent(ticket.bootTicket)}\n`)
  process.stderr.write(`（一次性，${ticket.expiresInSeconds ?? 60} 秒内在浏览器打开有效）\n`)
}

// ── printer <mode> ──────────────────────────────────────────────────────────
function cmdPrinter() {
  const mode = String(positional[1] ?? '').trim().toLowerCase()
  if (!mode) {
    const p = readPrinterMode(paths)
    process.stdout.write(`${p.mode}\n`)
    return
  }
  if (!PRINTER_MODES.includes(mode)) die(`不认识的打印机模式「${mode}」，可选：${PRINTER_MODES.join(' / ')}`)
  ensureDirs(paths)
  writeFileSync(paths.printer, `${mode}\n`)
  process.stdout.write(`打印机模式已设为 ${mode}（心跳上报 ${heartbeatPrinterStatus(mode)}，下一次心跳生效；新领到的任务立即按此模式执行）\n`)
}

// ── scan-drop <file> ────────────────────────────────────────────────────────
async function cmdScanDrop() {
  const source = positional[1]
  if (!source) die('用法：scan-drop <pdf/jpg/png 文件>')
  const abs = resolve(source)
  if (!existsSync(abs)) die(`找不到文件：${abs}`)
  if (!isAcceptedScanName(abs)) die('只收 pdf / jpg / jpeg / png（与真实终端程序扫描目录白名单一致）')
  ensureDirs(paths)
  const stamp = shanghaiIso().slice(0, 19).replace(/[-:T]/g, '')
  const name = `scan-${stamp}-${basename(abs, extname(abs)).replace(/[^\w一-龥-]/g, '_').slice(0, 60)}${extname(abs).toLowerCase()}`
  // 先写到临时目录再改名进收件箱：收件箱只会看到一个完整的新文件（修改时间 = 现在）。
  const tmp = join(paths.temp, `${name}.part`)
  writeFileSync(tmp, readFileSync(abs))
  renameSync(tmp, join(paths.scanInbox, name))
  process.stdout.write(`已放进扫描收件箱：${join(paths.scanInbox, name)}\n`)
  const credential = loadCredential(paths)
  const run = readJson(paths.run)
  if (!run?.pid || !pidAlive(run.pid)) process.stdout.write('提醒：模拟终端没在运行，文件不会被处理；而且 run 启动时会把收件箱里已有的文件当残留隔离掉。先 run，再 scan-drop。\n')
  if (credential) {
    try {
      const lease = await fetchScanLease({ apiBaseUrl: apiBase(credential), credential })
      process.stdout.write(lease
        ? `当前有等待中的扫描任务 ${lease.scanTaskId}，模拟终端会在文件写完（约 3 秒）后投递。\n`
        : '当前没有等待中的扫描任务：这份文件会被移进 _unclaimed，不会投递（先在一体机上开始扫描，再 scan-drop）。\n')
    } catch (err) {
      process.stdout.write(`（没能查询扫描任务：${errorText(err)}）\n`)
    }
  }
}

function cmdHelp() {
  process.stdout.write(`走查用模拟终端程序（不会真实出纸）

  bind      --api <API 根> --code <绑定码> [--display-name 名称] [--location 位置]
  run       [--api <API 根>] [--bridge-port ${DEFAULT_BRIDGE_PORT}] [--kiosk-origin ${DEFAULT_KIOSK_ORIGIN}] [--bridge-token <令牌>]
  status    看凭证、最近一次心跳、打印机模式、任务与收件箱
  boot-url  [--kiosk-origin ${DEFAULT_KIOSK_ORIGIN}]  打印带一次性启动票的一体机地址（不经网桥）
  printer   [${PRINTER_MODES.join('|')}]  查看 / 切换模拟打印机状态
  scan-drop <文件>  把样例扫描件放进扫描收件箱

数据目录：${paths.dir}（用 SIM_AGENT_DIR 改）。详见 scripts/walkthrough/README.md。
`)
}

const commands = { bind: cmdBind, run: cmdRun, status: cmdStatus, 'boot-url': cmdBootUrl, printer: cmdPrinter, 'scan-drop': cmdScanDrop, help: cmdHelp }
const handler = commands[command]
if (!handler) {
  cmdHelp()
  process.exit(1)
}
await handler()
