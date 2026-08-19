/**
 * V6 暖纸壳覆盖表。负责人 2026-08-19：一体机每一个用户页都换 V6，不是只换首页。
 * KioskRoot 与全屏壳都通过 resolveV6Shell / 本表判定；不要在页面里再写 pathname ===。
 */

export interface V6ShellRoute {
  domainTitle: string | null
  withTerminalCode: boolean
  brandReturnsHome: boolean
}

export const V6_SHELL_DEFAULT: V6ShellRoute = {
  domainTitle: null,
  withTerminalCode: true,
  brandReturnsHome: false,
}

const V6_SHELL_OVERRIDES: Record<string, V6ShellRoute> = {
  '/': { domainTitle: null, withTerminalCode: false, brandReturnsHome: false },
  '/print-scan': { domainTitle: '打印扫描服务', withTerminalCode: true, brandReturnsHome: true },
  '/profile': { domainTitle: '我的', withTerminalCode: true, brandReturnsHome: false },
}

/** 一体机用户可见路由。手机辅助页 /member/qr-login、/upload/phone 不进这张表。 */
export const V6_SHELL_ROUTE_KEYS = [
  '/',
  '/assistant',
  '/profile',
  '/me/resumes',
  '/me/print-orders',
  '/me/documents',
  '/me/favorites',
  '/me/ai-records',
  '/me/benefits',
  '/me/activity',
  '/me/activity/:id',
  '/me/notifications',
  '/me/feedback',
  '/me/settings',
  '/me/privacy-requests',
  '/help',
  '/activities',
  '/activities/:id',
  '/renshi',
  '/campus',
  '/campus/welcome',
  '/campus/freshman-insights',
  '/toolbox',
  '/smart-campus',
  '/smart-campus/welcome',
  '/smart-campus/freshman-insights',
  '/smart-campus/service/:key',
  '/print-scan',
  '/print-scan/feature/:key',
  '/print-scan/convert',
  '/print-scan/sign',
  '/print/scan-convert',
  '/print/scan-sign',
  '/print/scan-feature',
  '/print/upload',
  '/print/material-check',
  '/print/preview',
  '/print/params',
  '/print/confirm',
  '/print/cashier',
  '/print/progress',
  '/print/done',
  '/print/pickup-claim',
  '/resume',
  '/resume/upload',
  '/resume/source',
  '/resume/generate',
  '/resume/generate/preview',
  '/resume/parse',
  '/resume/report',
  '/resume/optimize',
  '/resume/optimize/compare',
  '/resume/export',
  '/resume/templates',
  '/resume/materials',
  '/resume-service',
  '/scan/start',
  '/scan/settings',
  '/scan/progress',
  '/scan/result',
  '/jobs',
  '/jobs/:id',
  '/jobs/:id/offline',
  '/jobs-service',
  '/jobs/online-platforms',
  '/offline-agencies',
  '/offline-agencies/:id',
  '/notifications',
  '/companies',
  '/companies/:id',
  '/job-fairs',
  '/job-fairs/checkin',
  '/job-fairs/:id',
  '/job-fairs/:id/companies',
  '/job-fairs/:id/companies/:companyId',
  '/job-fairs/:id/map',
  '/job-fairs/:id/materials',
  '/job-fairs/:id/visit-plan',
  '/job-fairs/:id/stats',
  '/fairs-service',
  '/ai/plan',
  '/session-resume',
  '/interview-service',
  '/policy-service',
  '/resume/job-fit',
  '/resume/job-fit/actions',
  '/resume/career-plan',
  '/resume/self-assessment/intro',
  '/resume/self-assessment/questions',
  '/resume/self-assessment/result',
  '/resume/self-assessment/history',
  '/interview/setup',
  '/interview/session',
  '/interview/report',
  '/interview/tips',
  '/interview/reports',
  '/contract-review',
  '/contract-review/processing',
  '/contract-review/result',
] as const

export const V6_SHELL_ROUTES = new Map<string, V6ShellRoute>(
  V6_SHELL_ROUTE_KEYS.map((key) => [key, V6_SHELL_OVERRIDES[key] ?? V6_SHELL_DEFAULT]),
)

export function matchV6RoutePattern(pattern: string, pathname: string): boolean {
  if (pattern === pathname) return true
  const patternParts = pattern.split('/')
  const pathParts = pathname.split('/')
  if (patternParts.length !== pathParts.length) return false
  return patternParts.every((part, index) => part.startsWith(':') || part === pathParts[index])
}

export function resolveV6Shell(pathname: string): V6ShellRoute | null {
  const exact = V6_SHELL_ROUTES.get(pathname)
  if (exact) return exact
  for (const [pattern, entry] of V6_SHELL_ROUTES) {
    if (pattern.includes(':') && matchV6RoutePattern(pattern, pathname)) return entry
  }
  return V6_SHELL_DEFAULT
}
