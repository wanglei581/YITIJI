import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(kioskRoot, path), 'utf8')

const errorPagePath = join(kioskRoot, 'src/pages/errors/KioskRouteErrorPage.tsx')
assert.ok(existsSync(errorPagePath), 'KioskRouteErrorPage.tsx must exist')

const errorPage = read('src/pages/errors/KioskRouteErrorPage.tsx')
const routes = read('src/routes/index.tsx')
const main = read('src/main.tsx')
const root = read('src/layouts/KioskRoot.tsx')

assert.match(errorPage, /useRouteError/)
assert.match(errorPage, /isRouteErrorResponse/)
assert.match(errorPage, /页面不存在/)
assert.match(errorPage, /页面暂时无法显示/)
assert.match(errorPage, /重试页面/)
assert.match(errorPage, /返回首页/)
assert.match(errorPage, /window\.location\.reload\(\)/)
assert.match(errorPage, /navigate\('\/',\s*\{\s*replace:\s*true\s*\}\)/)
assert.doesNotMatch(errorPage, /\{\s*(?:error|routeError)\s*\}/, 'raw route errors must never render into public UI')
assert.doesNotMatch(errorPage, /\.stack\b/, 'stack traces must never render into public UI')

const routeSource = ts.createSourceFile('routes.tsx', routes, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let routerArray = null
const visit = (node) => {
  if (
    ts.isCallExpression(node)
    && ts.isIdentifier(node.expression)
    && node.expression.text === 'createBrowserRouter'
    && node.arguments[0]
    && ts.isArrayLiteralExpression(node.arguments[0])
  ) routerArray = node.arguments[0]
  ts.forEachChild(node, visit)
}
visit(routeSource)
assert.ok(routerArray, 'createBrowserRouter array must exist')
for (const route of routerArray.elements) {
  assert.ok(ts.isObjectLiteralExpression(route), 'every top-level router entry must be an object')
  const errorElement = route.properties.find((property) => (
    ts.isPropertyAssignment(property)
    && ts.isIdentifier(property.name)
    && property.name.text === 'errorElement'
  ))
  assert.ok(errorElement, 'every top-level route object must own the safe kiosk error element')
  assert.match(errorElement.getText(routeSource), /<KioskRouteErrorPage\s*\/>/)
}
assert.match(main, /onError=\{handleRouterError\}/)
assert.match(main, /\[kiosk-route-error\]/)

// 2026-08-18：/print/params 已下线为指向 /print/preview 的兼容重定向，本身不再渲染页面，
// actionbar 由重定向目的地 /print/preview 提供，故从本清单移除。
for (const path of [
  '/print/upload',
  '/print/material-check', '/print/preview', '/print/confirm',
  '/print/cashier', '/print/progress', '/scan/start', '/scan/settings',
  '/scan/progress', '/scan/result', '/print-scan/convert', '/print-scan/sign',
  '/resume/source', '/resume/generate', '/resume/generate/preview', '/resume/report',
]) {
  assert.ok(root.includes(`'${path}'`), `actionbar route must replace global bottom nav: ${path}`)
}
assert.match(root, /hideBottomNav=\{(?:isCampusZone\s*\|\|\s*)?usesPageActionbar\}/)

console.log('PASS kiosk route errors use a safe Chinese recovery page')
console.log('PASS actionbar routes replace the global bottom navigation')
