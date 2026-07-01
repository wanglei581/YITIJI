import type {
  KioskToolboxItem,
  SaveToolboxConfigInput,
  TerminalToolboxConfigView,
  ToolboxLaunchSummary,
  ToolboxTerminalView,
} from '@ai-job-print/shared'
import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'

export type { KioskToolboxItem, SaveToolboxConfigInput, TerminalToolboxConfigView, ToolboxLaunchSummary, ToolboxTerminalView }

export interface ToolboxAdminServiceInterface {
  listTerminals(): Promise<ToolboxTerminalView[]>
  getLaunchSummary(params?: { days?: number; terminalId?: string | null }): Promise<ToolboxLaunchSummary>
  saveConfig(terminalId: string, input: SaveToolboxConfigInput): Promise<TerminalToolboxConfigView>
}

async function parseError(res: Response): Promise<never> {
  let code = `HTTP_${res.status}`
  let message = res.statusText
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } }
    if (body.error?.code) code = body.error.code
    if (body.error?.message) message = body.error.message
  } catch {
    /* keep defaults */
  }
  if (res.status === 401) {
    redirectToLogin()
    throw new ApiHttpError(code || 'AUTH_REQUIRED', '登录已过期', res.status)
  }
  throw new ApiHttpError(code, message, res.status)
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeader() },
    credentials: 'include',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) await parseError(res)
  return res.json() as Promise<T>
}

const httpAdapter: ToolboxAdminServiceInterface = {
  listTerminals: () => req<ToolboxTerminalView[]>('GET', '/admin/toolbox/terminals'),
  getLaunchSummary: (params) => {
    const query = new URLSearchParams()
    if (params?.days) query.set('days', String(params.days))
    if (params?.terminalId) query.set('terminalId', params.terminalId)
    const suffix = query.toString() ? `?${query.toString()}` : ''
    return req<ToolboxLaunchSummary>('GET', `/admin/toolbox/launch-summary${suffix}`)
  },
  saveConfig: (terminalId, input) =>
    req<TerminalToolboxConfigView>('PUT', `/admin/terminals/${terminalId}/toolbox-config`, input),
}

const mockTerminals: ToolboxTerminalView[] = [
  { terminalId: 'KSK-001', terminalCode: 'KSK-001', isOnline: true, config: null },
  { terminalId: 'KIOSK-DEMO-01', terminalCode: 'KIOSK-DEMO-01', isOnline: false, config: null },
]

const mockAdapter: ToolboxAdminServiceInterface = {
  async listTerminals() {
    return mockTerminals
  },
  async getLaunchSummary(params) {
    const now = new Date()
    const days = params?.days ?? 7
    return {
      days,
      terminalId: params?.terminalId ?? null,
      from: new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString(),
      to: now.toISOString(),
      totalCount: 0,
      qrShownCount: 0,
      externalNoticeCount: 0,
      externalConfirmedCount: 0,
      externalCancelledCount: 0,
      byAction: {
        show_qr: 0,
        open_external_notice: 0,
        open_external_confirmed: 0,
        cancel_external: 0,
      },
      topItems: [],
    }
  },
  async saveConfig(terminalId, input) {
    const items: KioskToolboxItem[] = input.items.map((item, index) => ({
      key: item.key || `tool-${index + 1}`,
      title: item.title,
      description: item.description,
      icon: item.icon || 'wrench',
      to: item.to || null,
      disabled: !!item.disabled,
      sortOrder: Number.isInteger(item.sortOrder) ? item.sortOrder : index,
      placements: item.placements?.length ? item.placements : ['toolbox'],
      launchMode: item.launchMode ?? 'internal_route',
      externalUrl: item.externalUrl ?? null,
      qrImageUrl: item.qrImageUrl ?? null,
      qrTargetUrl: item.qrTargetUrl ?? null,
    }))
    const config: TerminalToolboxConfigView = {
      terminalId,
      enabled: input.enabled,
      items,
      updatedAt: new Date(0).toISOString(),
    }
    const t = mockTerminals.find((x) => x.terminalId === terminalId)
    if (t) t.config = config
    return config
  },
}

export const toolboxService: ToolboxAdminServiceInterface =
  API_MODE === 'http' ? httpAdapter : mockAdapter
