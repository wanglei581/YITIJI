import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import type { TerminalProvisionReport } from '../../services/api/terminalActivation.ts'
import {
  ACTIVATION_CODE_MESSAGES,
  checkKeyLabel,
  credentialExpiryTone,
  failedCheckLine,
  identityLabel,
  provisionSummaryLabel,
  reasonLabel,
} from './terminalProvisionViews.ts'

const NOW = new Date('2026-10-06T04:00:00.000Z')
const DAY = 86_400_000

const okReport: TerminalProvisionReport = {
  ok: true,
  failedKeys: [],
  failedChecks: [],
  reportedAt: '2026-10-06T02:00:00.000Z',
  agentVersion: '1.4.0',
}

test('未知原因码显示未归类（原码），已知码用后台显示', () => {
  assert.equal(reasonLabel('PRINTER_FOO'), '未归类（PRINTER_FOO）')
  assert.equal(reasonLabel('PRINTER_MULTIPLE_MATCH'), '匹配到多台打印机，需要人选')
  assert.equal(checkKeyLabel('not_a_check'), '未归类检查项（not_a_check）')
  assert.equal(
    failedCheckLine({ key: 'printer_ready', code: 'PRINTER_MULTIPLE_MATCH' }),
    '打印机：匹配到多台打印机，需要人选',
  )
  assert.equal(
    failedCheckLine({ key: 'printer_ready', code: 'PRINTER_FOO' }),
    '打印机：未归类（PRINTER_FOO）',
  )
})

test('自检摘要：通过、未回报、n 项未通过', () => {
  assert.equal(provisionSummaryLabel(okReport), '通过')
  assert.equal(provisionSummaryLabel(null), '未回报')
  assert.equal(provisionSummaryLabel(undefined), '未回报')
  assert.equal(provisionSummaryLabel({
    ...okReport,
    ok: false,
    failedKeys: ['printer_ready', 'api_reachable'],
    failedChecks: [
      { key: 'printer_ready', code: 'PRINTER_MULTIPLE_MATCH' },
      { key: 'api_reachable', code: 'PRINTER_FOO' },
    ],
  }), '2 项未通过')
  // 只有 failedKeys、没有 failedChecks（旧回报或字段缺失）也要数对，不能写成「0 项未通过」。
  assert.equal(provisionSummaryLabel({ ...okReport, ok: false, failedKeys: ['printer_ready'], failedChecks: [] }), '1 项未通过')
  assert.equal(provisionSummaryLabel({ ...okReport, ok: false, failedKeys: [], failedChecks: [] }), '未通过')
})

test('四种身份中文', () => {
  assert.equal(identityLabel('ok'), '正常')
  assert.equal(identityLabel('suspected_clone'), '疑似克隆')
  assert.equal(identityLabel('suspected_replacement'), '疑似换件')
  assert.equal(identityLabel('unknown'), '未上报')
  assert.equal(identityLabel(null), '未上报')
  assert.equal(identityLabel(undefined), '未上报')
})

test('令牌到期着色：过期红、59 天黄、61 天不着色', () => {
  assert.equal(credentialExpiryTone(new Date(NOW.getTime() - DAY).toISOString(), NOW), 'error')
  assert.equal(credentialExpiryTone(new Date(NOW.getTime() + 59 * DAY).toISOString(), NOW), 'warning')
  assert.equal(credentialExpiryTone(new Date(NOW.getTime() + 60 * DAY).toISOString(), NOW), 'warning')
  assert.equal(credentialExpiryTone(new Date(NOW.getTime() + 61 * DAY).toISOString(), NOW), 'none')
  assert.equal(credentialExpiryTone(null, NOW), 'none')
  assert.equal(credentialExpiryTone(NOW.toISOString(), NOW), 'error')
})

test('契约 §8 错误码逐字写进 userErrorMessage，不靠 import', () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../services/api/userErrorMessage.ts'),
    'utf8',
  )
  const codes = Object.entries(ACTIVATION_CODE_MESSAGES)
  assert.equal(codes.length, 15)
  for (const [code, text] of codes) {
    assert.ok(source.includes(`${code}: '${text}'`), `${code} 未按契约写进码表`)
  }
})
