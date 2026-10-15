import 'reflect-metadata'
process.env['SCAN_TERMINAL_QUIET_PERIOD_SECONDS'] = '90'

import assert from 'node:assert/strict'
import { ConflictException } from '@nestjs/common'
import { ScanTasksService } from '../src/scan-tasks/scan-tasks.service'

type Row = { status: string; updatedAt: Date; expiresAt: Date }

async function expectQuiet(row: Row | null, terminalId = 't1', rowTerminalId = terminalId): Promise<unknown> {
  const service = Object.create(ScanTasksService.prototype) as ScanTasksService & { prisma: unknown }
  service.prisma = {
    scanTask: {
      findFirst: async ({ where }: { where: { terminalId: string } }) => where.terminalId === rowTerminalId ? row : null,
    },
  }
  try {
    await (service as unknown as { assertTerminalQuietPeriod: (id: string) => Promise<void> })
      .assertTerminalQuietPeriod(terminalId)
  } catch (error) {
    return error
  }
  return null
}

async function main(): Promise<void> {
  const now = Date.now()
  const cancelledRow = {
    status: 'cancelled',
    updatedAt: new Date(now - 10_000),
    expiresAt: new Date(now - 60_000),
  }
  const cancelled = await expectQuiet(cancelledRow)
  assert.ok(cancelled instanceof ConflictException)
  assert.equal((cancelled as ConflictException).getResponse().error.code, 'SCAN_TERMINAL_QUIET_PERIOD')
  assert.match(String((cancelled as ConflictException).getResponse().error.message), /等约 80 秒/)

  const expired = await expectQuiet({
    status: 'expired',
    updatedAt: new Date(now - 100_000),
    expiresAt: new Date(now - 1_000),
  })
  assert.equal(expired, null, '超过 90 秒后允许新会话')

  assert.equal(await expectQuiet({
    status: 'completed',
    updatedAt: new Date(now - 5_000),
    expiresAt: new Date(now - 5_000),
  }), null, 'completed 不触发静默期')
  assert.equal(await expectQuiet(cancelledRow, 'other-terminal', 't1'), null, '不同终端互不影响')
  console.log('PASS scan terminal quiet period verification')
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
