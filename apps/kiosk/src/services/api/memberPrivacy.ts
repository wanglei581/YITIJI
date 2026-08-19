import type {
  MemberDataRequestItem,
  MemberDataRequestPage,
  MemberDataRequestType,
} from '@ai-job-print/shared'
import { API_BASE_URL, API_MODE } from './client'
import { ApiHttpError } from './httpAdapter'
import { getTerminalId } from './screensaver'
import { isMemberSessionInvalidError, notifyMemberSessionExpired } from '../auth/memberSessionEvents'

interface Envelope<T> {
  success: boolean
  data: T
}

function authHeaders(token: string, withJsonBody = false, extra?: Record<string, string>): Record<string, string> {
  const terminalId = getTerminalId()
  return {
    Accept: 'application/json',
    ...(withJsonBody ? { 'Content-Type': 'application/json' } : {}),
    Authorization: `Bearer ${token}`,
    ...(terminalId ? { 'x-terminal-id': terminalId } : {}),
    ...extra,
  }
}

async function unwrap<T>(res: Response, token: string): Promise<T> {
  if (!res.ok) {
    let code = 'UNKNOWN_ERROR'
    let message = `请求失败（${res.status}）`
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string } }
      code = body.error?.code ?? code
      message = body.error?.message ?? message
    } catch {
      // keep defaults
    }
    if (isMemberSessionInvalidError(res.status, code, true)) notifyMemberSessionExpired(token)
    throw new ApiHttpError(code, message, res.status)
  }
  const json = (await res.json()) as Envelope<T>
  return json.data
}

function rejectMock<T>(): Promise<T> {
  return Promise.reject(
    new ApiHttpError('MEMBER_PRIVACY_MOCK_DISABLED', '隐私数据请求需连接真实后端后使用', 503),
  )
}

export async function listMyDataRequests(token: string): Promise<MemberDataRequestItem[]> {
  if (API_MODE !== 'http') return rejectMock()
  const res = await fetch(`${API_BASE_URL}/me/data-requests`, {
    method: 'GET',
    headers: authHeaders(token),
    credentials: 'include',
  })
  const page = await unwrap<MemberDataRequestPage>(res, token)
  return page.items
}

/** 一体机本波仅开放 revoke_consent；export 需 step-up，delete 后端直接拒绝。 */
export async function createMyDataRequest(
  token: string,
  requestType: Extract<MemberDataRequestType, 'revoke_consent'>,
): Promise<MemberDataRequestItem> {
  if (API_MODE !== 'http') return rejectMock()
  const idempotencyKey = crypto.randomUUID()
  const res = await fetch(`${API_BASE_URL}/me/data-requests`, {
    method: 'POST',
    headers: authHeaders(token, true, { 'idempotency-key': idempotencyKey }),
    credentials: 'include',
    body: JSON.stringify({ requestType }),
  })
  return unwrap<MemberDataRequestItem>(res, token)
}
