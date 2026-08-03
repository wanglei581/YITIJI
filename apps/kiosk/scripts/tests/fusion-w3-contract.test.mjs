import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (path) => readFileSync(join(kioskRoot, path), 'utf8')

const W3_ROUTES = [
  '/resume', '/resume/upload', '/resume/source', '/resume/generate',
  '/resume/generate/preview', '/resume/parse', '/resume/report',
  '/resume/optimize', '/resume/export', '/resume/templates',
  '/resume/materials', '/resume/job-fit', '/resume/career-plan',
  '/assistant', '/interview/setup', '/interview/session',
  '/interview/report', '/interview/tips', '/interview/reports',
]

function extractDirectNavigateRedirects(sourceText) {
  const source = ts.createSourceFile('routes.tsx', sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let routerArray
  const visit = (node) => {
    if (
      ts.isCallExpression(node)
      && ts.isIdentifier(node.expression)
      && node.expression.text === 'createBrowserRouter'
      && ts.isArrayLiteralExpression(node.arguments[0])
    ) routerArray = node.arguments[0]
    ts.forEachChild(node, visit)
  }
  visit(source)
  assert.ok(routerArray, 'createBrowserRouter([...]) not found')

  const redirects = new Map()
  const inspect = (node) => {
    if (ts.isObjectLiteralExpression(node)) {
      let path
      let element
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property)) continue
        const name = property.name.getText(source)
        if (name === 'path' && ts.isStringLiteral(property.initializer)) path = property.initializer.text
        if (name === 'element') element = property.initializer
      }
      if (path && element && ts.isJsxSelfClosingElement(element)) {
        const tag = element.tagName.getText(source)
        const attributes = new Map(element.attributes.properties
          .filter(ts.isJsxAttribute)
          .map((attribute) => [attribute.name.getText(source), attribute.initializer]))
        const to = attributes.get('to')
        if (
          tag === 'Navigate'
          && attributes.has('replace')
          && to
          && ts.isStringLiteral(to)
        ) redirects.set(`/${path.replace(/^\//, '')}`, to.text)
      }
    }
    ts.forEachChild(node, inspect)
  }
  inspect(routerArray)
  return redirects
}

test('W3 owns exactly 19 normalized route patterns', () => {
  assert.equal(W3_ROUTES.length, 19)
  assert.equal(new Set(W3_ROUTES).size, 19)
  const manifest = read('tests/visual/route-manifest.ts')
  for (const route of W3_ROUTES) assert.match(manifest, new RegExp(`['\"]${route.replaceAll('/', '\\/')}['\"]`))
})

test('resume aliases stay redirects and prototype 73 stays a sub-state', () => {
  const redirects = extractDirectNavigateRedirects(read('src/routes/index.tsx'))
  assert.equal(redirects.get('/resume'), '/resume/source')
  assert.equal(redirects.get('/resume/upload'), '/resume/source')
  assert.equal(redirects.has('/assistant/call'), false)
  assert.equal(redirects.has('/interview/call'), false)
})

test('legacy job-fit verifier follows CSS imports fail closed', () => {
  const verifier = read('scripts/verify-job-fit-m1-5-ui.mjs')
  assert.match(verifier, /readLocalCssGraph/)
  assert.match(verifier, /CSS import cycle/)
  assert.match(verifier, /CSS import escapes kiosk root/)
  assert.match(verifier, /missing CSS import/)
  assert.match(verifier, /non-local CSS import/)
  assert.match(verifier, /unsupported CSS import syntax/)
  assert.match(verifier, /readLocalCssGraph\('src\/pages\/resume\/jobFit-inkpaper\.css'\)/)
})

test('W3 CSS scanner covers nested rules without treating keyframes as selectors', () => {
  const verifier = read('scripts/verify-fusion-w3.mjs')
  assert.match(verifier, /collectCssSelectors/)
  assert.match(verifier, /keyframeDepth/)
  assert.match(verifier, /selector has one owner/)
  assert.match(verifier, /job-fit selectors are fully scoped/)
  assert.match(verifier, /does not import a peer leaf/)
  assert.match(verifier, /CSS scanner ends with balanced braces and strings/)
})
