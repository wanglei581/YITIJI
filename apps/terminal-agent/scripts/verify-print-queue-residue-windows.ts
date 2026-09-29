/**
 * Windows CI：用系统自带的 Generic / Text Only 建本地文件端口打印机，真提交作业。
 * 非 Windows 直接退出 0，避免拖红 macOS / Linux CI。
 *
 * 队列先暂停再投作业，否则文件端口上的作业会立刻完成并消失。
 * 另一账号的作业用计划任务提交；交不出来就失败，不许跳过。
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  __resetPrintDispatchGateForTests,
  claimPrintTasksIfGateOpen,
  preparePrinterForDispatch,
  printerStatusForHeartbeat,
  settlePrinterAfterTerminal,
} from '../src/agent/print-dispatch-gate'
import {
  CIM_METHOD_SCRIPT,
  cleanupStaleOwnPrintJobs,
  LIST_JOBS_SCRIPT,
  listConfiguredPrintJobs,
  pauseConfiguredPrinterQueue,
  pauseSignalFromProbeLine,
  PrintQueueHoldError,
  REMOVE_JOBS_SCRIPT,
  resolvePrintJobUserSid,
  resumeConfiguredPrinterQueue,
  type PrintJobSnapshot,
  type PrintQueueCommandStep,
} from '../src/agent/print-queue-hold'
import { mapWin32PrinterPreflight, mapWin32PrinterQuery, queryWin32PrinterLine } from '../src/agent/wmi'

const PRINTER_A = 'AIJobResidueA'
const PRINTER_B = 'AIJobResidueB'
const CHINESE_PRINTER = '奔图彩色打印机'
const PORT_A = 'C:\\Windows\\Temp\\aijob-residue-a.prn'
const PORT_B = 'C:\\Windows\\Temp\\aijob-residue-b.prn'
const PORT_ZH = 'C:\\Windows\\Temp\\aijob-residue-zh.prn'
const TASK_NAME = 'AIJobResidueOther'
const USER_NAME = 'aijobqhold'
const TEST_PASSWORD = 'Aijob-Queue-Hold-1a'
const HOLD_SOURCE = join(__dirname, '../src/agent/print-queue-hold.ts')
const OWNER_ANCHOR = '$owned = $jobSid.Equals($currentSid)'
const PAUSE_ANCHOR = "await applyPrinterQueueMethod({ printerName, method: 'Pause' })"
const UNREADABLE_SKIP_ANCHOR = `    $skippedUnreadable += 1
    $unreadable = $true`

function scrub(text: string): string {
  return text.split(TEST_PASSWORD).join('***')
}

function replayFailedQueueStep(step: PrintQueueCommandStep, printerName: string): void {
  const script = step === 'list' ? LIST_JOBS_SCRIPT : step === 'remove' ? REMOVE_JOBS_SCRIPT : CIM_METHOD_SCRIPT
  const stdin =
    step === 'pause'
      ? JSON.stringify({ printerName, method: 'Pause' })
      : step === 'resume'
        ? JSON.stringify({ printerName, method: 'Resume' })
        : step === 'remove'
          ? JSON.stringify({ printerName, ids: [] })
          : JSON.stringify({ printerName })
  const result = spawnSync('powershell', ['-NonInteractive', '-NoProfile', '-Command', script], {
    input: stdin,
    encoding: 'utf8',
    timeout: 30_000,
  })
  const stderr = scrub(result.stderr || '') || '(empty)'
  console.error(`queue-step ${step} replay exit=${result.status ?? 'null'} stderr=${stderr}`)
}

async function showQueueFailure<T>(fallback: PrintQueueCommandStep, printerName: string, run: () => Promise<T>): Promise<T> {
  try {
    return await run()
  } catch (error) {
    if (error instanceof PrintQueueHoldError) replayFailedQueueStep(error.step ?? fallback, printerName)
    throw error
  }
}

function runPs(script: string): string {
  const result = spawnSync('powershell', ['-NonInteractive', '-NoProfile', '-Command', script], {
    encoding: 'utf8',
    timeout: 90_000,
    env: { ...process.env, AIJOB_RESIDUE_PW: TEST_PASSWORD },
  })
  if (result.error) throw new Error(scrub(result.error.message))
  if (result.status !== 0) {
    throw new Error(scrub(`powershell exited ${result.status ?? 'null'}: ${result.stderr || result.stdout}`))
  }
  return result.stdout ?? ''
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForJob(
  printerName: string,
  predicate: (job: PrintJobSnapshot) => boolean,
): Promise<PrintJobSnapshot> {
  const deadline = Date.now() + 25_000
  while (Date.now() < deadline) {
    const listed = await showQueueFailure('list', printerName, () => listConfiguredPrintJobs(printerName))
    const job = listed.jobs.find((entry) => predicate(entry))
    if (job) return job
    await sleep(500)
  }
  throw new Error(`print job did not appear on ${printerName}`)
}

async function verifySidResolution(): Promise<void> {
  assert.equal((await resolvePrintJobUserSid('SYSTEM')).trim(), 'S-1-5-18')
  assert.equal((await resolvePrintJobUserSid('NT AUTHORITY\\SYSTEM')).trim(), 'S-1-5-18')
  assert.equal((await resolvePrintJobUserSid('system')).trim(), 'S-1-5-18')
  const currentName = runPs('[System.Security.Principal.WindowsIdentity]::GetCurrent().Name').trim()
  const currentSid = runPs('[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value').trim()
  assert.equal((await resolvePrintJobUserSid(currentName)).trim(), currentSid)
  const machine = runPs('[Environment]::MachineName').trim()
  const machineSid = (await resolvePrintJobUserSid(`${machine}$`)).trim()
  assert.match(machineSid, /^S-1-/)
  assert.equal((await resolvePrintJobUserSid(`${machine}\\${machine}$`)).trim(), machineSid)
  await assert.rejects(() => resolvePrintJobUserSid('   '))
  await assert.rejects(() => resolvePrintJobUserSid('NoSuchPrintJobUser-xyz'))
}

function createPrinters(): void {
  runPs(`
$ErrorActionPreference = 'Stop'
$driver = 'Generic / Text Only'
$installed = Get-PrinterDriver -Name $driver -ErrorAction SilentlyContinue
if (-not $installed) {
  try {
    Add-PrinterDriver -Name $driver
  } catch {
    throw ("Generic / Text Only driver is not installed and Add-PrinterDriver failed: " + $_.Exception.Message)
  }
}
$installed = Get-PrinterDriver -Name $driver -ErrorAction SilentlyContinue
if (-not $installed) { throw 'Generic / Text Only driver is not installed after Add-PrinterDriver' }
foreach ($pair in @(
  @{ Name = '${PRINTER_A}'; Port = '${PORT_A}' },
  @{ Name = '${PRINTER_B}'; Port = '${PORT_B}' }
)) {
  if (-not (Get-PrinterPort -Name $pair.Port -ErrorAction SilentlyContinue)) {
    Add-PrinterPort -Name $pair.Port
  }
  if (-not (Get-Printer -Name $pair.Name -ErrorAction SilentlyContinue)) {
    Add-Printer -Name $pair.Name -DriverName $driver -PortName $pair.Port
  }
}
foreach ($name in @('${PRINTER_A}','${PRINTER_B}')) {
  $created = Get-Printer -Name $name -ErrorAction Stop
  if ([string]$created.Name -ne $name) { throw 'created printer name mismatch' }
  Write-Output ("printer-created " + $name)
}
`)
}

function submitOwnJob(printerName: string): void {
  runPs(`'queued' | Out-Printer -Name '${printerName}'`)
}

function submitOtherAccountJob(): void {
  const scriptPath = join(tmpdir(), 'aijob-residue-other.ps1')
  writeFileSync(scriptPath, `'queued' | Out-Printer -Name '${PRINTER_A}'\r\n`, 'utf8')
  runPs(`
$ErrorActionPreference = 'Stop'
cmd /c "net user ${USER_NAME} /delete" | Out-Null
cmd /c "net user ${USER_NAME} %AIJOB_RESIDUE_PW% /add"
if ($LASTEXITCODE -ne 0) { throw 'local user was not created' }
schtasks /Delete /TN ${TASK_NAME} /F 2>$null | Out-Null
schtasks /Create /TN ${TASK_NAME} /TR "powershell.exe -NoProfile -ExecutionPolicy Bypass -File ${scriptPath}" /SC ONCE /ST 23:59 /RU ".\\${USER_NAME}" /RP $env:AIJOB_RESIDUE_PW /F /RL LIMITED
if ($LASTEXITCODE -ne 0) { throw 'scheduled task was not created' }
schtasks /Run /TN ${TASK_NAME}
if ($LASTEXITCODE -ne 0) { throw 'scheduled task did not start' }
`)
}

function removeFixtures(): void {
  const result = spawnSync(
    'powershell',
    [
      '-NonInteractive',
      '-NoProfile',
      '-Command',
      `
$ErrorActionPreference = 'Continue'
schtasks /Delete /TN ${TASK_NAME} /F 2>$null | Out-Null
cmd /c "net user ${USER_NAME} /delete >nul 2>&1"
$cleanupError = $null
foreach ($name in @('${PRINTER_A}','${PRINTER_B}')) {
  $printer = Get-Printer -Name $name -ErrorAction SilentlyContinue
  if ($printer) {
    try { Remove-Printer -Name $name -ErrorAction Stop }
    catch { $cleanupError = $_.Exception.Message }
  }
}
$zhName = $env:AIJOB_ZH_PRINTER
if (-not [string]::IsNullOrWhiteSpace($zhName)) {
  $zhPrinter = Get-Printer -Name $zhName -ErrorAction SilentlyContinue
  if ($zhPrinter) {
    try { Remove-Printer -Name $zhName -ErrorAction Stop }
    catch { $cleanupError = $_.Exception.Message }
  }
}
foreach ($port in @('${PORT_A}','${PORT_B}','${PORT_ZH}')) {
  $existing = Get-PrinterPort -Name $port -ErrorAction SilentlyContinue
  if ($existing) {
    try { Remove-PrinterPort -Name $port -ErrorAction Stop }
    catch { $cleanupError = $_.Exception.Message }
  }
}
Remove-Item -LiteralPath '${PORT_A}','${PORT_B}','${PORT_ZH}','${join(tmpdir(), 'aijob-residue-other.ps1')}' -Force -ErrorAction SilentlyContinue
if ($null -ne $cleanupError) {
  Write-Error $cleanupError
  exit 1
}
exit 0
`,
    ],
    { encoding: 'utf8', timeout: 90_000, env: { ...process.env, AIJOB_ZH_PRINTER: CHINESE_PRINTER } },
  )
  if (result.status !== 0) {
    throw new Error(scrub(`fixture cleanup failed: ${result.stderr || result.stdout}`))
  }
}

async function runScenario(): Promise<void> {
  await verifySidResolution()
  createPrinters()
  await showQueueFailure('pause', PRINTER_A, () => pauseConfiguredPrinterQueue(PRINTER_A))
  await showQueueFailure('pause', PRINTER_B, () => pauseConfiguredPrinterQueue(PRINTER_B))
  submitOtherAccountJob()
  const other = await waitForJob(PRINTER_A, (job) => !job.ownedByCurrentProcess)
  submitOwnJob(PRINTER_A)
  submitOwnJob(PRINTER_B)
  const jobA = await waitForJob(PRINTER_A, (job) => job.ownedByCurrentProcess && job.id !== other.id)
  const jobC = await waitForJob(PRINTER_B, (job) => job.ownedByCurrentProcess)
  const currentSid = runPs('[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value').trim()
  assert.match(currentSid, /^S-1-5-/, 'current process SID must be a Windows SID')
  assert.equal(jobA.ownedByCurrentProcess, true, 'failed-terminal: current process SID matched the own-account job')
  assert.equal(other.ownedByCurrentProcess, false, 'failed-terminal: other-account job is not this process SID')
  __resetPrintDispatchGateForTests()
  await settlePrinterAfterTerminal({
    outcome: 'failed',
    pauseAgain: false,
    removeOwnJobs: async () => {
      await showQueueFailure('list', PRINTER_A, () => cleanupStaleOwnPrintJobs({ printerName: PRINTER_A }))
    },
    pause: async () => {
      throw new Error('failed-terminal cleanup must not pause when idle hold is off')
    },
  })
  const afterCleanup = await listConfiguredPrintJobs(PRINTER_A)
  assert.equal(afterCleanup.jobs.some((job) => job.id === jobA.id), false, 'failed-terminal: own-account job must be removed')
  assert.equal(afterCleanup.jobs.some((job) => job.id === other.id), true, 'failed-terminal: other-account job must stay')
  const onOtherPrinter = await listConfiguredPrintJobs(PRINTER_B)
  assert.equal(onOtherPrinter.jobs.some((job) => job.id === jobC.id), true, 'failed-terminal: job on the other printer must stay')

  submitOwnJob(PRINTER_A)
  const jobB = await waitForJob(
    PRINTER_A,
    (job) => job.ownedByCurrentProcess && job.id !== jobA.id && job.id !== other.id,
  )
  const prepared = await preparePrinterForDispatch({
    holdEnabled: false,
    removeOwnJobs: async () => {
      await showQueueFailure('list', PRINTER_A, () => cleanupStaleOwnPrintJobs({ printerName: PRINTER_A }))
    },
    resume: async () => {
      throw new Error('pre-dispatch cleanup must not resume when idle hold is off')
    },
  })
  assert.equal(prepared, 'ready', 'pre-dispatch: cleanup of the real queue must succeed')
  const kept = await listConfiguredPrintJobs(PRINTER_A)
  assert.equal(kept.jobs.some((job) => job.id === jobB.id), false, 'pre-dispatch: own-account leftover must be removed')
  assert.equal(kept.jobs.some((job) => job.id === other.id), true, 'pre-dispatch: other-account job must still stay')

  // 删掉提交那份作业的账号之后，用户名读不出来。清理必须成功，这份作业留下，本账号新作业删掉。
  // 若已删账号仍能解析成 SID，这一段会失败：那说明跳过逻辑没被走到。
  runPs(`
$ErrorActionPreference = 'Stop'
schtasks /Delete /TN ${TASK_NAME} /F | Out-Null
cmd /c "net user ${USER_NAME} /delete"
if ($LASTEXITCODE -ne 0) { throw "deleted-account fixture: net user /delete exited $LASTEXITCODE" }
exit 0
`)
  submitOwnJob(PRINTER_A)
  const jobAfterDelete = await waitForJob(
    PRINTER_A,
    (job) => job.ownedByCurrentProcess && job.id !== jobA.id && job.id !== jobB.id && job.id !== other.id,
  )
  const cleaned = await showQueueFailure('list', PRINTER_A, () => cleanupStaleOwnPrintJobs({ printerName: PRINTER_A }))
  assert.ok(cleaned.unreadableUserJobs >= 1, 'unreadable user jobs must be counted, not fail the cleanup')
  const afterUnreadable = await listConfiguredPrintJobs(PRINTER_A)
  const keptUnreadable = afterUnreadable.jobs.find((job) => job.id === other.id)
  assert.ok(keptUnreadable, 'job of the deleted account must stay')
  assert.equal(keptUnreadable.unreadableUser, true, 'deleted-account job must be marked unreadable')
  assert.equal(
    afterUnreadable.jobs.some((job) => job.id === jobAfterDelete.id),
    false,
    'own job must still be removed when another job has an unreadable user',
  )

  await showQueueFailure('resume', PRINTER_A, () => resumeConfiguredPrinterQueue(PRINTER_A))
  const resumed = await queryWin32PrinterLine(PRINTER_A)
  console.log(`resumed-probe ${resumed ?? 'null'}`)
  assert.equal(pauseSignalFromProbeLine(resumed), false, 'resume must clear the pause signal')
  await showQueueFailure('pause', PRINTER_A, () => pauseConfiguredPrinterQueue(PRINTER_A))
  const paused = await queryWin32PrinterLine(PRINTER_A)
  console.log(`paused-probe ${paused ?? 'null'}`)
  assert.notEqual(paused, 'not_found')
  assert.notEqual(paused, 'query_failed')
  assert.equal(pauseSignalFromProbeLine(paused), true, 'idle hold must leave the queue paused')
  assert.equal(mapWin32PrinterQuery(paused), 'ready', 'paused queue must still report ready')
  assert.equal(mapWin32PrinterPreflight(paused), 'ok', 'paused queue must still pass preflight')

  __resetPrintDispatchGateForTests()
  const missing = await preparePrinterForDispatch({
    holdEnabled: false,
    removeOwnJobs: async () => {
      await cleanupStaleOwnPrintJobs({ printerName: 'AIJobResidueMissing' })
    },
    resume: async () => {
      throw new Error('must not resume after a failed cleanup')
    },
  })
  assert.equal(missing, 'cleanup-failed')
  assert.equal(printerStatusForHeartbeat('ready'), 'queue_cleanup_failed')
  let claims = 0
  await claimPrintTasksIfGateOpen(
    {
      holdEnabled: false,
      pause: async () => undefined,
      cleanup: async () => {
        await cleanupStaleOwnPrintJobs({ printerName: 'AIJobResidueMissing' })
      },
    },
    async () => {
      claims += 1
    },
  )
  assert.equal(claims, 0, 'delete failure must keep the claim gate closed')
  __resetPrintDispatchGateForTests()
  await verifyChinesePrinter()
}

function tryCreateChinesePrinter(): boolean {
  const script = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$name = [Console]::In.ReadLine()
if ([string]::IsNullOrWhiteSpace($name)) { 'skip empty-name'; exit 2 }
$driver = 'Generic / Text Only'
$port = '${PORT_ZH}'
try {
  if (-not (Get-PrinterDriver -Name $driver -ErrorAction SilentlyContinue)) {
    Add-PrinterDriver -Name $driver
  }
  if (-not (Get-PrinterPort -Name $port -ErrorAction SilentlyContinue)) {
    Add-PrinterPort -Name $port
  }
  if (-not (Get-Printer -Name $name -ErrorAction SilentlyContinue)) {
    Add-Printer -Name $name -DriverName $driver -PortName $port
  }
  $created = Get-Printer -Name $name -ErrorAction Stop
  if ([string]$created.Name -ne $name) { 'skip name-mismatch'; exit 2 }
  'created'
  exit 0
} catch {
  'skip ' + $_.Exception.Message
  exit 2
}
`
  const result = spawnSync('powershell', ['-NonInteractive', '-NoProfile', '-Command', script], {
    input: `${CHINESE_PRINTER}\n`,
    encoding: 'utf8',
    timeout: 90_000,
  })
  const stdout = result.stdout ?? ''
  if (result.status === 0 && stdout.includes('created')) return true
  console.log(`chinese-printer-skipped: ${scrub(stdout || result.stderr || result.error?.message || 'create failed')}`)
  return false
}

async function verifyChinesePrinter(): Promise<void> {
  if (!tryCreateChinesePrinter()) return
  await showQueueFailure('pause', CHINESE_PRINTER, () => pauseConfiguredPrinterQueue(CHINESE_PRINTER))
  const paused = await queryWin32PrinterLine(CHINESE_PRINTER)
  assert.notEqual(paused, 'not_found')
  assert.notEqual(paused, 'query_failed')
  assert.equal(pauseSignalFromProbeLine(paused), true, 'chinese printer must read back as paused')
  await showQueueFailure('resume', CHINESE_PRINTER, () => resumeConfiguredPrinterQueue(CHINESE_PRINTER))
  const resumed = await queryWin32PrinterLine(CHINESE_PRINTER)
  assert.equal(pauseSignalFromProbeLine(resumed), false, 'chinese printer must read back as resumed')
  await showQueueFailure('list', CHINESE_PRINTER, () => listConfiguredPrintJobs(CHINESE_PRINTER))
}

function runSelf(): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ['-r', 'ts-node/register/transpile-only', __filename], {
    cwd: join(__dirname, '..'),
    encoding: 'utf8',
    timeout: 240_000,
    env: { ...process.env, PRINT_QUEUE_RESIDUE_CHILD: '1', TS_NODE_TRANSPILE_ONLY: '1' },
  })
}

async function verifyReverseMutations(): Promise<void> {
  const original = readFileSync(HOLD_SOURCE, 'utf8')
  const mutations: Array<[string, string, string]> = [
    ['owner', OWNER_ANCHOR, '$owned = $true'],
    ['pause', PAUSE_ANCHOR, 'await Promise.resolve()'],
    ['unreadable user throws', UNREADABLE_SKIP_ANCHOR, `throw 'print job user sid is unreadable'`],
  ]
  for (const [label, from, to] of mutations) {
    assert.ok(original.includes(from), `${label}: anchor missing`)
    writeFileSync(HOLD_SOURCE, original.replace(from, to))
    try {
      const result = runSelf()
      assert.notEqual(result.status, 0, `${label}: reversed behavior must fail`)
    } finally {
      writeFileSync(HOLD_SOURCE, original)
    }
  }
}

async function main(): Promise<void> {
  if (process.platform !== 'win32') {
    console.log('verify-print-queue-residue-windows: skipped (not win32)')
    return
  }
  let scenarioError: unknown
  try {
    await runScenario()
  } catch (error) {
    scenarioError = error
  } finally {
    try {
      removeFixtures()
    } catch (cleanupError) {
      console.error(scrub(cleanupError instanceof Error ? cleanupError.message : String(cleanupError)))
      if (!scenarioError) scenarioError = cleanupError
    }
  }
  if (scenarioError) {
    console.error(scrub(scenarioError instanceof Error ? scenarioError.stack || scenarioError.message : String(scenarioError)))
    process.exitCode = 1
    return
  }
  console.log('PASS print queue residue windows scenario')
  if (process.env['PRINT_QUEUE_RESIDUE_CHILD'] === '1') return
  await verifyReverseMutations()
  console.log('PASS print queue residue windows mutations')
}

main().catch((error: unknown) => {
  console.error(scrub(error instanceof Error ? error.stack || error.message : String(error)))
  process.exitCode = 1
})
