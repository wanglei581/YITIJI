# AI Job Print Terminal - Kiosk browser launcher and watchdog
#
# Runs in the interactive (auto-login) user session, started by the
# "AIJobPrintKioskWatchdog" scheduled task at logon. It keeps exactly one
# full-screen kiosk browser pointed at the terminal site:
#   - starts Edge (preferred) or Chrome in --kiosk mode with a dedicated profile
#   - restarts it when the process exits or crashes, with backoff
#   - gets only a one-minute boot ticket from the loopback Agent; it never reads Agent credentials
#
# Usage:
#   kiosk-watchdog.ps1 -Url https://zyidai.cn/            # loop forever (task)
#   kiosk-watchdog.ps1 -Url https://zyidai.cn/ -Once      # start once and exit
#
# Windows PowerShell 5.1 compatible. Staging re-encodes this file as UTF-8 BOM.

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Url,
  [ValidateSet("auto", "edge", "chrome")][string]$Browser = "auto",
  [switch]$Once,
  [int]$PollSeconds = 5
)

$ErrorActionPreference = "Stop"
$kioskMarker = "--aijobprint-kiosk=1"

if ($Url -notmatch '^https://[A-Za-z0-9.-]+(:[0-9]+)?(/.*)?$') {
  throw "Kiosk URL must be an absolute https:// address"
}
if ($PollSeconds -lt 2) { $PollSeconds = 2 }

$stateRoot = Join-Path $env:LOCALAPPDATA "AIJobPrintKiosk"
$profileRoot = Join-Path $stateRoot "profile"
$logPath = Join-Path $stateRoot "watchdog.log"
New-Item -ItemType Directory -Path $profileRoot -Force | Out-Null

function Write-Log([string]$Message) {
  try {
    if ((Test-Path -LiteralPath $logPath -PathType Leaf) -and ((Get-Item -LiteralPath $logPath).Length -gt 1MB)) {
      Move-Item -LiteralPath $logPath -Destination ($logPath + ".1") -Force
    }
    $line = "{0:yyyy-MM-dd HH:mm:ss} {1}" -f (Get-Date), $Message
    [System.IO.File]::AppendAllText($logPath, $line + "`r`n", [System.Text.UTF8Encoding]::new($false))
  } catch {}
}

