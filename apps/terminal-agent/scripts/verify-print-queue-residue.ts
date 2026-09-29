/**
 * Linux / 主 CI：解析作业列表，并按「本进程 SID」筛选。
 * 不建打印机，不碰 Windows 队列。真队列在 verify-print-queue-residue-windows。
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseConfigText } from '../src/agent/config-manager'
import { runAgentBoot } from '../src/agent/boot-print-queue-order'
import {
  claimPrintTasksIfGateOpen,
  installFatalPrintQueuePause,
  noteStartupPrintQueueFailure,
  PAUSE_RETRY_DELAYS_MS,
  pauseBeforeFatalExit,
  pauseQueueAfterTerminalState,
  pauseQueueOnProcessStop,
  preparePrinterForDispatch,
  printerStatusForHeartbeat,
  settlePrinterAfterTerminal,
  __resetPrintDispatchGateForTests,
} from '../src/agent/print-dispatch-gate'
import {
  applyPrinterQueueMethod,
  CIM_METHOD_SCRIPT,
  cleanupStaleOwnPrintJobs,
  confirmPrinterQueueHoldState,
  LIST_JOBS_SCRIPT,
  PrintQueueHoldError,
  parsePrintJobListOutput,
  pauseConfiguredPrinterQueue,
  pauseSignalFromProbeLine,
  QUEUE_STATE_READBACK_WINDOW_MS,
  REMOVE_JOBS_SCRIPT,
  resumeConfiguredPrinterQueue,
  selectOwnPrintJobIds,
  type PrintJobSnapshot,
} from '../src/agent/print-queue-hold'
import { createTaskRunnerControl } from '../src/agent/task-runner-control'
import { PRINTER_NETWORK_SCRIPT } from '../src/agent/network-diagnostics'
import {
  buildPrintJobStatusScript,
  buildPrintServiceCompletionEventScript,
  buildWin32PrinterProbeScript,
  configuredPrinterNameMatches,
  mapWin32PrinterPreflight,
  mapWin32PrinterQuery,
} from '../src/agent/wmi'
import { ESCAPE_WQL_LITERAL_FUNCTION, escapeWqlLiteral, POWERSHELL_STDIN_UTF8, win32PrinterNameFilter } from '../src/agent/wql-literal'

const holdSourcePath = join(__dirname, '../src/agent/print-queue-hold.ts')
const gateSourcePath = join(__dirname, '../src/agent/print-dispatch-gate.ts')
const bootSourcePath = join(__dirname, '../src/agent/boot-print-queue-order.ts')
const indexSourcePath = join(__dirname, '../src/index.ts')
const taskRunnerSourcePath = join(__dirname, '../src/agent/task-runner.ts')
const heartbeatSourcePath = join(__dirname, '../src/agent/heartbeat.ts')

const OWN_ANCHOR = 'if (job.ownedByCurrentProcess) ids.push(job.id)'
const UNREADABLE_ANCHOR = `    if (typeof owned !== 'boolean') {
      throw new PrintQueueHoldError('print job user is unreadable')
    }`
const UNREADABLE_SKIP_ANCHOR = 'if (job.unreadableUser === true) continue'
const CLAIM_BLOCK_ANCHOR = 'return false // print-dispatch-gate: keep claims blocked'
const CLAIM_RETURN_ANCHOR = 'if (!mayClaim) return'
const PAUSE_GATE_ANCHOR = "block = { kind: 'pause', heartbeat: 'queue_pause_failed' }"
const HEARTBEAT_ANCHOR = 'return block?.heartbeat ?? queried'
const STARTUP_GATE_ANCHOR = "block = { kind: 'startup', heartbeat }"
const PREPARE_DELETE_ANCHOR = 'await options.removeOwnJobs() // prepare-before-dispatch'
const PREPARE_NOTE_ANCHOR = 'noteResidualCleanupFailure() // prepare-cleanup-failed'
const PREPARE_RESUME_ANCHOR = 'notePauseAfterTerminalFailure() // prepare-resume-failed'
const READBACK_ANCHOR = `  await confirmPrinterQueueHoldState({ // queue-state-readback
    method: options.method,
    readPaused: options.readPaused ?? (() => readPausedFromWmi(options.printerName, step)),
    sleep: options.sleep,
    now: options.now,
    windowMs: options.windowMs,
  })`
const OWN_JOB_ID_ANCHOR = "throw new PrintQueueHoldError('print job id is unreadable') // own-job-id"
const QUERY_FAILED_ANCHOR = `} catch { 'query_failed'; exit }`
const UTF8_ANCHOR = 'export const POWERSHELL_STDIN_UTF8 = "[Console]::InputEncoding = [System.Text.Encoding]::UTF8"'
const STDIN_UTF8_ANCHOR = "child.stdin.end(stdin, 'utf8')"
const FATAL_PAUSE_ANCHOR = `    void pauseBeforeFatalExit({ // fatal-exit-pause
      enabled: options.enabled,
      pause: options.pause,
      timeoutMs: 3_000,
    }).finally(() => exit(1))`
const FATAL_SWALLOW_ANCHOR = '.then(() => undefined, () => undefined), // fatal-exit-swallow'
const SETTLE_DELETE_ANCHOR = 'await options.removeOwnJobs() // settle-failed-terminal'
const BOOT_ORDER_ANCHOR = `  await steps.acquireLock()
  await steps.afterLock()
  await steps.cleanupOwnPrintJobs()
  await steps.beforeClaim()
  steps.startClaimLoop()`
const QUEUE_BRANCH_ANCHOR = `        if (printQueueCleanupError) {
          noteStartupPrintQueueFailure(startupQueueFailure)
        }`

/** 只看队列失败这一支。注册失败的 failStartup 在它后面、领取循环前面，不能算进这一支。 */
function printQueueFailureBranch(index: string): string {
  const start = index.indexOf('if (printQueueCleanupError)')
  if (start < 0) return ''
  const lineStart = index.lastIndexOf('\n', start) + 1
  const indent = index.slice(lineStart, start)
  const end = index.indexOf(`\n${indent}}`, start)
  return end < 0 ? '' : index.slice(start, end)
}

