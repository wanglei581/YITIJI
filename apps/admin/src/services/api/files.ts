import { API_MODE, API_BASE_URL, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'
import type {
  FileAssetCategory,
  FileLifecycleSummaryResponse,
  FileOwnerType,
  FileRetentionPolicy,
  FileRetentionSetBy,
  FileStatus,
} from '@ai-job-print/shared'

// ─── Types(镜像后端 services/api/src/files/file.types.ts 的 FileMetadata)──────────
//
// 后端 GET/DELETE/cleanup 端点均以 ApiResponse<T>(即 { data: T })包装,
// 见 docs/progress/api-connectivity-audit-2026-06-05.md §3。前端在 http adapter 内拆 .data。

export type AdminFilePurpose =
  | 'resume_upload'
  | 'resume_scan'
  | 'id_scan'
  | 'print_doc'
  | 'fair_material'
  | 'cover_letter'
  // COS 接入新增(机构 / 管理员 / 屏保素材)
  | 'partner_profile'
  | 'partner_image'
  | 'partner_video'
  | 'job_fair_material'
  | 'screensaver_material'
  | 'admin_upload'
  | 'temp'

export type AdminFileSensitive = 'normal' | 'sensitive' | 'highly_sensitive'

export interface AdminFileRecord {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  sha256: string
  purpose: AdminFilePurpose
  sensitiveLevel: AdminFileSensitive
  status: FileStatus
  assetCategory: FileAssetCategory
  ownerType: FileOwnerType | null
  ownerId: string | null
  retentionPolicy: FileRetentionPolicy | null
  retentionSetBy: FileRetentionSetBy | null
  retentionConsentAt: string | null
  retentionConsentVersion: string | null
  retentionLockedReason: string | null
  uploaderId: string | null
  endUserId: string | null
  expiresAt: string | null
  deletedAt: string | null
  deletedBy: string | null
  deleteReason: string | null
  createdAt: string
}

export type AdminFileLifecycleSummary = FileLifecycleSummaryResponse

export interface AdminFileCleanupResult {
  deletedCount: number
  deletedFileIds: string[]
  triggeredBy: 'manual' | 'cron'
  triggeredAt: string
}

export interface AdminFileSignedUrl {
  fileId: string
  signedUrl: string
  expiresAt: string
  purpose: AdminFilePurpose
}

export interface ListFilesOptions {
  includeDeleted?: boolean
  purpose?: string
  limit?: number
}

export interface AdminFilesServiceInterface {
  /** GET /files — admin 列出文件元数据(默认不含已删除) */
  listFiles(opts?: ListFilesOptions): Promise<AdminFileRecord[]>
  /** GET /files/lifecycle-summary — admin 只读全局生命周期统计 */
  getFileLifecycleSummary(): Promise<AdminFileLifecycleSummary>
  /** DELETE /files/:id — admin 强制删除(物理删存储 + 软删记录 + 后端写审计) */
  deleteFile(id: string, reason: string): Promise<AdminFileRecord>
  /** POST /files/cleanup-expired — admin 立即清理所有已过期文件(后端写审计) */
  cleanupExpiredFiles(): Promise<AdminFileCleanupResult>
  /** GET /files/:id/url — 重发临时签名 URL(短 TTL,后端写访问审计) */
  getFileSignedUrl(id: string): Promise<AdminFileSignedUrl>
}

// ─── HTTP adapter ─────────────────────────────────────────────────────────────

function handleAuthFailure(status: number, code: string): void {
  if (status === 401) {
    redirectToLogin()
    throw new ApiHttpError(code || 'AUTH_REQUIRED', '登录已过期', status)
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json', ...authHeader() }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    credentials: 'include',
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  })
  if (!res.ok) {
    let code = `HTTP_${res.status}`
    let message = res.statusText
    try {
      const errBody = (await res.json()) as { error?: { code?: string; message?: string } }
      if (errBody.error?.code) code = errBody.error.code
      if (errBody.error?.message) message = errBody.error.message
    } catch {
      /* keep defaults */
    }
    handleAuthFailure(res.status, code)
    throw new ApiHttpError(code, message, res.status)
  }
  return res.json() as Promise<T>
}

