// 管理员免费打印额度。
// API_MODE=http 才读写服务器；演示模式直接失败，不返回假数字，也不报已保存。

import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'
import {
  parseAlertPercentField,
  parseOptionalOverrideField,
  parseQuotaSidesField,
} from './freePrintQuotaRules'

export interface FreePrintQuotaConfig {
  terminalDailySides: number
  memberDailySides: number
  guestPerOrderSides: number
  alertPercent: number
}

export interface FreePrintQuotaInput {
  terminalDailySides: string
  memberDailySides: string
  guestPerOrderSides: string
  alertPercent: string
}

export interface TerminalDailyFreeSides {
  dailyFreePrintSides: number | null
}

const DEMO_READ = '当前是演示数据，读不到服务器上的免费打印额度'
const DEMO_SAVE = '当前是演示数据，没有写入服务器'

function handleAuthFailure(status: number): void {
  if (status === 401 || status === 403) redirectToLogin()
}

async function toApiError(res: Response, fallback: string): Promise<ApiHttpError> {
  const body = (await res.json().catch(() => ({}))) as {
    error?: { code?: string; message?: string }
    message?: unknown
  }
  const message = body.error?.message ?? (typeof body.message === 'string' ? body.message : undefined)
  return new ApiHttpError(body.error?.code ?? 'FREE_PRINT_QUOTA_ERROR', message ?? fallback, res.status)
}

async function httpGetGlobal(): Promise<FreePrintQuotaConfig> {
  const res = await fetch(`${API_BASE_URL}/admin/print-free-quota`, { headers: authHeader() })
  handleAuthFailure(res.status)
  if (!res.ok) throw await toApiError(res, '免费打印额度加载失败')
  const { data } = (await res.json()) as { data: FreePrintQuotaConfig }
  return data
}

async function httpPutGlobal(body: FreePrintQuotaConfig): Promise<FreePrintQuotaConfig> {
  const res = await fetch(`${API_BASE_URL}/admin/print-free-quota`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeader() },
    body: JSON.stringify(body),
  })
  handleAuthFailure(res.status)
  if (!res.ok) throw await toApiError(res, '免费打印额度保存失败')
  const { data } = (await res.json()) as { data: FreePrintQuotaConfig }
  return data
}

export async function loadGlobalQuota(): Promise<FreePrintQuotaConfig> {
  if (API_MODE !== 'http') throw new ApiHttpError('DEMO_DATA', DEMO_READ, 0)
  return httpGetGlobal()
}

export async function saveGlobalQuota(input: FreePrintQuotaInput): Promise<FreePrintQuotaConfig> {
  const body: FreePrintQuotaConfig = {
    terminalDailySides: parseQuotaSidesField(input.terminalDailySides, '每台每天免费面数'),
    memberDailySides: parseQuotaSidesField(input.memberDailySides, '每个会员每天免费面数'),
    guestPerOrderSides: parseQuotaSidesField(input.guestPerOrderSides, '免登录每单免费面数'),
    alertPercent: parseAlertPercentField(input.alertPercent),
  }
  if (API_MODE !== 'http') throw new ApiHttpError('DEMO_DATA', DEMO_SAVE, 0)
  return httpPutGlobal(body)
}

export async function loadTerminalDailySides(terminalId: string): Promise<TerminalDailyFreeSides> {
  if (API_MODE !== 'http') throw new ApiHttpError('DEMO_DATA', DEMO_READ, 0)
  const res = await fetch(`${API_BASE_URL}/admin/terminals/${encodeURIComponent(terminalId)}/capabilities`, {
    headers: authHeader(),
  })
  handleAuthFailure(res.status)
  if (!res.ok) throw await toApiError(res, '这台终端的免费打印额度加载失败')
  const { data } = (await res.json()) as { data?: { dailyFreePrintSides?: number | null } }
  if (!data || !Object.prototype.hasOwnProperty.call(data, 'dailyFreePrintSides')) {
    throw new ApiHttpError('FREE_PRINT_QUOTA_MISSING', '读不到这台终端的每日免费面数', res.status)
  }
  const value = data.dailyFreePrintSides
  if (value !== null && (typeof value !== 'number' || !Number.isInteger(value))) {
    throw new ApiHttpError('FREE_PRINT_QUOTA_MISSING', '读不到这台终端的每日免费面数', res.status)
  }
  return { dailyFreePrintSides: value ?? null }
}

export async function saveTerminalDailySides(terminalId: string, raw: string): Promise<TerminalDailyFreeSides> {
  const dailyFreePrintSides = parseOptionalOverrideField(raw)
  if (API_MODE !== 'http') throw new ApiHttpError('DEMO_DATA', DEMO_SAVE, 0)
  const res = await fetch(
    `${API_BASE_URL}/admin/terminals/${encodeURIComponent(terminalId)}/daily-free-print-sides`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ dailyFreePrintSides }),
    },
  )
  handleAuthFailure(res.status)
  if (!res.ok) throw await toApiError(res, '这台终端的免费打印额度保存失败')
  const { data } = (await res.json()) as { data?: { dailyFreePrintSides?: number | null } }
  if (!data || !Object.prototype.hasOwnProperty.call(data, 'dailyFreePrintSides')) {
    throw new ApiHttpError('FREE_PRINT_QUOTA_MISSING', '保存后没有读回每日免费面数', res.status)
  }
  const value = data.dailyFreePrintSides
  if (value !== null && (typeof value !== 'number' || !Number.isInteger(value))) {
    throw new ApiHttpError('FREE_PRINT_QUOTA_MISSING', '保存后没有读回每日免费面数', res.status)
  }
  return { dailyFreePrintSides: value ?? null }
}
