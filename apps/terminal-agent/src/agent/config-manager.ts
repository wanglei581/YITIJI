/**
 * agent/config-manager.ts — Phase 8.1B
 *
 * Read and write config/agent-config.json (relative to the package root).
 *
 * Path resolution:
 *   ts-node src/index.ts  → __dirname = <pkg>/src/agent/  → ../../config = <pkg>/config/
 *   node   dist/index.js  → __dirname = <pkg>/dist/agent/ → ../../config = <pkg>/config/
 *
 * Both paths resolve to <apps/terminal-agent>/config/agent-config.json, which is correct.
 */

import fs from 'fs'
import path from 'path'
import type { AgentConfig } from './types'

const CONFIG_FILE = path.resolve(__dirname, '../../config/agent-config.json')
const EXAMPLE_FILE = path.resolve(__dirname, '../../config/agent-config.example.json')

/** Load config/agent-config.json. Throws if file does not exist. */
export function loadConfig(): AgentConfig {
  if (!fs.existsSync(CONFIG_FILE)) {
    throw new Error(
      `Agent config not found: ${CONFIG_FILE}\n` +
        `Copy ${EXAMPLE_FILE} → ${CONFIG_FILE} and fill in apiBaseUrl / terminalCode / adminSecret.`,
    )
  }
  const raw = fs.readFileSync(CONFIG_FILE, 'utf-8')
  const parsed = JSON.parse(raw) as AgentConfig & { _comment?: string }
  // Remove the example-only comment field if present
  delete parsed._comment
  return parsed
}

/** Overwrite config/agent-config.json with updated config. */
export function saveConfig(config: AgentConfig): void {
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true })
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8')
}

/**
 * Persist terminalId + agentToken after successful registration.
 * Writes back to config file so next restart skips registration.
 */
export function persistRegistration(
  config: AgentConfig,
  terminalId: string,
  agentToken: string,
): AgentConfig {
  const updated: AgentConfig = { ...config, terminalId, agentToken }
  saveConfig(updated)
  return updated
}
