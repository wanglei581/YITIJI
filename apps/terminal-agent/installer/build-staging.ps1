[CmdletBinding()]
param(
  [string]$OutputDirectory,
  [string]$CacheDirectory,
  [string]$ManifestSignerPublicKeyPath,
  [string]$UpdatePublisher
)

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = `
  [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
  $OutputDirectory = Join-Path $PSScriptRoot "artifacts\staging"
}
if ([string]::IsNullOrWhiteSpace($CacheDirectory)) {
  $CacheDirectory = Join-Path $PSScriptRoot "cache"
}

function Fail([string]$Message) {
  throw $Message
}

function Assert-Sha256([string]$Path, [string]$Expected) {
  $actual = (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToUpperInvariant()
  if ($actual -ne $Expected.ToUpperInvariant()) {
    Fail "SHA-256 mismatch for $(Split-Path -Leaf $Path): expected $Expected, got $actual"
  }
}

function Get-PinnedFile([object]$Spec, [string]$Destination) {
  if (-not (Test-Path -LiteralPath $Destination -PathType Leaf)) {
    Invoke-WebRequest -UseBasicParsing -Uri $Spec.url -OutFile $Destination
  }
  $expected = if ($null -ne $Spec.archiveSha256) { $Spec.archiveSha256 } else { $Spec.sha256 }
  Assert-Sha256 -Path $Destination -Expected $expected
}

function Invoke-Checked([string]$Executable, [string[]]$Arguments) {
  & $Executable @Arguments
  if ($LASTEXITCODE -ne 0) {
    Fail "$Executable failed with exit code $LASTEXITCODE"
  }
}

function Copy-WindowsPowerShellScript([string]$Source, [string]$Destination) {
  # Windows PowerShell 5.1 treats BOM-less UTF-8 as the active ANSI code page.
  # Preserve non-ASCII prompts and syntax by emitting an explicit UTF-8 BOM.
  $content = Get-Content -Raw -Encoding UTF8 -LiteralPath $Source
  [System.IO.File]::WriteAllText($Destination, $content, [System.Text.UTF8Encoding]::new($true))
}

function Assert-ChildPath([string]$Root, [string]$Candidate) {
  $rootPath = [System.IO.Path]::GetFullPath($Root).TrimEnd("\") + "\"
  $candidatePath = [System.IO.Path]::GetFullPath($Candidate)
  if (-not $candidatePath.StartsWith($rootPath, [System.StringComparison]::OrdinalIgnoreCase)) {
    Fail "Refusing to mutate a path outside the staging root"
  }
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..\..")).Path
$agentRoot = Join-Path $repoRoot "apps\terminal-agent"
$inputsPath = Join-Path $PSScriptRoot "inputs.json"
$inputs = Get-Content -Raw -Encoding UTF8 $inputsPath | ConvertFrom-Json
$stagingRoot = [System.IO.Path]::GetFullPath($OutputDirectory)
$cacheRoot = [System.IO.Path]::GetFullPath($CacheDirectory)

if (Test-Path -LiteralPath $stagingRoot) {
  if (@(Get-ChildItem -Force -LiteralPath $stagingRoot).Count -gt 0) {
    Fail "Staging output must be absent or empty: $stagingRoot"
  }
}
New-Item -ItemType Directory -Path $stagingRoot -Force | Out-Null
New-Item -ItemType Directory -Path $cacheRoot -Force | Out-Null

$nodeArchive = Join-Path $cacheRoot "node-v$($inputs.node.version)-win-x64.zip"
$wrapperDownload = Join-Path $cacheRoot "WinSW-x64-$($inputs.serviceWrapper.version).exe"
Get-PinnedFile -Spec $inputs.node -Destination $nodeArchive
Get-PinnedFile -Spec $inputs.serviceWrapper -Destination $wrapperDownload

$extractRoot = Join-Path $stagingRoot "_node_extract"
Assert-ChildPath -Root $stagingRoot -Candidate $extractRoot
Expand-Archive -LiteralPath $nodeArchive -DestinationPath $extractRoot
$extractedNodeRoot = Join-Path $extractRoot "node-v$($inputs.node.version)-win-x64"
$nodeExecutable = Join-Path $extractedNodeRoot "node.exe"
Assert-Sha256 -Path $nodeExecutable -Expected $inputs.node.executableSha256

$nodeRoot = Join-Path $stagingRoot "node"
$appRoot = Join-Path $stagingRoot "app"
$bootstrapRoot = Join-Path $stagingRoot "bootstrap"
$provisionRoot = Join-Path $stagingRoot "provision"
New-Item -ItemType Directory -Path $nodeRoot, $appRoot, $bootstrapRoot, $provisionRoot -Force | Out-Null
Copy-Item -LiteralPath $nodeExecutable -Destination (Join-Path $nodeRoot "node.exe")
Copy-Item -LiteralPath (Join-Path $extractedNodeRoot "LICENSE") -Destination (Join-Path $nodeRoot "LICENSE")

$corepack = Join-Path $extractedNodeRoot "corepack.cmd"
$env:COREPACK_HOME = Join-Path $cacheRoot "corepack"
$env:CI = "true"
$deployRoot = Join-Path $stagingRoot "_deploy"
Assert-ChildPath -Root $stagingRoot -Candidate $deployRoot
Push-Location $repoRoot
try {
  Invoke-Checked -Executable $corepack -Arguments @("pnpm", "install", "--frozen-lockfile")
  Invoke-Checked -Executable $corepack -Arguments @("pnpm", "--filter", "./apps/terminal-agent", "build")
  # Root patches stay enforced during install; the Agent-only deploy graph may not consume every patch.
  Invoke-Checked -Executable $corepack -Arguments @(
    "pnpm",
    "--config.node-linker=hoisted",
    "--config.allowUnusedPatches=true",
    "--filter",
    "./apps/terminal-agent",
    "--prod",
    "deploy",
    $deployRoot,
    "--legacy"
  )
} finally {
  Pop-Location
}

$deployedNodeWindows = Join-Path $deployRoot "node_modules\node-windows"
Assert-ChildPath -Root $stagingRoot -Candidate $deployedNodeWindows
if (Test-Path -LiteralPath $deployedNodeWindows) {
  Remove-Item -LiteralPath $deployedNodeWindows -Recurse -Force
}
Copy-Item -LiteralPath (Join-Path $deployRoot "node_modules") -Destination $appRoot -Recurse
Copy-Item -LiteralPath (Join-Path $agentRoot "dist") -Destination $appRoot -Recurse

$vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
if (-not (Test-Path -LiteralPath $vswhere -PathType Leaf)) {
  Fail "Visual Studio Build Tools discovery is required for secure-scan-reader.exe"
}
$vsInstall = (& $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath).Trim()
$vsDevCmd = Join-Path $vsInstall "Common7\Tools\VsDevCmd.bat"
if ([string]::IsNullOrWhiteSpace($vsInstall) -or -not (Test-Path -LiteralPath $vsDevCmd -PathType Leaf)) {
  Fail "Visual Studio C++ x64 build tools are required for secure-scan-reader.exe"
}
$nativeRoot = Join-Path $appRoot "native"
$nativeSources = @(
  (Join-Path $agentRoot "native\secure-scan-reader.c"),
  (Join-Path $agentRoot "native\secure-scan-path.c"),
  (Join-Path $agentRoot "native\secure-scan-mutation.c")
)
$nativeExecutable = Join-Path $nativeRoot "secure-scan-reader.exe"
New-Item -ItemType Directory -Path $nativeRoot -Force | Out-Null
$compileScript = Join-Path $cacheRoot "compile-secure-scan-reader.cmd"
$quotedNativeSources = ($nativeSources | ForEach-Object { "`"$_`"" }) -join " "
$compileCommand = "cl.exe /nologo /TC /std:c11 /O2 /GS /guard:cf /MT /W4 /WX /Fe:`"$nativeExecutable`" $quotedNativeSources /link /Brepro /DYNAMICBASE /NXCOMPAT /guard:cf"
$compileLines = @(
  "@echo off",
  "call `"$vsDevCmd`" -no_logo -arch=x64 -host_arch=x64",
  "if errorlevel 1 exit /b %errorlevel%",
  $compileCommand,
  "exit /b %errorlevel%"
)
[System.IO.File]::WriteAllLines($compileScript, $compileLines, [System.Text.Encoding]::ASCII)
Invoke-Checked -Executable "$env:SystemRoot\System32\cmd.exe" -Arguments @("/d", "/c", $compileScript)
if (-not (Test-Path -LiteralPath $nativeExecutable -PathType Leaf)) {
  Fail "secure-scan-reader.exe compilation produced no executable"
}

