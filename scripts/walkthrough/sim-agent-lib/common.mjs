// ============================================================================
// 走查用模拟终端程序（sim-agent）的公共部分：目录、日志、凭证、调用服务端。
//
// 只用 Node 22 内置模块。不写任何真实打印机型号（CLAUDE.md §3）。
// 终端凭证（terminalToken）只写进 credential.json（0600），绝不进日志、终端输出或浏览器。
// ============================================================================

import { createHash, randomUUID } from 'node:crypto'
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, appendFileSync } from 'node:fs'
import { homedir, networkInterfaces } from 'node:os'
import { dirname, join } from 'node:path'

/** 后台终端列表 / 心跳里显示的版本号：一眼看出不是真终端程序。 */
export const SIM_AGENT_VERSION = '0.4.13-walk（走查模拟 Agent，不会真实出纸）'
/** 绑定时写进终端档案的显示名。 */
export const SIM_DISPLAY_NAME = '测试·模拟终端'
/** 模拟打印机名：不得写成任何真实型号。 */
export const SIM_PRINTER_NAME = '（走查）模拟打印机'

/** 打印机控制文件允许的取值（见 README「打印机状态怎么切」）。 */
export const PRINTER_MODES = ['ready', 'paper_empty', 'offline', 'error', 'jam', 'unconfirmed']

// ── 目录 ────────────────────────────────────────────────────────────────────

export function simDir(env = process.env) {
  const configured = String(env['SIM_AGENT_DIR'] ?? '').trim()
  return configured || join(homedir(), '.cache', 'walk0929', 'sim-agent')
}

export function simPaths(dir = simDir()) {
  return {
    dir,
    credential: join(dir, 'credential.json'),
    device: join(dir, 'device.json'),
    printer: join(dir, 'printer'),
    log: join(dir, 'agent.jsonl'),
    state: join(dir, 'state.json'),
    heartbeat: join(dir, 'heartbeat.json'),
    run: join(dir, 'run.json'),
    unauthorized: join(dir, 'agent.unauthorized'),
    printed: join(dir, 'printed'),
    rejected: join(dir, 'printed', '_not-printed'),
    temp: join(dir, 'temp'),
    usb: join(dir, 'usb'),
    usbMarker: join(dir, 'usb-inserted'),
    scanInbox: join(dir, 'scan-inbox'),
    scanUnclaimed: join(dir, 'scan-inbox', '_unclaimed'),
  }
}

export function ensureDirs(paths) {
  for (const d of [paths.dir, paths.printed, paths.rejected, paths.temp, paths.usb, paths.scanInbox, paths.scanUnclaimed]) {
    mkdirSync(d, { recursive: true })
  }
}

// ── 时间：一律 Asia/Shanghai（+08:00）──────────────────────────────────────

export function shanghaiIso(date = new Date()) {
  const t = date instanceof Date ? date.getTime() : Number(date)
  return new Date(t + 8 * 3600_000).toISOString().replace('Z', '+08:00')
}

// ── JSON 行日志 ─────────────────────────────────────────────────────────────

let logFile = null
let echo = true
const SECRET_KEYS = new Set(['terminalToken', 'agentToken', 'token', 'authorization', 'bridgeToken', 'claimToken', 'deliveryLease', 'bootTicket'])

export function initLog(paths, { echoToStdout = true } = {}) {
  mkdirSync(dirname(paths.log), { recursive: true })
  logFile = paths.log
  echo = echoToStdout
}

function scrub(fields) {
  const out = {}
  for (const [k, v] of Object.entries(fields ?? {})) {
    out[k] = SECRET_KEYS.has(k) ? '[redacted]' : v
  }
  return out
}

