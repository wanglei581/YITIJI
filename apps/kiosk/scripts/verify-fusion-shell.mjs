import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const packageRootUrl = new URL('../', import.meta.url)

async function read(relativePath) {
  try {
    return await readFile(new URL(relativePath, packageRootUrl), 'utf8')
  } catch (error) {
    throw new Error(`Required Kiosk fusion shell file is missing or unreadable: ${relativePath}`, {
      cause: error,
    })
  }
}

function withoutComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

function functionBody(source, name) {
  const code = withoutComments(source)
  const declaration = new RegExp(`function\\s+${name}\\b`).exec(code)
  assert.ok(declaration, `${name} must remain defined`)

  const openingBrace = code.indexOf('{', declaration.index)
  assert.ok(openingBrace >= 0, `${name} must have a function body`)

  let depth = 0
  let quote = ''
  for (let index = openingBrace; index < code.length; index += 1) {
    const character = code[index]
    if (quote) {
      if (character === quote && code[index - 1] !== '\\') quote = ''
      continue
    }
    if (character === "'" || character === '"' || character === '`') {
      quote = character
      continue
    }
    if (character === '{') depth += 1
    if (character === '}' && --depth === 0) return code.slice(openingBrace + 1, index)
  }

  assert.fail(`${name} must have a balanced function body`)
}

function directProperty(objectLiteral, name) {
  return objectLiteral.properties.find((property) =>
    ts.isPropertyAssignment(property) &&
    (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) &&
    property.name.text === name,
  )
}

function directStringProperty(objectLiteral, name) {
  const property = directProperty(objectLiteral, name)
  return property && ts.isStringLiteral(property.initializer) ? property.initializer.text : null
}

function directJsxComponentProperty(objectLiteral, name) {
  const property = directProperty(objectLiteral, name)
  if (!property) return null
  const tagName = ts.isJsxSelfClosingElement(property.initializer)
    ? property.initializer.tagName
    : ts.isJsxElement(property.initializer)
      ? property.initializer.openingElement.tagName
      : null
  return tagName && ts.isIdentifier(tagName) ? tagName.text : null
}

