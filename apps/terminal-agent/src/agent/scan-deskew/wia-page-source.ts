/** WIA keeps the original COM image alive. Only the isolated worker decodes/rotates it. */
import { DESKEW_TIMEOUT_MS, DESKEW_MIN_ANGLE, DESKEW_MAX_ANGLE } from './script'

export const WIA_DESKEW_PAGE_SOURCE = String.raw`
function StopDeskewWorker($child) {
  if ($null -eq $child) { return }
  try {
    if ($child.HasExited) { return }
    $kill = New-Object System.Diagnostics.ProcessStartInfo
    $kill.FileName = Join-Path $env:SystemRoot 'System32\taskkill.exe'
    $kill.Arguments = '/PID ' + $child.Id + ' /T /F'
    $kill.UseShellExecute = $false
    $kill.CreateNoWindow = $true
    $kill.RedirectStandardOutput = $true
    $kill.RedirectStandardError = $true
    $killer = [Diagnostics.Process]::Start($kill)
    try {
      $null = $killer.StandardOutput.ReadToEndAsync()
      $null = $killer.StandardError.ReadToEndAsync()
      if (-not $killer.WaitForExit(1000)) { $killer.Kill() }
      [void]$child.WaitForExit(1000)
    } finally { $killer.Dispose() }
  } catch { }
}

function AssertDeskewFile([string]$file, [long]$max) {
  $item = Get-Item -LiteralPath $file -Force
  if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -or
      $item.Length -le 0 -or $item.Length -gt $max) { throw 'output' }
  return $item.Length
}

function SaveDeskewWiaPage($img, [string]$dest) {
  $run = Join-Path $OutDir ($DeskewRunPrefix + [Guid]::NewGuid().ToString('N'))
  $inputFile = Join-Path $run 'input.bmp'
  $outputFile = Join-Path $run 'output.jpg'
  $child = $null
  $corrected = $false
  $angle = $null
  try {
    try {
      $null = New-Item -ItemType Directory -Path $run
      $img.SaveFile($inputFile)
      Copy-Item -LiteralPath (Join-Path $DeskewAssets 'processor.cs') -Destination (Join-Path $run 'processor.cs')
      $data = @{ runDir = $run; extension = '.bmp' } | ConvertTo-Json -Compress
      $data = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($data))
      $worker = [IO.File]::ReadAllText((Join-Path $DeskewAssets 'worker.txt')).Replace('WIA_DESKEW_DATA', $data)
      $start = New-Object Diagnostics.ProcessStartInfo
      $start.FileName = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
      $start.Arguments = '-NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand ' + [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($worker))
      $start.UseShellExecute = $false
      $start.CreateNoWindow = $true
      $start.RedirectStandardOutput = $true
      $start.RedirectStandardError = $true
      $watch = [Diagnostics.Stopwatch]::StartNew()
      $child = [Diagnostics.Process]::Start($start)
      $null = $child.StandardOutput.ReadToEndAsync()
      $null = $child.StandardError.ReadToEndAsync()
      while (-not $child.HasExited) {
        if ($watch.ElapsedMilliseconds -ge ${DESKEW_TIMEOUT_MS} -or (Test-Path -LiteralPath $CancelFlag)) { throw 'stop' }
        [void]$child.WaitForExit([int][Math]::Max(1, [Math]::Min(20, ${DESKEW_TIMEOUT_MS} - $watch.ElapsedMilliseconds)))
      }
      if ($watch.ElapsedMilliseconds -ge ${DESKEW_TIMEOUT_MS} -or $child.ExitCode -ne 0 -or (Test-Path -LiteralPath $CancelFlag)) { throw 'worker' }
      $manifestFile = Join-Path $run 'result.json'
      $null = AssertDeskewFile $manifestFile 1024
      $manifest = [IO.File]::ReadAllText($manifestFile) | ConvertFrom-Json
      $length = AssertDeskewFile $outputFile 104857600
      $bytes = [IO.File]::ReadAllBytes($outputFile)
      $candidateAngle = [double]$manifest.angleDeg
      if ($manifest.corrected -ne $true -or $manifest.angleDeg -isnot [ValueType] -or
          [double]::IsNaN($candidateAngle) -or [double]::IsInfinity($candidateAngle) -or
          [Math]::Abs($candidateAngle) -lt ${DESKEW_MIN_ANGLE} -or [Math]::Abs($candidateAngle) -gt ${DESKEW_MAX_ANGLE} -or
          $manifest.size -ne $length -or $bytes.Length -lt 5 -or
          $bytes[0] -ne 255 -or $bytes[1] -ne 216 -or $bytes[2] -ne 255 -or
          $bytes[$bytes.Length - 2] -ne 255 -or $bytes[$bytes.Length - 1] -ne 217 -or
          $manifest.sha256 -cne (Get-FileHash -LiteralPath $outputFile -Algorithm SHA256).Hash.ToLowerInvariant()) { throw 'output' }
      Copy-Item -LiteralPath $outputFile -Destination $dest -Force
      $null = AssertDeskewFile $dest 104857600
      $script:via = 'deskew'
      $corrected = $true
      $angle = $candidateAngle
    } catch {
      StopDeskewWorker $child
      SaveJpeg $img $dest
    }
    if (-not (Test-Path -LiteralPath $dest -PathType Leaf) -or (Get-Item -LiteralPath $dest).Length -le 0) { throw 'empty' }
  } finally {
    StopDeskewWorker $child
    if ($null -ne $child) { $child.Dispose() }
    Remove-Item -LiteralPath $inputFile,$outputFile -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $run -Recurse -Force -ErrorAction SilentlyContinue
    $angleText = 'null'
    if ($null -ne $angle) { $angleText = $angle.ToString([Globalization.CultureInfo]::InvariantCulture) }
    $correctedText = 'false'
    if ($corrected) { $correctedText = 'true' }
    Emit ('{"angleDeg":' + $angleText + ',"corrected":' + $correctedText + '}')
  }
}
`;
