/**
 * Windows CI：两台本地端口打印机。清空只动配置的那一台，另一账号的作业也删。
 * 非 Windows 直接退出 0。用例结束删掉两台测试打印机。
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { clearAllJobsOnConfiguredPrinter, pauseConfiguredPrinterQueue, pauseSignalFromProbeLine } from '../src/agent/print-queue-hold'
import { queryWin32PrinterLine } from '../src/agent/wmi'

const PRINTER_A = 'AIJobRemoteCmdA'
const PRINTER_B = 'AIJobRemoteCmdB'
const PORT_A = 'C:\\Windows\\Temp\\aijob-remote-a.prn'
const PORT_B = 'C:\\Windows\\Temp\\aijob-remote-b.prn'
const TASK_NAME = 'AIJobRemoteCmdOther'
const USER_NAME = 'aijobrcmd'
const TEST_PASSWORD = 'Aq-Rcmd-1a#Zx9'
if (TEST_PASSWORD.length > 14) throw new Error('fixture password must be at most 14 characters for net user /add')

function scrub(text: string): string {
  return text.split(TEST_PASSWORD).join('***')
}

function runPs(script: string): string {
  const result = spawnSync('powershell', ['-NonInteractive', '-NoProfile', '-Command', script], {
    encoding: 'utf8',
    timeout: 90_000,
    env: { ...process.env, AIJOB_REMOTE_PW: TEST_PASSWORD },
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

function jobCount(printerName: string): number {
  const output = runPs(`
$ErrorActionPreference = 'Stop'
Write-Output (@(Get-PrintJob -PrinterName '${printerName}' -ErrorAction SilentlyContinue).Count)
`).trim()
  const count = Number(output)
  if (!Number.isInteger(count) || count < 0) throw new Error(`job count unreadable: ${output || '(empty)'}`)
  return count
}

function createPrinters(): void {
  runPs(`
$ErrorActionPreference = 'Stop'
$driver = 'Generic / Text Only'
$installed = Get-PrinterDriver -Name $driver -ErrorAction SilentlyContinue
if (-not $installed) {
  try { Add-PrinterDriver -Name $driver }
  catch { throw ('Generic / Text Only driver is not installed and Add-PrinterDriver failed: ' + $_.Exception.Message) }
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
}
`)
}

function otherAccountPrintCommand(): string {
  const encoded = Buffer.from(`'queued' | Out-Printer -Name '${PRINTER_A}'`, 'utf16le').toString('base64')
  return `powershell.exe -NoProfile -NonInteractive -EncodedCommand ${encoded}`
}

function submitOtherAccountJob(): void {
  runPs(`
$ErrorActionPreference = 'Stop'
cmd /c "net user ${USER_NAME} /delete" | Out-Null
cmd /c "net user ${USER_NAME} %AIJOB_REMOTE_PW% /add"
if ($LASTEXITCODE -ne 0) { throw 'local user was not created' }
cmd /c "net localgroup Administrators ${USER_NAME} /add"
if ($LASTEXITCODE -ne 0) { throw 'local user was not added to Administrators' }
cmd /c "schtasks /Delete /TN ${TASK_NAME} /F >nul 2>&1"
schtasks /Create /TN ${TASK_NAME} /TR "${otherAccountPrintCommand()}" /SC ONCE /ST 23:59 /RU "$env:COMPUTERNAME\\${USER_NAME}" /RP $env:AIJOB_REMOTE_PW /F /RL LIMITED
if ($LASTEXITCODE -ne 0) { throw 'scheduled task was not created' }
schtasks /Run /TN ${TASK_NAME}
if ($LASTEXITCODE -ne 0) { throw 'scheduled task did not start' }
`)
}

function submitOwnJob(printerName: string): void {
  runPs(`'queued' | Out-Printer -Name '${printerName}'`)
}

async function waitForCount(printerName: string, minimum: number): Promise<number> {
  const deadline = Date.now() + 60_000
  let latest = 0
  while (Date.now() < deadline) {
    latest = jobCount(printerName)
    if (latest >= minimum) return latest
    await sleep(500)
  }
  throw new Error(`printer job count stayed at ${latest}, wanted at least ${minimum}`)
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
foreach ($port in @('${PORT_A}','${PORT_B}')) {
  $existing = Get-PrinterPort -Name $port -ErrorAction SilentlyContinue
  if ($existing) {
    try { Remove-PrinterPort -Name $port -ErrorAction Stop }
    catch { Write-Warning ('printer port not removed: ' + $_.Exception.Message) }
  }
}
Remove-Item -LiteralPath '${PORT_A}','${PORT_B}' -Force -ErrorAction SilentlyContinue
if ($null -ne $cleanupError) { Write-Error $cleanupError; exit 1 }
exit 0
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
  await waitForCount(PRINTER_A, 1)
  submitOwnJob(PRINTER_A)
  submitOwnJob(PRINTER_B)
  await waitForCount(PRINTER_A, 2)
  const beforeB = await waitForCount(PRINTER_B, 1)
  const cleared = await clearAllJobsOnConfiguredPrinter(PRINTER_A, { holdWhenIdle: true })
  assert.equal(cleared.result, 'done')
  assert.equal(cleared.remainingJobs, 0)
  assert.equal(jobCount(PRINTER_A), 0)
  assert.equal(jobCount(PRINTER_B), beforeB)
  const probe = await queryWin32PrinterLine(PRINTER_A)
  assert.equal(pauseSignalFromProbeLine(probe), true, 'idle hold must leave the configured queue paused')
  assert.equal(jobCount(PRINTER_B) >= 1, true)
}

async function main(): Promise<void> {
  if (process.platform !== 'win32') {
    console.log('verify-remote-commands-windows: skipped (not win32)')
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
    } catch (cleanup) {
      if (!scenarioError) scenarioError = cleanup
    }
  }
  if (scenarioError) throw scenarioError
  console.log('verify-remote-commands-windows: configured printer cleared, other printer kept')
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? scrub(error.message) : scrub(String(error)))
  process.exit(1)
})