function topLevelRouteObjects(routes) {
  const sourceFile = ts.createSourceFile('routes.tsx', routes, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let routeArray = null
  const visit = (node) => {
    if (
      !routeArray &&
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'createBrowserRouter' &&
      node.arguments.length === 1 &&
      ts.isArrayLiteralExpression(node.arguments[0])
    ) {
      routeArray = node.arguments[0]
      return
    }
    ts.forEachChild(node, visit)
  }
  visit(sourceFile)
  assert.ok(routeArray, 'routes must call createBrowserRouter with a direct array literal')
  return routeArray.elements.filter(ts.isObjectLiteralExpression)
}

function descendantRouteObjects(route) {
  const descendants = []
  const children = directProperty(route, 'children')
  if (!children || !ts.isArrayLiteralExpression(children.initializer)) return descendants

  for (const child of children.initializer.elements.filter(ts.isObjectLiteralExpression)) {
    descendants.push(child, ...descendantRouteObjects(child))
  }
  return descendants
}

function assertTopLevelHelperRoutes(routes) {
  const objects = topLevelRouteObjects(routes)
  const runtimeRootIndex = objects.findIndex((route) =>
    directJsxComponentProperty(route, 'element') === 'KioskRuntimeRoot',
  )
  assert.ok(runtimeRootIndex >= 0, 'KioskRuntimeRoot must remain a direct createBrowserRouter entry')

  const runtimeRoutes = descendantRouteObjects(objects[runtimeRootIndex])
  assert.ok(
    runtimeRoutes.some((route) =>
      directStringProperty(route, 'path') === '/' &&
      directJsxComponentProperty(route, 'element') === 'KioskRoot',
    ),
    'KioskRoot must remain nested inside KioskRuntimeRoot',
  )

  for (const path of ['/login', '/legal/:doc', '*']) {
    assert.ok(
      runtimeRoutes.some((route) => directStringProperty(route, 'path') === path),
      `${path} must remain protected inside KioskRuntimeRoot`,
    )
    assert.ok(
      !objects.some((route) => directStringProperty(route, 'path') === path),
      `${path} must not escape to a top-level route`,
    )
  }

  for (const [path, component] of [
    ['/member/qr-login', 'MobileQrLoginPage'],
    ['/upload/phone', 'PhoneUploadPage'],
  ]) {
    const routeIndex = objects.findIndex((route) =>
      directStringProperty(route, 'path') === path &&
      directJsxComponentProperty(route, 'element') === component,
    )
    assert.ok(routeIndex >= 0, `${path} must remain a direct createBrowserRouter route`)
    assert.ok(routeIndex < runtimeRootIndex, `${path} must stay before KioskRuntimeRoot instead of becoming a child route`)
    assert.ok(
      !runtimeRoutes.some((route) => directStringProperty(route, 'path') === path),
      `${path} must not be nested inside KioskRuntimeRoot`,
    )
  }
}

function rootMainStartTag(page, label) {
  const match = /return\s*\(\s*(<main\b[\s\S]*?>)/.exec(page)
  assert.ok(match, `${label} must return an existing root main element`)
  return match[1]
}

function assertMobilePageContract(page, { label, stylesheet, services }) {
  const rootMain = rootMainStartTag(page, label)
  for (const [attribute, pattern] of [
    ['service-desk class', /className="[^"]*\bservice-desk\b[^"]*"/],
    ['service-desk visual theme', /data-visual-theme="service-desk"/],
    ['touch density', /data-ux-density="touch"/],
    ['fusion presentation', /data-kiosk-presentation="fusion-youth"/],
    ['mobile viewport', /data-kiosk-viewport="mobile"/],
  ]) {
    assert.match(rootMain, pattern, `${label} root main must preserve ${attribute}`)
  }
  assert.match(page, new RegExp(`import\\s+['"]${stylesheet.replace('.', '\\.')}['"]`), `${label} must retain its service-desk stylesheet`)
  for (const service of services) {
    assert.match(page, new RegExp(`\\b${service}\\s*\\(`), `${label} must retain ${service}`)
  }
}

function assertImportOrder(css) {
  const imports = [...css.matchAll(/@import\s+["']([^"']+)["']\s*;/g)].map((match) => match[1])
  assert.deepEqual(imports, [
    '@ai-job-print/ui/styles/tokens.css',
    '@ai-job-print/ui/styles/fusion-youth.css',
    // service-desk 在 kiosk-shell 之前：避免冰蓝 --sd-color-primary 盖住 fusion 青绿。
    '@ai-job-print/ui/styles/service-desk.css',
    '@ai-job-print/ui/styles/kiosk-shell.css',
    '@ai-job-print/ui/styles/kiosk-components.css',
    './styles/kiosk-stage-fit.css',
    './pages/jobs-fairs-prototype.css',
    'tailwindcss',
    './styles/warm-professional-override.css',
  ], 'index.css must preserve tokens -> fusion-youth -> service-desk -> kiosk-shell/components -> stage-fit -> local CSS -> Tailwind -> warm override import order')
}

const packageJson = JSON.parse(await read('package.json'))
assert.equal(
  packageJson.scripts?.['verify:fusion-shell'],
  'node scripts/verify-fusion-shell.mjs',
  'package.json must expose the exact verify:fusion-shell command',
)

const layout = await read('../../packages/ui/src/layouts/KioskLayout.tsx')
const root = await read('src/layouts/KioskRoot.tsx')
const runtimeRoot = await read('src/layouts/KioskRuntimeRoot.tsx')
const privacyGuard = await read('src/auth/KioskPrivacyGuard.tsx')
const stageFit = await read('src/components/kiosk-shell/KioskStageFit.tsx')
const css = await read('src/index.css')
const routes = await read('src/routes/index.tsx')
const mobileQrLogin = await read('src/pages/auth/MobileQrLoginPage.tsx')
const phoneUpload = await read('src/pages/upload/PhoneUploadPage.tsx')

assert.match(layout, /\bpresentation\?:\s*KioskPresentation\b/, 'KioskLayout must expose presentation')
assert.match(layout, /\bviewport\?:\s*KioskViewport\b/, 'KioskLayout must expose viewport')
assert.match(layout, /\bpresentation\s*=\s*['"]legacy['"]/, 'presentation must default to legacy')
assert.match(layout, /\bviewport\s*=\s*['"]kiosk['"]/, 'viewport must default to kiosk')
assert.match(
  layout,
  /\.\.\.getKioskPresentationAttributes\(\s*presentation\s*,\s*viewport\s*\)/,
  'KioskLayout root must spread presentation attributes',
)
assert.match(
  layout,
  /\.\.\.getVisualThemeAttributes\(\s*visualTheme\s*,\s*density\s*\)/,
  'KioskLayout must preserve visual theme attributes',
)

assert.match(root, /presentation\s*=\s*['"]fusion-youth['"]/, 'KioskRoot must opt into fusion-youth')
assert.doesNotMatch(root, /MOBILE_HELPER_ROUTES|isMobileHelperRoute/, 'KioskRoot must not try to classify routes it does not render')
assert.match(runtimeRoot, /<KioskBusyProvider>/, 'KioskRuntimeRoot must provide unified busy state')
assert.match(runtimeRoot, /<KioskPrivacyGuard>/, 'KioskRuntimeRoot must preserve the privacy guard')
assert.match(runtimeRoot, /<Outlet\s*\/>/, 'KioskRuntimeRoot must render protected terminal routes')

// P0-1B: warning handler 进入 Guard；最终清场仍走 hardClear + clearKioskSensitiveSession，
// 安全根 fail-closed 与硬隐私截止不受 busy 抑制保持不变。
assert.match(
  withoutComments(privacyGuard),
  /useScreensaverController\(\s*handleScreensaverWarning\s*\)/,
  'KioskPrivacyGuard must wire screensaver controller into the warning handler',
)
assert.match(
  withoutComments(privacyGuard),
  /useIdleLogout\(\s*screensaverActive\s*,\s*handleOrdinaryWarning\s*\)/,
  'KioskPrivacyGuard must wire idle logout into the warning handler',
)
assert.match(
  withoutComments(privacyGuard),
  /clearKioskSensitiveSession\(\)/,
  'KioskPrivacyGuard must clear sensitive session through the unified helper',
)
assert.match(
  withoutComments(privacyGuard),
  /\bhardClear\b/,
  'KioskPrivacyGuard must keep a fail-closed hard-clear path',
)

assertTopLevelHelperRoutes(routes)
assertMobilePageContract(mobileQrLogin, {
  label: 'MobileQrLoginPage',
  stylesheet: './mobile-qr-service-desk.css',
  services: ['fetchQrLoginStatus', 'sendSmsCode', 'confirmQrLogin'],
})
assertMobilePageContract(phoneUpload, {
  label: 'PhoneUploadPage',
  stylesheet: './phone-upload-service-desk.css',
  services: ['uploadPhoneSessionFile'],
})

const shellBody = functionBody(root, 'KioskShell')
for (const [label, pattern] of [
  ['favorites provider', /<FavoritesProvider>/],
  ['active tab derivation', /getActiveTab\(\s*pathname\s*\)/],
  ['tab navigation', /navigate\(\s*tabToPath\(\s*tab\s*\)\s*\)/],
  ['unified service-desk theme', /visualTheme\s*=\s*['"]service-desk['"]/],
  ['unified fusion presentation', /presentation\s*=\s*['"]fusion-youth['"]/],
  ['responsive viewport size binding', /const\s*\{\s*viewportW\s*,\s*viewportH\s*\}\s*=\s*useKioskStageFit\(\s*\)/],
  ['compact viewport boundary', /const\s+isCompactViewport\s*=\s*viewportW\s*<=\s*760\s*\|\|\s*\(\s*viewportW\s*<=\s*960\s*&&\s*viewportW\s*>\s*viewportH\s*\)/],
  ['responsive home boundary', /const\s+isResponsiveHome\s*=\s*pathname\s*===\s*['"]\/['"]\s*&&\s*isCompactViewport/],
  ['responsive viewport', /viewport\s*=\s*\{\s*isCompactViewport\s*\?\s*['"]mobile['"]\s*:\s*['"]kiosk['"]\s*\}/],
  // V6 落 main 后 className 由裸三元改为模板串，用于在 V6 路由上追加
  // v6-runtime-shell。响应式首页的两个类名与判定条件必须原样保留，
  // 因此这里仍逐字校验 isResponsiveHome ? 'kiosk-home-mobile' : 'h-full'，
  // 只允许它被模板串包裹，不放宽成任意表达式。
  ['responsive home stable class', /className\s*=\s*\{[\s\S]{0,40}?isResponsiveHome\s*\?\s*['"]kiosk-home-mobile['"]\s*:\s*['"]h-full['"]/],
  ['fluid desktop boundary', /const\s+usesFluidViewport\s*=\s*isCompactViewport\s*\|\|\s*\(\s*viewportW\s*>\s*960\s*&&\s*viewportW\s*>\s*viewportH\s*\)/],
  ['stable KioskStageFit wrapper', /return\s*<KioskStageFit\s+enabled=\{\s*!usesFluidViewport\s*\}>\s*\{\s*shell\s*\}\s*<\/KioskStageFit>/],
  ['device status always on', /useTerminalDeviceStatus\(\s*true\s*\)/],
  ['campus route detection', /pathname\s*===\s*['"]\/campus['"]/],
  ['campus-only header hide', /hideHeader\s*=\s*\{\s*isCampusZone\s*\}/],
  ['campus/actionbar nav replacement', /hideBottomNav\s*=\s*\{\s*isCampusZone\s*\|\|\s*usesPageActionbar\s*\}/],
]) {
  assert.match(shellBody, pattern, `KioskShell must preserve ${label}`)
}
const responsiveHomeFor = (viewportW, viewportH) =>
  viewportW <= 760 || (viewportW <= 960 && viewportW > viewportH)
assert.equal(responsiveHomeFor(932, 430), true, '932x430 must preserve the mobile home shell')
assert.equal(responsiveHomeFor(932, 800), true, '932x800 must not depend on visual viewport height')
assert.equal(responsiveHomeFor(800, 932), false, '800x932 portrait must preserve the staged kiosk shell')
assert.equal(responsiveHomeFor(961, 760), false, '961x760 must preserve the staged kiosk shell')
assert.equal(responsiveHomeFor(1024, 768), false, '1024x768 must preserve the staged kiosk shell')
assert.equal(shellBody.includes('SERVICE_DESK_EXACT_ROUTES'), false, 'KioskShell must remove SERVICE_DESK_EXACT_ROUTES theme fork')
assert.equal(shellBody.includes("'legacy'"), false, 'KioskShell must not select legacy visualTheme')
assert.doesNotMatch(shellBody, /if\s*\(\s*isResponsiveHome\s*\)\s*return\s+shell/, 'KioskShell must not replace the stage root across rotation')

assert.match(stageFit, /enabled\?:\s*boolean/, 'KioskStageFit must expose optional enabled')
assert.match(stageFit, /enabled\s*=\s*true/, 'KioskStageFit enabled must default to true')
assert.match(stageFit, /data-kiosk-stage-fit=\{enabled\s*\?\s*['"]on['"]\s*:\s*['"]off['"]\}/, 'KioskStageFit must expose on/off state')
assert.match(stageFit, /transform:\s*enabled\s*\?\s*`scale\(\$\{scale\}\)`\s*:\s*['"]none['"]/, 'KioskStageFit off state must disable transforms')

const activeTabBody = functionBody(root, 'getActiveTab')
for (const [pathContract, pattern] of [
  ['/assistant -> assistant', /pathname\.startsWith\(\s*['"]\/assistant['"]\s*\)[\s\S]*?return\s+['"]assistant['"]/],
  ['/profile -> profile', /pathname\.startsWith\(\s*['"]\/profile['"]\s*\)[\s\S]*?return\s+['"]profile['"]/],
  ['/me -> profile', /pathname\s*===\s*['"]\/me['"][\s\S]*?return\s+['"]profile['"]/],
  ['/me/* -> profile', /pathname\.startsWith\(\s*['"]\/me\/['"]\s*\)[\s\S]*?return\s+['"]profile['"]/],
  ['fallback -> home', /return\s+['"]home['"]/],
]) {
  assert.match(activeTabBody, pattern, `getActiveTab must preserve ${pathContract}`)
}

const tabPathBody = functionBody(root, 'tabToPath')
for (const [tabContract, pattern] of [
  ['assistant -> /assistant', /tab\s*===\s*['"]assistant['"][\s\S]*?return\s+['"]\/assistant['"]/],
  ['profile -> /profile', /tab\s*===\s*['"]profile['"][\s\S]*?return\s+['"]\/profile['"]/],
  ['fallback -> /', /return\s+['"]\/['"]/],
]) {
  assert.match(tabPathBody, pattern, `tabToPath must preserve ${tabContract}`)
}

assert.doesNotMatch(
  root,
  /(?:from\s*|import\s*\(\s*)['"][^'"]*(?:\/routes?(?:\/|['"]))|\b(?:fetch|axios)\s*\(|['"]\/api\//i,
  'KioskRoot must not gain route-definition or raw API dependencies',
)
assert.match(
  root,
  /from\s+['"]\.\.\/services\/api\/terminalConfig['"]/,
  'KioskRoot may import terminalConfig only for brand/device identity',
)
assert.doesNotMatch(
  layout,
  /(?:from\s*|import\s*\(\s*)['"][^'"]*(?:\/apps?(?:\/|['"])|\/services?(?:\/|['"])|\/hooks?(?:\/|['"]))/i,
  'KioskLayout must remain free of app, service, and hook dependencies',
)

assertImportOrder(css)
assert.match(
  css,
  /\/\*[^*]*Kiosk[^*]*(?:presentation|属性)[^*]*(?:scoped|作用域)[^*]*\*\//i,
  'index.css must document attribute-scoped Kiosk presentation CSS',
)

console.log('PASS Kiosk fusion presentation shell contract')
