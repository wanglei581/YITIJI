/** Windows PS5.1 only. Execute the generated per-page block with a synthetic BMP, no WIA device. */
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { prepareWiaDeskew } from '../src/agent/scan-deskew/wia-integration'
import { buildWiaScanScript } from '../src/agent/scan-device/wia-script'

assert.equal(process.platform, 'win32', 'Windows-only gate')
// GitHub Windows 机器的 os.tmpdir() 是 8.3 短名（C:\Users\RUNNER~1\…），`~` 过不了 wia-script 的 PowerShell 路径白名单；
// realpathSync.native 会展开成长路径（11/08 手动运行 42463532610 就红在这里：参数 outDir 不在白名单内）。
const temporary = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'wia-wiring-')))
assert.match(temporary, /^[A-Za-z0-9 _.:\\/()-]{1,200}$/, `临时目录要能过 PowerShell 路径白名单：${temporary}`)
const programData = path.join(temporary, 'programdata')
const root = path.join(programData, 'AIJobPrintAgent', 'scan-device')
const taskDir = path.join(root, 'synthetic')
fs.mkdirSync(taskDir, { recursive: true })
const script = buildWiaScanScript({ deviceName: '', source: 'flatbed', color: 'gray', dpi: 300, maxPages: 1,
  startIndex: 1, outDir: taskDir, cancelFlagPath: path.join(taskDir, 'cancel.flag') }, { root })
const wired = prepareWiaDeskew(script, { enabled: true, taskDir, root })
assert.notEqual(wired.script, script)
const assets = path.join(taskDir, fs.readdirSync(taskDir)[0]!)
const prefix = path.basename(assets).replace(/assets$/, '')
const originalWorker = fs.readFileSync(path.join(assets, 'worker.txt'), 'utf8')
const saveJpeg = script.slice(script.indexOf('function SaveJpeg('), script.indexOf('\n$n = 0'))
  .replace('function SaveJpeg(', 'function SaveOriginalJpeg(')
