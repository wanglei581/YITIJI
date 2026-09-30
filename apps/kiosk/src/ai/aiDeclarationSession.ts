import {
  AGE_14_PLUS_CONSENT_VERSION,
  AGE_14_PLUS_SCOPE,
  AI_DECLARATION_SESSION_KEY,
  VOICE_RECORDING_CONSENT_VERSION,
  VOICE_RECORDING_SCOPE,
  type DeclarationScope,
} from './aiDeclarationVersions'

export type PromptDecision = 'yes' | 'no' | 'cleared'

interface StoredGrants {
  fp: string
  scopes: string[]
}

interface StoredDeclaration {
  v: 1
  age?: string
  voice?: string
  grants?: StoredGrants
}

interface PromptWaiter {
  scope: DeclarationScope
  epochAtAsk: number
  resolve: (decision: PromptDecision) => void
}

let epoch = 0
let active: PromptWaiter | null = null
const queue: PromptWaiter[] = []
const listeners = new Set<() => void>()

function notify(): void {
  for (const listener of listeners) listener()
}

function storage(): Storage | null {
  try {
    if (typeof window === 'undefined' || !window.sessionStorage) return null
    return window.sessionStorage
  } catch {
    return null
  }
}

function readStored(): StoredDeclaration | null {
  const bin = storage()
  if (!bin) return null
  try {
    const raw = bin.getItem(AI_DECLARATION_SESSION_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredDeclaration
    if (!parsed || parsed.v !== 1) return null
    return parsed
  } catch {
    return null
  }
}

function writeStored(next: StoredDeclaration): void {
  const bin = storage()
  if (!bin) return
  try {
    bin.setItem(AI_DECLARATION_SESSION_KEY, JSON.stringify(next))
  } catch {
    /* 写不进就当没记下，下一次还会再问 */
  }
}

export function aiDeclarationEpoch(): number {
  return epoch
}

export function isScopeDeclared(scope: DeclarationScope): boolean {
  const stored = readStored()
  if (!stored) return false
  if (scope === AGE_14_PLUS_SCOPE) return stored.age === AGE_14_PLUS_CONSENT_VERSION
  return stored.voice === VOICE_RECORDING_CONSENT_VERSION
}

export function markScopeDeclared(scope: DeclarationScope): void {
  const stored = readStored() ?? { v: 1 as const }
  if (scope === AGE_14_PLUS_SCOPE) stored.age = AGE_14_PLUS_CONSENT_VERSION
  else stored.voice = VOICE_RECORDING_CONSENT_VERSION
  stored.v = 1
  writeStored(stored)
}

export function clearDeclaredScopes(scopes: readonly DeclarationScope[]): void {
  const stored = readStored()
  if (!stored) return
  if (scopes.includes(AGE_14_PLUS_SCOPE)) delete stored.age
  if (scopes.includes(VOICE_RECORDING_SCOPE)) delete stored.voice
  if (stored.grants) {
    stored.grants = {
      fp: stored.grants.fp,
      scopes: stored.grants.scopes.filter((scope) => !scopes.includes(scope as DeclarationScope)),
    }
  }
  writeStored(stored)
}

/** 不存令牌原文，只存这一次办理的指纹，用来认出「还是刚才那位登录会员」。 */
export function bearerFingerprint(token: string): string {
  let hash = 5381
  for (let index = 0; index < token.length; index += 1) {
    hash = ((hash * 33) ^ token.charCodeAt(index)) >>> 0
  }
  return hash.toString(16)
}

export function serverGrantCovers(scope: DeclarationScope, bearer: string | null): boolean {
  if (!bearer) return false
  const grants = readStored()?.grants
  if (!grants || grants.fp !== bearerFingerprint(bearer)) return false
  return grants.scopes.includes(scope)
}

export function rememberServerGrant(scope: DeclarationScope, bearer: string): void {
  const stored = readStored() ?? { v: 1 as const }
  const fp = bearerFingerprint(bearer)
  const scopes = stored.grants && stored.grants.fp === fp ? [...stored.grants.scopes] : []
  if (!scopes.includes(scope)) scopes.push(scope)
  stored.v = 1
  stored.grants = { fp, scopes }
  writeStored(stored)
}

function dropWaiter(waiter: PromptWaiter): void {
  waiter.resolve('cleared')
}

function promote(): void {
  active = queue.shift() ?? null
  if (active && active.epochAtAsk !== epoch) {
    const stale = active
    active = null
    stale.resolve('cleared')
    promote()
    return
  }
  notify()
}

/**
 * 清掉这一次办理的声明，并让还开着的确认作废。
 * 隐私清场、结束使用、待机、换终端会话、换会员都会走到这里。
 */
export function clearAiDeclarationSession(): void {
  const bin = storage()
  try {
    bin?.removeItem(AI_DECLARATION_SESSION_KEY)
  } catch {
    /* 读不到就当已经空了 */
  }
  epoch += 1
  const pending = active ? [active, ...queue] : [...queue]
  active = null
  queue.length = 0
  for (const waiter of pending) dropWaiter(waiter)
  notify()
}

export function currentDeclarationPrompt(): { scope: DeclarationScope; epochAtAsk: number } | null {
  if (!active || active.epochAtAsk !== epoch) return null
  return { scope: active.scope, epochAtAsk: active.epochAtAsk }
}

export function subscribeDeclarationPrompt(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function askDeclaration(scope: DeclarationScope): Promise<PromptDecision> {
  return new Promise((resolve) => {
    const waiter: PromptWaiter = { scope, epochAtAsk: epoch, resolve }
    if (!active) {
      active = waiter
      notify()
      return
    }
    queue.push(waiter)
  })
}

export function settleDeclarationPrompt(decision: PromptDecision): void {
  const current = active
  if (!current) return
  active = null
  current.resolve(current.epochAtAsk !== epoch || decision === 'cleared' ? 'cleared' : decision)
  // 同意后会同步开始下一项确认，那一项已经写入 active。这里再 promote 会把它清掉，语音第二项就永远等不到结果。
  if (!active) promote()
}