function firstStdinRead(script: string): number {
  const reads = ['[Console]::In.ReadLine()', '[Console]::In.ReadToEnd()']
    .map((token) => script.indexOf(token))
    .filter((index) => index >= 0)
  return reads.length === 0 ? -1 : Math.min(...reads)
}

function job(id: number, owned: boolean): PrintJobSnapshot {
  return { id, ownedByCurrentProcess: owned }
}

function verifyComparisonTable(): void {
  assert.deepEqual(selectOwnPrintJobIds([job(1, true), job(2, false), job(3, true)]), [1, 3])
  assert.deepEqual(selectOwnPrintJobIds([job(4, false)]), [])
  assert.throws(
    () => selectOwnPrintJobIds([job(0, true), job(-3, true), job(8, true)]),
    /print job id is unreadable/,
  )
  assert.deepEqual(selectOwnPrintJobIds([job(0, false), job(-3, false), job(8, true)]), [8])
  assert.throws(
    () => parsePrintJobListOutput('{"jobs":[{"id":"abc","owned":true}]}'),
    /print job id is unreadable/,
  )
  const foreignBadId = parsePrintJobListOutput('{"jobs":[{"id":"abc","owned":false},{"id":4,"owned":true}]}')
  assert.deepEqual(selectOwnPrintJobIds(foreignBadId.jobs), [4])
  const unreadBadId = parsePrintJobListOutput(
    '{"jobs":[{"id":"nope","unreadable":true,"owned":true}],"unreadable":1}',
  )
  assert.equal(unreadBadId.unreadableUserJobs, 1)
  assert.deepEqual(selectOwnPrintJobIds(unreadBadId.jobs), [])
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
  const skipped = parsePrintJobListOutput(
    '{"jobs":[{"id":2,"owned":true},{"id":7,"owned":true,"unreadable":true}],"unreadable":1}',
  )
  assert.equal(skipped.unreadableUserJobs, 1)
  assert.equal(skipped.jobs.find((job) => job.id === 7)?.unreadableUser, true)
  assert.deepEqual(selectOwnPrintJobIds(skipped.jobs), [2])
  const reportedOnly = parsePrintJobListOutput('{"jobs":[{"id":7,"unreadable":true}],"unreadable":2}')
  assert.equal(reportedOnly.unreadableUserJobs, 2)
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
  const wmi = readFileSync(join(__dirname, '../src/agent/wmi.ts'), 'utf8')
  const probe = buildWin32PrinterProbeScript()
  const weird = "\\\\server\\O'Brien"
  const tricky = "\\\\srv\\Pan'tum"
  assert.match(hold, /-Filter \$filter/)
  assert.match(probe, /-Filter \$filter/)
  assert.doesNotMatch(hold, /\$name\s*\+/)
  assert.doesNotMatch(probe, /\$name\s*\+/)
  assert.match(hold, /\.Name -eq \$name/)
  assert.match(probe, /\.Name -eq \$name/)
  assert.match(hold, /ESCAPE_WQL_LITERAL_FUNCTION/)
  assert.match(wmi, /ESCAPE_WQL_LITERAL_FUNCTION/)
  assert.doesNotMatch(hold, /function Escape-WqlLiteral/)
  assert.doesNotMatch(wmi, /function Escape-WqlLiteral/)
  assert.ok(CIM_METHOD_SCRIPT.includes(ESCAPE_WQL_LITERAL_FUNCTION))
  assert.ok(probe.includes(ESCAPE_WQL_LITERAL_FUNCTION))
  assert.equal(escapeWqlLiteral(tricky), "\\\\\\\\srv\\\\Pan\\'tum")
  assert.equal(escapeWqlLiteral("a\\b'c"), "a\\\\b\\'c")
  assert.equal(win32PrinterNameFilter(tricky), "Name='\\\\\\\\srv\\\\Pan\\'tum'")
  const backslashReplace = ".Replace('\\', '\\\\')"
  const quoteReplace = '.Replace("\'", "\\\'")'
  assert.ok(ESCAPE_WQL_LITERAL_FUNCTION.includes(backslashReplace))
  assert.ok(
    ESCAPE_WQL_LITERAL_FUNCTION.indexOf(backslashReplace) < ESCAPE_WQL_LITERAL_FUNCTION.indexOf(quoteReplace),
  )
  assert.equal(JSON.parse(JSON.stringify({ printerName: weird, method: 'Pause' })).printerName, weird)
  assert.equal(JSON.parse(JSON.stringify({ printerName: tricky })).printerName, tricky)
  assert.equal(configuredPrinterNameMatches(tricky, tricky), true)
  assert.equal(configuredPrinterNameMatches(tricky, "\\\\srv\\Pantum"), false)
  assert.equal(configuredPrinterNameMatches(tricky, "Pan'tum"), false)
  assert.equal(configuredPrinterNameMatches("' OR $_.Name -eq 'other", 'other'), false)
  assert.equal(hold.includes(weird), false)
  assert.equal(probe.includes(weird), false)
  assert.equal(hold.includes(tricky), false)
  assert.equal(probe.includes(tricky), false)
  const chinese = '奔图彩色打印机'
  const stdinScripts = [
    CIM_METHOD_SCRIPT,
    LIST_JOBS_SCRIPT,
    REMOVE_JOBS_SCRIPT,
    probe,
    buildPrintJobStatusScript(),
    buildPrintServiceCompletionEventScript(),
    PRINTER_NETWORK_SCRIPT,
  ]
  assert.equal(POWERSHELL_STDIN_UTF8, "[Console]::InputEncoding = [System.Text.Encoding]::UTF8")
  for (const script of stdinScripts) {
    const markerAt = script.indexOf(POWERSHELL_STDIN_UTF8)
    const readAt = firstStdinRead(script)
    assert.ok(markerAt >= 0 && readAt > markerAt, 'UTF-8 input encoding must be set before reading the printer name')
  }
  assert.equal(escapeWqlLiteral(chinese), chinese)
  assert.equal(win32PrinterNameFilter(chinese), `Name='${chinese}'`)
  assert.equal(JSON.parse(JSON.stringify({ printerName: chinese })).printerName, chinese)
  assert.equal(configuredPrinterNameMatches(chinese, chinese), true)
  assert.equal(configuredPrinterNameMatches(chinese, '奔图彩色'), false)
  assert.match(hold, /child\.stdin\.end\(stdin, 'utf8'\)/)
  assert.match(wmi, /child\.stdin\.end\(stdin, 'utf8'\)/)
  const network = readFileSync(join(__dirname, '../src/agent/network-diagnostics.ts'), 'utf8')
  assert.match(network, /child\.stdin\.end\(stdin \?\? '', 'utf8'\)/)
  const probeRows: Array<[string, string, string]> = [
    ['query_failed', 'unknown', 'unknown'],
    ['not_found', 'error', 'not_found'],
  ]
  for (const [output, heartbeat, preflight] of probeRows) {
    assert.equal(mapWin32PrinterQuery(output), heartbeat)
    assert.equal(mapWin32PrinterPreflight(output), preflight)
  }
  assert.match(probe, /\} catch \{ 'query_failed'; exit \}/)
  assert.match(hold, /print-queue-cleanup: matched by SID \(count=\$\{ids\.length\}\)/)
  assert.match(hold, /WindowsIdentity\]::GetCurrent\(\)/)
  assert.match(hold, /currentIdentity\.User/)
  assert.match(hold, /nt authority\\\\system/)
  assert.match(hold, /EndsWith\('\$'\)/)
  assert.match(hold, /throw 'print job user is unreadable'/)
  assert.match(hold, /throw 'print job user sid is unreadable'/)
  assert.match(hold, /\$skippedUnreadable \+= 1/)
  assert.match(hold, /\$unreadable = \$true/)
  assert.match(hold, /print-queue-cleanup: skipped unreadable user jobs \(count=\$\{listed\.unreadableUserJobs\}\)/)
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
  assert.ok(index.includes('installFatalPrintQueuePause('), 'fatal exit still tries to pause')
  assert.ok(index.includes('先暂停，再删'), 'boot still pauses before deleting jobs')

  const taskRunner = readFileSync(taskRunnerSourcePath, 'utf8')
  const prepare = taskRunner.indexOf('preparePrinterForDispatch(')
  const resume = taskRunner.indexOf('resumeConfiguredPrinterQueue(')
  const printCall = taskRunner.indexOf('const result = await print(')
  const settle = taskRunner.indexOf('settlePrinterAfterTerminal(', printCall)
  const claimGate = taskRunner.indexOf('claimPrintTasksIfGateOpen(')
  const claimPost = taskRunner.indexOf('/tasks/claim`')
  assert.ok(prepare > 0 && resume > prepare && resume < printCall, 'delete residue, then resume, immediately before print')
  assert.ok(settle > printCall, 'delete failed residue before pausing again')
  assert.ok(claimGate > 0 && claimGate < claimPost, 'gate sits in front of the claim request')
  assert.ok(readFileSync(indexSourcePath, 'utf8').includes('runAgentBoot('), 'boot order function is what index calls')
  assert.match(taskRunner, /inFlight/)
  assert.match(taskRunner, /maxTasks/)
  assert.equal(taskRunner.includes('cleanupCrashLeftoverPrintTaskTemps'), false)

  const heartbeat = readFileSync(heartbeatSourcePath, 'utf8')
  assert.match(heartbeat, /printerStatusForHeartbeat\(/)

  const hold = readFileSync(holdSourcePath, 'utf8')
  assert.ok(hold.includes(OWN_ANCHOR))
  assert.ok(hold.includes("await applyPrinterQueueMethod({ printerName, method: 'Pause' })"))
  assert.ok(hold.includes('queue-state-readback'))
}

