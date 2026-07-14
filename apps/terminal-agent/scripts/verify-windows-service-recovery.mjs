import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const agentRoot = path.resolve(__dirname, '..')
const installerPath = path.join(__dirname, 'install-production-agent.ps1')
const diagnosisPath = path.join(__dirname, 'diagnose-production-agent.ps1')

const installer = fs.readFileSync(installerPath, 'utf8')
const diagnosis = fs.readFileSync(diagnosisPath, 'utf8')

function sourceBetween(source, startPattern, endPattern) {
  const start = source.search(startPattern)
  assert.notEqual(start, -1, `missing ${startPattern}`)
  const end = source.slice(start).search(endPattern)
  assert.notEqual(end, -1, `missing ${endPattern} after ${startPattern}`)
  return source.slice(start, start + end)
}

function assertIncludes(source, expected, message) {
  assert.ok(source.includes(expected), message)
}

console.log('\n=== verify terminal-agent Windows service recovery ===')

const generatedConfig = sourceBetween(
  installer,
  /function Test-GeneratedConfig\(/,
  /\nfunction /,
)
assert.match(
  generatedConfig,
  /\[System\.Collections\.IDictionary\]\$Config/,
  'Test-GeneratedConfig must accept an IDictionary',
)
for (const field of ['apiBaseUrl', 'terminalCode', 'terminalId', 'printerName', 'agentVersion']) {
  assertIncludes(generatedConfig, field, `Test-GeneratedConfig must include ${field} in its required field checks`)
}
for (const field of ['heartbeatIntervalMs', 'claimIntervalMs', 'localApiPort']) {
  assertIncludes(generatedConfig, field, `Test-GeneratedConfig must include ${field} in its positive integer checks`)
}
assert.match(generatedConfig, /ConvertTo-Json/, 'Test-GeneratedConfig must serialize generated config')
assert.match(generatedConfig, /ConvertFrom-Json/, 'Test-GeneratedConfig must parse generated config')
assert.match(generatedConfig, /Fail /, 'Test-GeneratedConfig must use the installer failure path')

const configValidationCall = installer.indexOf('Test-GeneratedConfig -Config $config')
const configBackup = installer.indexOf('Copy-Item $configPath $backup -Force')
const configWrite = installer.indexOf('Write-TextAtomically -Path $configPath -Text ($configJson + "`n")')
const bindCodeExchange = installer.indexOf('Exchange-BindCode -ApiBase $apiBase -Code $BindCode')
const tokenWrite = installer.indexOf('Protect-AgentToken -Token')
const processStop = installer.indexOf('Stop-Process -Id $p.ProcessId')
const serviceStart = installer.indexOf('Start-Service -Name "AIJobPrintAgent"')
const serviceRestart = installer.indexOf('Restart-Service -Name "AIJobPrintAgent" -Force')
assert.notEqual(configValidationCall, -1, 'installer must validate the generated config')
for (const [label, index] of [
  ['config backup', configBackup],
  ['config write', configWrite],
  ['BindCode exchange', bindCodeExchange],
  ['token write', tokenWrite],
  ['stale process stop', processStop],
  ['service start', serviceStart],
  ['service restart', serviceRestart],
]) {
  assert.notEqual(index, -1, `installer must retain ${label}`)
  assert.ok(configValidationCall < index, `generated config validation must happen before ${label}`)
}

const atomicConfigWriter = sourceBetween(installer, /function Write-TextAtomically\(/, /\nfunction /)
assert.match(atomicConfigWriter, /UTF8Encoding\]::new\(\$false\)/, 'config atomic writer must use UTF-8 without a BOM')
assert.match(atomicConfigWriter, /FileStream/, 'config atomic writer must use FileStream')
assert.match(atomicConfigWriter, /CreateNew/, 'config atomic writer must create its temporary file exclusively')
assert.match(atomicConfigWriter, /\.GetBytes\(/, 'config atomic writer must encode the complete text before writing')
assert.match(atomicConfigWriter, /\.Write\(/, 'config atomic writer must write encoded bytes')
assert.match(atomicConfigWriter, /\.Flush\(\$true\)/, 'config atomic writer must flush file content to disk')
assert.match(atomicConfigWriter, /File\]::Replace/, 'config atomic writer must replace an existing config atomically')
assert.match(atomicConfigWriter, /File\]::Move/, 'config atomic writer must move a new config into place atomically')
assert.match(atomicConfigWriter, /finally/, 'config atomic writer must clean up temporary files')
assert.match(atomicConfigWriter, /Remove-Item\s+-LiteralPath\s+\$tempPath\s+-Force/, 'config atomic writer must remove its temporary file in finally cleanup')
assert.doesNotMatch(installer, /\[System\.IO\.File\]::WriteAllText\(\$configPath/, 'config writes must not use WriteAllText directly')

const invokeSc = sourceBetween(installer, /function Invoke-Sc\(/, /\nfunction /)
assertIncludes(invokeSc, '& sc.exe @Arguments 2>&1', 'Invoke-Sc must execute sc.exe through its argument array')
assert.match(invokeSc, /\$LASTEXITCODE/, 'Invoke-Sc must check sc.exe exit status')
assert.match(invokeSc, /Fail /, 'Invoke-Sc must fail on a non-zero sc.exe exit status')

const serviceRecovery = sourceBetween(installer, /function Set-AgentServiceRecovery\(/, /\n\$repoRoot/)
assert.match(serviceRecovery, /failure/, 'service recovery must configure sc.exe failure actions')
assert.match(serviceRecovery, /reset=/, 'service recovery must set a reset period')
assert.match(serviceRecovery, /86400/, 'service recovery reset period must be one day')
assert.match(serviceRecovery, /actions=/, 'service recovery must configure actions')
assertIncludes(serviceRecovery, 'restart/60000/restart/300000/""/0', 'service recovery must use two finite restarts and a no-action third failure')
assert.match(serviceRecovery, /failureflag/, 'service recovery must enable failure handling for non-crash failures')
assert.match(serviceRecovery, /qfailure/, 'service recovery must read back the configured policy')
assert.match(serviceRecovery, /Write-Host/, 'service recovery must display the qfailure output to the operator')

const automaticStartup = installer.indexOf('Set-Service -Name "AIJobPrintAgent" -StartupType Automatic')
const recoverySetup = installer.indexOf('Set-AgentServiceRecovery "AIJobPrintAgent"')
assert.notEqual(automaticStartup, -1, 'service must use Automatic startup')
assert.notEqual(recoverySetup, -1, 'installer must configure service recovery')
assert.ok(automaticStartup < recoverySetup, 'service recovery must be configured after Automatic startup')
assert.ok(recoverySetup < serviceStart, 'service recovery must be configured before starting the service')
assert.ok(recoverySetup < serviceRestart, 'service recovery must be configured before restarting the service')

assert.doesNotMatch(installer, /(?:node|pnpm|npm|ts-node)[^\r\n]*\bprint\b/i, 'installer must not run a print command')
assert.doesNotMatch(installer, /\/(?:api\/v1\/)?print(?:\/jobs)?\b/i, 'installer must not call a print or task-creation endpoint')
assert.doesNotMatch(installer, /Write-Output\s+\$config\b/, 'installer must not output the generated config')
assert.doesNotMatch(installer, /\$config\.agentToken\b/, 'installer must not access a token from generated config')

assert.match(diagnosis, /Get-CimInstance\s+Win32_Service/, 'diagnosis must query service state through Win32_Service')
assert.match(diagnosis, /UTF8Encoding/, 'diagnosis must use UTF-8 encoding to inspect the config')
assert.match(diagnosis, /0xEF/, 'diagnosis must detect a UTF-8 BOM from the first three bytes')
assert.match(diagnosis, /TrimStart\(\[char\]0xFEFF\)/, 'diagnosis must accept a config that starts with a UTF-8 BOM')
assert.match(diagnosis, /ConvertFrom-Json/, 'diagnosis must validate JSON without outputting config content')
assert.match(diagnosis, /INVALID_DIAGNOSTIC_FILE/, 'diagnosis must return a closed code for an invalid startup diagnostic file')
assert.match(diagnosis, /sc\.exe\s+qfailure/, 'diagnosis must read the configured SCM failure policy')
assert.match(diagnosis, /Test-Path\s+-LiteralPath\s+\$tokenPath/, 'diagnosis must only test the token path for existence')

const diagnosisOutput = diagnosis.slice(diagnosis.lastIndexOf('[pscustomobject]@{'))
assert.notEqual(diagnosisOutput, diagnosis, 'diagnosis must output a PSCustomObject')
for (const field of ['apiBaseUrl', 'terminalCode', 'terminalId', 'printerName', 'agentVersion']) {
  assert.match(
    diagnosisOutput,
    new RegExp(`^\\s*${field}\\s*=\\s*\\$configFieldStatus\\.${field}\\s*$`, 'm'),
    `diagnosis output must map ${field} from its precomputed safe status`,
  )
}
assert.match(diagnosisOutput, /^\s*encryptedTokenFile\s*=\s*\$encryptedTokenFile\s*$/m, 'diagnosis output must map encryptedTokenFile from its safe path check')
assert.match(diagnosisOutput, /^\s*lastStartupDiagnosticCode\s*=\s*\$lastStartupDiagnosticCode\s*$/m, 'diagnosis output must map the closed startup diagnostic code')
assert.doesNotMatch(diagnosisOutput, /\$config\b/, 'diagnosis summary must not reference the full config object')
assert.doesNotMatch(diagnosisOutput, /agentToken/i, 'diagnosis summary must not expose agentToken')
assert.doesNotMatch(diagnosisOutput, /adminSecret/i, 'diagnosis summary must not expose adminSecret')
assert.doesNotMatch(diagnosisOutput, /bindCode/i, 'diagnosis summary must not expose bindCode')
assert.doesNotMatch(diagnosisOutput, /Authorization/i, 'diagnosis summary must not expose Authorization data')

assert.doesNotMatch(diagnosis, /Write-(?:Host|Output)\s+\$config\b/, 'diagnosis must not output config content')
assert.doesNotMatch(diagnosis, /\$config\.agentToken\b/, 'diagnosis must not expose agentToken')
assert.doesNotMatch(diagnosis, /\$config\.adminSecret\b/, 'diagnosis must not expose adminSecret')
assert.doesNotMatch(diagnosis, /\$config\.bindCode\b/, 'diagnosis must not expose bindCode')
assert.doesNotMatch(diagnosis, /ConvertTo-Json\s+\$config\b/, 'diagnosis must not serialize config content')
assert.doesNotMatch(diagnosis, /\$config\s*\|\s*ConvertTo-Json/i, 'diagnosis must not serialize config through a PowerShell pipeline')
assert.doesNotMatch(diagnosis, /Authorization/i, 'diagnosis must not emit Authorization data')
assert.doesNotMatch(
  diagnosis,
  /Invoke-RestMethod|Invoke-WebRequest|Test-Connection|\bcurl(?:\.exe)?\b|Start-BitsTransfer|WebClient|HttpClient|System\.Net\.WebRequest|Start-Process|\/print|POST/i,
  'diagnosis must not make network, process, or print calls',
)

console.log('ALL PASS: terminal-agent Windows service recovery')
