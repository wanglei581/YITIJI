import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const source = readFileSync(join(root, 'src/pages/scan/scanWorkbenchModel.ts'), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: 'scanWorkbenchModel.ts',
})
const dataUrl = `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
const model = await import(dataUrl)

test('parseScanStage accepts the workbench stages and rejects anything else', () => {
  assert.equal(model.parseScanStage('start'), 'start')
  assert.equal(model.parseScanStage('how'), 'how')
  assert.equal(model.parseScanStage('device-settings'), 'device-settings')
  assert.equal(model.parseScanStage('settings'), 'settings')
  assert.equal(model.parseScanStage('progress'), 'progress')
  assert.equal(model.parseScanStage('result'), 'result')
  assert.equal(model.parseScanStage('preview'), null)
  assert.equal(model.parseScanStage('off'), null)
  assert.equal(model.parseScanStage(null), null)
})

test('URL is intent but progress/result still need a real session', () => {
  assert.equal(
    model.resolveScanView({ requested: 'progress', storedStage: 'start', hasLiveSession: false, hasResult: false }),
    'start',
  )
  assert.equal(
    model.resolveScanView({ requested: 'result', storedStage: null, hasLiveSession: false, hasResult: false }),
    'start',
  )
  assert.equal(
    model.resolveScanView({ requested: 'progress', storedStage: 'start', hasLiveSession: true, hasResult: false }),
    'progress',
  )
  assert.equal(
    model.resolveScanView({ requested: 'result', storedStage: 'progress', hasLiveSession: true, hasResult: true }),
    'result',
  )
})

test('result without a snapshot but with a live session falls back to progress', () => {
  assert.equal(
    model.resolveScanView({ requested: 'result', storedStage: 'progress', hasLiveSession: true, hasResult: false }),
    'progress',
  )
})

test('missing stage rehydrates from stored stage, else start', () => {
  assert.equal(
    model.resolveScanView({ requested: null, storedStage: 'settings', hasLiveSession: false, hasResult: false }),
    'settings',
  )
  assert.equal(
    model.resolveScanView({ requested: null, storedStage: 'progress', hasLiveSession: true, hasResult: false }),
    'progress',
  )
  assert.equal(
    model.resolveScanView({ requested: null, storedStage: null, hasLiveSession: false, hasResult: false }),
    'start',
  )
})

test('progress and result still need a real handle to be authorized', () => {
  assert.equal(model.isScanStageAuthorized('start', false, false), true)
  assert.equal(model.isScanStageAuthorized('settings', false, false), true)
  assert.equal(model.isScanStageAuthorized('progress', false, false), false)
  assert.equal(model.isScanStageAuthorized('progress', true, false), true)
  assert.equal(model.isScanStageAuthorized('result', false, false), false)
  assert.equal(model.isScanStageAuthorized('result', false, true), true)
})

test('how and device-settings need this visit’s material, and a login mark only opens how', () => {
  assert.equal(model.isScanStageAuthorized('how', false, false, false), false)
  assert.equal(model.isScanStageAuthorized('device-settings', false, false, false), false)
  assert.equal(model.isScanStageAuthorized('how', false, false, true), true)
  assert.equal(model.isScanStageAuthorized('device-settings', false, false, true), true)
  assert.equal(model.isScanStageAuthorized('how', true, false, true), false)
  assert.equal(model.isScanStageAuthorized('device-settings', false, true, true), false)
  assert.equal(
    model.resolveScanView({
      requested: 'how', storedStage: null, hasLiveSession: false, hasResult: false,
      hasMaterialContext: false, hasHowContinue: true,
    }),
    'how',
  )
  assert.equal(
    model.resolveScanView({
      requested: 'device-settings', storedStage: null, hasLiveSession: false, hasResult: false,
      hasMaterialContext: false, hasHowContinue: true,
    }),
    'start',
  )
  assert.equal(
    model.resolveScanView({
      requested: 'device-settings', storedStage: null, hasLiveSession: false, hasResult: false,
      hasMaterialContext: true,
    }),
    'device-settings',
  )
  assert.equal(
    model.resolveScanView({
      requested: 'how', storedStage: null, hasLiveSession: false, hasResult: false,
    }),
    'start',
  )
})

test('device-more and device-make need a live screen-scan session', () => {
  assert.equal(model.parseScanStage('device-more'), 'device-more')
  assert.equal(model.parseScanStage('device-make'), 'device-make')
  assert.equal(model.isScanStageAuthorized('device-more', true, false, false, false), false)
  assert.equal(model.isScanStageAuthorized('device-make', false, false, false, true), false)
  assert.equal(model.isScanStageAuthorized('device-more', true, false, false, true), true)
  assert.equal(model.isScanStageAuthorized('device-make', true, false, false, true), true)
  assert.equal(model.isScanStageAuthorized('progress', true, false), true)
  assert.equal(
    model.resolveScanView({
      requested: 'device-more', storedStage: 'progress', hasLiveSession: true, hasResult: false,
      hasDeviceFlow: true,
    }),
    'device-more',
  )
  assert.equal(
    model.resolveScanView({
      requested: 'device-more', storedStage: 'progress', hasLiveSession: true, hasResult: false,
    }),
    'progress',
  )
})
