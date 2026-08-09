[CmdletBinding()]
param([Parameter(Mandatory = $true)][string]$InstallRoot)

$ErrorActionPreference = "Stop"
$resolvedRoot = (Resolve-Path -LiteralPath $InstallRoot).Path
$nodePath = Join-Path $resolvedRoot "node\node.exe"
$modulePath = Join-Path $resolvedRoot "app\dist\agent\scan-input\windows-secure-reader.js"
$helperPath = Join-Path $resolvedRoot "app\native\secure-scan-reader.exe"
foreach ($required in @($nodePath, $modulePath, $helperPath)) {
  if (-not (Test-Path -LiteralPath $required -PathType Leaf)) {
    throw "Secure scan-reader verification input is missing: $(Split-Path -Leaf $required)"
  }
}

$probeScript = @'
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const modulePath = process.argv[1]
const request = JSON.parse(fs.readFileSync(0, 'utf8').replace(/^\uFEFF/, ''))
const secure = require(modulePath)
let result
if (request.mode === 'inspect') {
  result = secure.inspectTrustedWindowsScanInputFolder(request.root)
} else if (request.mode === 'read') {
  let expected = request.expected
  if (!expected) {
    const stat = fs.lstatSync(path.join(request.root, request.filename))
    expected = { name: request.filename, nodeKind: 'file', size: stat.size, mtimeMs: stat.mtimeMs }
  }
  try {
    const bytes = secure.readTrustedWindowsCandidate(request.root, request.filename, expected)
    result = { accepted: true, length: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') }
  } catch {
    result = { accepted: false }
  }
} else if (request.mode === 'result-gate') {
  const base = { pid: 1, output: [null, Buffer.from('ok'), Buffer.alloc(0)], stdout: Buffer.from('ok'), stderr: Buffer.alloc(0), status: 0, signal: null }
  result = {
    exact: secure.isAcceptedTrustedHelperResult(base, 2),
    nonzeroRejected: !secure.isAcceptedTrustedHelperResult({ ...base, status: 93 }, 2),
    timeoutRejected: !secure.isAcceptedTrustedHelperResult({ ...base, signal: 'SIGTERM' }, 2),
    spawnFailureRejected: !secure.isAcceptedTrustedHelperResult({ ...base, error: new Error('fixture') }, 2),
    overflowRejected: !secure.isAcceptedTrustedHelperResult({ ...base, stdout: Buffer.alloc(3) }, 2),
    stderrRejected: !secure.isAcceptedTrustedHelperResult({ ...base, stderr: Buffer.from('SCAN_READER_E999\n') }, 2),
  }
} else {
  throw new Error('unknown probe mode')
}
process.stdout.write(JSON.stringify(result))
'@

function Invoke-Probe([hashtable]$Request) {
  $inputJson = $Request | ConvertTo-Json -Compress -Depth 5
  $temporaryInput = Join-Path $temporaryRoot ("probe-" + [Guid]::NewGuid().ToString("N") + ".json")
  [System.IO.File]::WriteAllText($temporaryInput, $inputJson, [System.Text.UTF8Encoding]::new($false))
  try {
    $output = Get-Content -Raw -Encoding UTF8 -LiteralPath $temporaryInput | & $nodePath -e $probeScript $modulePath
    if ($LASTEXITCODE -ne 0) { throw "Packaged Node secure-reader probe failed with exit code $LASTEXITCODE" }
    return ($output | ConvertFrom-Json)
  } finally {
    Remove-Item -LiteralPath $temporaryInput -Force -ErrorAction SilentlyContinue
  }
}

function New-Junction([string]$Path, [string]$Target) {
  $command = "mklink /J `"$Path`" `"$Target`" >nul"
  & "$env:SystemRoot\System32\cmd.exe" /d /c $command
  if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $Path -PathType Container)) {
    throw "Failed to create junction fixture"
  }
}

