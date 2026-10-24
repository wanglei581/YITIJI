# Clears leftover spool files before the Windows print spooler starts.
#
# Windows PowerShell 5.1. ASCII log lines only. Direct children of PRINTERS
# only: no recursion, no following links, and the directory itself stays.
# A delete failure must not start Spooler.
#
# If Spooler is already running this is not a cold boot (or something else
# started the service first). Delete nothing. The Agent still removes its own
# account's leftover jobs after it starts.

[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"

$logDir = Join-Path $env:ProgramData "AIJobPrintAgent\logs"
$logPath = Join-Path $logDir "boot-spool-guard.log"

function Write-BootSpoolGuardLog([string]$Result, [int]$RemovedCount) {
  $allowed = @("skipped", "removed", "delete-failed", "start-failed", "wait-failed")
  if ($allowed -notcontains $Result) { throw "boot-spool-guard log result is not allowed" }
  if ($RemovedCount -lt 0) { throw "boot-spool-guard removed count is not allowed" }
  New-Item -ItemType Directory -Path $logDir -Force | Out-Null
  $stamp = [DateTimeOffset]::Now.ToString("yyyy-MM-ddTHH:mm:ssK")
  if ($Result -eq "skipped") {
    $line = "$stamp boot-spool-guard: spooler already running, skipped"
  } else {
    $line = "$stamp boot-spool-guard result=$Result removed=$RemovedCount"
  }
  [System.IO.File]::AppendAllText($logPath, ($line + "`r`n"), [System.Text.Encoding]::ASCII)
}

function Get-SpoolerService {
  return Get-Service -Name "Spooler" -ErrorAction Stop
}

$spooler = Get-SpoolerService
if ($spooler.Status -eq [System.ServiceProcess.ServiceControllerStatus]::Running) {
  Write-BootSpoolGuardLog -Result "skipped" -RemovedCount 0
  Write-Output "boot-spool-guard: spooler already running, skipped"
  exit 0
}

$printersDir = Join-Path $env:SystemRoot "System32\spool\PRINTERS"
if (-not (Test-Path -LiteralPath $printersDir -PathType Container)) {
  Write-BootSpoolGuardLog -Result "delete-failed" -RemovedCount 0
  exit 1
}

$directoryItem = Get-Item -LiteralPath $printersDir -Force
if (($directoryItem.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
  Write-BootSpoolGuardLog -Result "delete-failed" -RemovedCount 0
  exit 1
}

$allowedExtensions = @(".spl", ".shd", ".tmp")
$removed = 0
$deleteFailed = $false
try {
  $children = @(Get-ChildItem -LiteralPath $printersDir -Force -File)
} catch {
  Write-BootSpoolGuardLog -Result "delete-failed" -RemovedCount 0
  exit 1
}

foreach ($child in $children) {
  $parent = [System.IO.Path]::GetFullPath($child.DirectoryName).TrimEnd('\')
  $root = [System.IO.Path]::GetFullPath($printersDir).TrimEnd('\')
  if (-not $parent.Equals($root, [System.StringComparison]::OrdinalIgnoreCase)) {
    continue
  }
  $extension = $child.Extension.ToLowerInvariant()
  if ($allowedExtensions -notcontains $extension) {
    continue
  }
  if (($child.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0) {
    $deleteFailed = $true
    continue
  }
  try {
    [System.IO.File]::Delete($child.FullName)
    $removed += 1
  } catch {
    $deleteFailed = $true
  }
}

if ($deleteFailed) {
  Write-BootSpoolGuardLog -Result "delete-failed" -RemovedCount $removed
  exit 1
}

try {
  Start-Service -Name "Spooler"
} catch {
  Write-BootSpoolGuardLog -Result "start-failed" -RemovedCount $removed
  exit 1
}

try {
  $spooler.Refresh()
  $spooler.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Running, [TimeSpan]::FromSeconds(60))
} catch {
  Write-BootSpoolGuardLog -Result "wait-failed" -RemovedCount $removed
  exit 1
}

Write-BootSpoolGuardLog -Result "removed" -RemovedCount $removed
exit 0
