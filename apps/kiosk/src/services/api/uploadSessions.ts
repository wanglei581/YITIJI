import type {
  UploadSessionCancelResponse,
  UploadSessionConfirmResponse,
  UploadSessionCreateRequest,
  UploadSessionCreateResponse,
  UploadSessionStatusResponse,
} from '@ai-job-print/shared'
import { isMemberSessionInvalidError, notifyMemberSessionExpired } from '../auth/memberSessionEvents'
import { API_BASE_URL } from './client'
import { ApiHttpError } from './httpAdapter'

interface ResponseEnvelope<T> {
  success?: boolean
  data?: T
  error?: { code?: string; message?: string }
}

function makeUrl(path: string): string {
  return new URL(`${API_BASE_URL}${path}`, window.location.origin).toString()
}

async function requestJson<T>(path: string, init?: RequestInit & { token?: string | null; controlToken?: string | null }): Promise<T> {
  const token = init?.token
  const headers = new Headers(init?.headers)
  headers.set('Accept', 'application/json')
  if (init?.body && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init?.controlToken) headers.set('X-Upload-Session-Control', init.controlToken)

  let res: Response
  try {
    res = await fetch(makeUrl(path), {
      ...init,
      headers,
      credentials: 'include',
    })
  } catch {
    throw new ApiHttpError('NETWORK_ERROR', '网络连接失败，请稍后重试', 0)
  }

  let payload: ResponseEnvelope<T> | T | null = null
  try {
    payload = (await res.json()) as ResponseEnvelope<T> | T
  } catch {
    payload = null
  }

  if (!res.ok) {
    const envelope = payload as ResponseEnvelope<T> | null
    const code = envelope?.error?.code ?? 'UNKNOWN_ERROR'
    const message = envelope?.error?.message ?? `请求失败（${res.status}）`
    if (isMemberSessionInvalidError(res.status, code, Boolean(token))) notifyMemberSessionExpired(token ?? undefined)
    throw new ApiHttpError(code, message, res.status)
  }

  const envelope = payload as ResponseEnvelope<T> | null
  if (envelope && typeof envelope === 'object' && 'data' in envelope) {
    if (envelope.data === undefined || envelope.data === null) {
      throw new ApiHttpError('UPLOAD_SESSION_EMPTY', '上传会话返回数据为空', res.status)
    }
    return envelope.data
  }
  if (payload === null) {
    throw new ApiHttpError('UPLOAD_SESSION_EMPTY', '上传会话返回数据为空', res.status)
  }
  return payload as T
}

export function createUploadSession(
  input: UploadSessionCreateRequest,
  token?: string | null,
): Promise<UploadSessionCreateResponse> {
  return requestJson<UploadSessionCreateResponse>('/upload-sessions', {
    method: 'POST',
    token,
    body: JSON.stringify(input),
  })
}

export function getUploadSessionStatus(sessionId: string, controlToken: string): Promise<UploadSessionStatusResponse> {
  return requestJson<UploadSessionStatusResponse>(`/upload-sessions/${encodeURIComponent(sessionId)}`, { controlToken })
}

export function confirmUploadSession(
  sessionId: string,
  controlToken: string,
  token?: string | null,
): Promise<UploadSessionConfirmResponse> {
  return requestJson<UploadSessionConfirmResponse>(`/upload-sessions/${encodeURIComponent(sessionId)}/confirm`, {
    method: 'POST',
    controlToken,
    token,
  })
}

export function cancelUploadSession(sessionId: string, controlToken: string): Promise<UploadSessionCancelResponse> {
  return requestJson<UploadSessionCancelResponse>(`/upload-sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
    controlToken,
  })
}

export function uploadPhoneSessionFile(args: {
  sessionId: string
  uploadToken: string
  file: File
}): Promise<UploadSessionStatusResponse> {
  const form = new FormData()
  form.append('uploadToken', args.uploadToken)
  form.append('file', args.file, args.file.name)
  return requestJson<UploadSessionStatusResponse>(
    `/upload-sessions/${encodeURIComponent(args.sessionId)}/files`,
    {
      method: 'POST',
      body: form,
    },
  )
}

export function buildPhoneUploadUrl(uploadUrl: string, sessionId: string, uploadToken: string, purpose?: string): string {
  const url = new URL(uploadUrl, window.location.origin)
  const fragment = new URLSearchParams()
  fragment.set('sessionId', sessionId)
  fragment.set('token', uploadToken)
  // purpose 仅用于手机端文案展示,不参与鉴权(会话真正的 purpose 由服务端存储决定)。
  if (purpose) fragment.set('purpose', purpose)
  url.hash = fragment.toString()
  return url.toString()
}
