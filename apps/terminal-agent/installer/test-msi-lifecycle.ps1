[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$MsiPath)

$ErrorActionPreference = "Stop"
$resolvedMsi = (Resolve-Path -LiteralPath $MsiPath).Path
$installRoot = Join-Path $env:ProgramFiles "AIJobPrintAgent"
$stateRoot = Join-Path $env:ProgramData "AIJobPrintAgent"
$diagnosticPath = Join-Path $stateRoot "last-startup-diagnostic.json"
$serviceName = "aijobprintagent.exe"
$boundRegistryPath = "HKLM:\SOFTWARE\AIJobPrint\Agent"
$boundMarkerWritten = $false
$programMenuRoot = Join-Path $env:ProgramData "Microsoft\Windows\Start Menu\Programs\AI Job Print Terminal"
$panelShortcutPath = Join-Path $programMenuRoot "AI Job Print Terminal.url"
$desktopShortcutName = -join ([char[]](0x0041, 0x0049, 0x0020, 0x6C42, 0x804C, 0x6253, 0x5370, 0x670D, 0x52A1, 0x7EC8, 0x7AEF))
$desktopShortcutPath = Join-Path ([Environment]::GetFolderPath("CommonDesktopDirectory")) ($desktopShortcutName + ".lnk")
$controlCenterShortcutName = -join ([char[]](0x7EC8, 0x7AEF, 0x63A7, 0x5236, 0x4E2D, 0x5FC3))
$controlCenterShortcutPath = Join-Path $programMenuRoot ($controlCenterShortcutName + ".lnk")
$controlCenterLauncherPath = Join-Path $installRoot "provision\launch-control-center.vbs"
$controlCenterScriptPath = Join-Path $installRoot "provision\terminal-control-center.ps1"
$runtimeSecurityPath = Join-Path $installRoot "provision\provisioning-runtime-security.ps1"
$logRoot = Join-Path (Split-Path -Parent $resolvedMsi) "lifecycle-logs"
$testStartedAt = [DateTime]::Now
New-Item -ItemType Directory -Path $logRoot -Force | Out-Null

function Invoke-Msi([string[]]$Arguments, [string]$LogName) {
  $logPath = Join-Path $logRoot $LogName
  $process = Start-Process -FilePath "msiexec.exe" -ArgumentList (@($Arguments) + @("/qn", "/norestart", "/l*v", $logPath)) -Wait -PassThru -WindowStyle Hidden
  if ($process.ExitCode -ne 0) {
    throw "msiexec failed with exit code $($process.ExitCode); see $logPath"
  }
}

function Write-Utf8File([string]$Path, [string]$Content) {
  [System.IO.File]::WriteAllText($Path, $Content, [System.Text.UTF8Encoding]::new($false))
}

function Assert-PanelShortcut {
  if (-not (Test-Path -LiteralPath $panelShortcutPath -PathType Leaf)) {
    throw "Local status panel Start Menu shortcut is missing"
  }
  $shortcut = Get-Content -Raw -Encoding ASCII -LiteralPath $panelShortcutPath
  if ($shortcut -notmatch "(?m)^URL=http://127\.0\.0\.1:9527/local/panel\r?$") {
    throw "Local status panel shortcut does not contain the fixed loopback URL"
  }
}

function Assert-ShortcutTarget([string]$ShortcutPath, [string]$ExpectedTarget, [string]$Label) {
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($ShortcutPath)
  $shortcutTarget = [string]$shortcut.TargetPath
  if ([string]::IsNullOrWhiteSpace($shortcutTarget)) {
    $shellApplication = New-Object -ComObject Shell.Application
    $shortcutFolderPath = Split-Path -Parent $ShortcutPath
    $shortcutFolder = $shellApplication.Namespace($shortcutFolderPath)
    $shortcutItem = if ($null -eq $shortcutFolder) { $null } else { $shortcutFolder.ParseName((Split-Path -Leaf $ShortcutPath)) }
    if ($null -ne $shortcutItem) {
      $shortcutTarget = [string]$shortcutItem.ExtendedProperty("System.Link.TargetParsingPath")
    }
  }
  if ([string]::IsNullOrWhiteSpace($shortcutTarget)) {
    $shortcutBytes = [System.IO.File]::ReadAllBytes($ShortcutPath)
    $unicodePayload = [System.Text.Encoding]::Unicode.GetString($shortcutBytes)
    $ansiPayload = [System.Text.Encoding]::Default.GetString($shortcutBytes)
    if (-not $unicodePayload.Contains($ExpectedTarget) -and -not $ansiPayload.Contains($ExpectedTarget)) {
      throw "$Label shortcut target is unreadable or missing"
    }
    return
  }
  if ([System.IO.Path]::GetFullPath($shortcutTarget) -ne [System.IO.Path]::GetFullPath($ExpectedTarget)) {
    throw "$Label shortcut target mismatch"
  }
}

