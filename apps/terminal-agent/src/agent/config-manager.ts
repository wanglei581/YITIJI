/**
 * agent/config-manager.ts — Phase 8.1C
 *
 * Read and write config/agent-config.json (relative to the package root).
 *
 * Path resolution:
 *   ts-node src/index.ts  → __dirname = <pkg>/src/agent/  → ../../config = <pkg>/config/
 *   node   dist/index.js  → __dirname = <pkg>/dist/agent/ → ../../config = <pkg>/config/
 *
 * Both paths resolve to <apps/terminal-agent>/config/agent-config.json.
 *
 * Phase 8.1C changes:
 *   - loadConfig() handles Phase 8.1B → 8.1C migration:
 *     if config.json contains a plaintext agentToken, it is migrated to DPAPI
 *     encrypted agent.token and removed from config.json automatically.
 *   - loadConfig() loads agentToken from agent.token into the returned config
 *     object (in-memory only; never written back to config.json).
 *   - persistRegistration() no longer writes agentToken to config.json.
 *     Instead it: (1) saves to encrypted agent.token, (2) clears adminSecret
 *     from config.json, (3) writes only non-sensitive fields.
 */

import fs from 'fs'
import path from 'path'
import { log } from '../logger'
import { saveAgentToken, loadAgentToken } from './dpapi'
import type { AgentConfig } from './types'

const CONFIG_FILE = path.resolve(__dirname, '../../config/agent-config.json')
const EXAMPLE_FILE = path.resolve(__dirname, '../../config/agent-config.example.json')

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * Load config/agent-config.json.
 *
 * Also handles Phase 8.1B → 8.1C migration:
 *   - If config.json contains agentToken (plaintext), encrypt it to agent.token
 *     and remove it from config.json.
 *   - Load agentToken from agent.token into the returned in-memory config.
 *
 * Throws if the config file does not exist.
 */
export function loadConfig(): AgentConfig {
  if (!fs.existsSync(CONFIG_FILE)) {
    throw new Error(
      `Agent config not found: ${CONFIG_FILE}\n` +
        `Copy ${EXAMPLE_FILE} → ${CONFIG_FILE} and fill in apiBaseUrl / terminalCode / adminSecret.`,
    )
  }

  const raw = fs.readFileSync(CONFIG_FILE, 'utf-8')
  const parsed = JSON.parse(raw) as AgentConfig & { _comment?: string; agentToken?: string }
  // Remove the example-only comment field if present
  delete parsed._comment

  // ── Phase 8.1B → 8.1C migration ─────────────────────────────────────────
  if (parsed.agentToken) {
    log('config: Phase 8.1B plaintext agentToken detected — migrating to DPAPI encrypted storage')
    saveAgentToken(parsed.agentToken)
    delete parsed.agentToken
    // Write back without agentToken
    writeConfigFile(parsed)
    log('config: agentToken 已迁移至加密存储 agent.token，已从 config.json 移除')
  }

  // ── Load agentToken from encrypted file into in-memory config ────────────
  const agentToken = loadAgentToken()
  if (agentToken) {
    parsed.agentToken = agentToken
  }

  return parsed
}

// ── Write ─────────────────────────────────────────────────────────────────────

/**
 * Overwrite config/agent-config.json.
 * Strips undefined values so the JSON stays clean.
 * Never writes agentToken (it lives in agent.token, not config.json).
 */
export function saveConfig(config: AgentConfig): void {
  writeConfigFile(config)
}

/** Internal helper: serialise to JSON, excluding undefined fields and agentToken. */
function writeConfigFile(config: AgentConfig): void {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true })
  // Exclude agentToken and any undefined fields
  const toWrite = Object.fromEntries(
    Object.entries(config).filter(([key, val]) => key !== 'agentToken' && val !== undefined),
  )
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(toWrite, null, 2), 'utf-8')
}

// ── Registration ──────────────────────────────────────────────────────────────

/**
 * Persist terminalId after successful registration:
 *   1. Encrypt and save agentToken to agent.token.
 *   2. Write config.json with terminalId; clear adminSecret (no longer needed).
 *      agentToken is NOT written to config.json.
 *   3. Return the in-memory config with agentToken populated.
 */
export function persistRegistration(
  config: AgentConfig,
  terminalId: string,
  agentToken: string,
): AgentConfig {
  // Step 1: encrypt agentToken to disk
  saveAgentToken(agentToken)

  // Step 2: write config.json — include terminalId, omit adminSecret and agentToken
  const updated: AgentConfig = {
    ...config,
    terminalId,
    adminSecret: undefined,  // cleared — no longer needed after registration
    agentToken: undefined,    // not stored in config.json; lives in agent.token
  }
  writeConfigFile(updated)
  log(`config: registration persisted — terminalId=${terminalId}, adminSecret cleared`)

  // Step 3: return in-memory config with agentToken available for this session
  return { ...updated, agentToken }
}
