/**
 * 配置打印机的队列：空闲时暂停，开机清掉本进程账号留在这台打印机上的作业。
 *
 * 主机断电后 Windows 打印服务比 Agent 更早起来，会把 spool 里的作业重新送出。
 * 只在 Agent 起来之后再删，挡不住这一段。空闲时把队列暂停，下次开机先暂停再删。
 * 正在打印的那一小段队列是恢复状态，这个窗口里断电仍可能出纸。
 *
 * 清理发生在拿到单实例锁之后、领任何任务之前。此刻属于本进程账号的作业
 * 必然来自上一次进程，所以不比较提交时间。时间条件在主板时钟被重置或
 * 时区换算出错时会漏删，而且没有额外保护。
 *
 * 账号比较只在 PowerShell 里按 SID 做：作业用户转成 SID，与
 * WindowsIdentity.GetCurrent().User 比较。Get-PrintJob 可能给出
 * SYSTEM、NT AUTHORITY\SYSTEM 或计算机账号（机器名$），这三种都要能转成 SID。
 * 任何一个作业的用户读不出来或转不成 SID，整次清理失败，不静默跳过。
 * 不把某个服务账号写进删除条件。
 *
 * 打印机名从 stdin 传入。取出 Win32_Printer 后按 Name -eq 比较，
 * 不把名字拼进 WQL 过滤字符串（反斜杠和引号会把过滤条件弄断）。
 *
 * 领取是串行的。恢复队列只包住当前这一单的打印和监控。
 * 同一删除还用在两处：任务失败终态（再暂停之前），以及每次派发前（恢复队列之前）。
 * 这两处都不看空闲暂停开没开。日志只记数量和阶段，不记文档名、打印机名、账号。
 * 非 Windows 安全空转，不抛错。
 */

import { spawn } from 'child_process'
import { log } from '../logger'

export class PrintQueueHoldError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PrintQueueHoldError'
  }
}

export interface PrintJobSnapshot {
  id: number
  /** PowerShell 已把作业用户解析成 SID，并与当前进程 SID 比较过。 */
  ownedByCurrentProcess: boolean
}

export interface QueueHoldResult {
  ok: true
  skipped: boolean
}

export interface QueueCleanupResult {
  removed: number
  skipped: boolean
}

const RESOLVE_PRINT_JOB_USER_SID = `
function Resolve-PrintJobUserSid([string]$user) {
  if ([string]::IsNullOrWhiteSpace($user)) { throw 'print job user is unreadable' }
  $value = $user.Trim()
  $folded = $value.ToLowerInvariant()
  if ($folded -eq 'system' -or $folded -eq 'nt authority\\system' -or $folded -eq 'nt authority/system') {
    return 'S-1-5-18'
  }
  $machine = [Environment]::MachineName
  $bare = $value
  $cut = [Math]::Max($value.LastIndexOf('\\'), $value.LastIndexOf('/'))
  if ($cut -ge 0) { $bare = $value.Substring($cut + 1) }
  $candidates = New-Object System.Collections.Generic.List[string]
  [void]$candidates.Add($value)
  $bareIsThisComputer = $bare.EndsWith('$') -and $bare.Length -gt 1 -and $bare.Substring(0, $bare.Length - 1).Equals($machine, [StringComparison]::OrdinalIgnoreCase)
  if ($bareIsThisComputer) {
    [void]$candidates.Add(('{0}\\{1}' -f $machine, $bare))
    $domain = [Environment]::UserDomainName
    if (-not [string]::IsNullOrWhiteSpace($domain)) {
      [void]$candidates.Add(('{0}\\{1}' -f $domain, $bare))
    }
  }
  foreach ($candidate in $candidates) {
    try {
      $account = New-Object System.Security.Principal.NTAccount($candidate)
      $sid = $account.Translate([System.Security.Principal.SecurityIdentifier])
      if ($null -ne $sid -and -not [string]::IsNullOrWhiteSpace([string]$sid.Value)) {
        return [string]$sid.Value
      }
    } catch {}
  }
  try {
    if (-not ('PrintJobSidLookup' -as [type])) {
      Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Text;
public static class PrintJobSidLookup {
  [DllImport("advapi32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  public static extern bool LookupAccountName(string systemName, string accountName, byte[] sid, ref int sidSize, StringBuilder domainName, ref int domainSize, out int use);
  public static string Lookup(string account) {
    int sidSize = 0;
    int domainSize = 0;
    int use;
    LookupAccountName(null, account, null, ref sidSize, null, ref domainSize, out use);
    byte[] sid = new byte[sidSize];
    StringBuilder domain = new StringBuilder(Math.Max(domainSize, 1));
    if (!LookupAccountName(null, account, sid, ref sidSize, domain, ref domainSize, out use)) {
      throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    }
    return new System.Security.Principal.SecurityIdentifier(sid, 0).Value;
  }
}
'@
    }
    foreach ($candidate in $candidates) {
      try {
        $lookedUp = [PrintJobSidLookup]::Lookup($candidate)
        if (-not [string]::IsNullOrWhiteSpace($lookedUp)) { return $lookedUp }
      } catch {}
    }
  } catch {}
  throw 'print job user sid is unreadable'
}
`.trim()

