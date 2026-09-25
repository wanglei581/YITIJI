/**
 * 管理员数据大屏取数。
 *
 * GET /api/v1/admin/screen/snapshot?profile=gov|ops
 *
 * 四条与别处不同、都是刻意的口径：
 *
 * 1. **只发 profile，且只发 gov|ops**。服务端 DTO 是 `@IsIn(['gov','ops'])` +
 *    全局 `forbidNonWhitelisted`，任何多余参数（含 `?t=` 这种缓存穿透）直接 400。
 *    所以本文件不做 cache-busting，刷新靠服务端 TTL 与 HTTP 语义。
 *
 * 2. **401 不自动跳登录页**。别处的 `redirectToLogin()` 对大屏是错的：
 *    大屏常年挂在无人看管的机器上，JWT 过期后硬跳会把墙上变成一张登录表单，
 *    没人会去点。这里把 401 作为一种可渲染状态回给页面，由页面显示
 *    「登录已过期 + 重新登录」，点了才跳。
 *
 * 3. **mock 模式一个请求都不发**。演示包里没有后端，发了必失败、
 *    浏览器会打 console error，route-sweep 的运行时守卫会红；而造一份假快照
 *    违反「不伪造能力」。所以 mock 返回一个明确的 kind，由页面渲染成
 *    「演示模式不展示任何数值」。
 *
 * 4. **不落盘**。快照不写 localStorage / sessionStorage：一台共用的展示机
 *    换账号登录后，上一账号的数据会串号。
 */

import type {
  AdminScreenProfile,
  ScreenSnapshot,
  ScreenTerminalTwin,
  ScreenUsageRange,
  ScreenUsageSnapshot,
} from '@ai-job-print/shared'
import { API_BASE_URL, API_MODE } from './client'
import { authHeader } from '../auth'

export const ADMIN_SCREEN_PROFILES: readonly AdminScreenProfile[] = ['gov', 'ops']

/** URL 上任何非法 profile 都在前端纠正为 gov，绝不把非法值发给服务端。 */
export function normalizeAdminScreenProfile(raw: string | null | undefined): AdminScreenProfile {
  return raw === 'ops' ? 'ops' : 'gov'
}

export function isKnownAdminScreenProfile(raw: string | null | undefined): boolean {
  return raw === 'gov' || raw === 'ops'
}

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
  AUTH_ROLE_FORBIDDEN: '当前账号没有查看管理员数据大屏的权限',
  AUTH_FORBIDDEN: '未识别身份，请重新登录后再查看',
  VALIDATION_FAILED: '大屏请求参数不被服务端接受，请回到默认视图重试',
}

