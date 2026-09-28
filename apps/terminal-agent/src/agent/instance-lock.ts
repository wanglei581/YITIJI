/**
 * Process-lifetime singleton.
 *
 * Windows owns a named pipe for the lifetime of the process. POSIX development
 * hosts use a Unix domain socket; a socket left by a crashed process is probed
 * before it is removed. agent.pid is diagnostic data only and never gates startup.
 *
 * Only the Windows path is the production guarantee: libuv creates the pipe with
 * FILE_FLAG_FIRST_PIPE_INSTANCE, so a second server fails atomically (EADDRINUSE).
 * The POSIX probe-unlink-listen sequence has a small race between two processes
 * that both see a stale socket; it serves development hosts only.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { err, log } from '../logger'
import { writeStartupDiagnosticSafely } from './startup-diagnostics'

const PROGRAM_DATA_DIR = 'AIJobPrintAgent'
const INSTANCE_ID_FILE = 'instance-id'
const PID_FILE = 'agent.pid'
const UNIX_SOCKET_FILE = 'agent.sock'
const MACHINE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/

interface OwnedLock { endpoint: string; pidPath: string; unixSocket: boolean; server: net.Server }
let ownedLock: OwnedLock | null = null

function stateDir(): string {
  return path.join(process.env['PROGRAMDATA'] || os.tmpdir(), PROGRAM_DATA_DIR)
}

export function getLockPath(): string { return path.join(stateDir(), PID_FILE) }
export function getInstanceIdentityPath(): string { return path.join(stateDir(), INSTANCE_ID_FILE) }

// 首次启动时由服务（LocalSystem）在只有 SYSTEM 与管理员可写的状态目录里生成随机标识。
// 缺文件就生成；两个进程同时生成时独占创建只有一个成功，另一个读取它写好的那份；
// 读得到但格式不对（被改过）仍然拒绝启动，绝不退回固定管道名。
function createMachineIdentity(file: string): string {
  const value = crypto.randomBytes(16).toString('hex')
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, `${value}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 })
    return value
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      try { return fs.readFileSync(file, 'utf8').trim() } catch { /* fall through to fail-closed */ }
    }
    throw new Error(`machine_identity_unavailable: cannot create ${file}`)
  }
}

function readMachineIdentity(): string {
  const file = getInstanceIdentityPath()
  let value: string
  try { value = fs.readFileSync(file, 'utf8').trim() }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error(`machine_identity_unavailable: cannot read ${file}`)
    value = createMachineIdentity(file)
  }
  if (!MACHINE_ID_RE.test(value)) throw new Error(`machine_identity_invalid: ${file}`)
  return value
}

// Unix 套接字路径有长度上限（macOS sun_path 104 字节、Linux 108 字节，含结尾 NUL）。超长时 libuv
// 会静默截断路径再绑定，而清理残留时 unlink 用的是完整路径——删不到截断后的真文件，崩溃后
// 就永远判成「重复实例」、再也起不来（2026-09-28 验收时在 107 字节的临时路径上实测复现）。
// 所以超长时换成临时目录里按状态目录哈希命名的短路径；都放不下就明确拒绝，绝不静默截断。
const MAX_UNIX_SOCKET_PATH_BYTES = 100

function unixSocketPath(): string {
  const preferred = path.join(stateDir(), UNIX_SOCKET_FILE)
  const digest = crypto.createHash('sha256').update(stateDir()).digest('hex').slice(0, 16)
  const shortName = `aijobprintagent-${digest}.sock`
  for (const candidate of [preferred, path.join(os.tmpdir(), shortName), path.join('/tmp', shortName)]) {
    if (Buffer.byteLength(candidate) <= MAX_UNIX_SOCKET_PATH_BYTES) return candidate
  }
  throw new Error(`socket_path_too_long: ${preferred}`)
}

function endpointFor(): { endpoint: string; unixSocket: boolean } {
  if (process.platform === 'win32') {
    // Never fall back to a fixed pipe name on an unprovisioned host.
    return { endpoint: `\\\\.\\pipe\\AIJobPrintAgent-${readMachineIdentity()}`, unixSocket: false }
  }
  return { endpoint: unixSocketPath(), unixSocket: true }
}