const CIM_METHOD_SCRIPT = `
$ErrorActionPreference = 'Stop'
$payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
$name = [string]$payload.printerName
$method = [string]$payload.method
if ([string]::IsNullOrWhiteSpace($name)) { throw 'printer name missing' }
if ($method -ne 'Pause' -and $method -ne 'Resume') { throw 'method rejected' }
$printer = @(Get-CimInstance -ClassName Win32_Printer -ErrorAction Stop) |
  Where-Object { $_.Name -eq $name } |
  Select-Object -First 1
if (-not $printer) { throw 'printer not found' }
$result = Invoke-CimMethod -InputObject $printer -MethodName $method
if ($null -eq $result -or [int]$result.ReturnValue -ne 0) { throw 'cim method failed' }
'ok'
`.trim()

const LIST_JOBS_SCRIPT = `
$ErrorActionPreference = 'Stop'
${RESOLVE_PRINT_JOB_USER_SID}
$payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
$name = [string]$payload.printerName
if ([string]::IsNullOrWhiteSpace($name)) { throw 'printer name missing' }
$currentIdentity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
if ($null -eq $currentIdentity -or $null -eq $currentIdentity.User -or [string]::IsNullOrWhiteSpace([string]$currentIdentity.User.Value)) {
  throw 'current process sid is unreadable'
}
$currentSid = $currentIdentity.User
$raw = @(Get-PrintJob -PrinterName $name -ErrorAction Stop)
$jobs = New-Object System.Collections.Generic.List[object]
foreach ($job in $raw) {
  if ($null -eq $job) { continue }
  $resolved = Resolve-PrintJobUserSid ([string]$job.UserName)
  $jobSid = New-Object System.Security.Principal.SecurityIdentifier($resolved)
  $owned = $jobSid.Equals($currentSid)
  [void]$jobs.Add([pscustomobject]@{ id = [int]$job.ID; owned = [bool]$owned })
}
@{ jobs = @($jobs) } | ConvertTo-Json -Compress -Depth 4
`.trim()

const REMOVE_JOBS_SCRIPT = `
$ErrorActionPreference = 'Stop'
$payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
$name = [string]$payload.printerName
if ([string]::IsNullOrWhiteSpace($name)) { throw 'printer name missing' }
foreach ($id in @($payload.ids)) {
  $jobId = 0
  if (-not [int]::TryParse([string]$id, [ref]$jobId) -or $jobId -le 0) { throw 'job id rejected' }
  Remove-PrintJob -PrinterName $name -ID $jobId -ErrorAction Stop
}
'ok'
`.trim()

function requirePrinterName(printerName: string): string {
  const name = printerName.trim()
  if (!name) throw new PrintQueueHoldError('printer name is missing')
  return name
}

function runPowerShellOrThrow(script: string, stdin: string, timeoutMs = 15_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell', ['-NonInteractive', '-NoProfile', '-Command', script], {
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let settled = false
    const finish = (error?: Error, value?: string) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(value ?? '')
    }
    const timer = setTimeout(() => {
      child.kill()
      finish(new PrintQueueHoldError('print queue command timed out'))
    }, timeoutMs)
    child.stdin.end(stdin, 'utf8')
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8')
    })
    child.stderr.on('data', () => {
      // 丢弃。Remove-PrintJob 的错误文本可能带文档名，不能写进日志。
    })
    child.on('error', () => {
      finish(new PrintQueueHoldError('print queue command failed'))
    })
    child.on('close', (code) => {
      if (settled) return
      if (code !== 0) {
        finish(new PrintQueueHoldError('print queue command failed'))
        return
      }
      finish(undefined, stdout.trim())
    })
  })
}

