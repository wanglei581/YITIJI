/**
 * agent/instance-lock.ts — Phase 8.1C (patched 8.2C-fix + exclusive create)
 *
 * Single-instance guarantee using a PID file lock.
 *
 * acquireLock() creates the PID file with wx (O_CREAT|O_EXCL). Concurrent
 * starters cannot both succeed. A stale file is unlinked only after a
 * bounded re-check that a strictly parsed dead pid still owns that inode.
 * Empty, prefix, or corrupt PID bytes are unproven and are never auto-removed.
 *
 * Windows: `tasklist /FI "PID eq <pid>"` is authoritative. If tasklist
 * errors or exits nonzero, the pid is treated as alive (fail-closed).
 *
 * releaseLock() unlinks only when the path still names this process's
 * inode and pid. A successor that has taken over the same path is left
 * untouched, including from process.on('exit') during a dying predecessor.
 *
 * Lock file paths:
 *   Windows: %ProgramData%\AIJobPrintAgent\agent.pid
 *   macOS:   $TMPDIR/AIJobPrintAgent/agent.pid
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import { spawnSync } from 'child_process'
import { log, err } from '../logger'

const MAX_ACQUIRE_ATTEMPTS = 8
const STALE_RETRY_DELAY_MS = 20

export interface InstanceLockTestHooks {
  pid?: number
  platform?: NodeJS.Platform
  lockPath?: string
  spawnSync?: typeof spawnSync
  sleep?: (ms: number) => void
  writeSync?: (fd: number, data: string) => number
  fsyncSync?: (fd: number) => void
}

interface OwnedLock {
  path: string
  pid: number
  fd: number
  dev: number
  ino: number
}

let ownedLock: OwnedLock | null = null
let testHooks: InstanceLockTestHooks | undefined

export function getLockPath(): string {
  if (testHooks?.lockPath) return testHooks.lockPath
  const base = process.env['PROGRAMDATA']
    ? path.join(process.env['PROGRAMDATA'], 'AIJobPrintAgent')
    : path.join(os.tmpdir(), 'AIJobPrintAgent')
  return path.join(base, 'agent.pid')
}

export function __setInstanceLockHooksForTests(hooks?: InstanceLockTestHooks): void {
  testHooks = hooks
}

export function __resetInstanceLockForTests(): void {
  if (ownedLock) {
    try {
      fs.closeSync(ownedLock.fd)
    } catch {
      // ignore
    }
    ownedLock = null
  }
  testHooks = undefined
}

function currentPid(): number {
  return testHooks?.pid ?? process.pid
}

function sleepSync(ms: number): void {
  if (testHooks?.sleep) {
    testHooks.sleep(ms)
    return
  }
  if (ms <= 0) return
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/**
 * Check whether a PID corresponds to a running process using OS-level tools.
 *
 * Windows: uses `tasklist /FI "PID eq <pid>"` — reliable regardless of privilege.
 * macOS/Linux: uses process.kill(pid, 0) which is accurate on POSIX.
 *
 * Returns true if the process is alive, false if dead / not found.
 */
function isProcessAlive(pid: number): boolean {
  const platform = testHooks?.platform ?? process.platform
  if (platform === 'win32') {
    const spawn = testHooks?.spawnSync ?? spawnSync
    const result = spawn(
      'tasklist',
      ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'],
      { encoding: 'utf-8', timeout: 4_000 },
    )
    if (result.error || result.status !== 0) {
      // TASKLIST_FAIL_CLOSED: unavailable tasklist must never look like a dead pid.
      return true
    }
    const stdout = (result.stdout ?? '').trim()
    return stdout.includes(`,"${pid}",`)
  }

  try {
    process.kill(pid, 0)
    return true
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException).code
    return code !== 'ESRCH'
  }
}

type LockInspection =
  | { kind: 'missing' }
  | { kind: 'not-regular' }
  | { kind: 'file'; pid: number | null; dev: number; ino: number }

