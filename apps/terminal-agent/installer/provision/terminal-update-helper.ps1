[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateSet("Check", "Install")][string]$Action,
  [Parameter(Mandatory = $true)][string]$ManifestUri,
  [Parameter(Mandatory = $true)][string]$ExpectedPublisher,
  [Parameter(Mandatory = $true)][string]$CurrentVersion,
  [string]$ExpectedCandidateVersion,
  [string]$ExpectedManifestApprovalId,
  [switch]$TestSkipAuthenticode,
  [string]$TestManifestSignerPublicKeyPath,
  [string]$TestManifestPath,
  [string]$TestPackagePath,
  [string]$TestRollbackPackagePath,
  [string]$ResultPath
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$serviceName = "aijobprintagent.exe"
$stateRoot = Join-Path $env:ProgramData "AIJobPrintAgent"
$configPath = Join-Path $stateRoot "agent-config.json"
$updateRoot = Join-Path $stateRoot "updates"
$maintenanceMarker = Join-Path $updateRoot "update-maintenance.json"
$resultFile = if ([string]::IsNullOrWhiteSpace($ResultPath)) { Join-Path $updateRoot "last-update-result.json" } else { $ResultPath }
$allowedManifestHost = "zyidai.cn"
$expectedManifestPath = "/downloads/terminal-agent/stable/manifest.json"
$maxManifestBytes = 64 * 1024
$maxPackageBytes = 1024 * 1024 * 1024
$pinnedManifestSignerPublicKeyBase64 = ""

function Write-Result([string]$Status, [string]$Code, [hashtable]$Details = @{}) {
  New-Item -ItemType Directory -Path (Split-Path -Parent $resultFile) -Force | Out-Null
  $record = [ordered]@{
    schemaVersion = 1
    status = $Status
    code = $Code
    currentVersion = $CurrentVersion
    observedAt = [DateTime]::UtcNow.ToString("o")
  }
  foreach ($key in $Details.Keys) { $record[$key] = $Details[$key] }
  [System.IO.File]::WriteAllText(
    $resultFile,
    (($record | ConvertTo-Json -Depth 8) + "`n"),
    [System.Text.UTF8Encoding]::new($false)
  )
}

function Fail([string]$Code, [string]$Message) {
  Write-Result -Status "failed" -Code $Code -Details @{ message = $Message }
  throw "${Code}: $Message"
}

function Assert-HttpsUri([string]$Value, [string]$ExpectedPath = "") {
  try { $uri = [System.Uri]$Value } catch { Fail "UPDATE_URI_INVALID" "升级地址格式无效" }
  if (-not $uri.IsAbsoluteUri -or $uri.Scheme -ne "https" -or -not $uri.IsDefaultPort -or -not [string]::IsNullOrEmpty($uri.UserInfo) -or $uri.Host -ne $allowedManifestHost -or -not [string]::IsNullOrEmpty($uri.Query) -or -not [string]::IsNullOrEmpty($uri.Fragment)) {
    Fail "UPDATE_URI_NOT_ALLOWED" "升级地址不在固定 HTTPS 发布源"
  }
  if (-not [string]::IsNullOrWhiteSpace($ExpectedPath) -and $uri.AbsolutePath -ne $ExpectedPath) {
    Fail "UPDATE_URI_NOT_ALLOWED" "升级清单路径不匹配固定发布源"
  }
  return $uri
}

function Compare-Version([string]$Left, [string]$Right) {
  try { return ([version]$Left).CompareTo([version]$Right) } catch { Fail "UPDATE_VERSION_INVALID" "升级版本号无效" }
}

function Assert-ReleaseVersion([string]$Value) {
  if ($Value -notmatch '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$') {
    Fail "UPDATE_VERSION_INVALID" "升级版本号必须是三段数字"
  }
  try { $parts = @($Value.Split('.') | ForEach-Object { [int64]$_ }) } catch { Fail "UPDATE_VERSION_INVALID" "升级版本号超出数字范围" }
  if ($parts[0] -gt 255 -or $parts[1] -gt 255 -or $parts[2] -gt 65535) {
    Fail "UPDATE_VERSION_INVALID" "升级版本号超出 Windows Installer 范围"
  }
}