function readableMessage(code: string | undefined, message: string | undefined): string {
  if (code && CODE_MESSAGES[code]) return CODE_MESSAGES[code]
  const trimmed = (message ?? '').trim()
  if (!trimmed) return FALLBACK_MESSAGE
  // 英文技术串（statusText / HTTP_500）不给运营看
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

/** 只解 `{ success, data }` 信封的 data —— admin 侧控制器统一返回 ApiResponse。 */
function unwrapEnvelope(payload: unknown): ScreenSnapshot | null {
  if (!payload || typeof payload !== 'object') return null
  const data = (payload as { data?: unknown }).data
  if (!data || typeof data !== 'object') return null
  const snapshot = data as Partial<ScreenSnapshot>
  if (snapshot.audience !== 'admin') return null
  if (typeof snapshot.generatedAt !== 'string') return null
  if (!snapshot.metrics || typeof snapshot.metrics !== 'object') return null
  return data as ScreenSnapshot
}

export async function fetchAdminScreenSnapshot(
  profile: AdminScreenProfile,
): Promise<ScreenFetchResult> {
  if (API_MODE !== 'http') return { kind: 'mock' }
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}/admin/screen/snapshot?profile=${profile}`, {
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
  const snapshot = unwrapEnvelope(payload)
  if (!snapshot) return { kind: 'failed', message: '服务响应不是合法的大屏快照，请稍后重试' }
  return { kind: 'ok', snapshot }
}

/**
 * 给 `useRefreshable` 用的 fetcher：成功回快照，非成功一律抛 ScreenFetchError。
 * 抛出来 refresh store 才会把它记成 error 并保留上一次成功的数据
 * （failPolicy: 'keep-last'），这正是「陈旧数据」状态的来源。
 */
export async function loadAdminScreenSnapshot(profile: AdminScreenProfile): Promise<ScreenSnapshot> {
  const result = await fetchAdminScreenSnapshot(profile)
  if (result.kind === 'ok') return result.snapshot
  throw new ScreenFetchError(result)
}

/* ── 单台终端孪生 ─────────────────────────────────────────────────────────
 * GET /api/v1/admin/screen/terminals/:terminalId
 * 与快照同一套口径：401 回可渲染状态、mock 不发请求、不落盘、不加任何多余参数。
 * terminalId 是快照机队格子里的内部 id，只做路径段编码，不拼 query。
 */

export type TwinFetchResult =
  | { kind: 'ok'; twin: ScreenTerminalTwin }
  | Exclude<ScreenFetchResult, { kind: 'ok' }>

function unwrapTwinEnvelope(payload: unknown): ScreenTerminalTwin | null {
  if (!payload || typeof payload !== 'object') return null
  const data = (payload as { data?: unknown }).data
  if (!data || typeof data !== 'object') return null
  const twin = data as Partial<ScreenTerminalTwin>
  if (twin.audience !== 'admin') return null
  if (typeof twin.generatedAt !== 'string') return null
  if (!twin.terminal || typeof twin.terminal !== 'object') return null
  return data as ScreenTerminalTwin
}

export async function fetchAdminTerminalTwin(terminalId: string): Promise<TwinFetchResult> {
  if (API_MODE !== 'http') return { kind: 'mock' }
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}/admin/screen/terminals/${encodeURIComponent(terminalId)}`, {
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
  if (res.status === 404) return { kind: 'failed', message: '这台终端不存在或已被移除，请从终端列表重新选择' }
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
  const twin = unwrapTwinEnvelope(payload)
  if (!twin) return { kind: 'failed', message: '服务响应不是合法的终端孪生数据，请稍后重试' }
  return { kind: 'ok', twin }
}

export async function loadAdminTerminalTwin(terminalId: string): Promise<ScreenTerminalTwin> {
  const result = await fetchAdminTerminalTwin(terminalId)
  if (result.kind === 'ok') return result.twin
  throw new ScreenFetchError(result)
}

/* ── 服务调用统计 ─────────────────────────────────────────────────────────
 * GET /api/v1/admin/screen/usage?range=today|7d|30d
 * 只发 range 一个参数，取值在前端收敛到三档，非法值不发。其余口径同快照。
 */

export type UsageFetchResult =
  | { kind: 'ok'; usage: ScreenUsageSnapshot }
  | Exclude<ScreenFetchResult, { kind: 'ok' }>

export function normalizeUsageRange(raw: string | null | undefined): ScreenUsageRange {
  return raw === '7d' || raw === '30d' ? raw : 'today'
}

function unwrapUsageEnvelope(payload: unknown): ScreenUsageSnapshot | null {
  if (!payload || typeof payload !== 'object') return null
  const data = (payload as { data?: unknown }).data
  if (!data || typeof data !== 'object') return null
  const usage = data as Partial<ScreenUsageSnapshot>
  if (usage.audience !== 'admin') return null
  if (typeof usage.generatedAt !== 'string') return null
  if (!usage.metrics || typeof usage.metrics !== 'object') return null
  return data as ScreenUsageSnapshot
}

export async function fetchAdminUsage(range: ScreenUsageRange): Promise<UsageFetchResult> {
  if (API_MODE !== 'http') return { kind: 'mock' }
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}/admin/screen/usage?range=${range}`, {
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
    return { kind: 'failed', message: '服务响应不是合法的服务调用统计，请稍后重试' }
  }
  const usage = unwrapUsageEnvelope(payload)
  if (!usage) return { kind: 'failed', message: '服务响应不是合法的服务调用统计，请稍后重试' }
  return { kind: 'ok', usage }
}

export async function loadAdminUsage(range: ScreenUsageRange): Promise<ScreenUsageSnapshot> {
  const result = await fetchAdminUsage(range)
  if (result.kind === 'ok') return result.usage
  throw new ScreenFetchError(result)
}