const pageBlock = wired.script.slice(wired.script.indexOf("    $name = 'page-'"), wired.script.indexOf('    $idx++') + '    $idx++'.length)
const workerPrefix = String.raw`
$ErrorActionPreference = 'Stop'
$p = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('WIA_DESKEW_DATA')) | ConvertFrom-Json
$run = $p.runDir
$task = Split-Path -Parent $run
$output = Join-Path $run 'output.jpg'
$result = Join-Path $run 'result.json'
`
const good = String.raw`
[IO.File]::Copy((Join-Path $task 'corrected.jpg'), $output)
$hash = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant()
$manifest = @{ corrected = $true; angleDeg = 1; size = (Get-Item -LiteralPath $output).Length; sha256 = $hash }
`
const publish = String.raw`
[IO.File]::WriteAllText($result, ($manifest | ConvertTo-Json -Compress))
exit 0
`
const variants: Record<string, string> = {
  success: good + publish,
  nonzero: good + publish.replace('exit 0', 'exit 9'),
  missing: 'exit 0',
  malformed: good + "[IO.File]::WriteAllText($result, '{'); exit 0",
  corrupt: good + "[IO.File]::WriteAllText($output, 'damaged'); $manifest.size = 7; $manifest.sha256 = (Get-FileHash -LiteralPath $output -Algorithm SHA256).Hash.ToLowerInvariant()\n" + publish,
  hash: good + "$manifest.sha256 = 'wrong'\n" + publish,
  empty: good + "[IO.File]::WriteAllBytes($output, [byte[]]@()); $manifest.size = 0\n" + publish,
  angle: good + "$manifest.angleDeg = 90\n" + publish,
  timeout: String.raw`
$descendant = Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe') -ArgumentList '-NoProfile -NonInteractive -Command Start-Sleep -Seconds 60' -WindowStyle Hidden -PassThru
[IO.File]::WriteAllText((Join-Path $task 'descendant.pid'), [string]$descendant.Id)
[IO.File]::WriteAllText((Join-Path $task 'worker.pid'), [string]$PID)
Start-Sleep -Seconds 60
`,
  cancel: "[IO.File]::WriteAllText((Join-Path $task 'cancel.flag'), '1'); Start-Sleep -Seconds 60",
  bmpFailure: good + publish,
}
for (const [name, body] of Object.entries(variants)) fs.writeFileSync(path.join(assets, `${name}.txt`), workerPrefix + body)
fs.writeFileSync(path.join(assets, 'real.txt'), originalWorker)
fs.writeFileSync(path.join(assets, 'save.ps1'), saveJpeg)
fs.writeFileSync(path.join(assets, 'page-block.ps1'), pageBlock)
const data = Buffer.from(JSON.stringify({ assets, taskDir, root, prefix }), 'utf8').toString('base64')
const driver = String.raw`
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSEdition -ne 'Desktop' -or $PSVersionTable.PSVersion.Major -ne 5) { throw 'PS5.1 required' }
$p = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('DRIVER_DATA')) | ConvertFrom-Json
$OutDir = $p.taskDir
$DeskewAssets = $p.assets
$DeskewRunPrefix = $p.prefix
$CancelFlag = Join-Path $OutDir 'cancel.flag'
$JpegQuality = 75
$hostPid = $PID
function Require($ok, [string]$message) { if (-not $ok) { throw $message } }
# Production worker checks inherited SYSTEM/Administrators ACLs, including the task and asset directory.
foreach ($dir in @($p.root, $OutDir, $DeskewAssets)) {
  $acl = New-Object Security.AccessControl.DirectorySecurity
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($sid in @('S-1-5-18','S-1-5-32-544')) {
    $identity = New-Object Security.Principal.SecurityIdentifier($sid)
    $rule = New-Object Security.AccessControl.FileSystemAccessRule($identity, 'FullControl', 'ContainerInherit,ObjectInherit', 'None', 'Allow')
    $acl.AddAccessRule($rule)
  }
  Set-Acl -LiteralPath $dir -AclObject $acl
}
Add-Type -AssemblyName System.Drawing
$fixture = Join-Path $OutDir 'fixture.bmp'
$bitmap = New-Object Drawing.Bitmap(400,500)
$g = [Drawing.Graphics]::FromImage($bitmap)
try { $g.Clear([Drawing.Color]::White); $bitmap.Save($fixture, [Drawing.Imaging.ImageFormat]::Bmp) }
finally { $g.Dispose(); $bitmap.Dispose() }
$bitmap = New-Object Drawing.Bitmap(500,600)
$g = [Drawing.Graphics]::FromImage($bitmap)
try { $g.Clear([Drawing.Color]::LightYellow); $bitmap.Save((Join-Path $OutDir 'corrected.jpg'), [Drawing.Imaging.ImageFormat]::Jpeg) }
finally { $g.Dispose(); $bitmap.Dispose() }
$img = [PSCustomObject]@{ SourceFile = $fixture; FileExtension = 'bmp'; FailSave = $false }
$img | Add-Member -MemberType ScriptMethod -Name SaveFile -Value {
  param($dest)
  if ($this.FailSave -and $dest.EndsWith('input.bmp')) { throw 'injected BMP failure' }
  [IO.File]::Copy($this.SourceFile, $dest)
}
. (Join-Path $DeskewAssets 'save.ps1')
$script:fallbacks = 0
function SaveJpeg($image, [string]$dest) { $script:fallbacks++; SaveOriginalJpeg $image $dest }
function Fail([string]$code, [string]$hresult, [int]$pages) { throw 'page failed' }
function HResultOf($errorRecord) { return '' }
$baseline = Join-Path $OutDir 'baseline.jpg'
SaveOriginalJpeg $img $baseline
$originalHash = (Get-FileHash -LiteralPath $baseline -Algorithm SHA256).Hash
$correctedHash = (Get-FileHash -LiteralPath (Join-Path $OutDir 'corrected.jpg') -Algorithm SHA256).Hash
Require ($originalHash -ne $correctedHash) 'positive control must differ'
$script:events = New-Object Collections.ArrayList
function Emit([string]$line) {
  $record = $line | ConvertFrom-Json
  if ($null -ne $record.page) {
    $runs = @(Get-ChildItem -LiteralPath $OutDir -Directory | Where-Object { $_.Name.StartsWith($DeskewRunPrefix) -and $_.FullName -ne $DeskewAssets })
    Require ($runs.Count -eq 0) 'notify before intermediate cleanup'
    Require ((Get-Item -LiteralPath (Join-Path $OutDir $record.file)).Length -gt 0) 'notify empty file'
  } else {
    Require ((@($record.PSObject.Properties.Name | Sort-Object) -join ',') -eq 'angleDeg,corrected') 'private log fields'
  }
  [void]$script:events.Add($record)
}
$page = [ScriptBlock]::Create([IO.File]::ReadAllText((Join-Path $DeskewAssets 'page-block.ps1')))
foreach ($case in @('success','nonzero','missing','malformed','corrupt','hash','empty','angle','timeout','cancel','bmpFailure','real')) {
  Copy-Item -LiteralPath (Join-Path $DeskewAssets ($case + '.txt')) -Destination (Join-Path $DeskewAssets 'worker.txt') -Force
  $img.FailSave = $case -eq 'bmpFailure'
  $script:events.Clear(); $script:fallbacks = 0
  $n = 0; $idx = 1
  $watch = [Diagnostics.Stopwatch]::StartNew()
  & $page
  Require ($PID -eq $hostPid -and $null -ne (Get-Process -Id $hostPid)) 'WIA host killed'
  Require ($watch.ElapsedMilliseconds -lt 5000) 'worker not bounded'
  Require ($script:events.Count -eq 2) ('missing deskew/page events: ' + $case)
  Require ($script:events[1].page -eq 1) 'page order'
  Require ($script:events[0].corrected -eq ($case -eq 'success')) ('wrong decision: ' + $case)
  Require ($script:fallbacks -eq $(if ($case -eq 'success') { 0 } else { 1 })) ('fallback count: ' + $case)
  $hash = (Get-FileHash -LiteralPath (Join-Path $OutDir 'page-001.jpg') -Algorithm SHA256).Hash
  Require ($hash -eq $(if ($case -eq 'success') { $correctedHash } else { $originalHash })) ('wrong final bytes: ' + $case)
  if ($case -eq 'timeout') {
    foreach ($name in @('worker.pid','descendant.pid')) {
      Require (Test-Path -LiteralPath (Join-Path $OutDir $name)) 'timeout child did not start'
      $childId = [int][IO.File]::ReadAllText((Join-Path $OutDir $name))
      Require ($null -eq (Get-Process -Id $childId -ErrorAction SilentlyContinue)) 'descendant survived timeout'
    }
  }
  Remove-Item -LiteralPath $CancelFlag -Force -ErrorAction SilentlyContinue
  Write-Output ('PASS WIA synthetic page ' + $case)
}
Write-Output 'PASS WIA wired page Windows PS5.1: 12 cases, no real WIA'
`.replace('DRIVER_DATA', data)
const driverPath = path.join(assets, 'driver.ps1')
fs.writeFileSync(driverPath, driver)
try {
  const powershell = path.win32.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  const result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', driverPath], {
    encoding: 'utf8', env: { ...process.env, ProgramData: programData }, timeout: 60000, windowsHide: true,
  })
  process.stdout.write(result.stdout ?? ''); process.stderr.write(result.stderr ?? '')
  assert.ifError(result.error)
  assert.equal(result.status, 0)
  assert.ok(result.stdout.includes('PASS WIA wired page Windows PS5.1: 12 cases, no real WIA'), 'all cases must complete')
} finally { wired.cleanup(); fs.rmSync(temporary, { recursive: true, force: true }) }
