/**
 * W-17：文字识别不可用时，材料检查可以确认按原件继续。
 * 不编造遮挡任务编号，预览授权认这份人工确认。
 */
import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const kioskRoot = join(dirname(fileURLToPath(import.meta.url)), '../..')
const toDataUrl = (code) => `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`

function transpile(absolutePath) {
  const out = ts.transpileModule(readFileSync(absolutePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
    fileName: absolutePath,
  }).outputText
  const leftover = [...out.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((match) => match[1])
  assert.deepEqual(leftover, [], `${absolutePath} 还有运行时依赖：${leftover.join(', ')}`)
  return toDataUrl(out)
}

const desk = await import(transpile(join(kioskRoot, 'src/pages/print/printDeskModel.ts')))
const file = { name: 'resume.pdf', size: '10 KB', pages: 2, fileId: 'file-1' }

test('人工确认按原件继续，不带遮挡任务编号，预览放行', () => {
  const check = desk.manualOriginalPrintCheck({
    inspectionTaskId: 'insp-1',
    piiTaskId: 'pii-1',
    findingCount: 0,
    acknowledgedAt: '2026-09-29T08:00:00.000Z',
  })
  assert.equal(check.mode, 'checked')
  assert.equal(check.redaction.claim, 'not_supported')
  assert.equal(check.redaction.unredactedAcknowledgedAt, '2026-09-29T08:00:00.000Z')
  assert.equal(check.redaction.redactedFileId, null)
  assert.equal('piiRedactTaskId' in check, false)
  assert.equal(desk.isPrintDeskPreviewAuthorized(check, file), true)
  assert.equal(desk.privacyPreviewGate(check, file).kind, 'ready')
})

test('没确认、也没有遮挡任务时，预览不放行', () => {
  const check = desk.manualOriginalPrintCheck({
    inspectionTaskId: 'insp-1',
    piiTaskId: 'pii-1',
    findingCount: 0,
    acknowledgedAt: '2026-09-29T08:00:00.000Z',
  })
  delete check.redaction.unredactedAcknowledgedAt
  assert.equal(desk.isPrintDeskPreviewAuthorized(check, file), false)

  const bare = {
    inspectionTaskId: 'insp-1',
    piiTaskId: 'pii-1',
    checkedAt: '2026-09-29T08:00:00.000Z',
    findingCount: 0,
    redactedCount: 0,
    keptCount: 0,
    mode: 'checked',
  }
  assert.equal(desk.isPrintDeskPreviewAuthorized(bare, file), false)
  assert.equal(desk.isPrintDeskPreviewAuthorized(undefined, file), false)
})

test('已经有遮挡任务的检查结论仍可进预览', () => {
  const check = {
    inspectionTaskId: 'insp-1',
    piiTaskId: 'pii-1',
    piiRedactTaskId: 'redact-1',
    checkedAt: '2026-09-29T08:00:00.000Z',
    findingCount: 0,
    redactedCount: 0,
    keptCount: 0,
    mode: 'checked',
    redaction: {
      claim: 'nothing_to_redact',
      redactedFileId: null,
      appliedRedactedCount: 0,
      failedNoPositionCount: 0,
      keptCount: 0,
      reverifyRemainingCount: null,
      reverifyRan: false,
    },
  }
  assert.equal(desk.isPrintDeskPreviewAuthorized(check, file), true)
})
