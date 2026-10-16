/**
 * Windows CI：开机打印防护与每日维护重启。
 * 会停止本机 Spooler、清空测试期间 PRINTERS 下的假脱机文件。只在 windows-2022 上跑。
 * 非 Windows 直接退出 0。每个用例结束后把 Spooler 恢复为 Automatic 且 Running，并删掉测试打印机。
 * 用例会在 Program Files 和 ProgramData 下建 AIJobPrintAgent 目录（放脚本、配置、日志）。
 * 开始前没有的，结束时整个删掉；同一个 CI 作业里后面的升级测试要求这两个目录不存在。
 * 开始前就有的（装过 Agent 的机器）不删。
 * 不打印假脱机文件名。
 */
import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PRINTER = 'AIJobBootGuard'
const PORT = 'C:\\Windows\\Temp\\aijob-boot-guard.prn'
const TASK = 'AIJobPrintBootSpoolGuard'
const DAILY_TASK = 'AIJobPrintDailyReboot'
const GUARD = join(__dirname, '../installer/provision/boot-spool-guard.ps1')
const GUARD_TASK = join(__dirname, '../installer/provision/boot-spool-guard-task.ps1')
const DAILY = join(__dirname, '../installer/provision/daily-reboot.ps1')
const LOCK_READY = join(tmpdir(), 'aijob-boot-guard-lock.ready')
const LOCK_DONE = join(tmpdir(), 'aijob-boot-guard-lock.done')

function runPs(script: string, timeout = 120_000): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    'powershell',
    ['-NonInteractive', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script],
    { encoding: 'utf8', timeout },
  )
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: `${result.stderr ?? ''}${result.error ? `\n${result.error.message}` : ''}`,
  }
}

function psOk(label: string, script: string, timeout = 120_000): string {
  const result = runPs(script, timeout)
  if (result.status !== 0) {
    throw new Error(`${label} exited ${result.status ?? 'null'}: ${result.stderr || result.stdout}`)
  }
  return result.stdout
}

