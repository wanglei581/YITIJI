import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface AdminRoute {
  path: string
  redirectTo?: string
}

/** 从 routes/index.tsx 解析全部注册路径，避免手工漏路由。 */
export function readAdminRoutes(): AdminRoute[] {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../../src/routes/index.tsx'),
    'utf8',
  )
  const routes: AdminRoute[] = []
  if (source.includes("path: '/login'")) routes.push({ path: '/login' })
  if (/index:\s*true/.test(source)) routes.push({ path: '/' })

  const pattern = /\{\s*path:\s*'([^']+)',\s*element:\s*(?:<Navigate to="([^"]+)"[^]*?\/>|<)/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source))) {
    const path = match[1].startsWith('/') ? match[1] : `/${match[1]}`
    if (path === '/login') continue
    routes.push({ path, redirectTo: match[2] })
  }
  const seen = new Set<string>()
  return routes.filter((route) => {
    if (seen.has(route.path)) return false
    seen.add(route.path)
    return true
  })
}
