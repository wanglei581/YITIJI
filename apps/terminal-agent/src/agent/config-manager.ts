/**
 * Read and safely persist the Terminal Agent configuration.
 *
 * Configuration is deliberately kept separate from the DPAPI token.  The
 * persisted JSON never contains credentials, while the returned AgentConfig
 * may contain an in-memory agentToken for the current process only.
 */

import fs from 'fs'
import path from 'path'
import { spawnSync } from 'child_process'
import { log } from '../logger'
import { clearUnauthorized } from './auth-state'
import { loadAgentToken, saveAgentToken } from './dpapi'
import type { AgentConfig } from './types'

const LEGACY_CONFIG_DIRECTORY = path.resolve(__dirname, '../../config')
const PERSISTED_SECRET_KEYS = new Set(['_comment', 'agentToken', 'adminSecret', 'bindCode'])

export type AgentStartupErrorCode =
  | 'AGENT_CONFIG_NOT_FOUND'
  | 'AGENT_CONFIG_INVALID_JSON'
  | 'AGENT_CONFIG_INVALID_SHAPE'
  | 'AGENT_CONFIG_REQUIRED_FIELD_MISSING'
  | 'AGENT_CONFIG_INVALID_FIELD'
  | 'AGENT_CONFIG_MIGRATION_REQUIRES_REBIND'
  | 'AGENT_CONFIG_PROGRAM_DATA_ACL_UNSAFE'
  | 'AGENT_TOKEN_DECRYPT_FAILED'
  | 'AGENT_PROFILE_REJECTED'
  | 'AGENT_REGISTRATION_FAILED'
  | 'AGENT_STARTUP_FAILED'
  | 'AGENT_UNAUTHORIZED'
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

export interface AgentConfigPaths {
  readonly configPath: string
  readonly lastKnownGoodPath: string
  readonly legacyConfigPath: string
  readonly legacyLastKnownGoodPath: string
  readonly usesProgramData: boolean
}

/** Resolve the production state root while retaining a one-release legacy read path. */
export function resolveAgentConfigPaths(options?: {
  platform?: NodeJS.Platform
  programDataDir?: string
  legacyConfigDirectory?: string
}): AgentConfigPaths {
  const platform = options?.platform ?? process.platform
  const legacyConfigDirectory = options?.legacyConfigDirectory ?? LEGACY_CONFIG_DIRECTORY
  const legacyConfigPath = path.join(legacyConfigDirectory, 'agent-config.json')
  const legacyLastKnownGoodPath = path.join(legacyConfigDirectory, 'agent-config.last-known-good.json')

  if (platform !== 'win32') {
    return {
      configPath: legacyConfigPath,
      lastKnownGoodPath: legacyLastKnownGoodPath,
      legacyConfigPath,
      legacyLastKnownGoodPath,
      usesProgramData: false,
    }
  }

  const programDataDir = options?.programDataDir ?? process.env['PROGRAMDATA'] ?? 'C:\\ProgramData'
  const configDirectory = path.join(programDataDir, 'AIJobPrintAgent')
  return {
    configPath: path.join(configDirectory, 'agent-config.json'),
    lastKnownGoodPath: path.join(configDirectory, 'agent-config.last-known-good.json'),
    legacyConfigPath,
    legacyLastKnownGoodPath,
    usesProgramData: true,
  }
}

function requireNonEmpty(value: unknown, field: string): string {
  if (value === undefined) {
    throw new AgentStartupError('AGENT_CONFIG_REQUIRED_FIELD_MISSING', `agent-config.json requires ${field}`)
  }
  if (typeof value !== 'string') {
    throw new AgentStartupError('AGENT_CONFIG_INVALID_FIELD', `agent-config.json has invalid ${field}`)
  }
  if (!value.trim()) {
    throw new AgentStartupError('AGENT_CONFIG_REQUIRED_FIELD_MISSING', `agent-config.json requires ${field}`)
  }
  return value.trim()
}

function requireOptionalPositiveInteger(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value
  throw new AgentStartupError('AGENT_CONFIG_INVALID_FIELD', `agent-config.json has invalid ${field}`)
}

function requireOptionalNonNegativeInteger(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value
  throw new AgentStartupError('AGENT_CONFIG_INVALID_FIELD', `agent-config.json has invalid ${field}`)
}

function requireOptionalNonEmptyString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'string' && value.trim()) return value
  throw new AgentStartupError('AGENT_CONFIG_INVALID_FIELD', `agent-config.json has invalid ${field}`)
}

function requireOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'string') return value
  throw new AgentStartupError('AGENT_CONFIG_INVALID_FIELD', `agent-config.json has invalid ${field}`)
}

function requireOptionalStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined
  if (Array.isArray(value) && value.every((entry) => typeof entry === 'string')) {
    return value
  }
  throw new AgentStartupError('AGENT_CONFIG_INVALID_FIELD', `agent-config.json has invalid ${field}`)
}

function validateConfigShape(config: AgentConfig): AgentConfig {
  const terminalId = requireOptionalString(config.terminalId, 'terminalId')
  const agentToken = requireOptionalNonEmptyString(config.agentToken, 'agentToken')
  const adminSecret = requireOptionalNonEmptyString(config.adminSecret, 'adminSecret')
  const scanWatchFolder = requireOptionalString(config.scanWatchFolder, 'scanWatchFolder')
  const localApiBridgeToken = requireOptionalString(config.localApiBridgeToken, 'localApiBridgeToken')
  const localApiAllowedOrigins = requireOptionalStringArray(
    config.localApiAllowedOrigins,
    'localApiAllowedOrigins',
  )

  return {
    ...config,
    apiBaseUrl: requireNonEmpty(config.apiBaseUrl, 'apiBaseUrl'),
    terminalCode: requireNonEmpty(config.terminalCode, 'terminalCode'),
    printerName: requireNonEmpty(config.printerName, 'printerName'),
    agentVersion: requireNonEmpty(config.agentVersion, 'agentVersion'),
    heartbeatIntervalMs: requireOptionalPositiveInteger(config.heartbeatIntervalMs, 'heartbeatIntervalMs'),
    claimIntervalMs: requireOptionalPositiveInteger(config.claimIntervalMs, 'claimIntervalMs'),
    localApiPort: requireOptionalNonNegativeInteger(config.localApiPort, 'localApiPort'),
    terminalId,
    agentToken,
    adminSecret,
    scanWatchFolder,
    localApiBridgeToken,
    localApiAllowedOrigins,
  }
}

/** Preserve the established validation entry point while applying the full shape contract. */
function validateRequiredConfig(config: AgentConfig): AgentConfig {
  return validateConfigShape(config)
}

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

  const config = { ...(parsed as Record<string, unknown>) } as unknown as AgentConfig & { _comment?: unknown }
  delete config._comment
  return validateRequiredConfig(config)
}

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
    fs.closeSync(fd)
    fd = undefined
    fs.renameSync(tempPath, filePath)
  } finally {
    if (fd !== undefined) fs.closeSync(fd)
    fs.rmSync(tempPath, { force: true })
  }
}

export function writeValidatedConfigAt(
  configPath: string,
  lastKnownGoodPath: string,
  nextConfig: AgentConfig,
): void {
  const nextText = serializePersistedConfig(nextConfig)
  const currentConfig = fs.existsSync(configPath)
    ? parseConfigText(fs.readFileSync(configPath, 'utf8'))
    : undefined
  if (currentConfig) writeTextAtomically(lastKnownGoodPath, serializePersistedConfig(currentConfig))
  writeTextAtomically(configPath, nextText)
}

