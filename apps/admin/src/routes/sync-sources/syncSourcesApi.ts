import { API_BASE_URL, API_MODE, ApiHttpError } from '../../services/api/client'
import { authHeader, redirectToLogin } from '../../services/auth'

// 数据接入通道页与停放的写操作（SyncSourceWriteActions.tsx）共用的请求工具与类型。
// 由 sync-sources/index.tsx 抽出，行为零变化。

/**
 * 统一鉴权 fetch:带 Bearer(authHeader)+ credentials,401 走全局 redirectToLogin。
 * 与其余 adapter 的鉴权机制保持一致(MEDIUM:此前仅 credentials:'include' 不带 Bearer,
 * 后端校验 Bearer 时会 401)。
 */
export async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    credentials: 'include',
    headers: { Accept: 'application/json', ...authHeader(), ...(init.headers ?? {}) },
  })
  if (res.status === 401) {
    redirectToLogin()
    throw new ApiHttpError('AUTH_REQUIRED', '登录已过期', 401)
  }
  return res
}

export async function throwIfNotOk(res: Response): Promise<void> {
  if (res.ok) return
  let code = `HTTP_${res.status}`
  let message = `请求失败（${res.status}）`
  try {
    const body = (await res.json()) as { error?: { code?: string; message?: string } }
    if (body.error?.code) code = body.error.code
    if (body.error?.message) message = body.error.message
  } catch {
    /* 非 JSON */
  }
  throw new ApiHttpError(code, message, res.status)
}

export interface ApiSyncSourceItem {
  id: string
  name: string
  orgId: string
  orgName: string
  sourceKind: string
  accessMode: string
  syncFreq: string
  enabled: boolean
  archived: boolean
  lastSyncAt: string | null
  lastSyncStatus: string | null
  hasEndpoint: boolean
  hasCredential: boolean
  hasResponseConfig: boolean
}

const MOCK_SOURCES: ApiSyncSourceItem[] = [
  {
    id: 'mock-src-1',
    name: '示例岗位 API 数据源',
    orgId: 'org-1',
    orgName: '演示机构',
    sourceKind: 'aggregator',
    accessMode: 'api',
    syncFreq: 'hourly',
    enabled: true,
    archived: false,
    lastSyncAt: null,
    lastSyncStatus: null,
    hasEndpoint: true,
    hasCredential: true,
    hasResponseConfig: false,
  },
]

export async function fetchApiSources(): Promise<ApiSyncSourceItem[]> {
  if (API_MODE !== 'http') return MOCK_SOURCES
  const res = await authFetch('/admin/job-sync/sources')
  await throwIfNotOk(res)
  const body = (await res.json()) as { data: ApiSyncSourceItem[] }
  return body.data ?? []
}
