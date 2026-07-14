# Windows Terminal Agent P0 Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing Windows Terminal Agent tolerate a UTF-8 BOM in its JSON configuration, persist its own configuration safely, leave a secret-free local startup diagnosis, and install a finite Windows SCM recovery policy without changing print-task semantics.

**Architecture:** Keep the existing one-time bind-code → DPAPI token → heartbeat/claim loop unchanged. Add a small, testable configuration boundary that classifies parse and token failures before any network or print loop starts; add a local diagnostic record containing only a status code; and make the existing PowerShell installer configure and prove Windows SCM recovery. Static and behavior-oriented verify scripts become CI contracts, while the Windows-host acceptance remains an explicit no-print, empty-queue operation.

**Tech Stack:** Node.js 18+, TypeScript/CommonJS, `node-windows`, Windows PowerShell 5+, Windows SCM (`sc.exe`), pnpm, GitHub Actions.

---

## Scope and file map

**Functional closure:** Windows host reliability for the already deployed `AIJobPrintAgent` service. The work prevents the confirmed BOM configuration crash, prevents the Agent from replacing a broken primary configuration with an unchecked file, and gives an operator a local, secret-free way to distinguish configuration, token, service, and recovery-policy state.

**Layers touched:**

- Terminal Agent: startup/configuration only under `apps/terminal-agent/`; no print execution changes.
- CI: existing terminal-agent verify step in `.github/workflows/ci.yml`.
- Documentation: Windows operator onboarding and the two progress SSOT files.
- Frontend, backend, database, shared contracts, payment, Kiosk UI, Admin binding UI, and Prisma: not touched.

**Files to modify:**

| File | Responsibility |
| --- | --- |
| `apps/terminal-agent/src/agent/config-manager.ts` | BOM-normalized parsing, typed failures, credential-free serialization, atomic replacement, and last-known-good copy. |
| `apps/terminal-agent/src/agent/dpapi.ts` | Expose the token-file path and classify a DPAPI decrypt error without logging ciphertext or plaintext. |
| `apps/terminal-agent/src/agent/startup-diagnostics.ts` | New small module that atomically records only startup state, UTC timestamp, and a closed diagnostic code. |
| `apps/terminal-agent/src/index.ts` | Convert startup exits into classified diagnostics and make wrapper restart bounds explicit; do not change task claim/print code. |
| `apps/terminal-agent/scripts/verify-agent-config-resilience.mjs` | New temp-directory behavior test for BOM, validation, atomic replacement, credential filtering, and diagnostic shape. |
| `apps/terminal-agent/scripts/install-production-agent.ps1` | Validate generated configuration before changing service/token state; set and query finite SCM recovery. |
| `apps/terminal-agent/scripts/diagnose-production-agent.ps1` | New local read-only operator diagnosis for service/config/token/last diagnostic/recovery policy. |
| `apps/terminal-agent/scripts/verify-windows-service-recovery.mjs` | New source-contract verifier for no-print installer, SCM recovery, and safe diagnostic output. |
| `apps/terminal-agent/package.json` | Register the two new verify commands. |
| `.github/workflows/ci.yml` | Run both new verify commands in the existing Terminal Agent verification job. |
| `docs/device/production-agent-onboarding.md` | Document installation, recovery semantics, local diagnosis, and the no-print acceptance procedure. |
| `docs/progress/current-progress.md` | Record only the verified implementation/Windows-acceptance facts after they exist. |
| `docs/progress/next-tasks.md` | Replace the active P0 item with the actual residual P1 MSI work after P0 evidence passes. |

**Files explicitly not to change:**

- `apps/terminal-agent/src/agent/task-runner.ts`, printer adapters, scan watcher, offline queue, and local QR bridge.
- All terminal bind-code API/UI files, terminal database schema, and Admin terminal-management UI.
- Kiosk, payment, order, file-storage, and deployment configuration files.

**Non-negotiable runtime rules:**

1. No code path may print, claim a task, or issue a network write before config parsing/validation and credential loading succeed.
2. Runtime configuration files and their last-known-good copy must never contain `agentToken`, `adminSecret`, a bind code, or an `Authorization` value.
3. An invalid primary configuration must never be silently replaced by the last-known-good copy; the copy is a human recovery aid only.
4. SCM restart policy is finite: first restart after 60 seconds, second after 300 seconds, then no third action; reset the failure counter after 86,400 seconds.
5. Windows validation uses a confirmed empty queue and performs no task creation, no test print, and no real output.

### Task 1: Establish config/diagnostic behavior tests before implementation

**Files:**

- Create: `apps/terminal-agent/scripts/verify-agent-config-resilience.mjs`
- Modify: `apps/terminal-agent/package.json`
- Test: `apps/terminal-agent/scripts/verify-agent-config-resilience.mjs`

