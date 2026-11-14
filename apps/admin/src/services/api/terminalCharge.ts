// 管理员：某台机器谁付钱、五个配置价。总开关在计费页。

import {
  TERMINAL_CHARGE_SERVICE_KEYS,
  type EffectiveUserPrices,
  type TerminalChargeServiceKey,
  type TerminalUserChargeMode,
} from '@ai-job-print/shared'
import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'
import { demoGetChargeSettings, demoSaveChargeSettings, type DemoChargeSettings } from './terminalChargeDemo'

export type TerminalChargeSettingsView = DemoChargeSettings

function handleAuthFailure(status: number): void {
  if (status === 401 || status === 403) redirectToLogin()
}

async function toApiError(res: Response, fallback: string): Promise<ApiHttpError> {
  const body = (await res.json().catch(() => ({}))) as {
    error?: { code?: string; message?: string }
    message?: unknown
  }
  const message = body.error?.message ?? (typeof body.message === 'string' ? body.message : undefined)
  return new ApiHttpError(body.error?.code ?? 'TERMINAL_CHARGE_ERROR', message ?? fallback, res.status)
}

export async function loadTerminalChargeSettings(terminalId: string): Promise<TerminalChargeSettingsView> {
  if (API_MODE !== 'http') return demoGetChargeSettings(terminalId)
  const res = await fetch(`${API_BASE_URL}/admin/terminals/${encodeURIComponent(terminalId)}/charge-settings`, {
    headers: { Accept: 'application/json', ...authHeader() },
  })
  handleAuthFailure(res.status)
  if (!res.ok) throw await toApiError(res, '收费设置读取失败')
  const body = (await res.json()) as { data?: TerminalChargeSettingsView }
  if (!body.data?.prices) throw new ApiHttpError('TERMINAL_CHARGE_MISSING', '收费设置没有读回', res.status)
  return body.data
}

export async function saveTerminalChargeSettings(
  terminalId: string,
  input: { userChargeMode: TerminalUserChargeMode; prices: Record<TerminalChargeServiceKey, number> },
): Promise<TerminalChargeSettingsView> {
  if (API_MODE !== 'http') return demoSaveChargeSettings(terminalId, input)
  const res = await fetch(`${API_BASE_URL}/admin/terminals/${encodeURIComponent(terminalId)}/charge-settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeader() },
    body: JSON.stringify(input),
  })
  handleAuthFailure(res.status)
  if (!res.ok) throw await toApiError(res, '收费设置保存失败')
  const body = (await res.json()) as { data?: TerminalChargeSettingsView }
  if (!body.data?.prices) throw new ApiHttpError('TERMINAL_CHARGE_MISSING', '保存后没有读回收费设置', res.status)
  return body.data
}

export function chargeSummary(view: TerminalChargeSettingsView): EffectiveUserPrices {
  return {
    userChargeMode: view.userChargeMode,
    personalChargeEnabled: view.personalChargeEnabled,
    isPublicSite: view.isPublicSite,
    prices: view.prices,
  }
}

export function emptyChargePrices(): Record<TerminalChargeServiceKey, number> {
  const prices = {} as Record<TerminalChargeServiceKey, number>
  for (const key of TERMINAL_CHARGE_SERVICE_KEYS) prices[key] = 0
  return prices
}