function readOptionalValidatedConfig(filePath: string, ignoreInvalid = false): AgentConfig | undefined {
  if (!fs.existsSync(filePath)) return undefined
  try {
    return parseConfigText(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    if (ignoreInvalid) {
      log('config: ignoring an invalid legacy last-known-good candidate during migration')
      return undefined
    }
    throw error
  }
}

function withoutPersistedSecrets(config: AgentConfig): AgentConfig {
  return {
    ...config,
    agentToken: undefined,
    adminSecret: undefined,
  }
}

/**
 * Verify that the ProgramData state root retains the installer ACL before a
 * service runtime writes the migrated configuration into it.
 */
function assertSecureProgramDataDirectory(directory: string): void {
  const script = [
    '$path = [Console]::In.ReadLine()',
    '$item = Get-Item -LiteralPath $path -Force -ErrorAction Stop',
    'if (-not $item.PSIsContainer -or (($item.Attributes -band [System.IO.FileAttributes]::ReparsePoint) -ne 0)) { exit 1 }',
    '$acl = Get-Acl -LiteralPath $path -ErrorAction Stop',
    'if (-not $acl.AreAccessRulesProtected) { exit 1 }',
    '$required = @("S-1-5-18", "S-1-5-32-544")',
    '$owner = ([System.Security.Principal.NTAccount]$acl.Owner).Translate([System.Security.Principal.SecurityIdentifier]).Value',
    'if ($required -notcontains $owner) { exit 1 }',
    '$rules = @($acl.Access | Where-Object { $_.AccessControlType -eq [System.Security.AccessControl.AccessControlType]::Allow })',
    'if ($rules.Count -ne 2) { exit 1 }',
    'foreach ($rule in $rules) { $sid = ([System.Security.Principal.NTAccount]$rule.IdentityReference).Translate([System.Security.Principal.SecurityIdentifier]).Value; if ($required -notcontains $sid -or $rule.IsInherited -or $rule.FileSystemRights -ne [System.Security.AccessControl.FileSystemRights]::FullControl) { exit 1 } }',
    'Write-Output ok',
  ].join('; ')
  const result = spawnSync('powershell', ['-NonInteractive', '-NoProfile', '-Command', script], {
    input: directory,
    encoding: 'utf8',
    timeout: 10_000,
  })
  if (result.error || result.status !== 0 || (result.stdout as string).trim() !== 'ok') {
    throw new AgentStartupError(
      'AGENT_CONFIG_PROGRAM_DATA_ACL_UNSAFE',
      'ProgramData configuration directory is not protected for terminal state; rerun the production installer before starting the Agent.',
    )
  }
}

/** Move a legacy installation-root config into ProgramData exactly once. */
export function migrateLegacyConfigAt(
  paths: AgentConfigPaths,
  legacyConfig: AgentConfig,
  options?: {
    hasPersistedToken?: () => boolean
    assertSecureDirectory?: (directory: string) => void
  },
): AgentConfig {
  if (!paths.usesProgramData) return legacyConfig
  const hasPersistedToken = options?.hasPersistedToken ?? (() => loadAgentToken() !== null)
  const assertSecureDirectory = options?.assertSecureDirectory ?? assertSecureProgramDataDirectory
  if (legacyConfig.adminSecret || (legacyConfig.agentToken && !hasPersistedToken())) {
    throw new AgentStartupError(
      'AGENT_CONFIG_MIGRATION_REQUIRES_REBIND',
      'Legacy credential configuration cannot be migrated safely; rebind this terminal with a new one-time code.',
    )
  }

  assertSecureDirectory(path.dirname(paths.configPath))
  const migratedConfig = withoutPersistedSecrets(legacyConfig)
  const legacyLastKnownGood = readOptionalValidatedConfig(paths.legacyLastKnownGoodPath, true)
  const migratedLastKnownGood = withoutPersistedSecrets(legacyLastKnownGood ?? legacyConfig)

  // Scrub the legacy files before creating the new root. If the new-root write
  // is interrupted, the next startup retries without retaining JSON credentials.
  writeTextAtomically(paths.legacyConfigPath, serializePersistedConfig(migratedConfig))
  if (legacyLastKnownGood) {
    writeTextAtomically(paths.legacyLastKnownGoodPath, serializePersistedConfig(migratedLastKnownGood))
  }
  writeTextAtomically(paths.lastKnownGoodPath, serializePersistedConfig(migratedLastKnownGood))
  writeTextAtomically(paths.configPath, serializePersistedConfig(migratedConfig))
  log('config: migrated legacy installation-root config into ProgramData')
  return migratedConfig
}

function loadPersistedConfig(paths: AgentConfigPaths): AgentConfig {
  const persisted = readOptionalValidatedConfig(paths.configPath)
  if (persisted) return persisted

  const legacyConfig = paths.usesProgramData
    ? readOptionalValidatedConfig(paths.legacyConfigPath)
    : undefined
  if (legacyConfig) return migrateLegacyConfigAt(paths, legacyConfig)

  throw new AgentStartupError(
    'AGENT_CONFIG_NOT_FOUND',
    'Agent configuration was not found. Repair the terminal configuration before starting the Agent.',
  )
}

/**
 * Load configuration, optionally migrating an existing persisted plaintext
 * token only after the primary configuration has passed validation.
 */
export function loadConfig(): AgentConfig {
  const paths = resolveAgentConfigPaths()
  const parsed = loadPersistedConfig(paths)

  if (parsed.agentToken) {
    if (paths.usesProgramData) {
      assertSecureProgramDataDirectory(path.dirname(paths.configPath))
    }
    log('config: plaintext agentToken detected — migrating to DPAPI encrypted storage')
    saveAgentToken(parsed.agentToken)
    saveConfig(parsed)
    log('config: agentToken migrated to encrypted storage and removed from agent-config.json')
  }

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
}

/** Persist a credential-free, validated configuration and keep a manual recovery candidate. */
export function saveConfig(config: AgentConfig): void {
  const paths = resolveAgentConfigPaths()
  writeValidatedConfigAt(paths.configPath, paths.lastKnownGoodPath, config)
}

/**
 * Persist registration after successful binding without storing either the
 * registration secret or the bearer token in agent-config.json.
 */
export function persistRegistration(
  config: AgentConfig,
  terminalId: string,
  agentToken: string,
): AgentConfig {
  saveAgentToken(agentToken)

  const updated: AgentConfig = {
    ...config,
    terminalId,
    adminSecret: undefined,
    agentToken: undefined,
  }
  saveConfig(updated)
  clearUnauthorized()
  log(`config: registration persisted — terminalId=${terminalId}, adminSecret cleared`)

  return { ...updated, agentToken }
}
