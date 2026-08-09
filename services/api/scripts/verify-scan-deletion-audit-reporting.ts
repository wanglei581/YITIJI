import 'reflect-metadata'
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import { RequestMethod, UnauthorizedException } from '@nestjs/common'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { TerminalAgentService } from '../src/terminals/terminals-agent.service'
import { TerminalsController } from '../src/terminals/terminals.controller'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

function responseCode(error: unknown): string | undefined {
  const response = (error as { getResponse?: () => unknown }).getResponse?.() as
    | { error?: { code?: string } }
    | undefined
  return response?.error?.code
}

async function main(): Promise<void> {
  assertIsolatedVerificationDatabase()

  const handler = TerminalsController.prototype.reportScanDeletionAudit
  assert.equal(
    Reflect.getMetadata(PATH_METADATA, handler),
    'terminals/:terminalId/scan-deletion-audits',
    'controller must expose the authenticated scan deletion audit endpoint',
  )
  assert.equal(Reflect.getMetadata(METHOD_METADATA, handler), RequestMethod.POST)

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const agent = new TerminalAgentService(prisma, audit)
  const suffix = randomBytes(6).toString('hex')
  const terminalId = `t_scan_delete_audit_${suffix}`
  const token = `scan-delete-audit-token-${randomBytes(16).toString('hex')}`
  const eventId = 'a'.repeat(64)
  const identifierHash = 'b'.repeat(64)
  const createdAt = '2026-08-09T12:00:00.000Z'

  await prisma.terminal.create({
    data: {
      id: terminalId,
      terminalCode: `SCAN-DELETE-AUDIT-${suffix}`,
      agentToken: token,
      deviceFingerprint: `verify-scan-delete-audit-${suffix}`,
    },
  })

  try {
    const failedEvent = {
      eventId,
      reasonCode: 'UNCLAIMED_TTL_EXPIRED' as const,
      identifierHash,
      createdAt,
      deletedAt: null,
      result: 'delete_failed' as const,
      deleteAttempts: 1,
      lastDeleteAttemptAt: '2026-08-09T12:01:00.000Z',
      lastErrorCode: 'EACCES',
    }
    const firstAck = await agent.reportScanDeletionAudit(
      terminalId,
      failedEvent,
      `Bearer ${token}`,
    )
    assert.deepEqual(firstAck, { acknowledged: true, eventId })

    let rows = await prisma.terminalScanDeletionAudit.findMany({ where: { terminalId } })
    assert.equal(rows.length, 1, 'first report must persist exactly one server audit row')
    assert.equal(rows[0]?.result, 'delete_failed')
    assert.equal(rows[0]?.lastErrorCode, 'EACCES')

    const replayAck = await agent.reportScanDeletionAudit(
      terminalId,
      failedEvent,
      `Bearer ${token}`,
    )
    assert.deepEqual(replayAck, firstAck, 'an exact replay must be idempotently acknowledged')
    assert.equal(
      await prisma.terminalScanDeletionAudit.count({ where: { terminalId } }),
      1,
      'an exact replay must not create a second row',
    )

    await assert.rejects(
      agent.reportScanDeletionAudit(
        terminalId,
        {
          ...failedEvent,
          result: 'pending_delete',
          deleteAttempts: 2,
          lastDeleteAttemptAt: '2026-08-09T12:02:00.000Z',
          lastErrorCode: null,
        },
        `Bearer ${token}`,
      ),
      (error: unknown) => responseCode(error) === 'SCAN_DELETION_AUDIT_STATE_REGRESSION',
      'delete_failed must never regress to pending_delete',
    )
    await assert.rejects(
      agent.reportScanDeletionAudit(
        terminalId,
        {
          ...failedEvent,
          deleteAttempts: 2,
          lastDeleteAttemptAt: '2026-08-09T12:00:30.000Z',
        },
        `Bearer ${token}`,
      ),
      (error: unknown) => responseCode(error) === 'SCAN_DELETION_AUDIT_ATTEMPT_TIME_REGRESSION',
      'last delete attempt time must never regress',
    )

    const deletedAt = '2026-08-09T12:05:00.000Z'
    const deletedEvent = {
      ...failedEvent,
      result: 'deleted' as const,
      deletedAt,
      deleteAttempts: 2,
      lastDeleteAttemptAt: deletedAt,
      lastErrorCode: null,
    }
    const secondAck = await agent.reportScanDeletionAudit(
      terminalId,
      deletedEvent,
      `Bearer ${token}`,
    )
    assert.deepEqual(secondAck, { acknowledged: true, eventId })
    rows = await prisma.terminalScanDeletionAudit.findMany({ where: { terminalId } })
    assert.equal(rows.length, 1, 'same terminal/event must upsert idempotently')
    assert.equal(rows[0]?.result, 'deleted', 'delete_failed must evolve to deleted under the same event id')
    assert.equal(rows[0]?.deleteAttempts, 2)
    assert.equal(rows[0]?.deletedAt?.toISOString(), deletedAt)

    await assert.rejects(
      agent.reportScanDeletionAudit(
        terminalId,
        { ...deletedEvent, deleteAttempts: 1 },
        `Bearer ${token}`,
      ),
      (error: unknown) => responseCode(error) === 'SCAN_DELETION_AUDIT_ATTEMPTS_REGRESSION',
      'delete attempts must never regress',
    )

    await assert.rejects(
      agent.reportScanDeletionAudit(
        terminalId,
        { ...deletedEvent, identifierHash: 'c'.repeat(64) },
        `Bearer ${token}`,
      ),
      (error: unknown) => responseCode(error) === 'SCAN_DELETION_AUDIT_EVENT_CONFLICT',
      'same event id must not be rebound to a different identifier',
    )
    await assert.rejects(
      agent.reportScanDeletionAudit(terminalId, deletedEvent, 'Bearer wrong-token'),
      (error: unknown) => error instanceof UnauthorizedException,
      'wrong Agent token must not persist or acknowledge an event',
    )
    assert.equal(
      await prisma.terminalScanDeletionAudit.count({ where: { terminalId } }),
      1,
      'rejected reports must not create extra rows',
    )

    const serialized = JSON.stringify(rows[0])
    assert.doesNotMatch(serialized, /path|filename|content|exception|hmac.?key/i)
    assert.doesNotMatch(serialized, /\u5f20\u4e09|\u8eab\u4efd\u8bc1/)
    console.log('verify-scan-deletion-audit-reporting: all assertions passed')
  } finally {
    await prisma.terminal.deleteMany({ where: { id: terminalId } })
    await prisma.onModuleDestroy()
  }
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
