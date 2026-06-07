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
  MemberResumeItem,
  MemberDocumentItem,
  MemberAiRecordItem,
  FileAccessUrlResponse,
} from '@ai-job-print/shared'
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

async function call<T>(path: string, token: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: 'GET',
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
    throw new MemberAssetsApiError(code, message, res.status)
  }
  const json = (await res.json()) as Envelope<T>
  return json.data
}

/** 我的简历（本人，仅元数据）。未登录 / mock 模式返回 []。 */
export function getMyResumes(token: string | null | undefined): Promise<MemberResumeItem[]> {
  if (API_MODE !== 'http' || !token) return Promise.resolve([])
  return call<MemberResumeItem[]>('/me/resumes', token)
}

/** 我的文档（本人，仅元数据 + 临时访问端点路径）。未登录 / mock 模式返回 []。 */
export function getMyDocuments(token: string | null | undefined): Promise<MemberDocumentItem[]> {
  if (API_MODE !== 'http' || !token) return Promise.resolve([])
  return call<MemberDocumentItem[]>('/me/documents', token)
}

/** AI 服务记录（本人，仅元数据）。未登录 / mock 模式返回 []。 */
export function getMyAiRecords(token: string | null | undefined): Promise<MemberAiRecordItem[]> {
  if (API_MODE !== 'http' || !token) return Promise.resolve([])
  return call<MemberAiRecordItem[]>('/me/ai-records', token)
}

/** 凭本人 token 换取文档的短期签名访问 URL（下载 / 预览）。 */
export function fetchAccessUrl(path: string, token: string): Promise<FileAccessUrlResponse> {
  return call<FileAccessUrlResponse>(path, token)
}
