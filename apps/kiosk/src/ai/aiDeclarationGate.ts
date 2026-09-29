import { API_BASE_URL } from '../services/api/client'
import { AiDeclarationClearedError, AiDeclarationDeclinedError } from './aiDeclarationErrors'
import {
  aiDeclarationEpoch,
  askDeclaration,
  clearDeclaredScopes,
  isScopeDeclared,
  markScopeDeclared,
  rememberServerGrant,
  serverGrantCovers,
} from './aiDeclarationSession'
import {
  AGE_14_PLUS_CONSENT_VERSION,
  AGE_14_PLUS_FLAG,
  AGE_14_PLUS_HEADER,
  AGE_14_PLUS_SCOPE,
  AGE_14_PLUS_VERSION_HEADER,
  AI_DECLARATION_REQUIRED_CODE,
  VOICE_RECORDING_CONSENT_VERSION,
  VOICE_RECORDING_FLAG,
  VOICE_RECORDING_HEADER,
  VOICE_RECORDING_SCOPE,
  VOICE_RECORDING_VERSION_HEADER,
  type DeclarationScope,
} from './aiDeclarationVersions'
import { lookupAiUseKind, type AiUseKind } from './aiUseKindTable'

export interface AiDeclarationDeps {
  /** true 要声明，false 开关关着，null 读不到（不预先问，403 再问）。 */
  readEnforced: () => Promise<boolean | null>
  /** 登录会员顺手写入服务端授权。失败返回 false，这次仍带头。 */
  grantConsent: (scope: DeclarationScope, bearer: string) => Promise<boolean>
}

const defaultDeps: AiDeclarationDeps = {
  readEnforced: async () => null,
  grantConsent: async () => false,
}

let deps: AiDeclarationDeps = defaultDeps

export function configureAiDeclaration(next: Partial<AiDeclarationDeps>): void {
  deps = { ...deps, ...next }
}

const SCOPE_META: Record<DeclarationScope, { header: string; versionHeader: string; flag: string; version: string }> = {
  [AGE_14_PLUS_SCOPE]: {
    header: AGE_14_PLUS_HEADER,
    versionHeader: AGE_14_PLUS_VERSION_HEADER,
    flag: AGE_14_PLUS_FLAG,
    version: AGE_14_PLUS_CONSENT_VERSION,
  },
  [VOICE_RECORDING_SCOPE]: {
    header: VOICE_RECORDING_HEADER,
    versionHeader: VOICE_RECORDING_VERSION_HEADER,
    flag: VOICE_RECORDING_FLAG,
    version: VOICE_RECORDING_CONSENT_VERSION,
  },
}

export function scopesForKind(kind: AiUseKind | null): DeclarationScope[] {
  if (kind === 'voice') return [AGE_14_PLUS_SCOPE, VOICE_RECORDING_SCOPE]
  if (kind === 'generate') return [AGE_14_PLUS_SCOPE]
  return []
}

function requestTarget(input: RequestInfo | URL, init: RequestInit): { method: string; raw: string } {
  if (typeof Request !== 'undefined' && input instanceof Request) {
    return {
      method: (init.method ?? input.method ?? 'GET').toUpperCase(),
      raw: input.url,
    }
  }
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.toString() : String(input)
  return { method: (init.method ?? 'GET').toUpperCase(), raw }
}

export function aiRequestPath(input: RequestInfo | URL, init: RequestInit = {}): string {
  const { raw } = requestTarget(input, init)
  let pathname = raw
  try {
    pathname = new URL(raw, 'http://localhost').pathname
  } catch {
    /* 保持原样 */
  }
  let basePath = '/api/v1'
  try {
    basePath = new URL(API_BASE_URL, 'http://localhost').pathname.replace(/\/+$/, '') || '/api/v1'
  } catch {
    /* 默认前缀 */
  }
  if (basePath && (pathname === basePath || pathname.startsWith(`${basePath}/`))) {
    pathname = pathname.slice(basePath.length) || '/'
  }
  if (!pathname.startsWith('/')) pathname = `/${pathname}`
  return pathname.replace(/\/+$/, '') || '/'
}

export function classifyAiRequest(input: RequestInfo | URL, init: RequestInit = {}): AiUseKind | null {
  const target = requestTarget(input, init)
  return lookupAiUseKind(target.method, aiRequestPath(input, init))
}

function readBearer(init: RequestInit): string | null {
  const headers = new Headers(init.headers)
  const value = headers.get('authorization')
  if (!value) return null
  const match = /^Bearer\s+(\S+)/i.exec(value)
  return match?.[1] ?? null
}

