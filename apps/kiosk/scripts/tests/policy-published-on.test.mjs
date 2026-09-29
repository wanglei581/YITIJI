import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')
const source = read('src/pages/renshi/policyFacts.ts')
const output = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const module = { exports: {} }
new Function('exports', 'module', output)(module.exports, module)
const { policyPublishedOn } = module.exports

test('发布日期优先 publishedDate，空了才用确认发布时间', () => {
  assert.equal(policyPublishedOn({ publishedDate: '2026-08-01', publishConfirmedAt: '2026-09-29T01:17:00.000Z' }), '2026-08-01')
  assert.equal(policyPublishedOn({ publishedDate: '  2026-08-01  ', publishConfirmedAt: '2026-09-29T01:17:00.000Z' }), '2026-08-01')
  assert.equal(policyPublishedOn({ publishedDate: '', publishConfirmedAt: '2026-09-29T01:17:00.000Z' }), '2026-09-29')
  assert.equal(policyPublishedOn({ publishedDate: '   ', publishConfirmedAt: '2026-09-29T01:17:00.000Z' }), '2026-09-29')
  assert.equal(policyPublishedOn({ publishedDate: null, publishConfirmedAt: '2026-09-29T01:17:00.000Z' }), '2026-09-29')
  assert.equal(policyPublishedOn({ publishConfirmedAt: '2026-07-15T08:00:00+08:00' }), '2026-07-15')
})

test('两个日期都没有时不拿同步时间顶上', () => {
  assert.equal(policyPublishedOn({ publishedDate: undefined, publishConfirmedAt: null }), undefined)
  assert.equal(policyPublishedOn({}), undefined)
  assert.equal(policyPublishedOn({ publishConfirmedAt: '   ' }), undefined)
  assert.equal(source.includes('syncTime'), false)
})

test('政策库和公告都走同一个发布日期', () => {
  const shared = read('src/pages/renshi/shared.ts')
  const notice = read('src/pages/renshi/NoticePanel.tsx')
  assert.match(shared, /publishedDate: policyPublishedOn\(p\)/)
  assert.doesNotMatch(shared, /publishedDate: p\.publishedDate/)
  assert.match(notice, /publishedOn=\{policyPublishedOn\(notice\)\}/)
  assert.doesNotMatch(notice, /publishedOn=\{notice\.publishedDate\}/)
})
