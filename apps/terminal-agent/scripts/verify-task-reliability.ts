import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { processPatch } from '../src/agent/offline-queue'
import {
  getDeadLetterPatches,
  getPendingPatches,
  getTaskLocalStatus,
  markTaskDone,
  openDatabase,
  type AgentDatabase,
  type PendingPatch,
} from '../src/agent/db'
import { executeTask } from '../src/agent/task-runner'
import { __setUnauthorizedMarkerPathForTests } from '../src/agent/auth-state'
import type { AgentConfig, ClaimTask } from '../src/agent/types'

interface DbEffects {
  deleted: boolean
  deadLettered: boolean
}

function trackingDb(effects: DbEffects): AgentDatabase {
  return {
    exec() { return this },
    close() {},
    prepare(sql: string) {
      return {
        run() {
          if (/DELETE FROM pending_patches/.test(sql)) effects.deleted = true
          if (/deadLetterAt|deadLetterReason/.test(sql)) effects.deadLettered = true
          return { lastInsertRowid: 1, changes: 1 }
        },
        get() { return undefined },
        all() { return [] },
      }
    },
  }
}

function config(): AgentConfig {
  return {
    apiBaseUrl: 'http://127.0.0.1:1/api/v1',
    terminalCode: 'T-RELIABILITY',
    terminalId: 'terminal-reliability',
    agentToken: 'agent-token',
    printerName: 'Test Printer',
    agentVersion: 'verify',
  }
}

function pendingPatch(attempts: number): PendingPatch {
  return {
    id: attempts + 1,
    taskId: `task-${attempts}`,
    status: 'completed',
    errorCode: null,
    errorMessage: null,
    attempts,
    nextRetryAt: new Date(0).toISOString(),
    createdAt: new Date(0).toISOString(),
    deadLetterAt: null,
    deadLetterReason: null,
  }
}

async function verifyFourHundredPatchBecomesDurableDeadLetter(): Promise<void> {
  const effects = { deleted: false, deadLettered: false }
  await processPatch(pendingPatch(0), config(), trackingDb(effects), async () => {
    throw { isAxiosError: true, response: { status: 409 } }
  })
  assert.equal(effects.deleted, false, 'a terminal status rejected with 4xx must not be deleted')
  assert.equal(effects.deadLettered, true, 'a terminal status rejected with 4xx must be durably dead-lettered')
}

async function verifyRetryLimitBecomesDurableDeadLetter(): Promise<void> {
  const effects = { deleted: false, deadLettered: false }
  await processPatch(pendingPatch(10), config(), trackingDb(effects), async () => undefined)
  assert.equal(effects.deleted, false, 'a terminal status at the retry limit must not be deleted')
  assert.equal(effects.deadLettered, true, 'a terminal status at the retry limit must be durably dead-lettered')
}

