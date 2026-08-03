import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const packageRoot = fileURLToPath(new URL('../', import.meta.url))
const repoRoot = fileURLToPath(new URL('../../../', import.meta.url))

async function read(relativePath, root = packageRoot) {
  try {
    return await readFile(new URL(relativePath, new URL(`file://${root}/`)), 'utf8')
  } catch (error) {
    throw new Error(`Required foundation file is missing or unreadable: ${relativePath}`, {
      cause: error,
    })
  }
}

async function listRuntimeSourceFiles(relativeDirectory, root = repoRoot) {
  const directoryUrl = new URL(`${relativeDirectory.replace(/\/?$/, '/')}`, new URL(`file://${root}/`))
  const entries = await readdir(directoryUrl, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    const relativePath = `${relativeDirectory}/${entry.name}`
    if (entry.isDirectory()) {
      files.push(...(await listRuntimeSourceFiles(relativePath, root)))
    } else if (/\.(?:[cm]?[jt]sx?|css)$/.test(entry.name)) {
      files.push(relativePath)
    }
  }

  return files
}

function includesAll(source, fragments, label) {
  for (const fragment of fragments) {
    assert.ok(source.includes(fragment), `${label} must include ${fragment}`)
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function extractStringLiteralUnion(source, typeName) {
  const match = new RegExp(`export\\s+type\\s+${typeName}\\s*=\\s*([^;\\n]+)`).exec(source)
  assert.ok(match, `${typeName} must be an exported type alias`)

  return match[1].split('|').map((member) => {
    const literal = /^(['"])([^'"]+)\1$/.exec(member.trim())
    assert.ok(literal, `${typeName} members must all be string literals`)
    return literal[2]
  })
}

function extractReturnedRootOpeningTag(source, functionName) {
  const functionStart = source.indexOf(`export function ${functionName}`)
  assert.ok(functionStart >= 0, `${functionName} must be an exported function`)
  const functionSource = source.slice(functionStart)
  const match = /return\s*\(\s*(<([A-Za-z][\w.]*)\b[\s\S]*?>)/.exec(functionSource)
  assert.ok(match, `${functionName} must return a JSX root element`)
  return { openingTag: match[1], tagName: match[2] }
}

function extractCssRule(source, selector) {
  const escapedSelector = escapeRegExp(selector)
  const match = new RegExp(`(?:^|})\\s*${escapedSelector}\\s*\\{([^{}]*)\\}`, 'm').exec(source)
  assert.ok(match, `service-desk.css must define the exact selector ${selector}`)
  return match[1]
}

function parseDeclarations(block, selector) {
  const declarations = new Map()
  for (const rawDeclaration of block.split(';')) {
    const declaration = rawDeclaration.trim()
    if (!declaration) continue
    const separator = declaration.indexOf(':')
    assert.ok(separator > 0, `${selector} contains an invalid declaration: ${declaration}`)
    const property = declaration.slice(0, separator).trim()
    const value = declaration.slice(separator + 1).trim()
    assert.ok(value, `${selector} declaration ${property} must have a value`)
    assert.equal(declarations.has(property), false, `${selector} duplicates ${property}`)
    declarations.set(property, value)
  }
  return declarations
}

function assertExactDeclarations(declarations, expected, selector) {
  for (const [property, value] of Object.entries(expected)) {
    assert.equal(
      declarations.get(property),
      value,
      `${selector} must declare ${property}: ${value}`,
    )
  }
}

const packageJson = JSON.parse(await read('package.json'))
assert.equal(
  packageJson.scripts?.['verify:service-desk-foundation'],
  'node scripts/verify-service-desk-foundation.mjs',
  'package.json must expose verify:service-desk-foundation',
)
assert.equal(
  packageJson.exports?.['./styles/*'],
  './src/styles/*',
  'package.json must export ./styles/*',
)

const ciWorkflow = await read('.github/workflows/ci.yml', repoRoot)
assert.ok(
  ciWorkflow.includes("tracked=$(git ls-files .ccg/tasks | grep -Ev '^\\.ccg/tasks/archive/' || true)"),
  'CI guard must reject active .ccg/tasks state while allowing the required archive records',
)
includesAll(ciWorkflow, [
  'name: LightFlow UI static contracts',
  'otherTracked=$(git ls-files .ccg/commander .product-pm .workbuddy .superpowers .worktrees opc-doc)',
  "tracked=\"$tracked${tracked:+$'\\n'}$otherTracked\"",
  'pnpm --filter @ai-job-print/ui verify:service-desk-foundation',
  'pnpm --filter @ai-job-print/kiosk verify:home-prototype-v1',
  'pnpm --filter @ai-job-print/admin verify:service-desk-dashboard-ui',
  'pnpm --filter @ai-job-print/partner verify:service-desk-jobs-ui',
], 'CI workflow')

const visualTheme = await read('src/theme/visualTheme.ts')
assert.deepEqual(
  extractStringLiteralUnion(visualTheme, 'VisualTheme'),
  ['legacy', 'service-desk'],
  'VisualTheme must contain exactly legacy and service-desk',
)
assert.deepEqual(
  extractStringLiteralUnion(visualTheme, 'UiDensity'),
  ['touch', 'compact', 'comfortable'],
  'UiDensity must contain exactly touch, compact, and comfortable',
)
assert.match(
  visualTheme,
  /export\s+function\s+getVisualThemeAttributes\(\s*visualTheme:\s*VisualTheme,\s*density:\s*UiDensity,?\s*\)\s*\{\s*return\s*\{\s*'data-visual-theme':\s*visualTheme,\s*'data-ux-density':\s*density,?\s*\}\s*as const\s*\}/,
  'getVisualThemeAttributes must return exactly the two required data attributes as const',
)

const kioskLayout = await read('src/layouts/KioskLayout.tsx')
includesAll(kioskLayout, [
  'visualTheme?: VisualTheme',
  'density?: UiDensity',
  "visualTheme = 'legacy'",
  "density = 'touch'",
  'ui-kiosk-nav',
], 'KioskLayout')
const kioskRoot = extractReturnedRootOpeningTag(kioskLayout, 'KioskLayout')
assert.equal(kioskRoot.tagName, 'div', 'KioskLayout root must remain a div')
assert.match(
  kioskRoot.openingTag,
  /\{\.\.\.getVisualThemeAttributes\(visualTheme, density\)\}/,
  'KioskLayout root must spread the visual theme attributes',
)
assert.match(kioskRoot.openingTag, /ui-kiosk-shell/, 'KioskLayout root needs ui-kiosk-shell')

const adminLayout = await read('src/layouts/AdminLayout.tsx')
includesAll(adminLayout, [
  'visualTheme?: VisualTheme',
  'density?: UiDensity',
  "visualTheme = 'legacy'",
  "density = 'compact'",
  'ui-admin-sidebar',
  'ui-admin-topbar',
  'ui-admin-content',
], 'AdminLayout')
const adminRoot = extractReturnedRootOpeningTag(adminLayout, 'AdminLayout')
assert.equal(adminRoot.tagName, 'div', 'AdminLayout root must remain a div')
assert.match(
  adminRoot.openingTag,
  /\{\.\.\.getVisualThemeAttributes\(visualTheme, density\)\}/,
  'AdminLayout root must spread the visual theme attributes',
)
assert.match(adminRoot.openingTag, /ui-admin-shell/, 'AdminLayout root needs ui-admin-shell')

const partnerLayout = await read('src/layouts/PartnerLayout.tsx')
includesAll(partnerLayout, [
  "visualTheme = 'legacy'",
  "density = 'comfortable'",
], 'PartnerLayout')
const partnerRoot = extractReturnedRootOpeningTag(partnerLayout, 'PartnerLayout')
assert.equal(partnerRoot.tagName, 'AdminLayout', 'PartnerLayout must return and reuse AdminLayout')
includesAll(partnerRoot.openingTag, [
  'appName={orgName}',
  'visualTheme={visualTheme}',
  'density={density}',
  '{...props}',
], 'PartnerLayout returned AdminLayout')

const publicIndex = await read('src/index.ts')
includesAll(publicIndex, [
  "export { getVisualThemeAttributes } from './theme/visualTheme'",
  "export type { VisualTheme, UiDensity } from './theme/visualTheme'",
], 'packages/ui public index')

const css = await read('src/styles/service-desk.css')
assert.equal(
  /(^|[},])\s*(?::root|html|body)(?:\s|[,{])/m.test(css),
  false,
  'service-desk.css must not contain unscoped :root, html, or body selectors',
)

const themeSelector = "[data-visual-theme='service-desk']"
const themeDeclarations = parseDeclarations(extractCssRule(css, themeSelector), themeSelector)
const coreColors = {
  '--sd-color-canvas-outer': '#e9f1fb',
  '--sd-color-canvas': '#f7faff',
  '--sd-color-surface': '#ffffff',
  '--sd-color-text-strong': '#071a43',
  '--sd-color-text': '#17345d',
  '--sd-color-copy': '#566a84',
  '--sd-color-copy-muted': '#64748b',
  '--sd-color-primary': '#1769e8',
  '--sd-color-primary-strong': '#0758d7',
  '--sd-color-line': '#dce6f4',
  '--sd-color-line-strong': '#cbd9ed',
}
const categoryColors = {
  '--sd-category-blue-bg': '#edf6ff',
  '--sd-category-blue-fg': '#0f64c5',
  '--sd-category-mint-bg': '#eefaf6',
  '--sd-category-mint-fg': '#087f6a',
  '--sd-category-orange-bg': '#fff7ef',
  '--sd-category-orange-fg': '#a94c12',
  '--sd-category-lavender-bg': '#f5f3ff',
  '--sd-category-lavender-fg': '#594bc0',
  '--sd-category-cyan-bg': '#effbff',
  '--sd-category-cyan-fg': '#067b9d',
  '--sd-category-sand-bg': '#fffaf0',
  '--sd-category-sand-fg': '#93620e',
}
assertExactDeclarations(themeDeclarations, coreColors, themeSelector)
assertExactDeclarations(themeDeclarations, categoryColors, themeSelector)
for (const property of [...Object.keys(coreColors), ...Object.keys(categoryColors)]) {
  const declarations = [...css.matchAll(new RegExp(`${escapeRegExp(property)}\\s*:`, 'g'))]
  assert.equal(declarations.length, 1, `${property} must be declared exactly once in service-desk.css`)
}

includesAll(css, [
  "[data-visual-theme='service-desk'][data-ux-density='touch']",
  "[data-visual-theme='service-desk'][data-ux-density='compact']",
  "[data-visual-theme='service-desk'][data-ux-density='comfortable']",
  ':focus-visible',
  '@media (prefers-reduced-motion: reduce)',
], 'service-desk.css')

const hookContracts = [
  {
    legacySelector: '.ui-kiosk-shell',
    scopedSelector: "[data-visual-theme='service-desk'].ui-kiosk-shell",
    variables: ['--ui-kiosk-shell-background'],
  },
  {
    legacySelector: '.ui-kiosk-nav',
    scopedSelector: "[data-visual-theme='service-desk'] .ui-kiosk-nav",
    variables: ['--ui-kiosk-nav-background', '--ui-kiosk-nav-border'],
  },
  {
    legacySelector: '.ui-admin-sidebar',
    scopedSelector: "[data-visual-theme='service-desk'] .ui-admin-sidebar",
    variables: ['--ui-admin-sidebar-background', '--ui-admin-sidebar-foreground'],
  },
  {
    legacySelector: '.ui-admin-topbar',
    scopedSelector: "[data-visual-theme='service-desk'] .ui-admin-topbar",
    variables: ['--ui-admin-topbar-background', '--ui-admin-topbar-border'],
  },
  {
    legacySelector: '.ui-admin-content',
    scopedSelector: "[data-visual-theme='service-desk'] .ui-admin-content",
    variables: ['--ui-admin-content-background', '--ui-admin-content-gap'],
  },
]
for (const { legacySelector, scopedSelector, variables } of hookContracts) {
  const legacyDeclarations = parseDeclarations(extractCssRule(css, legacySelector), legacySelector)
  const scopedDeclarations = parseDeclarations(extractCssRule(css, scopedSelector), scopedSelector)
  for (const variable of variables) {
    assert.ok(legacyDeclarations.has(variable), `${legacySelector} must define ${variable}`)
    assert.ok(scopedDeclarations.has(variable), `${scopedSelector} must override ${variable}`)
  }
}

const kioskCss = await read('apps/kiosk/src/index.css', repoRoot)
const kioskLegacyImport = kioskCss.indexOf('@import "@ai-job-print/ui/styles/fusion-youth.css";')
const kioskServiceDeskImport = kioskCss.indexOf('@import "@ai-job-print/ui/styles/service-desk.css";')
assert.ok(kioskLegacyImport >= 0, 'kiosk must retain its Fusion-Youth base theme import')
assert.ok(
  kioskServiceDeskImport > kioskLegacyImport,
  'kiosk must import service-desk.css after its base theme',
)

for (const app of ['admin', 'partner']) {
  const appCss = await read(`apps/${app}/src/index.css`, repoRoot)
  assert.ok(
    appCss.includes('@import "@ai-job-print/ui/styles/inkpaper.css";'),
    `${app} must retain the Inkpaper backend theme import`,
  )
  assert.equal(
    appCss.includes('@import "@ai-job-print/ui/styles/service-desk.css";'),
    false,
    `${app} must not import the Kiosk-only service-desk theme`,
  )

  const runtimeFiles = await listRuntimeSourceFiles(`apps/${app}/src`)
  const serviceDeskReferences = []
  for (const runtimeFile of runtimeFiles) {
    const source = await read(runtimeFile, repoRoot)
    if (source.includes('service-desk') || source.includes('--sd-')) {
      serviceDeskReferences.push(runtimeFile)
    }
  }
  assert.deepEqual(
    serviceDeskReferences,
    [],
    `${app} runtime source must not contain Kiosk-only service-desk or --sd-* references`,
  )
}

console.log('VISUAL_STYLE_BOUNDARY_VERIFY_OK')
