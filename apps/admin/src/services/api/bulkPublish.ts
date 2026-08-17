// ============================================================
// Admin 信息源批量发布 Service
//
// API_MODE=http → 真实后端 /admin/bulk-publish/{preview,execute}
// API_MODE=mock → 内存 mock(演示;Page 顶部已有 mock 模式横幅)
//
// 契约要点:
//   - 两步:先 preview(只读)再 execute(按显式 id)。没有「按条件直接全发」。
//   - execute 返回逐条结果,**没有顶层 ok 字段**。部分失败必须逐条展示。
//   - 后端只会发布 reviewStatus=approved 的条目;pending/rejected 会以
//     PUBLISH_REQUIRES_APPROVAL 逐条失败回报,不会静默通过。
// ============================================================

import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'

export type BulkPublishKind = 'job' | 'fair' | 'policy'

export interface OrgOption {
  id: string
  name: string
}

/**
 * 从已加载的信息源列表去重出「来源机构」下拉选项。
 * 岗位 / 招聘会 / 政策三个页面共用,避免为筛选再打一次机构接口。
 */
export function toOrgOptions(rows: { sourceOrgId: string; sourceName: string }[]): OrgOption[] {
  const map = new Map<string, string>()
  for (const r of rows) {
    if (r.sourceOrgId && !map.has(r.sourceOrgId)) map.set(r.sourceOrgId, r.sourceName || r.sourceOrgId)
  }
  return [...map].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'))
}

export interface BulkPublishFilter {
  kind: BulkPublishKind
  sourceOrgId?: string
  syncTimeFrom?: string
  syncTimeTo?: string
}

export interface BulkPublishPreviewItem {
  id: string
  title: string
  sourceOrgId: string
  sourceName: string
  syncTime: string
  publishStatus: string
}

export interface BulkPublishPreviewResult {
  kind: BulkPublishKind
  batchLimit: number
  eligibleTotal: number
  items: BulkPublishPreviewItem[]
  truncated: boolean
  excluded: { notApproved: number; alreadyPublished: number; expired: number }
}

export interface BulkPublishItemResult {
  id: string
  title: string
  status: 'published' | 'failed'
  toPublishStatus?: string
  errorCode?: string
  errorMessage?: string
}

export interface BulkPublishExecuteResult {
  kind: BulkPublishKind
  requested: number
  publishedCount: number
  failedCount: number
  results: BulkPublishItemResult[]
}

export interface BulkPublishServiceInterface {
  preview(filter: BulkPublishFilter): Promise<BulkPublishPreviewResult>
  execute(kind: BulkPublishKind, ids: string[]): Promise<BulkPublishExecuteResult>
}

// ─── HTTP adapter ─────────────────────────────────────────────────────────────

function handleAuthFailure(status: number, code: string): void {
  if (status === 401) {
    redirectToLogin()
    throw new ApiHttpError(code || 'AUTH_REQUIRED', '登录已过期', status)
  }
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...authHeader() },
    credentials: 'include',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) {
    let code = `HTTP_${res.status}`
    let message = res.statusText
    try {
      const data = (await res.json()) as { error?: { code?: string; message?: string } }
      if (data.error?.code) code = data.error.code
      if (data.error?.message) message = data.error.message
    } catch {
      /* keep defaults */
    }
    handleAuthFailure(res.status, code)
    throw new ApiHttpError(code, message, res.status)
  }
  return res.json() as Promise<T>
}

const httpAdapter: BulkPublishServiceInterface = {
  preview: (filter) => req<BulkPublishPreviewResult>('POST', '/admin/bulk-publish/preview', filter),
  execute: (kind, ids) => req<BulkPublishExecuteResult>('POST', '/admin/bulk-publish/execute', { kind, ids }),
}

// ─── Mock adapter ─────────────────────────────────────────────────────────────
//
// 演示用。刻意让第 3 条失败,保证「部分失败逐条可见」这条 UI 分支在 mock 模式下
// 也能被看到 —— 不做「永远全绿」的假演示。

const MOCK_BATCH_LIMIT = 100

function mockItems(kind: BulkPublishKind): BulkPublishPreviewItem[] {
  const label = kind === 'job' ? '岗位' : kind === 'fair' ? '招聘会' : '政策'
  return Array.from({ length: 5 }, (_, i) => ({
    id: `${kind}-mock-${i + 1}`,
    title: `${label}演示条目 ${i + 1}`,
    sourceOrgId: 'org-mock-1',
    sourceName: '市人社局(演示)',
    syncTime: new Date(Date.now() - (5 - i) * 3_600_000).toISOString(),
    publishStatus: i % 2 === 0 ? 'draft' : 'unpublished',
  }))
}

const mockAdapter: BulkPublishServiceInterface = {
  async preview(filter) {
    const items = mockItems(filter.kind)
    return {
      kind: filter.kind,
      batchLimit: MOCK_BATCH_LIMIT,
      eligibleTotal: items.length,
      items,
      truncated: false,
      excluded: { notApproved: 2, alreadyPublished: 1, expired: 0 },
    }
  },
  async execute(kind, ids) {
    const items = mockItems(kind)
    const titleOf = (id: string) => items.find((it) => it.id === id)?.title ?? '(演示条目)'
    const results: BulkPublishItemResult[] = ids.map((id, idx) =>
      idx === 2
        ? {
            id,
            title: titleOf(id),
            status: 'failed',
            errorCode: 'PUBLISH_REQUIRES_APPROVAL',
            errorMessage: '未通过审核的条目不得发布(演示失败样例)',
          }
        : { id, title: titleOf(id), status: 'published', toPublishStatus: 'published' },
    )
    const publishedCount = results.filter((r) => r.status === 'published').length
    return { kind, requested: ids.length, publishedCount, failedCount: results.length - publishedCount, results }
  },
}

export const bulkPublishService: BulkPublishServiceInterface =
  API_MODE === 'http' ? httpAdapter : mockAdapter
