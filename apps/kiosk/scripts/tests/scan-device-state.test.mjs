import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const source = readFileSync(join(root, 'src/pages/scan/scanDeviceState.ts'), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  fileName: 'scanDeviceState.ts',
})
const dataUrl = `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
const machine = await import(dataUrl)

function status(partial) {
  return {
    scanTaskId: 'task',
    status: 'waiting',
    scanType: 'document',
    file: null,
    errorCode: null,
    errorMessage: null,
    expiresAt: '2099-01-01T00:00:00.000Z',
    ...partial,
  }
}

const file = {
  fileId: 'file-1',
  filename: 'k1b2-feeder.pdf',
  sizeBytes: 180000,
  mimeType: 'application/pdf',
  sha256: 'abc',
  fileUrl: '/mock/k1b2-feeder.pdf',
}

function screen(partial) {
  return machine.selectDeviceScreen({
    cloudUnreadable: false,
    startConfirmed: true,
    localUncertain: null,
    ...partial,
  })
}

test('page counts only whole pages the cloud reports', () => {
  assert.equal(machine.reportedPageCount(0), null)
  assert.equal(machine.reportedPageCount(1.5), null)
  assert.equal(machine.reportedPageCount(null), null)
  assert.equal(machine.reportedPageCount(2), 2)
  assert.equal(machine.readDeviceMaxPages(status({})), null)
  assert.equal(machine.readDeviceMaxPages(status({ deviceMaxPages: 20 })), 20)
  assert.equal(machine.readDeviceMaxPages(status({ deviceMaxPages: 0 })), null)
})

test('scanning does not become success before the cloud says completed', () => {
  for (const deviceState of ['scanning', 'page_ready', 'composing', 'delivering']) {
    const picked = screen({
      status: status({
        deviceState,
        devicePageCount: 3,
        deviceSource: 'flatbed',
        file,
      }),
    })
    assert.notEqual(picked.kind, 'terminal')
  }
  const matched = screen({ status: status({ status: 'matched', devicePageCount: 3, file }) })
  assert.equal(matched.kind, 'make')
  assert.equal(matched.phase, 'delivering')
})

test('completed without a usable file is not success, and pages come only from devicePageCount', () => {
  const missing = screen({ status: status({ status: 'completed', devicePageCount: 3, file: null }) })
  assert.equal(missing.kind, 'terminal')
  assert.equal(missing.result.success, false)
  assert.equal(missing.result.outcome, 'completed-no-file')
  const done = screen({ status: status({ status: 'completed', devicePageCount: 3, file }) })
  assert.equal(done.result.success, true)
  assert.equal(done.result.pages, 3)
  const uncounted = screen({ status: status({ status: 'completed', devicePageCount: 0, file }) })
  assert.equal(uncounted.result.pages, null)
})

test('flatbed page_ready opens another page, feeder page_ready does not', () => {
  const flat = screen({
    status: status({ deviceState: 'page_ready', deviceSource: 'flatbed', devicePageCount: 2, deviceMaxPages: 20 }),
  })
  assert.equal(flat.kind, 'more')
  assert.equal(flat.pages, 2)
  assert.equal(flat.maxPages, 20)
  const feeder = screen({
    status: status({ deviceState: 'page_ready', deviceSource: 'feeder', devicePageCount: 2 }),
  })
  assert.equal(feeder.kind, 'unknown')
})

test('a lost next-page stays unknown until the cloud leaves page_ready', () => {
  assert.equal(machine.uncertaintyBlocks('next', 'page_ready'), true)
  assert.equal(machine.uncertaintyBlocks('start', 'scanning'), false)
  const blocked = screen({
    status: status({ deviceState: 'page_ready', deviceSource: 'flatbed', devicePageCount: 1 }),
    localUncertain: 'unknown',
    uncertainCommand: 'next',
  })
  assert.equal(blocked.kind, 'unknown')
  const moved = screen({
    status: status({ deviceState: 'scanning', devicePageCount: 1 }),
    localUncertain: 'unknown',
    uncertainCommand: 'next',
  })
  assert.equal(moved.kind, 'run')
})

test('known faults land on a failure, unknown codes stay unknown', () => {
  const jam = screen({ status: status({ deviceState: 'error', deviceErrorCode: 'paper_jam' }) })
  assert.equal(jam.kind, 'terminal')
  assert.equal(jam.result.success, false)
  assert.match(jam.result.reason, /卡纸/)
  const mystery = screen({ status: status({ deviceState: 'error', deviceErrorCode: 'unknown' }) })
  assert.equal(mystery.kind, 'unknown')
})

test('ready before the scanner reports start is not the scanning title', () => {
  const waiting = screen({
    status: status({ deviceState: 'ready', devicePageCount: 0 }),
    startConfirmed: true,
  })
  assert.deepEqual(waiting, { kind: 'run', pages: null, scannerStarted: false })
  const unconfirmed = screen({
    status: status({ deviceState: 'ready' }),
    startConfirmed: false,
  })
  assert.equal(unconfirmed.kind, 'unknown')
  const inflight = screen({
    status: status({ deviceState: 'ready' }),
    startConfirmed: false,
    startInFlight: true,
  })
  assert.deepEqual(inflight, { kind: 'run', pages: null, scannerStarted: false })
  const quiet = screen({
    status: status({ deviceState: 'scanning', devicePageCount: 0 }),
  })
  assert.equal(quiet.kind, 'run')
  assert.equal(quiet.pages, null)
  assert.equal(quiet.scannerStarted, true)
})