function Assert-DesktopShortcut {
  if (-not (Test-Path -LiteralPath $desktopShortcutPath -PathType Leaf)) {
    throw "Terminal control center desktop shortcut is missing"
  }
  if (-not (Test-Path -LiteralPath $controlCenterLauncherPath -PathType Leaf)) {
    throw "Terminal control center launcher is missing"
  }
  if (-not (Test-Path -LiteralPath $controlCenterScriptPath -PathType Leaf)) {
    throw "Terminal control center script is missing"
  }
  # The desktop link is an MSI advertised shortcut. Windows Installer resolves
  # it through the component descriptor, so WScript.Shell can legitimately
  # return an empty TargetPath. Its existence plus the installed GUI smoke test
  # proves the advertised entry and target component are both present.
  if (-not (Test-Path -LiteralPath $controlCenterShortcutPath -PathType Leaf)) {
    throw "Terminal control center Start Menu shortcut is missing"
  }
  Assert-ShortcutTarget -ShortcutPath $controlCenterShortcutPath -ExpectedTarget $controlCenterLauncherPath -Label "Terminal control center Start Menu"
}

function Assert-ControlCenterSmoke {
  $outputPath = Join-Path $logRoot "control-center-smoke.json"
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $controlCenterScriptPath -SmokeTest -SmokeTestOutput $outputPath
  if ($LASTEXITCODE -ne 0) { throw "Terminal control center smoke test failed" }
  $snapshot = Get-Content -Raw -Encoding UTF8 -LiteralPath $outputPath | ConvertFrom-Json
  if (-not [bool]$snapshot.installed -or [string]$snapshot.version -ne "0.4.15") {
    throw "Terminal control center smoke snapshot is invalid"
  }
}

function Assert-InstalledRuntimeAcl {
  if (-not (Test-Path -LiteralPath $runtimeSecurityPath -PathType Leaf)) {
    throw "Installed runtime security helper is missing"
  }
  . $runtimeSecurityPath
  Assert-RestrictedRuntime -Root $installRoot
}

function Assert-InstalledDiagnosis {
  # Agent startup failures tell the operator to run this script on the host.
  # Run the installed copy in its own Windows PowerShell process, as an operator
  # would, and require it to read this Program Files install as healthy.
  $diagnosePath = Join-Path $installRoot "provision\diagnose-production-agent.ps1"
  if (-not (Test-Path -LiteralPath $diagnosePath -PathType Leaf)) {
    throw "Installed diagnose script is missing"
  }
  $windowsPowerShell = Join-Path $env:SystemRoot "System32\WindowsPowerShell\v1.0\powershell.exe"
  $diagnosisJson = (& $windowsPowerShell -NoProfile -ExecutionPolicy Bypass -Command "& '$diagnosePath' | Select-Object -Last 1 | ConvertTo-Json -Compress" | Out-String).Trim()
  if ($LASTEXITCODE -ne 0) {
    throw "Installed diagnose script exited with code ${LASTEXITCODE}: $diagnosisJson"
  }
  $diagnosis = $diagnosisJson | ConvertFrom-Json
  if (-not [bool]$diagnosis.serviceExists -or [string]$diagnosis.serviceResolution -ne "resolved") {
    throw "Installed diagnose script did not resolve the installed service: $diagnosisJson"
  }
  if ([string]$diagnosis.runtimeRootAclStatus -ne "ok") {
    $aclText = (& (Join-Path $env:SystemRoot "System32\icacls.exe") $installRoot | Out-String).Trim()
    throw "Installed diagnose script must report the install root ACL as ok, got '$($diagnosis.runtimeRootAclStatus)': $aclText"
  }
  Write-Host "DIAGNOSE_INSTALLED_PASS serviceResolution=resolved runtimeRootAclStatus=ok"
}

