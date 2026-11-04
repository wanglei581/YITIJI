/**
 * 百宝箱与智慧校园停放守卫（2026-11-04 产品负责人定停放）。
 *
 * 源码保留、不注册页面、不进构建产物；旧链接由 toolbox/* 与 smart-campus/* 跳回首页。
 * import type 会被编译擦掉，不算打包边。值导入、副作用导入和再导出算。
 *
 * 运行：node scripts/verify-kiosk-parked-toolbox-campus.mjs
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// services/api/smartCampus*.ts 三个旧文件停放前就没有引用方（旧文件清理 #1550 会删），不算停放源码，不列。
const PARKED = [
  'src/pages/toolbox/ToolboxZonePage.tsx',
  'src/pages/toolbox/toolbox-zone.css',
  'src/pages/smart-campus/FreshmanInsightsPage.tsx',
  'src/pages/smart-campus/SmartCampusGuard.tsx',
  'src/pages/smart-campus/SmartCampusHomePage.tsx',
  'src/pages/smart-campus/SmartCampusServicePage.tsx',
  'src/pages/smart-campus/SmartCampusWelcomePage.tsx',
  'src/pages/smart-campus/smart-campus-touch.css',
  'src/auth/KioskCapabilityGuard.tsx',
  'src/hooks/useToolboxConfig.ts',
  'src/hooks/useSmartCampusConfig.ts',
  'src/services/api/toolboxLaunchEvents.ts',
  'src/pages/home/components/ToolboxLaunchModals.tsx',
  'src/pages/home/components/kioskAppLaunch.ts',
]

const parkedSet = new Set(PARKED)
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8')

function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    if (entry.isSymbolicLink()) return []
    if (entry.isDirectory()) return walk(path)
    return entry.isFile() ? [path] : []
  })
}

function resolveSpecifier(fromFile, specifier) {
  // 一体机配了 @ → src 的别名（vite.config.ts、tsconfig.json），走别名的导入也算。
  let base
  if (specifier.startsWith('@/')) base = join(ROOT, 'src', specifier.slice(2))
  else if (specifier.startsWith('.')) base = join(dirname(fromFile), specifier)
  else return null
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.css`,
    `${base}.js`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ]
  for (const candidate of candidates) {
    const rel = relative(ROOT, candidate).split('\\').join('/')
    if (parkedSet.has(rel)) return rel
  }
  return null
}

function valueImportSpecifiers(sourceFile) {
  const specs = []
  const visit = (node) => {
    if (ts.isImportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      const clause = node.importClause
      const typeOnly = Boolean(clause?.isTypeOnly)
      const named = clause?.namedBindings && ts.isNamedImports(clause.namedBindings)
        ? clause.namedBindings.elements
        : []
      const hasValue = !typeOnly && (
        !clause
        || Boolean(clause.name)
        || (clause.namedBindings && ts.isNamespaceImport(clause.namedBindings))
        || named.some((element) => !element.isTypeOnly)
      )
      if (hasValue) specs.push(node.moduleSpecifier.text)
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && !node.isTypeOnly) {
      specs.push(node.moduleSpecifier.text)
    }
    if (
      ts.isCallExpression(node)
      && node.expression.kind === ts.SyntaxKind.ImportKeyword
      && node.arguments[0]
      && ts.isStringLiteral(node.arguments[0])
    ) {
      specs.push(node.arguments[0].text)
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  return specs
}

function parkedRedirects(sourceText) {
  const source = ts.createSourceFile('routes.tsx', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const found = new Map()
  const visit = (node) => {
    if (ts.isObjectLiteralExpression(node)) {
      let path = null
      let element = null
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property)) continue
        const name = property.name.getText(source)
        if (name === 'path' && ts.isStringLiteral(property.initializer)) path = property.initializer.text
        if (name === 'element') element = property.initializer.getText(source)
      }
      if (path === 'toolbox/*' || path === 'smart-campus/*') found.set(path, element ?? '')
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

let failed = 0
const pass = (message) => console.log(`  PASS ${message}`)
const fail = (message) => {
  failed += 1
  console.error(`  FAIL ${message}`)
}

console.log('\n=== 百宝箱 / 智慧校园停放 ===')

for (const rel of PARKED) {
  if (existsSync(join(ROOT, rel))) pass(`① 停放源码仍在 ${rel}`)
  else fail(`① 停放源码被删 ${rel}`)
}

const routes = read('src/routes/index.tsx')
const redirects = parkedRedirects(routes)
const homeRedirect = (element) => /<Navigate\s+to="\/"\s+replace\s*\/>/.test(element.replace(/\s+/g, ' '))
for (const path of ['toolbox/*', 'smart-campus/*']) {
  const element = redirects.get(path)
  if (element && homeRedirect(element)) pass(`② ${path} 是跳回首页的 Navigate（2026-11-04 产品负责人定停放）`)
  else fail(`② ${path} 必须是 <Navigate to="/" replace />，实际 ${element ?? '缺失'}`)
}

const routeFile = join(ROOT, 'src/routes/index.tsx')
const routeSource = ts.createSourceFile('routes.tsx', routes, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
const routeImports = valueImportSpecifiers(routeSource)
  .map((specifier) => resolveSpecifier(routeFile, specifier))
  .filter(Boolean)
if (routeImports.length === 0) pass('② routes/index.tsx 不 import 停放模块')
else fail(`② routes/index.tsx import 了停放模块: ${routeImports.join(', ')}`)

const srcRoot = join(ROOT, 'src')
const outsideHits = []
for (const file of walk(srcRoot)) {
  if (!/\.(ts|tsx)$/.test(file)) continue
  const rel = relative(ROOT, file).split('\\').join('/')
  if (parkedSet.has(rel)) continue
  if (rel.includes('/__tests__/') || /\.(test|spec)\.(ts|tsx)$/.test(rel)) continue
  const source = ts.createSourceFile(rel, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  for (const specifier of valueImportSpecifiers(source)) {
    const hit = resolveSpecifier(file, specifier)
    if (hit) outsideHits.push(`${rel} -> ${hit}`)
  }
}
if (outsideHits.length === 0) pass('③ 停放清单之外没有值导入停放模块（不打包）')
else fail(`③ 停放模块仍被在用代码 import:\n${outsideHits.join('\n')}`)

const home = read('src/pages/home/HomePage.tsx')
const view = read('src/pages/home/components/HomeTouchView.tsx')
if (!/useToolboxCapabilityState\s*\(/.test(home) && !/useSmartCampusCapabilityState\s*\(/.test(home)) {
  pass('④ HomePage 不调两个能力 hook（2026-11-04 产品负责人定停放）')
} else fail('④ HomePage 仍在调用百宝箱或智慧校园能力 hook')
if (!view.includes('actionId="toolbox"') && !view.includes('actionId="smart-campus"')) {
  pass('④ HomeTouchView 没有百宝箱 / 智慧校园瓦片')
} else fail('④ HomeTouchView 仍摆百宝箱或智慧校园瓦片')

if (failed > 0) {
  console.error(`\n❌ ${failed} 项失败\n`)
  process.exit(1)
}
console.log('\n✅ ALL PASS — 百宝箱与智慧校园保持停放\n')
