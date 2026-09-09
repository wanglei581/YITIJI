import { compatibilityRedirects, productionRoutePatterns } from './route-manifest'

export type ProductionRoutePattern = (typeof productionRoutePatterns)[number]

export interface SweepCase {
  pattern: ProductionRoutePattern
  url: string
  /** 最终落地 pathname。与 url 不同表示兼容重定向或产品 fail-closed。 */
  landedPath: string
}

/**
 * 带参数路由的 mock 夹具路径。键必须覆盖 productionRoutePatterns 里每一条含 `:` 的模式。
 * 具体 id 与 W4/W6 ApiRouter 夹具对齐（job-001 / fair-001 / agency-001 等）。
 */
const PARAM_SAMPLES = {
  '/legal/:doc': '/legal/privacy',
  '/me/activity/:id': '/me/activity/sweep-record',
  '/activities/:id': '/activities/activity-001',
  '/smart-campus/service/:key': '/smart-campus/service/campus-card',
  '/print-scan/feature/:key': '/print-scan/feature/id-photo',
  '/jobs/:id': '/jobs/job-001',
  '/jobs/:id/offline': '/jobs/offline-job-001/offline',
  '/offline-agencies/:id': '/offline-agencies/agency-001',
  '/companies/:id': '/companies/company-001',
  '/job-fairs/:id': '/job-fairs/fair-001',
  '/job-fairs/:id/companies': '/job-fairs/fair-001/companies',
  '/job-fairs/:id/companies/:companyId': '/job-fairs/fair-001/companies/fair-company-001',
  '/job-fairs/:id/map': '/job-fairs/fair-001/map',
  '/job-fairs/:id/materials': '/job-fairs/fair-001/materials',
  '/job-fairs/:id/visit-plan': '/job-fairs/fair-001/visit-plan',
  '/job-fairs/:id/stats': '/job-fairs/fair-001/stats',
} as const satisfies Partial<Record<ProductionRoutePattern, `/${string}`>>

/**
 * 直接访问时产品层会换路径的路由。
 * 不含兼容重定向（那些走 compatibilityRedirects）。
 *
 * - /session-timeout：孤立访问视为清场，硬切首页（KioskPrivacyGuard）
 * - /screensaver：夹具 playlist.enabled=false，无素材则退出回首页
 * - /session-resume：未登录切登录页
 * - /contract-review*：生产默认关闭，Navigate 回首页
 */
const FAIL_CLOSED_LANDINGS = {
  '/session-timeout': '/',
  '/screensaver': '/',
  '/session-resume': '/login',
  '/contract-review': '/',
  '/contract-review/processing': '/',
  '/contract-review/result': '/',
} as const satisfies Partial<Record<ProductionRoutePattern, `/${string}`>>

export const parameterizedPatterns: ProductionRoutePattern[] = productionRoutePatterns.filter((pattern) =>
  pattern.includes(':'),
)

export function paramSampleKeys(): string[] {
  return Object.keys(PARAM_SAMPLES)
}

export function resolveSweepUrl(pattern: ProductionRoutePattern): string {
  if (!pattern.includes(':')) return pattern
  const sample = PARAM_SAMPLES[pattern as keyof typeof PARAM_SAMPLES]
  if (!sample) {
    throw new Error(`route-sweep 缺少参数样本: ${pattern}`)
  }
  return sample
}

export function resolveLandedPath(pattern: ProductionRoutePattern, url: string): string {
  if (pattern in FAIL_CLOSED_LANDINGS) {
    return FAIL_CLOSED_LANDINGS[pattern as keyof typeof FAIL_CLOSED_LANDINGS]
  }
  if (pattern in compatibilityRedirects) {
    const target = compatibilityRedirects[pattern as keyof typeof compatibilityRedirects]
    // 重定向目标可能带查询串（`/print/desk?step=preview`、`/scan?stage=progress`）：
    // 带状态透传是有意的，裸 replace 会把深链进来的用户静默重置到第 1 步。
    // 调用方 route-sweep.spec.ts 比的是 `url.pathname`，不含查询串，所以这里剥掉。
    return target.split('?')[0] ?? target
  }
  return url.split('?')[0] ?? url
}

export const sweepCases: SweepCase[] = productionRoutePatterns.map((pattern) => {
  const url = resolveSweepUrl(pattern)
  return { pattern, url, landedPath: resolveLandedPath(pattern, url) }
})
