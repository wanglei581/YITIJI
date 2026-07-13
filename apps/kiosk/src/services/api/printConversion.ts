// ============================================================
// 格式转换（图片 → PDF）前端 API 封装 — Task 9
//
// 薄封装：POST /api/v1/print/convert/images-to-pdf
// - Idempotency-Key 通过请求头传递（后端 @Headers('idempotency-key') 读取，
//   HTTP 头大小写不敏感，Express 会统一转小写)。
// - 未登录（token 为 null）也允许调用：后端用 resolveOptionalEndUser 做可选鉴权。
// - 错误处理对齐同目录 scanTasks.ts / uploadSessions.ts：用 ApiHttpError 保留
//   后端 error.code（如 CONVERT_TOO_MANY_IMAGES）与 HTTP status，不只截留 message；
//   网络失败（如一体机离线）单独捕获，给出本地化提示而非原始 TypeError。
// ============================================================

import type {
  ComposeSignatureOverlayRequest,
  ComposeSignatureOverlayResponse,
  ConvertImagesRequest,
  ConvertImagesResponse,
} from '@ai-job-print/shared'
import { API_BASE_URL } from './client'
import { ApiHttpError } from './httpAdapter'

interface ResponseEnvelope<T> {
  success?: boolean
  data?: T
  error?: { code?: string; message?: string }
}

export async function convertImagesToPdf(
  request: ConvertImagesRequest,
  options: { token: string | null; idempotencyKey: string },
): Promise<ConvertImagesResponse> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Idempotency-Key': options.idempotencyKey,
  }
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`

  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}/print/convert/images-to-pdf`, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
    })
  } catch {
    throw new ApiHttpError('NETWORK_ERROR', '网络连接失败，请稍后重试', 0)
  }

  let payload: ResponseEnvelope<ConvertImagesResponse> | null = null
  try {
    payload = (await res.json()) as ResponseEnvelope<ConvertImagesResponse>
  } catch {
    payload = null
  }

  if (!res.ok) {
    const code = payload?.error?.code ?? 'UNKNOWN_ERROR'
    const message = payload?.error?.message ?? `请求失败（${res.status}）`
    throw new ApiHttpError(code, message, res.status)
  }

  if (!payload?.data) {
    throw new ApiHttpError('CONVERT_FAILED', '格式转换返回数据为空', res.status)
  }
  return payload.data
}

// ============================================================
// 签名盖章 — POST /api/v1/print/convert/sign-overlay
// 薄封装，错误处理与上面 convertImagesToPdf 完全一致。未接入 Idempotency-Key：
// 每次调用都会新建一份 FileObject + 审计记录（非真正幂等），网络失败后重试
// 会产生重复的短期派生 PDF；v1 判断该代价可接受（不涉及资金/库存），
// 如需杜绝重复产物再照抄 convertImagesToPdf 的幂等键实现。
// ============================================================

export async function composeSignatureOverlay(
  request: ComposeSignatureOverlayRequest,
  options: { token: string | null },
): Promise<ComposeSignatureOverlayResponse> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (options.token) headers['Authorization'] = `Bearer ${options.token}`

  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}/print/convert/sign-overlay`, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
    })
  } catch {
    throw new ApiHttpError('NETWORK_ERROR', '网络连接失败，请稍后重试', 0)
  }

  let payload: ResponseEnvelope<ComposeSignatureOverlayResponse> | null = null
  try {
    payload = (await res.json()) as ResponseEnvelope<ComposeSignatureOverlayResponse>
  } catch {
    payload = null
  }

  if (!res.ok) {
    const code = payload?.error?.code ?? 'UNKNOWN_ERROR'
    const message = payload?.error?.message ?? `请求失败（${res.status}）`
    throw new ApiHttpError(code, message, res.status)
  }

  if (!payload?.data) {
    throw new ApiHttpError('SIGN_OVERLAY_FAILED', '签名合成返回数据为空', res.status)
  }
  return payload.data
}
