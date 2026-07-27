[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$MsiPath)

$ErrorActionPreference = "Stop"
$resolvedMsi = (Resolve-Path -LiteralPath $MsiPath).Path
$installRoot = Join-Path $env:ProgramFiles "AIJobPrintAgent"
$stateRoot = Join-Path $env:ProgramData "AIJobPrintAgent"
$serviceName = "aijobprintagent.exe"
$logRoot = Join-Path (Split-Path -Parent $resolvedMsi) "lifecycle-logs"
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null

if (Test-Path -LiteralPath $installRoot) {
  throw "Lifecycle test requires an unused runner: $installRoot already exists"
}

function Invoke-Msi([string[]]$Arguments, [string]$LogName) {
  $logPath = Join-Path $logRoot $LogName
  $process = Start-Process -FilePath "msiexec.exe" -ArgumentList (@($Arguments) + @("/qn", "/norestart", "/l*v", $logPath)) -Wait -PassThru -WindowStyle Hidden
  if ($process.ExitCode -ne 0) {
    throw "msiexec failed with exit code $($process.ExitCode); see $logPath"
  }
}

Invoke-Msi -Arguments @("/i", $resolvedMsi) -LogName "install.log"
$service = Get-CimInstance Win32_Service -Filter "Name='$serviceName'"
if ($null -eq $service -or $service.State -ne "Stopped" -or $service.StartMode -ne "Manual") {
  throw "Fresh install must register a stopped Manual service until provisioning succeeds"
}
if (-not (Test-Path -LiteralPath (Join-Path $installRoot "node\node.exe"))) {
  throw "Bundled Node runtime is missing after install"
}
if (-not (Test-Path -LiteralPath $stateRoot -PathType Container)) {
  throw "ProgramData state directory is missing after install"
}

# Prove that SCM/WinSW can launch the bundled Node runtime as LocalSystem. An
# unprovisioned host must fail before any network or print activity and leave a
# stable diagnostic instead of claiming work.
$diagnosticPath = Join-Path $stateRoot "last-startup-diagnostic.json"
if (Test-Path -LiteralPath $diagnosticPath -PathType Leaf) {
  Remove-Item -LiteralPath $diagnosticPath -Force
}
$startServiceError = $null
try {
  Start-Service -Name $serviceName
} catch {
  # An unprovisioned Agent writes its diagnostic and exits before SCM can
  # observe Running. The diagnostic and final Stopped state prove this launch.
  $startServiceError = $_.Exception.Message
}
$deadline = [DateTime]::UtcNow.AddSeconds(20)
while (-not (Test-Path -LiteralPath $diagnosticPath -PathType Leaf) -and [DateTime]::UtcNow -lt $deadline) {
  Start-Sleep -Milliseconds 500
}
if (-not (Test-Path -LiteralPath $diagnosticPath -PathType Leaf)) {
  throw "LocalSystem service launch did not produce a startup diagnostic. Start-Service result: $startServiceError"
}
$diagnostic = Get-Content -Raw -Encoding UTF8 -LiteralPath $diagnosticPath | ConvertFrom-Json
if ([string]$diagnostic.code -ne "AGENT_CONFIG_NOT_FOUND") {
  throw "Unprovisioned service did not fail closed with AGENT_CONFIG_NOT_FOUND"
}
$stopDeadline = [DateTime]::UtcNow.AddSeconds(10)
do {
  $service = Get-CimInstance Win32_Service -Filter "Name='$serviceName'"
  if ($null -ne $service -and $service.State -eq "Stopped") { break }
  Start-Sleep -Milliseconds 250
} while ([DateTime]::UtcNow -lt $stopDeadline)
if ($null -eq $service -or $service.State -ne "Stopped") {
  throw "Unprovisioned service did not return to Stopped after writing its diagnostic"
}

Invoke-Msi -Arguments @("/fa", $resolvedMsi) -LogName "repair.log"
$service = Get-CimInstance Win32_Service -Filter "Name='$serviceName'"
if ($null -eq $service -or $service.State -ne "Stopped") {
  throw "Repair must preserve the unprovisioned stopped service"
}

Invoke-Msi -Arguments @("/x", $resolvedMsi) -LogName "uninstall.log"
if ($null -ne (Get-CimInstance Win32_Service -Filter "Name='$serviceName'" -ErrorAction SilentlyContinue)) {
  throw "Service still exists after uninstall"
}
if (Test-Path -LiteralPath $installRoot) {
  throw "Program Files payload still exists after uninstall"
}
if (-not (Test-Path -LiteralPath $stateRoot -PathType Container)) {
  throw "ProgramData state directory must be retained after uninstall"
}

Write-Host "MSI_LIFECYCLE_PASS service=$serviceName stateRetained=true"
