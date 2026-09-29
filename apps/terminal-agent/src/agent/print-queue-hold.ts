/**
 * 配置打印机的队列：空闲时暂停，开机清掉本账号在本次进程启动前提交的作业。
 *
 * 主机断电后 Windows 打印服务比 Agent 更早起来，会把 spool 里的作业重新送出。
 * 只在 Agent 起来之后再删，挡不住这一段。空闲时把队列暂停，下次开机先暂停再删。
 * 正在打印的那一小段队列是恢复状态，这个窗口里断电仍可能出纸，发布当天要在真机上看。
 *
 * 账号不写死 SYSTEM。生产服务跑在 SYSTEM 下，测试机可能是别的账号。
 * 比较的是当前进程自己的 Windows 身份。一边带域名、另一边不带时，只按最后一段名字对齐。
 * 两边都带域名但不相同，不对齐。不把生产服务账号写进代码。
 *
 * 领取是串行的：task-runner-control.ts 的 inFlight 同时只跑一轮，
 * runClaimCycle 的 maxTasks 为 1，而且要等 executeTask 结束才领下一单。
 * 恢复队列只包住当前这一单的打印和监控，不会和下一单交错。
 *
 * 日志只记数量和阶段，不记文档名、打印机名、账号。非 Windows 安全空转，不抛错。
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
  user: string
  submittedAtMs: number
}

export interface QueueHoldResult {
  ok: true
  skipped: boolean
}

export interface QueueCleanupResult {
  removed: number
  skipped: boolean
}

const CIM_METHOD_SCRIPT = `
$ErrorActionPreference = 'Stop'
$payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
$name = [string]$payload.printerName
$method = [string]$payload.method
if ([string]::IsNullOrWhiteSpace($name)) { throw 'printer name missing' }
if ($method -ne 'Pause' -and $method -ne 'Resume') { throw 'method rejected' }
$escaped = $name.Replace("'", "''")
$printer = Get-CimInstance -ClassName Win32_Printer -Filter "Name='$escaped'" -ErrorAction Stop
if (-not $printer) { throw 'printer not found' }
$result = Invoke-CimMethod -InputObject $printer -MethodName $method
if ($null -eq $result -or [int]$result.ReturnValue -ne 0) { throw 'cim method failed' }
'ok'
`.trim()

const LIST_JOBS_SCRIPT = `
$ErrorActionPreference = 'Stop'
$payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
$name = [string]$payload.printerName
if ([string]::IsNullOrWhiteSpace($name)) { throw 'printer name missing' }
$identity = [System.Security.Principal.WindowsIdentity]::GetCurrent()
$account = [string]$identity.Name
$currentSid = [string]$identity.User.Value
function Format-JobUser([string]$user) {
  if ([string]::IsNullOrWhiteSpace($user)) { return '' }
  try {
    $sidType = [type][System.Security.Principal.SecurityIdentifier]
    $sid = ([System.Security.Principal.NTAccount]$user).Translate($sidType).Value
    if ($sid -eq $currentSid) { return $account }
  } catch {}
  return $user
}
$raw = @(Get-PrintJob -PrinterName $name -ErrorAction Stop)
$jobs = foreach ($job in $raw) {
  $submitted = [DateTimeOffset]::new([datetime]$job.SubmittedTime).ToUnixTimeMilliseconds()
  [pscustomobject]@{
    id = [int]$job.ID
    user = (Format-JobUser ([string]$job.UserName))
    submittedAtMs = [int64]$submitted
  }
}
@{ account = $account; jobs = @($jobs) } | ConvertTo-Json -Compress -Depth 4
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

export function accountsReferToSamePrincipal(jobUser: string, agentAccount: string): boolean {
  const left = jobUser.trim()
  const right = agentAccount.trim()
  if (!left || !right) return false
  if (left.toLowerCase() === right.toLowerCase()) return true
  const bare = (value: string) => {
    const index = Math.max(value.lastIndexOf('\\'), value.lastIndexOf('/'))
    return index >= 0 ? value.slice(index + 1) : value
  }
  const leftQualified = left.includes('\\') || left.includes('/')
  const rightQualified = right.includes('\\') || right.includes('/')
  if (leftQualified !== rightQualified && bare(left).toLowerCase() === bare(right).toLowerCase()) return true
  return false
}

export function selectStaleOwnPrintJobIds(
  jobs: PrintJobSnapshot[],
  criteria: { account: string; startedAtMs: number },
): number[] {
  const account = criteria.account.trim()
  if (!account || !Number.isFinite(criteria.startedAtMs)) {
    throw new PrintQueueHoldError('stale print job criteria are incomplete')
  }
  const ids: number[] = []
  for (const job of jobs) {
    if (!Number.isInteger(job.id) || job.id <= 0) continue
    if (!Number.isFinite(job.submittedAtMs)) {
      throw new PrintQueueHoldError('print job submit time is unreadable')
    }
    const owns = accountsReferToSamePrincipal(job.user, account)
    const stale = job.submittedAtMs < criteria.startedAtMs
    if (owns && stale) ids.push(job.id)
  }
  return ids
}

function readSubmittedAtMs(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  throw new PrintQueueHoldError('print job submit time is unreadable')
}

export function parsePrintJobListOutput(raw: string): { account: string; jobs: PrintJobSnapshot[] } {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new PrintQueueHoldError('print job list is unreadable')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new PrintQueueHoldError('print job list is unreadable')
  }
  const record = parsed as { account?: unknown; jobs?: unknown }
  const account = typeof record.account === 'string' ? record.account.trim() : ''
  if (!account) throw new PrintQueueHoldError('print job list account is unreadable')
  const jobsRaw = record.jobs == null ? [] : Array.isArray(record.jobs) ? record.jobs : [record.jobs]
  const jobs: PrintJobSnapshot[] = []
  for (const entry of jobsRaw) {
    if (!entry || typeof entry !== 'object') {
      throw new PrintQueueHoldError('print job submit time is unreadable')
    }
    const job = entry as { id?: unknown; user?: unknown; submittedAtMs?: unknown }
    const id = typeof job.id === 'number' ? job.id : Number(job.id)
    const user = typeof job.user === 'string' ? job.user : ''
    const submittedAtMs = readSubmittedAtMs(job.submittedAtMs)
    if (!Number.isInteger(id) || id <= 0) continue
    jobs.push({ id, user, submittedAtMs })
  }
  return { account, jobs }
}

export function agentProcessStartedAtMs(now = Date.now(), uptimeSec = process.uptime()): number {
  return now - Math.round(uptimeSec * 1000)
}

export async function listConfiguredPrintJobs(
  printerName: string,
): Promise<{ account: string; jobs: PrintJobSnapshot[] }> {
  const stdout = await runPowerShellOrThrow(
    LIST_JOBS_SCRIPT,
    JSON.stringify({ printerName: requirePrinterName(printerName) }),
  )
  return parsePrintJobListOutput(stdout)
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
  startedAtMs: number
}): Promise<QueueCleanupResult> {
  if (process.platform !== 'win32') return { removed: 0, skipped: true }
  const listed = await listConfiguredPrintJobs(options.printerName)
  const ids = selectStaleOwnPrintJobIds(listed.jobs, {
    account: listed.account,
    startedAtMs: options.startedAtMs,
  })
  if (ids.length === 0) return { removed: 0, skipped: false }
  await removePrintJobs(options.printerName, ids)
  log(`print-queue-cleanup: removed leftover print jobs (count=${ids.length})`)
  return { removed: ids.length, skipped: false }
}
