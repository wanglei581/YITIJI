// ============================================================
// 会员个人资产中心 API（Phase C-2B，只读）
//
// 调用真实后端 /api/v1/me/*（受 EndUserAuthGuard 保护，需会员 token）。
// - token 由调用方显式传入（来自 AuthContext 内存态 getToken()），不从任何存储读取。
// - 后端响应 envelope：{ success, data }，call<T> 解包后返回 T。
// - 这些接口只对登录会员有意义；mock 模式（无真实会员会话）直接返回空列表，避免无效请求。
// - 文件下载/预览不在列表里直接拿 URL：列表给 downloadUrlPath/previewUrlPath，
//   用户操作时再凭本人 token 换取 TTL 受控的短期签名 URL（fetchAccessUrl）。
// ============================================================

import type {
  MemberAssetPage,
  MemberResumeItem,
  MemberDocumentItem,
  MemberAiRecordItem,
  FileAccessUrlResponse,
} from '@ai-job-print/shared'
import { isMemberSessionInvalidError, notifyMemberSessionExpired } from '../auth/memberSessionEvents'
import { API_BASE_URL, API_MODE } from './client'

export class MemberAssetsApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'MemberAssetsApiError'
  }
}

interface Envelope<T> {
  success: boolean
  data: T
}

async function call<T>(path: string, token: string, method: 'GET' | 'DELETE' = 'GET'): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: { Accept: 'application/json', Authorization: `Bearer ${token}` },
      credentials: 'include',
    })
  } catch {
    throw new MemberAssetsApiError('NETWORK_ERROR', '网络连接失败，请稍后重试', 0)
  }
  if (!res.ok) {
    let code = 'UNKNOWN_ERROR'
    let message = `请求失败（${res.status}）`
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } }
      code = body.error?.code ?? code
      message = body.error?.message ?? message
    } catch { /* keep defaults */ }
    if (isMemberSessionInvalidError(res.status, code, true)) notifyMemberSessionExpired(token)
    throw new MemberAssetsApiError(code, message, res.status)
  }
  const json = (await res.json()) as Envelope<T>
  return json.data
}

/** 分页查询参数（C-2D 游标分页；pageSize 服务端封顶 50）。 */
export interface MemberPageOpts {
  cursor?: string | null
  pageSize?: number
}

const EMPTY_PAGE = { items: [], nextCursor: null, total: 0 }

function pageQuery(opts?: MemberPageOpts): string {
  const params = new URLSearchParams()
  if (opts?.cursor) params.set('cursor', opts.cursor)
  if (opts?.pageSize) params.set('pageSize', String(opts.pageSize))
  const q = params.toString()
  return q ? `?${q}` : ''
}

/** 我的简历（本人，仅元数据；含上传诊断 parse 与 AI 生成 generate）。未登录 / mock 模式返回空页。 */
export function getMyResumes(
  token: string | null | undefined,
  opts?: MemberPageOpts,
): Promise<MemberAssetPage<MemberResumeItem>> {
  if (API_MODE !== 'http' || !token) return Promise.resolve(EMPTY_PAGE)
  return call<MemberAssetPage<MemberResumeItem>>(`/me/resumes${pageQuery(opts)}`, token)
}

/** 我的文档（本人，仅元数据 + 临时访问端点路径）。未登录 / mock 模式返回空页。 */
export function getMyDocuments(
  token: string | null | undefined,
  opts?: MemberPageOpts,
): Promise<MemberAssetPage<MemberDocumentItem>> {
  if (API_MODE !== 'http' || !token) return Promise.resolve(EMPTY_PAGE)
  return call<MemberAssetPage<MemberDocumentItem>>(`/me/documents${pageQuery(opts)}`, token)
}

/** AI 服务记录（本人，仅元数据；kind=parse/optimize/generate 如实区分）。未登录 / mock 模式返回空页。 */
export function getMyAiRecords(
  token: string | null | undefined,
  opts?: MemberPageOpts,
): Promise<MemberAssetPage<MemberAiRecordItem>> {
  if (API_MODE !== 'http' || !token) return Promise.resolve(EMPTY_PAGE)
  return call<MemberAssetPage<MemberAiRecordItem>>(`/me/ai-records${pageQuery(opts)}`, token)
}

/**
 * 删除本人一条 AI 记录（C-2D，硬删；parse 行级联删同任务 optimize 行，服务端审计留痕）。
 * 删他人 / 不存在后端统一 404。
 */
export function deleteMyAiRecord(
  token: string,
  recordId: string,
): Promise<{ deleted: true; deletedCount: number }> {
  return call(`/me/ai-records/${encodeURIComponent(recordId)}`, token, 'DELETE')
}

/**
 * 删除本人一份文档（C-2D）：走既有 /files/:id 删除端点——对象存储物理删除 +
 * DB 行软删保留删除日志（CLAUDE.md §11），归属校验与审计在服务端。
 */
export function deleteMyDocument(token: string, fileId: string): Promise<unknown> {
  return call(`/files/${encodeURIComponent(fileId)}?reason=${encodeURIComponent('member self delete')}`, token, 'DELETE')
}

/** 凭本人 token 换取文档的短期签名访问 URL（下载 / 预览）。 */
export function fetchAccessUrl(path: string, token: string): Promise<FileAccessUrlResponse> {
  return call<FileAccessUrlResponse>(path, token)
}
