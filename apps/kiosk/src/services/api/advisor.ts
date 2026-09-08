// 顾问作业面：只封装已经存在的端点，不发明「列出全部产物」。

import { API_BASE_URL } from './client'
import { ApiHttpError } from './httpAdapter'
import { networkError, throwHttpError } from './throwHttpError'

export interface AdvisorAccess {
  token?: string | null
  accessToken?: string | null
}

export interface AdvisorArtifactPrintResult {
  artifactId: string
  kind: string
  fileId: string
  filename: string
  sizeBytes: number
  pageCount: number
  signedUrl: string
  expiresAt: string
  printFileUrl: string
}

const TIMEOUT_MS = 15_000

function accessHeaders(access?: AdvisorAccess): Record<string, string> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (access?.token) headers.Authorization = `Bearer ${access.token}`
  if (access?.accessToken) headers['x-advisor-access-token'] = access.accessToken
  return headers
}

async function request(path: string, init: RequestInit, access?: AdvisorAccess): Promise<Response> {
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS)
  try {
    return await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: {
        ...accessHeaders(access),
        ...(init.headers ?? {}),
      },
      credentials: 'include',
      signal: ac.signal,
    })
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApiHttpError('REQUEST_TIMEOUT', `请求超时（${TIMEOUT_MS / 1000}s）`, 408)
    }
    throw networkError(err)
  } finally {
    clearTimeout(timer)
  }
}

export async function getAdvisorSession(sessionId: string, access?: AdvisorAccess): Promise<unknown> {
  const res = await request(`/advisor/sessions/${encodeURIComponent(sessionId)}`, { method: 'GET' }, access)
  if (!res.ok) await throwHttpError(res, access?.token)
  return res.json()
}

export async function printAdvisorArtifact(
  sessionId: string,
  artifactId: string,
  access?: AdvisorAccess,
): Promise<AdvisorArtifactPrintResult> {
  const res = await request(
    `/advisor/sessions/${encodeURIComponent(sessionId)}/artifacts/${encodeURIComponent(artifactId)}/print`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    },
    access,
  )
  if (!res.ok) await throwHttpError(res, access?.token)
  const body = (await res.json()) as Partial<AdvisorArtifactPrintResult>
  if (!body.fileId || !body.filename) {
    throw new ApiHttpError('ADVISOR_PRINT_MALFORMED', '打印回执缺少文件编号', 500)
  }
  return {
    artifactId: body.artifactId ?? artifactId,
    kind: body.kind ?? '',
    fileId: body.fileId,
    filename: body.filename,
    sizeBytes: Number(body.sizeBytes) || 0,
    pageCount: Number(body.pageCount) || 0,
    signedUrl: body.signedUrl ?? '',
    expiresAt: body.expiresAt ?? '',
    printFileUrl: body.printFileUrl ?? '',
  }
}