$runtimePackage = Get-Content -Raw -Encoding UTF8 (Join-Path $agentRoot "package.json") | ConvertFrom-Json
$runtimePackage.PSObject.Properties.Remove("devDependencies")
$runtimePackage.dependencies.PSObject.Properties.Remove("node-windows")
[System.IO.File]::WriteAllText(
  (Join-Path $appRoot "package.json"),
  (($runtimePackage | ConvertTo-Json -Depth 10) + "`n"),
  [System.Text.UTF8Encoding]::new($false)
)

Copy-Item -LiteralPath $wrapperDownload -Destination (Join-Path $bootstrapRoot "aijobprintagent.exe")
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "bootstrap\aijobprintagent.xml") -Destination $bootstrapRoot
Copy-WindowsPowerShellScript `
  -Source (Join-Path $PSScriptRoot "provision\provision-installed-agent.ps1") `
  -Destination (Join-Path $provisionRoot "provision-installed-agent.ps1")
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "provision\provision-terminal.cmd") -Destination $provisionRoot
Copy-WindowsPowerShellScript `
  -Source (Join-Path $PSScriptRoot "provision\terminal-control-center.ps1") `
  -Destination (Join-Path $provisionRoot "terminal-control-center.ps1")
Copy-WindowsPowerShellScript `
  -Source (Join-Path $PSScriptRoot "provision\terminal-update-helper.ps1") `
  -Destination (Join-Path $provisionRoot "terminal-update-helper.ps1")
