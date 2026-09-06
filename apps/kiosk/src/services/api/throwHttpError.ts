/**
 * 一体机适配器共用的 HTTP 失败出口。
 * 一律抛 ApiHttpError(code, 中文, status)；带会员 token 的 401 触发会话重置。
 */
import { isMemberSessionInvalidError, notifyMemberSessionExpired } from '../auth/memberSessionEvents'
import { ApiHttpError } from './httpAdapter'

export async function readHttpError(res: Response): Promise<{ code: string; message: string }> {
  let code = 'UNKNOWN_ERROR'
  let message = `请求失败（${res.status}）`
  try {
    const body = (await res.json()) as {
      error?: { code?: string; message?: string }
      message?: string | string[]
    }
    if (typeof body.error?.code === 'string' && body.error.code) code = body.error.code
    const fromError = body.error?.message
    const fromMessage = Array.isArray(body.message) ? body.message.join('；') : body.message
    const picked = fromError ?? fromMessage
    if (typeof picked === 'string' && picked.trim()) message = picked
  } catch {
    /* 非 JSON：保留中文兜底，不把状态码英文短语甩到屏幕上 */
  }
  return { code, message }
}

export function notifySessionIfInvalid(status: number, code: string, token?: string | null): void {
  if (isMemberSessionInvalidError(status, code, Boolean(token))) {
    notifyMemberSessionExpired(token ?? undefined)
  }
}

export async function throwHttpError(res: Response, token?: string | null): Promise<never> {
  const { code, message } = await readHttpError(res)
  notifySessionIfInvalid(res.status, code, token)
  throw new ApiHttpError(code, message, res.status)
}

export function networkError(err?: unknown): ApiHttpError {
  if (err instanceof ApiHttpError) return err
  if (err instanceof Error && err.name === 'AbortError') {
    return new ApiHttpError('REQUEST_TIMEOUT', '本次请求响应超时，请重试', 408)
  }
  return new ApiHttpError('NETWORK_ERROR', '网络连接失败，请检查网络后重试', 0)
}