async function verifyPrintDispatchGate(): Promise<void> {
  __resetPrintDispatchGateForTests()
  noteStartupPrintQueueFailure('cleanup')
  assert.equal(printerStatusForHeartbeat('ready'), 'queue_cleanup_failed')
  __resetPrintDispatchGateForTests()
  noteStartupPrintQueueFailure('pause')
  assert.equal(printerStatusForHeartbeat('ready'), 'queue_pause_failed')
  __resetPrintDispatchGateForTests()
  noteStartupPrintQueueFailure('cleanup')
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
  assert.deepEqual(PAUSE_RETRY_DELAYS_MS, [1_000, 2_000, 4_000])
  let attempts = 0
  const delays: number[] = []
  await pauseQueueAfterTerminalState(async () => {
    attempts += 1
    throw new Error('pause')
  }, async (ms) => {
    delays.push(ms)
  })
  assert.equal(attempts, 4)
  assert.deepEqual(delays, [1_000, 2_000, 4_000])
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
  assert.equal(printerStatusForHeartbeat('low_paper'), 'queue_pause_failed')

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

  const failedEvents: string[] = []
  await settlePrinterAfterTerminal({
    outcome: 'failed',
    pauseAgain: true,
    removeOwnJobs: async () => { failedEvents.push('remove') },
    pause: async () => { failedEvents.push('pause') },
  })
  assert.deepEqual(failedEvents, ['remove', 'pause'], 'a failed terminal deletes own jobs before pausing')
  __resetPrintDispatchGateForTests()
  const completedEvents: string[] = []
  await settlePrinterAfterTerminal({
    outcome: 'completed',
    pauseAgain: true,
    removeOwnJobs: async () => { completedEvents.push('remove') },
    pause: async () => { completedEvents.push('pause') },
  })
  assert.deepEqual(completedEvents, ['pause'], 'a completed job is not removed')
  const holdOffEvents: string[] = []
  await settlePrinterAfterTerminal({
    outcome: 'failed',
    pauseAgain: false,
    removeOwnJobs: async () => { holdOffEvents.push('remove') },
    pause: async () => { holdOffEvents.push('pause') },
  })
  assert.deepEqual(holdOffEvents, ['remove'], 'failed cleanup runs even when idle hold is off')

  __resetPrintDispatchGateForTests()
  let prepareRemoved = 0
  let prepareResumed = 0
  const prepared = await preparePrinterForDispatch({
    holdEnabled: false,
    removeOwnJobs: async () => { prepareRemoved += 1 },
    resume: async () => { prepareResumed += 1 },
  })
  assert.equal(prepared, 'ready')
  assert.equal(prepareRemoved, 1, 'pre-dispatch cleanup runs when idle hold is off')
  assert.equal(prepareResumed, 0)

  __resetPrintDispatchGateForTests()
  const blocked = await preparePrinterForDispatch({
    holdEnabled: true,
    removeOwnJobs: async () => { throw new Error('cleanup') },
    resume: async () => { throw new Error('must not resume') },
  })
  assert.equal(blocked, 'cleanup-failed')
  assert.equal(printerStatusForHeartbeat('ready'), 'queue_cleanup_failed')
  claims = 0
  await claimPrintTasksIfGateOpen(
    {
      holdEnabled: true,
      pause: async () => { throw new Error('pause') },
      cleanup: async () => { throw new Error('still dirty') },
    },
    async () => { claims += 1 },
  )
  assert.equal(claims, 0, 'cleanup failure must not claim')

  __resetPrintDispatchGateForTests()
  const resumeFailed = await preparePrinterForDispatch({
    holdEnabled: true,
    removeOwnJobs: async () => undefined,
    resume: async () => {
      throw new Error('resume')
    },
  })
  assert.equal(resumeFailed, 'resume-failed')
  assert.equal(printerStatusForHeartbeat('ready'), 'queue_pause_failed')
  claims = 0
  await claimPrintTasksIfGateOpen(
    {
      holdEnabled: true,
      pause: async () => {
        throw new Error('still')
      },
      cleanup: async () => {
        throw new Error('cleanup')
      },
    },
    async () => {
      claims += 1
    },
  )
  assert.equal(claims, 0, 'resume failure must not claim the next job')
  __resetPrintDispatchGateForTests()
}