function field(text: string, name: string): string {
  const line = text
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${name}=`))
  if (!line) throw new Error(`missing ${name}`)
  return line.slice(name.length + 1).trim()
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function psQuote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function logPath(): string {
  const root = process.env['ProgramData']
  if (!root) throw new Error('ProgramData is not set')
  return join(root, 'AIJobPrintAgent', 'logs', 'boot-spool-guard.log')
}

function logLength(): number {
  const path = logPath()
  if (!existsSync(path)) return 0
  return readFileSync(path).length
}

function addedLog(before: number): string {
  const path = logPath()
  if (!existsSync(path)) return ''
  const bytes = readFileSync(path)
  return bytes.subarray(before).toString('utf8')
}

function assertLog(before: number, pattern: RegExp): void {
  const added = addedLog(before).trim()
  const lines = added.split(/\r?\n/).filter((line) => line.trim().length > 0)
  const last = lines[lines.length - 1] ?? ''
  if (!pattern.test(last)) throw new Error('boot-spool-guard log line did not match the allowed pattern')
}

function ensurePrinter(): void {
  psOk(
    'create-printer',
    `
$ErrorActionPreference = 'Stop'
$driver = 'Generic / Text Only'
$installed = Get-PrinterDriver -Name $driver -ErrorAction SilentlyContinue
if (-not $installed) { Add-PrinterDriver -Name $driver }
if (-not (Get-PrinterPort -Name '${PORT}' -ErrorAction SilentlyContinue)) {
  Add-PrinterPort -Name '${PORT}'
}
if (-not (Get-Printer -Name '${PRINTER}' -ErrorAction SilentlyContinue)) {
  Add-Printer -Name '${PRINTER}' -DriverName $driver -PortName '${PORT}'
}
$created = Get-Printer -Name '${PRINTER}' -ErrorAction Stop
if ([string]$created.Name -ne '${PRINTER}') { throw 'created printer name mismatch' }
Write-Output 'printer=ready'
`,
  )
}

function pauseAndSubmit(): void {
  psOk(
    'submit-job',
    `
$ErrorActionPreference = 'Stop'
$printer = Get-CimInstance -ClassName Win32_Printer -Filter "Name='${PRINTER}'"
if ($null -eq $printer) { throw 'test printer missing' }
Invoke-CimMethod -InputObject $printer -MethodName Pause | Out-Null
'queued' | Out-Printer -Name '${PRINTER}'
$deadline = (Get-Date).AddSeconds(20)
do {
  $count = @(Get-PrintJob -PrinterName '${PRINTER}' -ErrorAction Stop).Count
  if ($count -gt 0) { break }
  Start-Sleep -Milliseconds 300
} while ((Get-Date) -lt $deadline)
if ($count -lt 1) { throw 'test job did not stay queued' }
$fileDeadline = (Get-Date).AddSeconds(20)
do {
  $dir = Join-Path $env:SystemRoot 'System32\\spool\\PRINTERS'
  $files = @(Get-ChildItem -LiteralPath $dir -Force -File | Where-Object {
    $ext = $_.Extension.ToLowerInvariant()
    $ext -eq '.spl' -or $ext -eq '.shd' -or $ext -eq '.tmp'
  }).Count
  if ($files -gt 0) { break }
  Start-Sleep -Milliseconds 300
} while ((Get-Date) -lt $fileDeadline)
if ($files -lt 1) { throw 'spool files did not appear' }
Write-Output ("jobCount=" + $count)
`,
  )
}

function jobCount(): number {
  const output = psOk(
    'job-count',
    `
$ErrorActionPreference = 'Stop'
$count = @(Get-PrintJob -PrinterName '${PRINTER}' -ErrorAction Stop).Count
Write-Output ("jobCount=" + $count)
`,
  )
  return Number(field(output, 'jobCount'))
}

function spoolCount(): number {
  const output = psOk(
    'spool-count',
    `
$ErrorActionPreference = 'Stop'
$dir = Join-Path $env:SystemRoot 'System32\\spool\\PRINTERS'
$count = @(Get-ChildItem -LiteralPath $dir -Force -File | Where-Object {
  $ext = $_.Extension.ToLowerInvariant()
  $ext -eq '.spl' -or $ext -eq '.shd' -or $ext -eq '.tmp'
}).Count
Write-Output ("spoolCount=" + $count)
`,
  )
  return Number(field(output, 'spoolCount'))
}

function runGuard(): { status: number | null; stdout: string } {
  const result = spawnSync(
    'powershell',
    ['-NonInteractive', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', GUARD],
    { encoding: 'utf8', timeout: 120_000 },
  )
  return { status: result.status, stdout: result.stdout ?? '' }
}

function stopSpooler(): void {
  psOk(
    'stop-spooler',
    `
$ErrorActionPreference = 'Stop'
Stop-Service -Name Spooler -Force
$service = Get-Service -Name Spooler
$service.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Stopped, [TimeSpan]::FromSeconds(60))
Write-Output 'spooler=stopped'
`,
  )
}

function restoreSpooler(): void {
  psOk(
    'restore-spooler',
    `
$ErrorActionPreference = 'Stop'
& sc.exe config Spooler start= auto | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'sc.exe config start= auto failed' }
$readback = & sc.exe qc Spooler | Out-String
if ($readback -notmatch 'AUTO_START') { throw 'Spooler start type is not Automatic' }
Set-Service -Name Spooler -StartupType Automatic
$service = Get-Service -Name Spooler
if ($service.Status -ne [System.ServiceProcess.ServiceControllerStatus]::Running) {
  Start-Service -Name Spooler
  $service.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Running, [TimeSpan]::FromSeconds(60))
}
foreach ($name in @('${TASK}', '${DAILY_TASK}')) {
  $task = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  if ($null -ne $task) { Unregister-ScheduledTask -TaskName $name -Confirm:$false }
}
Write-Output 'spooler=running'
`,
    90_000,
  )
}

function removePrinter(): void {
  psOk(
    'remove-printer',
    `