function Add-EvidenceError([string]$Phase, [string]$Message) {
  $line = "[$([DateTime]::UtcNow.ToString('o'))] phase=$Phase $Message`n"
  [System.IO.File]::AppendAllText(
    (Join-Path $logRoot "evidence-errors.log"),
    $line,
    [System.Text.UTF8Encoding]::new($false)
  )
}

function Get-PayloadEvidence([string]$Name, [string]$RelativePath) {
  $fullPath = Join-Path $installRoot $RelativePath
  $record = [ordered]@{
    name = $Name
    relativePath = $RelativePath.Replace("\", "/")
    exists = Test-Path -LiteralPath $fullPath -PathType Leaf
    length = $null
    sha256 = $null
    fileVersion = $null
    productVersion = $null
    error = $null
  }
  if ($record.exists) {
    try {
      $item = Get-Item -LiteralPath $fullPath
      $record.length = $item.Length
      $record.sha256 = (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash
      $record.fileVersion = [string]$item.VersionInfo.FileVersion
      $record.productVersion = [string]$item.VersionInfo.ProductVersion
    } catch {
      $record.error = $_.Exception.Message
    }
  }
  return [pscustomobject]$record
}

function Export-LifecycleEvidence([string]$Phase) {
  $phaseRoot = Join-Path $logRoot $Phase
  New-Item -ItemType Directory -Path $phaseRoot -Force | Out-Null

  foreach ($verb in @("qc", "queryex")) {
    try {
      $scOutput = @(& "$env:SystemRoot\System32\sc.exe" $verb $serviceName 2>&1)
      $scExitCode = $LASTEXITCODE
      Write-Utf8File -Path (Join-Path $phaseRoot "sc-$verb.txt") -Content (
        (@("exitCode=$scExitCode") + $scOutput) -join "`r`n"
      )
    } catch {
      Add-EvidenceError -Phase $Phase -Message "sc.exe $verb failed: $($_.Exception.Message)"
    }
  }

  try {
    $payloadFiles = @(
      Get-PayloadEvidence -Name "serviceWrapper" -RelativePath "bootstrap\aijobprintagent.exe"
      Get-PayloadEvidence -Name "serviceXml" -RelativePath "bootstrap\aijobprintagent.xml"
      Get-PayloadEvidence -Name "nodeRuntime" -RelativePath "node\node.exe"
      Get-PayloadEvidence -Name "agentEntrypoint" -RelativePath "app\dist\index.js"
      Get-PayloadEvidence -Name "secureScanReader" -RelativePath "app\native\secure-scan-reader.exe"
    )
    $nodeVersion = $null
    $nodePath = Join-Path $installRoot "node\node.exe"
    if (Test-Path -LiteralPath $nodePath -PathType Leaf) {
      $nodeVersion = [string](& $nodePath --version 2>&1)
    }
    $payloadManifest = [ordered]@{
      collectedAt = [DateTime]::UtcNow.ToString("o")
      phase = $Phase
      installRoot = $installRoot
      stateRoot = $stateRoot
      nodeVersion = if ($null -eq $nodeVersion) { $null } else { $nodeVersion.Trim() }
      files = $payloadFiles
    }
    Write-Utf8File -Path (Join-Path $phaseRoot "installed-payload.json") -Content (
      ($payloadManifest | ConvertTo-Json -Depth 6) + "`n"
    )
  } catch {
    Add-EvidenceError -Phase $Phase -Message "payload inventory failed: $($_.Exception.Message)"
  }

  try {
    $service = Get-CimInstance Win32_Service -Filter "Name='$serviceName'" -ErrorAction SilentlyContinue
    $serviceEvidence = if ($null -eq $service) {
      [ordered]@{ exists = $false; name = $serviceName }
    } else {
      [ordered]@{
        exists = $true
        name = $service.Name
        displayName = $service.DisplayName
        state = $service.State
        startMode = $service.StartMode
        startName = $service.StartName
        pathName = $service.PathName
        processId = $service.ProcessId
        exitCode = $service.ExitCode
      }
    }
    Write-Utf8File -Path (Join-Path $phaseRoot "service-cim.json") -Content (
      ($serviceEvidence | ConvertTo-Json -Depth 4) + "`n"
    )
  } catch {
    Add-EvidenceError -Phase $Phase -Message "service CIM snapshot failed: $($_.Exception.Message)"
  }

  try {
    $scmEvents = @(
      Get-WinEvent -FilterHashtable @{
        LogName = "System"
        ProviderName = "Service Control Manager"
        StartTime = $testStartedAt.AddMinutes(-1)
      } -ErrorAction Stop |
        Where-Object {
          $_.Message -match [regex]::Escape($serviceName) -or
          $_.Message -match [regex]::Escape("AIJobPrintAgent")
        } |
        ForEach-Object {
          [pscustomobject][ordered]@{
            timeCreated = $_.TimeCreated.ToUniversalTime().ToString("o")
            id = $_.Id
            level = $_.LevelDisplayName
            provider = $_.ProviderName
            message = $_.Message
          }
        }
    )
    Write-Utf8File -Path (Join-Path $phaseRoot "service-control-manager-events.json") -Content (
      (ConvertTo-Json -InputObject $scmEvents -Depth 5) + "`n"
    )
  } catch {
    Add-EvidenceError -Phase $Phase -Message "SCM event collection failed: $($_.Exception.Message)"
  }

  try {
    if (Test-Path -LiteralPath $diagnosticPath -PathType Leaf) {
      Copy-Item -LiteralPath $diagnosticPath -Destination (Join-Path $phaseRoot "last-startup-diagnostic.json") -Force
    }
  } catch {
    Add-EvidenceError -Phase $Phase -Message "startup diagnostic copy failed: $($_.Exception.Message)"
  }

  $stateLogRoot = Join-Path $stateRoot "logs"
  $copiedLogRoot = Join-Path $phaseRoot "programdata-logs"
  $copiedEntries = 0
  try {
    if (Test-Path -LiteralPath $stateLogRoot -PathType Container) {
      New-Item -ItemType Directory -Path $copiedLogRoot -Force | Out-Null
      foreach ($item in @(Get-ChildItem -LiteralPath $stateLogRoot -Force)) {
        Copy-Item -LiteralPath $item.FullName -Destination $copiedLogRoot -Recurse -Force
        $copiedEntries++
      }
    }
  } catch {
    Add-EvidenceError -Phase $Phase -Message "ProgramData log copy failed: $($_.Exception.Message)"
  } finally {
    $copyStatus = [ordered]@{
      source = $stateLogRoot
      sourceExists = Test-Path -LiteralPath $stateLogRoot -PathType Container
      copiedEntries = $copiedEntries
    }
    Write-Utf8File -Path (Join-Path $phaseRoot "programdata-logs-status.json") -Content (
      ($copyStatus | ConvertTo-Json -Depth 3) + "`n"
    )
  }
}

function Restore-LifecycleSpooler {
  foreach ($taskName in @("AIJobPrintBootSpoolGuard", "AIJobPrintDailyReboot")) {
    $task = Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
    if ($null -ne $task) {
      Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    }
  }
  & "$env:SystemRoot\System32\sc.exe" config Spooler start= auto | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Could not restore Spooler to Automatic (sc config exit code $LASTEXITCODE)" }
  $spooler = Get-Service -Name "Spooler"
  if ($spooler.Status -ne [System.ServiceProcess.ServiceControllerStatus]::Running) {
    Start-Service -Name "Spooler"
    $spooler.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Running, [TimeSpan]::FromSeconds(60))
  }
  $readback = (& "$env:SystemRoot\System32\sc.exe" qc Spooler 2>&1 | Out-String)
  if ($readback -notmatch "AUTO_START") { throw "Spooler restore readback was not Automatic: $readback" }
  $spooler.Refresh()
  if ($spooler.Status -ne [System.ServiceProcess.ServiceControllerStatus]::Running) {
    throw "Spooler restore did not leave the service Running"
  }
}

$lifecyclePassed = $false
try {
if (Test-Path -LiteralPath $installRoot) {
  throw "Lifecycle test requires an unused runner: $installRoot already exists"
}

Invoke-Msi -Arguments @("/i", $resolvedMsi) -LogName "install.log"
Assert-PanelShortcut
Assert-DesktopShortcut
Assert-ControlCenterSmoke
Assert-InstalledRuntimeAcl
$service = Get-CimInstance Win32_Service -Filter "Name='$serviceName'"
if ($null -eq $service -or $service.State -ne "Stopped" -or $service.StartMode -ne "Manual") {
  throw "Fresh install must register a stopped Manual service until provisioning succeeds"
}
Assert-InstalledDiagnosis
if (-not (Test-Path -LiteralPath (Join-Path $installRoot "node\node.exe"))) {
  throw "Bundled Node runtime is missing after install"
}
if (-not (Test-Path -LiteralPath (Join-Path $installRoot "app\native\secure-scan-reader.exe"))) {
  throw "Secure scan reader is missing after install"
}
foreach ($relativeProvisionPath in @(
  "provision\provision-terminal.cmd",
  "provision\provision-installed-agent.ps1",
  "provision\install-production-agent.ps1",
  "provision\diagnose-production-agent.ps1",
  "provision\service-identity.ps1",
  "provision\terminal-control-center.ps1",
  "provision\launch-control-center.vbs",
  "provision\boot-spool-guard.ps1",
  "provision\boot-spool-guard-task.ps1",
  "provision\daily-reboot.ps1",
  "provision\daily-reboot-task.ps1",
  "kiosk\kiosk-watchdog.ps1",
  "kiosk\register-kiosk-watchdog.ps1",
  "kiosk\launch-kiosk.cmd"
)) {
  if (-not (Test-Path -LiteralPath (Join-Path $installRoot $relativeProvisionPath) -PathType Leaf)) {
    throw "Provisioning payload is missing after install: $relativeProvisionPath"
  }
}
# The MSI ships the scripts but does not register the tasks. Install them from
# the payload, then prove uninstall deletes both and puts Spooler back.
# The daily trigger is twelve hours ahead so it cannot fire during this run.
. (Join-Path $installRoot "provision\boot-spool-guard-task.ps1")
. (Join-Path $installRoot "provision\daily-reboot-task.ps1")
Install-BootSpoolGuard -GuardScriptPath (Join-Path $installRoot "provision\boot-spool-guard.ps1")
Install-DailyRebootTask -At ((Get-Date).AddHours(12).ToString("HH:mm")) -ScriptPath (Join-Path $installRoot "provision\daily-reboot.ps1")
if ($null -eq (Get-ScheduledTask -TaskName "AIJobPrintBootSpoolGuard" -ErrorAction SilentlyContinue)) {
  throw "Boot spool guard task missing after install"
}
if ($null -eq (Get-ScheduledTask -TaskName "AIJobPrintDailyReboot" -ErrorAction SilentlyContinue)) {
  throw "Daily reboot task missing after install"
}
$installedSpoolerQc = (& "$env:SystemRoot\System32\sc.exe" qc Spooler 2>&1 | Out-String)
if ($installedSpoolerQc -notmatch "DEMAND_START") {
  throw "Spooler was not Manual after boot spool guard install: $installedSpoolerQc"
}
if (-not (Test-Path -LiteralPath $stateRoot -PathType Container)) {
  throw "ProgramData state directory is missing after install"
}
powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "verify-secure-scan-reader.ps1") -InstallRoot $installRoot
if ($LASTEXITCODE -ne 0) {
  throw "Installed secure scan reader boundary verification failed"
}
Export-LifecycleEvidence -Phase "post-install"

# Prove that SCM/WinSW can launch the bundled Node runtime as LocalSystem. An
# unprovisioned host must fail before any network or print activity and leave a
# stable diagnostic instead of claiming work.
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
Export-LifecycleEvidence -Phase "post-start"
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

if (Test-Path -LiteralPath $diagnosticPath -PathType Leaf) {
  Remove-Item -LiteralPath $diagnosticPath -Force
}
Invoke-Msi -Arguments @("/fa", $resolvedMsi) -LogName "repair.log"
Assert-PanelShortcut
Assert-DesktopShortcut
Assert-ControlCenterSmoke
Assert-InstalledRuntimeAcl
$service = Get-CimInstance Win32_Service -Filter "Name='$serviceName'"
if ($null -eq $service -or $service.State -ne "Stopped" -or $service.StartMode -ne "Manual") {
  throw "Repair must preserve the unprovisioned stopped service"
}
$unboundRepairDeadline = [DateTime]::UtcNow.AddSeconds(10)
while (-not (Test-Path -LiteralPath $diagnosticPath -PathType Leaf) -and [DateTime]::UtcNow -lt $unboundRepairDeadline) {
  Start-Sleep -Milliseconds 500
}
if (Test-Path -LiteralPath $diagnosticPath -PathType Leaf) {
  throw "Unbound repair must not start the service or recreate its startup diagnostic"
}

# A bound repair must restore the service policy and make one best-effort start.
New-Item -Path $boundRegistryPath -Force | Out-Null
New-ItemProperty -LiteralPath $boundRegistryPath -Name "Bound" -Value 1 -PropertyType DWord -Force | Out-Null
$boundMarkerWritten = $true
# Put a distinct, unambiguous policy in place first, so the policy seen after the repair can only
# have come from the installer. Do not "clear" with actions= '""/0': how Windows PowerShell 5.1
# hands embedded quotes to sc.exe is not something this test should depend on.
& "$env:SystemRoot\System32\sc.exe" failure $serviceName reset= 1 actions= restart/7777 | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Could not set the pre-repair failure policy (sc failure exit code $LASTEXITCODE)" }
& "$env:SystemRoot\System32\sc.exe" failureflag $serviceName 0 | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Could not set the pre-repair failure flag (sc failureflag exit code $LASTEXITCODE)" }
if (Test-Path -LiteralPath $diagnosticPath -PathType Leaf) {
  Remove-Item -LiteralPath $diagnosticPath -Force
}
Invoke-Msi -Arguments @("/fa", $resolvedMsi) -LogName "repair-bound.log"
$service = Get-CimInstance Win32_Service -Filter "Name='$serviceName'"
if ($null -eq $service -or $service.StartMode -ne "Auto") {
  throw "Bound repair did not restore Automatic service startup"
}
$failurePolicy = (& "$env:SystemRoot\System32\sc.exe" qfailure $serviceName 2>&1 | Out-String)
if ($failurePolicy -notmatch 'RESET_PERIOD[^:]*:\s*86400' -or
    $failurePolicy -notmatch 'RESTART -- Delay = 60000' -or
    $failurePolicy -notmatch 'RESTART -- Delay = 300000' -or
    $failurePolicy -notmatch 'RESTART -- Delay = 1800000') {
  throw "Bound repair did not restore the expected service failure policy: $failurePolicy"
}
$failureFlagPolicy = (& "$env:SystemRoot\System32\sc.exe" qfailureflag $serviceName 2>&1 | Out-String)
if ($failureFlagPolicy -notmatch 'FAILURE_ACTIONS_ON_NONCRASH_FAILURES\s*:\s*TRUE') {
  throw "Bound repair did not restore the service failure flag: $failureFlagPolicy"
}
$boundDiagnosticDeadline = [DateTime]::UtcNow.AddSeconds(20)
while (-not (Test-Path -LiteralPath $diagnosticPath -PathType Leaf) -and [DateTime]::UtcNow -lt $boundDiagnosticDeadline) {
  Start-Sleep -Milliseconds 500
}
if (-not (Test-Path -LiteralPath $diagnosticPath -PathType Leaf)) {
  throw "Bound repair did not attempt to start the unconfigured service"
}
$boundDiagnostic = Get-Content -Raw -Encoding UTF8 -LiteralPath $diagnosticPath | ConvertFrom-Json
if ([string]$boundDiagnostic.code -ne "AGENT_CONFIG_NOT_FOUND") {
  throw "Bound repair startup diagnostic was not AGENT_CONFIG_NOT_FOUND"
}
Export-LifecycleEvidence -Phase "post-bound-repair"
Remove-ItemProperty -LiteralPath $boundRegistryPath -Name "Bound" -ErrorAction SilentlyContinue
if ($null -eq (Get-ItemProperty -LiteralPath $boundRegistryPath -Name "Bound" -ErrorAction SilentlyContinue)) {
  $boundMarkerWritten = $false
}
# The failed best-effort start above makes SCM schedule a restart 60 seconds later under the policy
# the repair just restored; that restart can land inside the uninstall below and leave the service
# briefly present. Disable the service first so a late restart attempt fails harmlessly.
& "$env:SystemRoot\System32\sc.exe" config $serviceName start= disabled | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Could not disable the service before uninstall (sc config exit code $LASTEXITCODE)" }

# Stop Spooler so uninstall has to switch it to Automatic and start it.
# sc.exe start returns non-zero when the service is already running, and deleting
# a missing task does too; those actions use Return="ignore" and must still leave
# the service Running here.
Stop-Service -Name "Spooler" -Force
$stoppedSpooler = Get-Service -Name "Spooler"
$stoppedSpooler.WaitForStatus([System.ServiceProcess.ServiceControllerStatus]::Stopped, [TimeSpan]::FromSeconds(60))

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
if (Test-Path -LiteralPath $panelShortcutPath) {
  throw "Local status panel Start Menu shortcut remains after uninstall"
}
if (Test-Path -LiteralPath $desktopShortcutPath) {
  throw "Terminal control center desktop shortcut remains after uninstall"
}
if ($null -ne (Get-ScheduledTask -TaskName "AIJobPrintBootSpoolGuard" -ErrorAction SilentlyContinue)) {
  throw "Boot spool guard task remains after uninstall"
}
if ($null -ne (Get-ScheduledTask -TaskName "AIJobPrintDailyReboot" -ErrorAction SilentlyContinue)) {
  throw "Daily reboot task remains after uninstall"
}
$spoolerDeadline = [DateTime]::UtcNow.AddSeconds(60)
do {
  $uninstalledSpoolerQc = (& "$env:SystemRoot\System32\sc.exe" qc Spooler 2>&1 | Out-String)
  $uninstalledSpooler = Get-Service -Name "Spooler"
  if ($uninstalledSpoolerQc -match "AUTO_START" -and $uninstalledSpooler.Status -eq [System.ServiceProcess.ServiceControllerStatus]::Running) {
    break
  }
  Start-Sleep -Milliseconds 500
} while ([DateTime]::UtcNow -lt $spoolerDeadline)
if ($uninstalledSpoolerQc -notmatch "AUTO_START") {
  throw "Spooler was not Automatic after uninstall: $uninstalledSpoolerQc"
}
if ((Get-Service -Name "Spooler").Status -ne [System.ServiceProcess.ServiceControllerStatus]::Running) {
  throw "Spooler was not Running after uninstall"
}

$lifecyclePassed = $true
Write-Host "MSI_LIFECYCLE_PASS service=$serviceName stateRetained=true boundRepairRestored=true"
} finally {
  Export-LifecycleEvidence -Phase "final"
  if ($boundMarkerWritten) {
    Remove-ItemProperty -LiteralPath $boundRegistryPath -Name "Bound" -ErrorAction SilentlyContinue
  }
  $restoreError = $null
  try {
    Restore-LifecycleSpooler
  } catch {
    $restoreError = $_
  }
  if ($null -ne $restoreError) {
    $restoreMessage = "Spooler restore failed: $($restoreError.Exception.Message)"
    if ($lifecyclePassed) { throw $restoreMessage }
    Write-Warning $restoreMessage
  }
}