async function verifyQueueStateReadback(): Promise<void> {
  assert.equal(QUEUE_STATE_READBACK_WINDOW_MS, 2_000)
  const chinese = '奔图彩色打印机'
  await assert.rejects(
    () => applyPrinterQueueMethod({
      printerName: chinese,
      method: 'Pause',
      invokeCim: async () => undefined,
      readPaused: async () => false,
      windowMs: 0,
    }),
    (error: unknown) => {
      assert.ok(error instanceof PrintQueueHoldError)
      assert.equal(error.step, 'pause')
      assert.match(error.message, /print queue state did not change/)
      return true
    },
  )
  await assert.rejects(
    () => applyPrinterQueueMethod({
      printerName: chinese,
      method: 'Resume',
      invokeCim: async () => undefined,
      readPaused: async () => true,
      windowMs: 0,
    }),
    (error: unknown) => {
      assert.ok(error instanceof PrintQueueHoldError)
      assert.equal(error.step, 'resume')
      assert.match(error.message, /print queue state did not change/)
      return true
    },
  )
  await applyPrinterQueueMethod({
    printerName: chinese,
    method: 'Pause',
    invokeCim: async () => undefined,
    readPaused: async () => true,
    windowMs: 0,
  })

  let clock = 1_000
  let reads = 0
  await applyPrinterQueueMethod({
    printerName: chinese,
    method: 'Pause',
    invokeCim: async () => undefined,
    readPaused: async () => {
      reads += 1
      return reads >= 3
    },
    now: () => clock,
    sleep: async (ms) => {
      clock += ms
    },
  })
  assert.equal(reads, 3)
  assert.ok(clock < 1_000 + QUEUE_STATE_READBACK_WINDOW_MS)

  clock = 0
  await assert.rejects(
    () => confirmPrinterQueueHoldState({
      method: 'Resume',
      readPaused: async () => true,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms
      },
      windowMs: QUEUE_STATE_READBACK_WINDOW_MS,
    }),
    /print queue state did not change/,
  )
  assert.ok(clock >= QUEUE_STATE_READBACK_WINDOW_MS)

  assert.equal(pauseSignalFromProbeLine('3,0,False,1,0'), true)
  assert.equal(pauseSignalFromProbeLine('3,0,False,0,8'), true)
  assert.equal(pauseSignalFromProbeLine('3,0,False,0,0'), false)
  assert.equal(pauseSignalFromProbeLine('3,0,False,,'), false)
  assert.equal(pauseSignalFromProbeLine('3,0,False,abc,0'), null)
  assert.equal(pauseSignalFromProbeLine('query_failed'), null)
  assert.equal(pauseSignalFromProbeLine('not_found'), null)
  assert.equal(pauseSignalFromProbeLine(null), null)

  let fatalPauses = 0
  await pauseBeforeFatalExit({ enabled: false, pause: async () => { fatalPauses += 1 } })
  assert.equal(fatalPauses, 0)
  await pauseBeforeFatalExit({
    enabled: true,
    pause: async () => {
      throw new Error('pause')
    },
    timeoutMs: 50,
  })
  const hungAt = Date.now()
  await pauseBeforeFatalExit({
    enabled: true,
    pause: () => new Promise(() => undefined),
    timeoutMs: 40,
  })
  assert.ok(Date.now() - hungAt < 400, 'fatal exit must not wait on a stuck pause')

  const seen: string[] = []
  const handlers: Partial<Record<'uncaughtException' | 'unhandledRejection', (value: unknown) => void>> = {}
  installFatalPrintQueuePause({
    enabled: true,
    pause: async () => { seen.push('pause') },
    logError: () => undefined,
    exit: (code) => { seen.push(`exit:${code}`) },
    on: (event, handler) => { handlers[event] = handler },
  })
  handlers.uncaughtException?.(new Error('boom'))
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(seen.filter((item) => item === 'pause').length, 1)
  assert.ok(seen.includes('exit:1'))

  const quiet: string[] = []
  const quietHandlers: Partial<Record<'uncaughtException' | 'unhandledRejection', (value: unknown) => void>> = {}
  installFatalPrintQueuePause({
    enabled: false,
    pause: async () => { quiet.push('pause') },
    logError: () => undefined,
    exit: (code) => { quiet.push(`exit:${code}`) },
    on: (event, handler) => { quietHandlers[event] = handler },
  })
  quietHandlers.unhandledRejection?.('nope')
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(quiet.includes('pause'), false)
  assert.ok(quiet.includes('exit:1'))
}

