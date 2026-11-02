export type WindDownRouteKind = 'always' | 'result' | 'work'
export interface WindDownRoute { path: string; service: string; kind: WindDownRouteKind }

// Explicit route patterns mirror routes/index.tsx, including redirects and mobile entry points.
const groups: Array<[string, WindDownRouteKind, string[]]> = [
  ['public', 'always', ['/', '/login', '/legal/:doc', '/screensaver', '/session-timeout', '/error-offline', '/help', '/notifications', '/official-channels', '/jobs/online-platforms', '/member/qr-login', '/k/l/:ticketId']],
  ['mine', 'always', ['/profile', '/me/resumes', '/me/print-orders', '/me/documents', '/me/favorites', '/me/ai-records', '/me/benefits', '/me/activity', '/me/activity/:id', '/me/notifications', '/me/feedback', '/me/settings', '/me/privacy-requests']],
  ['information', 'always', ['/renshi', '/print-scan', '/print-scan/feature/:key', '/print/scan-feature', '/jobs', '/jobs/:id', '/jobs/:id/offline', '/offline-agencies', '/offline-agencies/:id', '/companies', '/companies/:id', '/job-fairs', '/job-fairs/:id', '/job-fairs/:id/companies', '/job-fairs/:id/companies/:companyId', '/job-fairs/:id/map', '/job-fairs/:id/stats', '/campus', '/campus/welcome', '/jobs-service', '/fairs-service']],
  ['activities', 'work', ['/activities', '/activities/:id']],
  ['campus', 'work', ['/smart-campus', '/smart-campus/welcome', '/smart-campus/service/:key', '/campus/freshman-insights']],
  ['fair', 'work', ['/job-fairs/checkin', '/job-fairs/:id/materials', '/job-fairs/:id/visit-plan']],
  ['toolbox', 'work', ['/toolbox', '/dev/touch-gallery']],
  ['print', 'work', ['/print/upload', '/print/desk', '/print/material-check', '/print/preview', '/print/params', '/print/confirm', '/print/cashier', '/print/progress', '/print/pickup-claim', '/upload/phone', '/k/u/:scene']],
  ['print', 'result', ['/print/done']],
  ['convert', 'work', ['/print-scan/convert', '/print/scan-convert']],
  ['sign', 'work', ['/print-scan/sign', '/print/scan-sign']],
  ['scan', 'work', ['/scan', '/scan/start', '/scan/settings', '/scan/progress', '/scan/result']],
  ['resume', 'work', ['/resume-service', '/resume', '/resume/upload', '/resume/source', '/resume/generate', '/resume/parse', '/resume/optimize', '/resume/optimize/compare', '/resume/export', '/resume/templates', '/resume/materials']],
  ['resume', 'result', ['/resume/generate/preview', '/resume/report']],
  ['job-fit', 'work', ['/resume/job-fit', '/resume/job-fit/actions']],
  ['career-plan', 'work', ['/resume/career-plan']],
  ['self-assessment', 'work', ['/resume/self-assessment/intro', '/resume/self-assessment/questions']],
  ['self-assessment', 'result', ['/resume/self-assessment/result', '/resume/self-assessment/history']],
  ['interview', 'work', ['/interview-service', '/interview', '/interview/setup', '/interview/session', '/interview/report', '/interview/tips', '/interview/reports']],
  ['assistant', 'work', ['/assistant']],
  ['ai-plan', 'work', ['/ai/plan', '/session-resume']],
  ['policy', 'work', ['/policy-service']],
  ['contract-review', 'work', ['/contract-review', '/contract-review/processing']],
  ['contract-review', 'result', ['/contract-review/result']],
  ['unknown', 'work', ['*']],
]

export const WIND_DOWN_ROUTES: WindDownRoute[] = groups.flatMap(([service, kind, paths]) => paths.map((path) => ({ path, service, kind })))

export function windDownRoute(pathname: string): WindDownRoute | undefined {
  const parts = pathname.replace(/\/+$/, '').split('/')
  return WIND_DOWN_ROUTES.filter(({ path }) => path !== '*')
    .sort((a, b) => (a.path.match(/:/g)?.length ?? 0) - (b.path.match(/:/g)?.length ?? 0))
    .find(({ path }) => {
    const pattern = path.replace(/\/+$/, '').split('/')
    return pattern.length === parts.length && pattern.every((part, i) => part.startsWith(':') ? !!parts[i] : part.toLowerCase() === parts[i].toLowerCase())
  })
}

/**
 * 同一路径靠 ?stage= 切换阶段的工作台里，只展示已有结果的阶段按结果页算。
 * 例如 /interview/report 会被重定向成 /interview?stage=report：查看报告与历史报告不该被挡，
 * 设置、作答、技巧等阶段仍是办理页。
 */
const RESULT_STAGES: Record<string, readonly string[]> = { '/interview': ['report', 'reports'] }

export function windDownAllows(pathname: string, currentService: string | null, search = ''): boolean {
  const route = windDownRoute(pathname)
  if (!route) return false
  const stage = new URLSearchParams(search).get('stage')
  const kind = route.kind === 'work' && stage !== null && RESULT_STAGES[route.path]?.includes(stage) ? 'result' : route.kind
  return kind !== 'work' || (currentService !== null && route.service === currentService)
}

export function nextWindDownService(previousMode: string, mode: string, currentService: string | null, pathname: string): string | null {
  if (mode === 'normal') return null
  if (mode === 'winding-down' && previousMode !== 'winding-down') return windDownRoute(pathname)?.service ?? null
  return currentService
}