- [ ] **Step 1: Add a failing behavior verifier that imports the future public helpers through `ts-node/register`.**

  Create the verifier with a temporary directory per run. It must request the following exports from `src/agent/config-manager.ts`: `AgentStartupError`, `parseConfigText`, `serializePersistedConfig`, and `writeValidatedConfigAt`; and from `src/agent/startup-diagnostics.ts`: `readStartupDiagnostic` and `writeStartupDiagnostic`.

  ```js
  import assert from 'node:assert/strict'
  import fs from 'node:fs'
  import os from 'node:os'
  import path from 'node:path'
  import { createRequire } from 'node:module'
  import { fileURLToPath } from 'node:url'

  const require = createRequire(import.meta.url)
  require('ts-node/register')
  const agentRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const configManager = require(path.join(agentRoot, 'src/agent/config-manager.ts'))
  const diagnostics = require(path.join(agentRoot, 'src/agent/startup-diagnostics.ts'))
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-config-resilience-'))
  const configPath = path.join(workDir, 'agent-config.json')
  const backupPath = path.join(workDir, 'agent-config.last-known-good.json')

  const valid = {
    apiBaseUrl: 'https://api.example.test/api/v1',
    terminalCode: 'KSK-001',
    printerName: 'Test Printer',
    agentVersion: '0.3.0',
    terminalId: 'terminal-test',
  }

  try {
    assert.equal(configManager.parseConfigText(`\uFEFF${JSON.stringify(valid)}`).terminalCode, 'KSK-001')
    assert.throws(
      () => configManager.parseConfigText('{'),
      (error) => error instanceof configManager.AgentStartupError && error.code === 'AGENT_CONFIG_INVALID_JSON',
    )
    assert.throws(
      () => configManager.parseConfigText(JSON.stringify({ ...valid, printerName: '  ' })),
      (error) => error instanceof configManager.AgentStartupError && error.code === 'AGENT_CONFIG_REQUIRED_FIELD_MISSING',
    )

    const serialized = configManager.serializePersistedConfig({
      ...valid,
      agentToken: 'must-not-persist',
      adminSecret: 'must-not-persist',
    })
    assert.equal(serialized.includes('must-not-persist'), false)
    assert.equal(JSON.parse(serialized).terminalCode, 'KSK-001')

    fs.writeFileSync(configPath, JSON.stringify(valid), 'utf8')
    configManager.writeValidatedConfigAt(configPath, backupPath, { ...valid, terminalCode: 'KSK-002' })
    assert.equal(JSON.parse(fs.readFileSync(configPath, 'utf8')).terminalCode, 'KSK-002')
    assert.equal(JSON.parse(fs.readFileSync(backupPath, 'utf8')).terminalCode, 'KSK-001')

    const primaryBeforeFailure = fs.readFileSync(configPath, 'utf8')
    assert.throws(() => configManager.writeValidatedConfigAt(configPath, backupPath, { ...valid, agentVersion: '' }))
    assert.equal(fs.readFileSync(configPath, 'utf8'), primaryBeforeFailure)

    const diagnosticPath = path.join(workDir, 'last-startup-diagnostic.json')
    diagnostics.writeStartupDiagnostic(diagnosticPath, 'AGENT_CONFIG_INVALID_JSON')
    assert.deepEqual(diagnostics.readStartupDiagnostic(diagnosticPath).code, 'AGENT_CONFIG_INVALID_JSON')
    assert.equal(fs.readFileSync(diagnosticPath, 'utf8').includes('must-not-persist'), false)
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true })
  }
  console.log('ALL PASS: agent config resilience')
  ```

- [ ] **Step 2: Register the verifier and run it before the helpers exist.**

  Add this exact package script directly after the existing `verify:agent-profile-guard` entry:

  ```json
  "verify:agent-config-resilience": "node scripts/verify-agent-config-resilience.mjs"
  ```

  Run:

  ```bash
  pnpm --filter terminal-agent verify:agent-config-resilience
  ```

  Expected: failure that identifies the missing `startup-diagnostics.ts` module or one of the required exports. Do not weaken an assertion to make this red phase pass.

- [ ] **Step 3: Commit the red test contract.**

  ```bash
  git add apps/terminal-agent/scripts/verify-agent-config-resilience.mjs apps/terminal-agent/package.json
  git commit -m "test: define agent config resilience contract"
  ```

### Task 2: Implement classified configuration loading and secret-free diagnostics

**Files:**

- Create: `apps/terminal-agent/src/agent/startup-diagnostics.ts`
- Modify: `apps/terminal-agent/src/agent/config-manager.ts`
- Modify: `apps/terminal-agent/src/agent/dpapi.ts`
- Modify: `apps/terminal-agent/src/index.ts`
- Test: `apps/terminal-agent/scripts/verify-agent-config-resilience.mjs`

