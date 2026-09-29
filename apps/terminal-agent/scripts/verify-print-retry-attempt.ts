/**
 * 走查 W-86：同一任务号按 attempt 重打。
 *
 * 真实 task-runner + 真实 db.ts + 临时 SQLite。只把 HTTP 与打印命令换成桩。
 * 不碰 Windows 打印机。
 */
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import Database from 'better-sqlite3'
import {
  bindPrintAttempt,
  enqueuePatch,
  getDeadLetterPatches,
  getPendingPatches,
  getTaskLocalErrorCode,
  getTaskLocalStatus,
  isTaskDone,
  markTaskDone,
  openDatabase,
} from '../src/agent/db'
import { processPatch } from '../src/agent/offline-queue'
import {
  BOOT_QUEUE_CLEANUP_TASK_FILE_RE,
  documentNameMatchesSpool,
  printSpoolStem,
  printTempFileName,
} from '../src/agent/print-correlation'
import {
  __resetClaimRateLimitForTests,
  executeTask,
  type ExecuteTaskDependencies,
} from '../src/agent/task-runner'
import { __setUnauthorizedMarkerPathForTests } from '../src/agent/auth-state'
import type { AgentConfig, ClaimTask } from '../src/agent/types'
import type { PrintResult } from '../src/printer/types'