$ErrorActionPreference = 'Stop'
if (Get-Printer -Name '${PRINTER}' -ErrorAction SilentlyContinue) { Remove-Printer -Name '${PRINTER}' }
if (Get-PrinterPort -Name '${PORT}' -ErrorAction SilentlyContinue) { Remove-PrinterPort -Name '${PORT}' }
Write-Output 'printer=removed'
`,
  )
}

function abortShutdown(): void {
  spawnSync('shutdown.exe', ['/a'], { encoding: 'utf8', timeout: 15_000 })
}

function releaseLock(holder: ChildProcess | null): void {
  try {
    writeFileSync(LOCK_DONE, 'done')
  } catch {
    // The holder may already have exited.
  }
  if (holder && holder.exitCode === null) {
    holder.kill()
  }
}

function caseAlreadyRunning(): void {
  pauseAndSubmit()
  const jobsBefore = jobCount()
  const filesBefore = spoolCount()
  assert.ok(jobsBefore > 0, 'queued job missing before the running-path guard')
  assert.ok(filesBefore > 0, 'spool files missing before the running-path guard')
  const before = logLength()
  const result = runGuard()
  assert.equal(result.status, 0, 'running spooler must skip with exit 0')
  assert.equal(jobCount(), jobsBefore, 'running-path guard deleted a queued job')
  assert.equal(spoolCount(), filesBefore, 'running-path guard deleted spool files')
  assertLog(before, /boot-spool-guard: spooler already running, skipped$/)
  console.log('PASS boot-spool-guard already-running')
}

function caseBootPath(): void {
  assert.ok(spoolCount() > 0, 'boot path needs leftover spool files')
  stopSpooler()
  assert.ok(spoolCount() > 0, 'stopping Spooler dropped the spool files before the guard ran')
  const before = logLength()
  const result = runGuard()
  assert.equal(result.status, 0, 'boot path must exit 0')
  assert.equal(spoolCount(), 0, 'boot path left spool files behind')
  const jobs = jobCount()
  assert.equal(jobs, 0, 'boot path left queued jobs')
  assertLog(before, /boot-spool-guard result=removed removed=[1-9][0-9]*$/)
  const state = psOk(
    'spooler-running',
    `
$service = Get-Service -Name Spooler
Write-Output ("status=" + $service.Status)
`,
  )
  assert.equal(field(state, 'status'), 'Running')
  console.log('PASS boot-spool-guard boot-path')
}

function caseDeleteBlocked(): void {
  stopSpooler()
  try {
    writeFileSync(LOCK_DONE, '')
  } catch {
    // replaced below
  }
  const holder = spawn(
    'powershell',
    [
      '-NonInteractive',
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      `
$ErrorActionPreference = 'Stop'
$dir = Join-Path $env:SystemRoot 'System32\\spool\\PRINTERS'
New-Item -ItemType Directory -Path $dir -Force | Out-Null
$path = Join-Path $dir 'AIJB0001.SPL'
if (Test-Path -LiteralPath $env:AIJOB_LOCK_READY) { Remove-Item -LiteralPath $env:AIJOB_LOCK_READY -Force }
if (Test-Path -LiteralPath $env:AIJOB_LOCK_DONE) { Remove-Item -LiteralPath $env:AIJOB_LOCK_DONE -Force }
$stream = New-Object System.IO.FileStream($path, [System.IO.FileMode]::Create, [System.IO.FileAccess]::ReadWrite, [System.IO.FileShare]::None)
try {
  Set-Content -LiteralPath $env:AIJOB_LOCK_READY -Value 'ready' -Encoding ASCII
  $deadline = (Get-Date).AddMinutes(2)
  while (-not (Test-Path -LiteralPath $env:AIJOB_LOCK_DONE) -and (Get-Date) -lt $deadline) {
    Start-Sleep -Milliseconds 200
  }
} finally {
  $stream.Dispose()
}
`,
    ],
    {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, AIJOB_LOCK_READY: LOCK_READY, AIJOB_LOCK_DONE: LOCK_DONE },
    },
  )
  try {
    const readyDeadline = Date.now() + 20_000
    while (!existsSync(LOCK_READY)) {
      if (holder.exitCode !== null) throw new Error(`lock holder exited ${holder.exitCode} before the file was held`)
      if (Date.now() > readyDeadline) throw new Error('lock holder did not become ready')
      sleep(200)
    }
    const before = logLength()
    const result = runGuard()
    assert.notEqual(result.status, 0, 'undeletable spool file must fail the guard')
    const state = psOk(
      'spooler-stays-stopped',
      `
$service = Get-Service -Name Spooler
Write-Output ("status=" + $service.Status)
`,
    )
    assert.equal(field(state, 'status'), 'Stopped')
    assertLog(before, /boot-spool-guard result=delete-failed removed=\d+$/)
    console.log('PASS boot-spool-guard delete-blocked')
  } finally {
    releaseLock(holder)
  }
}

function caseInstallRollback(): void {
  const output = psOk(
    'install-rollback',
    `