function Assert-CanonicalText([string]$Value, [int]$MaximumLength) {
  if ([string]::IsNullOrWhiteSpace($Value) -or $Value.Length -gt $MaximumLength -or $Value -match "[`r`n]") {
    Fail "UPDATE_MANIFEST_INVALID" "升级清单文本字段无效"
  }
}

function Read-Manifest([System.Uri]$ManifestUrl, [string]$TestPath) {
  if (-not [string]::IsNullOrWhiteSpace($TestPath)) {
    try { $manifestItem = Get-Item -LiteralPath $TestPath -ErrorAction Stop } catch { Fail "UPDATE_MANIFEST_DOWNLOAD_FAILED" "测试升级清单无法读取" }
    if ($manifestItem.Length -le 0 -or $manifestItem.Length -gt $maxManifestBytes) { Fail "UPDATE_MANIFEST_SIZE_INVALID" "升级清单大小超出限制" }
    try { $rawManifest = Get-Content -Raw -Encoding UTF8 -LiteralPath $manifestItem.FullName } catch { Fail "UPDATE_MANIFEST_DOWNLOAD_FAILED" "测试升级清单无法读取" }
  } else {
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $ManifestUrl -Method Get -TimeoutSec 30 -MaximumRedirection 0
      $rawManifest = [string]$response.Content
    } catch { Fail "UPDATE_MANIFEST_DOWNLOAD_FAILED" "无法下载升级清单" }
    if ([System.Text.Encoding]::UTF8.GetByteCount($rawManifest) -le 0 -or [System.Text.Encoding]::UTF8.GetByteCount($rawManifest) -gt $maxManifestBytes) {
      Fail "UPDATE_MANIFEST_SIZE_INVALID" "升级清单大小超出限制"
    }
  }
  try { return $rawManifest | ConvertFrom-Json -ErrorAction Stop } catch { Fail "UPDATE_MANIFEST_INVALID" "升级清单 JSON 无效" }
}

function Get-CanonicalManifestPayload([object]$Manifest) {
  return (@(
    "schemaVersion=$([int]$Manifest.schemaVersion)",
    "channel=$([string]$Manifest.channel)",
    "version=$([string]$Manifest.version)",
    "minimumVersion=$([string]$Manifest.minimumVersion)",
    "packageUrl=$([string]$Manifest.package.url)",
    "packageSize=$([int64]$Manifest.package.size)",
    "packageSha256=$(([string]$Manifest.package.sha256).ToUpperInvariant())",
    "publisher=$([string]$Manifest.signer.publisher)",
    "thumbprint=$(([string]$Manifest.signer.thumbprint).Replace(' ', '').ToUpperInvariant())",
    "releaseNotes=$([string]$Manifest.releaseNotes)",
    "publishedAt=$([string]$Manifest.publishedAt)",
    "rollbackVersion=$([string]$Manifest.rollback.version)",
    "rollbackUrl=$([string]$Manifest.rollback.url)",
    "rollbackSize=$([int64]$Manifest.rollback.size)",
    "rollbackSha256=$(([string]$Manifest.rollback.sha256).ToUpperInvariant())",
    "rollbackThumbprint=$(([string]$Manifest.rollback.thumbprint).Replace(' ', '').ToUpperInvariant())"
  ) -join "`n") + "`n"
}