/** 后端 ApiResponse<T> 拆包 */
async function data<T>(p: Promise<{ data: T }>): Promise<T> {
  return (await p).data
}

export const adminFilesHttpAdapter: AdminFilesServiceInterface = {
  listFiles(opts) {
    const q = new URLSearchParams()
    if (opts?.includeDeleted) q.set('includeDeleted', 'true')
    if (opts?.purpose) q.set('purpose', opts.purpose)
    if (opts?.limit) q.set('limit', String(opts.limit))
    const qs = q.toString()
    return data(request<{ data: AdminFileRecord[] }>('GET', `/files${qs ? `?${qs}` : ''}`))
  },
  getFileLifecycleSummary() {
    return data(request<{ data: AdminFileLifecycleSummary }>('GET', '/files/lifecycle-summary'))
  },
  deleteFile(id, reason) {
    const q = `?reason=${encodeURIComponent(reason)}`
    return data(request<{ data: AdminFileRecord }>('DELETE', `/files/${encodeURIComponent(id)}${q}`))
  },
  cleanupExpiredFiles() {
    return data(request<{ data: AdminFileCleanupResult }>('POST', '/files/cleanup-expired', {}))
  },
  getFileSignedUrl(id) {
    return data(request<{ data: AdminFileSignedUrl }>('GET', `/files/${encodeURIComponent(id)}/url`))
  },
}

// ─── Mock adapter(无后端时本地演示,字段形状与后端一致以便页面映射逻辑一致)──────