$ErrorActionPreference = 'Stop'
$destDir = Join-Path $env:ProgramFiles 'AIJobPrintAgent\\provision'
New-Item -ItemType Directory -Path $destDir -Force | Out-Null
$dest = Join-Path $destDir 'boot-spool-guard.ps1'
$existed = Test-Path -LiteralPath $dest
$backup = $null
if ($existed) { $backup = [System.IO.File]::ReadAllBytes($dest) }
try {
Copy-Item -LiteralPath ${psQuote(GUARD)} -Destination $dest -Force
. ${psQuote(GUARD_TASK)}
Install-BootSpoolGuard -GuardScriptPath $dest
$task = Get-ScheduledTask -TaskName '${TASK}' -ErrorAction Stop
$trigger = @($task.Triggers) | Select-Object -First 1
$triggerName = [string]$trigger.CimClass.CimClassName
$user = [string]$task.Principal.UserId
$qc = & sc.exe qc Spooler | Out-String
$start = if ($qc -match 'DEMAND_START') { 'Manual' } else { 'Other' }
Write-Output ("task=present")
Write-Output ("trigger=" + $triggerName)
Write-Output ("user=" + $user)
Write-Output ("start=" + $start)
Uninstall-BootSpoolGuard
$gone = Get-ScheduledTask -TaskName '${TASK}' -ErrorAction SilentlyContinue
$qc2 = & sc.exe qc Spooler | Out-String
$start2 = if ($qc2 -match 'AUTO_START') { 'Automatic' } else { 'Other' }
if ($null -eq $gone) { Write-Output 'afterTask=absent' } else { Write-Output 'afterTask=present' }
Write-Output ("afterStart=" + $start2)
} finally {
  if ($existed) { [System.IO.File]::WriteAllBytes($dest, $backup) }
  elseif (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Force }
}
`,
  )
  assert.equal(field(output, 'task'), 'present')
  assert.equal(field(output, 'trigger'), 'MSFT_TaskBootTrigger')
  assert.match(field(output, 'user'), /^(SYSTEM|NT AUTHORITY\\SYSTEM|S-1-5-18)$/i)
  assert.equal(field(output, 'start'), 'Manual')
  assert.equal(field(output, 'afterTask'), 'absent')
  assert.equal(field(output, 'afterStart'), 'Automatic')
  console.log('PASS boot-spool-guard install-rollback')
}

function configPath(): string {
  const root = process.env['ProgramData']
  if (!root) throw new Error('ProgramData is not set')
  return join(root, 'AIJobPrintAgent', 'agent-config.json')
}

function caseDailyReboot(): void {
  const path = configPath()
  const hadConfig = existsSync(path)
  const original = hadConfig ? readFileSync(path) : null
  try {
    psOk(
      'config-dir',
      `
New-Item -ItemType Directory -Path (Join-Path $env:ProgramData 'AIJobPrintAgent') -Force | Out-Null
Write-Output 'configDir=ready'
`,
    )
    writeFileSync(path, `{"printerName":"${PRINTER}"}`)
    pauseAndSubmit()
    const postponed = spawnSync(
      'powershell',
      ['-NonInteractive', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', DAILY, '-DryRun'],
      { encoding: 'utf8', timeout: 60_000 },
    )
    assert.equal(postponed.status, 0, postponed.stderr || postponed.stdout || 'dry-run postpone failed')
    const postponeLine = (postponed.stdout ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .pop()
    assert.equal(postponeLine, 'postpone')
    psOk(
      'clear-jobs',
      `
