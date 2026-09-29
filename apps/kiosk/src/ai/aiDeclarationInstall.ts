import { API_BASE_URL } from '../services/api/client'
import { getTerminalId } from '../services/api/screensaver'
import { getCachedKioskTerminalConfig, peekCachedKioskTerminalConfig } from '../services/api/terminalConfig'
import { registerAiDeclarationBridge } from '../services/terminalAuth'
import { configureAiDeclaration, prepareAiDeclaration, recoverAiDeclaration } from './aiDeclarationGate'
import type { DeclarationScope } from './aiDeclarationVersions'

async function readEnforced(): Promise<boolean | null> {
  try {
    const terminalId = getTerminalId()
    if (!terminalId) return null
    const peeked = peekCachedKioskTerminalConfig(terminalId)
    const config = peeked ?? await getCachedKioskTerminalConfig(terminalId)
    const flag = config.ai?.declarationEnforced
    return typeof flag === 'boolean' ? flag : null
  } catch {
    return null
  }
}

async function grantConsent(scope: DeclarationScope, bearer: string): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/me/ai-consents`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bearer}`,
      },
      credentials: 'include',
      body: JSON.stringify({ scope }),
      signal: AbortSignal.timeout(4_000),
    })
    return response.ok
  } catch {
    return false
  }
}

configureAiDeclaration({ readEnforced, grantConsent })

registerAiDeclarationBridge({
  prepare: prepareAiDeclaration,
  recover: recoverAiDeclaration,
})