function parseStrictLockPid(raw: string): number | null {
  // STRICT_PID_PARSE: the whole file is one decimal pid, optional one trailing newline.
  const match = /^([1-9][0-9]{0,9})\n?$/.exec(raw)
  if (!match || match[1] === undefined) return null
  const pid = Number(match[1])
  if (!Number.isSafeInteger(pid) || pid <= 0) return null
  return pid
}

function hasProvenRemovablePid(pid: number | null): pid is number {
  // UNPROVEN_PID_FAIL_CLOSED: empty/corrupt/prefix pid is not a dead owner.
  return pid !== null
}

function inspectLockFile(pidFile: string): LockInspection {
  let stat: fs.Stats
  try {
    stat = fs.lstatSync(pidFile)
  } catch (e: unknown) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { kind: 'missing' }
    throw e
  }
  if (stat.isSymbolicLink() || !stat.isFile()) return { kind: 'not-regular' }

  const nofollow = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0
  let fd: number | undefined
  try {
    fd = fs.openSync(pidFile, fs.constants.O_RDONLY | nofollow)
    const opened = fs.fstatSync(fd)
    if (!opened.isFile()) return { kind: 'not-regular' }
    const raw = fs.readFileSync(fd, 'utf8')
    return { kind: 'file', pid: parseStrictLockPid(raw), dev: opened.dev, ino: opened.ino }
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'ENOENT') return { kind: 'missing' }
    if (code === 'ELOOP') return { kind: 'not-regular' }
    throw e
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
  }
}

function tryExclusiveCreate(pidFile: string, pid: number): OwnedLock | 'exists' | 'publication-failed' {
  let fd: number | undefined
  try {
    fd = fs.openSync(pidFile, 'wx', 0o600)
    const writeSync = testHooks?.writeSync ?? ((handle: number, data: string) => fs.writeSync(handle, data))
    const fsyncSync = testHooks?.fsyncSync ?? ((handle: number) => fs.fsyncSync(handle))
    const payload = `${pid}\n`
    const written = writeSync(fd, payload)
    // COMPLETE_PID_WRITE: a short write is publication failure, never a stale owner.
    if (written !== Buffer.byteLength(payload, 'utf8')) {
      const incomplete = new Error('incomplete pid write') as NodeJS.ErrnoException
      incomplete.code = 'EIO'
      throw incomplete
    }
    fsyncSync(fd)
    const st = fs.fstatSync(fd)
    const owned: OwnedLock = { path: pidFile, pid, fd, dev: st.dev, ino: st.ino }
    fd = undefined
    return owned
  } catch (e: unknown) {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd)
      } catch {
        // ignore
      }
    }
    // PUBLICATION_FAIL_NO_UNLINK: never path-unlink an unproven entry.
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'EEXIST' || code === 'EISDIR') return 'exists'
    return 'publication-failed'
  }
}

function tryRemoveStale(
  pidFile: string,
  observed: { pid: number | null; dev: number; ino: number },
): boolean {
  const again = inspectLockFile(pidFile)
  if (again.kind === 'missing') return true
  if (again.kind !== 'file') return false
  if (again.dev !== observed.dev || again.ino !== observed.ino) return false
  if (!hasProvenRemovablePid(observed.pid) || !hasProvenRemovablePid(again.pid)) return false
  if (again.pid !== observed.pid) return false
  const selfPid = currentPid()
  if (typeof again.pid === 'number' && again.pid !== selfPid && isProcessAlive(again.pid)) return false
  try {
    fs.unlinkSync(pidFile)
    return true
  } catch (e: unknown) {
    return (e as NodeJS.ErrnoException).code === 'ENOENT'
  }
}

export type LockAcquireResult =
  | { status: 'acquired'; lockPath: string }
  | { status: 'duplicate'; lockPath: string; existingPid: number }
  | { status: 'unavailable'; lockPath: string; reason: string }

