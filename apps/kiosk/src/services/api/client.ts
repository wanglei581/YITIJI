// ============================================================
// API Client — Phase 7.2
//
// 通过环境变量控制运行模式：
//   VITE_API_MODE=mock（开发默认）→ 使用 mockAdapter，无需后端
//   VITE_API_MODE=http       → 使用 httpAdapter，必须同时配置 VITE_API_BASE_URL
//
// 环境变量在 Vite 构建时内联（import.meta.env），切换模式只需
// 修改 .env.local 并重启 dev server，无需改任何业务代码。
// ============================================================

/** 运行模式 */
export type ApiMode = 'mock' | 'http'

/** 当前运行模式（构建时确定） */
export const API_MODE: ApiMode =
  (import.meta.env.VITE_API_MODE as ApiMode | undefined) === 'http' ? 'http' : 'mock'

/** API 基础路径（http 模式必须通过 VITE_API_BASE_URL 配置） */
export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? '/api/v1'

/** 当前是否为 Mock 模式（向后兼容） */
export const IS_MOCK_MODE = API_MODE === 'mock'

if (import.meta.env.PROD && API_MODE !== 'http') {
  throw new Error('[API Client] 生产构建必须设置 VITE_API_MODE=http，禁止使用 mock API 模式')
}

// http 模式下若未配置 API_BASE_URL，控制台提前警告（不阻塞启动，但首次请求会失败）
if (import.meta.env.DEV && API_MODE === 'http' && !import.meta.env.VITE_API_BASE_URL) {
  console.warn(
    '[API Client] VITE_API_MODE=http 要求同时配置 VITE_API_BASE_URL。' +
      '当前将使用 /api/v1，请确认此路径可访问，否则所有 http 模式请求将失败。',
  )
}