function withDeclarationHeaders(init: RequestInit, extra: Record<string, string>): RequestInit {
  if (Object.keys(extra).length === 0) return init
  const headers = new Headers(init.headers)
  for (const [name, value] of Object.entries(extra)) headers.set(name, value)
  return { ...init, headers }
}

/** 只给这个种类需要、且这一次还没成功写进服务端的项带头。生成类不带录音头。 */
export function declarationHeadersFor(
  scopes: readonly DeclarationScope[],
  bearer: string | null,
): Record<string, string> {
  const headers: Record<string, string> = {}
  for (const scope of scopes) {
    if (!isScopeDeclared(scope)) continue
    if (serverGrantCovers(scope, bearer)) continue
    const meta = SCOPE_META[scope]
    headers[meta.header] = meta.flag
    headers[meta.versionHeader] = meta.version
  }
  return headers
}

function assertStillThisVisit(epochAtStart: number): void {
  if (aiDeclarationEpoch() !== epochAtStart) throw new AiDeclarationClearedError()
}

async function ensureScopes(scopes: readonly DeclarationScope[], bearer: string | null, epochAtStart: number): Promise<void> {
  for (const scope of scopes) {
    assertStillThisVisit(epochAtStart)
    if (isScopeDeclared(scope)) continue
    const decision = await askDeclaration(scope)
    assertStillThisVisit(epochAtStart)
    if (decision === 'cleared') throw new AiDeclarationClearedError()
    if (decision !== 'yes') throw new AiDeclarationDeclinedError(scope)
    markScopeDeclared(scope)
    if (bearer) {
      const granted = await deps.grantConsent(scope, bearer)
      assertStillThisVisit(epochAtStart)
      if (granted) rememberServerGrant(scope, bearer)
    }
  }
}

function isDeclarationScope(value: unknown): value is DeclarationScope {
  return value === AGE_14_PLUS_SCOPE || value === VOICE_RECORDING_SCOPE
}

export async function readDeclarationMissing(response: Response): Promise<DeclarationScope[] | null> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    return null
  }
  const error = body && typeof body === 'object' && 'error' in body
    ? (body as { error?: unknown }).error
    : body
  if (!error || typeof error !== 'object') return null
  const code = (error as { code?: unknown }).code
  if (code !== AI_DECLARATION_REQUIRED_CODE) return null
  const record = error as { missing?: unknown; details?: unknown }
  const raw = Array.isArray(record.missing) ? record.missing : Array.isArray(record.details) ? record.details : []
  return raw.filter(isDeclarationScope)
}

function scopesFromMissing(missing: readonly DeclarationScope[], kind: AiUseKind | null): DeclarationScope[] {
  if (missing.length > 0) return [...missing]
  const required = scopesForKind(kind)
  if (required.length > 0) return required
  return [AGE_14_PLUS_SCOPE, VOICE_RECORDING_SCOPE]
}

export async function prepareAiDeclaration(
  input: RequestInfo | URL,
  init: RequestInit,
): Promise<{ input: RequestInfo | URL; init: RequestInit }> {
  const kind = classifyAiRequest(input, init)
  const scopes = scopesForKind(kind)
  if (scopes.length === 0) return { input, init }
  const enforced = await deps.readEnforced()
  if (enforced !== true) return { input, init }
  const bearer = readBearer(init)
  const epochAtStart = aiDeclarationEpoch()
  await ensureScopes(scopes, bearer, epochAtStart)
  assertStillThisVisit(epochAtStart)
  return { input, init: withDeclarationHeaders(init, declarationHeadersFor(scopes, bearer)) }
}

export async function recoverAiDeclaration(
  input: RequestInfo | URL,
  init: RequestInit,
  response: Response,
): Promise<{ input: RequestInfo | URL; init: RequestInit } | null> {
  if (response.status !== 403) return null
  const missing = await readDeclarationMissing(response)
  if (!missing) return null
  const kind = classifyAiRequest(input, init)
  const scopes = scopesFromMissing(missing, kind)
  clearDeclaredScopes(scopes)
  const bearer = readBearer(init)
  const epochAtStart = aiDeclarationEpoch()
  await ensureScopes(scopes, bearer, epochAtStart)
  assertStillThisVisit(epochAtStart)
  return { input, init: withDeclarationHeaders(init, declarationHeadersFor(scopes, bearer)) }
}
