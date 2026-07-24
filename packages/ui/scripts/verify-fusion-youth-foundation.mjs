import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const packageRootUrl = new URL('../', import.meta.url)

async function read(relativePath) {
  try {
    return await readFile(new URL(relativePath, packageRootUrl), 'utf8')
  } catch (error) {
    throw new Error(`Required Kiosk fusion foundation file is missing or unreadable: ${relativePath}`, {
      cause: error,
    })
  }
}

function codeView(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

function extractFunctionBody(source, name) {
  source = codeView(source)
  const start = source.search(new RegExp(`(?:export\\s+)?function\\s+${name}\\b`))
  assert.ok(start >= 0, `${name} must be an exported function`)
  const parameters = source.indexOf('(', start)
  const parametersEnd = findMatching(source, parameters, '(', ')')
  const opening = source.indexOf('{', parametersEnd)
  const closing = findMatching(source, opening, '{', '}')
  assert.ok(closing > opening, `${name} must have a balanced function body`)
  return source.slice(opening + 1, closing)
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
  const body = codeView(extractFunctionBody(source, component))
  for (const [label, pattern] of [
    ['fetch', /\bfetch\s*\(/],
    ['useNavigate', /\buseNavigate\b/],
    ['useLocation', /\buseLocation\b/],
  ]) {
    assert.doesNotMatch(body, pattern, `${component} must not use ${label}`)
  }
  const imports = [...source.matchAll(/(?:\bfrom\s*|\bimport\s*(?:\(\s*)?)['"]([^'"]+)['"]/g)]
  for (const [, importSource] of imports) {
    assert.equal(
      /(?:^|\/)(?:apps|services)(?:\/|$)/i.test(importSource)
        || (/^\.\.?\//.test(importSource) && /(?:^|\/)(?:stores?|hooks?)(?:\/|$)/i.test(importSource)),
      false,
      `${component} must not import app-owned services or business store/hook modules: ${importSource}`,
    )
  }
}

function assertKioskPresentationAttributes(source) {
  const match = /export\s+function\s+getKioskPresentationAttributes\s*\(\s*presentation\s*:\s*KioskPresentation\s*,\s*viewport\s*:\s*KioskViewport\s*,?\s*\)\s*\{([\s\S]*?)\n\}/.exec(source)
  assert.ok(match, 'getKioskPresentationAttributes must have the frozen typed signature')
  assert.match(match[1], /return\s*\{[\s\S]*?['"]data-kiosk-presentation['"]\s*:\s*presentation\b/)
  assert.match(match[1], /return\s*\{[\s\S]*?['"]data-kiosk-viewport['"]\s*:\s*viewport\b/)
}
function assertStatePanelLiveRegions(source) {
  source = codeView(source)
  const componentBody = extractFunctionBody(source, 'KioskStatePanel')
  const map = /const\s+(\w+)\s*(?::[^=]+)?=\s*\{([\s\S]*?)\n\}/g
  const candidate = [...source.matchAll(map)].find((entry) =>
    ['loading', 'success', 'empty', 'error', 'offline', 'permission'].every((tone) =>
      new RegExp(`\\b${tone}\\s*:`).test(entry[2]),
    ),
  )
  assert.ok(candidate, 'KioskStatePanel must define one six-tone live-region mapping')
  assert.ok(candidate.index < source.indexOf('export function KioskStatePanel'), 'tone mapping must be module-level')
  for (const [tones, role, live] of [
    [['loading', 'success', 'empty'], 'status', 'polite'],
    [['error', 'offline', 'permission'], 'alert', 'assertive'],
  ]) {
    for (const tone of tones) {
      assert.match(candidate[2], new RegExp(`\\b${tone}\\s*:\\s*\\{(?=[^}]*role\\s*:\\s*['"]${role}['"])(?=[^}]*ariaLive\\s*:\\s*['"]${live}['"])[^}]*\\}`))
    }
  }
  assert.match(source, new RegExp(`const\\s+(\\w+)\\s*=\\s*${candidate[1]}\\s*\\[\\s*tone\\s*\\]`))
  const liveRegionName = new RegExp(`const\\s+(\\w+)\\s*=\\s*${candidate[1]}\\s*\\[\\s*tone\\s*\\]`).exec(source)[1]
  assert.match(componentBody, new RegExp(`role\\s*=\\s*\\{\\s*${liveRegionName}\\.role\\s*\\}`))
  assert.match(componentBody, new RegExp(`aria-live\\s*=\\s*\\{\\s*${liveRegionName}\\.ariaLive\\s*\\}`))
  const iconMap = [...source.matchAll(map)].find((entry) =>
    ['loading', 'success', 'empty', 'error', 'offline', 'permission'].every((tone) =>
      new RegExp(`\\b${tone}\\s*:\\s*[A-Z]\\w*`).test(entry[2]),
    ),
  )
  assert.ok(iconMap, 'KioskStatePanel must define a module-level default icon for every tone')
  assert.match(componentBody, /icon\s*\?\?\s*\w+|\w+\s*\?\?\s*icon/, 'consumer icon must override the default')
}
function assertModalBehavior(source) {
  source = codeView(extractFunctionBody(source, 'KioskModal'))
  const handlerBody = (name) => new RegExp(`(?:const\\s+${name}\\s*=\\s*\\([^)]*\\)\\s*=>|function\\s+${name}\\s*\\([^)]*\\))\\s*\\{([\\s\\S]*?)\\n\\s*\\}`).exec(source)?.[1]
  const keydown = /addEventListener\s*\(\s*['"]keydown['"]\s*,\s*(\w+)/.exec(source)?.[1]
  assert.match(source, /addEventListener\s*\(\s*['"]keydown['"]/, 'KioskModal must register keydown')
  assert.ok(keydown, 'KioskModal keydown listener must be a stable local reference')
  const keyBody = handlerBody(keydown) ?? ''
  assert.match(keyBody || source, /closeOnEscape[\s\S]*(?:Escape|code)[\s\S]*onClose\s*\(\)/)
  const backdropStart = source.indexOf('ui-kiosk-modal-backdrop')
  const backdropName = /onClick\s*=\s*\{\s*(\w+)\s*\}/.exec(source.slice(backdropStart))?.[1]
  const backdropBody = handlerBody(backdropName) ?? (backdropStart >= 0 ? source.slice(backdropStart) : '')
  assert.match(backdropBody, /onClick\s*=\s*\{[\s\S]*closeOnBackdrop[\s\S]*onClose/)
  const cleanup = /return\s*\(\s*\)\s*=>\s*\{([\s\S]*?)\n\s*\}/.exec(source)?.[1]
  assert.ok(cleanup, 'KioskModal effect must return cleanup')
  assert.match(cleanup, new RegExp(`removeEventListener\\s*\\(\\s*['"]keydown['"]\\s*,\\s*${keydown}`))
  const overflow = /const\s+(\w+)\s*=\s*document\.body\.style\.overflow/.exec(source)?.[1]
  const focused = /const\s+(\w+)\s*=\s*document\.activeElement/.exec(source)?.[1]
  assert.ok(overflow && focused, 'KioskModal must capture overflow and prior focus')
  assert.match(cleanup, new RegExp(`document\\.body\\.style\\.overflow\\s*=\\s*${overflow}\\b`))
  assert.match(cleanup, new RegExp(`${focused}[^;\n]*\\.focus\\s*\\(`))
  assert.match(source, /document\.body\.style\.overflow\s*=\s*['"]hidden['"]/)
  const dialogRef = /ref\s*=\s*\{\s*(\w+)\s*\}/.exec(source)?.[1]
  assert.ok(dialogRef && new RegExp(`${dialogRef}\\.current(?:\\?\\.)?\\.focus\\s*\\(`).test(source), 'open dialog must receive focus')
  const baseId = /const\s+(\w+)\s*=\s*useId\s*\(\s*\)/.exec(source)?.[1]
  assert.ok(baseId, 'KioskModal must derive stable IDs with useId')
  const titleId = /const\s+(\w+)\s*=\s*`[^`]*\$\{(\w+)\}[^`]*`/.exec(source)
  const idVariables = new Set([baseId])
  for (const match of source.matchAll(/const\s+(\w+)\s*=\s*`[^`]*\$\{(\w+)\}[^`]*`/g)) {
    if (match[2] === baseId) idVariables.add(match[1])
  }
  assert.ok(titleId, 'KioskModal must derive labelled IDs from useId')
  for (const attribute of ['aria-labelledby', 'aria-describedby']) {
    const value = new RegExp(`${attribute}\\s*=\\s*\\{([^}]*)\\}`).exec(source)?.[1] ?? ''
    const id = [...idVariables].find((name) => new RegExp(`\\b${name}\\b`).test(value))
    assert.ok(id, `${attribute} must bind a useId-derived value`)
    assert.match(source, new RegExp(`id\\s*=\\s*\\{\\s*${id}\\s*\\}`), `${attribute} must target a rendered node id`)
  }
  assert.match(source, /if\s*\(\s*!open\s*\)[\s\S]*?return\s+null/)
}

function extractCssSelectors(source) {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, '')
  const selectors = []; let preludeStart = 0; let depth = 0; let quote = ''

  for (let index = 0; index < css.length; index += 1) {
    const char = css[index]
    if (quote) { if (char === quote && css[index - 1] !== '\\') quote = ''; continue }
    if (char === '"' || char === "'") { quote = char; continue }
    if (char === '{') {
      const prelude = css.slice(preludeStart, index).trim()
      if (prelude && !prelude.startsWith('@') && depth <= 1) selectors.push(prelude)
      depth += 1
      preludeStart = index + 1
    } else if (char === '}') {
      depth = Math.max(0, depth - 1)
      preludeStart = index + 1
    }
  }
  return selectors.flatMap(splitSelectorList)
}
function splitSelectorList(value) {
  const parts = []; let start = 0; let depth = 0; let quote = ''
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]
    if (quote) { if (char === quote && value[index - 1] !== '\\') quote = ''; continue }
    if (char === '"' || char === "'") quote = char
    else if (char === '(' || char === '[') depth += 1
    else if (char === ')' || char === ']') depth -= 1
    else if (char === ',' && depth === 0) { parts.push(value.slice(start, index).trim()); start = index + 1 }
  }
  parts.push(value.slice(start).trim()); return parts.filter(Boolean)
}
function extractCssRule(source, selectorPattern, label) {
  const match = new RegExp(`${selectorPattern}\\s*\\{([^{}]*)\\}`, 'm').exec(source)
  assert.ok(match, `fusion-youth.css must define ${label}`)
  return match[1]
}
function findMatching(source, start, open, close) {
  let depth = 0; let quote = ''
  for (let index = start; index < source.length; index += 1) {
    const char = source[index]
    if (quote) { if (char === quote && source[index - 1] !== '\\') quote = ''; continue }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue }
    if (char === open) depth += 1
    else if (char === close && --depth === 0) return index
  }
  return -1
}
function extractAtRuleBlocks(source, atRulePattern, label) {
  const blocks = []
  for (const match of source.matchAll(new RegExp(atRulePattern, 'g'))) {
    const openingBrace = source.indexOf('{', match.index)
    assert.ok(openingBrace >= 0, `${label} must open a block`)
    const closingBrace = findMatching(source, openingBrace, '{', '}')
    assert.ok(closingBrace >= 0, `${label} must close its block`)
    blocks.push(source.slice(openingBrace + 1, closingBrace))
  }
  return blocks
}
function assertReducedMotionContract(source) {
  const blocks = extractAtRuleBlocks(
    source,
    String.raw`@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{`,
    'prefers-reduced-motion: reduce',
  )
  assert.ok(blocks.length > 0, 'fusion-youth.css must define reduced-motion overrides')
  const scopedBlocks = blocks.filter((block) =>
    /\[data-kiosk-presentation=(['"])fusion-youth\1\]/.test(block),
  )
  assert.ok(scopedBlocks.length > 0, 'reduced-motion overrides must be Kiosk fusion scoped')

  const declarations = scopedBlocks.join('\n')
  const animationDisabled = /\banimation(?:-duration)?\s*:\s*(?:none|0(?:\.0+)?m?s)\b/i.test(declarations)
  const transitionDisabled = /\btransition(?:-duration)?\s*:\s*(?:none|0(?:\.0+)?m?s)\b/i.test(declarations)
  assert.ok(animationDisabled, 'reduced-motion rules must disable animations with none or zero duration')
  assert.ok(transitionDisabled, 'reduced-motion rules must disable transitions with none or zero duration')
  assert.doesNotMatch(
    declarations,
    /\b(?:display\s*:\s*none|visibility\s*:\s*hidden|content-visibility\s*:\s*hidden|opacity\s*:\s*0\b|clip(?:-path)?\s*:|(?:width|height|max-width|max-height)\s*:\s*0\b)/i,
    'reduced-motion rules must not hide content',
  )
}

const packageJson = JSON.parse(await read('package.json'))
assert.equal(
  packageJson.scripts?.['verify:fusion-youth-foundation'],
  'node scripts/verify-fusion-youth-foundation.mjs',
  'package.json must expose the exact verify:fusion-youth-foundation command',
)

const theme = codeView(await read('src/theme/visualTheme.ts'))
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
assertKioskPresentationAttributes(theme)

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
  const source = codeView(await read(`src/components/${component}.tsx`))
  componentSources.set(component, source)
  assertExactInterface(source, `${component}Props`, props)
  assert.match(source, new RegExp(`export\\s+function\\s+${component}\\b`), `${component} must be exported`)
  assertPresentationOnly(component, source)
}

const pageFrame = componentSources.get('KioskPageFrame')
assert.match(pageFrame, /<section\b/, 'KioskPageFrame must render a semantic section')
assert.match(pageFrame, /data-kiosk-component\s*=\s*['"]page-frame['"]/)
assertIncludes(pageFrame, ['ui-kiosk-page-frame'], 'KioskPageFrame')
assert.match(pageFrame, /header[\s\S]*children[\s\S]*footer/, 'KioskPageFrame must preserve header, children, footer order')

const pageHeader = componentSources.get('KioskPageHeader')
assertIncludes(pageHeader, ['ui-kiosk-page-header', 'ui-kiosk-back-button'], 'KioskPageHeader')
assert.match(pageHeader, /<button\b/, 'KioskPageHeader back control must be a native button')
assert.match(
  pageHeader,
  /\{\s*onBack\s*(?:&&|\?)[\s\S]*?<button\b/,
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
assertStatePanelLiveRegions(statePanel)
assert.match(statePanel, /aria-busy\s*=\s*\{[^}]*tone\s*===\s*['"]loading['"]/)
assert.match(statePanel, /data-tone\s*=\s*\{tone\}/)

const modal = componentSources.get('KioskModal')
const modalBody = codeView(extractFunctionBody(modal, 'KioskModal'))
assertIncludes(
  modalBody,
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
assert.match(modalBody, /closeOnBackdrop\s*=\s*true/)
assert.match(modalBody, /closeOnEscape\s*=\s*true/)
assert.match(modalBody, /tabIndex\s*=\s*\{\s*-1\s*\}/)
assert.match(modalBody, /role\s*=\s*['"]dialog['"]/)
assert.match(modalBody, /aria-modal\s*=\s*['"]true['"]/)
assert.match(modalBody, /aria-label\s*=\s*\{closeLabel\}/)
assertModalBehavior(modal)

const publicIndex = codeView(await read('src/index.ts'))
for (const component of Object.keys(componentContracts)) {
  assert.match(
    publicIndex,
    new RegExp(`export\\s*\\{[^}]*\\b${component}\\b[^}]*\\}`),
    `public index must export ${component}`,
  )
  assert.match(
    publicIndex,
    new RegExp(`export\\s+(?:type\\s*)?\\{[^}]*\\b(?:type\\s+)?${component}Props\\b[^}]*\\}`),
    `public index must export ${component}Props`,
  )
}
for (const typeName of ['KioskStateTone', 'KioskPresentation', 'KioskViewport']) {
  assert.match(publicIndex, new RegExp(`export\\s+(?:type\\s*)?\\{[^}]*\\b(?:type\\s+)?${typeName}\\b[^}]*\\}`))
}
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
assert.match(css, /max-width\s*:\s*1080px/)
assert.match(css, /padding\s*:\s*34px\s+48px\s+26px/)
assert.match(css, /min-(?:width|height)\s*:\s*72px/)
assert.match(css, /padding\s*:\s*26px\s+48px\s+34px/)
assert.match(css, /border-radius\s*:\s*(?:14px|18px)/)
assert.match(css, /border-radius\s*:\s*14px/)
assert.match(css, /border-radius\s*:\s*18px/)
assert.match(css, /\.ui-kiosk-modal-close(?=[^}]*min-width\s*:\s*56px)(?=[^}]*min-height\s*:\s*56px)[^}]*\}/)

const selectors = extractCssSelectors(css)
const isPresentationScoped = (selector) =>
  /^\[data-kiosk-presentation=(['"])fusion-youth\1\]/.test(selector)
const kioskSelectors = selectors.filter(
  (selector) => selector.includes('.ui-kiosk-') || selector.includes('data-kiosk-presentation='),
)
assert.ok(kioskSelectors.length > 1, 'fusion-youth.css must define scoped Kiosk component rules')
assert.doesNotMatch(css, /@keyframes\b/, 'fusion-youth.css must not add keyframes outside the frozen motion contract')
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
assertReducedMotionContract(css)

console.log('Fusion-Youth Kiosk foundation contract verified.')
