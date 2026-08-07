[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$ExePath)

$ErrorActionPreference = "Stop"
$resolvedExe = (Resolve-Path -LiteralPath $ExePath).Path
$installRoot = Join-Path $env:ProgramFiles "AIJobPrintAgent"
$stateRoot = Join-Path $env:ProgramData "AIJobPrintAgent"
$nodePath = Join-Path $installRoot "node\node.exe"
$provisionerRoot = Join-Path $installRoot "provisioner"
$provisionerGuiPath = Join-Path $provisionerRoot "provision-agent-gui.ps1"
$startMenuFolder = Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs\AI求职打印终端"
$shortcutPath = Join-Path $startMenuFolder "AI求职打印终端配置.lnk"
$powerShellPath = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
$serviceName = "aijobprintagent.exe"
$logRoot = Join-Path (Split-Path -Parent $resolvedExe) "lifecycle-logs"
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null

function Invoke-Bundle([string]$Action, [string]$LogName) {
  $logPath = Join-Path $logRoot $LogName
  $arguments = @($Action, "/quiet", "/norestart", "/log", ('"' + $logPath + '"'))
  $process = Start-Process -FilePath $resolvedExe -ArgumentList $arguments -Wait -PassThru
  if ($process.ExitCode -notin @(0, 3010)) {
    throw "Burn bundle $Action failed with exit code $($process.ExitCode); see $logPath"
  }
}

function Assert-StoppedManualService {
  $service = Get-CimInstance Win32_Service -Filter "Name='$serviceName'"
  if ($null -eq $service -or $service.State -ne "Stopped" -or $service.StartMode -ne "Manual") {
    throw "Bundle must preserve the unprovisioned Stopped/Manual service contract"
  }
}

function Assert-ProvisionerInstalled {
  foreach ($name in @(
    "provision-agent-gui.ps1",
    "install-production-agent.ps1",
    "service-identity.ps1",
    "diagnose-production-agent.ps1"
  )) {
    $path = Join-Path $provisionerRoot $name
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
      throw "Provisioner payload is missing: $path"
    }
  }
  if (-not (Test-Path -LiteralPath $shortcutPath -PathType Leaf)) {
    throw "Provisioner Start menu shortcut is missing: $shortcutPath"
  }
  if ((Get-Item -LiteralPath $shortcutPath).Length -le 76) {
    throw "Provisioner Start menu shortcut is unexpectedly small: $shortcutPath"
  }

  $shell = New-Object -ComObject WScript.Shell
  try {
    $shortcut = $shell.CreateShortcut($shortcutPath)
    $shortcutTarget = ([string]$shortcut.TargetPath).Trim()
    if (-not [string]::IsNullOrWhiteSpace($shortcutTarget) -and $shortcutTarget -ine $powerShellPath) {
      throw "Provisioner shortcut target is unexpected: '$shortcutTarget'"
    }
    $shortcutArguments = ([string]$shortcut.Arguments).Trim()
    if (-not [string]::IsNullOrWhiteSpace($shortcutArguments) -and
        ($shortcutArguments -notlike "*-NoProfile*" -or
         $shortcutArguments -notlike "*-ExecutionPolicy Bypass*" -or
         $shortcutArguments -notlike "*-STA*" -or
         $shortcutArguments -notlike "*-WindowStyle Hidden*" -or
         $shortcutArguments -notlike "*$provisionerGuiPath*")) {
      throw "Provisioner shortcut arguments are incomplete: $($shortcut.Arguments)"
    }
    if ($shortcutArguments -match "(?i)(BindCode|AgentToken|BridgeToken|adminSecret)") {
      throw "Provisioner shortcut must not contain credential-bearing arguments"
    }
    $shortcutWorkingDirectory = ([string]$shortcut.WorkingDirectory).Trim().TrimEnd("\")
    if (-not [string]::IsNullOrWhiteSpace($shortcutWorkingDirectory) -and $shortcutWorkingDirectory -ine $installRoot.TrimEnd("\")) {
      throw "Provisioner shortcut working directory is unexpected: '$shortcutWorkingDirectory'"
    }
  } finally {
    if ($null -ne $shortcut) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shortcut) }
    [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($shell)
  }
}