function Remove-Link([string]$Path) {
  if (Test-Path -LiteralPath $Path) {
    $item = Get-Item -LiteralPath $Path -Force
    if (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -eq 0) {
      return
    }
    & "$env:SystemRoot\System32\cmd.exe" /d /c "rmdir `"$Path`""
    if ($LASTEXITCODE -ne 0) { throw "Failed to remove reparse fixture" }
  }
}

function Assert-Degraded([object]$Health, [string]$Label) {
  if ([string]$Health.status -ne "degraded" -or [string]$Health.reason -ne "reparse_point_unverifiable") {
    throw "$Label must fail closed; got $($Health | ConvertTo-Json -Compress)"
  }
}

$temporaryRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("secure-scan-reader-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $temporaryRoot | Out-Null
try {
  $scanRoot = Join-Path $temporaryRoot "ordinary-scan"
  New-Item -ItemType Directory -Path $scanRoot | Out-Null
  $ordinaryFile = Join-Path $scanRoot "ordinary.pdf"
  [System.IO.File]::WriteAllBytes($ordinaryFile, [System.Text.Encoding]::ASCII.GetBytes("%PDF-1.4 secure reader ordinary control"))

  $ordinaryHealth = Invoke-Probe @{ mode = "inspect"; root = $scanRoot }
  if ([string]$ordinaryHealth.status -ne "ready") { throw "Ordinary Windows directory did not become ready" }
  $ordinaryRead = Invoke-Probe @{ mode = "read"; root = $scanRoot; filename = "ordinary.pdf" }
  if (-not [bool]$ordinaryRead.accepted -or [int]$ordinaryRead.length -ne (Get-Item -LiteralPath $ordinaryFile).Length) {
    throw "Ordinary Windows candidate did not pass the same-handle reader"
  }

  $resultGate = Invoke-Probe @{ mode = "result-gate" }
  foreach ($property in @("exact", "nonzeroRejected", "timeoutRejected", "spawnFailureRejected", "overflowRejected", "stderrRejected")) {
    if (-not [bool]$resultGate.$property) { throw "Node helper result gate failed: $property" }
  }

  $junctionTarget = Join-Path $temporaryRoot "junction-target"
  $junctionRoot = Join-Path $temporaryRoot "junction-root"
  New-Item -ItemType Directory -Path $junctionTarget | Out-Null
  New-Junction -Path $junctionRoot -Target $junctionTarget
  Assert-Degraded (Invoke-Probe @{ mode = "inspect"; root = $junctionRoot }) "Root junction"
  Remove-Link $junctionRoot

  $symlinkTarget = Join-Path $temporaryRoot "symlink-target"
  $symlinkRoot = Join-Path $temporaryRoot "symlink-root"
  New-Item -ItemType Directory -Path $symlinkTarget | Out-Null
  New-Item -ItemType SymbolicLink -Path $symlinkRoot -Target $symlinkTarget -ErrorAction Stop | Out-Null
  Assert-Degraded (Invoke-Probe @{ mode = "inspect"; root = $symlinkRoot }) "Root symbolic link"
  Remove-Link $symlinkRoot

  $realParent = Join-Path $temporaryRoot "real-parent"
  $realChild = Join-Path $realParent "scan"
  $ancestorJunction = Join-Path $temporaryRoot "ancestor-junction"
  New-Item -ItemType Directory -Path $realChild -Force | Out-Null
  New-Junction -Path $ancestorJunction -Target $realParent
  Assert-Degraded (Invoke-Probe @{ mode = "inspect"; root = (Join-Path $ancestorJunction "scan") }) "Ancestor junction"
  Remove-Link $ancestorJunction

  $outsideFile = Join-Path $temporaryRoot "outside.pdf"
  [System.IO.File]::WriteAllBytes($outsideFile, [System.Text.Encoding]::ASCII.GetBytes("%PDF-1.4 outside secret"))
  $candidateLink = Join-Path $scanRoot "candidate-link.pdf"
  New-Item -ItemType SymbolicLink -Path $candidateLink -Target $outsideFile -ErrorAction Stop | Out-Null
  $linkedRead = Invoke-Probe @{ mode = "read"; root = $scanRoot; filename = "candidate-link.pdf" }
  if ([bool]$linkedRead.accepted) { throw "Candidate symbolic link reached trusted output" }
  Remove-Item -LiteralPath $candidateLink -Force

  $hardlink = Join-Path $scanRoot "candidate-hardlink.pdf"
  New-Item -ItemType HardLink -Path $hardlink -Target $outsideFile -ErrorAction Stop | Out-Null
  $hardlinkRead = Invoke-Probe @{ mode = "read"; root = $scanRoot; filename = "candidate-hardlink.pdf" }
  if ([bool]$hardlinkRead.accepted) { throw "Candidate hard link reached trusted output" }
  Remove-Item -LiteralPath $hardlink -Force

  $swapFile = Join-Path $scanRoot "candidate-swap.pdf"
  [System.IO.File]::WriteAllBytes($swapFile, [System.Text.Encoding]::ASCII.GetBytes("%PDF-1.4 initial candidate"))
  $swapStat = Get-Item -LiteralPath $swapFile
  $swapMtimeMs = ([DateTimeOffset]$swapStat.LastWriteTimeUtc).ToUnixTimeMilliseconds()
  $swapExpected = @{ name = "candidate-swap.pdf"; nodeKind = "file"; size = $swapStat.Length; mtimeMs = $swapMtimeMs }
  Remove-Item -LiteralPath $swapFile -Force
  New-Item -ItemType SymbolicLink -Path $swapFile -Target $outsideFile -ErrorAction Stop | Out-Null
  $candidateSwapRead = Invoke-Probe @{ mode = "read"; root = $scanRoot; filename = "candidate-swap.pdf"; expected = $swapExpected }
  if ([bool]$candidateSwapRead.accepted) { throw "Inspect-to-read candidate swap reached trusted output" }
  Remove-Item -LiteralPath $swapFile -Force

  $rootSwapOriginal = Join-Path $temporaryRoot "root-swap-original"
  $rootSwapOutside = Join-Path $temporaryRoot "root-swap-outside"
  Rename-Item -LiteralPath $scanRoot -NewName (Split-Path -Leaf $rootSwapOriginal)
  New-Item -ItemType Directory -Path $rootSwapOutside | Out-Null
  Copy-Item -LiteralPath $ordinaryFile.Replace($scanRoot, $rootSwapOriginal) -Destination (Join-Path $rootSwapOutside "ordinary.pdf")
  New-Junction -Path $scanRoot -Target $rootSwapOutside
  $rootSwapRead = Invoke-Probe @{ mode = "read"; root = $scanRoot; filename = "ordinary.pdf" }
  if ([bool]$rootSwapRead.accepted) { throw "Inspect-to-read root junction swap reached trusted output" }
  Remove-Link $scanRoot

  Move-Item -LiteralPath $helperPath -Destination "$helperPath.disabled"
  try {
    Assert-Degraded (Invoke-Probe @{ mode = "inspect"; root = $rootSwapOriginal }) "Missing helper"
  } finally {
    Move-Item -LiteralPath "$helperPath.disabled" -Destination $helperPath
  }

  Write-Host "SECURE_SCAN_READER_PASS ordinary=true rootReparse=true ancestorReparse=true candidateReparse=true hardlink=true toctou=true helperFailures=true"
} finally {
  foreach ($link in @($junctionRoot, $symlinkRoot, $ancestorJunction, $scanRoot)) {
    if ($null -ne $link) { Remove-Link $link }
  }
  Remove-Item -LiteralPath $temporaryRoot -Recurse -Force -ErrorAction SilentlyContinue
}
