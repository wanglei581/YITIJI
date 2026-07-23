import assert from 'node:assert/strict'
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  collectMissingLocalReferences,
  extractDeclaredRedirects,
  extractDeclaredRoutePatterns,
  extractManifestRedirects,
  extractManifestRoutePatterns,
  findSensitivePrototypeInputValues,
  findForbiddenFusionReferences,
  sha256File,
} from '../lib/fusion-baseline-contract.mjs'

test('sha256File returns the SHA-256 digest for exact bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fusion-contract-'))
  const file = join(root, 'fixture.txt')
  await writeFile(file, '8177 + 5299\n')
  assert.equal(
    await sha256File(file),
    'fc61ff0437feebdfe021c1f6c812247038268fd36ceee85a976fc80a0b7c36ad',
  )
})

test('extractDeclaredRoutePatterns normalizes absolute and nested route strings', () => {
  const source = `
    const routes = [
      // { path: '/commented', element: <CommentedPage /> },
      { path : '/login', element: <LoginPage /> },
      { path: '/', children: [
        { index: true, element: <HomePage /> },
        { path: 'jobs/:id', element: <JobPage /> },
        { path: 'jobs/:id', element: <DuplicateJobPage /> },
      ] },
    ]
  `
  assert.deepEqual(extractDeclaredRoutePatterns(source), ['/', '/jobs/:id', '/jobs/:id', '/login'])
})

test('extractManifestRoutePatterns reads the exported Playwright route array', () => {
  const source = `export const productionRoutePatterns = ['/', '/jobs/:id'] as const`
  assert.deepEqual(extractManifestRoutePatterns(source), ['/', '/jobs/:id'])
  assert.deepEqual(extractManifestRoutePatterns('export const other = []'), [])
})

test('extractDeclaredRedirects reads five literal Navigate redirects from router objects', () => {
  const source = `
    const routes = createBrowserRouter([{
      path: '/',
      children: [
        // { path: 'commented', element: <Navigate to="/wrong" replace /> },
        { path: 'print/scan-convert', element: <Navigate to="/print-scan/convert" replace /> },
        { path: 'print/scan-sign', element: <Navigate to='/print-scan/sign' replace /> },
        { path: 'print/scan-feature', element: <Navigate to="/print-scan/feature/id-photo" replace /> },
        { path: 'resume', element: <Navigate to="/resume/source" replace /> },
        { path: '/resume/upload', element: <Navigate to="/resume/source" replace /> },
        { path: 'ordinary', element: <OrdinaryPage /> },
        { path: 'dynamic-target', element: <Navigate to={redirectTarget} replace /> },
        { path: 'push-navigation', element: <Navigate to="/wrong" /> },
        { path: 'different-component', element: <Redirect to="/wrong" replace /> },
      ],
    }])
  `

  assert.deepEqual(extractDeclaredRedirects(source), {
    '/print/scan-convert': '/print-scan/convert',
    '/print/scan-feature': '/print-scan/feature/id-photo',
    '/print/scan-sign': '/print-scan/sign',
    '/resume': '/resume/source',
    '/resume/upload': '/resume/source',
  })
  assert.throws(
    () => extractDeclaredRedirects(`
      const routes = [
        { path: 'resume', element: <Navigate to="/resume/source" replace /> },
        { path: '/resume', element: <Navigate to="/resume/duplicate" replace /> },
      ]
    `),
    /duplicate redirect source: \/resume/,
  )
})

test('extractManifestRedirects reads the exported map and exposes target mismatches', () => {
  const source = `
    const compatibilityRedirects = { '/ignored': '/not-exported' } as const
    export const compatibilityRedirects = {
      '/resume/upload' : '/resume/source',
      "/print/scan-sign": "/print-scan/sign-v2",
      '/print/scan-convert': '/print-scan/convert',
      '/print/scan-feature': '/print-scan/feature/id-photo',
      '/resume': '/resume/source',
      [dynamicSource]: '/ignored',
    } as const
  `
  const manifestRedirects = extractManifestRedirects(source)
  const routerRedirects = {
    '/print/scan-convert': '/print-scan/convert',
    '/print/scan-feature': '/print-scan/feature/id-photo',
    '/print/scan-sign': '/print-scan/sign',
    '/resume': '/resume/source',
    '/resume/upload': '/resume/source',
  }

  assert.deepEqual(manifestRedirects, {
    '/print/scan-convert': '/print-scan/convert',
    '/print/scan-feature': '/print-scan/feature/id-photo',
    '/print/scan-sign': '/print-scan/sign-v2',
    '/resume': '/resume/source',
    '/resume/upload': '/resume/source',
  })
  assert.deepEqual(
    Object.keys(routerRedirects)
      .filter((sourcePath) => routerRedirects[sourcePath] !== manifestRedirects[sourcePath])
      .map((sourcePath) => ({
        source: sourcePath,
        expected: manifestRedirects[sourcePath],
        actual: routerRedirects[sourcePath],
      })),
    [{
      source: '/print/scan-sign',
      expected: '/print-scan/sign-v2',
      actual: '/print-scan/sign',
    }],
  )
  assert.throws(
    () => extractManifestRedirects(`
      export const compatibilityRedirects = {
        '/resume': '/resume/source',
        '/resume': '/resume/duplicate',
      } as const
    `),
    /duplicate redirect source: \/resume/,
  )
})