$ErrorActionPreference = 'Stop'
Get-PrintJob -PrinterName '${PRINTER}' -ErrorAction SilentlyContinue | Remove-PrintJob -ErrorAction SilentlyContinue
$left = @(Get-PrintJob -PrinterName '${PRINTER}' -ErrorAction Stop).Count
if ($left -ne 0) { throw 'test jobs were not cleared' }
Write-Output 'jobs=cleared'
`,
    )
    const rebooting = spawnSync(
      'powershell',
      ['-NonInteractive', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', DAILY, '-DryRun'],
      { encoding: 'utf8', timeout: 60_000 },
    )
    assert.equal(rebooting.status, 0, rebooting.stderr || rebooting.stdout || 'dry-run reboot failed')
    const rebootLine = (rebooting.stdout ?? '')
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .pop()
    assert.equal(rebootLine, 'reboot')
    console.log('PASS daily-reboot dry-run')
    try {
      stopSpooler()
      const logFile = join(process.env['ProgramData'] ?? '', 'AIJobPrintAgent', 'logs', 'daily-reboot.log')
      const before = existsSync(logFile) ? readFileSync(logFile).length : 0
      const stopped = spawnSync(
        'powershell',
        ['-NonInteractive', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', DAILY, '-DryRun'],
        { encoding: 'utf8', timeout: 60_000 },
      )
      assert.equal(stopped.status, 0, stopped.stderr || stopped.stdout || 'dry-run with spooler stopped failed')
      const stoppedLine = (stopped.stdout ?? '')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)
        .pop()
      assert.equal(stoppedLine, 'reboot')
      const added = existsSync(logFile) ? readFileSync(logFile).subarray(before).toString('utf8') : ''
      assert.match(added, /dry-run-reboot-spooler-stopped/)
      console.log('PASS daily-reboot spooler-stopped dry-run')
    } finally {
      abortShutdown()
      restoreSpooler()
    }
  } finally {
    abortShutdown()
    if (original) writeFileSync(path, original)
    else if (!hadConfig && existsSync(path)) {
      psOk('remove-test-config', `Remove-Item -LiteralPath ${psQuote(path)} -Force`)
    }
  }
}

function agentRoot(envName: 'ProgramFiles' | 'ProgramData'): string {
  const root = process.env[envName]
  if (!root) throw new Error(`${envName} is not set`)
  return join(root, 'AIJobPrintAgent')
}

type AgentRootsBefore = { installRootExisted: boolean; stateRootExisted: boolean }

function removeCreatedRoot(path: string, existedBefore: boolean): void {
  if (existedBefore || !existsSync(path)) return
  rmSync(path, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 })
  if (existsSync(path)) throw new Error(`test-created directory remained: ${path}`)
}

function cleanup(before: AgentRootsBefore): void {
  const errors: string[] = []
  const run = (label: string, action: () => void): void => {
    try {
      action()
    } catch (error) {
      errors.push(`${label}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  abortShutdown()
  releaseLock(null)
  sleep(500)
  run('remove-lock-file', () => {
    psOk(
      'remove-lock-file',
      `
$ErrorActionPreference = 'Stop'
$dir = Join-Path $env:SystemRoot 'System32\\spool\\PRINTERS'
$path = Join-Path $dir 'AIJB0001.SPL'
$deadline = (Get-Date).AddSeconds(10)
while ((Test-Path -LiteralPath $path) -and (Get-Date) -lt $deadline) {
  try {
    Remove-Item -LiteralPath $path -Force -ErrorAction Stop
    break
  } catch {
    Start-Sleep -Milliseconds 200
  }
}
if (Test-Path -LiteralPath $path) { throw 'lock file remained' }
Write-Output 'lockFile=cleared'
`,
    )
  })
  run('restore-spooler', restoreSpooler)
  run('remove-printer', removePrinter)
  run('remove-created-install-root', () => removeCreatedRoot(agentRoot('ProgramFiles'), before.installRootExisted))
  run('remove-created-state-root', () => removeCreatedRoot(agentRoot('ProgramData'), before.stateRootExisted))
  if (errors.length > 0) throw new Error(errors.join('\n'))
}

function main(): void {
  if (process.platform !== 'win32') {
    console.log('verify-boot-spool-guard-windows: skipped (not win32)')
    return
  }
  const before: AgentRootsBefore = {
    installRootExisted: existsSync(agentRoot('ProgramFiles')),
    stateRootExisted: existsSync(agentRoot('ProgramData')),
  }
  let scenarioError: unknown
  try {
    ensurePrinter()
    restoreSpooler()
    caseAlreadyRunning()
    caseBootPath()
    caseDeleteBlocked()
    restoreSpooler()
    caseInstallRollback()
    caseDailyReboot()
  } catch (error) {
    scenarioError = error
  } finally {
    try {
      cleanup(before)
    } catch (cleanupError) {
      console.error(cleanupError instanceof Error ? cleanupError.message : String(cleanupError))
      if (!scenarioError) scenarioError = cleanupError
    }
  }
  if (scenarioError) {
    console.error(scenarioError instanceof Error ? scenarioError.message : String(scenarioError))
    process.exitCode = 1
    return
  }
  console.log('PASS boot spool guard windows')
}

main()
