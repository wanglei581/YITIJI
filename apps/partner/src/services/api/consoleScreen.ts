/**
 * 合作机构数据大屏取数。
 *
 * GET /api/v1/partner/screen/snapshot
 *
 * 跨机构隔离的前端侧约定（服务端已经各自把住，这里是第二道）：
 *
 * 1. **不带任何 query**。orgId 只由服务端从鉴权用户回源，`PartnerScreenQueryDto`
 *    是空白名单，`?orgId=` / `?mode=` / `?token=` / `?t=` 任意一个都会被
 *    `forbidNonWhitelisted` 拒成 400。所以这里连缓存穿透参数都不加。
 * 2. **不解信封**。orgs 一族控制器返回裸对象（与 `/partner/stats` 同裁定），
 *    这里直接用 body，不取 `body.data`。
 * 3. **不落盘**。快照不写 localStorage / sessionStorage —— 同一台机器换机构账号
 *    登录时，上一个机构的数据会串号。
 * 4. **401 不自动跳登录页**，理由同 admin 侧：大屏可能挂在无人看管的屏上。
 * 5. 账号没绑机构时服务端回 403 `ORG_REQUIRED`，与「角色不符」是两件事，
 *    必须分开提示，否则机构管理员会以为自己权限没开。
 */

import type { ScreenSnapshot, ScreenTerminalTwin, ScreenUsageRange, ScreenUsageSnapshot } from '@ai-job-print/shared'
import { API_BASE_URL, API_MODE } from './client'
import { authHeader } from '../auth'

export type ScreenFetchResult =
  | { kind: 'ok'; snapshot: ScreenSnapshot }
  | { kind: 'mock' }
  | { kind: 'unauthorized' }
  | { kind: 'forbidden'; code: string; message: string }
  | { kind: 'offline' }
  | { kind: 'failed'; message: string }

export class ScreenFetchError extends Error {
  constructor(readonly result: Exclude<ScreenFetchResult, { kind: 'ok' }>) {
    super(result.kind)
    this.name = 'ScreenFetchError'
  }
}

interface ErrorBody {
  error?: { code?: string; message?: string }
}

const FALLBACK_MESSAGE = '大屏数据获取失败，请稍后重试'

const CODE_MESSAGES: Readonly<Record<string, string>> = {
  ORG_REQUIRED: '当前账号未绑定机构，无法查看本机构数据大屏',
  AUTH_ROLE_FORBIDDEN: '当前账号没有查看机构数据大屏的权限',
  AUTH_FORBIDDEN: '未识别身份，请重新登录后再查看',
  VALIDATION_FAILED: '大屏请求被服务端拒绝，请刷新页面重试',
}

function readableMessage(code: string | undefined, message: string | undefined): string {
  if (code && CODE_MESSAGES[code]) return CODE_MESSAGES[code]
  const trimmed = (message ?? '').trim()
  if (!trimmed) return FALLBACK_MESSAGE
  if (/^HTTP[_\s]?\d+/i.test(trimmed) || !/[一-龥]/.test(trimmed)) return FALLBACK_MESSAGE
  return trimmed
}

async function readErrorBody(res: Response): Promise<ErrorBody> {
  try {
    return (await res.json()) as ErrorBody
  } catch {
    return {}
  }
}

function asPartnerSnapshot(payload: unknown): ScreenSnapshot | null {
  if (!payload || typeof payload !== 'object') return null
  const snapshot = payload as Partial<ScreenSnapshot>
  if (snapshot.audience !== 'partner') return null
  if (typeof snapshot.generatedAt !== 'string') return null
  if (!snapshot.metrics || typeof snapshot.metrics !== 'object') return null
  return payload as ScreenSnapshot
}