function seedMockFiles(): AdminFileRecord[] {
  return [
    { id: 'mf-01', filename: '王某某_简历_2026.pdf',     mimeType: 'application/pdf', sizeBytes: 319488, sha256: 'a1'.repeat(32), purpose: 'resume_upload', sensitiveLevel: 'highly_sensitive', status: 'active', assetCategory: 'original', ownerType: 'user', ownerId: 'eu-001', retentionPolicy: 'months_3', retentionSetBy: 'system', retentionConsentAt: null, retentionConsentVersion: null, retentionLockedReason: null, uploaderId: null, endUserId: 'eu-001', expiresAt: '2026-09-20T01:12:00.000Z', deletedAt: null, deletedBy: null, deleteReason: null, createdAt: '2026-06-21T01:12:00.000Z' },
    { id: 'mf-02', filename: 'scan_20260622_0918.pdf',    mimeType: 'application/pdf', sizeBytes: 1258291, sha256: 'b2'.repeat(32), purpose: 'resume_scan',   sensitiveLevel: 'sensitive', status: 'active', assetCategory: 'original', ownerType: 'user', ownerId: 'eu-002', retentionPolicy: 'months_6', retentionSetBy: 'user', retentionConsentAt: '2026-06-22T09:20:00.000Z', retentionConsentVersion: 'file-retention-v1', retentionLockedReason: null, uploaderId: null, endUserId: 'eu-002', expiresAt: '2026-06-26T15:18:00.000Z', deletedAt: null, deletedBy: null, deleteReason: null, createdAt: '2026-06-22T09:18:00.000Z' },
    { id: 'mf-03', filename: '身份证正面_F2G8.jpg',        mimeType: 'image/jpeg',      sizeBytes: 126976, sha256: 'c3'.repeat(32), purpose: 'id_scan', sensitiveLevel: 'highly_sensitive', status: 'active', assetCategory: 'original', ownerType: 'user', ownerId: 'eu-003', retentionPolicy: 'system_short', retentionSetBy: 'system', retentionConsentAt: null, retentionConsentVersion: null, retentionLockedReason: '证件文件强制短期保存', uploaderId: null, endUserId: 'eu-003', expiresAt: '2026-06-21T08:43:00.000Z', deletedAt: null, deletedBy: null, deleteReason: null, createdAt: '2026-06-21T00:43:00.000Z' },
    { id: 'mf-04', filename: '招聘会资料_2026春招.pdf',     mimeType: 'application/pdf', sizeBytes: 2936012, sha256: 'd4'.repeat(32), purpose: 'fair_material', sensitiveLevel: 'normal', status: 'active', assetCategory: 'derived', ownerType: 'partner', ownerId: 'partner-uni-01', retentionPolicy: 'months_6', retentionSetBy: 'system', retentionConsentAt: null, retentionConsentVersion: null, retentionLockedReason: null, uploaderId: 'partner-uni-01', endUserId: null, expiresAt: '2026-07-08T08:20:00.000Z', deletedAt: null, deletedBy: null, deleteReason: null, createdAt: '2026-06-21T00:20:00.000Z' },
    { id: 'mf-05', filename: '李某某_优化后求职信.pdf',          mimeType: 'application/pdf', sizeBytes: 152600, sha256: 'e5'.repeat(32), purpose: 'cover_letter', sensitiveLevel: 'sensitive', status: 'active', assetCategory: 'optimized', ownerType: 'user', ownerId: 'eu-004', retentionPolicy: 'long_term', retentionSetBy: 'user', retentionConsentAt: '2026-06-22T09:08:00.000Z', retentionConsentVersion: 'file-retention-v1', retentionLockedReason: null, uploaderId: null, endUserId: 'eu-004', expiresAt: null, deletedAt: null, deletedBy: null, deleteReason: null, createdAt: '2026-06-22T09:08:00.000Z' },
    { id: 'mf-06', filename: 'print_upload_R8S3.pdf',      mimeType: 'application/pdf', sizeBytes: 466944, sha256: 'f6'.repeat(32), purpose: 'print_doc', sensitiveLevel: 'normal', status: 'active', assetCategory: 'original', ownerType: 'system', ownerId: null, retentionPolicy: 'system_short', retentionSetBy: 'system', retentionConsentAt: null, retentionConsentVersion: null, retentionLockedReason: null, uploaderId: null, endUserId: null, expiresAt: '2026-06-23T16:59:00.000Z', deletedAt: null, deletedBy: null, deleteReason: null, createdAt: '2026-06-21T16:59:00.000Z' },
    { id: 'mf-07', filename: '身份证反面_L6M9.jpg',        mimeType: 'image/jpeg',      sizeBytes: 120832, sha256: 'a7'.repeat(32), purpose: 'id_scan', sensitiveLevel: 'highly_sensitive', status: 'deleted', assetCategory: 'original', ownerType: 'user', ownerId: 'eu-005', retentionPolicy: 'system_short', retentionSetBy: 'system', retentionConsentAt: null, retentionConsentVersion: null, retentionLockedReason: '证件文件强制短期保存', uploaderId: null, endUserId: 'eu-005', expiresAt: '2026-06-05T01:45:00.000Z', deletedAt: '2026-06-05T02:00:00.000Z', deletedBy: 'cron', deleteReason: '到期自动清理', createdAt: '2026-06-04T17:45:00.000Z' },
    { id: 'mf-08', filename: '政策手册_就业补贴.pdf',       mimeType: 'application/pdf', sizeBytes: 3251200, sha256: 'b8'.repeat(32), purpose: 'print_doc', sensitiveLevel: 'normal', status: 'active', assetCategory: 'derived', ownerType: 'admin', ownerId: 'admin-01', retentionPolicy: 'months_3', retentionSetBy: 'system', retentionConsentAt: null, retentionConsentVersion: null, retentionLockedReason: null, uploaderId: 'admin-01', endUserId: null, expiresAt: '2026-08-07T17:18:00.000Z', deletedAt: null, deletedBy: null, deleteReason: null, createdAt: '2026-06-21T17:18:00.000Z' },
  ]
}

let mockStore: AdminFileRecord[] | null = null
function getStore(): AdminFileRecord[] {
  if (!mockStore) mockStore = seedMockFiles()
  return mockStore
}
const delay = (ms = 200) => new Promise<void>((r) => setTimeout(r, ms))

