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
  accountsReferToSamePrincipal,
  cleanupStaleOwnPrintJobs,
  listConfiguredPrintJobs,
  pauseConfiguredPrinterQueue,
  resumeConfiguredPrinterQueue,
  type PrintJobSnapshot,
} from '../src/agent/print-queue-hold'
import { mapWin32PrinterPreflight, mapWin32PrinterQuery, queryWin32PrinterLine } from '../src/agent/wmi'

const PRINTER_A = 'AIJobResidueA'
const PRINTER_B = 'AIJobResidueB'
const PORT_A = 'C:\\Windows\\Temp\\aijob-residue-a.prn'
const PORT_B = 'C:\\Windows\\Temp\\aijob-residue-b.prn'
const TASK_NAME = 'AIJobResidueOther'
const USER_NAME = 'aijobqhold'
const TEST_PASSWORD = 'Aijob-Queue-Hold-1a'
const HOLD_SOURCE = join(__dirname, '../src/agent/print-queue-hold.ts')
const TIME_ANCHOR = 'job.submittedAtMs < criteria.startedAtMs'
const ACCOUNT_ANCHOR = 'accountsReferToSamePrincipal(job.user, account)'
const PAUSE_ANCHOR = "await invokePrinterCimMethod(printerName, 'Pause')"

function scrub(text: string): string {
  return text.split(TEST_PASSWORD).join('***')
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

function pauseSignal(line: string | null): boolean {
  if (!line) return false
  const parts = line.split(',')
  const state = parts[3] ? parseInt(parts[3], 10) : Number.NaN
  const extended = parts[4] ? parseInt(parts[4], 10) : Number.NaN
  return extended === 8 || (Number.isFinite(state) && (state & 1) !== 0)
}

async function waitForJob(
  printerName: string,
  predicate: (job: PrintJobSnapshot, account: string) => boolean,
): Promise<{ account: string; job: PrintJobSnapshot }> {
  const deadline = Date.now() + 25_000
  while (Date.now() < deadline) {
    const listed = await listConfiguredPrintJobs(printerName)
    const job = listed.jobs.find((entry) => predicate(entry, listed.account))
    if (job) return { account: listed.account, job }
    await sleep(500)
  }
  throw new Error(`print job did not appear on ${printerName}`)
}

function createPrinters(): void {
  runPs(`
$ErrorActionPreference = 'Stop'
foreach ($pair in @(
  @{ Name = '${PRINTER_A}'; Port = '${PORT_A}' },
  @{ Name = '${PRINTER_B}'; Port = '${PORT_B}' }
)) {
  if (-not (Get-PrinterPort -Name $pair.Port -ErrorAction SilentlyContinue)) {
    Add-PrinterPort -Name $pair.Port
  }
  if (-not (Get-Printer -Name $pair.Name -ErrorAction SilentlyContinue)) {
    Add-Printer -Name $pair.Name -DriverName 'Generic / Text Only' -PortName $pair.Port
  }
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
cmd /c "net user ${USER_NAME} /delete" | Out-Null
foreach ($name in @('${PRINTER_A}','${PRINTER_B}')) {
  if (Get-Printer -Name $name -ErrorAction SilentlyContinue) { Remove-Printer -Name $name }
}
foreach ($port in @('${PORT_A}','${PORT_B}')) {
  if (Get-PrinterPort -Name $port -ErrorAction SilentlyContinue) { Remove-PrinterPort -Name $port }
}
Remove-Item -LiteralPath '${PORT_A}','${PORT_B}','${join(tmpdir(), 'aijob-residue-other.ps1')}' -Force -ErrorAction SilentlyContinue
`,
    ],
    { encoding: 'utf8', timeout: 90_000 },
  )
  if (result.status !== 0) {
    throw new Error(scrub(`fixture cleanup failed: ${result.stderr || result.stdout}`))
  }
}

async function runScenario(): Promise<void> {
  createPrinters()
  await pauseConfiguredPrinterQueue(PRINTER_A)
  await pauseConfiguredPrinterQueue(PRINTER_B)
  submitOtherAccountJob()
  const other = await waitForJob(PRINTER_A, (job, account) => !accountsReferToSamePrincipal(job.user, account))
  submitOwnJob(PRINTER_A)
  submitOwnJob(PRINTER_B)
  const jobA = await waitForJob(
    PRINTER_A,
    (job, account) => accountsReferToSamePrincipal(job.user, account) && job.id !== other.job.id,
  )
  const jobC = await waitForJob(PRINTER_B, (job, account) => accountsReferToSamePrincipal(job.user, account))
  await sleep(2000)
  const startedAtMs = Date.now()
  await cleanupStaleOwnPrintJobs({ printerName: PRINTER_A, startedAtMs })
  const afterCleanup = await listConfiguredPrintJobs(PRINTER_A)
  assert.equal(afterCleanup.jobs.some((job) => job.id === jobA.job.id), false, 'job A must be removed')
  assert.equal(afterCleanup.jobs.some((job) => job.id === other.job.id), true, 'other-account job must stay')
  const onOtherPrinter = await listConfiguredPrintJobs(PRINTER_B)
  assert.equal(onOtherPrinter.jobs.some((job) => job.id === jobC.job.id), true, 'job C on the other printer must stay')

  submitOwnJob(PRINTER_A)
  const jobB = await waitForJob(
    PRINTER_A,
    (job, account) =>
      accountsReferToSamePrincipal(job.user, account) && job.id !== jobA.job.id && job.id !== other.job.id,
  )
  await cleanupStaleOwnPrintJobs({ printerName: PRINTER_A, startedAtMs })
  const kept = await listConfiguredPrintJobs(PRINTER_A)
  assert.equal(kept.jobs.some((job) => job.id === jobB.job.id), true, 'job submitted after start must stay')
  assert.equal(kept.jobs.some((job) => job.id === other.job.id), true, 'other-account job must still stay')

  await resumeConfiguredPrinterQueue(PRINTER_A)
  const resumed = await queryWin32PrinterLine(PRINTER_A)
  console.log(`resumed-probe ${resumed ?? 'null'}`)
  assert.equal(pauseSignal(resumed), false, 'resume must clear the pause signal')
  await pauseConfiguredPrinterQueue(PRINTER_A)
  const paused = await queryWin32PrinterLine(PRINTER_A)
  console.log(`paused-probe ${paused ?? 'null'}`)
  assert.equal(pauseSignal(paused), true, 'idle hold must leave the queue paused')
  assert.equal(mapWin32PrinterQuery(paused), 'ready', 'paused queue must still report ready')
  assert.equal(mapWin32PrinterPreflight(paused), 'ok', 'paused queue must still pass preflight')
}

function runSelf(): ReturnType<typeof spawnSync> {
  return spawnSync(process.execPath, ['-r', 'ts-node/register/transpile-only', __filename], {
    cwd: join(__dirname, '..'),
    encoding: 'utf8',
    timeout: 180_000,
    env: { ...process.env, PRINT_QUEUE_RESIDUE_CHILD: '1', TS_NODE_TRANSPILE_ONLY: '1' },
  })
}

async function verifyReverseMutations(): Promise<void> {
  const original = readFileSync(HOLD_SOURCE, 'utf8')
  const mutations: Array<[string, string, string]> = [
    ['time', TIME_ANCHOR, 'true'],
    ['account', ACCOUNT_ANCHOR, 'true'],
    ['pause', PAUSE_ANCHOR, 'await Promise.resolve()'],
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
