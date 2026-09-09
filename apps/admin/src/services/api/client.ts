import type { ReviewStatus, PublishStatus } from '@ai-job-print/shared'

export type { ReviewStatus, PublishStatus }

export type ApiMode = 'mock' | 'http'

export const API_MODE: ApiMode =
  (import.meta.env.VITE_API_MODE as ApiMode | undefined) === 'http' ? 'http' : 'mock'

export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? '/api/v1'

// 生产构建禁止落到 mock：少传 / 写错 VITE_API_MODE 时，构建会**静默**打包 mock 适配器，
// 后台照样渲染出一整套假数据（假机构、假岗位、假价目、假法务文本），
// 运营人员会照着它决策。宁可当场炸，也不能发布一个说假话的后台。
// 口径与 apps/kiosk/src/services/api/client.ts 同源（那边 2026 年就装了这条，
// admin / partner 一直没有 —— 2026-09-09 实测两边各 0 处 PROD 断言）。
if (import.meta.env.PROD && API_MODE !== 'http') {
  throw new Error('[Admin API Client] 生产构建必须设置 VITE_API_MODE=http，禁止使用 mock API 模式')
}

if (import.meta.env.DEV && API_MODE === 'http' && !import.meta.env.VITE_API_BASE_URL) {
  console.warn('[Admin API Client] VITE_API_MODE=http 要求同时配置 VITE_API_BASE_URL，否则请求将发往 /api/v1')
}

export class ApiHttpError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly reason?: string,
  ) {
    super(message)
    this.name = 'ApiHttpError'
  }
}