const PDF = Buffer.from('%PDF-1.1\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n')
const KIOSK_TASK = 'kiosk-retry-task'
const ADMIN_TASK = 'admin-retry-task'

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
  legacy.exec(`
    CREATE TABLE print_tasks (taskId TEXT PRIMARY KEY, status TEXT NOT NULL, completedAt TEXT, createdAt TEXT NOT NULL);
    CREATE TABLE pending_patches (
      id INTEGER PRIMARY KEY AUTOINCREMENT, taskId TEXT NOT NULL, status TEXT NOT NULL,
      errorCode TEXT, errorMessage TEXT, attempts INTEGER NOT NULL DEFAULT 0,
      nextRetryAt TEXT NOT NULL, createdAt TEXT NOT NULL
    );
  `)
  legacy.prepare(
    'INSERT INTO print_tasks (taskId, status, completedAt, createdAt) VALUES (?, ?, ?, ?)',
  ).run('legacy-kept', 'completed', createdAt, createdAt)
  legacy.prepare(
    `INSERT INTO pending_patches
     (taskId, status, errorCode, attempts, nextRetryAt, createdAt)
     VALUES (?, ?, ?, 0, ?, ?)`,
  ).run('legacy-patch', 'failed', 'PAPER_EMPTY', createdAt, createdAt)
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
    const legacyPatch = db.prepare(
      'SELECT printAttempt, errorCode FROM pending_patches WHERE taskId = ?',
    ).get('legacy-patch') as { printAttempt: number; errorCode: string } | undefined
    assert.equal(legacyPatch?.printAttempt, 0, '旧补报行的 printAttempt 必须记为 0')
    assert.equal(legacyPatch?.errorCode, 'PAPER_EMPTY')
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
    pass('旧 print_tasks 迁移后 attempt=0 的行仍在，旧补报 printAttempt=0，更大的 attempt 另记一行')
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
  const prints: Array<{ taskId: string; file: string; correlationId: string }> = []
  const monitorKeys: string[] = []
  const dependencies: ExecuteTaskDependencies = {
    printCommand: async (file, printer, _params, options) => {
      const correlationId = options?.correlationId ?? ''
      const taskId = correlationId.replace(/_a\d+$/, '')
      if (taskId !== KIOSK_TASK && taskId !== ADMIN_TASK) throw new Error(`打印桩被意外调用: ${correlationId}`)
      const fileName = basename(file)
      prints.push({ taskId, file: fileName, correlationId })
      const next = prints.filter((item) => item.taskId === taskId).length
      if (next === 1) return printResult(false, file, printer, 'PAPER_EMPTY')
      if (next === 2) return printResult(true, file, printer)
      throw new Error(`打印桩被多调了一次: ${taskId} #${next}`)
    },
    monitorDependencies: {
      platform: 'win32',
      queryStatus: async (_printer, key) => {
        monitorKeys.push(key)
        return { status: 'completed' }
      },
      sleep: async () => undefined,
      queryCompletionEvent: async () => false,
    },
  }
  const agent = config(`${server.origin}/api/v1`)
  const fileUrl = `${server.origin}/files/sample.pdf`
  const printCount = (taskId: string) => prints.filter((item) => item.taskId === taskId).length

  async function assertReprint(label: string, taskId: string): Promise<void> {
    await executeTask(claim(taskId, fileUrl, 0), agent, db, dependencies)
    assert.equal(printCount(taskId), 1, `${label} attempt 0 缺纸必须真的调用一次打印桩`)
    assert.equal(prints.at(-1)?.file, `task_${taskId}.pdf`)
    assert.equal(prints.at(-1)?.correlationId, taskId)
    assert.match(prints.at(-1)?.file ?? '', BOOT_QUEUE_CLEANUP_TASK_FILE_RE)
    assert.equal(getTaskLocalStatus(db, taskId, 0), 'failed')
    assert.equal(getTaskLocalErrorCode(db, taskId, 0), 'PAPER_EMPTY')
    assert.equal(isTaskDone(db, taskId, 1), false)
    const firstFail = patchesFor(server.patches, taskId).filter((item) => item.body['status'] === 'failed')
    assert.equal(firstFail.at(-1)?.body['errorCode'], 'PAPER_EMPTY')
    assert.equal(firstFail.at(-1)?.body['attempt'], 0)
    assert.equal(monitorKeys.includes(`${taskId}_a1`), false, `${label} 缺纸发生在监控之前`)

    await executeTask(claim(taskId, fileUrl), agent, db, dependencies)
    assert.equal(printCount(taskId), 1, `${label} 老服务端不带 attempt 时不得再次打印`)
    const replay = patchesFor(server.patches, taskId).filter((item) => item.body['status'] === 'failed')
    assert.equal(replay.at(-1)?.body['errorCode'], 'PAPER_EMPTY', `${label} 重报 failed 必须带回原来的 errorCode`)
    assert.equal(replay.at(-1)?.body['attempt'], 0)

    await executeTask(claim(taskId, fileUrl, 1), agent, db, dependencies)
    assert.equal(printCount(taskId), 2, `${label} attempt 加一后必须再调用一次打印桩`)
    assert.equal(prints.at(-1)?.file, `task_${taskId}_a1.pdf`)
    assert.equal(prints.at(-1)?.correlationId, `${taskId}_a1`)
    assert.match(prints.at(-1)?.file ?? '', BOOT_QUEUE_CLEANUP_TASK_FILE_RE)
    assert.equal(monitorKeys.filter((key) => key === `${taskId}_a1`).length, 1)
    assert.equal(getTaskLocalStatus(db, taskId, 1), 'completed')
    assert.equal(getTaskLocalStatus(db, taskId, 0), 'failed')
    assert.equal(getTaskLocalErrorCode(db, taskId, 0), 'PAPER_EMPTY')

    await executeTask(claim(taskId, fileUrl, 1), agent, db, dependencies)
    assert.equal(printCount(taskId), 2, `${label} 同一 attempt 再领不得再调打印桩`)
    const completed = patchesFor(server.patches, taskId).filter((item) => item.body['status'] === 'completed')
    assert.equal(completed.length, 2, `${label} 重复领取只重报 completed`)
    assert.equal(completed.at(-1)?.body['attempt'], 1)
    pass(`${label}：attempt 从 0 加到 1 后重新打印，文件名和队列键带上 attempt，同一 attempt 再领不打印`)
  }

  try {
    await assertReprint('一体机重试', KIOSK_TASK)
    await assertReprint('管理员重试', ADMIN_TASK)

    const dispatchId = 'dispatch-unconfirmed'
    markTaskDone(db, dispatchId, 'dispatching', 0)
    bindPrintAttempt(db, 0)
    const beforeDispatch = prints.length
    await executeTask(claim(dispatchId, fileUrl, 0), agent, db, dependencies)
    assert.equal(prints.length, beforeDispatch, '本地 dispatching 不得打印')
    assert.equal(prints.some((item) => item.taskId === dispatchId), false)
    const unconfirmed = patchesFor(server.patches, dispatchId)
    assert.equal(unconfirmed.length, 1)
    assert.equal(unconfirmed[0]?.body['status'], 'failed')
    assert.equal(unconfirmed[0]?.body['errorCode'], 'PRINT_JOB_UNCONFIRMED')
    assert.equal(unconfirmed[0]?.body['attempt'], 0)
    assert.equal(getTaskLocalStatus(db, dispatchId, 0), 'failed')
    pass('attempt 0 且本地 dispatching：报 PRINT_JOB_UNCONFIRMED，不打印')

    const oldRoundTask = 'old-round-task'
    enqueuePatch(db, oldRoundTask, { status: 'failed', errorCode: 'PAPER_EMPTY', attempt: 0 })
    enqueuePatch(db, oldRoundTask, { status: 'failed', errorCode: 'PRINTER_OFFLINE', attempt: 1 })
    const queued = db.prepare(
      'SELECT printAttempt, errorCode FROM pending_patches WHERE taskId = ? ORDER BY printAttempt',
    ).all(oldRoundTask) as Array<{ printAttempt: number; errorCode: string }>
    assert.deepEqual(queued, [
      { printAttempt: 0, errorCode: 'PAPER_EMPTY' },
      { printAttempt: 1, errorCode: 'PRINTER_OFFLINE' },
    ])
    db.prepare('UPDATE pending_patches SET nextRetryAt = ? WHERE taskId = ?').run(
      '2000-01-01T00:00:00.000Z',
      oldRoundTask,
    )
    const stale = getPendingPatches(db).find((row) => row.taskId === oldRoundTask && row.printAttempt === 0)
    assert.ok(stale)
    const logged: string[] = []
    const write = process.stdout.write.bind(process.stdout)
    process.stdout.write = ((chunk: string | Uint8Array) => {
      logged.push(String(chunk))
      return true
    }) as typeof process.stdout.write
    try {
      await processPatch(stale, agent, db, async () => {
        throw {
          isAxiosError: true,
          response: { status: 409, data: { error: { code: 'PRINT_STATUS_STALE_ATTEMPT' } } },
        }
      })
    } finally {
      process.stdout.write = write
    }
    assert.equal(
      getPendingPatches(db).some((row) => row.taskId === oldRoundTask && row.printAttempt === 0),
      false,
    )
    assert.equal(
      db.prepare('SELECT errorCode FROM pending_patches WHERE taskId = ? AND printAttempt = 1').get(oldRoundTask)?.['errorCode'],
      'PRINTER_OFFLINE',
    )
    assert.equal(getDeadLetterPatches(db).some((row) => row.taskId === oldRoundTask), false)
    assert.ok(logged.some((line) => line.includes(`INFO  ${oldRoundTask}\n`)))
    assert.equal(logged.some((line) => /PAPER_EMPTY|PRINTER_OFFLINE|attempt|\.pdf/i.test(line)), false)
    pass('落后补报移出队列，只记任务号，不进死信，新一轮补报仍在')
  } finally {
    await server.close()
    db.close()
    if (previous === undefined) delete process.env['PROGRAMDATA']
    else process.env['PROGRAMDATA'] = previous
    __setUnauthorizedMarkerPathForTests(undefined)
    rmSync(root, { recursive: true, force: true })
  }
}

