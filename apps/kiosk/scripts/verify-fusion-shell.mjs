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
  if (!property || !ts.isJsxSelfClosingElement(property.initializer)) return null
  return ts.isIdentifier(property.initializer.tagName) ? property.initializer.tagName.text : null
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

function assertTopLevelHelperRoutes(routes) {
  const objects = topLevelRouteObjects(routes)
  const rootRouteIndex = objects.findIndex((route) =>
    directStringProperty(route, 'path') === '/' &&
    directJsxComponentProperty(route, 'element') === 'KioskRoot',
  )
  assert.ok(rootRouteIndex >= 0, 'KioskRoot route must remain a direct createBrowserRouter entry')

  for (const [path, component] of [
    ['/member/qr-login', 'MobileQrLoginPage'],
    ['/upload/phone', 'PhoneUploadPage'],
  ]) {
    const routeIndex = objects.findIndex((route) =>
      directStringProperty(route, 'path') === path &&
      directJsxComponentProperty(route, 'element') === component,
    )
    assert.ok(routeIndex >= 0, `${path} must remain a direct createBrowserRouter route`)
    assert.ok(routeIndex < rootRouteIndex, `${path} must stay before the KioskRoot route instead of becoming a child route`)
    const rootChildren = directProperty(objects[rootRouteIndex], 'children')
    if (rootChildren && ts.isArrayLiteralExpression(rootChildren.initializer)) {
      const nestedPaths = rootChildren.initializer.elements
        .filter(ts.isObjectLiteralExpression)
        .map((route) => directStringProperty(route, 'path'))
      assert.ok(!nestedPaths.includes(path), `${path} must not be nested in KioskRoot children`)
    }
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
    '@ai-job-print/ui/styles/service-desk.css',
    './pages/jobs-fairs-prototype.css',
    'tailwindcss',
  ], 'index.css must preserve tokens -> fusion-youth -> service-desk -> local CSS -> Tailwind import order')
}

const packageJson = JSON.parse(await read('package.json'))
assert.equal(
  packageJson.scripts?.['verify:fusion-shell'],
  'node scripts/verify-fusion-shell.mjs',
  'package.json must expose the exact verify:fusion-shell command',
)

const layout = await read('../../packages/ui/src/layouts/KioskLayout.tsx')
const root = await read('src/layouts/KioskRoot.tsx')
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
assert.match(root, /viewport\s*=\s*['"]kiosk['"]/, 'KioskRoot must always use the kiosk viewport')
assert.doesNotMatch(root, /MOBILE_HELPER_ROUTES|isMobileHelperRoute/, 'KioskRoot must not try to classify routes it does not render')

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
  ['screensaver controller', /useScreensaverController\(\s*\)/],
  ['idle logout', /useIdleLogout\(\s*screensaverActive\s*\)/],
  ['device status route guard', /useHomeDeviceStatus\(\s*pathname\s*!==\s*['"]\/['"]\s*\)/],
  ['favorites provider', /<FavoritesProvider>/],
  ['active tab derivation', /getActiveTab\(\s*pathname\s*\)/],
  ['tab navigation', /navigate\(\s*tabToPath\(\s*tab\s*\)\s*\)/],
  ['exact service-desk selection', /SERVICE_DESK_EXACT_ROUTES\.includes\(\s*pathname\s*\)/],
  ['visual theme selection', /visualTheme\s*=\s*\{\s*isServiceDeskRoute\s*\?\s*['"]service-desk['"]\s*:\s*['"]legacy['"]\s*\}/],
  ['campus route detection', /pathname\s*===\s*['"]\/campus['"]/],
  ['campus-aware header visibility', /hideHeader\s*=\s*\{\s*pathname\s*===\s*['"]\/['"]\s*\|\|\s*isCampusZone\s*\}/],
  ['campus-aware navigation visibility', /hideBottomNav\s*=\s*\{\s*pathname\s*===\s*['"]\/['"]\s*\|\|\s*isCampusZone\s*\}/],
]) {
  assert.match(shellBody, pattern, `KioskShell must preserve ${label}`)
}

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
  /(?:from\s*|import\s*\(\s*)['"][^'"]*(?:\/routes?(?:\/|['"])|\/services?(?:\/|['"]))|\b(?:fetch|axios)\s*\(|['"]\/api\//i,
  'KioskRoot must not gain route-definition, service, or API dependencies',
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