function Assert-ManifestSignature([object]$Manifest) {
  $effectivePublicKey = ""
  if (-not [string]::IsNullOrWhiteSpace($TestManifestSignerPublicKeyPath)) {
    $effectivePublicKey = (Get-Content -Raw -Encoding UTF8 -LiteralPath $TestManifestSignerPublicKeyPath).Trim()
  } elseif (-not [string]::IsNullOrWhiteSpace($pinnedManifestSignerPublicKeyBase64)) {
    try {
      $effectivePublicKey = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($pinnedManifestSignerPublicKeyBase64)).Trim()
    } catch { Fail "UPDATE_MANIFEST_SIGNER_NOT_CONFIGURED" "客户端升级清单公钥格式无效" }
  }
  if ([string]::IsNullOrWhiteSpace($effectivePublicKey)) {
    Fail "UPDATE_MANIFEST_SIGNER_NOT_CONFIGURED" "客户端尚未配置正式发布清单公钥"
  }
  try { $signature = [Convert]::FromBase64String([string]$Manifest.manifestSignature) } catch { Fail "UPDATE_MANIFEST_SIGNATURE_INVALID" "升级清单签名格式无效" }
  $rsa = [System.Security.Cryptography.RSA]::Create()
  try {
    try {
      $rsa.FromXmlString($effectivePublicKey)
      $payload = [System.Text.Encoding]::UTF8.GetBytes((Get-CanonicalManifestPayload $Manifest))
    } catch {
      Fail "UPDATE_MANIFEST_INVALID" "升级清单字段或发布公钥无效"
    }
    if ($rsa.KeySize -lt 2048) { Fail "UPDATE_MANIFEST_SIGNER_WEAK" "升级清单 RSA 公钥强度不足" }
    if (-not $rsa.VerifyData($payload, $signature, [System.Security.Cryptography.HashAlgorithmName]::SHA256, [System.Security.Cryptography.RSASignaturePadding]::Pkcs1)) {
      Fail "UPDATE_MANIFEST_SIGNATURE_INVALID" "升级清单签名校验失败"
    }
  } finally { $rsa.Dispose() }
}

function Get-ManifestApprovalId([object]$Manifest) {
  $sha256 = [System.Security.Cryptography.SHA256]::Create()
  try {
    $payload = [System.Text.Encoding]::UTF8.GetBytes((Get-CanonicalManifestPayload $Manifest))
    return ([System.BitConverter]::ToString($sha256.ComputeHash($payload))).Replace("-", "")
  } catch {
    Fail "UPDATE_MANIFEST_INVALID" "升级清单无法生成确认指纹"
  } finally { $sha256.Dispose() }
}

function Read-UpdateConfig {
  if (-not (Test-Path -LiteralPath $configPath -PathType Leaf)) { Fail "UPDATE_CONFIG_MISSING" "终端配置不存在" }
  try { $config = Get-Content -Raw -Encoding UTF8 -LiteralPath $configPath | ConvertFrom-Json -ErrorAction Stop } catch { Fail "UPDATE_CONFIG_INVALID" "终端配置无法读取" }
  $token = [string]$config.localUpdateControlToken
  if ([string]::IsNullOrWhiteSpace($token)) { Fail "UPDATE_CONTROL_TOKEN_MISSING" "本机升级控制凭据缺失，请重启终端服务；仍未恢复时请修复安装" }
  try { $tokenBytes = [Convert]::FromBase64String($token) } catch { Fail "UPDATE_CONTROL_TOKEN_INVALID" "本机升级控制凭据格式无效，请修复安装" }
  if ($tokenBytes.Length -ne 32 -or [Convert]::ToBase64String($tokenBytes) -ne $token) {
    Fail "UPDATE_CONTROL_TOKEN_INVALID" "本机升级控制凭据格式无效，请修复安装"
  }
  $port = 9527
  if ($null -ne $config.localApiPort -and (-not [int]::TryParse([string]$config.localApiPort, [ref]$port) -or $port -lt 1 -or $port -gt 65535)) {
    Fail "UPDATE_LOCAL_API_PORT_INVALID" "终端本机接口端口配置无效"
  }
  return @{ token = $token; port = $port }
}