/** 写一行 JSON（Asia/Shanghai 时间戳），同时在终端打印一行人话。 */
export function log(level, event, msg, fields = {}) {
  const line = { ts: shanghaiIso(), level, event, msg, ...scrub(fields) }
  if (logFile) {
    try {
      appendFileSync(logFile, `${JSON.stringify(line)}\n`, { mode: 0o600 })
    } catch {
      // 日志写不进去不能拖垮模拟终端
    }
  }
  if (echo) {
    const stamp = line.ts.slice(11, 19)
    const out = level === 'error' || level === 'warn' ? process.stderr : process.stdout
    out.write(`[${stamp}] ${level === 'info' ? '' : `${level.toUpperCase()} `}${msg}\n`)
  }
}
export const info = (event, msg, fields) => log('info', event, msg, fields)
export const warn = (event, msg, fields) => log('warn', event, msg, fields)
export const error = (event, msg, fields) => log('error', event, msg, fields)

// ── 小文件读写 ──────────────────────────────────────────────────────────────

export function readJson(file, fallback = null) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

/** 原子写（临时文件 + rename），并把权限收到 0600。 */
export function writeJsonPrivate(file, value) {
  mkdirSync(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  chmodSync(tmp, 0o600)
  renameSync(tmp, file)
  chmodSync(file, 0o600)
}

// ── 凭证 ────────────────────────────────────────────────────────────────────

export function loadCredential(paths) {
  const c = readJson(paths.credential)
  if (!c || typeof c.terminalId !== 'string' || typeof c.terminalToken !== 'string') return null
  return c
}

export function saveCredential(paths, credential) {
  writeJsonPrivate(paths.credential, credential)
}

// ── 未授权闩（对应 apps/terminal-agent/src/agent/auth-state.ts）──────────────
// 服务端回 401 → 写标记文件并停止心跳 / 领任务 / 投递扫描件；重启也不解除，
// 只有重新绑定成功才清掉。标记里不含任何凭证。

let unauthorizedLatched = false
let unauthorizedMarker = null

export function initAuthState(paths) {
  unauthorizedMarker = paths.unauthorized
  unauthorizedLatched = existsSync(paths.unauthorized)
}
export function isUnauthorized() {
  return unauthorizedLatched
}
export function markUnauthorized(source) {
  if (unauthorizedLatched) return
  unauthorizedLatched = true
  if (unauthorizedMarker) {
    try {
      writeFileSync(unauthorizedMarker, `${JSON.stringify({ schemaVersion: 1, state: 'unauthorized', recordedAt: new Date().toISOString() })}\n`, { flag: 'wx', mode: 0o600 })
    } catch {
      // 已存在即可
    }
  }
  error('auth.unauthorized', `终端凭证被服务端拒绝（HTTP 401，来源：${source}）。已停止心跳、领任务和扫描投递；请在管理员后台重新生成绑定码后执行 bind。`, { source })
}
export function clearUnauthorized(paths) {
  rmSync(paths.unauthorized, { force: true })
  unauthorizedLatched = false
}

// ── 设备身份（稳定，存 device.json）────────────────────────────────────────
// 真实终端程序：deviceFingerprint = SHA-256(主机名 + ":" + 网卡 MAC)，macAddress = 真实网卡 MAC。
// 模拟终端：同一台 Mac 上可能同时跑多个模拟终端，用真实 MAC 会撞「MAC 已绑定到其它终端」，
// 所以指纹由一个随机种子派生，MAC 用「本地管理位」地址（02:xx:...，不属于任何真实网卡）。


export function loadOrCreateDevice(paths) {
  const existing = readJson(paths.device)
  if (existing && typeof existing.deviceFingerprint === 'string' && typeof existing.macAddress === 'string') return existing
  const seed = randomUUID()
  const deviceFingerprint = createHash('sha256').update(`walkthrough-sim-agent:${seed}`, 'utf8').digest('hex')
  const macBytes = createHash('sha256').update(`mac:${seed}`, 'utf8').digest().subarray(0, 6)
  macBytes[0] = (macBytes[0] & 0xfc) | 0x02 // 本地管理位 = 1，组播位 = 0
  const macAddress = [...macBytes].map((b) => b.toString(16).padStart(2, '0')).join(':')
  const device = { deviceFingerprint, macAddress, createdAt: shanghaiIso() }
  writeJsonPrivate(paths.device, device)
  return device
}

/** 与 heartbeat.ts getIpAddress 相同：第一个非内网回环的 IPv4，否则 127.0.0.1。 */
export function getIpAddress() {
  for (const ifaces of Object.values(networkInterfaces())) {
    for (const addr of ifaces ?? []) {
      if (!addr.internal && addr.family === 'IPv4') return addr.address
    }
  }
  return '127.0.0.1'
}

// ── 调用服务端（对应 apps/terminal-agent/src/agent/api-client.ts）───────────

export class HttpError extends Error {
  constructor(status, code, message, retryAfter) {
    super(`HTTP ${status}${code ? ` [${code}]` : ''}${message ? ` — ${message}` : ''}`)
    this.status = status
    this.code = code
    this.apiMessage = message
    this.retryAfter = retryAfter
  }
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

/** 与 api-client.ts 一致：只重试网络错误和 5xx，最多 3 次，间隔 2s / 4s / 6s。 */
export function isRetryable(err) {
  return !(err instanceof HttpError) || err.status >= 500
}

/** 服务端有的接口直接回对象（心跳、领任务、绑定码），有的包一层 { success, data }。 */
export function unwrap(payload) {
  if (payload && typeof payload === 'object' && !Array.isArray(payload) && 'success' in payload && 'data' in payload) return payload.data
  return payload
}

export function errorText(err) {
  return err instanceof Error ? err.message : String(err)
}

/**
 * @param {{ apiBaseUrl: string, method: string, path: string, body?: unknown, form?: FormData,
 *           credential?: { terminalId: string, terminalToken: string } | null,
 *           headers?: Record<string,string>, retries?: number, timeoutMs?: number, signal?: AbortSignal }} req
 */
export async function apiRequest(req) {
  const retries = req.retries ?? 3
  const url = `${req.apiBaseUrl.replace(/\/+$/, '')}${req.path}`
  for (let attempt = 0; ; attempt++) {
    try {
      const headers = { Accept: 'application/json', Connection: 'close' }
      if (req.credential) {
        headers['Authorization'] = `Bearer ${req.credential.terminalToken}`
        headers['X-Terminal-Id'] = req.credential.terminalId
      }
      let body
      if (req.form) {
        body = req.form
      } else if (req.body !== undefined) {
        headers['Content-Type'] = 'application/json'
        body = JSON.stringify(req.body)
      }
      Object.assign(headers, req.headers ?? {})
      const signals = [AbortSignal.timeout(req.timeoutMs ?? 30_000)]
      if (req.signal) signals.push(req.signal)
      const response = await fetch(url, { method: req.method, headers, body, signal: AbortSignal.any(signals) })
      const text = await response.text()
      let payload = null
      try {
        payload = text ? JSON.parse(text) : null
      } catch {
        payload = null
      }
      if (!response.ok) {
        throw new HttpError(response.status, payload?.error?.code, payload?.error?.message, response.headers.get('retry-after'))
      }
      return unwrap(payload)
    } catch (err) {
      if (req.signal?.aborted || attempt >= retries || !isRetryable(err)) throw err
      await sleep((attempt + 1) * 2_000)
    }
  }
}

// ── 命令行参数 ──────────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const positional = []
  const options = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) {
      positional.push(arg)
      continue
    }
    const eq = arg.indexOf('=')
    const key = eq > 0 ? arg.slice(2, eq) : arg.slice(2)
    let value
    if (eq > 0) value = arg.slice(eq + 1)
    else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) value = argv[++i]
    else value = 'true'
    if (options[key] === undefined) options[key] = value
    else options[key] = [].concat(options[key], value)
  }
  return { positional, options }
}

export function readPrinterMode(paths) {
  let raw
  try {
    raw = readFileSync(paths.printer, 'utf8').trim().toLowerCase()
  } catch {
    return { mode: 'ready', raw: null, valid: true }
  }
  if (!raw) return { mode: 'ready', raw, valid: true }
  if (PRINTER_MODES.includes(raw)) return { mode: raw, raw, valid: true }
  return { mode: 'ready', raw, valid: false }
}
