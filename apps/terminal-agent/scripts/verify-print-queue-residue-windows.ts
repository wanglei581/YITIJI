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
  printJobUserSidCommand,
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
// 不超过 14 位：更长的密码会让 `net user /add` 先问「是否继续」，CI 无人应答即失败（No valid response was provided）。
const TEST_PASSWORD = 'Aq-Hold-1a#Zx9'
if (TEST_PASSWORD.length > 14) throw new Error('fixture password must be at most 14 characters for net user /add')
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

function failStep(label: string, error: unknown): never {
  const detail = error instanceof Error ? error.stack || error.message : String(error)
  console.error(`step ${label} failed: ${scrub(detail)}`)
  throw error
}

function runLabeled(label: string, run: () => void): void {
  try {
    run()
  } catch (error) {
    failStep(label, error)
  }
}

async function listLabeled(
  label: string,
  printerName: string,
): Promise<{ jobs: PrintJobSnapshot[]; unreadableUserJobs: number }> {
  try {
    return await listConfiguredPrintJobs(printerName)
  } catch (error) {
    console.error(`step ${label} failed`)
    if (error instanceof PrintQueueHoldError) replayFailedQueueStep(error.step ?? 'list', printerName)
    throw error
  }
}

function replaySidStep(label: string, user: string): { status: number | null; stderr: string } {
  const command = printJobUserSidCommand(user)
  const result = spawnSync('powershell', ['-NonInteractive', '-NoProfile', '-Command', command.script], {
    input: command.stdin,
    encoding: 'utf8',
    timeout: 30_000,
  })
  const stderr = scrub([result.stderr, result.error?.message].filter(Boolean).join('\n')) || '(empty)'
  console.error(`sid-step ${label} replay exit=${result.status ?? 'null'} stderr=${stderr}`)
  return { status: result.status, stderr }
}

/** 只认解析函数自己抛出的那句。解析错误、找不到命令、超时都不是干净拒绝。 */
function isCleanUnreadableSid(replay: { status: number | null; stderr: string }): boolean {
  if (replay.status === null || replay.status === 0) return false
  if (/ParserError|CommandNotFoundException/i.test(replay.stderr)) return false
  return replay.stderr.includes('print job user sid is unreadable')
}

async function resolveSid(label: string, user: string): Promise<string> {
  try {
    return (await resolvePrintJobUserSid(user)).trim()
  } catch (error) {
    replaySidStep(label, user)
    throw error
  }
}

async function expectSidRejection(label: string, user: string): Promise<void> {
  let sid: string | undefined
  let rejected: unknown
  try {
    sid = await resolvePrintJobUserSid(user)
  } catch (error) {
    rejected = error
  }
  if (rejected instanceof PrintQueueHoldError) return
  replaySidStep(label, user)
  throw rejected instanceof Error ? rejected : new Error(`${label}: expected rejection, got ${sid ?? 'undefined'}`)
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
  // 别的账号的作业由计划任务提交，新账号首次登录要建用户配置文件，25 秒在 CI 上不够稳。
  const deadline = Date.now() + 60_000
  while (Date.now() < deadline) {
    const listed = await showQueueFailure('list', printerName, () => listConfiguredPrintJobs(printerName))
    const job = listed.jobs.find((entry) => predicate(entry))
    if (job) return job
    await sleep(500)
  }
  throw new Error(`print job did not appear on ${printerName}`)
}

function runPsLabeled(label: string, script: string): string {
  try {
    return runPs(script)
  } catch (error) {
    failStep(label, error)
  }
}

/**
 * 解析失败时（工作组上的「机器名$」通常如此），列出作业必须跳过、不删，
 * 列表命令本身成功。这次跳过不算清理失败。
 */