async function invokePrinterCimMethod(printerName: string, method: 'Pause' | 'Resume'): Promise<void> {
  const stdout = await runPowerShellOrThrow(
    CIM_METHOD_SCRIPT,
    JSON.stringify({ printerName: requirePrinterName(printerName), method }),
  )
  if (stdout !== 'ok') throw new PrintQueueHoldError('print queue command failed')
}

export function selectOwnPrintJobIds(jobs: PrintJobSnapshot[]): number[] {
  const ids: number[] = []
  for (const job of jobs) {
    if (typeof job.ownedByCurrentProcess !== 'boolean') {
      throw new PrintQueueHoldError('print job user is unreadable')
    }
    if (!Number.isInteger(job.id) || job.id <= 0) continue
    if (job.ownedByCurrentProcess) ids.push(job.id)
  }
  return ids
}

export function parsePrintJobListOutput(raw: string): { jobs: PrintJobSnapshot[] } {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new PrintQueueHoldError('print job list is unreadable')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new PrintQueueHoldError('print job list is unreadable')
  }
  const record = parsed as { jobs?: unknown }
  const jobsRaw = record.jobs == null ? [] : Array.isArray(record.jobs) ? record.jobs : [record.jobs]
  const jobs: PrintJobSnapshot[] = []
  for (const entry of jobsRaw) {
    if (!entry || typeof entry !== 'object') {
      throw new PrintQueueHoldError('print job user is unreadable')
    }
    const job = entry as { id?: unknown; owned?: unknown }
    const owned = job.owned
    if (typeof owned !== 'boolean') {
      throw new PrintQueueHoldError('print job user is unreadable')
    }
    const id = typeof job.id === 'number' ? job.id : Number(job.id)
    if (!Number.isInteger(id) || id <= 0) continue
    jobs.push({ id, ownedByCurrentProcess: owned })
  }
  return { jobs }
}

export async function listConfiguredPrintJobs(printerName: string): Promise<{ jobs: PrintJobSnapshot[] }> {
  const stdout = await runPowerShellOrThrow(
    LIST_JOBS_SCRIPT,
    JSON.stringify({ printerName: requirePrinterName(printerName) }),
  )
  return parsePrintJobListOutput(stdout)
}

export async function resolvePrintJobUserSid(user: string): Promise<string> {
  const script = `$ErrorActionPreference = 'Stop'\n${RESOLVE_PRINT_JOB_USER_SID}\n$payload = [Console]::In.ReadToEnd() | ConvertFrom-Json\nResolve-PrintJobUserSid ([string]$payload.user)`
  return runPowerShellOrThrow(script, JSON.stringify({ user }))
}

async function removePrintJobs(printerName: string, ids: number[]): Promise<void> {
  const stdout = await runPowerShellOrThrow(
    REMOVE_JOBS_SCRIPT,
    JSON.stringify({ printerName: requirePrinterName(printerName), ids }),
  )
  if (stdout !== 'ok') throw new PrintQueueHoldError('print queue command failed')
}

export async function pauseConfiguredPrinterQueue(printerName: string): Promise<QueueHoldResult> {
  if (process.platform !== 'win32') return { ok: true, skipped: true }
  await invokePrinterCimMethod(printerName, 'Pause')
  return { ok: true, skipped: false }
}

export async function resumeConfiguredPrinterQueue(printerName: string): Promise<QueueHoldResult> {
  if (process.platform !== 'win32') return { ok: true, skipped: true }
  await invokePrinterCimMethod(printerName, 'Resume')
  log('print-queue-hold: queue resumed for dispatch')
  return { ok: true, skipped: false }
}

export async function cleanupStaleOwnPrintJobs(options: {
  printerName: string
}): Promise<QueueCleanupResult> {
  if (process.platform !== 'win32') return { removed: 0, skipped: true }
  const listed = await listConfiguredPrintJobs(options.printerName)
  const ids = selectOwnPrintJobIds(listed.jobs)
  if (ids.length > 0) {
    await removePrintJobs(options.printerName, ids)
    log(`print-queue-cleanup: removed leftover print jobs (count=${ids.length})`)
  }
  log(`print-queue-cleanup: matched by SID (count=${ids.length})`)
  return { removed: ids.length, skipped: false }
}
