import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const verifier = join(kioskRoot, 'scripts', 'verify-fusion-w6.mjs')
const sections = [
  '86/86 routes',
  'wave ownership',
  'single main landmark',
  'compliance copy',
  'mobile routes',
  'package scripts',
  'CI wiring',
]

test('W6 verifier reports every integration contract section', () => {
  const result = spawnSync(process.execPath, [verifier], {
    cwd: kioskRoot,
    encoding: 'utf8',
    env: process.env,
  })
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`

  for (const section of sections) {
    assert.match(output, new RegExp(`^(?:PASS|FAIL) ${section}(?:$|:)`, 'm'), `missing section: ${section}`)
  }

  if (process.env.EXPECT_W6_RED === '1') {
    assert.notEqual(result.status, 0, 'W6 verifier must remain RED before Task 4/5 integration wiring')
    for (const pending of ['single main landmark', 'package scripts', 'CI wiring']) {
      assert.match(output, new RegExp(`^FAIL ${pending}(?:$|:)`, 'm'), `${pending} must explain the staged RED state`)
    }
    return
  }

  assert.equal(result.status, 0, output)
  for (const section of sections) assert.match(output, new RegExp(`^PASS ${section}$`, 'm'))
})
