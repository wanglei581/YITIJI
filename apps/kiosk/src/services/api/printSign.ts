// ============================================================
// 签名盖章前端 API 封装 — Task 10
//
// 薄封装：POST /print/sign/inspect、POST /print/sign/compose
// 封装方式对齐同目录 printConversion.ts：
// - ResponseEnvelope<T> 解析后端统一响应结构
// - ApiHttpError 保留后端 error.code + status，不只截留 message
// - 网络失败（如一体机离线）单独捕获，给出本地化提示而非原始 TypeError
//
// terminalId 由调用方通过 request.terminalId 传入（复用现有
// apps/kiosk/src/services/api/screensaver.ts 的 getTerminalId()，
// 本文件不重复定义终端 id 获取逻辑，保持零业务逻辑）。
// ============================================================

import type {
  SignComposeRequest,
  SignComposeResponse,
  SignInspectRequest,
  SignInspectResponse,
} from '@ai-job-print/shared'
import { API_BASE_URL } from './client'
import { ApiHttpError } from './httpAdapter'

interface ResponseEnvelope<T> {
  success?: boolean
  data?: T
  error?: { code?: string; message?: string }
}

async function post<T>(
  path: string,
  body: unknown,
  headers: Record<string, string>,
): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  } catch {
    throw new ApiHttpError('NETWORK_ERROR', '网络连接失败，请稍后重试', 0)
  }

  let payload: ResponseEnvelope<T> | null = null
  try {
    payload = (await res.json()) as ResponseEnvelope<T>
  } catch {
    payload = null
  }

  if (!res.ok) {
    const code = payload?.error?.code ?? 'UNKNOWN_ERROR'
    const message = payload?.error?.message ?? `请求失败（${res.status}）`
    throw new ApiHttpError(code, message, res.status)
  }

  if (!payload?.data) {
    throw new ApiHttpError('SIGN_FAILED', '签章服务返回数据为空', res.status)
  }
  return payload.data
}

export async function signInspect(
  request: SignInspectRequest,
  options: { token: string | null },
): Promise<SignInspectResponse> {
  const headers: Record<string, string> = {}
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`
  return post<SignInspectResponse>('/print/sign/inspect', request, headers)
}

export async function signCompose(
  request: SignComposeRequest,
  options: { token: string | null; idempotencyKey: string },
): Promise<SignComposeResponse> {
  const headers: Record<string, string> = { 'Idempotency-Key': options.idempotencyKey }
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`
  return post<SignComposeResponse>('/print/sign/compose', request, headers)
}
