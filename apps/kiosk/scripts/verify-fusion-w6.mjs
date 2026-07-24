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

function directBoolean(object, name) {
  const property = directProperty(object, name)
  if (!property) return null
  if (property.initializer.kind === ts.SyntaxKind.TrueKeyword) return true
  if (property.initializer.kind === ts.SyntaxKind.FalseKeyword) return false
  return null
}

function unwrapExpression(node) {
  let current = node
  while (current && (ts.isAsExpression(current) || ts.isSatisfiesExpression(current) || ts.isParenthesizedExpression(current))) {
    current = current.expression
  }
  return current
}

function variableInitializer(source, name) {
  let result = null
  const visit = (node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) {
      result = unwrapExpression(node.initializer)
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return result
}

function findTestSource(path, titleSource) {
  const source = parseTsx(path)
  let result = null
  const visit = (node) => {
    if (ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'test'
      && node.arguments[0]
      && node.arguments[0].getText(source) === titleSource) result = node.getText(source)
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(result, `${path} missing test ${titleSource}`)
  return result
}

function assertExactEvidence(path, titleSource, evidence) {
  const testSource = findTestSource(path, titleSource)
  for (const token of evidence) {
    assert.ok(testSource.includes(token), `${path} ${titleSource} missing exact evidence: ${token}`)
  }
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
    'test:browser:w6': 'playwright test --config=playwright.w6.config.ts',
  }
  for (const [name, command] of Object.entries(expected)) assert.equal(scripts[name], command, name)
  const serial = scripts['test:browser:fusion'] ?? ''
  const expectedOrder = ['test:browser:smoke', 'test:browser:w1', 'test:browser:w2', 'test:browser:w3', 'test:browser:w4', 'test:browser:w5', 'test:browser:w6']
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
  const browserCommands = ['test:browser:w2', 'test:browser:w3', 'test:browser:w4', 'test:browser:w5', 'test:browser:w6']
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
  const fixturePattern = /(?:tests\/visual\/fixtures|tests\/fixtures)[^'"`]*fusion-w[2-6]|fusion-w[2-6][^'"`]*fixture/i
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

check('W2-W5 state coverage', () => {
  assertExactEvidence('tests/visual/fusion-w2-scan.spec.ts', "'scan settings uses server instructions and waiting-to-completed polling reaches result @w2'", [
    "scanStatus(polls++ === 0 ? 'waiting' : 'completed')",
    "page.waitForURL('**/scan/result'",
    "page.getByText('w2-scan.pdf', { exact: true })",
  ])
  assertExactEvidence('tests/visual/fusion-w5.spec.ts', "'resumes expose authenticated API error and recovered empty states through visible login @w5-kiosk'", [
    "registerMemberLogin(api)",
    "loginThroughVisibleUi(page, '/me/resumes')",
    "status: 503",
    "page.getByRole('heading', { name: '暂时无法加载' })",
    "json: { success: true, data: { items: [], nextCursor: null, total: 0 } }",
    "page.getByText('还没有登录后保存的简历', { exact: true })",
  ])
  assertExactEvidence('tests/visual/fusion-w5.spec.ts', "'offline page retains the 8177 state after an aborted health request @w5-kiosk'", [
    "api.abort('GET', '/api/v1/health', 'internetdisconnected')",
    "page.getByRole('button', { name: '重试连接', exact: true }).click()",
    "page.getByText(/已重试 1 次/)",
  ])
  assertExactEvidence('tests/visual/fusion-w5.spec.ts', "'profile permission state uses the canonical fusion shell @w5-kiosk'", [
    "page.goto('/profile')",
    "page.getByRole('button', { name: '手机号登录', exact: true })",
    "page.getByRole('region', { name: '我的资产' })",
  ])
  assertExactEvidence('tests/visual/fusion-w5.spec.ts', "'mobile QR login renders a real API error and touch-safe retry @w5-mobile'", [
    "status: 410",
    "code: 'QR_LOGIN_EXPIRED'",
    "page.goto('/member/qr-login?ticketId=w5-expired-ticket')",
    "root.getByRole('button', { name: '重新检查二维码', exact: true })",
  ])
  assertExactEvidence('tests/visual/fusion-w5.spec.ts', "'phone upload keeps the explicit expired-link state at 390x844 @w5-mobile'", [
    "page.goto('/upload/phone')",
    "root.getByText('上传链接已失效', { exact: true })",
  ])

  const paymentSource = readKiosk('tests/visual/fusion-w2-print.spec.ts')
  for (const evidence of [
    "name: 'failed attempt', status: 'unpaid', attempt: { attemptId: 'w2-failed', channel: 'wechat', status: 'failed'",
    "name: 'closed order', status: 'closed', attempt: { attemptId: 'w2-closed', channel: 'wechat', status: 'expired'",
    "name: 'refunded order', status: 'refunded', attempt: { attemptId: 'w2-refunded', channel: 'wechat', status: 'success'",
    "test(`cashier keeps ${scenario.name} out of print fulfillment @w2`",
    "page.getByText(scenario.copy, { exact: true })",
    "expect(page.getByRole('button', { name: '等待支付…' })).toBeDisabled()",
  ]) assert.ok(paymentSource.includes(evidence), `payment state coverage missing exact evidence: ${evidence}`)
})

check('W6 route acceptance contract', () => {
  const source = parseTsx('tests/visual/fixtures/fusion-w6-route-cases.ts')
  const routeArray = variableInitializer(source, 'w6RouteDefinitions')
  assert.ok(routeArray && ts.isArrayLiteralExpression(routeArray), 'w6RouteDefinitions must remain a static array')
  const fixtureSource = readKiosk('tests/visual/fixtures/fusion-w6-route-cases.ts')
  const touchExemptions = variableInitializer(source, 'TOUCH_TARGET_EXEMPTIONS')
  assert.ok(touchExemptions && ts.isArrayLiteralExpression(touchExemptions), 'TOUCH_TARGET_EXEMPTIONS must remain a static array')
  const touchExemptionPaths = touchExemptions.elements.map((element) => {
    assert.ok(ts.isStringLiteralLike(element), 'touch-target exemption must be a string literal')
    return element.text
  })
  assert.deepEqual(touchExemptionPaths.sort(), ['/screensaver', '/upload/phone'], 'touch-target exemptions must stay on the explicit allowlist')
  for (const field of ['viewport', 'landmark', 'requiresFusionRoot', 'requiresTouchTargets']) {
    assert.ok(fixtureSource.includes(`${field}:`), `route builder must materialize ${field}`)
  }
  assert.match(fixtureSource, /export const w6RouteCases[^\n]*w6RouteDefinitions\.map\(createRouteCase\)/, 'every route definition must materialize through createRouteCase')
  const routes = routeArray.elements.map((element) => {
    assert.ok(ts.isObjectLiteralExpression(element), 'every W6 route definition must be a direct object')
    const object = element
    const pattern = directString(object, 'pattern')
    assert.ok(pattern, 'W6 route pattern must be a direct string')
    const viewport = ['/member/qr-login', '/upload/phone'].includes(pattern) ? 'mobile' : 'kiosk'
    const landmark = directString(object, 'landmark') ?? 'main'
    const requiresFusionRoot = directBoolean(object, 'requiresFusionRoot') ?? true
    const explicitTouchTargets = directBoolean(object, 'requiresTouchTargets')
    if (explicitTouchTargets === false) assert.ok(touchExemptionPaths.includes(pattern), `${pattern} must be on the touch-target exemption allowlist`)
    const requiresTouchTargets = explicitTouchTargets ?? !touchExemptionPaths.includes(pattern)
    assert.ok(['main', 'presentation', 'none'].includes(landmark), `${pattern} has invalid landmark ${landmark}`)
    assert.equal(typeof requiresFusionRoot, 'boolean', `${pattern} requiresFusionRoot`)
    assert.equal(typeof requiresTouchTargets, 'boolean', `${pattern} requiresTouchTargets`)
    const marker = directString(object, 'marker')
    assert.notEqual(marker, 'main', `${pattern} must use a page-level marker rather than generic main`)
    return { pattern, viewport }
  })
  assert.equal(routes.length, 86, 'W6 route cases must total 86')
  assert.equal(new Set(routes.map(({ pattern }) => pattern)).size, 86, 'W6 route cases must be unique')
  assert.deepEqual(routes.map(({ pattern }) => pattern).sort(), [...manifest.paths].sort(), 'W6 cases and manifest differ')
  assert.equal(routes.filter(({ viewport }) => viewport === 'kiosk').length, 84, 'W6 kiosk allocation')
  assert.equal(routes.filter(({ viewport }) => viewport === 'mobile').length, 2, 'W6 mobile allocation')
})

check('W6 browser collection contract', () => {
  const spec = readKiosk('tests/visual/fusion-w6-routes.spec.ts')
  const config = readKiosk('playwright.w6.config.ts')
  assert.match(spec, /for \(const route of w6KioskCases\)/, 'kiosk tests must only collect w6KioskCases')
  assert.match(spec, /for \(const route of w6MobileCases\)/, 'mobile tests must only collect w6MobileCases')
  assert.match(config, /name: 'kiosk-1080x1920', grep: \/@w6-kiosk\$\//, 'kiosk project must own only @w6-kiosk tests')
  assert.match(config, /name: 'mobile-390x844', grep: \/@w6-mobile\$\//, 'mobile project must own only @w6-mobile tests')
})

check('W6 legal and long-text fixture', () => {
  const source = parseTsx('tests/visual/fixtures/fusion-w6-api.ts')
  const longText = variableInitializer(source, 'W6_LONG_LEGAL_TEXT')
  assert.ok(longText && ts.isStringLiteralLike(longText), 'W6_LONG_LEGAL_TEXT must be a static string fixture')
  assert.ok(longText.text.length >= 240, `W6 long-text fixture is only ${longText.text.length} characters`)
  const api = readKiosk('tests/visual/fixtures/fusion-w6-api.ts')
  for (const endpoint of [
    '/api/v1/kiosk/legal/terms_of_service',
    '/api/v1/kiosk/legal/privacy_policy',
  ]) assert.ok(api.includes(`get('${endpoint}'`), `missing real legal endpoint ${endpoint}`)
  assert.doesNotMatch(api, /get\('\/api\/v1\/kiosk\/legal\/privacy'/, 'obsolete legal fixture path must not return')
  const routes = readKiosk('tests/visual/fixtures/fusion-w6-route-cases.ts')
  const spec = readKiosk('tests/visual/fusion-w6-routes.spec.ts')
  assert.match(routes, /pattern: '\/legal\/:doc'[\s\S]*longText: W6_LONG_LEGAL_TEXT/, 'legal route must own the long-text scenario')
  assert.match(spec, /route\.longText[\s\S]*getByText\(route\.longText, \{ exact: true \}\)/, 'W6 spec must visibly assert the long-text fixture')
})

if (failures > 0) process.exitCode = 1
else console.log('ALL PASS fusion W6 integration contract')