function Invoke-LocalControl([string]$Path, [string]$Token, [int]$Port, [string]$Method = "Post", [int]$TimeoutSec = 15) {
  $response = Invoke-WebRequest `
    -UseBasicParsing `
    -Uri ("http://127.0.0.1:" + $Port + $Path) `
    -Method $Method `
    -Headers @{ "X-Update-Control-Token" = $Token } `
    -TimeoutSec $TimeoutSec
  return $response.Content | ConvertFrom-Json -ErrorAction Stop
}

function Assert-Authenticode([string]$Path, [string]$Publisher, [string]$Thumbprint) {
  if ($TestSkipAuthenticode) { return }
  $signature = Get-AuthenticodeSignature -LiteralPath $Path
  if ($signature.Status -ne [System.Management.Automation.SignatureStatus]::Valid -or $null -eq $signature.SignerCertificate) {
    Fail "UPDATE_SIGNATURE_INVALID" "升级安装包 Authenticode 签名无效"
  }
  if ($signature.SignerCertificate.Thumbprint.Replace(" ", "").ToUpperInvariant() -ne $Thumbprint.Replace(" ", "").ToUpperInvariant()) {
    Fail "UPDATE_SIGNER_THUMBPRINT_MISMATCH" "升级安装包签名证书指纹不匹配"
  }
  if (-not [string]::Equals($signature.SignerCertificate.Subject, $Publisher, [System.StringComparison]::OrdinalIgnoreCase)) {
    Fail "UPDATE_SIGNER_PUBLISHER_MISMATCH" "升级安装包发布者不匹配"
  }
}

function Save-RemotePackage([System.Uri]$Uri, [string]$TestPath, [string]$Destination, [int64]$ExpectedSize, [string]$ExpectedHash, [string]$Publisher, [string]$Thumbprint) {
  if (-not [string]::IsNullOrWhiteSpace($TestPath)) {
    try {
      $resolvedTestPath = (Resolve-Path -LiteralPath $TestPath).Path
      if (-not [string]::Equals($resolvedTestPath, [System.IO.Path]::GetFullPath($Destination), [System.StringComparison]::OrdinalIgnoreCase)) {
        Copy-Item -LiteralPath $resolvedTestPath -Destination $Destination -Force
      }
    } catch { Fail "UPDATE_PACKAGE_DOWNLOAD_FAILED" "测试升级安装包无法复制" }
  } else {
    try { Invoke-WebRequest -UseBasicParsing -Uri $Uri -OutFile $Destination -TimeoutSec 180 -MaximumRedirection 0 } catch { Fail "UPDATE_PACKAGE_DOWNLOAD_FAILED" "升级安装包下载失败" }
  }
  $item = Get-Item -LiteralPath $Destination
  if ($ExpectedSize -gt 0 -and $item.Length -ne $ExpectedSize) { Fail "UPDATE_PACKAGE_SIZE_MISMATCH" "升级安装包大小校验失败" }
  if ((Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash.ToUpperInvariant() -ne $ExpectedHash) { Fail "UPDATE_PACKAGE_HASH_MISMATCH" "升级安装包 SHA-256 校验失败" }
  Assert-Authenticode -Path $Destination -Publisher $Publisher -Thumbprint $Thumbprint
}

function Invoke-Bundle([string]$Path, [string]$Operation, [string]$LogPath, [string]$MaintenanceVersion) {
  $process = Start-Process `
    -FilePath $Path `
    -ArgumentList @($Operation, "/quiet", "/norestart", "/log", ('"' + $LogPath + '"')) `
    -PassThru
  $maintenanceRenewalFailure = ""
  while (-not $process.WaitForExit(30000)) {
    # Keep the bounded marker alive only while the trusted updater is still supervising the installer.
    try {
      Write-MaintenanceMarker -CandidateVersion $MaintenanceVersion
      $maintenanceRenewalFailure = ""
    } catch {
      # Do not start rollback while the installer process is still running.
      $maintenanceRenewalFailure = $_.Exception.Message
    }
  }
  if (-not [string]::IsNullOrWhiteSpace($maintenanceRenewalFailure)) {
    throw "UPDATE_MAINTENANCE_RENEWAL_FAILED: 安装期间无法续租维护标记：$maintenanceRenewalFailure"
  }
  try {
    Write-MaintenanceMarker -CandidateVersion $MaintenanceVersion
  } catch {
    throw "UPDATE_MAINTENANCE_RENEWAL_FAILED: 安装完成后无法续租维护标记：$($_.Exception.Message)"
  }
  return [int]$process.ExitCode
}

function Set-AgentServiceProductionPolicy {
  $deadline = [DateTime]::UtcNow.AddSeconds(30)
  $service = $null
  while ([DateTime]::UtcNow -lt $deadline) {
    $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($null -ne $service) { break }
    Start-Sleep -Seconds 1
  }
  if ($null -eq $service) { throw "UPDATE_SERVICE_MISSING: Windows 服务不存在" }
  Set-Service -Name $serviceName -StartupType Automatic
  & sc.exe failure $serviceName "reset=" "86400" "actions=" 'restart/60000/restart/300000/""/0' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "UPDATE_SERVICE_RECOVERY_FAILED: Windows 服务恢复策略配置失败" }
  & sc.exe failureflag $serviceName "1" | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "UPDATE_SERVICE_RECOVERY_FAILED: Windows 服务恢复标记配置失败" }
  $service.Refresh()
  if ($service.Status -ne "Running") { Start-Service -Name $serviceName }
}

