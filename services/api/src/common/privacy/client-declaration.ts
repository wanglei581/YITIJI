import { AsyncLocalStorage } from 'async_hooks'

/**
 * 未登录用户随请求带来的两项声明。
 *
 * 只记录「是否声明」和文案版本，不记录手机号、用户 id、设备标识或原文。
 * 缺头或版本不合格一律记成「未声明」，不拦截请求。
 *
 * 请求头（大小写不敏感）：
 * - X-Age-14-Plus: declared
 * - X-Age-14-Plus-Version: 文案版本
 * - X-Voice-Recording: granted
 * - X-Voice-Recording-Version: 文案版本
 */

export const AGE_14_PLUS_HEADER = 'x-age-14-plus'
export const AGE_14_PLUS_VERSION_HEADER = 'x-age-14-plus-version'
export const VOICE_RECORDING_HEADER = 'x-voice-recording'
export const VOICE_RECORDING_VERSION_HEADER = 'x-voice-recording-version'

export const CLIENT_DECLARATION_UNDECLARED = '未声明' as const
export const CLIENT_DECLARATION_DECLARED = 'declared' as const

const VERSION_PATTERN = /^[A-Za-z0-9._-]{1,64}$/

export interface ClientDeclarationScope {
  status: typeof CLIENT_DECLARATION_DECLARED | typeof CLIENT_DECLARATION_UNDECLARED
  version: string | null
}

export interface ClientDeclaration {
  age14: ClientDeclarationScope
  voiceRecording: ClientDeclarationScope
}

type HeaderBag = Record<string, string | string[] | undefined> | undefined

const store = new AsyncLocalStorage<ClientDeclaration>()

function headerValue(headers: HeaderBag, name: string): string {
  if (!headers) return ''
  const direct = headers[name] ?? headers[name.toLowerCase()]
  const raw = Array.isArray(direct) ? direct[0] : direct
  return typeof raw === 'string' ? raw.trim() : ''
}

function readScope(flag: string, expectedFlag: string, versionRaw: string): ClientDeclarationScope {
  const version = VERSION_PATTERN.test(versionRaw) ? versionRaw : ''
  if (flag === expectedFlag && version) {
    return { status: CLIENT_DECLARATION_DECLARED, version }
  }
  return { status: CLIENT_DECLARATION_UNDECLARED, version: null }
}

export function undeclaredClientDeclaration(): ClientDeclaration {
  return {
    age14: { status: CLIENT_DECLARATION_UNDECLARED, version: null },
    voiceRecording: { status: CLIENT_DECLARATION_UNDECLARED, version: null },
  }
}

export function readClientDeclaration(headers: HeaderBag): ClientDeclaration {
  return {
    age14: readScope(
      headerValue(headers, AGE_14_PLUS_HEADER),
      'declared',
      headerValue(headers, AGE_14_PLUS_VERSION_HEADER),
    ),
    voiceRecording: readScope(
      headerValue(headers, VOICE_RECORDING_HEADER),
      'granted',
      headerValue(headers, VOICE_RECORDING_VERSION_HEADER),
    ),
  }
}

export function runWithClientDeclaration<T>(declaration: ClientDeclaration, fn: () => T): T {
  return store.run(declaration, fn)
}

/** 没有 HTTP 上下文时返回 null，避免后台任务被写成「未声明」。 */
export function currentClientDeclaration(): ClientDeclaration | null {
  return store.getStore() ?? null
}

export function clientDeclarationJson(declaration: ClientDeclaration | null): string | null {
  if (!declaration) return null
  return JSON.stringify({
    age14: { status: declaration.age14.status, version: declaration.age14.version },
    voiceRecording: {
      status: declaration.voiceRecording.status,
      version: declaration.voiceRecording.version,
    },
  })
}