async function verifyInFlightSkipsPreDispatch(): Promise<void> {
  let claims = 0
  let preDispatch = 0
  let releaseMonitor: () => void = () => undefined
  const monitoring = new Promise<void>((resolve) => { releaseMonitor = resolve })
  const control = createTaskRunnerControl({
    intervalMs: 60_000,
    runCycle: async () => {
      claims += 1
      if (claims === 1) {
        await monitoring
        return
      }
      preDispatch += 1
    },
    onCycleError: () => undefined,
  })
  const first = control.wake()
  assert.equal(first.accepted, true)
  assert.equal(first.coalesced, false)
  await new Promise((resolve) => setTimeout(resolve, 30))
  const second = control.wake()
  assert.equal(second.coalesced, true)
  assert.equal(claims, 1, 'a job still being monitored must not claim the next one')
  assert.equal(preDispatch, 0, 'pre-dispatch cleanup must not run while the previous job is open')
  releaseMonitor()
  await new Promise((resolve) => setTimeout(resolve, 50))
  assert.equal(claims, 2)
  assert.equal(preDispatch, 1)
  control.stop()
}

async function verifyBootOrder(): Promise<void> {
  const events: string[] = []
  await runAgentBoot({
    acquireLock: async () => { events.push('lock') },
    afterLock: async () => { events.push('after') },
    cleanupOwnPrintJobs: async () => { events.push('cleanup') },
    beforeClaim: async () => { events.push('before') },
    startClaimLoop: () => { events.push('claim') },
  })
  assert.deepEqual(events, ['lock', 'after', 'cleanup', 'before', 'claim'])
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
  assert.equal(cleaned.unreadableUserJobs, 0)
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
const parsed = parsePrintJobListOutput('{"jobs":[{"id":2,"owned":true},{"id":7,"owned":true,"unreadable":true}],"unreadable":1}')
if (parsed.unreadableUserJobs !== 1) process.exit(1)
let selected
try {
  selected = selectOwnPrintJobIds(parsed.jobs)
} catch (error) {
  process.exit(1)
}
if (!selected.includes(2) || selected.includes(7)) process.exit(1)
process.exit(0)
`

const claimChild = `
const gate = require('./src/agent/print-dispatch-gate')
;(async () => {
  gate.__resetPrintDispatchGateForTests()
  gate.noteStartupPrintQueueFailure('cleanup')
  if (gate.printerStatusForHeartbeat('ready') !== 'queue_cleanup_failed') process.exit(1)
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
  if (attempts !== 4) process.exit(1)
  let claims = 0
  await gate.claimPrintTasksIfGateOpen({
    holdEnabled: true,
    pause: async () => { throw new Error('still') },
    cleanup: async () => { throw new Error('cleanup') },
  }, async () => { claims += 1 })
  if (claims !== 0) process.exit(1)
  if (gate.printerStatusForHeartbeat('ready') !== 'queue_pause_failed') process.exit(1)
  process.exit(0)
})().catch(() => process.exit(1))
`

const startupChild = `
const gate = require('./src/agent/print-dispatch-gate')
gate.__resetPrintDispatchGateForTests()
gate.noteStartupPrintQueueFailure('cleanup')
if (gate.printerStatusForHeartbeat('paper_empty') !== 'queue_cleanup_failed') process.exit(1)
gate.__resetPrintDispatchGateForTests()
gate.noteStartupPrintQueueFailure('pause')
if (gate.printerStatusForHeartbeat('ready') !== 'queue_pause_failed') process.exit(1)
process.exit(0)
`

const indexChild = `
const fs = require('fs')
const index = fs.readFileSync('./src/index.ts', 'utf8')
const marker = index.indexOf('if (printQueueCleanupError)')
const lineStart = index.lastIndexOf('\\n', marker) + 1
const indent = index.slice(lineStart, marker)
const close = index.indexOf('\\n' + indent + '}', marker)
const runner = index.indexOf('startTaskRunner(')
const tempExit = index.indexOf('if (printTempCleanupError)')
if (marker < 0 || close < marker || runner < marker || tempExit < 0 || tempExit > marker) process.exit(1)
const branch = index.slice(marker, close)
if (branch.includes('failStartup') || branch.includes('process.exit')) process.exit(1)
if (!branch.includes('noteStartupPrintQueueFailure')) process.exit(1)
if (!index.slice(tempExit, marker).includes('failStartup')) process.exit(1)
process.exit(0)
`

const settleChild = `
const gate = require('./src/agent/print-dispatch-gate')
;(async () => {
  const events = []
  await gate.settlePrinterAfterTerminal({
    outcome: 'failed',
    pauseAgain: true,
    removeOwnJobs: async () => { events.push('remove') },
    pause: async () => { events.push('pause') },
  })
  if (events.join(',') !== 'remove,pause') process.exit(1)
  process.exit(0)
})().catch(() => process.exit(1))
`

const prepareChild = `
const gate = require('./src/agent/print-dispatch-gate')
;(async () => {
  gate.__resetPrintDispatchGateForTests()
  let removed = 0
  const result = await gate.preparePrinterForDispatch({
    holdEnabled: false,
    removeOwnJobs: async () => { removed += 1 },
    resume: async () => { throw new Error('resume') },
  })
  if (result !== 'ready' || removed !== 1) process.exit(1)
  process.exit(0)
})().catch(() => process.exit(1))
`

const deleteFailureChild = `
const gate = require('./src/agent/print-dispatch-gate')
;(async () => {
  gate.__resetPrintDispatchGateForTests()
  const result = await gate.preparePrinterForDispatch({
    holdEnabled: false,
    removeOwnJobs: async () => { throw new Error('cleanup') },
    resume: async () => { throw new Error('resume') },
  })
  if (result !== 'cleanup-failed') process.exit(1)
  if (gate.printerStatusForHeartbeat('ready') !== 'queue_cleanup_failed') process.exit(1)
  let claims = 0
  await gate.claimPrintTasksIfGateOpen({
    holdEnabled: false,
    pause: async () => {},
    cleanup: async () => { throw new Error('still') },
  }, async () => { claims += 1 })
  if (claims !== 0) process.exit(1)
  process.exit(0)
})().catch(() => process.exit(1))
`

const resumeChild = `
const gate = require('./src/agent/print-dispatch-gate')
;(async () => {
  gate.__resetPrintDispatchGateForTests()
  const result = await gate.preparePrinterForDispatch({
    holdEnabled: true,
    removeOwnJobs: async () => {},
    resume: async () => { throw new Error('resume') },
  })
  let claims = 0
  await gate.claimPrintTasksIfGateOpen({
    holdEnabled: true,
    pause: async () => { throw new Error('still') },
    cleanup: async () => { throw new Error('cleanup') },
  }, async () => { claims += 1 })
  if (result !== 'resume-failed') process.exit(1)
  if (gate.printerStatusForHeartbeat('ready') !== 'queue_pause_failed') process.exit(1)
  if (claims !== 0) process.exit(1)
  process.exit(0)
})().catch(() => process.exit(1))
`

const readbackChild = `
const { applyPrinterQueueMethod } = require('./src/agent/print-queue-hold')
;(async () => {
  let threw = false
  try {
    await applyPrinterQueueMethod({
      printerName: '奔图彩色打印机',
      method: 'Pause',
      invokeCim: async () => {},
      readPaused: async () => false,
      windowMs: 0,
    })
  } catch (error) {
    threw = /print queue state did not change/.test(String(error && error.message))
  }
  if (!threw) process.exit(1)
  process.exit(0)
})().catch(() => process.exit(1))
`

const ownJobIdChild = `
const { selectOwnPrintJobIds } = require('./src/agent/print-queue-hold')
let threw = false
try {
  selectOwnPrintJobIds([{ id: 0, ownedByCurrentProcess: true }])
} catch (error) {
  threw = /print job id is unreadable/.test(String(error && error.message))
}
if (!threw) process.exit(1)
const foreign = selectOwnPrintJobIds([
  { id: 0, ownedByCurrentProcess: false },
  { id: 4, ownedByCurrentProcess: true },
])
if (foreign.join(',') !== '4') process.exit(1)
process.exit(0)
`

const queryFailedChild = `
const { buildWin32PrinterProbeScript, mapWin32PrinterQuery, mapWin32PrinterPreflight } = require('./src/agent/wmi')
const probe = buildWin32PrinterProbeScript()
if (!probe.includes("} catch { 'query_failed'; exit }")) process.exit(1)
if (mapWin32PrinterQuery('query_failed') !== 'unknown') process.exit(1)
if (mapWin32PrinterPreflight('query_failed') !== 'unknown') process.exit(1)
if (mapWin32PrinterQuery('not_found') !== 'error') process.exit(1)
if (mapWin32PrinterPreflight('not_found') !== 'not_found') process.exit(1)
process.exit(0)
`

const utf8Child = `
const fs = require('fs')
const { POWERSHELL_STDIN_UTF8, escapeWqlLiteral, win32PrinterNameFilter } = require('./src/agent/wql-literal')
const { CIM_METHOD_SCRIPT, LIST_JOBS_SCRIPT, REMOVE_JOBS_SCRIPT } = require('./src/agent/print-queue-hold')
const { buildWin32PrinterProbeScript, buildPrintJobStatusScript, buildPrintServiceCompletionEventScript } = require('./src/agent/wmi')
const { PRINTER_NETWORK_SCRIPT } = require('./src/agent/network-diagnostics')
const expected = "[Console]::InputEncoding = [System.Text.Encoding]::UTF8"
if (POWERSHELL_STDIN_UTF8 !== expected) process.exit(1)
const chinese = '奔图彩色打印机'
if (escapeWqlLiteral(chinese) !== chinese) process.exit(1)
if (win32PrinterNameFilter(chinese) !== "Name='" + chinese + "'") process.exit(1)
function firstRead(script) {
  const reads = ['[Console]::In.ReadLine()', '[Console]::In.ReadToEnd()']
    .map((token) => script.indexOf(token))
    .filter((index) => index >= 0)
  return reads.length === 0 ? -1 : Math.min(...reads)
}
for (const script of [
  CIM_METHOD_SCRIPT,
  LIST_JOBS_SCRIPT,
  REMOVE_JOBS_SCRIPT,
  buildWin32PrinterProbeScript(),
  buildPrintJobStatusScript(),
  buildPrintServiceCompletionEventScript(),
  PRINTER_NETWORK_SCRIPT,
]) {
  const markerAt = script.indexOf(expected)
  const readAt = firstRead(script)
  if (markerAt < 0 || readAt <= markerAt) process.exit(1)
}
const hold = fs.readFileSync('./src/agent/print-queue-hold.ts', 'utf8')
const wmi = fs.readFileSync('./src/agent/wmi.ts', 'utf8')
if (!hold.includes("child.stdin.end(stdin, 'utf8')")) process.exit(1)
if (!wmi.includes("child.stdin.end(stdin, 'utf8')")) process.exit(1)
process.exit(0)
`

const fatalChild = `
const gate = require('./src/agent/print-dispatch-gate')
;(async () => {
  await gate.pauseBeforeFatalExit({
    enabled: true,
    timeoutMs: 200,
    pause: async () => { throw new Error('pause') },
  })
  const events = []
  const handlers = {}
  gate.installFatalPrintQueuePause({
    enabled: true,
    pause: async () => { events.push('pause') },
    logError: () => {},
    exit: () => { events.push('exit') },
    on: (event, handler) => { handlers[event] = handler },
  })
  handlers.uncaughtException(new Error('boom'))
  await new Promise((resolve) => setTimeout(resolve, 30))
  if (!events.includes('pause') || !events.includes('exit')) process.exit(1)
  process.exit(0)
})().catch(() => process.exit(1))
`

const bootChild = `
const { runAgentBoot } = require('./src/agent/boot-print-queue-order')
;(async () => {
  const events = []
  await runAgentBoot({
    acquireLock: async () => { events.push('lock') },
    afterLock: async () => { events.push('after') },
    cleanupOwnPrintJobs: async () => { events.push('cleanup') },
    beforeClaim: async () => { events.push('before') },
    startClaimLoop: () => { events.push('claim') },
  })
  if (events.join(',') !== 'lock,after,cleanup,before,claim') process.exit(1)
  process.exit(0)
})().catch(() => process.exit(1))
`

function verifyReverseMutations(): void {
  const wmiSourcePath = join(__dirname, '../src/agent/wmi.ts')
  const wqlSourcePath = join(__dirname, '../src/agent/wql-literal.ts')
  const hold = readFileSync(holdSourcePath, 'utf8')
  const gate = readFileSync(gateSourcePath, 'utf8')
  const index = readFileSync(indexSourcePath, 'utf8')
  const boot = readFileSync(bootSourcePath, 'utf8')
  const wmi = readFileSync(wmiSourcePath, 'utf8')
  const wql = readFileSync(wqlSourcePath, 'utf8')
  assert.equal(runNodeEval(selectorChild).status, 0)
  assert.equal(runNodeEval(claimChild).status, 0)
  assert.equal(runNodeEval(pauseChild).status, 0)
  assert.equal(runNodeEval(startupChild).status, 0)
  assert.equal(runNodeEval(indexChild).status, 0)
  assert.equal(runNodeEval(settleChild).status, 0)
  assert.equal(runNodeEval(prepareChild).status, 0)
  assert.equal(runNodeEval(deleteFailureChild).status, 0)
  assert.equal(runNodeEval(bootChild).status, 0)
  assert.equal(runNodeEval(resumeChild).status, 0, 'resume-failure baseline')
  assert.equal(runNodeEval(readbackChild).status, 0, 'readback baseline')
  assert.equal(runNodeEval(ownJobIdChild).status, 0, 'own job id baseline')
  assert.equal(runNodeEval(queryFailedChild).status, 0, 'query_failed baseline')
  assert.equal(runNodeEval(utf8Child).status, 0, 'utf8 baseline')
  assert.equal(runNodeEval(fatalChild).status, 0, 'fatal pause baseline')

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
    [
      'unreadable user throws',
      holdSourcePath,
      hold,
      UNREADABLE_SKIP_ANCHOR,
      `if (job.unreadableUser === true) throw new PrintQueueHoldError('print job user is unreadable')`,
    ],
    ['claim while blocked', gateSourcePath, gate, CLAIM_RETURN_ANCHOR, ''],
    ['recovery reports open', gateSourcePath, gate, CLAIM_BLOCK_ANCHOR, 'return true // print-dispatch-gate: keep claims blocked'],
    ['pause failure still claims', gateSourcePath, gate, PAUSE_GATE_ANCHOR, ''],
    ['heartbeat stays queried', gateSourcePath, gate, HEARTBEAT_ANCHOR, 'return queried'],
    ['startup cleanup exits', gateSourcePath, gate, STARTUP_GATE_ANCHOR, 'process.exit(1)'],
    [
      'startup cleanup failStartup',
      indexSourcePath,
      index,
      QUEUE_BRANCH_ANCHOR,
      `        if (printQueueCleanupError) {
          noteStartupPrintQueueFailure(startupQueueFailure)
          failStartup(printQueueCleanupError, 'AGENT_STARTUP_FAILED')
        }`,
    ],
    ['failed terminal keeps the job', gateSourcePath, gate, SETTLE_DELETE_ANCHOR, ''],
    ['pre-dispatch keeps the job', gateSourcePath, gate, PREPARE_DELETE_ANCHOR, ''],
    ['delete failure still claims', gateSourcePath, gate, PREPARE_NOTE_ANCHOR, ''],
    [
      'cleanup after claim loop',
      bootSourcePath,
      boot,
      BOOT_ORDER_ANCHOR,
      `  await steps.acquireLock()
  await steps.afterLock()
  await steps.beforeClaim()
  steps.startClaimLoop()
  await steps.cleanupOwnPrintJobs()`,
    ],
    [
      'cleanup before the lock',
      bootSourcePath,
      boot,
      BOOT_ORDER_ANCHOR,
      `  await steps.cleanupOwnPrintJobs()
  await steps.acquireLock()
  await steps.afterLock()
  await steps.beforeClaim()
  steps.startClaimLoop()`,
    ],
    ['resume failure leaves the gate open', gateSourcePath, gate, PREPARE_RESUME_ANCHOR, ''],
    ['readback removed', holdSourcePath, hold, READBACK_ANCHOR, ''],
    ['own job id skipped', holdSourcePath, hold, OWN_JOB_ID_ANCHOR, 'continue'],
    ['query failure reported as missing', wmiSourcePath, wmi, QUERY_FAILED_ANCHOR, `} catch { 'not_found'; exit }`],
    ['stdin utf-8 constant removed', wqlSourcePath, wql, UTF8_ANCHOR, 'export const POWERSHELL_STDIN_UTF8 = ""'],
    ['stdin written without utf8', holdSourcePath, hold, STDIN_UTF8_ANCHOR, 'child.stdin.end(stdin)'],
    ['fatal exit skips pause', gateSourcePath, gate, FATAL_PAUSE_ANCHOR, 'exit(1)'],
    ['fatal pause error blocks exit', gateSourcePath, gate, FATAL_SWALLOW_ANCHOR, ','],
  ]
  const children: Record<string, string> = {
    'own-account filter': selectorChild,
    'unreadable user': selectorChild,
    'unreadable user throws': selectorChild,
    'claim while blocked': claimChild,
    'recovery reports open': claimChild,
    'pause failure still claims': pauseChild,
    'heartbeat stays queried': claimChild,
    'startup cleanup exits': startupChild,
    'startup cleanup failStartup': indexChild,
    'failed terminal keeps the job': settleChild,
    'pre-dispatch keeps the job': prepareChild,
    'delete failure still claims': deleteFailureChild,
    'cleanup after claim loop': bootChild,
    'cleanup before the lock': bootChild,
    'resume failure leaves the gate open': resumeChild,
    'readback removed': readbackChild,
    'own job id skipped': ownJobIdChild,
    'query failure reported as missing': queryFailedChild,
    'stdin utf-8 constant removed': utf8Child,
    'stdin written without utf8': utf8Child,
    'fatal exit skips pause': fatalChild,
    'fatal pause error blocks exit': fatalChild,
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
  await verifyQueueStateReadback()
  await verifyInFlightSkipsPreDispatch()
  await verifyBootOrder()
  await verifyNonWindowsNoop()
  verifyReverseMutations()
  console.log('PASS print queue residue')
}

main().catch((error: unknown) => {
  console.error(error)
  process.exitCode = 1
})