export function tryAcquireLock(): LockAcquireResult {
  const pidFile = getLockPath()
  const pid = currentPid()
  if (ownedLock && ownedLock.path === pidFile && ownedLock.pid === pid) {
    return { status: 'acquired', lockPath: pidFile }
  }

  fs.mkdirSync(path.dirname(pidFile), { recursive: true })

  for (let attempt = 0; attempt < MAX_ACQUIRE_ATTEMPTS; attempt++) {
    const created = tryExclusiveCreate(pidFile, pid)
    if (created === 'publication-failed') {
      return { status: 'unavailable', lockPath: pidFile, reason: 'lock_publication_failed' }
    }
    if (created !== 'exists') {
      // OWNED_INODE_STILL_AT_PATH: a concurrent stale-unlinker may have replaced
      // the directory entry after wx succeeded. Only publish ownership if the
      // path still names the inode we hold open.
      let disk: fs.Stats | undefined
      try {
        disk = fs.lstatSync(pidFile)
      } catch {
        disk = undefined
      }
      if (
        !disk
        || disk.isSymbolicLink()
        || !disk.isFile()
        || disk.dev !== created.dev
        || disk.ino !== created.ino
      ) {
        try {
          fs.closeSync(created.fd)
        } catch {
          // ignore
        }
        continue
      }
      ownedLock = created
      return { status: 'acquired', lockPath: pidFile }
    }

    const existing = inspectLockFile(pidFile)
    if (existing.kind === 'missing') continue
    if (existing.kind === 'not-regular') {
      return { status: 'unavailable', lockPath: pidFile, reason: 'lock_path_not_regular_file' }
    }
    if (existing.pid !== null && existing.pid !== pid && isProcessAlive(existing.pid)) {
      return { status: 'duplicate', lockPath: pidFile, existingPid: existing.pid }
    }
    if (!hasProvenRemovablePid(existing.pid)) {
      return { status: 'unavailable', lockPath: pidFile, reason: 'lock_pid_unproven' }
    }

    if (attempt === 0) {
      log('instance-lock: stale lock detected, taking over')
    }
    tryRemoveStale(pidFile, existing)
    sleepSync(STALE_RETRY_DELAY_MS)
  }

  return { status: 'unavailable', lockPath: pidFile, reason: 'acquire_attempts_exhausted' }
}

export function acquireLock(): void {
  const result = tryAcquireLock()
  if (result.status === 'acquired') {
    log(`instance-lock: acquired (pid=${currentPid()})`)
    return
  }
  if (result.status === 'duplicate') {
    err(
      `DUPLICATE_INSTANCE: agent already running (pid=${result.existingPid}). ` +
        `If this is incorrect, delete ${result.lockPath} and restart.`,
    )
    process.exit(1)
  }
  err(`INSTANCE_LOCK_UNAVAILABLE: ${result.reason}`)
  process.exit(1)
}

export function releaseLock(): void {
  const owned = ownedLock
  ownedLock = null
  if (!owned) return
  try {
    const fdStat = fs.fstatSync(owned.fd)
    if (fdStat.dev !== owned.dev || fdStat.ino !== owned.ino) return
    let disk: fs.Stats
    try {
      disk = fs.lstatSync(owned.path)
    } catch {
      return
    }
    if (disk.isSymbolicLink() || !disk.isFile()) return
    if (disk.dev !== owned.dev || disk.ino !== owned.ino) return
    const raw = fs.readFileSync(owned.path, 'utf8').trim()
    // SUCCESSOR_PID_GUARD: never unlink a lock file whose pid is not ours.
    if (raw !== String(owned.pid)) return
    fs.unlinkSync(owned.path)
    log('instance-lock: released')
  } catch {
    // missing or raced; never unlink a successor
  } finally {
    try {
      fs.closeSync(owned.fd)
    } catch {
      // ignore
    }
  }
}
