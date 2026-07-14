import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const agentRoot = path.resolve(__dirname, '..')
const installerPath = path.join(__dirname, 'install-production-agent.ps1')
const diagnosisPath = path.join(__dirname, 'diagnose-production-agent.ps1')
const serviceIdentityPath = path.join(__dirname, 'service-identity.ps1')

const installer = fs.readFileSync(installerPath, 'utf8')
const diagnosis = fs.readFileSync(diagnosisPath, 'utf8')
const serviceIdentity = fs.readFileSync(serviceIdentityPath, 'utf8')

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

assert.match(serviceIdentity, /function Resolve-AgentService\b/, 'service identity helper must expose Resolve-AgentService')
assert.match(serviceIdentity, /Get-CimInstance\s+Win32_Service/, 'service identity helper must query Windows services through Win32_Service')
assert.match(serviceIdentity, /\$_\.Name\s+-eq\s+\$Identity/, 'service identity helper must match the SCM service Name')
assert.match(serviceIdentity, /\$_\.DisplayName\s+-eq\s+\$Identity/, 'service identity helper must match the service DisplayName')
assert.match(serviceIdentity, /\$candidates\.Count\s+-gt\s+1/, 'service identity helper must reject ambiguous service matches')
assert.match(serviceIdentity, /"Multiple Windows services match '\$Identity'; refusing to choose one\."/, 'service identity helper must describe ambiguous service matches')
assert.match(serviceIdentity, /throw\s+\$exception/, 'service identity helper must fail closed for ambiguous service matches')
assert.match(serviceIdentity, /agentServiceResolution\"]\s*=\s*"ambiguous"/, 'service identity helper must classify ambiguous service matches')
assert.match(installer, /service-identity\.ps1/, 'installer must use the shared service identity helper')
assert.match(diagnosis, /service-identity\.ps1/, 'diagnosis must use the shared service identity helper')
assert.doesNotMatch(installer, /Get-Service\s+-Name\s+"AIJobPrintAgent"/, 'installer must not assume the display name is the SCM service Name')
assert.doesNotMatch(diagnosis, /Win32_Service\s+-Filter\s+"Name\s*=\s+'\$serviceNameForFilter'/, 'diagnosis must not query only the SCM service Name')

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
const tokenPreparation = installer.indexOf('Write-Step "Preparing token"')
const bindCodeExchange = installer.indexOf('$exchange = Exchange-BindCode -ApiBase $apiBase -Code $BindCode')
const existingTokenCheck = installer.indexOf('Test-TokenFile $tokenPath')
const providedTokenSource = installer.indexOf('$tokenToPersist = $AgentToken.Trim()')
const configCommit = installer.indexOf('Commit-ProductionConfigAndToken -ConfigPath $configPath -ConfigText ($configJson + "`n") -TokenPath $tokenPath -TokenToPersist $tokenToPersist')
const processStop = installer.indexOf('Stop-Process -Id $p.ProcessId')
const resolvedServiceName = installer.indexOf('$serviceName = [string]$service.Name')
const serviceStart = installer.indexOf('Start-Service -Name $serviceName')
const serviceRestart = installer.indexOf('Restart-Service -Name $serviceName -Force')
assert.notEqual(configValidationCall, -1, 'installer must validate the generated config')
for (const [label, index] of [
  ['token preparation', tokenPreparation],
  ['BindCode exchange', bindCodeExchange],
  ['existing token validation', existingTokenCheck],
  ['provided token validation', providedTokenSource],
  ['config backup', configBackup],
  ['config/token commit', configCommit],
  ['stale process stop', processStop],
  ['resolved SCM service name', resolvedServiceName],
  ['service start', serviceStart],
  ['service restart', serviceRestart],
]) {
  assert.notEqual(index, -1, `installer must retain ${label}`)
}
assert.ok(configValidationCall < tokenPreparation, 'generated config validation must happen before token preparation')
assert.ok(tokenPreparation < bindCodeExchange, 'BindCode exchange must happen during token preparation')
assert.ok(bindCodeExchange < configCommit, 'BindCode exchange must finish before the local commit')
assert.ok(existingTokenCheck < configCommit, 'existing token validation must finish before the local commit')
assert.ok(providedTokenSource < configCommit, 'provided token validation must finish before the local commit')
assert.ok(configBackup < configCommit, 'the user-recoverable config backup must precede the local commit')
assert.ok(configCommit < processStop, 'the local commit must finish before stopping Agent processes')
assert.ok(resolvedServiceName < serviceStart, 'installer must resolve the SCM service name before starting it')
assert.ok(resolvedServiceName < serviceRestart, 'installer must resolve the SCM service name before restarting it')
assert.ok(configCommit < serviceStart, 'the local commit must finish before starting the service')
assert.ok(configCommit < serviceRestart, 'the local commit must finish before restarting the service')
assert.match(installer, /if\s*\(\$service\.State\s+-ne\s+"Running"\)/, 'installer must use the CIM service State when deciding whether to start or restart')
assert.doesNotMatch(installer, /\$service\.Status/, 'installer must not read the unsupported CIM Status property')
assert.equal(
  (installer.match(/Resolve-AgentService\s+-Identity\s+\$agentServiceIdentity/g) ?? []).length,
  2,
  'installer must resolve the service both before and after a possible install',
)

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

const protectToken = sourceBetween(installer, /function Protect-AgentToken\(/, /\nfunction /)
assert.match(protectToken, /Write-TextAtomically\s+-Path\s+\$TokenPath\s+-Text\s+\$b64/, 'DPAPI token writes must use the atomic writer')
assert.doesNotMatch(protectToken, /WriteAllText/, 'DPAPI token writes must not use WriteAllText directly')

const productionCommit = sourceBetween(installer, /function Commit-ProductionConfigAndToken\(/, /\nfunction /)
assert.match(productionCommit, /\$hadExistingToken\s*=\s*Test-Path\s+-LiteralPath\s+\$TokenPath/, 'local commit must record whether a token already exists')
assert.match(productionCommit, /Join-Path\s+\$tokenDirectory/, 'local commit rollback file must live beside the token')
assert.match(productionCommit, /Copy-Item\s+-LiteralPath\s+\$TokenPath\s+-Destination\s+\$tokenRollbackPath\s+-Force/, 'local commit must copy an existing token before overwriting it')
assert.match(productionCommit, /Protect-AgentToken\s+-Token\s+\$TokenToPersist\s+-TokenPath\s+\$TokenPath/, 'local commit must atomically persist a newly sourced token first')
assert.match(productionCommit, /Write-TextAtomically\s+-Path\s+\$ConfigPath\s+-Text\s+\$ConfigText/, 'local commit must atomically persist config after token')
assert.ok(
  productionCommit.indexOf('Protect-AgentToken -Token $TokenToPersist -TokenPath $TokenPath') < productionCommit.indexOf('Write-TextAtomically -Path $ConfigPath -Text $ConfigText'),
  'local commit must write token before config',
)
assert.match(productionCommit, /File\]::Replace\(\$tokenRollbackPath,\s*\$TokenPath,\s*\$null\)/, 'local commit must restore an existing token from rollback')
assert.match(productionCommit, /File\]::Move\(\$tokenRollbackPath,\s*\$TokenPath\)/, 'local commit must restore when the token destination is absent')
assert.match(productionCommit, /Remove-Item\s+-LiteralPath\s+\$tokenRollbackPath\s+-Force/, 'local commit must clean up its rollback temporary file')
assert.match(productionCommit, /Could not commit production config and terminal token locally/, 'local commit failures must use a fixed non-secret recovery message')

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

const automaticStartup = installer.indexOf('Set-Service -Name $serviceName -StartupType Automatic')
const recoverySetup = installer.indexOf('Set-AgentServiceRecovery $serviceName')
assert.notEqual(automaticStartup, -1, 'service must use Automatic startup')
assert.notEqual(recoverySetup, -1, 'installer must configure service recovery')
assert.ok(automaticStartup < recoverySetup, 'service recovery must be configured after Automatic startup')
assert.ok(recoverySetup < serviceStart, 'service recovery must be configured before starting the service')
assert.ok(recoverySetup < serviceRestart, 'service recovery must be configured before restarting the service')

assert.doesNotMatch(installer, /(?:node|pnpm|npm|ts-node)[^\r\n]*\bprint\b/i, 'installer must not run a print command')
assert.doesNotMatch(installer, /\/(?:api\/v1\/)?print(?:\/jobs)?\b/i, 'installer must not call a print or task-creation endpoint')
assert.doesNotMatch(installer, /Write-Output\s+\$config\b/, 'installer must not output the generated config')
assert.doesNotMatch(installer, /\$config\.agentToken\b/, 'installer must not access a token from generated config')

assert.match(diagnosis, /service-identity\.ps1/, 'diagnosis must source the shared service identity helper')
assert.match(diagnosis, /Resolve-AgentService\s+-Identity\s+\$ServiceName/, 'diagnosis must resolve a service by Name or DisplayName')
assert.match(diagnosis, /\$serviceResolution\s*=\s*"ambiguous"/, 'diagnosis must distinguish an ambiguous service match from a missing service')
assert.match(diagnosis, /\$serviceAmbiguous\s*=\s*\$serviceResolution\s+-eq\s+"ambiguous"/, 'diagnosis must calculate the ambiguity flag from the closed resolution state')
assert.match(diagnosis, /UTF8Encoding/, 'diagnosis must use UTF-8 encoding to inspect the config')
assert.match(diagnosis, /0xEF/, 'diagnosis must detect a UTF-8 BOM from the first three bytes')
assert.match(diagnosis, /TrimStart\(\[char\]0xFEFF\)/, 'diagnosis must accept a config that starts with a UTF-8 BOM')
assert.match(diagnosis, /ConvertFrom-Json/, 'diagnosis must validate JSON without outputting config content')
assert.match(diagnosis, /INVALID_DIAGNOSTIC_FILE/, 'diagnosis must return a closed code for an invalid startup diagnostic file')
assert.match(diagnosis, /sc\.exe\s+qfailure/, 'diagnosis must read the configured SCM failure policy')
assert.match(diagnosis, /Test-Path\s+-LiteralPath\s+\$tokenPath/, 'diagnosis must only test the token path for existence')

const allowedDiagnosticCodes = [
  'AGENT_CONFIG_NOT_FOUND',
  'AGENT_CONFIG_INVALID_JSON',
  'AGENT_CONFIG_INVALID_SHAPE',
  'AGENT_CONFIG_REQUIRED_FIELD_MISSING',
  'AGENT_CONFIG_INVALID_FIELD',
  'AGENT_TOKEN_DECRYPT_FAILED',
  'AGENT_PROFILE_REJECTED',
  'AGENT_REGISTRATION_FAILED',
  'AGENT_STARTUP_FAILED',
  'AGENT_READY',
]
assert.match(diagnosis, /\$allowedDiagnosticCodes\s*=\s*@\(/, 'diagnosis must define an explicit startup diagnostic code whitelist')
for (const code of allowedDiagnosticCodes) {
  assertIncludes(diagnosis, code, `diagnosis whitelist must include ${code}`)
}
const startupDiagnosticReader = sourceBetween(diagnosis, /function Get-StartupDiagnosticCode\(/, /\n\$service\s*=/)
assert.match(startupDiagnosticReader, /\$diagnostic\.schemaVersion\s+-ne\s+1/, 'diagnosis must validate diagnostic schemaVersion')
assert.match(startupDiagnosticReader, /\$diagnostic\.state\s+-isnot\s+\[string\]/, 'diagnosis must validate diagnostic state type')
assert.match(startupDiagnosticReader, /\$diagnostic\.state\s+-notin\s+@\("ready",\s*"failed"\)/, 'diagnosis must validate diagnostic state')
assert.match(startupDiagnosticReader, /\$diagnostic\.code\s+-isnot\s+\[string\]/, 'diagnosis must validate diagnostic code type')
assert.match(startupDiagnosticReader, /IsNullOrWhiteSpace\(\[string\]\$diagnostic\.code\)/, 'diagnosis must reject empty diagnostic codes')
assert.match(startupDiagnosticReader, /\$allowedDiagnosticCodes\s+-notcontains\s+\$diagnostic\.code/, 'diagnosis must reject codes outside the whitelist')

const configStatusStart = diagnosis.lastIndexOf('$configFieldStatus = [pscustomobject]@{')
assert.notEqual(configStatusStart, -1, 'diagnosis must calculate field status through a PSCustomObject')
const configStatusEnd = diagnosis.indexOf('\n}', configStatusStart)
assert.notEqual(configStatusEnd, -1, 'diagnosis field status block must be closed')
const configStatus = diagnosis.slice(configStatusStart, configStatusEnd + 2)
for (const field of ['apiBaseUrl', 'terminalCode', 'terminalId', 'printerName', 'agentVersion']) {
  assert.match(
    configStatus,
    new RegExp(`^\\s*${field}\\s*=\\s*-not \\[string\\]::IsNullOrWhiteSpace\\(\\[string\\]\\$config\\.${field}\\)\\s*$`, 'm'),
    `diagnosis must calculate ${field} as an explicit boolean`,
  )
}

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
assert.match(diagnosisOutput, /^\s*serviceName\s*=\s*\$resolvedServiceName\s*$/m, 'diagnosis must report the resolved SCM service Name')
assert.match(diagnosisOutput, /^\s*serviceDisplayName\s*=\s*\$resolvedServiceDisplayName\s*$/m, 'diagnosis must report the resolved service DisplayName')
assert.match(diagnosisOutput, /^\s*serviceAmbiguous\s*=\s*\$serviceAmbiguous\s*$/m, 'diagnosis must report whether service resolution was ambiguous')
assert.match(diagnosisOutput, /^\s*serviceResolution\s*=\s*\$serviceResolution\s*$/m, 'diagnosis must report the closed service resolution state')
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
