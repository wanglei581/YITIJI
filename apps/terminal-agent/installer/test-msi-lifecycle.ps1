[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$MsiPath)

$ErrorActionPreference = "Stop"
$resolvedMsi = (Resolve-Path -LiteralPath $MsiPath).Path
$installRoot = Join-Path $env:ProgramFiles "AIJobPrintAgent"
$stateRoot = Join-Path $env:ProgramData "AIJobPrintAgent"
$diagnosticPath = Join-Path $stateRoot "last-startup-diagnostic.json"
$serviceName = "aijobprintagent.exe"
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

try {
if (Test-Path -LiteralPath $installRoot) {
  throw "Lifecycle test requires an unused runner: $installRoot already exists"
}

Invoke-Msi -Arguments @("/i", $resolvedMsi) -LogName "install.log"
$service = Get-CimInstance Win32_Service -Filter "Name='$serviceName'"
if ($null -eq $service -or $service.State -ne "Stopped" -or $service.StartMode -ne "Manual") {
  throw "Fresh install must register a stopped Manual service until provisioning succeeds"
}
if (-not (Test-Path -LiteralPath (Join-Path $installRoot "node\node.exe"))) {
  throw "Bundled Node runtime is missing after install"
}
if (-not (Test-Path -LiteralPath (Join-Path $installRoot "app\native\secure-scan-reader.exe"))) {
  throw "Secure scan reader is missing after install"
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
} finally {
  Export-LifecycleEvidence -Phase "final"
}