export async function fetchPartnerScreenSnapshot(): Promise<ScreenFetchResult> {
  if (API_MODE !== 'http') return { kind: 'mock' }
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}/partner/screen/snapshot`, {
      method: 'GET',
      headers: { Accept: 'application/json', ...authHeader() },
    })
  } catch {
    return { kind: 'offline' }
  }
  if (res.status === 401) return { kind: 'unauthorized' }
  if (res.status === 403) {
    const body = await readErrorBody(res)
    return {
      kind: 'forbidden',
      code: body.error?.code ?? 'AUTH_ROLE_FORBIDDEN',
      message: readableMessage(body.error?.code, body.error?.message),
    }
  }
  if (!res.ok) {
    const body = await readErrorBody(res)
    return { kind: 'failed', message: readableMessage(body.error?.code, body.error?.message) }
  }
  let payload: unknown
  try {
    payload = await res.json()
  } catch {
    return { kind: 'failed', message: '服务响应不是合法的大屏快照，请稍后重试' }
  }
  const snapshot = asPartnerSnapshot(payload)
  if (!snapshot) return { kind: 'failed', message: '服务响应不是合法的大屏快照，请稍后重试' }
  return { kind: 'ok', snapshot }
}

/** 供 useRefreshable 使用：失败必须抛，store 才会保留上次成功的数据。 */
export async function loadPartnerScreenSnapshot(): Promise<ScreenSnapshot> {
  const result = await fetchPartnerScreenSnapshot()
  if (result.kind === 'ok') return result.snapshot
  throw new ScreenFetchError(result)
}

/* ── 单台终端孪生 ─────────────────────────────────────────────────────────
 * GET /api/v1/partner/screen/terminals/:terminalId
 * 机构只可能拿到本机构终端：别家终端与不存在同样 404（服务端裁决，前端不带任何机构标识）。
 * 响应是裸对象，与机构快照一致；terminalId 只做路径段编码，不拼 query。
 */

export type TwinFetchResult =
  | { kind: 'ok'; twin: ScreenTerminalTwin }
  | Exclude<ScreenFetchResult, { kind: 'ok' }>

function asPartnerTwin(payload: unknown): ScreenTerminalTwin | null {
  if (!payload || typeof payload !== 'object') return null
  const twin = payload as Partial<ScreenTerminalTwin>
  if (twin.audience !== 'partner') return null
  if (typeof twin.generatedAt !== 'string') return null
  if (!twin.terminal || typeof twin.terminal !== 'object') return null
  return payload as ScreenTerminalTwin
}

export async function fetchPartnerTerminalTwin(terminalId: string): Promise<TwinFetchResult> {
  if (API_MODE !== 'http') return { kind: 'mock' }
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}/partner/screen/terminals/${encodeURIComponent(terminalId)}`, {
      method: 'GET',
      headers: { Accept: 'application/json', ...authHeader() },
    })
  } catch {
    return { kind: 'offline' }
  }
  if (res.status === 401) return { kind: 'unauthorized' }
  if (res.status === 403) {
    const body = await readErrorBody(res)
    return {
      kind: 'forbidden',
      code: body.error?.code ?? 'AUTH_ROLE_FORBIDDEN',
      message: readableMessage(body.error?.code, body.error?.message),
    }
  }
  if (res.status === 404) return { kind: 'failed', message: '没有找到这台终端，请从本机构终端列表重新选择' }
  if (!res.ok) {
    const body = await readErrorBody(res)
    return { kind: 'failed', message: readableMessage(body.error?.code, body.error?.message) }
  }
  let payload: unknown
  try {
    payload = await res.json()
  } catch {
    return { kind: 'failed', message: '服务响应不是合法的终端孪生数据，请稍后重试' }
  }
  const twin = asPartnerTwin(payload)
  if (!twin) return { kind: 'failed', message: '服务响应不是合法的终端孪生数据，请稍后重试' }
  return { kind: 'ok', twin }
}

export async function loadPartnerTerminalTwin(terminalId: string): Promise<ScreenTerminalTwin> {
  const result = await fetchPartnerTerminalTwin(terminalId)
  if (result.kind === 'ok') return result.twin
  throw new ScreenFetchError(result)
}

/* ── 本机构信息使用 ────────────────────────────────────────────────────────
 * GET /api/v1/partner/screen/usage?range=today|7d|30d
 * 唯一允许的 query 是 range，且先经 normalizeUsageRange 白名单纠正，非法值绝不发给服务端。
 * 仍然不带任何机构标识：服务端只从鉴权用户回源。响应是裸对象。
 */

export type UsageFetchResult =
  | { kind: 'ok'; usage: ScreenUsageSnapshot }
  | Exclude<ScreenFetchResult, { kind: 'ok' }>

export function normalizeUsageRange(raw: string | null | undefined): ScreenUsageRange {
  return raw === '7d' || raw === '30d' ? raw : 'today'
}

function asPartnerUsage(payload: unknown): ScreenUsageSnapshot | null {
  if (!payload || typeof payload !== 'object') return null
  const usage = payload as Partial<ScreenUsageSnapshot>
  if (usage.audience !== 'partner') return null
  if (typeof usage.generatedAt !== 'string') return null
  if (!usage.metrics || typeof usage.metrics !== 'object') return null
  return payload as ScreenUsageSnapshot
}

export async function fetchPartnerUsage(range: ScreenUsageRange): Promise<UsageFetchResult> {
  if (API_MODE !== 'http') return { kind: 'mock' }
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}/partner/screen/usage?range=${normalizeUsageRange(range)}`, {
      method: 'GET',
      headers: { Accept: 'application/json', ...authHeader() },
    })
  } catch {
    return { kind: 'offline' }
  }
  if (res.status === 401) return { kind: 'unauthorized' }
  if (res.status === 403) {
    const body = await readErrorBody(res)
    return {
      kind: 'forbidden',
      code: body.error?.code ?? 'AUTH_ROLE_FORBIDDEN',
      message: readableMessage(body.error?.code, body.error?.message),
    }
  }
  if (!res.ok) {
    const body = await readErrorBody(res)
    return { kind: 'failed', message: readableMessage(body.error?.code, body.error?.message) }
  }
  let payload: unknown
  try {
    payload = await res.json()
  } catch {
    return { kind: 'failed', message: '服务响应不是合法的信息使用统计，请稍后重试' }
  }
  const usage = asPartnerUsage(payload)
  if (!usage) return { kind: 'failed', message: '服务响应不是合法的信息使用统计，请稍后重试' }
  return { kind: 'ok', usage }
}

export async function loadPartnerUsage(range: ScreenUsageRange): Promise<ScreenUsageSnapshot> {
  const result = await fetchPartnerUsage(range)
  if (result.kind === 'ok') return result.usage
  throw new ScreenFetchError(result)
}
