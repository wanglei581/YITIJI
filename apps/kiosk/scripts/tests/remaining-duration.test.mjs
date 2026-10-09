import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const source = readFileSync(join(root, 'src/pages/scan/scanSettingsModel.ts'), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: 'scanSettingsModel.ts',
})
const dataUrl = `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
const model = await import(dataUrl)

test('remaining time over one hour is about N hours, not an unbounded minute count', () => {
  assert.equal(model.formatRemainingDuration(3600), '约 1 小时')
  assert.equal(model.formatRemainingDuration(3660), '约 1 小时')
  assert.equal(model.formatRemainingDuration(2 * 3600), '约 2 小时')
  assert.equal(model.formatRemainingDuration(73 * 3600), '约 73 小时')
})

test('remaining time under one hour is N minutes', () => {
  assert.equal(model.formatRemainingDuration(1), '1 分钟')
  assert.equal(model.formatRemainingDuration(60), '1 分钟')
  assert.equal(model.formatRemainingDuration(90), '2 分钟')
  assert.equal(model.formatRemainingDuration(10 * 60), '10 分钟')
  assert.equal(model.formatRemainingDuration(3599), '60 分钟')
})

test('remaining time of zero stays zero minutes', () => {
  assert.equal(model.formatRemainingDuration(0), '0 分钟')
})

test('negative or non-finite remaining time stays zero minutes', () => {
  assert.equal(model.formatRemainingDuration(-1), '0 分钟')
  assert.equal(model.formatRemainingDuration(-3600), '0 分钟')
  assert.equal(model.formatRemainingDuration(Number.NaN), '0 分钟')
  assert.equal(model.formatRemainingDuration(Number.POSITIVE_INFINITY), '0 分钟')
})

test('formatCountdown uses the same bound for a past or invalid expiry', () => {
  assert.equal(model.formatCountdown('2000-01-01T00:00:00.000Z'), '0 分钟')
  assert.equal(model.formatCountdown('not-a-date'), '0 分钟')
  const soon = new Date(Date.now() + 90_000).toISOString()
  assert.equal(model.formatCountdown(soon), '2 分钟')
  const later = new Date(Date.now() + 2 * 3600_000 + 20_000).toISOString()
  assert.equal(model.formatCountdown(later), '约 2 小时')
})
