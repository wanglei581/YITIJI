import { resolveClientIp } from './client-ip'

/**
 * 写审计时附带的请求上下文：来源 IP（只信 Express 在 trust proxy 配置后填的 req.ip）、
 * 浏览器标识（截 256 字）、请求编号（RequestIdMiddleware 挂的 req.requestId）。
 */
export interface RequestAuditContext {
  ipAddress: string | null
  userAgent: string | null
  requestId: string | null
}

export function requestAuditContext(req: unknown): RequestAuditContext {
  const record = (req && typeof req === 'object' ? req : {}) as {
    headers?: Record<string, string | string[] | undefined>
    requestId?: string
  }
  const ua = record.headers?.['user-agent']
  const userAgent = typeof ua === 'string' ? ua : Array.isArray(ua) ? (ua[0] ?? null) : null
  return {
    ipAddress: resolveClientIp(req),
    userAgent: userAgent ? userAgent.slice(0, 256) : null,
    requestId: typeof record.requestId === 'string' ? record.requestId : null,
  }
}