function Invoke-ProvisionerSelfTest {
  $output = @(& $powerShellPath -NoProfile -ExecutionPolicy Bypass -STA -File $provisionerGuiPath -SelfTest 2>&1)
  if ($LASTEXITCODE -ne 0) {
    throw "Provisioner self-test failed with exit code ${LASTEXITCODE}: $($output -join ' ')"
  }
  if (($output -join "`n") -notmatch "PROVISIONER_SELF_TEST_PASS") {
    throw "Provisioner self-test did not emit its success marker: $($output -join ' ')"
  }
  if (($output -join "`n") -notmatch "uiTextBase64=QUnmsYLogYzmiZPljbDnu4jnq6/phY3nva4=") {
    throw "Provisioner self-test did not preserve the expected Chinese UI text under Windows PowerShell 5.1"
  }
}

function Invoke-InstalledRuntimeAclProbe {
  $output = @(& $powerShellPath -NoProfile -ExecutionPolicy Bypass -File `
    (Join-Path $provisionerRoot "install-production-agent.ps1") `
    -ApiBaseUrl "https://probe.invalid/api/v1" -PrinterName "Probe" -SelfTestRuntimeAcl 2>&1)
  if ($LASTEXITCODE -ne 0) {
    throw "Installed runtime ACL probe failed with exit code ${LASTEXITCODE}: $($output -join ' ')"
  }
  $output | ForEach-Object { Write-Host $_ }
  if (($output -join "`n") -notmatch "INSTALLED_RUNTIME_ACL_PASS") {
    throw "Installed runtime ACL probe did not emit its success marker: $($output -join ' ')"
  }
}

$installAttempted = $false
$uninstallCompleted = $false
try {
  if (Test-Path -LiteralPath $installRoot) {
    throw "EXE lifecycle test requires an unused runner: $installRoot already exists"
  }
  if (Test-Path -LiteralPath $stateRoot) {
    throw "EXE lifecycle test must run before another installer creates: $stateRoot"
  }

  $installAttempted = $true
  Invoke-Bundle -Action "/install" -LogName "install.log"
  Assert-StoppedManualService
  if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) {
    throw "Bundled Node runtime is missing after EXE install"
  }
  if (-not (Test-Path -LiteralPath $stateRoot -PathType Container)) {
    throw "ProgramData state directory is missing after EXE install"
  }
  Assert-ProvisionerInstalled
  Invoke-ProvisionerSelfTest
  Invoke-InstalledRuntimeAclProbe

  Remove-Item -LiteralPath $nodePath -Force
  Remove-Item -LiteralPath $provisionerGuiPath -Force
  Remove-Item -LiteralPath $shortcutPath -Force
  if (Test-Path -LiteralPath $nodePath) {
    throw "Failed to remove the repair probe payload"
  }
  Invoke-Bundle -Action "/repair" -LogName "repair.log"
  Assert-StoppedManualService
  if (-not (Test-Path -LiteralPath $nodePath -PathType Leaf)) {
    throw "EXE repair did not restore the managed Node runtime"
  }
  Assert-ProvisionerInstalled
  Invoke-ProvisionerSelfTest
  Invoke-InstalledRuntimeAclProbe

  Invoke-Bundle -Action "/uninstall" -LogName "uninstall.log"
  $uninstallCompleted = $true
  if ($null -ne (Get-CimInstance Win32_Service -Filter "Name='$serviceName'" -ErrorAction SilentlyContinue)) {
    throw "Service still exists after EXE uninstall"
  }
  if (Test-Path -LiteralPath $installRoot) {
    throw "Program Files payload still exists after EXE uninstall"
  }
  if (Test-Path -LiteralPath $shortcutPath -PathType Leaf) {
    throw "Provisioner Start menu shortcut still exists after EXE uninstall"
  }
  if (Test-Path -LiteralPath $startMenuFolder -PathType Container) {
    throw "Provisioner Start menu folder still exists after EXE uninstall"
  }
  if (-not (Test-Path -LiteralPath $stateRoot -PathType Container)) {
    throw "ProgramData state directory must be retained after EXE uninstall"
  }

  Write-Host "EXE_LIFECYCLE_PASS service=$serviceName provisioner=true shortcut=true selfTest=true repairRestored=true stateRetained=true"
} finally {
  if ($installAttempted -and -not $uninstallCompleted) {
    try {
      Invoke-Bundle -Action "/uninstall" -LogName "cleanup-uninstall.log"
    } catch {
      Write-Warning "EXE lifecycle cleanup failed: $($_.Exception.Message)"
    }
  }
}