if (-not [string]::IsNullOrWhiteSpace($ManifestSignerPublicKeyPath) -or -not [string]::IsNullOrWhiteSpace($UpdatePublisher)) {
  if ([string]::IsNullOrWhiteSpace($ManifestSignerPublicKeyPath) -or [string]::IsNullOrWhiteSpace($UpdatePublisher)) {
    Fail "Online update release policy requires public key and publisher together"
  }
  & (Join-Path $PSScriptRoot "inject-update-policy.ps1") `
    -HelperPath (Join-Path $provisionRoot "terminal-update-helper.ps1") `
    -ControlCenterPath (Join-Path $provisionRoot "terminal-control-center.ps1") `
    -ManifestSignerPublicKeyPath $ManifestSignerPublicKeyPath `
    -Publisher $UpdatePublisher
  if ($LASTEXITCODE -ne 0) { Fail "Online update release policy injection failed" }
}
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "provision\launch-control-center.vbs") -Destination $provisionRoot
Copy-WindowsPowerShellScript `
  -Source (Join-Path $agentRoot "scripts\install-production-agent.ps1") `
  -Destination (Join-Path $provisionRoot "install-production-agent.ps1")
Copy-WindowsPowerShellScript `
  -Source (Join-Path $agentRoot "scripts\service-identity.ps1") `
  -Destination (Join-Path $provisionRoot "service-identity.ps1")
Copy-WindowsPowerShellScript `
  -Source (Join-Path $agentRoot "scripts\provisioning-origin-utils.ps1") `
  -Destination (Join-Path $provisionRoot "provisioning-origin-utils.ps1")
Copy-WindowsPowerShellScript `
  -Source (Join-Path $agentRoot "scripts\provisioning-runtime-security.ps1") `
  -Destination (Join-Path $provisionRoot "provisioning-runtime-security.ps1")

Remove-Item -LiteralPath $deployRoot -Recurse -Force
Remove-Item -LiteralPath $extractRoot -Recurse -Force

$sumatra = Get-ChildItem -LiteralPath (Join-Path $appRoot "node_modules\pdf-to-printer\dist") -Filter "SumatraPDF-*.exe" -File
if ($sumatra.Count -ne 1) {
  Fail "Expected exactly one SumatraPDF executable in the staged runtime"
}
Assert-Sha256 -Path $sumatra[0].FullName -Expected $inputs.sumatraPdf.sha256

$unexpectedExecutables = @(Get-ChildItem -Recurse -File -LiteralPath $stagingRoot -Filter "*.exe" | Where-Object {
  $_.FullName -notin @(
    (Join-Path $nodeRoot "node.exe"),
    (Join-Path $bootstrapRoot "aijobprintagent.exe"),
    $nativeExecutable,
    $sumatra[0].FullName
  )
})
if ($unexpectedExecutables.Count -gt 0) {
  Fail "Unexpected executable in staging: $($unexpectedExecutables[0].FullName)"
}
if (Test-Path -LiteralPath (Join-Path $appRoot "node_modules\node-windows")) {
  Fail "node-windows must not be present in the MSI runtime"
}

Push-Location $appRoot
try {
  Invoke-Checked -Executable (Join-Path $nodeRoot "node.exe") -Arguments @(
    "-e",
    "const Database=require('./node_modules/better-sqlite3'); const db=new Database(':memory:'); db.close();"
  )
} finally {
  Pop-Location
}

$gitCommit = (& git -C $repoRoot rev-parse HEAD).Trim()
$gitCommitTime = (& git -C $repoRoot show -s --format=%cI HEAD).Trim()
$manifestFiles = @(Get-ChildItem -Recurse -File -LiteralPath $stagingRoot | Sort-Object FullName | ForEach-Object {
  [ordered]@{
    path = $_.FullName.Substring($stagingRoot.TrimEnd("\").Length + 1).Replace("\", "/")
    size = $_.Length
    sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash
  }
})
$manifest = [ordered]@{
  schemaVersion = 1
  productVersion = $inputs.productVersion
  gitCommit = $gitCommit
  nodeVersion = $inputs.node.version
  serviceWrapperVersion = $inputs.serviceWrapper.version
  sourceCommitTime = $gitCommitTime
  files = $manifestFiles
}
[System.IO.File]::WriteAllText(
  (Join-Path $stagingRoot "manifest.json"),
  (($manifest | ConvertTo-Json -Depth 10) + "`n"),
  [System.Text.UTF8Encoding]::new($false)
)

Write-Host "STAGING_READY path=$stagingRoot files=$($manifestFiles.Count)"
Write-Warning "The staged WinSW wrapper and resulting MSI are unsigned candidates. Do not release them to production."
