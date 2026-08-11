import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { processPatch } from '../src/agent/offline-queue'
import {
  abandonDeadLetter,
  auditDeadLetter,
  confirmDeadLetter,
  listDeadLetters,
  parseExactDeadLetterId,
  replayDeadLetter,
  showDeadLetter,
} from '../src/agent/dead-letter-operator'
import {
  enqueuePatch,
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
    operatorConfirmedAt: null,
    resolvedAt: null,
    resolution: null,
    manualReplayAttempts: 0,
    lastManualReplayAt: null,
    manualReplayErrorCode: null,
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

async function startOperatorPatchServer(): Promise<{
  baseUrl: string
  requests: Array<{ url: string; body: Record<string, unknown> }>
  close: () => Promise<void>
}> {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = []
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      requests.push({
        url: req.url ?? '',
        body: raw ? JSON.parse(raw) as Record<string, unknown> : {},
      })
      if (req.url?.includes('task-conflict')) {
        res.writeHead(409, { 'Content-Type': 'application/json' })
        res.end('{"error":{"code":"PRINT_TASK_TERMINAL_STATUS_CONFLICT"}}')
        return
      }
      if (req.url?.includes('task-transient')) {
        res.writeHead(503, { 'Content-Type': 'application/json' })
        res.end('{"error":{"code":"SERVICE_UNAVAILABLE"}}')
        return
      }
      if (req.url?.includes('task-network')) {
        req.socket.destroy()
        return
      }
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
    for (const column of [
      'operatorConfirmedAt',
      'resolvedAt',
      'resolution',
      'manualReplayAttempts',
      'lastManualReplayAt',
      'manualReplayErrorCode',
    ]) {
      assert.ok(columns.includes(column), `legacy local DB must add ${column}`)
    }
    assert.ok(
      db.prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name = 'dead_letter_operator_audit'`,
      ).get(),
      'legacy local DB must add the durable operator action audit table',
    )

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

async function verifyDeadLetterOperatorWorkflow(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'dead-letter-operator-verify-'))
  const previousProgramData = process.env['PROGRAMDATA']
  process.env['PROGRAMDATA'] = root
  const db = openDatabase()
  assert.ok(db)
  const server = await startOperatorPatchServer()
  const operatorConfig = { ...config(), apiBaseUrl: server.baseUrl }
  const secretMarker = 'C:\\Scans\\张三-resume.pdf?token=must-not-leak'

  const seed = (taskId: string, status: string, errorMessage: string | null = null): number => {
    const now = new Date().toISOString()
    const inserted = db.prepare(
      `INSERT INTO pending_patches
       (taskId, status, errorCode, errorMessage, attempts, nextRetryAt, createdAt,
        deadLetterAt, deadLetterReason)
       VALUES (?, ?, ?, ?, 3, ?, ?, ?, 'HTTP_409')`,
    ).run(taskId, status, status === 'failed' ? 'PRINT_JOB_UNCONFIRMED' : null, errorMessage, now, now, now)
    return Number(inserted.lastInsertRowid)
  }

  const storedSensitiveFields = (id: number) =>
    db.prepare(
      `SELECT taskId, errorMessage, resolvedAt, resolution
       FROM pending_patches WHERE id = ?`,
    ).get(id)

  try {
    assert.equal(
      db.prepare('PRAGMA secure_delete').get()?.['secure_delete'],
      1,
      'local task database must request SQLite secure-delete best effort',
    )
    assert.equal(parseExactDeadLetterId('7'), 7)
    assert.throws(() => parseExactDeadLetterId('7x'), /DEAD_LETTER_ID_INVALID/)

    const successId = seed('task-success', 'completed', secretMarker)
    const safeList = listDeadLetters(db)
    const safeShow = showDeadLetter(db, successId)
    assert.doesNotMatch(JSON.stringify([safeList, safeShow]), /task-success|张三|Scans|token|resume\.pdf/i)
    assert.deepEqual(
      Object.keys(safeShow).sort(),
      [
        'attempts',
        'confirmedAt',
        'createdAt',
        'deadLetterAt',
        'deadLetterReason',
        'id',
        'lastManualReplayAt',
        'manualReplayAttempts',
        'manualReplayErrorCode',
        'resolution',
        'resolvedAt',
        'status',
      ],
    )

    await assert.rejects(
      replayDeadLetter(db, successId, operatorConfig),
      /DEAD_LETTER_CONFIRMATION_REQUIRED/,
      'manual replay must require a separate durable confirmation',
    )
    assert.equal(server.requests.length, 0)
    confirmDeadLetter(db, successId)
    const replayed = await replayDeadLetter(db, successId, operatorConfig)
    assert.deepEqual(replayed, { outcome: 'archived', errorCode: null })
    assert.equal(server.requests.length, 1)
    assert.deepEqual(server.requests[0]?.body, { status: 'completed' })
    assert.equal(listDeadLetters(db).some((row) => row.id === successId), false)
    assert.equal(showDeadLetter(db, successId).resolution, 'replayed')
    const replayedStorage = storedSensitiveFields(successId)
    assert.equal(
      replayedStorage?.['taskId'],
      `resolved-dead-letter:${successId}`,
      'resolved replay must replace the original task identifier with a local tombstone',
    )
    assert.equal(
      replayedStorage?.['errorMessage'],
      null,
      'resolved replay must scrub the raw error message',
    )

    enqueuePatch(db, 'task-success', { status: 'completed' })
    assert.equal(
      db.prepare(
        `SELECT COUNT(*) AS count FROM pending_patches
         WHERE taskId = ? AND status = ? AND resolvedAt IS NULL`,
      ).get('task-success', 'completed')?.['count'],
      1,
      'a resolved archive must not suppress a new pending patch for the same task and status',
    )

    const conflictId = seed('task-conflict', 'failed', secretMarker)
    confirmDeadLetter(db, conflictId)
    const conflicted = await replayDeadLetter(db, conflictId, operatorConfig)
    assert.deepEqual(conflicted, { outcome: 'retained', errorCode: 'HTTP_409' })
    assert.equal(showDeadLetter(db, conflictId).confirmedAt, null, '4xx must clear confirmation')
    assert.deepEqual(
      storedSensitiveFields(conflictId),
      {
        taskId: 'task-conflict',
        errorMessage: secretMarker,
        resolvedAt: null,
        resolution: null,
      },
      'a failed replay must retain the active task identifier and error evidence for operator retry',
    )
    assert.doesNotMatch(JSON.stringify(server.requests.at(-1)?.body), /errorMessage|张三|Scans|token/i)
    const requestCountAfterConflict = server.requests.length
    await assert.rejects(
      replayDeadLetter(db, conflictId, operatorConfig),
      /DEAD_LETTER_CONFIRMATION_REQUIRED/,
    )
    assert.equal(server.requests.length, requestCountAfterConflict, '409 must not enter a replay loop')

    const transientId = seed('task-transient', 'completed')
    confirmDeadLetter(db, transientId)
    const requestsBeforeTransient = server.requests.length
    const transient = await replayDeadLetter(db, transientId, operatorConfig)
    assert.deepEqual(transient, { outcome: 'retained', errorCode: 'HTTP_503' })
    assert.equal(server.requests.length, requestsBeforeTransient + 1, '5xx replay must send once')
    assert.ok(showDeadLetter(db, transientId).confirmedAt, '5xx must retain explicit confirmation')

    const networkId = seed('task-network', 'completed')
    confirmDeadLetter(db, networkId)
    const requestsBeforeNetwork = server.requests.length
    const network = await replayDeadLetter(db, networkId, operatorConfig)
    assert.deepEqual(network, { outcome: 'retained', errorCode: 'NETWORK_ERROR' })
    assert.equal(server.requests.length, requestsBeforeNetwork + 1, 'network replay must send once')
    assert.ok(showDeadLetter(db, networkId).confirmedAt)

    const printingId = seed('task-printing', 'printing')
    confirmDeadLetter(db, printingId)
    const requestsBeforeBlockedStatus = server.requests.length
    await assert.rejects(
      replayDeadLetter(db, printingId, operatorConfig),
      /DEAD_LETTER_STATUS_NOT_TERMINAL/,
    )
    assert.equal(server.requests.length, requestsBeforeBlockedStatus)

    const abandonedId = seed('task-abandoned', 'failed', secretMarker)
    assert.throws(
      () => abandonDeadLetter(db, abandonedId, 'free text with PII' as never),
      /DEAD_LETTER_ABANDON_REASON_INVALID/,
    )
    const abandoned = abandonDeadLetter(db, abandonedId, 'operator_policy')
    assert.equal(abandoned.resolution, 'abandoned')
    assert.equal(listDeadLetters(db).some((row) => row.id === abandonedId), false)
    const abandonedStorage = storedSensitiveFields(abandonedId)
    assert.equal(
      abandonedStorage?.['taskId'],
      `resolved-dead-letter:${abandonedId}`,
      'abandoned dead letter must replace the original task identifier with a local tombstone',
    )
    assert.equal(
      abandonedStorage?.['errorMessage'],
      null,
      'abandoned dead letter must scrub the raw error message',
    )

    const actions = db.prepare(
      `SELECT patchId, action, outcome, reasonCode, createdAt
       FROM dead_letter_operator_audit ORDER BY id`,
    ).all()
    assert.ok(actions.some((row) => row['action'] === 'confirm'))
    assert.ok(actions.some((row) => row['action'] === 'replay_attempt'))
    assert.ok(actions.some((row) => row['action'] === 'replay_succeeded'))
    assert.ok(actions.some((row) => row['action'] === 'replay_failed'))
    assert.ok(actions.some((row) => row['action'] === 'abandon'))
    assert.doesNotMatch(JSON.stringify(actions), /task-|张三|Scans|token|resume\.pdf/i)

    const successAudit = auditDeadLetter(db, successId)
    assert.throws(() => auditDeadLetter(db, Number.MAX_SAFE_INTEGER), /DEAD_LETTER_NOT_FOUND/)
    assert.deepEqual(
      successAudit.map((entry) => entry.action),
      ['replay_blocked', 'confirm', 'replay_attempt', 'replay_succeeded'],
      'single dead-letter audit history must remain in durable insertion order',
    )
    for (const entry of successAudit) {
      assert.deepEqual(
        Object.keys(entry).sort(),
        ['action', 'auditId', 'createdAt', 'outcome', 'reasonCode'],
        'audit read model must expose only the fixed PII-safe field whitelist',
      )
    }
    assert.ok(
      auditDeadLetter(db, conflictId).some(
        (entry) => entry.action === 'replay_failed' && entry.reasonCode === 'HTTP_409',
      ),
    )
    assert.ok(
      auditDeadLetter(db, abandonedId).some(
        (entry) => entry.action === 'abandon' && entry.reasonCode === 'operator_policy',
      ),
    )
    assert.doesNotMatch(
      JSON.stringify([
        successAudit,
        auditDeadLetter(db, conflictId),
        auditDeadLetter(db, abandonedId),
      ]),
      /task-|张三|Scans|token|resume\.pdf/i,
    )

    const appRoot = join(__dirname, '..')
    const cli = spawnSync(
      process.execPath,
      ['-r', 'ts-node/register', join(appRoot, 'src/index.ts'), 'dead-letter', 'list'],
      {
        cwd: appRoot,
        env: { ...process.env, PROGRAMDATA: root },
        encoding: 'utf8',
        timeout: 15_000,
      },
    )
    assert.equal(cli.status, 0, cli.stderr)
    assert.match(cli.stdout, /"id"/)
    assert.doesNotMatch(
      `${cli.stdout}\n${cli.stderr}`,
      new RegExp(`task-|张三|Scans|token|resume\\.pdf|${root.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i'),
    )

    const auditCli = spawnSync(
      process.execPath,
      [
        '-r',
        'ts-node/register',
        join(appRoot, 'src/index.ts'),
        'dead-letter',
        'audit',
        '--id',
        String(successId),
      ],
      {
        cwd: appRoot,
        env: { ...process.env, PROGRAMDATA: root },
        encoding: 'utf8',
        timeout: 15_000,
      },
    )
    assert.equal(auditCli.status, 0, auditCli.stderr)
    assert.match(auditCli.stdout, /"auditId"/)
    assert.doesNotMatch(`${auditCli.stdout}\n${auditCli.stderr}`, /task-|张三|Scans|token|resume\.pdf/i)
    const auditWithoutId = spawnSync(
      process.execPath,
      ['-r', 'ts-node/register', join(appRoot, 'src/index.ts'), 'dead-letter', 'audit'],
      { cwd: appRoot, env: { ...process.env, PROGRAMDATA: root }, encoding: 'utf8', timeout: 15_000 },
    )
    assert.notEqual(auditWithoutId.status, 0, 'audit CLI must never support an unscoped history read')

    const indexSource = readFileSync(join(__dirname, '../src/index.ts'), 'utf8')
    assert.match(indexSource, /registerDeadLetterCommands\(program\)/)
    const operatorSource = readFileSync(
      join(__dirname, '../src/agent/dead-letter-operator.ts'),
      'utf8',
    )
    for (const subcommand of ['list', 'show', 'confirm', 'abandon', 'replay', 'audit']) {
      assert.match(operatorSource, new RegExp(`\\.command\\('${subcommand}'\\)`))
    }
    assert.doesNotMatch(operatorSource, /\bprint\s*\(/, 'dead-letter replay must never invoke printing')
  } finally {
    await server.close()
    db.close()
    if (previousProgramData === undefined) delete process.env['PROGRAMDATA']
    else process.env['PROGRAMDATA'] = previousProgramData
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
    ['dead-letter operator workflow', verifyDeadLetterOperatorWorkflow],
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