function writePidDiagnostic(): void {
  try {
    fs.mkdirSync(stateDir(), { recursive: true })
    fs.writeFileSync(getLockPath(), `${process.pid}\n`, { encoding: 'utf8', mode: 0o600 })
  } catch (error) {
    err(`instance-lock: could not write diagnostic agent.pid: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function listen(server: net.Server, endpoint: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => { server.removeListener('listening', onListening); reject(error) }
    const onListening = () => { server.removeListener('error', onError); resolve() }
    server.once('error', onError)
    server.once('listening', onListening)
    server.listen(endpoint)
  })
}

function probeUnixSocket(endpoint: string): Promise<'live' | 'stale' | 'missing' | 'unavailable'> {
  return new Promise((resolve) => {
    const socket = net.createConnection(endpoint)
    let settled = false
    const finish = (result: 'live' | 'stale' | 'missing' | 'unavailable') => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(result)
    }
    socket.once('connect', () => finish('live'))
    socket.once('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'ECONNREFUSED') finish('stale')
      else if (error.code === 'ENOENT') finish('missing')
      else finish('unavailable')
    })
  })
}

// 绑定之后核对所有权：连回端点，读服务端报出的本进程令牌。POSIX 上「探测残留 → 删除 → 监听」
// 两个进程同时做时，后到者会删掉先到者刚建好的套接字文件，两边都 listen 成功；核对时先到者
// 连到的是后到者，令牌对不上就自行退出，于是只有真正占住路径的一个成功。
function verifyOwnership(endpoint: string, token: string): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection(endpoint)
    let data = ''
    let settled = false
    const finish = (owned: boolean) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      resolve(owned)
    }
    const timer = setTimeout(() => finish(false), 2_000)
    socket.setEncoding('utf8')
    socket.on('data', (chunk: string) => { data += chunk })
    socket.once('end', () => finish(data === token))
    socket.once('error', () => finish(false))
  })
}

export type LockAcquireResult =
  | { status: 'acquired'; lockPath: string }
  | { status: 'duplicate'; lockPath: string; existingPid: number }
  | { status: 'unavailable'; lockPath: string; reason: string }

async function bindAndVerify(endpoint: string, unixSocket: boolean): Promise<LockAcquireResult> {
  const token = crypto.randomBytes(16).toString('hex')
  // 连接方随时可能在读令牌之前就断开（重复实例的探测就是连上即断），这时回令牌会报 EPIPE / ECONNRESET。
  // 连接上的错误必须就地吞掉：没人接的 socket 错误会冒成 uncaughtException，Agent 主程序据此退出——
  // 等于本机任何进程连一下管道再断开就能把持有者打挂（2026-09-29 Linux CI 实测，本机连续探测可复现）。
  const server = net.createServer((socket) => {
    socket.on('error', () => { /* client left before reading the token */ })
    socket.end(token)
  })
  try {
    await listen(server, endpoint)
  } catch (error) {
    server.close()
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'EADDRINUSE') return { status: 'duplicate', lockPath: endpoint, existingPid: 0 }
    return { status: 'unavailable', lockPath: endpoint, reason: `listen_${code ?? 'failed'}` }
  }
  // listen() 建立后已摘掉临时的 error 监听；此后端点自身的错误（如 accept 失败）只记日志，不能把 Agent 带崩。
  server.on('error', (error) => err(`instance-lock: singleton endpoint error: ${error.message}`))
  if (!(await verifyOwnership(endpoint, token))) {
    // 路径已归别的实例：只关自己的监听，不删路径（它属于胜出者）。
    server.close()
    return { status: 'duplicate', lockPath: endpoint, existingPid: 0 }
  }
  ownedLock = { server, endpoint, pidPath: getLockPath(), unixSocket }
  writePidDiagnostic()
  return { status: 'acquired', lockPath: endpoint }
}

async function acquireUnixSocket(endpoint: string): Promise<LockAcquireResult> {
  const probe = await probeUnixSocket(endpoint)
  if (probe === 'live') return { status: 'duplicate', lockPath: endpoint, existingPid: 0 }
  if (probe === 'unavailable') return { status: 'unavailable', lockPath: endpoint, reason: 'socket_probe_failed' }
  if (probe === 'stale') {
    try { fs.unlinkSync(endpoint) }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        return { status: 'unavailable', lockPath: endpoint, reason: 'stale_socket_remove_failed' }
      }
    }
  }
  return bindAndVerify(endpoint, true)
}

// POSIX 的「探测 → 删残留 → 监听 → 核对」必须串行：用独占创建的守护文件做一个很短的互斥区，
// 否则两个同时启动的进程会互删对方刚建好的套接字文件（2026-09-28 实测 5 次 4 次两个都拿到锁）。
// 守护文件只在这一小段里存在；持有者若恰好在这一段崩溃，超过 10 秒视为残留。Windows 不走这里。
const UNIX_GUARD_STALE_MS = 10_000
const UNIX_GUARD_ATTEMPTS = 50
const UNIX_GUARD_RETRY_MS = 100

async function withUnixGuard(endpoint: string, fn: () => Promise<LockAcquireResult>): Promise<LockAcquireResult> {
  const guard = `${endpoint}.lock`
  for (let attempt = 0; attempt < UNIX_GUARD_ATTEMPTS; attempt += 1) {
    let fd: number
    try {
      fd = fs.openSync(guard, 'wx')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        return { status: 'unavailable', lockPath: endpoint, reason: 'socket_guard_failed' }
      }
      try { if (Date.now() - fs.statSync(guard).mtimeMs > UNIX_GUARD_STALE_MS) fs.unlinkSync(guard) } catch { /* raced with the holder */ }
      await new Promise((resolve) => setTimeout(resolve, UNIX_GUARD_RETRY_MS))
      continue
    }
    fs.closeSync(fd)
    try { return await fn() } finally { try { fs.unlinkSync(guard) } catch { /* already gone */ } }
  }
  return { status: 'unavailable', lockPath: endpoint, reason: 'socket_guard_busy' }
}

export async function tryAcquireLock(): Promise<LockAcquireResult> {
  if (ownedLock) return { status: 'acquired', lockPath: ownedLock.endpoint }
  let endpointInfo: { endpoint: string; unixSocket: boolean }
  try { endpointInfo = endpointFor() }
  catch (error) {
    return { status: 'unavailable', lockPath: getLockPath(), reason: error instanceof Error ? error.message : String(error) }
  }
  fs.mkdirSync(stateDir(), { recursive: true })
  if (endpointInfo.unixSocket) return withUnixGuard(endpointInfo.endpoint, () => acquireUnixSocket(endpointInfo.endpoint))
  return bindAndVerify(endpointInfo.endpoint, false)
}

function failClosed(result: Exclude<LockAcquireResult, { status: 'acquired' }>): never {
  const reason = result.status === 'duplicate' ? 'duplicate' : result.reason
  const code = result.status === 'duplicate' ? 'DUPLICATE_INSTANCE' : 'INSTANCE_LOCK_UNAVAILABLE'
  writeStartupDiagnosticSafely(code, {
    details: { reason, pathPresent: true, pathKind: 'unavailable', pidParsed: false },
    onFailure: () => err('AGENT_DIAGNOSTIC_UNAVAILABLE: startup diagnostic could not be written.'),
  })
  err(`${code}: reason=${reason} lockPath=${result.lockPath}. The process-lifetime singleton is unavailable; do not delete agent.pid.`)
  process.exit(1)
  throw new Error('unreachable')
}

export async function acquireLock(): Promise<void> {
  const result = await tryAcquireLock()
  if (result.status !== 'acquired') failClosed(result)
  log(`instance-lock: acquired (${result.lockPath})`)
}

export function releaseLock(): void {
  const owned = ownedLock
  ownedLock = null
  if (!owned) return
  owned.server.close()
  if (owned.unixSocket) {
    try { fs.unlinkSync(owned.endpoint) } catch { /* already removed or OS-cleaned */ }
  }
  log('instance-lock: released')
}

export function __resetInstanceLockForTests(): void { releaseLock() }

/** 测试入口：跨平台验证机器标识的生成、复用与防篡改（生产只在 Windows 管道名里用到它）。 */
export function __readMachineIdentityForTests(): string { return readMachineIdentity() }
