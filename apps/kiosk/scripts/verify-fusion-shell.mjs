import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

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

assert.match(
  root,
  /const\s+MOBILE_HELPER_ROUTES\s*=\s*new Set\(\s*\[\s*['"]\/member\/qr-login['"]\s*,\s*['"]\/upload\/phone['"]\s*\]\s*\)/,
  'mobile helper route set must contain exactly the two frozen paths',
)
assert.match(
  root,
  /const\s+isMobileHelperRoute\s*=\s*MOBILE_HELPER_ROUTES\.has\(\s*pathname\s*\)/,
  'KioskRoot must derive viewport from the current pathname',
)
assert.match(root, /presentation\s*=\s*['"]fusion-youth['"]/, 'KioskRoot must opt into fusion-youth')
assert.match(
  root,
  /viewport\s*=\s*\{\s*isMobileHelperRoute\s*\?\s*['"]mobile['"]\s*:\s*['"]kiosk['"]\s*\}/,
  'KioskRoot must select the mobile viewport only for helper routes',
)

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
