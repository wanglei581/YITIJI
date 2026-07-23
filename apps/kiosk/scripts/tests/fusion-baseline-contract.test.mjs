import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  collectMissingLocalReferences,
  extractDeclaredRoutePatterns,
  extractManifestRoutePatterns,
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
    { path: '/login', element: <LoginPage /> },
    { path: '/', children: [
      { index: true, element: <HomePage /> },
      { path: 'jobs/:id', element: <JobPage /> },
    ] }
  `
  assert.deepEqual(extractDeclaredRoutePatterns(source), ['/', '/jobs/:id', '/login'])
})

test('extractManifestRoutePatterns reads the exported Playwright route array', () => {
  const source = `export const productionRoutePatterns = ['/', '/jobs/:id'] as const`
  assert.deepEqual(extractManifestRoutePatterns(source), ['/', '/jobs/:id'])
  assert.deepEqual(extractManifestRoutePatterns('export const other = []'), [])
})

test('collectMissingLocalReferences ignores external links and reports local misses', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fusion-links-'))
  await writeFile(join(root, 'ok.html'), '<a href="https://example.com">外部</a>')
  await writeFile(
    join(root, 'index.html'),
    '<a href="ok.html">正常</a><a href="/scan/start">应用路由</a>' +
      '<img src="missing.png"><img src="/missing-root.png"><a href="#top">锚点</a>',
  )
  assert.deepEqual(
    await collectMissingLocalReferences(join(root, 'index.html')),
    ['/missing-root.png', 'missing.png'],
  )
})

test('findForbiddenFusionReferences reports runtime imports of the docs baseline', async () => {
  const root = await mkdtemp(join(tmpdir(), 'fusion-imports-'))
  const src = join(root, 'apps/kiosk/src')
  await mkdir(src, { recursive: true })
  await writeFile(join(src, 'safe.ts'), "export const safe = true\n")
  assert.deepEqual(await findForbiddenFusionReferences(src), [])
  await writeFile(join(src, 'bad.ts'), "import '../../../docs/design/kiosk-proto-2026-07-fusion/index.html'\n")
  assert.deepEqual(await findForbiddenFusionReferences(src), ['bad.ts'])
})