test('collectMissingLocalReferences ignores external links and reports local misses', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fusion-links-'))
  await mkdir(join(root, 'assets'))
  await writeFile(join(root, 'ok.html'), '<a href="https://example.com">外部</a>')
  await writeFile(join(root, 'assets/ok.png'), '')
  await writeFile(
    join(root, 'index.html'),
    '<a href="ok.html">正常</a><a href="/scan/start">应用路由</a>' +
      '<img src="missing.png"><img src = "/assets/missing-root.png">' +
      '<img src="/assets/ok.png"><link href="/assets/missing.css">' +
      '<img data-src="ghost.png"><img src="//cdn.example.com/logo.png">' +
      '<a href="#top">锚点</a>',
  )
  assert.deepEqual(
    await collectMissingLocalReferences(join(root, 'index.html')),
    ['/assets/missing-root.png', '/assets/missing.css', 'missing.png'].sort(),
  )
})

test('findSensitivePrototypeInputValues reports only safe labels for complete credentials', () => {
  const sensitiveValues = [
    '13955550101',
    '139 5555 0101',
    '139-5555-0101',
    '654321',
  ]
  const html = sensitiveValues.map((value) => `<input type="text" value="${value}">`).join('')

  const issues = findSensitivePrototypeInputValues(html)

  assert.deepEqual(issues, [
    'complete-mainland-mobile-number-input-value',
    'complete-mainland-mobile-number-input-value',
    'complete-mainland-mobile-number-input-value',
    'complete-six-digit-code-input-value',
  ])
  for (const issue of issues) {
    for (const value of sensitiveValues) assert.equal(issue.includes(value), false)
  }
})

test('findSensitivePrototypeInputValues normalizes spaces and hyphens in six-digit codes', () => {
  assert.deepEqual(
    findSensitivePrototypeInputValues(
      '<input value="6 5 4 3 2 1"><input value="654-321"><input value="已脱敏">',
    ),
    [
      'complete-six-digit-code-input-value',
      'complete-six-digit-code-input-value',
    ],
  )
})

test('findSensitivePrototypeInputValues ignores non-value attributes and ordinary text', () => {
  assert.deepEqual(
    findSensitivePrototypeInputValues(
      '<input placeholder="139 5555 0101" data-value="654321">' +
        '<div value="139-5555-0101">654321</div>',
    ),
    [],
  )
})

test('findForbiddenFusionReferences reports runtime imports of the docs baseline', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fusion-imports-'))
  const src = join(root, 'apps/kiosk/src')
  await mkdir(src, { recursive: true })
  await writeFile(join(src, 'safe.ts'), "export const safe = true\n")
  assert.deepEqual(await findForbiddenFusionReferences(src), [])
  const outside = join(root, 'outside.ts')
  await writeFile(outside, "import './docs/design/kiosk-proto-2026-07-fusion/index.html'\n")
  let symlinkCreated = true
  try {
    await symlink(outside, join(src, 'linked.ts'))
  } catch (error) {
    if (!['EACCES', 'ENOSYS', 'EPERM'].includes(error.code)) throw error
    symlinkCreated = false
  }
  if (symlinkCreated) assert.deepEqual(await findForbiddenFusionReferences(src), [])
  await writeFile(join(src, 'bad.ts'), "import '../../../docs/design/kiosk-proto-2026-07-fusion/index.html'\n")
  assert.deepEqual(await findForbiddenFusionReferences(src), ['bad.ts'])
})
