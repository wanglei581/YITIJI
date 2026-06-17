// ============================================================
// 智慧校园（按终端开关）Admin Service
//
// API_MODE=http → 真实后端 /admin/smart-campus/terminals|smart-campus-config（返回裸数据）
// API_MODE=mock → 内存 mock（无后端也能走通 UI：列表 + 保存配置在内存生效）
// ============================================================

import type {
  SaveSmartCampusConfigInput,
  SmartCampusTerminalView,
  TerminalSmartCampusConfigView,
} from '@ai-job-print/shared'
import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'

export type { SaveSmartCampusConfigInput, SmartCampusTerminalView, TerminalSmartCampusConfigView }

export interface SmartCampusAdminServiceInterface {
  listTerminals(): Promise<SmartCampusTerminalView[]>
  saveConfig(terminalId: string, input: SaveSmartCampusConfigInput): Promise<TerminalSmartCampusConfigView>
}

// ─── HTTP adapter ─────────────────────────────────────────────────────────────

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

const httpAdapter: SmartCampusAdminServiceInterface = {
  listTerminals: () => req<SmartCampusTerminalView[]>('GET', '/admin/smart-campus/terminals'),
  saveConfig: (terminalId, input) =>
    req<TerminalSmartCampusConfigView>('PUT', `/admin/terminals/${terminalId}/smart-campus-config`, input),
}

// ─── 内存 Mock adapter ────────────────────────────────────────────────────────

const mockTerminals: SmartCampusTerminalView[] = [
  { terminalId: 'KSK-001', terminalCode: 'KSK-001', isOnline: true, config: null },
  { terminalId: 'KIOSK-DEMO-01', terminalCode: 'KIOSK-DEMO-01', isOnline: false, config: null },
]

const mockAdapter: SmartCampusAdminServiceInterface = {
  async listTerminals() {
    return mockTerminals
  },
  async saveConfig(terminalId, input) {
    const modules = {
      welcome: !!input.modules.welcome,
      bigdata: !!input.modules.bigdata,
      luggage: !!input.modules.luggage,
      panorama: !!input.modules.panorama,
    }
    const anyOn = modules.welcome || modules.bigdata || modules.luggage || modules.panorama
    const enabled = input.enabled && anyOn
    const config: TerminalSmartCampusConfigView = {
      terminalId,
      enabled,
      modules,
      updatedAt: new Date(0).toISOString(),
    }
    const t = mockTerminals.find((x) => x.terminalId === terminalId)
    if (t) t.config = config
    return config
  },
}

// ─── 导出 ────────────────────────────────────────────────────────────────────

export const smartCampusService: SmartCampusAdminServiceInterface =
  API_MODE === 'http' ? httpAdapter : mockAdapter
