/**
 * 走查 W-86：同一任务号按 attempt 重打。
 *
 * 真实 task-runner + 真实 db.ts + 临时 SQLite。只把 HTTP 与打印命令换成桩。
 * 不碰 Windows 打印机。
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import {
  bindPrintAttempt,
  getTaskLocalErrorCode,
  getTaskLocalStatus,
  isTaskDone,
  markTaskDone,
  openDatabase,
} from '../src/agent/db'
import {
  __resetClaimRateLimitForTests,
  __setExecuteTaskTestSeamsForTests,
  executeTask,
} from '../src/agent/task-runner'
import { __setUnauthorizedMarkerPathForTests } from '../src/agent/auth-state'
import type { AgentConfig, ClaimTask } from '../src/agent/types'
import type { PrintResult } from '../src/printer/types'

const PDF = Buffer.from('%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
const PAPER_TASK = 'paper-retry-task'

function pass(message: string): void {
  console.log(`PASS ${message}`)
}

function config(apiBaseUrl: string): AgentConfig {
  return {
    apiBaseUrl,
    terminalCode: 'VERIFY-RETRY',
    terminalId: 'terminal-retry',
    agentToken: 'retry-token',
    printerName: 'Verify Printer',
    agentVersion: '0.4.12',
  }
}

function claim(taskId: string, fileUrl: string, attempt?: number): ClaimTask {
  const task: ClaimTask = {
    taskId,
    type: 'print',
    fileUrl,
    fileMd5: '',
    actionToken: 'action-token',
    claimedBy: 'terminal-retry',
    claimExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    createdAt: new Date().toISOString(),
    fileName: 'sample.pdf',
    mimeType: 'application/pdf',
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
  if (attempt !== undefined) task.attempt = attempt
  return task
}

function printResult(success: boolean, file: string, printer: string, errorCode?: 'PAPER_EMPTY'): PrintResult {
  const now = new Date().toISOString()
  return {
    success,
    method: 'pdf-to-printer',
    printer,
    file,
    startedAt: now,
    finishedAt: now,
    durationMs: 1,
    ...(errorCode ? { errorCode, errorMessage: '打印机缺纸' } : {}),
  }
}

interface PatchRecord {
  url: string
  body: Record<string, unknown>
}

function startServer(): Promise<{
  origin: string
  patches: PatchRecord[]
  close: () => Promise<void>
}> {
  const patches: PatchRecord[] = []
  const server = http.createServer((req, res) => {
    const url = req.url ?? ''
    if (req.method === 'GET' && url.startsWith('/files/')) {
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Content-Length': String(PDF.length) })
      res.end(PDF)
      return
    }
    if (req.method === 'PATCH' && url.includes('/print-tasks/')) {
      const chunks: Buffer[] = []
      req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
      req.on('end', () => {
        const raw = Buffer.concat(chunks).toString('utf8')
        patches.push({ url, body: raw ? JSON.parse(raw) as Record<string, unknown> : {} })
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end('{"acknowledged":true}')
      })
      return
    }
    res.writeHead(404)
    res.end()
  })
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (!addr || typeof addr === 'string') {
        reject(new Error('测试 HTTP 没有分到端口'))
        return
      }
      resolve({
        origin: `http://127.0.0.1:${addr.port}`,
        patches,
        close: () => new Promise((done) => server.close(() => done())),
      })
    })
  })
}

function patchesFor(patches: PatchRecord[], taskId: string): PatchRecord[] {
  return patches.filter((item) => item.url.includes(`/print-tasks/${taskId}/status`))
}

function verifyLegacyRowsSurvive(): void {
  const root = mkdtempSync(join(tmpdir(), 'agent-retry-legacy-'))
  const previous = process.env['PROGRAMDATA']
  const dbDir = join(root, 'AIJobPrintAgent')
  mkdirSync(dbDir, { recursive: true })
  const legacy = new Database(join(dbDir, 'agent.db'))
  const createdAt = '2020-01-01T00:00:00.000Z'
  legacy.exec(
    'CREATE TABLE print_tasks (taskId TEXT PRIMARY KEY, status TEXT NOT NULL, completedAt TEXT, createdAt TEXT NOT NULL)',
  )
  legacy.prepare(
    'INSERT INTO print_tasks (taskId, status, completedAt, createdAt) VALUES (?, ?, ?, ?)',
  ).run('legacy-kept', 'completed', createdAt, createdAt)
  legacy.close()

  process.env['PROGRAMDATA'] = root
  let db: ReturnType<typeof openDatabase> = null
  try {
    db = openDatabase()
    assert.ok(db, '旧库必须能打开并完成主键迁移')
    const row = db.prepare(
      'SELECT taskId, attempt, status, createdAt FROM print_tasks WHERE taskId = ?',
    ).get('legacy-kept') as { attempt: number; status: string; createdAt: string } | undefined
    assert.ok(row, '旧行不得丢')
    assert.equal(row.attempt, 0)
    assert.equal(row.status, 'completed')
    assert.equal(row.createdAt, createdAt)
    assert.equal(isTaskDone(db, 'legacy-kept', 0), true)
    assert.equal(isTaskDone(db, 'legacy-kept', 1), false, '更大的 attempt 不能算已经做过')
    markTaskDone(db, 'legacy-kept', 'failed', 1)
    db.close()
    db = null
    db = openDatabase()
    assert.ok(db, '迁移后的库必须能再次打开')
    const rows = db.prepare(
      'SELECT attempt, status FROM print_tasks WHERE taskId = ? ORDER BY attempt',
    ).all('legacy-kept') as Array<{ attempt: number; status: string }>
    assert.deepEqual(rows, [
      { attempt: 0, status: 'completed' },
      { attempt: 1, status: 'failed' },
    ])
    pass('旧 print_tasks 迁移后 attempt=0 的行仍在，更大的 attempt 另记一行')
  } finally {
    db?.close()
    if (previous === undefined) delete process.env['PROGRAMDATA']
    else process.env['PROGRAMDATA'] = previous
    rmSync(root, { recursive: true, force: true })
  }
}

async function verifyRetryAttempt(): Promise<void> {
  const root = mkdtempSync(join(tmpdir(), 'agent-retry-runtime-'))
  const previous = process.env['PROGRAMDATA']
  process.env['PROGRAMDATA'] = root
  __setUnauthorizedMarkerPathForTests(join(root, 'missing-unauthorized'))
  __resetClaimRateLimitForTests()
  const db = openDatabase()
  assert.ok(db, '运行时临时库必须打开')
  const server = await startServer()
  let prints = 0
  __setExecuteTaskTestSeamsForTests({
    printCommand: async (file, printer, _params, options) => {
      const id = options?.correlationId ?? ''
      if (id !== PAPER_TASK) throw new Error(`打印桩被意外调用: ${id}`)
      prints += 1
      if (prints === 1) return printResult(false, file, printer, 'PAPER_EMPTY')
      return printResult(true, file, printer)
    },
    monitorDependencies: {
      platform: 'win32',
      queryStatus: async () => ({ status: 'completed' }),
      sleep: async () => undefined,
      queryCompletionEvent: async () => false,
    },
  })
  const agent = config(`${server.origin}/api/v1`)
  const fileUrl = `${server.origin}/files/sample.pdf`

  try {
    await executeTask(claim(PAPER_TASK, fileUrl, 0), agent, db)
    assert.equal(prints, 1, 'attempt 0 缺纸必须真的调用一次打印桩')
    assert.equal(getTaskLocalStatus(db, PAPER_TASK, 0), 'failed')
    assert.equal(getTaskLocalErrorCode(db, PAPER_TASK, 0), 'PAPER_EMPTY')
    assert.equal(isTaskDone(db, PAPER_TASK, 1), false)
    const firstFail = patchesFor(server.patches, PAPER_TASK).filter((item) => item.body['status'] === 'failed')
    assert.equal(firstFail.at(-1)?.body['errorCode'], 'PAPER_EMPTY')
    pass('attempt 0 缺纸：调用一次打印桩并回报 PAPER_EMPTY')

    const printsAfterFail = prints
    await executeTask(claim(PAPER_TASK, fileUrl), agent, db)
    assert.equal(prints, printsAfterFail, '老服务端不带 attempt 时不得再次打印')
    const replay = patchesFor(server.patches, PAPER_TASK).filter((item) => item.body['status'] === 'failed')
    assert.equal(replay.at(-1)?.body['errorCode'], 'PAPER_EMPTY', '重报 failed 必须带回原来的 errorCode')
    assert.equal(getTaskLocalStatus(db, PAPER_TASK, 0), 'failed')
    pass('老服务端不带 attempt：按 attempt 0 重报 failed，并保留 PAPER_EMPTY')

    await executeTask(claim(PAPER_TASK, fileUrl, 1), agent, db)
    assert.equal(prints, printsAfterFail + 1, 'attempt 1 必须再调用一次打印桩')
    assert.equal(getTaskLocalStatus(db, PAPER_TASK, 1), 'completed')
    assert.equal(getTaskLocalStatus(db, PAPER_TASK, 0), 'failed')
    assert.equal(getTaskLocalErrorCode(db, PAPER_TASK, 0), 'PAPER_EMPTY')
    const completed = patchesFor(server.patches, PAPER_TASK).filter((item) => item.body['status'] === 'completed')
    assert.equal(completed.length, 1)
    pass('attempt 1：重新打印并回报 completed，attempt 0 的缺纸行不变')

    await executeTask(claim(PAPER_TASK, fileUrl, 1), agent, db)
    assert.equal(prints, printsAfterFail + 1, '同一 attempt 再领不得再调打印桩')
    const completedAgain = patchesFor(server.patches, PAPER_TASK).filter((item) => item.body['status'] === 'completed')
    assert.equal(completedAgain.length, 2, '重复领取只重报 completed')
    pass('attempt 1 再领：不再打印，只重报 completed')

    const dispatchId = 'dispatch-unconfirmed'
    markTaskDone(db, dispatchId, 'dispatching', 0)
    bindPrintAttempt(db, 0)
    const beforeDispatch = prints
    await executeTask(claim(dispatchId, fileUrl, 0), agent, db)
    assert.equal(prints, beforeDispatch, '本地 dispatching 不得打印')
    const unconfirmed = patchesFor(server.patches, dispatchId)
    assert.equal(unconfirmed.length, 1)
    assert.equal(unconfirmed[0]?.body['status'], 'failed')
    assert.equal(unconfirmed[0]?.body['errorCode'], 'PRINT_JOB_UNCONFIRMED')
    assert.equal(getTaskLocalStatus(db, dispatchId, 0), 'failed')
    pass('attempt 0 且本地 dispatching：报 PRINT_JOB_UNCONFIRMED，不打印')
  } finally {
    __setExecuteTaskTestSeamsForTests(null)
    await server.close()
    db.close()
    if (previous === undefined) delete process.env['PROGRAMDATA']
    else process.env['PROGRAMDATA'] = previous
    __setUnauthorizedMarkerPathForTests(undefined)
    rmSync(root, { recursive: true, force: true })
  }
}

async function main(): Promise<void> {
  verifyLegacyRowsSurvive()
  await verifyRetryAttempt()
  pass('verify:print-retry-attempt 全部通过')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
