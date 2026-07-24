import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const packageRoot = fileURLToPath(new URL('../', import.meta.url))

async function read(relativePath) {
  try {
    return await readFile(new URL(relativePath, new URL(`file://${packageRoot}/`)), 'utf8')
  } catch (error) {
    throw new Error(`Required Kiosk fusion foundation file is missing or unreadable: ${relativePath}`, {
      cause: error,
    })
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function extractStringLiteralUnion(source, typeName) {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
  const declaration = new RegExp(`export\\s+type\\s+${escapeRegExp(typeName)}\\s*=`).exec(withoutComments)
  assert.ok(declaration, `${typeName} must be an exported type alias`)

  const remainder = withoutComments.slice(declaration.index + declaration[0].length)
  const nextExport = remainder.search(/\n\s*export\s+(?:type|interface|function|const|class)\b/)
  const expression = (nextExport >= 0 ? remainder.slice(0, nextExport) : remainder).trim()
  const literals = [...expression.matchAll(/(['"])([^'"]+)\1/g)].map((match) => match[2])
  const residue = expression.replace(/(['"])[^'"]+\1/g, '').replace(/[|;\s]/g, '')

  assert.ok(literals.length > 0, `${typeName} must contain string literal members`)
  assert.equal(residue, '', `${typeName} members must all be string literals`)
  return literals
}

function extractInterfaceProperties(source, interfaceName) {
  const withoutComments = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/.*$/gm, '')
  const match = new RegExp(
    `export\\s+interface\\s+${escapeRegExp(interfaceName)}\\s*\\{([^{}]*)\\}`,
    'm',
  ).exec(withoutComments)
  assert.ok(match, `${interfaceName} must be an exported interface`)

  return match[1]
    .split(/[;\n]/)
    .map((property) => property.replace(/\s+/g, ''))
    .filter(Boolean)
    .sort()
}

function assertExactInterface(source, interfaceName, expectedProperties) {
  assert.deepEqual(
    extractInterfaceProperties(source, interfaceName),
    expectedProperties.map((property) => property.replace(/\s+/g, '')).sort(),
    `${interfaceName} must preserve the frozen public props contract`,
  )
}

function assertIncludes(source, fragments, label) {
  for (const fragment of fragments) {
    assert.ok(source.includes(fragment), `${label} must include ${fragment}`)
  }
}

function assertPresentationOnly(component, source) {
  const forbiddenIdentifiers = [
    ['fetch', /\bfetch\s*\(/],
    ['useNavigate', /\buseNavigate\b/],
    ['useLocation', /\buseLocation\b/],
  ]
  for (const [label, pattern] of forbiddenIdentifiers) {
    assert.doesNotMatch(source, pattern, `${component} must not use ${label}`)
  }

  const importSources = [
    ...source.matchAll(/\bfrom\s*['"]([^'"]+)['"]/g),
    ...source.matchAll(/\bimport\s*['"]([^'"]+)['"]/g),
  ].map((match) => match[1])

  for (const importSource of importSources) {
    assert.equal(
      /(?:^|\/)(?:apps|services|stores?|hooks?)(?:\/|$)/i.test(importSource),
      false,
      `${component} must not import app, service, business store, or business hook modules: ${importSource}`,
    )
  }
}

function extractCssSelectors(source) {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const selectors = []
  let preludeStart = 0

  for (let index = 0; index < css.length; index += 1) {
    if (css[index] === '{') {
      const prelude = css.slice(preludeStart, index).trim()
      if (prelude && !prelude.startsWith('@')) selectors.push(prelude)
      preludeStart = index + 1
    } else if (css[index] === '}') {
      preludeStart = index + 1
    }
  }

  return selectors.flatMap((selector) => selector.split(',').map((part) => part.trim()))
}

function extractCssRule(source, selectorPattern, label) {
  const match = new RegExp(`${selectorPattern}\\s*\\{([^{}]*)\\}`, 'm').exec(source)
  assert.ok(match, `fusion-youth.css must define ${label}`)
  return match[1]
}

const packageJson = JSON.parse(await read('package.json'))
assert.equal(
  packageJson.scripts?.['verify:fusion-youth-foundation'],
  'node scripts/verify-fusion-youth-foundation.mjs',
  'package.json must expose the exact verify:fusion-youth-foundation command',
)

const theme = await read('src/theme/visualTheme.ts')
assert.deepEqual(
  extractStringLiteralUnion(theme, 'VisualTheme'),
  ['legacy', 'service-desk'],
  'VisualTheme must remain exactly legacy and service-desk',
)
assert.deepEqual(
  extractStringLiteralUnion(theme, 'KioskPresentation'),
  ['legacy', 'fusion-youth'],
  'KioskPresentation must contain exactly legacy and fusion-youth',
)
assert.deepEqual(
  extractStringLiteralUnion(theme, 'KioskViewport'),
  ['kiosk', 'mobile'],
  'KioskViewport must contain exactly kiosk and mobile',
)
assert.match(theme, /'data-kiosk-presentation'\s*:\s*presentation\b/)
assert.match(theme, /'data-kiosk-viewport'\s*:\s*viewport\b/)

const componentContracts = {
  KioskPageFrame: [
    'children: ReactNode',
    'header?: ReactNode',
    'footer?: ReactNode',
    'className?: string',
  ],
  KioskPageHeader: [
    'title: string',
    'description?: string',
    'onBack?: () => void',
    'backLabel?: string',
    'leading?: ReactNode',
    'aside?: ReactNode',
    'headingId?: string',
    'className?: string',
  ],
  KioskActionBar: [
    'children: ReactNode',
    'leading?: ReactNode',
    'className?: string',
  ],
  KioskStatePanel: [
    'tone: KioskStateTone',
    'title: string',
    'description?: string',
    'icon?: ReactNode',
    'meta?: ReactNode',
    'actions?: ReactNode',
    'compact?: boolean',
    'className?: string',
  ],
  KioskModal: [
    'open: boolean',
    'onClose: () => void',
    'title: string',
    'description?: string',
    'children?: ReactNode',
    'actions?: ReactNode',
    'closeLabel?: string',
    'closeOnBackdrop?: boolean',
    'closeOnEscape?: boolean',
    'className?: string',
  ],
}

const componentSources = new Map()
for (const [component, props] of Object.entries(componentContracts)) {
  const source = await read(`src/components/${component}.tsx`)
  componentSources.set(component, source)
  assertExactInterface(source, `${component}Props`, props)
  assert.match(source, new RegExp(`export\\s+function\\s+${component}\\b`), `${component} must be exported`)
  assertPresentationOnly(component, source)
}

const pageFrame = componentSources.get('KioskPageFrame')
assert.match(pageFrame, /<section\b/, 'KioskPageFrame must render a semantic section')
assert.match(pageFrame, /data-kiosk-component\s*=\s*['"]page-frame['"]/)
assertIncludes(pageFrame, ['ui-kiosk-page-frame'], 'KioskPageFrame')

const pageHeader = componentSources.get('KioskPageHeader')
assertIncludes(pageHeader, ['ui-kiosk-page-header', 'ui-kiosk-back-button'], 'KioskPageHeader')
assert.match(pageHeader, /<button\b/, 'KioskPageHeader back control must be a native button')
assert.match(
  pageHeader,
  /\{\s*onBack\s*(?:&&|\?)[\s\S]{0,400}<button\b/,
  'KioskPageHeader must render its back button only when onBack exists',
)
assert.match(pageHeader, /aria-label\s*=\s*\{backLabel\}/)
assert.match(pageHeader, /<h1\b[^>]*\bid\s*=\s*\{headingId\}/)

const actionBar = componentSources.get('KioskActionBar')
assertIncludes(
  actionBar,
  ['ui-kiosk-action-bar', 'ui-kiosk-action-leading', 'ui-kiosk-action-items'],
  'KioskActionBar',
)
assert.doesNotMatch(actionBar, /\bcloneElement\b/, 'KioskActionBar must not rewrite consumer actions')

const statePanel = componentSources.get('KioskStatePanel')
assert.deepEqual(
  extractStringLiteralUnion(statePanel, 'KioskStateTone'),
  ['loading', 'empty', 'error', 'offline', 'success', 'permission'],
  'KioskStateTone must preserve all six frozen tones in order',
)
assertIncludes(
  statePanel,
  [],
  'KioskStatePanel live-region contract',
)
for (const liveRegionValue of ['status', 'alert', 'polite', 'assertive']) {
  assert.match(
    statePanel,
    new RegExp(`['"]${liveRegionValue}['"]`),
    `KioskStatePanel must include the ${liveRegionValue} live-region value`,
  )
}
assert.match(statePanel, /aria-busy\s*=\s*\{[^}]*tone\s*===\s*['"]loading['"]/)
assert.match(statePanel, /data-tone\s*=\s*\{tone\}/)

const modal = componentSources.get('KioskModal')
assert.equal(
  [...modal.matchAll(/\buseEffect\s*\(/g)].length,
  1,
  'KioskModal must use one effect for focus, Escape, and scroll lifecycle cleanup',
)
assertIncludes(
  modal,
  [
    'ui-kiosk-modal-layer',
    'ui-kiosk-modal-backdrop',
    'ui-kiosk-modal-dialog',
    'document.activeElement',
    'document.body.style.overflow',
    'closeOnBackdrop',
    'closeOnEscape',
    'stopPropagation()',
    'useId(',
  ],
  'KioskModal',
)
assert.match(modal, /addEventListener\(\s*['"]keydown['"]/)
assert.match(modal, /removeEventListener\(\s*['"]keydown['"]/)
assert.match(modal, /['"]Escape['"]/)
assert.match(modal, /closeOnBackdrop\s*=\s*true/)
assert.match(modal, /closeOnEscape\s*=\s*true/)
assert.match(modal, /if\s*\(\s*!open\s*\)\s*return\s+null/)
assert.match(modal, /tabIndex\s*=\s*\{\s*-1\s*\}/)
assert.match(modal, /role\s*=\s*['"]dialog['"]/)
assert.match(modal, /aria-modal\s*=\s*['"]true['"]/)
assert.match(modal, /aria-labelledby\s*=/)
assert.match(modal, /aria-describedby\s*=/)
assert.match(modal, /aria-label\s*=\s*\{closeLabel\}/)
assert.ok(
  [...modal.matchAll(/\.focus\s*\(/g)].length >= 2,
  'KioskModal must focus its dialog and restore the previously focused element',
)
assert.ok(
  [...modal.matchAll(/document\.body\.style\.overflow/g)].length >= 3,
  'KioskModal must capture, lock, and restore body overflow',
)

const publicIndex = await read('src/index.ts')
for (const component of Object.keys(componentContracts)) {
  assert.match(
    publicIndex,
    new RegExp(`export\\s*\\{[^}]*\\b${component}\\b[^}]*\\}`),
    `public index must export ${component}`,
  )
  assert.match(
    publicIndex,
    new RegExp(`export\\s+type\\s*\\{[^}]*\\b${component}Props\\b[^}]*\\}`),
    `public index must export ${component}Props`,
  )
}
assert.match(publicIndex, /export\s+type\s*\{[^}]*\bKioskStateTone\b[^}]*\}/)
assert.match(publicIndex, /export\s+type\s*\{[^}]*\bKioskPresentation\b[^}]*\}/)
assert.match(publicIndex, /export\s+type\s*\{[^}]*\bKioskViewport\b[^}]*\}/)
assert.match(publicIndex, /export\s*\{[^}]*\bgetKioskPresentationAttributes\b[^}]*\}/)

const css = await read('src/styles/fusion-youth.css')
const presentationSelector = "[data-kiosk-presentation='fusion-youth']"
const presentationSelectorPattern = String.raw`\[data-kiosk-presentation=(['"])fusion-youth\1\]`
const presentationRule = extractCssRule(css, presentationSelectorPattern, presentationSelector)
for (const [property, value] of Object.entries({
  '--fy-paper': '#f4f1e8',
  '--fy-surface': '#fffdf8',
  '--fy-ink': '#10302b',
  '--fy-muted': '#5d6b63',
  '--fy-line': '#e2dccb',
  '--fy-teal': '#1f9e86',
  '--fy-teal-deep': '#157a67',
  '--fy-clay': '#b8683c',
})) {
  assert.match(
    presentationRule,
    new RegExp(`${escapeRegExp(property)}\\s*:\\s*${escapeRegExp(value)}\\s*;`),
    `${presentationSelector} must declare ${property}: ${value}`,
  )
}

const selectors = extractCssSelectors(css)
const isPresentationScoped = (selector) =>
  /^\[data-kiosk-presentation=(['"])fusion-youth\1\]/.test(selector)
const kioskSelectors = selectors.filter(
  (selector) => selector.includes('.ui-kiosk-') || selector.includes('data-kiosk-presentation='),
)
assert.ok(kioskSelectors.length > 1, 'fusion-youth.css must define scoped Kiosk component rules')
for (const selector of kioskSelectors) {
  assert.ok(
    isPresentationScoped(selector),
    `Kiosk fusion selector must be presentation-scoped: ${selector}`,
  )
  for (const className of selector.matchAll(/\.([_a-zA-Z]+[_a-zA-Z0-9-]*)/g)) {
    assert.match(
      className[1],
      /^ui-kiosk-/,
      `Kiosk fusion selector must not introduce a generic class: ${selector}`,
    )
  }
  assert.doesNotMatch(
    selector,
    /(^|[\s>+~])(?:html|body|button)(?=$|[\s>+~:[.#])/,
    `Kiosk fusion selector must not target a generic element: ${selector}`,
  )
  assert.doesNotMatch(selector, /\b(?:admin|partner)\b/i)
}
for (const selector of selectors) {
  assert.ok(
    selector === ':root' || isPresentationScoped(selector),
    `fusion-youth.css must not add an unscoped selector: ${selector}`,
  )
}

assert.ok(
  selectors.some((selector) =>
    /^\[data-kiosk-presentation=(['"])fusion-youth\1\]\[data-kiosk-viewport=(['"])mobile\2\]/.test(selector),
  ),
  'fusion-youth.css must scope mobile rules below the mobile viewport attribute',
)
assert.ok(
  selectors.some((selector) => isPresentationScoped(selector) && selector.includes(':focus-visible')),
  'fusion-youth.css must provide a presentation-scoped focus-visible rule',
)
assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)/)
assert.match(
  css,
  /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?\[data-kiosk-presentation=['"]fusion-youth['"]/,
  'reduced-motion overrides must remain inside the Kiosk fusion presentation scope',
)

console.log('Fusion-Youth Kiosk foundation contract verified.')