function Resolve-KioskBrowser([string]$Preference) {
  $candidates = @()
  $edge = @(
    (Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe"),
    (Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe")
  )
  $chrome = @(
    (Join-Path $env:ProgramFiles "Google\Chrome\Application\chrome.exe"),
    (Join-Path ${env:ProgramFiles(x86)} "Google\Chrome\Application\chrome.exe")
  )
  switch ($Preference) {
    "edge" { $candidates = $edge }
    "chrome" { $candidates = $chrome }
    default { $candidates = $edge + $chrome }
  }
  foreach ($candidate in $candidates) {
    if (-not [string]::IsNullOrWhiteSpace($candidate) -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
      return $candidate
    }
  }
  return $null
}

function Get-KioskProcess {
  # Only processes started by this watchdog carry the marker switch, so an
  # operator's normal Edge window is never mistaken for the kiosk instance.
  $processes = @(Get-CimInstance Win32_Process -Filter "Name = 'msedge.exe' OR Name = 'chrome.exe'" -ErrorAction SilentlyContinue)
  foreach ($process in $processes) {
    $commandLine = [string]$process.CommandLine
    if ($commandLine -like "*$kioskMarker*" -and $commandLine -notlike "*--type=*") {
      return $process
    }
  }
  return $null
}

function Request-BootTicket([bool]$LogFailure = $true, [int]$Attempt = 1) {
  try {
    $response = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:9527/local/terminal-boot-ticket" -TimeoutSec 4
    $ticket = [string]$response.data.bootTicket
    if ($ticket -match '^[A-Za-z0-9_-]{32,128}$') {
      return $ticket
    }
    if ($LogFailure) { Write-Log "boot ticket response was invalid" }
  } catch {
    if ($LogFailure) { Write-Log "boot ticket attempt $Attempt failed: $($_.Exception.Message)" }
  }
  return $null
}

function Get-BootTicket {
  $deadline = (Get-Date).AddSeconds(60)
  $delays = @(2, 5, 10, 20)
  $attempt = 0
  while ((Get-Date) -lt $deadline) {
    # Five 4-second attempts plus 2/5/10/20-second backoff stay within 57 seconds.
    $ticket = Request-BootTicket -Attempt ($attempt + 1)
    if (-not [string]::IsNullOrWhiteSpace($ticket)) { return $ticket }
    if ($attempt -ge ($delays.Count - 1)) { break }
    $delay = $delays[$attempt]
    if ((Get-Date).AddSeconds($delay) -gt $deadline) { break }
    Start-Sleep -Seconds $delay
    $attempt += 1
  }
  Write-Log "boot ticket unavailable after automatic retry window; launching without ticket"
  return $null
}

function Get-BootTicketUrl([AllowNull()][string]$BootTicket) {
  if ([string]::IsNullOrWhiteSpace($BootTicket)) { return $Url }
  $separator = if ($Url.Contains('?')) { '&' } else { '?' }
  return "$Url$separator" + "boot_ticket=$([uri]::EscapeDataString($BootTicket))"
}

function Test-AgentIdentityReady {
  # This Origin-free endpoint is the readiness probe. Return its one-time ticket so
  # the replacement browser consumes the same ticket without a second round trip.
  return Request-BootTicket -LogFailure $false
}

function Start-KioskBrowser([string]$Executable, [string]$LaunchUrl) {
  $arguments = @(
    "--kiosk", $LaunchUrl,
    "--edge-kiosk-type=fullscreen",
    "--kiosk-idle-timeout-minutes=0",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-session-crashed-bubble",
    "--disable-infobars",
    "--disable-features=TranslateUI,msHubApps,msEdgeSidebar",
    "--overscroll-history-navigation=0",
    "--disable-pinch",
    "--touch-events=enabled",
    "--autoplay-policy=no-user-gesture-required",
    "--password-store=basic",
    "--user-data-dir=$profileRoot",
    $kioskMarker
  )
  $process = Start-Process -FilePath $Executable -ArgumentList $arguments -PassThru
  Write-Log "started kiosk browser pid=$($process.Id) exe=$Executable bootTicket=$($LaunchUrl -ne $Url)"
  return $process
}

$executable = Resolve-KioskBrowser -Preference $Browser
if ($null -eq $executable) {
  Write-Log "no supported browser found (Edge or Chrome); watchdog cannot start"
  throw "No supported kiosk browser installed"
}

Write-Log "watchdog start browser=$executable once=$($Once.IsPresent)"

$backoffSeconds = 3
$lastStart = [DateTime]::MinValue
$launchedWithoutTicket = $false
$lastTicketProbe = [DateTime]::MinValue
$selfHealBootTicket = $null
while ($true) {
  $existing = Get-KioskProcess
  if ($null -ne $existing -and $launchedWithoutTicket -and ((Get-Date) - $lastTicketProbe).TotalSeconds -ge 30) {
    # Self-heal without on-site staff: a browser launched without a boot ticket is stuck
    # on the fail-closed screen. Once the Agent is reachable again, restart it with a ticket.
    $lastTicketProbe = Get-Date
    $selfHealBootTicket = Test-AgentIdentityReady
    if (-not [string]::IsNullOrWhiteSpace($selfHealBootTicket)) {
      Write-Log "local Agent is reachable again; restarting ticketless kiosk browser with a boot ticket"
      try { Stop-Process -Id $existing.ProcessId -Force -ErrorAction Stop } catch { Write-Log "failed to stop ticketless browser: $($_.Exception.Message)" }
      $existing = $null
    }
  }
  if ($null -eq $existing) {
    if ([string]::IsNullOrWhiteSpace($selfHealBootTicket)) {
      $sinceLast = (Get-Date) - $lastStart
      if ($sinceLast.TotalSeconds -lt $backoffSeconds) {
        Start-Sleep -Seconds ([Math]::Ceiling($backoffSeconds - $sinceLast.TotalSeconds))
      }
    }
    try {
      $bootTicket = $selfHealBootTicket
      $selfHealBootTicket = $null
      if ([string]::IsNullOrWhiteSpace($bootTicket)) { $bootTicket = Get-BootTicket }
      $launchUrl = Get-BootTicketUrl -BootTicket $bootTicket
      [void](Start-KioskBrowser -Executable $executable -LaunchUrl $launchUrl)
      $launchedWithoutTicket = ($launchUrl -eq $Url)
      $lastTicketProbe = Get-Date
      if ($lastStart -ne [DateTime]::MinValue -and ((Get-Date) - $lastStart).TotalSeconds -lt 60) {
        # Crash loop: double the wait, cap at one minute.
        $backoffSeconds = [Math]::Min(60, $backoffSeconds * 2)
      } else {
        $backoffSeconds = 3
      }
      $lastStart = Get-Date
    } catch {
      Write-Log "start failed: $($_.Exception.Message)"
      $backoffSeconds = [Math]::Min(60, $backoffSeconds * 2)
      $lastStart = Get-Date
    }
  }
  if ($Once) { break }
  Start-Sleep -Seconds $PollSeconds
}

Write-Log "watchdog exit once=$($Once.IsPresent)"
