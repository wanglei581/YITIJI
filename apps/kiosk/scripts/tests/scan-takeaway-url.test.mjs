import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
const source = readFileSync(new URL('../../src/pages/scan/scanTakeawayUrl.ts', import.meta.url), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext } }).outputText
const { takeawayUrlOf } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)
const origin = 'https://kiosk.example.test'
const signature = 'a'.repeat(64)
const path = '/api/v1/files/scan-fixture/content'
const good = `${path}?expires=1900000000000&sig=${signature}`
test('scan content contract accepts relative and same-origin absolute signed links', () => {
  for (const value of [good, origin + good]) {
    assert.equal(takeawayUrlOf(value, origin)?.url, origin + good)
    assert.equal(takeawayUrlOf(value, origin)?.expiresAt, new Date(1900000000000).toISOString())
  }
  assert.equal(takeawayUrlOf(`${path}?expires=1&sig=${signature}`, origin)?.expiresAt, new Date(1).toISOString())
})
for (const value of [path, `${path}?sig=${signature}`, `${path}?expires=1900000000000`,
  ...['', 'NaN', 'Infinity', '1e100', '8640000000000001', '-1', '0'].map(n => `${path}?expires=${n}&sig=${signature}`),
  good + '&expires=1900000000001', good + '&sig=' + signature, good.replace(signature, 'bad'),
  'https://other.example.test' + good, 'javascript:alert(1)', 'http://[',
  good.replace(path, '/other/content'), good + '#fragment',
]) test(`reject unsafe or unsigned download URL: ${value.replace(signature, '[signature]')}`, () => {
  assert.equal(takeawayUrlOf(value, origin), null)
})
