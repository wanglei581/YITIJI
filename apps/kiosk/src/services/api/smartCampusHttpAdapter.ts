import type { KioskSmartCampusConfig } from '@ai-job-print/shared'
import { API_BASE_URL } from './client'
import { ApiHttpError } from './httpAdapter'

/**
 * 智慧校园配置 HTTP adapter。命中后端 GET /terminals/:id/smart-campus（无登录，只读）。
 * 后端返回裸 KioskSmartCampusConfig（白名单：enabled + modules + 上架应用项，不含学生数据）。
 */
export const smartCampusHttpAdapter = {
  async getConfig(terminalId: string): Promise<KioskSmartCampusConfig> {
    const url = new URL(
      `${API_BASE_URL}/terminals/${encodeURIComponent(terminalId)}/smart-campus`,
      window.location.origin,
    )
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'include',
    })
    if (!res.ok) {
      let code = 'UNKNOWN_ERROR'
      let message = `HTTP ${res.status}`
      try {
        const body = (await res.json()) as { error?: { code?: string; message?: string } }
        code = body.error?.code ?? code
        message = body.error?.message ?? message
      } catch {
        /* non-JSON */
      }
      throw new ApiHttpError(code, message, res.status)
    }
    return res.json() as Promise<KioskSmartCampusConfig>
  },
}
