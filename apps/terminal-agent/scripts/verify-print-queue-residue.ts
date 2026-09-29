/**
 * Linux / 主 CI：解析作业列表，并按「本进程 SID」筛选。
 * 不建打印机，不碰 Windows 队列。真队列在 verify-print-queue-residue-windows。
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseConfigText } from '../src/agent/config-manager'
import {
  claimPrintTasksIfGateOpen,
  noteStartupPrintQueueFailure,
  pauseQueueAfterTerminalState,
  pauseQueueOnProcessStop,
  printerStatusForHeartbeat,
  __resetPrintDispatchGateForTests,
} from '../src/agent/print-dispatch-gate'
import {
  cleanupStaleOwnPrintJobs,
  parsePrintJobListOutput,
  pauseConfiguredPrinterQueue,
  resumeConfiguredPrinterQueue,
  selectOwnPrintJobIds,
  type PrintJobSnapshot,
} from '../src/agent/print-queue-hold'
import { buildWin32PrinterProbeScript } from '../src/agent/wmi'

const holdSourcePath = join(__dirname, '../src/agent/print-queue-hold.ts')
const gateSourcePath = join(__dirname, '../src/agent/print-dispatch-gate.ts')
const indexSourcePath = join(__dirname, '../src/index.ts')
const taskRunnerSourcePath = join(__dirname, '../src/agent/task-runner.ts')
const heartbeatSourcePath = join(__dirname, '../src/agent/heartbeat.ts')

const OWN_ANCHOR = 'if (job.ownedByCurrentProcess) ids.push(job.id)'
const UNREADABLE_ANCHOR = `    if (typeof owned !== 'boolean') {
      throw new PrintQueueHoldError('print job user is unreadable')
    }`
const CLAIM_BLOCK_ANCHOR = 'return false // print-dispatch-gate: keep claims blocked'
const CLAIM_RETURN_ANCHOR = 'if (!mayClaim) return'
const PAUSE_GATE_ANCHOR = "blockPrintDispatch('pause-after-terminal')"
const HEARTBEAT_ANCHOR = "if (isPrintDispatchBlocked()) return 'error'"
const STARTUP_GATE_ANCHOR = "blockPrintDispatch('startup-queue')"
const QUEUE_BRANCH_ANCHOR = `    if (printQueueCleanupError) {
      noteStartupPrintQueueFailure()
    }`

/** 只看队列失败这一支。注册失败的 failStartup 在它后面、领取循环前面，不能算进这一支。 */
function printQueueFailureBranch(index: string): string {
  const start = index.indexOf('if (printQueueCleanupError)')
  if (start < 0) return ''
  const end = index.indexOf('\n    }', start)
  return end < 0 ? '' : index.slice(start, end)
}

function job(id: number, owned: boolean): PrintJobSnapshot {
  return { id, ownedByCurrentProcess: owned }
}

function verifyComparisonTable(): void {
  assert.deepEqual(selectOwnPrintJobIds([job(1, true), job(2, false), job(3, true)]), [1, 3])
  assert.deepEqual(selectOwnPrintJobIds([job(4, false)]), [])
  assert.deepEqual(selectOwnPrintJobIds([job(0, true), job(-3, true), job(8, true)]), [8])
  assert.throws(
    () => selectOwnPrintJobIds([{ id: 1, ownedByCurrentProcess: undefined as unknown as boolean }]),
    /print job user is unreadable/,
  )

  const single = parsePrintJobListOutput('{"jobs":{"id":11,"owned":true}}')
  assert.deepEqual(selectOwnPrintJobIds(single.jobs), [11])
  const many = parsePrintJobListOutput(
    '{"jobs":[{"id":1,"owned":true},{"id":2,"owned":true},{"id":3,"owned":false}]}',
  )
  assert.deepEqual(selectOwnPrintJobIds(many.jobs), [1, 2])
  const empty = parsePrintJobListOutput('{"jobs":null}')
  assert.deepEqual(empty.jobs, [])
  assert.throws(() => parsePrintJobListOutput('not-json'), /print job list is unreadable/)
  assert.throws(
    () => parsePrintJobListOutput('{"jobs":[{"id":1,"owned":null}]}'),
    /print job user is unreadable/,
  )
  assert.throws(
    () => parsePrintJobListOutput('{"jobs":[{"id":1}]}'),
    /print job user is unreadable/,
  )
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

function verifyPrinterNameComparison(): void {
  const hold = readFileSync(holdSourcePath, 'utf8')
  const probe = buildWin32PrinterProbeScript()
  const weird = "\\\\server\\O'Brien"
  assert.doesNotMatch(hold, /-Filter\b/)
  assert.doesNotMatch(probe, /-Filter\b/)
  assert.match(hold, /\.Name -eq \$name/)
  assert.match(probe, /\.Name -eq \$name/)
  assert.equal(JSON.parse(JSON.stringify({ printerName: weird, method: 'Pause' })).printerName, weird)
  assert.equal(hold.includes(weird), false)
  assert.equal(probe.includes(weird), false)
  assert.match(hold, /WindowsIdentity\]::GetCurrent\(\)/)
  assert.match(hold, /currentIdentity\.User/)
  assert.match(hold, /nt authority\\\\system/)
  assert.match(hold, /EndsWith\('\$'\)/)
  assert.match(hold, /throw 'print job user is unreadable'/)
  assert.match(hold, /throw 'print job user sid is unreadable'/)
  assert.doesNotMatch(hold, /SubmittedTime/)
  assert.doesNotMatch(hold, /startedAtMs/)
  assert.doesNotMatch(hold, /DocumentName/)
}

