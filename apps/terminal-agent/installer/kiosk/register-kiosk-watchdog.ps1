# AI Job Print Terminal - register / unregister the kiosk watchdog scheduled task
#
# The MSI deliberately has no CustomAction, so the logon task is created here,
# from the elevated provisioning flow (device binding wizard / control center).
#   Register:   register-kiosk-watchdog.ps1 -Url https://zyidai.cn/
#   Unregister: register-kiosk-watchdog.ps1 -Unregister
#
# Task facts:
#   - name AIJobPrintKioskWatchdog, trigger AtLogOn for BUILTIN\Users
#   - runs as the interactive user (no stored credentials), limited privileges
#   - no execution time limit, restarts itself if it dies, hidden window
#   - carries only the public site URL as an argument (never tokens)
#
# Windows PowerShell 5.1 compatible. Staging re-encodes this file as UTF-8 BOM.

[CmdletBinding()]
param(
  [string]$Url,
  [ValidateSet("auto", "edge", "chrome")][string]$Browser = "auto",
  [switch]$Unregister,
  [switch]$StartNow
)

$ErrorActionPreference = "Stop"
$taskName = "AIJobPrintKioskWatchdog"
$watchdogScript = Join-Path $PSScriptRoot "kiosk-watchdog.ps1"

function Test-IsAdministrator {
  $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($identity)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-IsAdministrator)) {
  throw "Registering the kiosk watchdog requires an elevated session"
}

$existing = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
if ($Unregister) {
  if ($null -ne $existing) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "KIOSK_WATCHDOG_UNREGISTERED"
  } else {
    Write-Host "KIOSK_WATCHDOG_ABSENT"
  }
  exit 0
}

if ([string]::IsNullOrWhiteSpace($Url)) { throw "-Url is required unless -Unregister is used" }
if ($Url -notmatch '^https://[A-Za-z0-9.-]+(:[0-9]+)?(/.*)?$') { throw "Kiosk URL must be an absolute https:// address" }
if ($Url -match '["\r\n\s]') { throw "Kiosk URL contains unsupported characters" }
if (-not (Test-Path -LiteralPath $watchdogScript -PathType Leaf)) { throw "kiosk-watchdog.ps1 is missing next to this script" }

$argumentLine = (@(
  "-NoProfile",
  "-ExecutionPolicy", "Bypass",
  "-WindowStyle", "Hidden",
  "-File", ('"{0}"' -f $watchdogScript),
  "-Url", ('"{0}"' -f $Url),
  "-Browser", $Browser
) -join " ")

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argumentLine
$trigger = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -GroupId "BUILTIN\Users" -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet `
  -ExecutionTimeLimit ([TimeSpan]::Zero) `
  -MultipleInstances IgnoreNew `
  -RestartCount 3 `
  -RestartInterval (New-TimeSpan -Minutes 1) `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -Hidden

if ($null -ne $existing) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}
Register-ScheduledTask `
  -TaskName $taskName `
  -Description "Keeps the AI Job Print kiosk browser running full screen in the interactive session" `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings | Out-Null

Write-Host "KIOSK_WATCHDOG_REGISTERED url=$Url browser=$Browser"

if ($StartNow) {
  try {
    Start-ScheduledTask -TaskName $taskName
    Write-Host "KIOSK_WATCHDOG_STARTED"
  } catch {
    Write-Warning "Task registered but could not be started now: $($_.Exception.Message)"
  }
}
