import type { ReviewStatus, PublishStatus } from '@ai-job-print/shared'

export type { ReviewStatus, PublishStatus }

export type ApiMode = 'mock' | 'http'

export const API_MODE: ApiMode =
  (import.meta.env.VITE_API_MODE as ApiMode | undefined) === 'http' ? 'http' : 'mock'

export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? '/api/v1'

// 这里**故意没有** `if (import.meta.env.PROD && API_MODE !== 'http') throw`。
// 我加过一次，它把 Admin 浏览器 E2E 整段挂死了（2026-09-10 实测 36.6 分钟未完成，
// 健康值 0.7 分钟），原因是 **`import.meta.env.PROD` 不是「production 模式」的意思**：
// `vite build` 无论 `--mode` 传什么都把它折成 `true`（同一份产物里
// `import.meta.env.DEV` 分支被折成 false 整段消失，可交叉印证）。
// E2E 的 webServer 是 `VITE_API_MODE=mock vite build --mode development`，
// 于是条件折成恒真，产物里直接是一句**无条件 `throw`**，应用在模块导入期就炸，
// 页面永远起不来，每条用例干等到超时。
// `playwright.config.ts` 里「用 development mode 跳过该门禁」那句只对
// `vite.config.ts` 的 `assertProdApiMode`（读 `mode`）成立，对 `PROD` 不成立。
// kiosk 敢装这条，是因为它的 E2E 用 `VITE_API_MODE=http` 构建，条件为假。
//
// 而这条运行时守卫本来就是多余的：`vite.config.ts` 的 `assertProdApiMode`
// 已经在**配置加载阶段**拒绝非 http 的生产构建（本机实测 `--mode production` +
// `VITE_API_MODE=mock` 直接 exit 1 于 resolveConfig，根本没有产物）。
// 真正缺的是「没人守着那个 config 闸门」，所以防线放在
// `scripts/verify-deploy-gates-in-sync.mjs`，不放在运行时。

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