- [ ] **Step 1: Add the closed startup-error vocabulary and pure configuration helpers.**

  At the top of `config-manager.ts`, add these exported definitions. All thrown messages are fixed operator messages; they must never interpolate raw JSON, token text, binding codes, or HTTP headers.

  ```ts
  export type AgentStartupErrorCode =
    | 'AGENT_CONFIG_NOT_FOUND'
    | 'AGENT_CONFIG_INVALID_JSON'
    | 'AGENT_CONFIG_INVALID_SHAPE'
    | 'AGENT_CONFIG_REQUIRED_FIELD_MISSING'
    | 'AGENT_CONFIG_INVALID_FIELD'
    | 'AGENT_TOKEN_DECRYPT_FAILED'
    | 'AGENT_PROFILE_REJECTED'
    | 'AGENT_REGISTRATION_FAILED'
    | 'AGENT_STARTUP_FAILED'
    | 'AGENT_READY'

  export class AgentStartupError extends Error {
    constructor(readonly code: AgentStartupErrorCode, message: string) {
      super(message)
      this.name = 'AgentStartupError'
    }
  }

  export function isAgentStartupError(error: unknown): error is AgentStartupError {
    return error instanceof AgentStartupError
  }
  ```

  Add `parseConfigText(raw: string): AgentConfig` with the following exact boundary behavior:

  ```ts
  export function parseConfigText(raw: string): AgentConfig {
    const normalized = raw.startsWith('\uFEFF') ? raw.slice(1) : raw
    let parsed: unknown
    try {
      parsed = JSON.parse(normalized)
    } catch {
      throw new AgentStartupError('AGENT_CONFIG_INVALID_JSON', 'agent-config.json is not valid JSON')
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new AgentStartupError('AGENT_CONFIG_INVALID_SHAPE', 'agent-config.json must contain a JSON object')
    }
    const config = { ...(parsed as Record<string, unknown>) } as AgentConfig & { _comment?: string }
    delete config._comment
    return validateConfigShape(config)
  }
  ```

  Replace the existing three-field-only validator with `validateConfigShape`. It must require non-empty strings for `apiBaseUrl`, `terminalCode`, `printerName`, and `agentVersion`; reject a present non-string `terminalId`; and reject present interval/port values unless they are positive integers. It must return a new object and not mutate `config`.

  ```ts
  function requireNonEmpty(value: unknown, field: string): string {
    if (typeof value === 'string' && value.trim()) return value.trim()
    throw new AgentStartupError('AGENT_CONFIG_REQUIRED_FIELD_MISSING', `agent-config.json requires ${field}`)
  }

  function requireOptionalPositiveInteger(value: unknown, field: string): number | undefined {
    if (value === undefined) return undefined
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value
    throw new AgentStartupError('AGENT_CONFIG_INVALID_FIELD', `agent-config.json has invalid ${field}`)
  }
  ```

