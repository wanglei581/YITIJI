import { IMAGE_SOURCE } from './image-source'
import { ESTIMATOR_SOURCE } from './estimator-source'
import { THRESHOLDS_SOURCE } from './thresholds-source'

function limit(name: string): number {
  const value = THRESHOLDS_SOURCE.match(new RegExp(`\\b${name} = ([0-9.]+)`))?.[1]
  if (!value) throw new Error('deskew threshold missing')
  return Number(value)
}
export const DESKEW_TIMEOUT_MS = limit('TimeoutMs')
export const DESKEW_MIN_ANGLE = limit('MinAngle')
export const DESKEW_MAX_ANGLE = limit('MaxAngle') - limit('BoundaryMargin')
export const DESKEW_SOURCE = IMAGE_SOURCE.replace('using System;', 'using System;\nusing System.Collections.Generic;')
  + ESTIMATOR_SOURCE.replace(/^using .*;$/gm, '') + THRESHOLDS_SOURCE

/** Paths are opaque base64 data, never PowerShell syntax. No user filename is interpolated. */
export function buildDeskewScript(runDir: string, extension: '.jpg' | '.png' | '.bmp'): string {
  const data = Buffer.from(JSON.stringify({ runDir, extension }), 'utf8').toString('base64')
  return String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$OutputEncoding = [Console]::OutputEncoding
$p = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${data}')) | ConvertFrom-Json
$run = [IO.Path]::GetFullPath($p.runDir)
$inputFile = Join-Path $run ('input' + $p.extension)
$outputFile = Join-Path $run $(if ($p.extension -eq '.png') { 'output.png' } else { 'output.jpg' })
$resultFile = Join-Path $run 'result.json'
try {
    $task = Split-Path -Parent $run
    $root = Split-Path -Parent $task
    $expected = Join-Path $env:ProgramData 'AIJobPrintAgent\scan-device'
    if ($root -ine [IO.Path]::GetFullPath($expected) -or (Split-Path -Leaf $task) -notmatch '^[A-Za-z0-9_-]{1,64}$' -or
        (Split-Path -Leaf $run) -notmatch '^deskew-[A-Za-z0-9]+$' -or @('.jpg','.png','.bmp') -notcontains $p.extension) { throw 'private_directory' }
    foreach ($dir in @($root,$task,$run)) {
        $item = Get-Item -LiteralPath $dir -Force
        if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'private_directory' }
        $acl = Get-Acl -LiteralPath $dir
        foreach ($rule in $acl.Access) {
            if ($rule.AccessControlType -ne [Security.AccessControl.AccessControlType]::Allow) { continue }
            $sid = $rule.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value
            if (@('S-1-5-18','S-1-5-32-544') -notcontains $sid) { throw 'private_acl' }
        }
    }
    $item = Get-Item -LiteralPath $inputFile -Force
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'input' }
    $sourceFile = Join-Path $run 'processor.cs'
    $item = Get-Item -LiteralPath $sourceFile -Force
    if ($item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'source' }
    $source = [IO.File]::ReadAllText($sourceFile, [Text.Encoding]::UTF8)
    Add-Type -TypeDefinition $source -ReferencedAssemblies System.Drawing
    $result = [ScanDeskew.ImageProcessor]::Process($inputFile, $outputFile)
    if (-not $result.Corrected) { exit 0 }
    $file = Get-Item -LiteralPath $outputFile
    if ($file.Length -le 0) { throw 'empty' }
    $hash = (Get-FileHash -LiteralPath $outputFile -Algorithm SHA256).Hash.ToLowerInvariant()
    $json = @{ corrected = $true; angleDeg = $result.AngleDeg; size = $file.Length; sha256 = $hash } | ConvertTo-Json -Compress
    [IO.File]::WriteAllText($resultFile, $json, (New-Object Text.UTF8Encoding($false)))
    exit 0
} catch {
    Remove-Item -LiteralPath $outputFile,$resultFile -Force -ErrorAction SilentlyContinue
    exit 1
}
`
}

export function deskewCommand(script: string): string[] {
  return ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]
}