export const adminFilesMockAdapter: AdminFilesServiceInterface = {
  async listFiles(opts) {
    await delay()
    let rows = getStore()
    if (!opts?.includeDeleted) rows = rows.filter((f) => f.deletedAt === null)
    if (opts?.purpose) rows = rows.filter((f) => f.purpose === opts.purpose)
    return rows.slice(0, opts?.limit ?? 100).map((f) => ({ ...f }))
  },
  async getFileLifecycleSummary() {
    await delay(120)
    const now = Date.parse('2026-06-22T00:00:00.000Z')
    const active = getStore().filter((file) => file.deletedAt === null)
    const countBy = <K extends keyof AdminFileRecord>(key: K) => {
      const map = new Map<AdminFileRecord[K], number>()
      for (const file of active) map.set(file[key], (map.get(file[key]) ?? 0) + 1)
      return [...map.entries()].map(([k, count]) => ({ key: k as never, count }))
    }
    return {
      totalActive: active.length,
      longTermCount: active.filter((file) => file.retentionPolicy === 'long_term').length,
      expiringWithin7Days: active.filter((file) => file.expiresAt !== null && Date.parse(file.expiresAt) > now && Date.parse(file.expiresAt) <= now + 7 * 86_400_000).length,
      expiringWithin30Days: active.filter((file) => file.expiresAt !== null && Date.parse(file.expiresAt) > now && Date.parse(file.expiresAt) <= now + 30 * 86_400_000).length,
      expiredPendingCleanup: active.filter((file) => file.expiresAt !== null && Date.parse(file.expiresAt) <= now).length,
      byRetentionPolicy: countBy('retentionPolicy'),
      byRetentionSetBy: countBy('retentionSetBy'),
      generatedAt: '2026-06-22T00:00:00.000Z',
    }
  },
  async deleteFile(id, reason) {
    await delay()
    const store = getStore()
    const idx = store.findIndex((f) => f.id === id)
    if (idx === -1) throw new ApiHttpError('FILE_NOT_FOUND', '文件不存在', 404)
    const updated: AdminFileRecord = { ...store[idx]!, deletedAt: '2026-06-05T12:00:00.000Z', deletedBy: 'admin:mock', deleteReason: reason }
    store[idx] = updated
    return { ...updated }
  },
  async cleanupExpiredFiles() {
    await delay()
    const store = getStore()
    const now = Date.parse('2026-06-05T12:00:00.000Z')
    const expired = store.filter((f) => f.deletedAt === null && f.expiresAt !== null && Date.parse(f.expiresAt) <= now)
    for (const f of expired) {
      f.deletedAt = '2026-06-05T12:00:00.000Z'
      f.deletedBy = 'manual'
      f.deleteReason = '到期自动清理'
    }
    return {
      deletedCount: expired.length,
      deletedFileIds: expired.map((f) => f.id),
      triggeredBy: 'manual',
      triggeredAt: '2026-06-05T12:00:00.000Z',
    }
  },
  async getFileSignedUrl(id) {
    await delay(120)
    return {
      fileId: id,
      signedUrl: `/api/v1/files/${id}/content?expires=0&sig=mock`,
      expiresAt: '2026-06-05T12:05:00.000Z',
      purpose: 'print_doc',
    }
  },
}

// ─── Selector(编译期按 VITE_API_MODE 选择,与 sources.ts / aiUsage.ts 同模式)──────

const adapter: AdminFilesServiceInterface =
  API_MODE === 'http' ? adminFilesHttpAdapter : adminFilesMockAdapter

export const listFiles            = (opts?: ListFilesOptions) => adapter.listFiles(opts)
export const getFileLifecycleSummary = () => adapter.getFileLifecycleSummary()
export const deleteFile           = (id: string, reason: string) => adapter.deleteFile(id, reason)
export const cleanupExpiredFiles  = () => adapter.cleanupExpiredFiles()
export const getFileSignedUrl     = (id: string) => adapter.getFileSignedUrl(id)
