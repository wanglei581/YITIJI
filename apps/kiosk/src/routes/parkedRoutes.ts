/**
 * 2026-11-08 产品负责人「只保留四个核心」。
 * 源码保留、不注册、不打包、旧地址回首页；重新打开的步骤见 docs/product/feature-scope.md。
 */
export const PARKED_ROUTE_PREFIXES_1108 = [
  '/resume/career-plan', '/resume/self-assessment', '/resume/job-fit',
  '/resume/materials', '/resume/templates', '/activities',
  '/print-scan/sign', '/print/scan-sign',
] as const

export function isParkedRoute(route: string): boolean {
  const path = route.split(/[?#]/, 1)[0]
  return PARKED_ROUTE_PREFIXES_1108.some((prefix) => path === prefix || path.startsWith(`${prefix}/`))
}
