/**
 * Process-lifetime singleton.
 *
 * Windows owns a named pipe for the lifetime of the process. POSIX development
 * hosts use a Unix domain socket; a socket left by a crashed process is probed
 * before it is removed. agent.pid is diagnostic data only and never gates startup.
 */
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
const MAX_SOCKET_RETRIES = 3

interface OwnedLock { endpoint: string; pidPath: string; unixSocket: boolean; server: net.Server }
let ownedLock: OwnedLock | null = null

function stateDir(): string {
  return path.join(process.env['PROGRAMDATA'] || os.tmpdir(), PROGRAM_DATA_DIR)
}

export function getLockPath(): string { return path.join(stateDir(), PID_FILE) }
export function getInstanceIdentityPath(): string { return path.join(stateDir(), INSTANCE_ID_FILE) }

function readMachineIdentity(): string {
  let value: string
  try { value = fs.readFileSync(getInstanceIdentityPath(), 'utf8').trim() }
  catch { throw new Error(`machine_identity_unavailable: cannot read ${getInstanceIdentityPath()}`) }
  if (!MACHINE_ID_RE.test(value)) throw new Error(`machine_identity_invalid: ${getInstanceIdentityPath()}`)
  return value
}

function endpointFor(): { endpoint: string; unixSocket: boolean } {
  if (process.platform === 'win32') {
    // Never fall back to a fixed pipe name on an unprovisioned host.
    return { endpoint: `\\\\.\\pipe\\AIJobPrintAgent-${readMachineIdentity()}`, unixSocket: false }
  }
  return { endpoint: path.join(stateDir(), UNIX_SOCKET_FILE), unixSocket: true }
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

export type LockAcquireResult =
  | { status: 'acquired'; lockPath: string }
  | { status: 'duplicate'; lockPath: string; existingPid: number }
  | { status: 'unavailable'; lockPath: string; reason: string }

export async function tryAcquireLock(): Promise<LockAcquireResult> {
  if (ownedLock) return { status: 'acquired', lockPath: ownedLock.endpoint }
  let endpointInfo: { endpoint: string; unixSocket: boolean }
  try { endpointInfo = endpointFor() }
  catch (error) {
    return { status: 'unavailable', lockPath: getLockPath(), reason: error instanceof Error ? error.message : String(error) }
  }

  fs.mkdirSync(stateDir(), { recursive: true })
  for (let attempt = 0; attempt < MAX_SOCKET_RETRIES; attempt += 1) {
    if (endpointInfo.unixSocket) {
      const probe = await probeUnixSocket(endpointInfo.endpoint)
      if (probe === 'live') return { status: 'duplicate', lockPath: endpointInfo.endpoint, existingPid: 0 }
      if (probe === 'unavailable') return { status: 'unavailable', lockPath: endpointInfo.endpoint, reason: 'socket_probe_failed' }
      if (probe === 'stale') {
        try { fs.unlinkSync(endpointInfo.endpoint) }
        catch (error) {
          const code = (error as NodeJS.ErrnoException).code
          if (code !== 'ENOENT') return { status: 'unavailable', lockPath: endpointInfo.endpoint, reason: 'stale_socket_remove_failed' }
        }
      }
    }

    const server = net.createServer((socket) => socket.destroy())
    try {
      await listen(server, endpointInfo.endpoint)
      ownedLock = { server, endpoint: endpointInfo.endpoint, pidPath: getLockPath(), unixSocket: endpointInfo.unixSocket }
      writePidDiagnostic()
      return { status: 'acquired', lockPath: endpointInfo.endpoint }
    } catch (error) {
      server.close()
      const code = (error as NodeJS.ErrnoException).code
      if (code === 'EADDRINUSE') return { status: 'duplicate', lockPath: endpointInfo.endpoint, existingPid: 0 }
      return { status: 'unavailable', lockPath: endpointInfo.endpoint, reason: `listen_${code ?? 'failed'}` }
    }
  }
  return { status: 'unavailable', lockPath: endpointInfo.endpoint, reason: 'socket_retry_exhausted' }
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