function verifyStartupWiring(): void {
  const index = readFileSync(indexSourcePath, 'utf8')
  const acquire = index.indexOf('await acquireLock()')
  const tempCleanup = index.indexOf('cleanupCrashLeftoverPrintTaskTemps()')
  const pause = index.indexOf('pauseConfiguredPrinterQueue(')
  const jobs = index.indexOf('cleanupStaleOwnPrintJobs(')
  const runner = index.indexOf('startTaskRunner(')
  const tempExit = index.indexOf('if (printTempCleanupError)')
  const queueExit = index.indexOf('if (printQueueCleanupError)')
  assert.ok(acquire >= 0 && tempCleanup > acquire, 'temp cleanup stays after the instance lock')
  assert.ok(pause > tempCleanup && jobs > pause && runner > jobs, 'pause, then delete own jobs, then claim')
  assert.ok(tempExit > jobs && queueExit > tempExit && runner > queueExit)
  assert.ok(index.slice(tempExit, queueExit).includes('failStartup'), 'W-85 still exits')
  const queueBranch = printQueueFailureBranch(index)
  assert.equal(queueBranch.includes('failStartup'), false)
  assert.equal(queueBranch.includes('process.exit'), false)
  assert.ok(queueBranch.includes('noteStartupPrintQueueFailure'))
  assert.ok(index.includes('config.holdPrinterQueueWhenIdle'), 'idle pause is config-gated')
  const stop = index.indexOf('pauseQueueOnProcessStop(')
  const exit = index.indexOf('process.exit(0)', stop)
  assert.ok(stop > runner && exit > stop, 'normal stop pauses before exiting')

  const taskRunner = readFileSync(taskRunnerSourcePath, 'utf8')
  const resume = taskRunner.indexOf('resumeConfiguredPrinterQueue(')
  const printCall = taskRunner.indexOf('const result = await print(')
  const pauseAfter = taskRunner.indexOf('pauseQueueAfterTerminalState(')
  const claimGate = taskRunner.indexOf('claimPrintTasksIfGateOpen(')
  const claimPost = taskRunner.indexOf('/tasks/claim')
  assert.ok(resume > 0 && resume < printCall, 'resume immediately before print')
  assert.ok(pauseAfter > printCall, 'pause again after the terminal state')
  assert.ok(claimGate > 0 && claimGate < claimPost, 'gate sits in front of the claim request')
  assert.match(taskRunner, /inFlight/)
  assert.match(taskRunner, /maxTasks/)
  assert.equal(taskRunner.includes('cleanupCrashLeftoverPrintTaskTemps'), false)

  const heartbeat = readFileSync(heartbeatSourcePath, 'utf8')
  assert.match(heartbeat, /printerStatusForHeartbeat\(/)

  const hold = readFileSync(holdSourcePath, 'utf8')
  assert.ok(hold.includes(OWN_ANCHOR))
  assert.ok(hold.includes("await invokePrinterCimMethod(printerName, 'Pause')"))
}

async function verifyPrintDispatchGate(): Promise<void> {
  __resetPrintDispatchGateForTests()
  noteStartupPrintQueueFailure()
  assert.equal(printerStatusForHeartbeat('ready'), 'error')
  let claims = 0
  await claimPrintTasksIfGateOpen(
    {
      holdEnabled: true,
      pause: async () => {
        throw new Error('pause')
      },
      cleanup: async () => {
        throw new Error('cleanup')
      },
    },
    async () => {
      claims += 1
    },
  )
  assert.equal(claims, 0, 'a failed startup recovery must not claim')

  let pauses = 0
  await claimPrintTasksIfGateOpen(
    {
      holdEnabled: false,
      pause: async () => {
        pauses += 1
      },
      cleanup: async () => undefined,
    },
    async () => {
      claims += 1
    },
  )
  assert.equal(pauses, 0, 'startup recovery pauses only when idle hold is enabled')
  assert.equal(claims, 1, 'startup recovery success resumes claiming')
  assert.equal(printerStatusForHeartbeat('ready'), 'ready')

  __resetPrintDispatchGateForTests()
  let attempts = 0
  await pauseQueueAfterTerminalState(async () => {
    attempts += 1
    throw new Error('pause')
  }, async () => undefined)
  assert.equal(attempts, 3)
  claims = 0
  await claimPrintTasksIfGateOpen(
    {
      holdEnabled: true,
      pause: async () => {
        throw new Error('still paused open')
      },
      cleanup: async () => {
        throw new Error('pause recovery must not delete jobs')
      },
    },
    async () => {
      claims += 1
    },
  )
  assert.equal(claims, 0, 'a failed re-pause must not claim the next job')
  assert.equal(printerStatusForHeartbeat('low_paper'), 'error')

  await claimPrintTasksIfGateOpen(
    {
      holdEnabled: true,
      pause: async () => undefined,
      cleanup: async () => {
        throw new Error('pause recovery must not delete jobs')
      },
    },
    async () => {
      claims += 1
    },
  )
  assert.equal(claims, 1, 'a successful re-pause resumes claiming')
  assert.equal(printerStatusForHeartbeat('ready'), 'ready')

  __resetPrintDispatchGateForTests()
  attempts = 0
  await pauseQueueAfterTerminalState(async () => {
    attempts += 1
    if (attempts < 2) throw new Error('once')
  }, async () => undefined)
  assert.equal(attempts, 2)
  assert.equal(printerStatusForHeartbeat('ready'), 'ready')

  let stopped = 0
  await pauseQueueOnProcessStop({
    enabled: false,
    pause: async () => {
      stopped += 1
    },
  })
  assert.equal(stopped, 0)
  const started = Date.now()
  await pauseQueueOnProcessStop({
    enabled: true,
    timeoutMs: 40,
    pause: () => new Promise(() => undefined),
  })
  assert.ok(Date.now() - started < 300, 'stop must not wait on a stuck pause')
  await pauseQueueOnProcessStop({
    enabled: true,
    pause: async () => {
      stopped += 1
      throw new Error('ignore')
    },
  })
  assert.equal(stopped, 1)
  __resetPrintDispatchGateForTests()
}

async function verifyNonWindowsNoop(): Promise<void> {
  if (process.platform === 'win32') {
    console.log('print queue no-op checks skipped on win32')
    return
  }
  const paused = await pauseConfiguredPrinterQueue('Test Printer')
  const resumed = await resumeConfiguredPrinterQueue('Test Printer')
  const cleaned = await cleanupStaleOwnPrintJobs({ printerName: 'Test Printer' })
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
const { parsePrintJobListOutput, selectOwnPrintJobIds } = require('./src/agent/print-queue-hold')
let threw = false
try {
  parsePrintJobListOutput('{"jobs":[{"id":1,"owned":null}]}')
} catch (error) {
  threw = /unreadable/.test(String(error && error.message))
}
if (!threw) process.exit(1)
const other = selectOwnPrintJobIds([{ id: 3, ownedByCurrentProcess: false }])
if (other.includes(3)) process.exit(1)
const own = selectOwnPrintJobIds([{ id: 2, ownedByCurrentProcess: true }])
if (!own.includes(2)) process.exit(1)
process.exit(0)
`

const claimChild = `
const gate = require('./src/agent/print-dispatch-gate')
;(async () => {
  gate.__resetPrintDispatchGateForTests()
  gate.noteStartupPrintQueueFailure()
  if (gate.printerStatusForHeartbeat('ready') !== 'error') process.exit(1)
  let claims = 0
  await gate.claimPrintTasksIfGateOpen({
    holdEnabled: true,
    pause: async () => { throw new Error('pause') },
    cleanup: async () => { throw new Error('cleanup') },
  }, async () => { claims += 1 })
  if (claims !== 0) process.exit(1)
  process.exit(0)
})().catch(() => process.exit(1))
`

const pauseChild = `
const gate = require('./src/agent/print-dispatch-gate')
;(async () => {
  gate.__resetPrintDispatchGateForTests()
  let attempts = 0
  await gate.pauseQueueAfterTerminalState(async () => {
    attempts += 1
    throw new Error('no')
  }, async () => {})
  if (attempts !== 3) process.exit(1)
  let claims = 0
  await gate.claimPrintTasksIfGateOpen({
    holdEnabled: true,
    pause: async () => { throw new Error('still') },
    cleanup: async () => { throw new Error('cleanup') },
  }, async () => { claims += 1 })
  if (claims !== 0) process.exit(1)
  if (gate.printerStatusForHeartbeat('ready') !== 'error') process.exit(1)
  process.exit(0)
})().catch(() => process.exit(1))
`

const startupChild = `
const gate = require('./src/agent/print-dispatch-gate')
gate.__resetPrintDispatchGateForTests()
gate.noteStartupPrintQueueFailure()
if (gate.printerStatusForHeartbeat('paper_empty') !== 'error') process.exit(1)
process.exit(0)
`

const indexChild = `
const fs = require('fs')
const index = fs.readFileSync('./src/index.ts', 'utf8')
const marker = index.indexOf('if (printQueueCleanupError)')
const close = index.indexOf('\\n    }', marker)
const runner = index.indexOf('startTaskRunner(')
const tempExit = index.indexOf('if (printTempCleanupError)')
if (marker < 0 || close < marker || runner < marker || tempExit < 0 || tempExit > marker) process.exit(1)
const branch = index.slice(marker, close)
if (branch.includes('failStartup') || branch.includes('process.exit')) process.exit(1)
if (!branch.includes('noteStartupPrintQueueFailure')) process.exit(1)
if (!index.slice(tempExit, marker).includes('failStartup')) process.exit(1)
process.exit(0)
`

function verifyReverseMutations(): void {
  const hold = readFileSync(holdSourcePath, 'utf8')
  const gate = readFileSync(gateSourcePath, 'utf8')
  const index = readFileSync(indexSourcePath, 'utf8')
  assert.equal(runNodeEval(selectorChild).status, 0)
  assert.equal(runNodeEval(claimChild).status, 0)
  assert.equal(runNodeEval(pauseChild).status, 0)
  assert.equal(runNodeEval(startupChild).status, 0)
  assert.equal(runNodeEval(indexChild).status, 0)

  const mutations: Array<[string, string, string, string, string]> = [
    ['own-account filter', holdSourcePath, hold, OWN_ANCHOR, 'if (true) ids.push(job.id)'],
    [
      'unreadable user',
      holdSourcePath,
      hold,
      UNREADABLE_ANCHOR,
      `    if (typeof owned !== 'boolean') {
      continue
    }`,
    ],
    ['claim while blocked', gateSourcePath, gate, CLAIM_RETURN_ANCHOR, ''],
    ['recovery reports open', gateSourcePath, gate, CLAIM_BLOCK_ANCHOR, 'return true // print-dispatch-gate: keep claims blocked'],
    ['pause failure still claims', gateSourcePath, gate, PAUSE_GATE_ANCHOR, ''],
    ['heartbeat stays queried', gateSourcePath, gate, HEARTBEAT_ANCHOR, "if (false) return 'error'"],
    ['startup cleanup exits', gateSourcePath, gate, STARTUP_GATE_ANCHOR, 'process.exit(1)'],
    [
      'startup cleanup failStartup',
      indexSourcePath,
      index,
      QUEUE_BRANCH_ANCHOR,
      `    if (printQueueCleanupError) {
      noteStartupPrintQueueFailure()
      failStartup(printQueueCleanupError, 'AGENT_STARTUP_FAILED')
    }`,
    ],
  ]
  const children: Record<string, string> = {
    'own-account filter': selectorChild,
    'unreadable user': selectorChild,
    'claim while blocked': claimChild,
    'recovery reports open': claimChild,
    'pause failure still claims': pauseChild,
    'heartbeat stays queried': claimChild,
    'startup cleanup exits': startupChild,
    'startup cleanup failStartup': indexChild,
  }
  for (const [label, file, original, from, to] of mutations) {
    assert.ok(original.includes(from), `${label}: anchor missing`)
    writeFileSync(file, original.replace(from, to))
    try {
      const result = runNodeEval(children[label] ?? '')
      assert.notEqual(result.status, 0, `${label}: reversed behavior must fail`)
    } finally {
      writeFileSync(file, original)
    }
  }
}

async function main(): Promise<void> {
  verifyComparisonTable()
  verifyConfigDefault()
  verifyPrinterNameComparison()
  verifyStartupWiring()
  await verifyPrintDispatchGate()
  await verifyNonWindowsNoop()
  verifyReverseMutations()
  console.log('PASS print queue residue')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
