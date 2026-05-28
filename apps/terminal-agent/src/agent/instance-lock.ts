/**
 * agent/instance-lock.ts — Phase 8.1C
 *
 * Single-instance guarantee using a PID file lock.
 *
 * On startup, acquireLock() checks whether an existing PID file refers to a live process:
 *   process.kill(existingPid, 0)
 *     ESRCH  → process does not exist → stale lock → take over (overwrite PID file)
 *     EPERM  → process exists but we lack permission → treat as "running" → exit(1)
 *     (no error) → process exists → DUPLICATE_INSTANCE → exit(1)
 *
 * releaseLock() should be called on graceful shutdown to allow immediate clean restart.
 * process.on('exit', releaseLock) provides a safety-net for unexpected exits.
 *
 * Lock file paths:
 *   Windows: %ProgramData%\AIJobPrintAgent\agent.pid
 *   macOS:   $TMPDIR/AIJobPrintAgent/agent.pid
 */

import fs from 'fs'
import path from 'path'
import os from 'os'
import { log, err } from '../logger'

// ── Path ──────────────────────────────────────────────────────────────────────

function getLockPath(): string {
  const base = process.env['PROGRAMDATA']
    ? path.join(process.env['PROGRAMDATA'], 'AIJobPrintAgent')
    : path.join(os.tmpdir(), 'AIJobPrintAgent')
  return path.join(base, 'agent.pid')
}

// Module-level lock path so releaseLock() knows what to clean up.
let _lockPath: string | null = null

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Acquire the single-instance lock.
 * If another live instance already holds the lock, logs an error and calls process.exit(1).
 */
export function acquireLock(): void {
  const pidFile = getLockPath()
  fs.mkdirSync(path.dirname(pidFile), { recursive: true })

  // Check an existing lock file
  if (fs.existsSync(pidFile)) {
    const raw = fs.readFileSync(pidFile, 'utf-8').trim()
    const existingPid = parseInt(raw, 10)

    if (!isNaN(existingPid) && existingPid !== process.pid) {
      let processAlive = false
      try {
        process.kill(existingPid, 0)
        // No error → process is running
        processAlive = true
      } catch (e: unknown) {
        const nodeErr = e as NodeJS.ErrnoException
        if (nodeErr.code === 'ESRCH') {
          // POSIX: process does not exist → stale lock, safe to take over
          log(`instance-lock: stale lock detected (pid=${existingPid} is gone), taking over`)
          processAlive = false
        } else if (nodeErr.code === 'EPERM') {
          // EPERM is ambiguous on Windows: it can mean the PID belongs to a
          // privileged process (stale, recycled PID) OR the process is alive.
          // Use PID file mtime as a secondary signal: if the file is older than
          // 5 minutes and the current process just started, it is almost
          // certainly stale. For safety, default to alive if file is recent.
          try {
            const stat = fs.statSync(pidFile)
            const ageMs = Date.now() - stat.mtimeMs
            if (ageMs > 5 * 60 * 1000) {
              log(
                `instance-lock: EPERM on pid=${existingPid} but lock file is ${Math.round(ageMs / 1000)}s old — treating as stale, taking over`,
              )
              processAlive = false
            } else {
              processAlive = true
            }
          } catch {
            processAlive = true
          }
        } else {
          // Unknown error code → assume alive to be safe
          processAlive = true
        }
      }

      if (processAlive) {
        err(
          `DUPLICATE_INSTANCE: agent already running (pid=${existingPid}). ` +
            `If this is incorrect, delete ${pidFile} and restart.`,
        )
        process.exit(1)
      }
    }
  }

  // Write our own PID
  fs.writeFileSync(pidFile, String(process.pid), 'utf-8')
  _lockPath = pidFile
  log(`instance-lock: acquired (pid=${process.pid})`)
}

/**
 * Release the PID file lock.
 * Safe to call multiple times or before acquireLock() (no-op in those cases).
 */
export function releaseLock(): void {
  if (_lockPath && fs.existsSync(_lockPath)) {
    try {
      fs.unlinkSync(_lockPath)
      log('instance-lock: released')
    } catch {
      // Best-effort; the OS reclaims the file handle on process exit anyway
    }
  }
}