function Wait-AgentHealthy([string]$ExpectedVersion, [string]$Token, [int]$Port, [int]$TimeoutSeconds = 120) {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    Start-Sleep -Seconds 2
    $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($null -eq $service -or $service.Status -ne "Running") { continue }
    try {
      $response = Invoke-LocalControl -Path "/local/update/health" -Token $Token -Port $Port -Method "Get" -TimeoutSec 5
      if ($response.success -eq $true -and [string]$response.data.runtimeVersion -eq $ExpectedVersion -and $response.data.cloudConnected -eq $true -and $response.data.localTaskDatabaseAvailable -eq $true -and [string]$response.data.credentialStatus -eq "ready") {
        return $true
      }
    } catch {}
  }
  return $false
}

function Write-MaintenanceMarker([string]$CandidateVersion) {
  New-Item -ItemType Directory -Path $updateRoot -Force | Out-Null
  $tempPath = Join-Path $updateRoot (".update-maintenance." + $PID + ".tmp")
  $record = [ordered]@{
    schemaVersion = 1
    candidateVersion = $CandidateVersion
    startedAt = [DateTime]::UtcNow.ToString("o")
    expiresAt = [DateTime]::UtcNow.AddMinutes(20).ToString("o")
  }
  [System.IO.File]::WriteAllText($tempPath, (($record | ConvertTo-Json -Depth 4) + "`n"), [System.Text.UTF8Encoding]::new($false))
  try {
    if ([System.IO.File]::Exists($maintenanceMarker)) {
      $backupPath = $tempPath + ".backup"
      [System.IO.File]::Replace($tempPath, $maintenanceMarker, $backupPath)
      Remove-Item -LiteralPath $backupPath -Force -ErrorAction SilentlyContinue
    } else {
      [System.IO.File]::Move($tempPath, $maintenanceMarker)
    }
  } finally {
    Remove-Item -LiteralPath $tempPath -Force -ErrorAction SilentlyContinue
  }
}

function Resume-Claims([string]$Token, [int]$Port) {
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    try {
      $response = Invoke-LocalControl -Path "/local/update/drain/complete" -Token $Token -Port $Port
      if ($response.success -eq $true -and $response.data.acceptingClaims -eq $true -and -not (Test-Path -LiteralPath $maintenanceMarker -PathType Leaf)) {
        return $true
      }
    } catch {}
    if ($attempt -lt 3) { Start-Sleep -Seconds 1 }
  }
  return $false
}

$testHooksRequested = $TestSkipAuthenticode -or -not [string]::IsNullOrWhiteSpace($TestManifestSignerPublicKeyPath) -or -not [string]::IsNullOrWhiteSpace($TestManifestPath) -or -not [string]::IsNullOrWhiteSpace($TestPackagePath) -or -not [string]::IsNullOrWhiteSpace($TestRollbackPackagePath)
if ($testHooksRequested -and $env:CI -ne "true") { Fail "UPDATE_TEST_HOOK_FORBIDDEN" "升级测试入口仅允许在 CI 中使用" }
if ([string]::IsNullOrWhiteSpace($ExpectedPublisher)) { Fail "UPDATE_PUBLISHER_NOT_CONFIGURED" "客户端尚未配置正式发布者" }