function verifySpoolMatch(): void {
  const id = KIOSK_TASK
  const stem0 = printSpoolStem(id, 0)
  const stem1 = printSpoolStem(id, 1)
  assert.equal(stem0, id)
  assert.equal(stem1, `${id}_a1`)
  assert.equal(printTempFileName(id, 0, '.pdf'), `task_${id}.pdf`)
  assert.equal(printTempFileName(id, 1, '.pdf'), `task_${id}_a1.pdf`)
  assert.match(printTempFileName(id, 0, '.pdf'), BOOT_QUEUE_CLEANUP_TASK_FILE_RE)
  assert.match(printTempFileName(id, 1, '.pdf'), BOOT_QUEUE_CLEANUP_TASK_FILE_RE)
  assert.equal(documentNameMatchesSpool(`task_${id}.pdf`, stem0), true)
  assert.equal(documentNameMatchesSpool(`print_${id}_11111111-2222-4333-8444-555555555555.pdf`, stem0), true)
  assert.equal(documentNameMatchesSpool(`task_${id}_a1.pdf`, stem1), true)
  assert.equal(documentNameMatchesSpool(`print_${id}_a1_11111111-2222-4333-8444-555555555555.pdf`, stem1), true)
  assert.equal(documentNameMatchesSpool(`task_${id}.pdf`, stem1), false)
  assert.equal(documentNameMatchesSpool(`task_${id}_a10.pdf`, stem1), false)
  assert.equal(documentNameMatchesSpool(`print_${id}_a1abcdef-2222-4333-8444-555555555555.pdf`, stem1), false)
  const wmi = readFileSync(join(__dirname, '../src/agent/wmi.ts'), 'utf8')
  assert.match(wmi, /_a\[0-9\]\+\$/)
  assert.match(wmi, /\(\[\.\]\|_\)/)
  assert.match(wmi, /\$raw -like "\*\$tId\*"/)
  assert.match(wmi, /DocumentName -like "\*\$tId\*"/)
  const runner = readFileSync(join(__dirname, '../src/agent/task-runner.ts'), 'utf8')
  assert.equal(runner.includes('__setExecuteTaskTestSeamsForTests'), false)
  pass('队列匹配键带 attempt，文件名仍符合开机清理正则，测试缝不再是全局 setter')
}

async function main(): Promise<void> {
  verifySpoolMatch()
  verifyLegacyRowsSurvive()
  await verifyRetryAttempt()
  pass('verify:print-retry-attempt 全部通过')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
