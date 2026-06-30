import type {
  KioskToolboxItem,
  SaveToolboxConfigInput,
  TerminalToolboxConfigView,
  ToolboxTerminalView,
} from '@ai-job-print/shared'
import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'

export type { KioskToolboxItem, SaveToolboxConfigInput, TerminalToolboxConfigView, ToolboxTerminalView }

export interface ToolboxAdminServiceInterface {
  listTerminals(): Promise<ToolboxTerminalView[]>
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
