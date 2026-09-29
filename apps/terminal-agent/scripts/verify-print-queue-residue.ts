/**
 * Linux / 主 CI：解析 Get-PrintJob 输出，并按账号与提交时间筛选。
 * 不建打印机，不碰 Windows 队列。真队列在 verify-print-queue-residue-windows。
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseConfigText } from '../src/agent/config-manager'
import {
  accountsReferToSamePrincipal,
  agentProcessStartedAtMs,
  cleanupStaleOwnPrintJobs,
  parsePrintJobListOutput,
  pauseConfiguredPrinterQueue,
  resumeConfiguredPrinterQueue,
  selectStaleOwnPrintJobIds,
  type PrintJobSnapshot,
} from '../src/agent/print-queue-hold'

const holdSourcePath = join(__dirname, '../src/agent/print-queue-hold.ts')
const indexSourcePath = join(__dirname, '../src/index.ts')
const taskRunnerSourcePath = join(__dirname, '../src/agent/task-runner.ts')

const TIME_ANCHOR = 'job.submittedAtMs < criteria.startedAtMs'
const ACCOUNT_ANCHOR = 'accountsReferToSamePrincipal(job.user, account)'
const PAUSE_ANCHOR = "await invokePrinterCimMethod(printerName, 'Pause')"

function assertSelector(jobs: PrintJobSnapshot[], startedAtMs: number, account: string, expected: number[]): void {
  assert.deepEqual(selectStaleOwnPrintJobIds(jobs, { account, startedAtMs }), expected)
}

function verifyComparisonTable(): void {
  const start = 1_000_000
  const system = 'NT AUTHORITY\\SYSTEM'
  assertSelector([{ id: 1, user: system, submittedAtMs: start - 1 }], start, system, [1])
  assertSelector([{ id: 2, user: system, submittedAtMs: start + 1 }], start, system, [])
  assertSelector([{ id: 3, user: system, submittedAtMs: start }], start, system, [])
  assertSelector([{ id: 4, user: 'CONTOSO\\other', submittedAtMs: start - 1 }], start, system, [])
  assertSelector([{ id: 5, user: 'nt authority\\system', submittedAtMs: start - 10 }], start, system, [5])
  assertSelector([{ id: 6, user: 'SYSTEM', submittedAtMs: start - 10 }], start, system, [6])
  assertSelector([{ id: 7, user: 'CONTOSO\\SYSTEM', submittedAtMs: start - 10 }], start, system, [])
  assertSelector([{ id: 8, user: 'runneradmin', submittedAtMs: 1 }], start, 'COMPUTER\\runneradmin', [8])
  assert.equal(accountsReferToSamePrincipal('SYSTEM', 'NT AUTHORITY\\SYSTEM'), true)
  assert.equal(accountsReferToSamePrincipal('CONTOSO\\SYSTEM', 'NT AUTHORITY\\SYSTEM'), false)
  assert.equal(accountsReferToSamePrincipal('', system), false)

  assert.throws(
    () => selectStaleOwnPrintJobIds([{ id: 1, user: system, submittedAtMs: 1 }], { account: '   ', startedAtMs: start }),
    /stale print job criteria are incomplete/,
  )
  assert.throws(
    () => selectStaleOwnPrintJobIds([{ id: 1, user: system, submittedAtMs: Number.NaN }], { account: system, startedAtMs: start }),
    /print job submit time is unreadable/,
  )
  assertSelector([{ id: 0, user: system, submittedAtMs: 1 }, { id: -3, user: system, submittedAtMs: 1 }], start, system, [])

  const single = parsePrintJobListOutput(
    '{"account":"NT AUTHORITY\\\\SYSTEM","jobs":{"id":11,"user":"SYSTEM","submittedAtMs":10}}',
  )
  assert.equal(single.account, 'NT AUTHORITY\\SYSTEM')
  assert.deepEqual(selectStaleOwnPrintJobIds(single.jobs, { account: single.account, startedAtMs: 50 }), [11])

  const many = parsePrintJobListOutput(
    '{"account":"AGENT","jobs":[{"id":1,"user":"AGENT","submittedAtMs":1},{"id":2,"user":"AGENT","submittedAtMs":80},{"id":3,"user":"OTHER","submittedAtMs":1}]}',
  )
  assert.deepEqual(selectStaleOwnPrintJobIds(many.jobs, { account: many.account, startedAtMs: 50 }), [1])

  const empty = parsePrintJobListOutput('{"account":"AGENT","jobs":null}')
  assert.deepEqual(empty.jobs, [])
  assert.throws(() => parsePrintJobListOutput('{"account":"","jobs":[]}'), /account is unreadable/)
  assert.throws(() => parsePrintJobListOutput('not-json'), /print job list is unreadable/)
  assert.throws(
    () => parsePrintJobListOutput('{"account":"AGENT","jobs":[{"id":1,"user":"AGENT","submittedAtMs":null}]}'),
    /print job submit time is unreadable/,
  )

  assert.equal(agentProcessStartedAtMs(10_000, 3.2), 10_000 - 3200)
}

function verifyConfigDefault(): void {
  const minimal = {
    apiBaseUrl: 'https://api.example.test/api/v1',
    terminalCode: 'KSK-001',
    printerName: 'Test Printer',
    agentVersion: '0.4.13',
  }
  assert.equal(parseConfigText(JSON.stringify(minimal)).holdPrinterQueueWhenIdle, false)
  assert.equal(
    parseConfigText(JSON.stringify({ ...minimal, holdPrinterQueueWhenIdle: true })).holdPrinterQueueWhenIdle,
    true,
  )
  assert.equal(
    parseConfigText(JSON.stringify({ ...minimal, holdPrinterQueueWhenIdle: false })).holdPrinterQueueWhenIdle,
    false,
  )
  assert.throws(() => parseConfigText(JSON.stringify({ ...minimal, holdPrinterQueueWhenIdle: 'true' })))

  for (const rel of ['agent-config.example.json', 'config/agent-config.example.json']) {
    const example = JSON.parse(readFileSync(join(__dirname, '..', rel), 'utf8')) as {
      holdPrinterQueueWhenIdle?: boolean
      agentVersion?: string
      printerName?: string
    }
    assert.equal(example.holdPrinterQueueWhenIdle, false, `${rel} must keep the code default`)
    assert.equal(example.agentVersion, '0.4.13')
    assert.equal(example.printerName, '')
  }
}

function verifyStartupWiring(): void {
  const index = readFileSync(indexSourcePath, 'utf8')
  const acquire = index.indexOf('await acquireLock()')
  const tempCleanup = index.indexOf('cleanupCrashLeftoverPrintTaskTemps()')
  const pause = index.indexOf('pauseConfiguredPrinterQueue(')
  const jobs = index.indexOf('cleanupStaleOwnPrintJobs(')
  const runner = index.indexOf('startTaskRunner(')
  assert.ok(acquire >= 0 && tempCleanup > acquire, 'temp cleanup stays after the instance lock')
  assert.ok(pause > tempCleanup && jobs > pause && runner > jobs, 'pause, then delete stale jobs, then claim')
  assert.ok(index.includes('config.holdPrinterQueueWhenIdle'), 'idle pause is config-gated')

  const taskRunner = readFileSync(taskRunnerSourcePath, 'utf8')
  const resume = taskRunner.indexOf('resumeConfiguredPrinterQueue(')
  const printCall = taskRunner.indexOf('const result = await print(')
  const pauseAfter = taskRunner.indexOf('pauseConfiguredPrinterQueue(')
  assert.ok(resume > 0 && resume < printCall, 'resume immediately before print')
  assert.ok(pauseAfter > printCall, 'pause again after the terminal state')
  assert.match(taskRunner, /inFlight/)
  assert.match(taskRunner, /maxTasks/)
  assert.equal(taskRunner.includes('cleanupCrashLeftoverPrintTaskTemps'), false)

  const hold = readFileSync(holdSourcePath, 'utf8')
  assert.ok(hold.includes(TIME_ANCHOR))
  assert.ok(hold.includes(ACCOUNT_ANCHOR))
  assert.ok(hold.includes(PAUSE_ANCHOR))
  assert.doesNotMatch(hold, /NT AUTHORITY\\SYSTEM/)
  assert.doesNotMatch(hold, /DocumentName/)
}

async function verifyNonWindowsNoop(): Promise<void> {
  if (process.platform === 'win32') {
    console.log('print queue no-op checks skipped on win32')
    return
  }
  const paused = await pauseConfiguredPrinterQueue('Test Printer')
  const resumed = await resumeConfiguredPrinterQueue('Test Printer')
  const cleaned = await cleanupStaleOwnPrintJobs({ printerName: 'Test Printer', startedAtMs: Date.now() })
  assert.equal(paused.skipped, true)
  assert.equal(resumed.skipped, true)
  assert.equal(cleaned.skipped, true)
  assert.equal(cleaned.removed, 0)
}

function runNodeEval(code: string) {
  return spawnSync(process.execPath, ['-r', 'ts-node/register/transpile-only', '-e', code], {
    cwd: join(__dirname, '..'),
    encoding: 'utf8',
    timeout: 60_000,
    env: { ...process.env, TS_NODE_TRANSPILE_ONLY: '1' },
  })
}

const selectorChild = `
const { selectStaleOwnPrintJobIds } = require('./src/agent/print-queue-hold')
const after = selectStaleOwnPrintJobIds(
  [{ id: 2, user: 'AGENT', submittedAtMs: 2000 }],
  { account: 'AGENT', startedAtMs: 1000 },
)
if (after.includes(2)) process.exit(1)
const other = selectStaleOwnPrintJobIds(
  [{ id: 3, user: 'OTHER', submittedAtMs: 1 }],
  { account: 'AGENT', startedAtMs: 1000 },
)
if (other.includes(3)) process.exit(1)
process.exit(0)
`

function verifyReverseMutations(): void {
  const original = readFileSync(holdSourcePath, 'utf8')
  const baseline = runNodeEval(selectorChild)
  assert.equal(baseline.status, 0, `${baseline.stdout ?? ''}\n${baseline.stderr ?? ''}`)

  const mutations: Array<[string, string, string]> = [
    ['time', TIME_ANCHOR, 'true'],
    ['account', ACCOUNT_ANCHOR, 'true'],
  ]
  for (const [label, from, to] of mutations) {
    assert.ok(original.includes(from), `${label}: anchor missing`)
    writeFileSync(holdSourcePath, original.replace(from, to))
    try {
      const result = runNodeEval(selectorChild)
      assert.notEqual(result.status, 0, `${label}: reversed filter must fail`)
    } finally {
      writeFileSync(holdSourcePath, original)
    }
  }
}

async function main(): Promise<void> {
  verifyComparisonTable()
  verifyConfigDefault()
  verifyStartupWiring()
  await verifyNonWindowsNoop()
  verifyReverseMutations()
  console.log('PASS print queue residue')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
