import type { AgentConfig } from './types'

const LOCAL_DEBUG_PROFILE = 'local-debug'
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0'])

export function isLocalApiBaseUrl(apiBaseUrl: string): boolean {
  try {
    const url = new URL(apiBaseUrl)
    return LOOPBACK_HOSTS.has(url.hostname.toLowerCase())
  } catch {
    return false
  }
}

export function assertAgentProfileAllowsApiBaseUrl(
  config: Pick<AgentConfig, 'apiBaseUrl'>,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const profile = (env['AGENT_PROFILE'] ?? '').trim().toLowerCase()
  if (!isLocalApiBaseUrl(config.apiBaseUrl)) return
  if (profile === LOCAL_DEBUG_PROFILE) return

  throw new Error(
    [
      'AGENT_PROFILE_REQUIRED_FOR_LOCAL_API: production Agent cannot point to localhost.',
      `apiBaseUrl=${config.apiBaseUrl}`,
      `Set AGENT_PROFILE=${LOCAL_DEBUG_PROFILE} only for explicit local debugging,`,
      'or run install-production-agent.ps1 with the cloud /api/v1 endpoint before starting the service.',
    ].join(' '),
  )
}