$manifestUrl = Assert-HttpsUri -Value $ManifestUri -ExpectedPath $expectedManifestPath
$manifest = Read-Manifest -ManifestUrl $manifestUrl -TestPath $TestManifestPath
if ($manifest.schemaVersion -ne 1 -or [string]$manifest.channel -ne "stable") { Fail "UPDATE_MANIFEST_INVALID" "升级清单版本或通道无效" }
Assert-CanonicalText -Value ([string]$manifest.channel) -MaximumLength 16
Assert-CanonicalText -Value ([string]$manifest.version) -MaximumLength 32
Assert-CanonicalText -Value ([string]$manifest.minimumVersion) -MaximumLength 32
Assert-CanonicalText -Value ([string]$manifest.package.url) -MaximumLength 2048
Assert-CanonicalText -Value ([string]$manifest.package.sha256) -MaximumLength 128
Assert-CanonicalText -Value ([string]$manifest.signer.publisher) -MaximumLength 512
Assert-CanonicalText -Value ([string]$manifest.signer.thumbprint) -MaximumLength 128
Assert-CanonicalText -Value ([string]$manifest.releaseNotes) -MaximumLength 1000
Assert-CanonicalText -Value ([string]$manifest.publishedAt) -MaximumLength 64
Assert-CanonicalText -Value ([string]$manifest.rollback.version) -MaximumLength 32
Assert-CanonicalText -Value ([string]$manifest.rollback.url) -MaximumLength 2048
Assert-CanonicalText -Value ([string]$manifest.rollback.sha256) -MaximumLength 128
Assert-CanonicalText -Value ([string]$manifest.rollback.thumbprint) -MaximumLength 128
Assert-CanonicalText -Value ([string]$manifest.manifestSignature) -MaximumLength 2048
Assert-ManifestSignature $manifest
$manifestApprovalId = Get-ManifestApprovalId $manifest

$candidateVersion = [string]$manifest.version
$minimumVersion = [string]$manifest.minimumVersion
$rollbackVersion = [string]$manifest.rollback.version
Assert-ReleaseVersion $CurrentVersion
Assert-ReleaseVersion $candidateVersion
Assert-ReleaseVersion $minimumVersion
Assert-ReleaseVersion $rollbackVersion
if ($Action -eq "Install" -and [string]::IsNullOrWhiteSpace($ExpectedCandidateVersion)) { Fail "UPDATE_EXPECTED_VERSION_MISSING" "安装更新必须绑定已确认的候选版本" }
if ($Action -eq "Install" -and $ExpectedManifestApprovalId -notmatch "^[A-Fa-f0-9]{64}$") { Fail "UPDATE_EXPECTED_MANIFEST_MISSING" "安装更新必须绑定已确认的签名清单" }
if ($Action -eq "Install") { Assert-ReleaseVersion $ExpectedCandidateVersion }
if ($Action -eq "Install" -and (Compare-Version $candidateVersion $ExpectedCandidateVersion) -ne 0) { Fail "UPDATE_CANDIDATE_CHANGED" "稳定通道版本已变化，请重新检查并确认更新" }
if ($Action -eq "Install" -and -not [string]::Equals($manifestApprovalId, $ExpectedManifestApprovalId, [System.StringComparison]::OrdinalIgnoreCase)) { Fail "UPDATE_MANIFEST_CHANGED" "已签名升级清单已变化，请重新检查并确认更新" }
if ((Compare-Version $CurrentVersion $minimumVersion) -lt 0) { Fail "UPDATE_CURRENT_VERSION_TOO_OLD" "当前版本低于允许的最小升级版本，请执行一次受控人工升级" }
$comparison = Compare-Version $candidateVersion $CurrentVersion
if ($comparison -lt 0) { Fail "UPDATE_DOWNGRADE_NOT_ALLOWED" "稳定通道版本低于当前版本，拒绝降级" }
if ((Compare-Version $rollbackVersion $candidateVersion) -ge 0) { Fail "UPDATE_MANIFEST_INVALID" "回滚版本必须低于候选版本" }

