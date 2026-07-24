import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, extname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '..')
const workspaceRoot = join(kioskRoot, '..', '..')
const readKiosk = (path) => readFileSync(join(kioskRoot, path), 'utf8')
const parseTsx = (path) => ts.createSourceFile(path, readKiosk(path), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let failures = 0

function check(label, run) {
  try {
    run()
    console.log(`PASS ${label}`)
  } catch (error) {
    failures += 1
    console.error(`FAIL ${label}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function propertyName(node) {
  return ts.isIdentifier(node) || ts.isStringLiteralLike(node) ? node.text : null
}

function directProperty(object, name) {
  return object.properties.find((candidate) => (
    ts.isPropertyAssignment(candidate) && propertyName(candidate.name) === name
  ))
}

function directString(object, name) {
  const property = directProperty(object, name)
  return property && ts.isStringLiteralLike(property.initializer) ? property.initializer.text : null
}

function jsxName(node) {
  if (ts.isJsxElement(node)) return node.openingElement.tagName.getText()
  if (ts.isJsxSelfClosingElement(node)) return node.tagName.getText()
  return null
}

function jsxAttribute(node, name) {
  if (!ts.isJsxElement(node) && !ts.isJsxSelfClosingElement(node)) return null
  const attributes = ts.isJsxElement(node) ? node.openingElement.attributes : node.attributes
  const attribute = attributes.properties.find((candidate) => (
    ts.isJsxAttribute(candidate) && candidate.name.getText() === name
  ))
  if (!attribute || !ts.isJsxAttribute(attribute)) return null
  if (!attribute.initializer) return true
  return ts.isStringLiteral(attribute.initializer) ? attribute.initializer.text : null
}

function routerInventory() {
  const source = parseTsx('src/routes/index.tsx')
  let routerArray = null
  const findRouter = (node) => {
    if (ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'createBrowserRouter'
      && node.arguments[0]
      && ts.isArrayLiteralExpression(node.arguments[0])) routerArray = node.arguments[0]
    ts.forEachChild(node, findRouter)
  }
  findRouter(source)
  assert.ok(routerArray, 'createBrowserRouter([...]) not found')

  const routes = []
  const walk = (array, parentPath, depth) => {
    for (const element of array.elements) {
      if (!ts.isObjectLiteralExpression(element)) continue
      const rawPath = directString(element, 'path')
      const indexProperty = element.properties.some((candidate) => (
        ts.isPropertyAssignment(candidate)
        && propertyName(candidate.name) === 'index'
        && candidate.initializer.kind === ts.SyntaxKind.TrueKeyword
      ))
      let normalized = null
      if (rawPath !== null) {
        if (rawPath.startsWith('/')) normalized = rawPath || '/'
        else normalized = `${parentPath === '/' ? '' : parentPath}/${rawPath}`.replace(/\/+/g, '/')
        if (!normalized.startsWith('/')) normalized = `/${normalized}`
      } else if (indexProperty) normalized = parentPath || '/'

      const elementProperty = directProperty(element, 'element')
      const routeElement = elementProperty?.initializer
      const tag = routeElement ? jsxName(routeElement) : null
      const redirect = tag === 'Navigate'
        ? { to: jsxAttribute(routeElement, 'to'), replace: jsxAttribute(routeElement, 'replace') }
        : null
      if (normalized !== null && !(indexProperty && normalized === '/' && routes.some((route) => route.path === '/'))) {
        routes.push({ path: normalized, depth, tag, redirect })
      }

      const children = directProperty(element, 'children')
      if (children && ts.isArrayLiteralExpression(children.initializer)) {
        walk(children.initializer, normalized ?? parentPath, depth + 1)
      }
    }
  }
  walk(routerArray, '', 0)
  return routes
}

function manifestInventory() {
  const source = parseTsx('tests/visual/route-manifest.ts')
  let paths = null
  let redirects = null
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      let initializer = node.initializer
      if (initializer && ts.isAsExpression(initializer)) initializer = initializer.expression
      if (node.name.text === 'productionRoutePatterns' && initializer && ts.isArrayLiteralExpression(initializer)) {
        paths = initializer.elements.map((element) => {
          assert.ok(ts.isStringLiteralLike(element), 'manifest route must be a string literal')
          return element.text
        })
      }
      if (node.name.text === 'compatibilityRedirects' && initializer && ts.isObjectLiteralExpression(initializer)) {
        redirects = new Map(initializer.properties.map((property) => {
          assert.ok(ts.isPropertyAssignment(property), 'redirect must be a direct property')
          assert.ok(ts.isStringLiteralLike(property.initializer), 'redirect target must be a string literal')
          return [propertyName(property.name), property.initializer.text]
        }))
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(paths, 'productionRoutePatterns missing from frozen manifest')
  assert.ok(redirects, 'compatibilityRedirects missing from frozen manifest')
  return { paths, redirects }
}

const WAVE_ROUTES = new Map([
  ['W0', []],
  ['W1', ['/']],
  ['W2', [
    '/print-scan', '/print-scan/feature/:key', '/print-scan/convert', '/print-scan/sign',
    '/print/scan-convert', '/print/scan-sign', '/print/scan-feature', '/print/upload',
    '/print/material-check', '/print/preview', '/print/params', '/print/confirm',
    '/print/cashier', '/print/progress', '/print/done', '/scan/start', '/scan/settings',
    '/scan/progress', '/scan/result',
  ]],
  ['W3', [
    '/resume', '/resume/upload', '/resume/source', '/resume/generate',
    '/resume/generate/preview', '/resume/parse', '/resume/report', '/resume/optimize',
    '/resume/export', '/resume/templates', '/resume/materials', '/resume/job-fit',
    '/resume/career-plan', '/assistant', '/interview/setup', '/interview/session',
    '/interview/report', '/interview/tips', '/interview/reports',
  ]],
  ['W4', [
    '/jobs', '/jobs/:id', '/jobs/:id/offline', '/offline-agencies', '/companies',
    '/companies/:id', '/job-fairs', '/job-fairs/checkin', '/job-fairs/:id',
    '/job-fairs/:id/companies', '/job-fairs/:id/companies/:companyId',
    '/job-fairs/:id/map', '/job-fairs/:id/materials', '/job-fairs/:id/visit-plan',
    '/job-fairs/:id/stats', '/campus', '/campus/welcome', '/campus/freshman-insights',
    '/smart-campus', '/smart-campus/welcome', '/smart-campus/freshman-insights',
    '/smart-campus/service/:key', '/renshi',
  ]],
  ['W5', [
    '/login', '/member/qr-login', '/upload/phone', '/legal/:doc', '/screensaver',
    '/session-timeout', '/error-offline', '/profile', '/me/resumes', '/me/print-orders',
    '/me/documents', '/me/favorites', '/me/ai-records', '/me/benefits', '/me/activity',
    '/me/activity/:id', '/me/notifications', '/me/feedback', '/me/settings', '/help',
    '/activities', '/activities/:id', '/toolbox', '/notifications',
  ]],
])

const routeInventory = routerInventory()
const manifest = manifestInventory()

check('86/86 routes', () => {
  const actual = routeInventory.map((route) => route.path)
  assert.equal(actual.length, 86, `router exposes ${actual.length} normalized route patterns`)
  assert.equal(new Set(actual).size, 86, 'router route patterns must be unique')
  assert.equal(manifest.paths.length, 86, `manifest exposes ${manifest.paths.length} route patterns`)
  assert.equal(new Set(manifest.paths).size, 86, 'manifest route patterns must be unique')
  assert.deepEqual([...actual].sort(), [...manifest.paths].sort(), 'router and frozen manifest differ')
  assert.equal(manifest.redirects.size, 5, 'manifest must contain five compatibility redirects')
  for (const [path, target] of manifest.redirects) {
    const route = routeInventory.find((candidate) => candidate.path === path)
    assert.ok(route?.redirect, `${path} must render Navigate`)
    assert.equal(route.redirect.to, target, `${path} target`)
    assert.equal(route.redirect.replace, true, `${path} must replace history`)
  }
})

check('wave ownership', () => {
  const owners = new Map(manifest.paths.map((path) => [path, []]))
  for (const [wave, paths] of WAVE_ROUTES) {
    assert.equal(new Set(paths).size, paths.length, `${wave} inventory contains duplicates`)
    for (const path of paths) {
      assert.ok(owners.has(path), `${wave} owns unknown route ${path}`)
      owners.get(path).push(wave)
    }
  }
  const invalid = [...owners].filter(([, waves]) => waves.length !== 1)
  assert.deepEqual(invalid, [], `missing/duplicate ownership: ${JSON.stringify(invalid)}`)
  assert.equal([...WAVE_ROUTES.values()].flat().length, 86, 'wave inventories must total 86')
})

function jsxDescendant(source, rootName, descendantName) {
  let found = false
  const visit = (node, insideRoot = false) => {
    const name = jsxName(node)
    const nextInside = insideRoot || name === rootName
    if (nextInside && name === descendantName) found = true
    ts.forEachChild(node, (child) => visit(child, nextInside))
  }
  visit(source)
  return found
}

check('single main landmark', () => {
  const home = parseTsx('src/pages/home/HomePage.tsx')
  const kioskRoot = readKiosk('src/layouts/KioskRoot.tsx')
  assert.match(kioskRoot, /KioskLayout/, 'KioskRoot must retain the shared shell landmark owner')
  assert.equal(jsxDescendant(home, 'KioskPageFrame', 'main'), false, 'HomePage nests <main> inside KioskPageFrame')
})

check('mobile routes', () => {
  const mobile = ['/member/qr-login', '/upload/phone']
  for (const path of mobile) {
    const route = routeInventory.find((candidate) => candidate.path === path)
    assert.ok(route, `missing mobile helper ${path}`)
    assert.equal(route.depth, 0, `${path} must remain outside KioskRoot.children`)
  }
  assert.ok(!manifest.paths.includes('/login/mobile'), 'obsolete /login/mobile alias must not be introduced')
  const expectedFullScreen = [
    '/login', '/member/qr-login', '/upload/phone', '/legal/:doc', '/resume/job-fit',
    '/resume/career-plan', '/interview/setup', '/interview/session', '/interview/report',
    '/interview/tips', '/interview/reports', '/screensaver', '/session-timeout', '/error-offline',
  ]
  for (const path of expectedFullScreen) {
    assert.equal(routeInventory.find((route) => route.path === path)?.depth, 0, `${path} must remain full-screen`)
  }
  for (const path of mobile) {
    const page = path === '/member/qr-login' ? 'src/pages/auth/MobileQrLoginPage.tsx' : 'src/pages/upload/PhoneUploadPage.tsx'
    const source = readKiosk(page)
    assert.match(source, /data-kiosk-presentation=["']fusion-youth["']/, `${path} retains fusion presentation`)
    assert.match(source, /data-kiosk-viewport=["']mobile["']/, `${path} retains mobile viewport`)
  }
})

function regularFiles(root) {
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name)
    if (entry.isSymbolicLink()) return []
    if (entry.isDirectory()) return regularFiles(path)
    return entry.isFile() ? [path] : []
  })
}

const productionFiles = regularFiles(join(kioskRoot, 'src'))
  .filter((path) => ['.ts', '.tsx'].includes(extname(path)))

function visibleStrings(path) {
  const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const values = []
  const visit = (node) => {
    if (ts.isJsxText(node) || ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node)) values.push(node.text)
    ts.forEachChild(node, visit)
  }
  visit(source)
  return values
}

check('compliance copy', () => {
  const forbidden = [/一键投递/, /立即投递/, /平台内投递/, /投递简历/, /企业收简历/, /候选人管理/]
  const approvedBoundaryCopy = [
    '不提供平台内投递',
    '不会提供平台内投递',
  ]
  const violations = []
  for (const path of productionFiles) {
    for (const value of visibleStrings(path)) {
      const checkedValue = approvedBoundaryCopy.reduce((next, approved) => next.replaceAll(approved, ''), value)
      for (const pattern of forbidden) {
        if (pattern.test(checkedValue)) violations.push(`${relative(kioskRoot, path)}: ${pattern}`)
      }
      if (checkedValue.replaceAll('来源平台投递', '').includes('平台投递')) {
        violations.push(`${relative(kioskRoot, path)}: unapproved 平台投递`)
      }
    }
  }
  assert.deepEqual(violations, [], violations.join('\n'))
})

check('package scripts', () => {
  const scripts = JSON.parse(readKiosk('package.json')).scripts ?? {}
  const expected = {
    'verify:fusion-w2': 'node scripts/verify-fusion-w2-print-scan.mjs',
    'verify:fusion-w3': 'node scripts/verify-fusion-w3.mjs',
    'verify:fusion-w4': 'node scripts/verify-fusion-w4.mjs',
    'verify:fusion-w5': 'node scripts/verify-fusion-w5.mjs',
    'verify:fusion-w6': 'node scripts/verify-fusion-w6.mjs',
    'test:browser:w2': 'playwright test --config=playwright.w2.config.ts',
    'test:browser:w3': 'playwright test --config=playwright.w3.config.ts',
    'test:browser:w4': 'playwright test --config=playwright.w4.config.ts',
    'test:browser:w5': 'playwright test --config=playwright.w5.config.ts',
  }
  for (const [name, command] of Object.entries(expected)) assert.equal(scripts[name], command, name)
  const serial = scripts['test:browser:fusion'] ?? ''
  const expectedOrder = ['test:browser:smoke', 'test:browser:w1', 'test:browser:w2', 'test:browser:w3', 'test:browser:w4', 'test:browser:w5']
  let cursor = -1
  for (const command of expectedOrder) {
    const next = serial.indexOf(command)
    assert.ok(next > cursor, `test:browser:fusion must run ${command} in order`)
    cursor = next
  }
  assert.doesNotMatch(serial, /(?:^|\s)&(?:\s|$)/, 'browser fusion command must not run waves in parallel')
})

check('CI wiring', () => {
  const ci = readFileSync(join(workspaceRoot, '.github/workflows/ci.yml'), 'utf8')
  const staticCommands = ['verify:fusion-w2', 'verify:fusion-w3', 'verify:fusion-w4', 'verify:fusion-w5', 'verify:fusion-w6']
  const browserCommands = ['test:browser:w2', 'test:browser:w3', 'test:browser:w4', 'test:browser:w5']
  for (const commands of [staticCommands, browserCommands]) {
    let cursor = -1
    for (const command of commands) {
      const next = ci.indexOf(command)
      assert.ok(next > cursor, `CI must invoke ${command} in serial wave order`)
      cursor = next
    }
  }
})

check('production fixture isolation', () => {
  const violations = []
  const fixturePattern = /(?:tests\/visual\/fixtures|tests\/fixtures)[^'"`]*fusion-w[2-5]|fusion-w[2-5][^'"`]*fixture/i
  for (const path of productionFiles) {
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const visit = (node) => {
      if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier) && fixturePattern.test(node.moduleSpecifier.text)) {
        violations.push(`${relative(kioskRoot, path)} -> ${node.moduleSpecifier.text}`)
      }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword
        && node.arguments[0] && ts.isStringLiteralLike(node.arguments[0]) && fixturePattern.test(node.arguments[0].text)) {
        violations.push(`${relative(kioskRoot, path)} -> ${node.arguments[0].text}`)
      }
      ts.forEachChild(node, visit)
    }
    visit(source)
  }
  assert.deepEqual(violations, [], violations.join('\n'))
})

if (failures > 0) process.exitCode = 1
else console.log('ALL PASS fusion W6 integration contract')
