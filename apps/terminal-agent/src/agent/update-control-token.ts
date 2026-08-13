import crypto from 'node:crypto'
import type { AgentConfig } from './types'

/** Ensure upgraded installations have a strong loopback-only updater credential. */
export function ensureLocalUpdateControlToken(
  config: AgentConfig,
  persist: (updated: AgentConfig) => void,
  randomBytes: (size: number) => Buffer = crypto.randomBytes,
): AgentConfig {
  if (isValidLocalUpdateControlToken(config.localUpdateControlToken)) return config

  const updated: AgentConfig = {
    ...config,
    localUpdateControlToken: randomBytes(32).toString('base64'),
  }
  persist(updated)
  return updated
}

export function isValidLocalUpdateControlToken(value: string | undefined): value is string {
  if (!value || !/^[A-Za-z0-9+/]{43}=$/.test(value)) return false
  const decoded = Buffer.from(value, 'base64')
  return decoded.length === 32 && decoded.toString('base64') === value
}