$packageUrl = Assert-HttpsUri -Value ([string]$manifest.package.url) -ExpectedPath ("/downloads/terminal-agent/" + $candidateVersion + "/AIJobPrintTerminalSetup.exe")
$rollbackUrl = Assert-HttpsUri -Value ([string]$manifest.rollback.url) -ExpectedPath ("/downloads/terminal-agent/" + $rollbackVersion + "/AIJobPrintTerminalSetup.exe")
$sha256 = ([string]$manifest.package.sha256).ToUpperInvariant()
$rollbackSha256 = ([string]$manifest.rollback.sha256).ToUpperInvariant()
$candidateThumbprint = ([string]$manifest.signer.thumbprint).Replace(" ", "").ToUpperInvariant()
$rollbackThumbprint = ([string]$manifest.rollback.thumbprint).Replace(" ", "").ToUpperInvariant()
$candidateSize = [int64]$manifest.package.size
$rollbackSize = [int64]$manifest.rollback.size
if ($sha256 -notmatch "^[A-F0-9]{64}$" -or $candidateSize -le 0 -or $candidateSize -gt $maxPackageBytes -or $rollbackSha256 -notmatch "^[A-F0-9]{64}$" -or $rollbackSize -le 0 -or $rollbackSize -gt $maxPackageBytes -or $candidateThumbprint -notmatch "^(?:[A-F0-9]{40}|[A-F0-9]{64})$" -or $rollbackThumbprint -notmatch "^(?:[A-F0-9]{40}|[A-F0-9]{64})$") {
  Fail "UPDATE_MANIFEST_INVALID" "升级或回滚安装包元数据无效"
}
if ([string]$manifest.signer.publisher -ne $ExpectedPublisher) { Fail "UPDATE_MANIFEST_SIGNER_MISMATCH" "升级清单发布者不匹配本机固定发布策略" }
if ($comparison -eq 0) {
  Write-Result -Status "up_to_date" -Code "UPDATE_NOT_REQUIRED" -Details @{ candidateVersion = $candidateVersion; releaseNotes = [string]$manifest.releaseNotes }
  exit 0
}
if ((Compare-Version $rollbackVersion $CurrentVersion) -ne 0) { Fail "UPDATE_ROLLBACK_VERSION_MISMATCH" "稳定通道回滚包不匹配当前版本，请执行一次受控人工升级" }
if ($Action -eq "Check") {
  Write-Result -Status "available" -Code "UPDATE_AVAILABLE" -Details @{ candidateVersion = $candidateVersion; manifestApprovalId = $manifestApprovalId; releaseNotes = [string]$manifest.releaseNotes; size = $candidateSize }
  exit 0
}

# Hold an OS-enforced exclusive handle from the first mutating preparation step
# through process exit. The file may remain, but Windows releases the lock if
# this helper exits or dies. Manifest-only negative tests never touch ProgramData.
$installLockHandle = $null
try { New-Item -ItemType Directory -Path $updateRoot -Force | Out-Null } catch { Fail "UPDATE_STATE_UNAVAILABLE" "无法创建本机升级状态目录" }
$installLockPath = Join-Path $updateRoot "install.lock"
try {
  $installLockHandle = [System.IO.File]::Open(
    $installLockPath,
    [System.IO.FileMode]::OpenOrCreate,
    [System.IO.FileAccess]::ReadWrite,
    [System.IO.FileShare]::None
  )
} catch [System.IO.IOException] {
  Fail "UPDATE_ALREADY_IN_PROGRESS" "另一个在线升级正在进行，请等待完成"
} catch {
  Fail "UPDATE_STATE_UNAVAILABLE" "无法锁定本机升级状态"
}

$versionRoot = Join-Path $updateRoot $candidateVersion
New-Item -ItemType Directory -Path $versionRoot -Force | Out-Null
$packageFile = Join-Path $versionRoot "AIJobPrintTerminalSetup.exe"
$rollbackFile = Join-Path $versionRoot ("AIJobPrintTerminalSetup-rollback-" + $rollbackVersion + ".exe")
Save-RemotePackage -Uri $packageUrl -TestPath $TestPackagePath -Destination $packageFile -ExpectedSize $candidateSize -ExpectedHash $sha256 -Publisher $ExpectedPublisher -Thumbprint $candidateThumbprint
Save-RemotePackage -Uri $rollbackUrl -TestPath $TestRollbackPackagePath -Destination $rollbackFile -ExpectedSize $rollbackSize -ExpectedHash $rollbackSha256 -Publisher $ExpectedPublisher -Thumbprint $rollbackThumbprint

$updateConfig = Read-UpdateConfig
$controlToken = [string]$updateConfig.token
$localApiPort = [int]$updateConfig.port
try {
  $drain = Invoke-LocalControl -Path "/local/update/drain/begin" -Token $controlToken -Port $localApiPort -TimeoutSec 130
  if ($drain.success -ne $true -or $drain.data.ready -ne $true -or $drain.data.acceptingClaims -ne $false) { throw "drain not ready" }
} catch {
  Fail "UPDATE_DRAIN_FAILED" "终端仍有打印任务或未解决的状态回执，升级已取消"
}

try {
  Write-MaintenanceMarker -CandidateVersion $candidateVersion
} catch {
  try { [void](Invoke-LocalControl -Path "/local/update/drain/cancel" -Token $controlToken -Port $localApiPort) } catch {}
  Fail "UPDATE_MAINTENANCE_MARKER_FAILED" "无法建立升级维护标记，已恢复领取任务"
}

