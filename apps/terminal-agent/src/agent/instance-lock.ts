/**
 * agent/instance-lock.ts — Phase 8.1C (patched 8.2C-fix)
 *
 * Single-instance guarantee using a PID file lock.
 *
 * On startup, acquireLock() checks whether an existing PID file refers to a live process:
 *   process.kill(existingPid, 0)
 *     ESRCH  → process does not exist → stale lock → take over (overwrite PID file)
 *     EPERM  → Windows ambiguous: use tasklist (Win) / kill-0 fallback (macOS) to verify
 *     (no error) → process exists → DUPLICATE_INSTANCE → exit(1)
 *
 * Windows EPERM fix (Phase 8.2C):
 *   On Windows, process.kill(pid, 0) often throws EPERM for *any* cross-process signal,
 *   including live same-user processes. The previous mtime-based fallback (5-min threshold)
 *   incorrectly treated long-running agents as stale after 5 minutes, allowing duplicate
 *   instances. Now we use `tasklist /FI "PID eq <pid>"` as the authoritative check on
 *   Windows so a running agent is never treated as stale regardless of uptime.
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
import { spawnSync } from 'child_process'
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

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Check whether a PID corresponds to a running process using OS-level tools.
 *
 * Windows: uses `tasklist /FI "PID eq <pid>"` — reliable regardless of privilege.
 * macOS/Linux: uses process.kill(pid, 0) which is accurate on POSIX.
 *
 * Returns true if the process is alive, false if dead / not found.
 */
function isProcessAlive(pid: number): boolean {
  if (process.platform === 'win32') {
    // tasklist /FI filters by PID; CSV output with /FO CSV /NH avoids header.
    // If PID exists, output contains "<name>","<pid>",... ; if not, it's empty or INFO line.
    const result = spawnSync(
      'tasklist',
      ['/FI', `PID eq ${pid}`, '/FO', 'CSV', '/NH'],
      { encoding: 'utf-8', timeout: 4_000 },
    )
    if (result.error || result.status !== 0) {
      // tasklist unavailable — fall back to treating as alive (safe: causes exit(1))
      return true
    }
    const stdout = (result.stdout ?? '').trim()
    // If PID is found, stdout contains the quoted PID e.g. ,"20352",
    return stdout.includes(`,"${pid}",`)
  }

  // POSIX: signal 0 is accurate
  try {
    process.kill(pid, 0)
    return true // no throw → alive
  } catch (e: unknown) {
    const code = (e as NodeJS.ErrnoException).code
    return code !== 'ESRCH' // ESRCH → dead; anything else (EPERM) → assume alive
  }
}

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
      const processAlive = isProcessAlive(existingPid)

      if (processAlive) {
        err(
          `DUPLICATE_INSTANCE: agent already running (pid=${existingPid}). ` +
            `If this is incorrect, delete ${pidFile} and restart.`,
        )
        process.exit(1)
      } else {
        log(`instance-lock: stale lock detected (pid=${existingPid} is gone), taking over`)
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
