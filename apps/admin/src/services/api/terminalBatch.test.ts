import assert from 'node:assert/strict'
import test from 'node:test'
import { formatBindCodeCsv, type TerminalBatchIssuedCode } from './terminalBatch.ts'

function row(patch: Partial<TerminalBatchIssuedCode>): TerminalBatchIssuedCode {
  return {
    terminalId: 't1',
    terminalCode: 'KSK-001',
    displayName: '大厅甲',
    locationLabel: '一楼东',
    bindCode: 'AB12CD34EF56GH78JK90',
    expiresAt: '2026-11-17T00:00:00.000Z',
    ...patch,
  }
}

function cellsOf(csv: string): string[] {
  const body = csv.replace(/^\uFEFF/, '')
  const line = body.split('\r\n')[1] ?? ''
  return line.split(',')
}

test('以 = + - @ 开头的单元格加单引号，普通值不变', () => {
  const csv = formatBindCodeCsv([
    row({
      terminalCode: 'KSK-001',
      displayName: '=1+1',
      locationLabel: '+1',
      bindCode: '-2',
      expiresAt: '@SUM(1+1)',
    }),
  ])
  assert.ok(csv.startsWith('\uFEFF终端号,名称,点位,绑定码,到期时间\r\n'))
  assert.deepEqual(cellsOf(csv), ['KSK-001', "'=1+1", "'+1", "'-2", "'@SUM(1+1)"])

  const plain = formatBindCodeCsv([row({})])
  assert.deepEqual(cellsOf(plain), [
    'KSK-001',
    '大厅甲',
    '一楼东',
    'AB12CD34EF56GH78JK90',
    '2026-11-17T00:00:00.000Z',
  ])
})

test('制表符和回车开头同样加单引号，含逗号的公式先加引号再按 CSV 转义', () => {
  const tabbed = formatBindCodeCsv([row({ displayName: '\tcmd' })])
  assert.equal(cellsOf(tabbed)[1], "'\tcmd")

  const cr = formatBindCodeCsv([row({ locationLabel: '\r=1' })])
  assert.ok(cr.includes(`"'\r=1"`))

  const csv = formatBindCodeCsv([row({ displayName: '=1,2', locationLabel: '普通点位' })])
  assert.ok(csv.includes(`"'=1,2"`))
  assert.ok(csv.includes('普通点位'))
  assert.equal(csv.includes(',=1,2,'), false)
})