$candidateLog = Join-Path $versionRoot "candidate-install.log"
$rollbackUninstallLog = Join-Path $versionRoot "candidate-rollback-uninstall.log"
$rollbackInstallLog = Join-Path $versionRoot "rollback-install.log"
Write-Result -Status "installing" -Code "UPDATE_INSTALLING" -Details @{ candidateVersion = $candidateVersion; rollbackVersion = $rollbackVersion }
$candidateExitCode = -1
$candidateFailure = ""
try {
  $candidateExitCode = Invoke-Bundle -Path $packageFile -Operation "/install" -LogPath $candidateLog -MaintenanceVersion $candidateVersion
  if ($candidateExitCode -notin @(0, 3010)) { throw "安装程序返回错误码 $candidateExitCode" }
  Set-AgentServiceProductionPolicy
  if (-not (Wait-AgentHealthy -ExpectedVersion $candidateVersion -Token $controlToken -Port $localApiPort)) {
    throw "UPDATE_HEALTH_CHECK_FAILED: 新版本未在时限内通过服务、本地数据库、终端凭据和云端心跳检查"
  }
} catch {
  $candidateFailure = $_.Exception.Message
}

if ([string]::IsNullOrWhiteSpace($candidateFailure)) {
  if (-not (Resume-Claims -Token $controlToken -Port $localApiPort)) {
    Write-Result -Status "installed_degraded" -Code "UPDATE_RESUME_CLAIMS_FAILED" -Details @{ candidateVersion = $candidateVersion; message = "新版本已安装并通过健康检查，但无法确认领取任务恢复；维护状态将保留至租约到期，请检查服务" }
    throw "UPDATE_RESUME_CLAIMS_FAILED: 新版本已安装，但无法确认领取任务恢复"
  }
  Write-Result -Status "succeeded" -Code "UPDATE_SUCCEEDED" -Details @{ candidateVersion = $candidateVersion; rebootRequired = ($candidateExitCode -eq 3010) }
  exit 0
}

Write-Result -Status "rolling_back" -Code "UPDATE_ROLLBACK_STARTED" -Details @{ candidateVersion = $candidateVersion; rollbackVersion = $rollbackVersion; candidateFailure = $candidateFailure }
$rollbackFailure = ""
try {
  Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
  $uninstallExitCode = Invoke-Bundle -Path $packageFile -Operation "/uninstall" -LogPath $rollbackUninstallLog -MaintenanceVersion $candidateVersion
  if ($uninstallExitCode -notin @(0, 3010, 1605)) { throw "候选版本卸载返回错误码 $uninstallExitCode" }
  $rollbackExitCode = Invoke-Bundle -Path $rollbackFile -Operation "/install" -LogPath $rollbackInstallLog -MaintenanceVersion $candidateVersion
  if ($rollbackExitCode -notin @(0, 3010)) { throw "回滚安装程序返回错误码 $rollbackExitCode" }
  Set-AgentServiceProductionPolicy
  if (-not (Wait-AgentHealthy -ExpectedVersion $rollbackVersion -Token $controlToken -Port $localApiPort)) {
    throw "回滚版本未在时限内恢复云端心跳"
  }
  if (-not (Resume-Claims -Token $controlToken -Port $localApiPort)) { throw "回滚版本无法确认领取任务恢复" }
} catch {
  $rollbackFailure = $_.Exception.Message
}

if (-not [string]::IsNullOrWhiteSpace($rollbackFailure)) {
  Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
  Set-Service -Name $serviceName -StartupType Manual -ErrorAction SilentlyContinue
  Fail "UPDATE_ROLLBACK_FAILED" "升级失败且自动回滚未通过健康检查；维护标记已保留，终端不会继续领取新任务。原因：$rollbackFailure"
}

Write-Result -Status "rolled_back" -Code "UPDATE_ROLLED_BACK" -Details @{ candidateVersion = $candidateVersion; rollbackVersion = $rollbackVersion; candidateFailure = $candidateFailure }
throw "UPDATE_ROLLED_BACK: 新版本未通过健康检查，已自动恢复到 $rollbackVersion"