function verifyKnownTerminalTasksAreReplayed(): void {
  const source = readFileSync(join(__dirname, '../src/agent/task-runner.ts'), 'utf8')
  const knownTaskStart = source.indexOf('if (isTaskDone(db, task.taskId))')
  const mainExecutionStart = source.indexOf('const ext = inferTaskExt(task)', knownTaskStart)
  assert.ok(knownTaskStart >= 0 && mainExecutionStart > knownTaskStart)
  const knownTaskBranch = source.slice(knownTaskStart, mainExecutionStart)
  assert.match(
    knownTaskBranch,
    /localStatus === 'completed'.*patch\('completed'\)/s,
    'a re-claimed locally completed task must replay completed to the server',
  )
  assert.match(
    knownTaskBranch,
    /localStatus === 'failed'.*patch\('failed'/s,
    'a re-claimed locally failed task must replay failed to the server',
  )
}

function verifyDispatchIntentIsDurableBeforePrinterInvocation(): void {
  const source = readFileSync(join(__dirname, '../src/agent/task-runner.ts'), 'utf8')
  const dispatchPersist = source.indexOf("markTaskDone(db, task.taskId, 'dispatching')")
  const printInvocation = source.indexOf('const result = await print(')
  assert.ok(dispatchPersist >= 0, 'task-runner must persist dispatching before invoking the physical printer')
  assert.ok(printInvocation > dispatchPersist, 'dispatching must be durable before the physical printer invocation')
  assert.match(
    source,
    /localStatus === 'dispatching'.*PRINT_JOB_UNCONFIRMED/s,
    'a restarted dispatching task must reconcile as unconfirmed instead of printing again',
  )
}

async function startPatchServer(): Promise<{
  baseUrl: string
  requests: Array<{ method: string; url: string; body: Record<string, unknown> }>
  close: () => Promise<void>
}> {
  const requests: Array<{ method: string; url: string; body: Record<string, unknown> }> = []
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      requests.push({
        method: req.method ?? '',
        url: req.url ?? '',
        body: raw ? JSON.parse(raw) as Record<string, unknown> : {},
      })
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end('{"acknowledged":true}')
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  return {
    baseUrl: `http://127.0.0.1:${address.port}/api/v1`,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}

function claimTask(taskId: string): ClaimTask {
  return {
    taskId,
    type: 'print',
    fileUrl: '/must-not-download.pdf',
    fileMd5: '',
    actionToken: 'action-token',
    claimedBy: 'terminal-reliability',
    claimExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    createdAt: new Date().toISOString(),
    params: {
      copies: 1,
      colorMode: 'black_white',
      duplex: 'simplex',
      paperSize: 'A4',
      orientation: 'auto',
      quality: 'standard',
      scale: 'fit',
      pagesPerSheet: 1,
    },
  }
}

async function verifyRealDatabaseMigrationAndTerminalReplay(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'agent-reliability-verify-'))
  const previousProgramData = process.env['PROGRAMDATA']
  const dbDir = join(root, 'AIJobPrintAgent')
  mkdirSync(dbDir, { recursive: true })
  const legacy = new Database(join(dbDir, 'agent.db'))
  legacy.exec(`
    CREATE TABLE print_tasks (taskId TEXT PRIMARY KEY, status TEXT NOT NULL, completedAt TEXT, createdAt TEXT NOT NULL);
    CREATE TABLE pending_patches (
      id INTEGER PRIMARY KEY AUTOINCREMENT, taskId TEXT NOT NULL, status TEXT NOT NULL,
      errorCode TEXT, errorMessage TEXT, attempts INTEGER NOT NULL DEFAULT 0,
      nextRetryAt TEXT NOT NULL, createdAt TEXT NOT NULL
    );
  `)
  legacy.close()

  process.env['PROGRAMDATA'] = root
  __setUnauthorizedMarkerPathForTests(join(root, 'agent.unauthorized'))
  const db = openDatabase()
  assert.ok(db, 'real local agent database must open')
  const server = await startPatchServer()
  try {
    const columns = db.prepare('PRAGMA table_info(pending_patches)').all().map((row) => row['name'])
    assert.ok(columns.includes('deadLetterAt'), 'legacy local DB must add deadLetterAt')
    assert.ok(columns.includes('deadLetterReason'), 'legacy local DB must add deadLetterReason')

    const now = new Date().toISOString()
    db.prepare(
      `INSERT INTO pending_patches
       (taskId, status, attempts, nextRetryAt, createdAt) VALUES (?, ?, ?, ?, ?)`,
    ).run('real-dead-letter', 'completed', 0, now, now)
    const live = getPendingPatches(db)[0]
    assert.ok(live)
    await processPatch(live, config(), db, async () => {
      throw { isAxiosError: true, response: { status: 409 } }
    })
    assert.equal(getPendingPatches(db).length, 0, 'dead-letter rows must not remain retryable')
    assert.equal(getDeadLetterPatches(db).length, 1, 'dead-letter evidence must remain queryable')

    const replayConfig = { ...config(), apiBaseUrl: server.baseUrl }
    for (const status of ['completed', 'failed', 'dispatching'] as const) {
      markTaskDone(db, `replay-${status}`, status)
      await executeTask(claimTask(`replay-${status}`), replayConfig, db)
    }

    assert.deepEqual(
      server.requests.map((request) => request.method),
      ['PATCH', 'PATCH', 'PATCH'],
      'known local tasks must only replay status; they must never download or print',
    )
    assert.deepEqual(
      server.requests.map((request) => request.body['status']),
      ['completed', 'failed', 'failed'],
    )
    assert.equal(server.requests[2]?.body['errorCode'], 'PRINT_JOB_UNCONFIRMED')
    assert.equal(getTaskLocalStatus(db, 'replay-dispatching'), 'failed')
  } finally {
    await server.close()
    db.close()
    if (previousProgramData === undefined) delete process.env['PROGRAMDATA']
    else process.env['PROGRAMDATA'] = previousProgramData
    __setUnauthorizedMarkerPathForTests(undefined)
    rmSync(root, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  const cases: Array<[string, () => void | Promise<void>]> = [
    ['4xx dead-letter durability', verifyFourHundredPatchBecomesDurableDeadLetter],
    ['retry-limit dead-letter durability', verifyRetryLimitBecomesDurableDeadLetter],
    ['known terminal task replay', verifyKnownTerminalTasksAreReplayed],
    ['pre-print dispatch durability', verifyDispatchIntentIsDurableBeforePrinterInvocation],
    ['real DB migration and terminal replay', verifyRealDatabaseMigrationAndTerminalReplay],
  ]
  const failures: string[] = []
  for (const [name, verify] of cases) {
    try {
      await verify()
    } catch (error) {
      failures.push(name)
      console.error(`FAIL ${name}:`, error)
    }
  }
  assert.deepEqual(failures, [], `task reliability regressions failed: ${failures.join(', ')}`)
  console.log('verify-task-reliability: ok')
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
