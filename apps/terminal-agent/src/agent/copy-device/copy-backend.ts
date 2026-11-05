import type { AxiosRequestConfig } from 'axios'
import { createApiClient, NO_RETRY_CONFIG, isUnauthorizedHttpError } from '../api-client'
import { isUnauthorized, markUnauthorized } from '../auth-state'
import type { AgentConfig } from '../types'
import { CopyError, type CopyPermit, type CopySession } from './copy-types'

export function copyBackend(config: AgentConfig) {
  const client = () => {
    if (!config.terminalId || !config.agentToken || isUnauthorized()) throw new CopyError(503, 'COPY_UNAUTHORIZED')
    return createApiClient(config.apiBaseUrl, config.agentToken, config.terminalId)
  }
  const route = (id: string) => `/terminals/${encodeURIComponent(config.terminalId!)}/copy/jobs/${encodeURIComponent(id)}`
  const options: AxiosRequestConfig = { ...NO_RETRY_CONFIG, timeout: 10_000, maxRedirects: 0 }
  const request = async <T>(fn: () => Promise<{ data: { success: boolean; data: T } }>): Promise<T> => {
    try {
      const response = await fn()
      if (response.data?.success !== true || !response.data.data) throw new Error('invalid envelope')
      return response.data.data
    } catch (error) {
      if (isUnauthorizedHttpError(error)) markUnauthorized()
      throw new CopyError(503, 'COPY_BACKEND_UNAVAILABLE')
    }
  }
  return {
    permit: (id: string) => request<CopyPermit>(() => client().get(`${route(id)}/permit?op=scan`, options)),
    report: async (id: string, generation: number, pageCount: number): Promise<void> => {
      const view = await request<{ copyId: string; terminalId: string; generation: number; pageCount: number; state: string }>(
        () => client().post(`${route(id)}/scan-result`, { generation, pageCount }, options),
      )
      if (view.copyId !== id || view.terminalId !== config.terminalId || view.generation !== generation ||
        view.pageCount !== pageCount || view.state !== 'scanned') throw new CopyError(503, 'COPY_SCAN_RESULT_UNCONFIRMED')
    },
  }
}

/** 拿锁之后在线获取；比较完整服务端参数快照，扫描色彩单独由本机命令指定。 */
export function assertCopyPermit(p: CopyPermit, s: CopySession, config: AgentConfig, requestedAt: number, now: number): void {
  const expiry = Date.parse(p?.expiresAt)
  const v = p?.parameters
  if (p?.allowed !== true || !config.terminalId || p.copyId !== s.command.copyId || p.op !== 'scan' ||
    p.generation !== s.command.generation || (p.terminalId !== undefined && p.terminalId !== config.terminalId) ||
    !Number.isSafeInteger(p.authorizationVersion) || p.authorizationVersion < 0 ||
    !Number.isFinite(expiry) || expiry <= now || expiry > now + 30_000 || now - requestedAt > 30_000 ||
    !v || v.source !== s.command.source || !['black_white', 'color'].includes(v.colorMode) ||
    !['simplex', 'duplex_long_edge', 'duplex_short_edge'].includes(v.duplex) ||
    !Number.isSafeInteger(v.copies) || v.copies < 1 || !Number.isSafeInteger(v.maxCopies) ||
    v.copies > v.maxCopies || v.maxCopies > 99 || !Number.isSafeInteger(v.pageCount) || v.pageCount !== 0 ||
    !Number.isSafeInteger(v.maxPages) || v.maxPages < 1 || v.maxPages > 50 ||
    (s.permit && (p.authorizationVersion !== s.permit.authorizationVersion ||
      JSON.stringify(v) !== JSON.stringify(s.permit.parameters)))) {
    throw new CopyError(403, 'COPY_UNAUTHORIZED')
  }
}
