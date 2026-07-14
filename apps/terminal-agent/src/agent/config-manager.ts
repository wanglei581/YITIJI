/**
 * Read and safely persist the Terminal Agent configuration.
 *
 * Configuration is deliberately kept separate from the DPAPI token.  The
 * persisted JSON never contains credentials, while the returned AgentConfig
 * may contain an in-memory agentToken for the current process only.
 */

import fs from 'fs'
import path from 'path'
import { log } from '../logger'
import { loadAgentToken, saveAgentToken } from './dpapi'
import type { AgentConfig } from './types'

const CONFIG_FILE = path.resolve(__dirname, '../../config/agent-config.json')
const LAST_KNOWN_GOOD_FILE = path.resolve(__dirname, '../../config/agent-config.last-known-good.json')
const PERSISTED_SECRET_KEYS = new Set(['_comment', 'agentToken', 'adminSecret', 'bindCode'])

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

function requireOptionalNonEmptyString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value === 'string' && value.trim()) return value
  throw new AgentStartupError('AGENT_CONFIG_INVALID_FIELD', `agent-config.json has invalid ${field}`)
}

function requireOptionalNonEmptyStringArray(value: unknown, field: string): string[] | undefined {
  if (value === undefined) return undefined
  if (Array.isArray(value) && value.length > 0 && value.every((entry) => typeof entry === 'string' && entry.trim())) {
    return value
  }
  throw new AgentStartupError('AGENT_CONFIG_INVALID_FIELD', `agent-config.json has invalid ${field}`)
}

function validateConfigShape(config: AgentConfig): AgentConfig {
  const terminalId = requireOptionalNonEmptyString(config.terminalId, 'terminalId')
  const agentToken = requireOptionalNonEmptyString(config.agentToken, 'agentToken')
  const adminSecret = requireOptionalNonEmptyString(config.adminSecret, 'adminSecret')
  const scanWatchFolder = requireOptionalNonEmptyString(config.scanWatchFolder, 'scanWatchFolder')
  const localApiBridgeToken = requireOptionalNonEmptyString(config.localApiBridgeToken, 'localApiBridgeToken')
  const localApiAllowedOrigins = requireOptionalNonEmptyStringArray(
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
    localApiPort: requireOptionalPositiveInteger(config.localApiPort, 'localApiPort'),
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

/**
 * Load configuration, optionally migrating the legacy plaintext token only
 * after the primary configuration has passed validation.
 */
export function loadConfig(): AgentConfig {
  if (!fs.existsSync(CONFIG_FILE)) {
    throw new AgentStartupError(
      'AGENT_CONFIG_NOT_FOUND',
      'Agent configuration was not found. Repair the terminal configuration before starting the Agent.',
    )
  }

  const parsed = parseConfigText(fs.readFileSync(CONFIG_FILE, 'utf8'))

  if (parsed.agentToken) {
    log('config: legacy plaintext agentToken detected — migrating to DPAPI encrypted storage')
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
  writeValidatedConfigAt(CONFIG_FILE, LAST_KNOWN_GOOD_FILE, config)
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
  log(`config: registration persisted — terminalId=${terminalId}, adminSecret cleared`)

  return { ...updated, agentToken }
}