function assertUnreadableMachineAccountSkipsCleanup(): void {
  const script = LIST_JOBS_SCRIPT
  const resolveAt = script.indexOf('function Resolve-PrintJobUserSid')
  const loopAt = script.indexOf('foreach ($job in $raw)')
  assert.ok(resolveAt >= 0 && loopAt > resolveAt, 'resolver stays inside the list script')
  const resolveFn = script.slice(resolveAt, loopAt)
  assert.ok(resolveFn.includes("EndsWith('$')"), 'computer account is a lookup candidate')
  const lookupAt = resolveFn.indexOf('LookupAccountName')
  const throwAt = resolveFn.lastIndexOf("throw 'print job user sid is unreadable'")
  assert.ok(lookupAt > 0 && throwAt > lookupAt, 'lookup failure throws inside the resolver')
  const callAt = script.indexOf('Resolve-PrintJobUserSid ([string]$job.UserName)', loopAt)
  const catchAt = script.indexOf('} catch {', callAt)
  const idAt = script.indexOf('$idText', catchAt)
  assert.ok(callAt > loopAt && catchAt > callAt && idAt > catchAt)
  const catchBody = script.slice(catchAt, idAt)
  assert.ok(catchBody.includes('$skippedUnreadable += 1'))
  assert.ok(catchBody.includes('$unreadable = $true'))
  assert.equal(/\bthrow\b/.test(catchBody), false, 'unreadable owner must not fail the list command')
  assert.ok(script.indexOf('ConvertTo-Json', idAt) > idAt, 'list command still prints JSON')
  const hold = readFileSync(HOLD_SOURCE, 'utf8')
  const cleanupAt = hold.indexOf('export async function cleanupStaleOwnPrintJobs')
  const cleanup = cleanupAt < 0 ? '' : hold.slice(cleanupAt)
  assert.match(cleanup, /return \{ removed: ids\.length, skipped: false, unreadableUserJobs: listed\.unreadableUserJobs \}/)
  assert.doesNotMatch(cleanup, /if \(listed\.unreadableUserJobs[\s\S]{0,160}throw/)
}

async function resolveMachineAccount(label: string, user: string, inDomain: boolean): Promise<string | null> {
  try {
    return (await resolvePrintJobUserSid(user)).trim()
  } catch (error) {
    const replay = replaySidStep(label, user)
    // 工作组：只接受「账号读不出」这一种拒绝。别的异常继续失败。
    if (!inDomain && isCleanUnreadableSid(replay)) return null
    throw error
  }
}

async function verifySidResolution(): Promise<void> {
  assertUnreadableMachineAccountSkipsCleanup()
  assert.equal(await resolveSid('system', 'SYSTEM'), 'S-1-5-18')
  assert.equal(await resolveSid('nt-authority-system', 'NT AUTHORITY\\SYSTEM'), 'S-1-5-18')
  assert.equal(await resolveSid('system-folded', 'system'), 'S-1-5-18')
  const currentName = runPsLabeled('current-user-name', '[System.Security.Principal.WindowsIdentity]::GetCurrent().Name').trim()
  const currentSid = runPsLabeled('current-user-sid', '[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value').trim()
  assert.equal(await resolveSid('current-user', currentName), currentSid)
  const partOfDomain = runPsLabeled(
    'part-of-domain',
    '(Get-CimInstance Win32_ComputerSystem).PartOfDomain',
  ).trim().toLowerCase()
  const inDomain = partOfDomain === 'true'
  const machine = runPsLabeled('machine-name', '[Environment]::MachineName').trim()
  // 工作组没有域计算机账号。GitHub 的 Windows runner 和 KSK-001 都是工作组，
  // LookupAccountName("机器名$") 通常查不到。查不到时是干净拒绝：解析函数抛出
  // print job user sid is unreadable，进程非 0 退出。生产列表脚本把这次拒绝当成
  // 读不出账号：跳过、不删，列表命令仍然成功，所以不算清理失败。这一项不能删。
  // 域里必须解析出 S-1-5-21-…。脚本错误、超时和别的异常仍然让门禁失败。
  const bare = await resolveMachineAccount('machine-account', `${machine}$`, inDomain)
  const qualified = await resolveMachineAccount('machine-qualified-machine-account', `${machine}\\${machine}$`, inDomain)
  if (inDomain) {
    if (bare === null || qualified === null) throw new Error('domain computer account must resolve')
    assert.match(bare, /^S-1-5-21-/)
    assert.equal(qualified, bare)
  } else {
    if (bare !== null) assert.match(bare, /^S-1-/)
    if (qualified !== null) {
      assert.match(qualified, /^S-1-/)
      if (bare !== null) assert.equal(qualified, bare)
    }
  }
  await expectSidRejection('blank-user', '   ')
  await expectSidRejection('unknown-user', 'NoSuchPrintJobUser-xyz')
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
# 任务可能还不存在。Windows PowerShell 5.1 在 Stop 模式下会把被 2> 重定向的原生 stderr 当成异常，所以交给 cmd 吞掉。
cmd /c "schtasks /Delete /TN ${TASK_NAME} /F >nul 2>&1"
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
cmd /c "schtasks /Delete /TN ${TASK_NAME} /F >nul 2>&1"
cmd /c "net user ${USER_NAME} /delete >nul 2>&1"
$cleanupError = $null
foreach ($name in @('${PRINTER_A}','${PRINTER_B}')) {
  $printer = Get-Printer -Name $name -ErrorAction SilentlyContinue
  if ($printer) {
    Get-PrintJob -PrinterName $name -ErrorAction SilentlyContinue | Remove-PrintJob -ErrorAction SilentlyContinue
    try { Remove-Printer -Name $name -ErrorAction Stop }
    catch { $cleanupError = $_.Exception.Message }
  }
}
$zhName = $env:AIJOB_ZH_PRINTER
if (-not [string]::IsNullOrWhiteSpace($zhName)) {
  $zhPrinter = Get-Printer -Name $zhName -ErrorAction SilentlyContinue
  if ($zhPrinter) {
    Get-PrintJob -PrinterName $zhName -ErrorAction SilentlyContinue | Remove-PrintJob -ErrorAction SilentlyContinue
    try { Remove-Printer -Name $zhName -ErrorAction Stop }
    catch { $cleanupError = $_.Exception.Message }
  }
}
foreach ($port in @('${PORT_A}','${PORT_B}','${PORT_ZH}')) {
  $existing = Get-PrinterPort -Name $port -ErrorAction SilentlyContinue
  if ($existing) {
    # 文件路径端口名带反斜杠，Remove-PrinterPort 在 CI 上报名字非法（含反斜杠）。端口留在一次性 runner 上无害，只警告。
    try { Remove-PrinterPort -Name $port -ErrorAction Stop }
    catch { Write-Warning ('printer port not removed: ' + $_.Exception.Message) }
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
  runLabeled('createPrinters', () => createPrinters())
  await showQueueFailure('pause', PRINTER_A, () => pauseConfiguredPrinterQueue(PRINTER_A))
  await showQueueFailure('pause', PRINTER_B, () => pauseConfiguredPrinterQueue(PRINTER_B))
  runLabeled('submitOtherAccountJob', () => submitOtherAccountJob())
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
  const afterCleanup = await listLabeled('listConfiguredPrintJobs:after-failed-terminal', PRINTER_A)
  assert.equal(afterCleanup.jobs.some((job) => job.id === jobA.id), false, 'failed-terminal: own-account job must be removed')
  assert.equal(afterCleanup.jobs.some((job) => job.id === other.id), true, 'failed-terminal: other-account job must stay')
  const onOtherPrinter = await listLabeled('listConfiguredPrintJobs:other-printer', PRINTER_B)
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
  const kept = await listLabeled('listConfiguredPrintJobs:after-pre-dispatch', PRINTER_A)
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
  const afterUnreadable = await listLabeled('listConfiguredPrintJobs:after-unreadable', PRINTER_A)
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
