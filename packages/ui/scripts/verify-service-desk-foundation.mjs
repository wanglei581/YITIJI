import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
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

function includesAll(source, fragments, label) {
  for (const fragment of fragments) {
    assert.ok(source.includes(fragment), `${label} must include ${fragment}`)
  }
}

const visualTheme = await read('src/theme/visualTheme.ts')
includesAll(visualTheme, [
  "export type VisualTheme = 'legacy' | 'service-desk'",
  "export type UiDensity = 'touch' | 'compact' | 'comfortable'",
  'export function getVisualThemeAttributes(',
  "'data-visual-theme': visualTheme",
  "'data-ux-density': density",
  '} as const',
], 'visualTheme.ts')

const kioskLayout = await read('src/layouts/KioskLayout.tsx')
includesAll(kioskLayout, [
  'visualTheme?: VisualTheme',
  'density?: UiDensity',
  "visualTheme = 'legacy'",
  "density = 'touch'",
  "'ui-kiosk-shell",
  'ui-kiosk-nav',
], 'KioskLayout')
assert.match(
  kioskLayout,
  /\{\.\.\.getVisualThemeAttributes\(visualTheme, density\)\}/,
  'KioskLayout root must spread the visual theme attributes',
)

const adminLayout = await read('src/layouts/AdminLayout.tsx')
includesAll(adminLayout, [
  'visualTheme?: VisualTheme',
  'density?: UiDensity',
  "visualTheme = 'legacy'",
  "density = 'compact'",
  "'ui-admin-shell",
  'ui-admin-sidebar',
  'ui-admin-topbar',
  'ui-admin-content',
], 'AdminLayout')
assert.match(
  adminLayout,
  /\{\.\.\.getVisualThemeAttributes\(visualTheme, density\)\}/,
  'AdminLayout root must spread the visual theme attributes',
)

const partnerLayout = await read('src/layouts/PartnerLayout.tsx')
includesAll(partnerLayout, [
  "visualTheme = 'legacy'",
  "density = 'comfortable'",
  '<AdminLayout',
  'visualTheme={visualTheme}',
  'density={density}',
], 'PartnerLayout')
assert.equal(
  /<(?:div|aside|main)[^>]+ui-partner-/.test(partnerLayout),
  false,
  'PartnerLayout must continue to reuse AdminLayout instead of copying a second shell',
)

const publicIndex = await read('src/index.ts')
includesAll(publicIndex, [
  "export { getVisualThemeAttributes } from './theme/visualTheme'",
  "export type { VisualTheme, UiDensity } from './theme/visualTheme'",
], 'packages/ui public index')

const css = await read('src/styles/service-desk.css')
assert.equal(
  /(^|[},]\s*)(?::root|html|body)(?:\s|[,{])/m.test(css),
  false,
  'service-desk.css must not contain unscoped :root, html, or body selectors',
)
includesAll(css, [
  "[data-visual-theme='service-desk'] {",
  '--sd-color-canvas-outer: #e9f1fb;',
  '--sd-color-canvas: #f7faff;',
  '--sd-color-surface: #ffffff;',
  '--sd-color-text-strong: #071a43;',
  '--sd-color-text: #17345d;',
  '--sd-color-copy: #566a84;',
  '--sd-color-copy-muted: #64748b;',
  '--sd-color-primary: #1769e8;',
  '--sd-color-primary-strong: #0758d7;',
  '--sd-color-line: #dce6f4;',
  '--sd-color-line-strong: #cbd9ed;',
  '--sd-category-blue-bg:',
  '--sd-category-blue-fg:',
  '--sd-category-mint-bg:',
  '--sd-category-mint-fg:',
  '--sd-category-orange-bg:',
  '--sd-category-orange-fg:',
  '--sd-category-lavender-bg:',
  '--sd-category-lavender-fg:',
  '--sd-category-cyan-bg:',
  '--sd-category-cyan-fg:',
  '--sd-category-sand-bg:',
  '--sd-category-sand-fg:',
  "[data-visual-theme='service-desk'][data-ux-density='touch']",
  "[data-visual-theme='service-desk'][data-ux-density='compact']",
  "[data-visual-theme='service-desk'][data-ux-density='comfortable']",
  ":focus-visible",
  '@media (prefers-reduced-motion: reduce)',
], 'service-desk.css')

for (const className of [
  'ui-kiosk-shell',
  'ui-kiosk-nav',
  'ui-admin-sidebar',
  'ui-admin-topbar',
  'ui-admin-content',
]) {
  assert.match(css, new RegExp(`\\.${className}\\s*\\{`), `${className} needs legacy defaults`)
  assert.match(
    css,
    new RegExp(`\\[data-visual-theme=['\"]service-desk['\"]\\][^{}]*\\.${className}\\s*\\{`),
    `${className} needs a scoped service-desk override`,
  )
}

for (const app of ['kiosk', 'admin', 'partner']) {
  const appCss = await read(`apps/${app}/src/index.css`, repoRoot)
  const legacyImport = appCss.search(/@import "@ai-job-print\/ui\/styles\/(?:fusion-youth|inkpaper)\.css";/)
  const serviceDeskImport = appCss.indexOf('@import "@ai-job-print/ui/styles/service-desk.css";')
  assert.ok(legacyImport >= 0, `${app} must retain its legacy theme import`)
  assert.ok(serviceDeskImport > legacyImport, `${app} must import service-desk.css after its legacy theme`)
}

console.log('SERVICE_DESK_FOUNDATION_VERIFY_OK')