- [ ] **Step 2: Implement credential filtering, atomic writes, and a non-automatic last-known-good copy.**

  Define the sibling backup path and use only a same-directory temporary file. `serializePersistedConfig` must remove `_comment`, `agentToken`, `adminSecret`, `bindCode`, and all `undefined` values before serializing. It must parse its own output through `parseConfigText` before returning it.

  ```ts
  const LAST_KNOWN_GOOD_FILE = path.resolve(__dirname, '../../config/agent-config.last-known-good.json')
  const PERSISTED_SECRET_KEYS = new Set(['_comment', 'agentToken', 'adminSecret', 'bindCode'])

  export function serializePersistedConfig(config: AgentConfig): string {
    const persisted = Object.fromEntries(
      Object.entries(config).filter(([key, value]) => !PERSISTED_SECRET_KEYS.has(key) && value !== undefined),
    ) as AgentConfig
    const text = `${JSON.stringify(persisted, null, 2)}\n`
    parseConfigText(text)
    return text
  }

  function writeTextAtomically(filePath: string, text: string): void {
    const dir = path.dirname(filePath)
    fs.mkdirSync(dir, { recursive: true })
    const tempPath = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`)
    let fd: number | undefined
    try {
      fd = fs.openSync(tempPath, 'wx', 0o600)
      fs.writeFileSync(fd, text, 'utf8')
      fs.fsyncSync(fd)
    } finally {
      if (fd !== undefined) fs.closeSync(fd)
    }
    try {
      fs.renameSync(tempPath, filePath)
    } finally {
      if (fs.existsSync(tempPath)) fs.rmSync(tempPath, { force: true })
    }
  }

  export function writeValidatedConfigAt(
    configPath: string,
    lastKnownGoodPath: string,
    nextConfig: AgentConfig,
  ): void {
    const nextText = serializePersistedConfig(nextConfig)
    if (fs.existsSync(configPath)) {
      const current = parseConfigText(fs.readFileSync(configPath, 'utf8'))
      writeTextAtomically(lastKnownGoodPath, serializePersistedConfig(current))
    }
    writeTextAtomically(configPath, nextText)
  }
  ```

  `writeConfigFile` must delegate to `writeValidatedConfigAt(CONFIG_FILE, LAST_KNOWN_GOOD_FILE, config)`. Do not add code that reads `LAST_KNOWN_GOOD_FILE` during startup and do not use it to overwrite the primary file.

- [ ] **Step 3: Route `loadConfig()` through the new boundary without changing token storage semantics.**

  Replace direct `JSON.parse(raw)` with `parseConfigText(raw)`. Preserve the existing plaintext-token migration order, but make it safe: read/validate first, then `saveAgentToken(parsed.agentToken)`, then atomically write a credential-free primary configuration. Wrap only the DPAPI load failure with the closed code below.

  ```ts
  let agentToken: string | null
  try {
    agentToken = loadAgentToken()
  } catch {
    throw new AgentStartupError(
      'AGENT_TOKEN_DECRYPT_FAILED',
      'agent.token cannot be decrypted on this Windows host; rebind this terminal with a new one-time code',
    )
  }
  return agentToken ? { ...parsed, agentToken } : parsed
  ```

  In `dpapi.ts`, export a non-secret path helper for existence checks and preserve existing DPAPI LocalMachine behavior:

  ```ts
  export function getAgentTokenPath(): string {
    return path.join(getDataDir(), 'agent.token')
  }
  ```

  Replace internal uses of the former private path helper with `getAgentTokenPath()`. Do not read, print, or return token contents from a diagnostic API.

- [ ] **Step 4: Add the small startup-diagnostic module.**

  Create `startup-diagnostics.ts`. It must write only `schemaVersion`, `recordedAt`, `state`, and `code`; use the same temporary-file + `fsyncSync` + `renameSync` pattern as Task 2 Step 2. It must not accept an arbitrary message parameter.

  ```ts
  import fs from 'fs'
  import os from 'os'
  import path from 'path'
  import type { AgentStartupErrorCode } from './config-manager'

  export interface StartupDiagnostic {
    schemaVersion: 1
    recordedAt: string
    state: 'ready' | 'failed'
    code: AgentStartupErrorCode
  }

  export function getStartupDiagnosticPath(): string {
    const base = process.env['PROGRAMDATA']
      ? path.join(process.env['PROGRAMDATA'], 'AIJobPrintAgent')
      : path.join(os.tmpdir(), 'AIJobPrintAgent')
    return path.join(base, 'last-startup-diagnostic.json')
  }

  export function writeStartupDiagnostic(filePath: string, code: AgentStartupErrorCode): void {
    const record: StartupDiagnostic = {
      schemaVersion: 1,
      recordedAt: new Date().toISOString(),
      state: code === 'AGENT_READY' ? 'ready' : 'failed',
      code,
    }
    writeTextAtomically(filePath, `${JSON.stringify(record, null, 2)}\n`)
  }

  export function readStartupDiagnostic(filePath = getStartupDiagnosticPath()): StartupDiagnostic | null {
    if (!fs.existsSync(filePath)) return null
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as StartupDiagnostic
  }
  ```

  Keep `writeTextAtomically` private to this module rather than importing a private helper from `config-manager.ts`; the two modules stay independently testable and avoid a mixed configuration/diagnostic responsibility.

- [ ] **Step 5: Classify startup exit paths and bound the wrapper's rapid retries.**

  In `index.ts`, import `AgentStartupError`, `isAgentStartupError`, `writeStartupDiagnostic`, and `getStartupDiagnosticPath`. Add this helper above command registration:

  ```ts
  function failStartup(error: unknown, fallback: AgentStartupErrorCode): never {
    const code = isAgentStartupError(error) ? error.code : fallback
    writeStartupDiagnostic(getStartupDiagnosticPath(), code)
    err(`${code}: Agent did not start. Run diagnose-production-agent.ps1 on this host.`)
    process.exit(1)
  }
  ```

  Use `failStartup(error, 'AGENT_STARTUP_FAILED')` for configuration load and profile guard, and `failStartup(error, 'AGENT_REGISTRATION_FAILED')` for registration. Immediately after successful `registerOrLoad`, call:

  ```ts
  writeStartupDiagnostic(getStartupDiagnosticPath(), 'AGENT_READY')
  ```

  Keep the existing call order: lock → SQLite → config → profile guard → registration → heartbeat → task runner. Do not move `startTaskRunner` earlier or modify any print code.

  In the `new Service({...})` options for `install-service`, make wrapper behavior explicit:

  ```ts
  wait: 1,
  grow: 0.25,
  maxRestarts: 2,
  abortOnError: false,
  ```

  This leaves short transient retries to the wrapper, then lets the installer-configured SCM policy perform the finite 60-second/300-second recovery. Do not add an infinite restart setting.

- [ ] **Step 6: Run the red verifier and the existing Agent typecheck until both pass.**

  Run:

  ```bash
  pnpm --filter terminal-agent verify:agent-config-resilience
  pnpm --filter terminal-agent typecheck
  pnpm --filter terminal-agent verify:printer-config
  pnpm --filter terminal-agent verify:print-scan-agent
  ```

  Expected: every command exits 0. The config verifier must prove BOM acceptance, malformed/empty-field classification, credential-free serialization, preserved primary file after a rejected update, last-known-good content, and a secret-free diagnostic record.

- [ ] **Step 7: Commit the configuration and startup-safety implementation.**

  ```bash
  git add \
    apps/terminal-agent/src/agent/config-manager.ts \
    apps/terminal-agent/src/agent/dpapi.ts \
    apps/terminal-agent/src/agent/startup-diagnostics.ts \
    apps/terminal-agent/src/index.ts \
    apps/terminal-agent/scripts/verify-agent-config-resilience.mjs
  git commit -m "fix(agent): harden startup configuration recovery"
  ```

### Task 3: Add finite SCM recovery and a local no-print diagnosis tool

**Files:**

- Modify: `apps/terminal-agent/scripts/install-production-agent.ps1`
- Create: `apps/terminal-agent/scripts/diagnose-production-agent.ps1`
- Create: `apps/terminal-agent/scripts/verify-windows-service-recovery.mjs`
- Modify: `apps/terminal-agent/package.json`
- Test: `apps/terminal-agent/scripts/verify-windows-service-recovery.mjs`

- [ ] **Step 1: Add a failing static service-recovery verifier.**

  Create the verifier so it reads the installer and diagnosis script as text and fails if the contract below is absent. It must not execute PowerShell, install a service, create a task, or contact an API.

  ```js
  import assert from 'node:assert/strict'
  import fs from 'node:fs'
  import path from 'node:path'
  import { fileURLToPath } from 'node:url'

  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const installer = fs.readFileSync(path.join(root, 'scripts/install-production-agent.ps1'), 'utf8')
  const diagnose = fs.readFileSync(path.join(root, 'scripts/diagnose-production-agent.ps1'), 'utf8')

  assert.match(installer, /sc\.exe\s+@Arguments/)
  assert.match(installer, /"failure",\s*\$ServiceName/)
  assert.match(installer, /restart\/60000\/restart\/300000\/""\/0/)
  assert.match(installer, /"failureflag",\s*\$ServiceName/)
  assert.match(installer, /"qfailure",\s*\$ServiceName/)
  assert.match(installer, /Set-Service\s+-Name\s+"AIJobPrintAgent"\s+-StartupType\s+Automatic/)
  assert.doesNotMatch(installer, /Start-Process\s+.*print/i)
  assert.match(diagnose, /Get-CimInstance\s+Win32_Service/)
  assert.match(diagnose, /encryptedTokenFile/)
  assert.match(diagnose, /lastStartupDiagnosticCode/)
  assert.match(diagnose, /sc\.exe\s+qfailure\s+\$ServiceName/)
  assert.doesNotMatch(diagnose, /agentToken\s*=\s*\$config\./)
  assert.doesNotMatch(diagnose, /Write-Output\s+\$config\b/)
  console.log('ALL PASS: Windows service recovery contract')
  ```

- [ ] **Step 2: Register and prove the red static contract.**

  Add this script in `apps/terminal-agent/package.json`:

  ```json
  "verify:windows-service-recovery": "node scripts/verify-windows-service-recovery.mjs"
  ```

  Run:

  ```bash
  pnpm --filter terminal-agent verify:windows-service-recovery
  ```

  Expected: failure because the installer does not yet configure or query SCM recovery and the diagnosis script does not exist.

- [ ] **Step 3: Preflight the generated config before state-changing installer stages.**

  In `install-production-agent.ps1`, define and call `Test-GeneratedConfig` immediately after the `$config` ordered hashtable is built and before the existing config backup, config write, bind-code exchange, token write, process stop, or service restart.

  ```powershell
  function Test-GeneratedConfig([hashtable]$Config) {
    $json = $Config | ConvertTo-Json -Depth 8
    try {
      $parsed = $json | ConvertFrom-Json -ErrorAction Stop
    } catch {
      Fail "Generated Agent configuration is not valid JSON"
    }
    foreach ($field in @("apiBaseUrl", "terminalCode", "terminalId", "printerName", "agentVersion")) {
      if ([string]::IsNullOrWhiteSpace([string]$parsed.$field)) {
        Fail "Generated Agent configuration is missing $field"
      }
    }
    foreach ($field in @("heartbeatIntervalMs", "claimIntervalMs", "localApiPort")) {
      if ([int]$parsed.$field -le 0) {
        Fail "Generated Agent configuration has invalid $field"
      }
    }
    return $json
  }
  ```

  Replace `$configJson = $config | ConvertTo-Json -Depth 8` with `$configJson = Test-GeneratedConfig $config`. Keep UTF-8 no-BOM output. A preflight error must call `Fail` before any service process is stopped and before any binding code is exchanged.

- [ ] **Step 4: Configure and prove finite SCM recovery in the installer.**

  Add the following helpers before the first installer action. Use `sc.exe`, not `sc`, so PowerShell cannot resolve the `Set-Content` alias. Do not make the third action a restart.

  ```powershell
  function Invoke-Sc([string[]]$Arguments) {
    $output = & sc.exe @Arguments 2>&1
    if ($LASTEXITCODE -ne 0) {
      Fail "sc.exe $($Arguments -join ' ') failed: $($output -join ' ')"
    }
    return ($output -join "`n")
  }

  function Set-AgentServiceRecovery([string]$ServiceName) {
    Invoke-Sc @(
      "failure", $ServiceName,
      "reset=", "86400",
      "actions=", "restart/60000/restart/300000/\"\"/0"
    ) | Out-Null
    Invoke-Sc @("failureflag", $ServiceName, "1") | Out-Null
    $recovery = Invoke-Sc @("qfailure", $ServiceName)
    if ($recovery -notmatch "RESET_PERIOD") {
      Fail "Windows SCM recovery policy could not be read back for $ServiceName"
    }
    Write-Ok "Windows SCM recovery policy configured and read back for $ServiceName"
  }
  ```

  After the service exists and immediately after `Set-Service -StartupType Automatic`, call:

  ```powershell
  Set-AgentServiceRecovery "AIJobPrintAgent"
  ```

  Keep the existing heartbeat GET verification. Do not add a test-print command, `POST`, or a task-creation path.

- [ ] **Step 5: Create the standalone local diagnosis script.**

  Create `diagnose-production-agent.ps1` with `-ConfigPath`, `-ServiceName`, and `-ProgramDataDir` optional parameters. It must read configuration only to return booleans, never values; it must use `Get-CimInstance Win32_Service` for service state; and it must call `sc.exe qfailure` only to include the recovery-policy text. The structured summary must contain no token or complete config.

  ```powershell
  [CmdletBinding()]
  param(
    [string]$ConfigPath = (Join-Path (Split-Path -Parent $PSScriptRoot) "config\agent-config.json"),
    [string]$ServiceName = "AIJobPrintAgent",
    [string]$ProgramDataDir = (Join-Path $env:ProgramData "AIJobPrintAgent")
  )

  $ErrorActionPreference = "Stop"
  $tokenPath = Join-Path $ProgramDataDir "agent.token"
  $diagnosticPath = Join-Path $ProgramDataDir "last-startup-diagnostic.json"
  $configExists = Test-Path -LiteralPath $ConfigPath
  $hasBom = $false
  $configValid = $false
  $config = $null

  if ($configExists) {
    $bytes = [System.IO.File]::ReadAllBytes($ConfigPath)
    $hasBom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
    try {
      $raw = [System.Text.Encoding]::UTF8.GetString($bytes).TrimStart([char]0xFEFF)
      $config = $raw | ConvertFrom-Json -ErrorAction Stop
      $configValid = $true
    } catch {
      $configValid = $false
    }
  }

  $service = Get-CimInstance Win32_Service -Filter "Name='$ServiceName'" -ErrorAction SilentlyContinue
  $lastStartupDiagnosticCode = $null
  if (Test-Path -LiteralPath $diagnosticPath) {
    try { $lastStartupDiagnosticCode = (Get-Content $diagnosticPath -Raw | ConvertFrom-Json).code } catch { $lastStartupDiagnosticCode = "INVALID_DIAGNOSTIC_FILE" }
  }
  $recovery = & sc.exe qfailure $ServiceName 2>&1

  [pscustomobject]@{
    serviceExists             = [bool]$service
    serviceState              = if ($service) { $service.State } else { $null }
    startMode                 = if ($service) { $service.StartMode } else { $null }
    processId                 = if ($service) { $service.ProcessId } else { $null }
    configExists              = $configExists
    configHasUtf8Bom          = $hasBom
    configValidJson           = $configValid
    apiBaseUrl                = [bool]$config.apiBaseUrl
    terminalCode              = [bool]$config.terminalCode
    terminalId                = [bool]$config.terminalId
    printerName               = [bool]$config.printerName
    agentVersion              = [bool]$config.agentVersion
    encryptedTokenFile        = Test-Path -LiteralPath $tokenPath
    lastStartupDiagnosticCode = $lastStartupDiagnosticCode
    scmFailurePolicy          = ($recovery -join "`n")
  }
  ```

  Do not add a remote API request to this command. Existing Admin terminal status remains the cloud-side source for heartbeat, online state, printer state, and enabled/disabled state.

- [ ] **Step 6: Make the verifier pass and run the relevant regression suite.**

  Run:

  ```bash
  pnpm --filter terminal-agent verify:windows-service-recovery
  pnpm --filter terminal-agent typecheck
  pnpm --filter terminal-agent verify:agent-profile-guard
  pnpm --filter terminal-agent verify:print-scan-agent
  ```

  Expected: all exit 0. The static verifier must prove finite action text (`restart/60000/restart/300000/""/0`), `failureflag`, query/readback, no installer test print, and diagnosis fields that report only booleans/status values.

- [ ] **Step 7: Commit the service-recovery and local-diagnosis changes.**

  ```bash
  git add \
    apps/terminal-agent/scripts/install-production-agent.ps1 \
    apps/terminal-agent/scripts/diagnose-production-agent.ps1 \
    apps/terminal-agent/scripts/verify-windows-service-recovery.mjs \
    apps/terminal-agent/package.json
  git commit -m "fix(agent): configure finite Windows service recovery"
  ```

### Task 4: Wire both verify contracts into CI and validate the full source closure

**Files:**

- Modify: `.github/workflows/ci.yml`
- Modify: `apps/terminal-agent/package.json`
- Test: existing CI `Terminal Agent verify suites` step and local equivalent commands

- [ ] **Step 1: Extend the existing Terminal Agent CI block without adding a second workflow or a Windows runner.**

  In `.github/workflows/ci.yml`, add the two local, cross-platform verifiers to the existing `Terminal Agent verify suites` command block. Keep the scripts serial and preserve all existing entries.

  ```yaml
          pnpm run verify:agent-profile-guard
          pnpm run verify:agent-config-resilience
          pnpm run verify:windows-service-recovery
          pnpm run verify:print-scan-agent
          pnpm run verify:scan-watcher
          pnpm run verify:local-qr-proxy
          pnpm run verify:usb-import-agent
  ```

  The CI runner is not a substitute for Windows SCM acceptance; it only guards the source contracts. Do not add a test that tries to invoke `sc.exe` on Linux.

- [ ] **Step 2: Run the exact CI-equivalent Agent command set locally.**

  Run:

  ```bash
  pnpm --filter terminal-agent typecheck
  pnpm --filter terminal-agent build
  pnpm --dir apps/terminal-agent run verify:agent-profile-guard
  pnpm --dir apps/terminal-agent run verify:agent-config-resilience
  pnpm --dir apps/terminal-agent run verify:windows-service-recovery
  pnpm --dir apps/terminal-agent run verify:print-scan-agent
  pnpm --dir apps/terminal-agent run verify:scan-watcher
  pnpm --dir apps/terminal-agent run verify:local-qr-proxy
  pnpm --dir apps/terminal-agent run verify:usb-import-agent
  ```

  Expected: all commands exit 0. If an existing unrelated verifier fails, record its exact name/output separately and do not label P0 complete.

- [ ] **Step 3: Inspect scope, secret safety, and diff before the CI wiring commit.**

  Run:

  ```bash
  git diff --check
  git diff --name-only origin/main...HEAD
  git diff -- apps/terminal-agent/src/agent/config-manager.ts apps/terminal-agent/src/agent/dpapi.ts apps/terminal-agent/src/agent/startup-diagnostics.ts apps/terminal-agent/src/index.ts apps/terminal-agent/scripts .github/workflows/ci.yml apps/terminal-agent/package.json
  rg -n "agentToken|adminSecret|bindCode|Authorization" apps/terminal-agent/src/agent/startup-diagnostics.ts apps/terminal-agent/scripts/diagnose-production-agent.ps1 apps/terminal-agent/scripts/verify-agent-config-resilience.mjs
  ```

  Expected: no whitespace errors; changed files remain within this plan; the diagnostic module and PowerShell output do not serialize or print secrets. The `rg` command may find the deliberately blocked field names in filters or static tests, but it must not reveal a real credential or configuration value.

- [ ] **Step 4: Commit CI wiring.**

  ```bash
  git add .github/workflows/ci.yml apps/terminal-agent/package.json
  git commit -m "ci: verify terminal agent recovery contracts"
  ```

### Task 5: Document operation, perform post-change review, and execute the no-print Windows acceptance only after separate approval

**Files:**

- Modify: `docs/device/production-agent-onboarding.md`
- Modify: `docs/progress/current-progress.md`
- Modify: `docs/progress/next-tasks.md`
- Test: documentation command blocks and a separately authorized Windows no-print procedure

- [ ] **Step 1: Update the Windows onboarding runbook with exact safe commands.**

  Add a `可靠性 P0：安装、诊断与恢复` section to `docs/device/production-agent-onboarding.md`. Include these operator commands verbatim, with placeholders only for non-secret terminal identity values and no token example:

  ```powershell
  powershell -ExecutionPolicy Bypass -File .\apps\terminal-agent\scripts\diagnose-production-agent.ps1

  sc.exe qfailure AIJobPrintAgent

  Get-CimInstance Win32_Service -Filter "Name='AIJobPrintAgent'" |
    Select-Object Name, State, StartMode, ProcessId, PathName
  ```

  State the interpretation exactly:

  - `configHasUtf8Bom = true` with `configValidJson = true` is supported by the new Agent parser and is not itself a reason to rebind.
  - `AGENT_CONFIG_INVALID_JSON`, `AGENT_CONFIG_REQUIRED_FIELD_MISSING`, or `AGENT_TOKEN_DECRYPT_FAILED` means no claim/print loop started; repair configuration or generate a new one-time binding code as applicable.
  - `AGENT_READY` means the local startup sequence passed; cloud heartbeat/terminal enabled state remains verified in Admin.
  - The first two SCM recovery actions are 60 seconds and 300 seconds; after a third failure the service remains stopped for human diagnosis. Do not configure infinite restart.

- [ ] **Step 2: Add the explicit no-print Windows acceptance procedure, gated on separate user approval.**

  Add this ordered procedure to the same runbook. It must be labeled `需要 Windows 管理员与空队列确认，不随代码合并自动执行`:

  ```text
  1. In Admin and by the existing active-task query, prove active_task_count = 0 and no task rows are returned.
  2. Back up the current agent-config.json locally; do not share its content.
  3. Add only a leading UTF-8 BOM to an otherwise valid local config copy, then start/restart AIJobPrintAgent.
  4. Run diagnose-production-agent.ps1 and inspect sc.exe qfailure AIJobPrintAgent.
  5. Confirm service Running, a later cloud heartbeat, terminal enabled, and zero new print tasks.
  6. Restore the original no-BOM config if it was changed for this test, restart once, and repeat the zero-task check.
  ```

  Explicitly prohibit `print`, `POST /print`, test-order creation, binding-code rotation unless a token failure requires it, and sending screenshots/config/token files through chat.

- [ ] **Step 3: Run two independent post-change reviews before claiming code readiness.**

  Request both configured external reviewers against the final `git diff origin/main...HEAD`, then save their actual reports under the task’s ignored `.ccg/tasks/windows-agent-reliability-p0-20260714/review.md`. A wrapper process that starts but returns no final report is not an approval and must be recorded as unavailable.

  Review checklist:

  ```text
  - Configuration parsing accepts only a leading BOM and never normalizes content elsewhere.
  - Primary config writes are validated, fsynced, atomically renamed, and never leak secrets.
  - Backup is not used as automatic runtime fallback.
  - Agent does not claim/print before classified startup succeeds.
  - SCM action count is finite and failureflag/query semantics are explicit.
  - Diagnostics do not reveal token, bind code, adminSecret, Authorization, or complete config.
  - No changed code bypasses existing bind-code, DPAPI, SQLite idempotency, or printer-name safeguards.
  ```

  Resolve every Critical finding and repeat both reviews before merge readiness. A Warning may remain only when documented with a concrete non-P0 follow-up.

- [ ] **Step 4: Update the progress SSOT only with evidence that has actually occurred.**

  After local commands and both final reviews pass, add a dated `Windows Terminal Agent P0` entry in `docs/progress/current-progress.md` stating the exact commit, source/CI commands that passed, and the distinction between source proof and Windows proof. Do not state that Windows SCM behavior or physical printing was accepted until the separately authorized no-print Windows procedure completes.

  In `docs/progress/next-tasks.md`, close only the P0 source/CI item after the above evidence. Keep a separate unchecked P1 item named `Windows Agent MSI/可修复安装包` with these boundaries: signed installer, install/repair/uninstall, preserve `%ProgramData%\\AIJobPrintAgent` state, upgrade/rollback validation, and a dedicated design/review branch. Do not begin P1 in this task.

- [ ] **Step 5: Run final documentation and repository verification.**

  Run:

  ```bash
  git diff --check
  pnpm --filter terminal-agent typecheck
  pnpm --filter terminal-agent build
  pnpm --dir apps/terminal-agent run verify:agent-config-resilience
  pnpm --dir apps/terminal-agent run verify:windows-service-recovery
  pnpm --dir apps/terminal-agent run verify:printer-config
  pnpm --dir apps/terminal-agent run verify:print-scan-agent
  git status --short --branch
  ```

  Expected: all verification commands exit 0 and the diff contains only the declared files. If Windows acceptance is not yet authorized or not yet run, report `代码与 CI 就绪；Windows 无出纸验收未执行`, not `P0 complete`.

- [ ] **Step 6: Commit documentation only after its claims match the verification evidence.**

  ```bash
  git add docs/device/production-agent-onboarding.md docs/progress/current-progress.md docs/progress/next-tasks.md
  git commit -m "docs: record terminal agent reliability operation"
  ```

## Completion evidence and merge boundary

Before a pull request is opened, pushed, merged, deployed, or a Windows service is changed, explicitly confirm the action with the user. Local source readiness requires all Task 4 commands plus final reviews. Windows P0 acceptance additionally requires the Task 5 empty-queue procedure and a fresh Admin heartbeat observation; it proves reliability behavior only, never a print-output acceptance.

The next independent project is P1 MSI packaging. It is deliberately absent from this implementation plan because packaging, signing, repair/uninstall, and upgrade rollback require a separate design, Windows build environment, and external release authority.
