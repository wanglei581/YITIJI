import 'reflect-metadata'
import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants'
import {
  Module,
  RequestMethod,
  UnauthorizedException,
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { ReportScanDeletionAuditDto } from '../src/terminals/dto/report-scan-deletion-audit.dto'
import { ReleaseObservationService } from '../src/terminals/release-observation.service'
import { SCAN_DELETION_REASON_CODES as SHARED_REASON_CODES } from '../../../packages/shared/src/types/scanDeletionAudit'
import { SCAN_DELETION_REASON_CODES } from '../src/terminals/scan-deletion-reason-codes'
import { TerminalCapabilitiesService } from '../src/terminals/terminal-capabilities.service'
import { TerminalSessionService } from '../src/terminals/terminal-session.service'
import { TerminalToolboxService } from '../src/terminals/terminal-toolbox.service'
import { TerminalAgentService } from '../src/terminals/terminals-agent.service'
import { TerminalsController } from '../src/terminals/terminals.controller'
import { TerminalsService } from '../src/terminals/terminals.service'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

/**
 * 屏上扫描（2026-11-02）后端第二批：删除审计上报认的原因码。
 * 规格表照任务包写死，不从被测代码里取：面板扫描原有的一个码、屏上扫描六个码与复印七个码。
 * 云端和共享契约完全一致；终端 COPY_* 留待终端实现包，既有六码仍必须兼容。
 */
const SPEC_REASON_CODES = [
  'UNCLAIMED_TTL_EXPIRED',
  'SCAN_DEVICE_DELIVERED',
  'SCAN_DEVICE_FAILED',
  'SCAN_DEVICE_ABORTED',
  'SCAN_DEVICE_SWITCHED_TO_PANEL',
  'SCAN_DEVICE_SESSION_CLEARED',
  'SCAN_DEVICE_STARTUP_RESIDUE',
  'COPY_PRINT_TERMINAL',
  'COPY_RESCAN',
  'COPY_USER_CANCEL',
  'COPY_SESSION_CLEAR',
  'COPY_EXPIRED',
  'COPY_SCAN_FAILED',
  'COPY_STARTUP_RESIDUE',
] as const
/** 不认识的码：未登记的名字、大小写不对、空串、带空白、缺失、类型不对。 */
const UNKNOWN_REASON_CODES: readonly unknown[] = [
  'FOO',
  'unclaimed_ttl_expired',
  'scan_device_delivered',
  'Scan_Device_Delivered',
  '',
  ' UNCLAIMED_TTL_EXPIRED',
  'UNCLAIMED_TTL_EXPIRED ',
  'SCAN_DEVICE_UNKNOWN',
  'SCAN_DEVICE_',
  'UNCLAIMED',
  null,
  undefined,
  7,
  ['UNCLAIMED_TTL_EXPIRED'],
]
const eventIdFor = (tag: string): string => createHash('sha256').update(tag).digest('hex')

function responseCode(error: unknown): string | undefined {
  const response = (error as { getResponse?: () => unknown }).getResponse?.() as
    | { error?: { code?: string } }
    | undefined
  return response?.error?.code
}

async function main(): Promise<void> {
  assertIsolatedVerificationDatabase()
  assert.deepEqual(SCAN_DELETION_REASON_CODES, SHARED_REASON_CODES, '删除审计 API 与共享全码一致')

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
  let app: INestApplication | undefined

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

    // \u2500\u2500 \u5c4f\u4e0a\u626b\u63cf\uff08\u540e\u7aef\u7b2c\u4e8c\u6279 B2\uff09\uff1a\u539f\u56e0\u7801\u4ece 1 \u4e2a\u6269\u5230 7 \u4e2a \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    // \u4e0a\u9762\u7684\u65ad\u8a00\u4e00\u6761\u4e0d\u52a8\u3002\u8fd9\u4e00\u6bb5\u53ea\u52a0\uff1a\u4e03\u4e2a\u7801\u5404\u6536\u4e00\u6b21\u3001\u4e0d\u8ba4\u8bc6\u7684\u7801 400\u3001\u540c\u4e00 eventId \u6362\u539f\u56e0\u7801\u5224\u51b2\u7a81\u3002
    assert.deepEqual([...SCAN_DELETION_REASON_CODES], [...SPEC_REASON_CODES], '后端删除码必须逐项等于规格表')
    assert.equal(new Set(SCAN_DELETION_REASON_CODES).size, SPEC_REASON_CODES.length, '删除码互不重复')
    console.log(`  PASS 删除原因码常量 = 规格表 ${SPEC_REASON_CODES.length} 个（面板 + 屏上扫描 + 复印）`)

    const deviceEventBase = {
      identifierHash,
      createdAt: '2026-11-02T10:00:00.000Z',
      deletedAt: '2026-11-02T10:01:00.000Z' as string | null,
      result: 'deleted' as 'deleted' | 'pending_delete' | 'delete_failed',
      deleteAttempts: 1,
      lastDeleteAttemptAt: '2026-11-02T10:01:00.000Z',
      lastErrorCode: null as string | null,
    }

    // \u4e03\u4e2a\u7801\u5404\u6536\u4e00\u6b21\uff1a\u843d\u5e93\u7684 reasonCode \u5c31\u662f\u4e0a\u62a5\u7684\u90a3\u4e2a\u7801\uff1b\u539f\u6837\u91cd\u653e\u5e42\u7b49
    const rowsBefore = await prisma.terminalScanDeletionAudit.count({ where: { terminalId } })
    for (const code of SPEC_REASON_CODES) {
      const event = { ...deviceEventBase, eventId: eventIdFor(`service:${code}`), reasonCode: code }
      const ack = await agent.reportScanDeletionAudit(terminalId, event, `Bearer ${token}`)
      assert.deepEqual(ack, { acknowledged: true, eventId: event.eventId }, `${code} \u5e94\u88ab\u6536\u4e0b\u5e76\u786e\u8ba4`)
      const row = await prisma.terminalScanDeletionAudit.findUnique({
        where: { terminalId_eventId: { terminalId, eventId: event.eventId } },
      })
      assert.equal(row?.reasonCode, code, `${code}\uff1a\u5e93\u91cc\u7684 reasonCode \u5fc5\u987b\u5c31\u662f\u4e0a\u62a5\u7684\u7801`)
      assert.equal(row?.result, 'deleted')
      const replay = await agent.reportScanDeletionAudit(terminalId, event, `Bearer ${token}`)
      assert.deepEqual(replay, ack, `${code}\uff1a\u539f\u6837\u91cd\u653e\u4ecd\u5e42\u7b49\u786e\u8ba4`)
    }
    assert.equal(
      await prisma.terminalScanDeletionAudit.count({ where: { terminalId } }),
      rowsBefore + SPEC_REASON_CODES.length,
      '\u4e03\u4e2a\u7801\u5404\u4e00\u884c\uff0c\u91cd\u653e\u4e0d\u591a\u51fa\u884c',
    )
    console.log(`  PASS ${SPEC_REASON_CODES.length} 个原因码各收一次（落库码即上报码），原样重放幂等`)

    // \u5176\u4f59\u72b6\u6001\u673a\u5bf9\u65b0\u7801\u540c\u6837\u6210\u7acb\uff08pending_delete \u2192 delete_failed \u2192 deleted\uff1b\u72b6\u6001\u4e0d\u5f97\u56de\u9000\uff09
    {
      const code = 'SCAN_DEVICE_FAILED' as const
      const eventId = eventIdFor(`lifecycle:${code}`)
      const base = { ...deviceEventBase, eventId, reasonCode: code }
      await agent.reportScanDeletionAudit(
        terminalId,
        { ...base, deletedAt: null, result: 'pending_delete', deleteAttempts: 1, lastDeleteAttemptAt: '2026-11-02T10:00:10.000Z' },
        `Bearer ${token}`,
      )
      await agent.reportScanDeletionAudit(
        terminalId,
        { ...base, deletedAt: null, result: 'delete_failed', lastErrorCode: 'EBUSY', deleteAttempts: 2, lastDeleteAttemptAt: '2026-11-02T10:00:30.000Z' },
        `Bearer ${token}`,
      )
      await agent.reportScanDeletionAudit(terminalId, { ...base, deleteAttempts: 3 }, `Bearer ${token}`)
      const finalRow = await prisma.terminalScanDeletionAudit.findUnique({ where: { terminalId_eventId: { terminalId, eventId } } })
      assert.equal(finalRow?.result, 'deleted')
      assert.equal(finalRow?.reasonCode, code)
      await assert.rejects(
        agent.reportScanDeletionAudit(terminalId, { ...base, deletedAt: null, result: 'pending_delete', deleteAttempts: 4 }, `Bearer ${token}`),
        (error: unknown) => responseCode(error) === 'SCAN_DELETION_AUDIT_STATE_REGRESSION',
        '\u65b0\u7801\u7684\u5220\u9664\u72b6\u6001\u540c\u6837\u4e0d\u80fd\u56de\u9000',
      )
      console.log('  PASS \u65b0\u7801\u8d70\u540c\u4e00\u6761\u72b6\u6001\u673a\uff1apending_delete \u2192 delete_failed \u2192 deleted\uff0c\u56de\u9000\u88ab\u62d2')
    }

    // \u540c\u4e00 eventId \u6362\u539f\u56e0\u7801\u5224\u51b2\u7a81\uff08\u4e24\u4e2a\u65b9\u5411\uff09\uff1b\u88ab\u62d2\u540e\u5e93\u91cc\u539f\u6837
    for (const [first, second] of [
      ['UNCLAIMED_TTL_EXPIRED', 'SCAN_DEVICE_ABORTED'],
      ['SCAN_DEVICE_DELIVERED', 'UNCLAIMED_TTL_EXPIRED'],
      ['SCAN_DEVICE_ABORTED', 'SCAN_DEVICE_FAILED'],
    ] as const) {
      const eventId = eventIdFor(`rebind:${first}->${second}`)
      const pending = { ...deviceEventBase, eventId, deletedAt: null, result: 'pending_delete' as const }
      await agent.reportScanDeletionAudit(terminalId, { ...pending, reasonCode: first }, `Bearer ${token}`)
      await assert.rejects(
        agent.reportScanDeletionAudit(terminalId, { ...pending, reasonCode: second }, `Bearer ${token}`),
        (error: unknown) => responseCode(error) === 'SCAN_DELETION_AUDIT_EVENT_CONFLICT',
        `\u540c\u4e00 eventId \u5148\u62a5 ${first} \u518d\u6362\u6210 ${second} \u5fc5\u987b\u5224\u51b2\u7a81`,
      )
      const kept = await prisma.terminalScanDeletionAudit.findUnique({ where: { terminalId_eventId: { terminalId, eventId } } })
      assert.equal(kept?.reasonCode, first, `\u51b2\u7a81\u88ab\u62d2\u540e\u5e93\u91cc\u7684\u539f\u56e0\u7801\u4ecd\u662f ${first}`)
    }
    console.log('  PASS \u540c\u4e00 eventId \u6362\u539f\u56e0\u7801\u5224 SCAN_DELETION_AUDIT_EVENT_CONFLICT\uff08UNCLAIMED\u2192DEVICE\u3001DEVICE\u2192UNCLAIMED\u3001DEVICE\u2192DEVICE\uff09\uff0c\u5e93\u91cc\u4e0d\u53d8')

    // DTO \u5c42\uff08\u4e0e\u5168\u5c40 ValidationPipe \u540c\u4e00\u5957\u6821\u9a8c\uff09\uff1a\u4e03\u4e2a\u7801\u5408\u6cd5\uff1b\u4e0d\u8ba4\u8bc6\u7684\u7801\u4e00\u5f8b\u4e0d\u5408\u6cd5
    const dtoErrors = (reasonCode: unknown) =>
      validate(
        plainToInstance(ReportScanDeletionAuditDto, {
          ...deviceEventBase,
          eventId: eventIdFor('dto'),
          reasonCode,
        }),
        { whitelist: true, forbidNonWhitelisted: true },
      )
    for (const code of SPEC_REASON_CODES) {
      assert.equal((await dtoErrors(code)).length, 0, `DTO \u5e94\u63a5\u53d7 ${code}`)
    }
    for (const bad of UNKNOWN_REASON_CODES) {
      const errors = await dtoErrors(bad)
      assert.ok(
        errors.some((error) => error.property === 'reasonCode'),
        `DTO \u5e94\u62d2\u7edd reasonCode=${JSON.stringify(bad)}\uff08\u53d6\u503c\u8303\u56f4\u53ea\u80fd\u662f\u89c4\u683c\u8868\u90a3\u4e03\u4e2a\uff09`,
      )
    }
    console.log(`  PASS DTO：${SPEC_REASON_CODES.length} 个码合法；${UNKNOWN_REASON_CODES.length} 种未知输入一律拒绝`)

    // \u771f\u8def\u7531\uff1a\u5168\u5c40 ValidationPipe \u4e4b\u4e0b\uff0c\u65b0\u7801 200\u3001\u4e0d\u8ba4\u8bc6\u7684\u7801 400\uff08\u8bc1\u660e DTO \u771f\u7684\u6302\u5728\u8fd9\u6761\u8def\u7531\u4e0a\uff09
    {
      @Module({
        controllers: [TerminalsController],
        providers: [
          {
            provide: TerminalsService,
            useValue: {
              reportScanDeletionAudit: (id: string, dto: ReportScanDeletionAuditDto, auth: string | undefined) =>
                agent.reportScanDeletionAudit(id, dto, auth),
            },
          },
          // \u672c\u7ec4\u7528\u4f8b\u53ea\u8d70 scan-deletion-audits \u4e00\u6761\u8def\u7531\uff1b\u5176\u4f59\u4f9d\u8d56\u7ed9\u7a7a\u6869\uff0c\u53ea\u4e3a\u8ba9 Nest \u80fd\u6ce8\u518c\u6574\u4e2a\u63a7\u5236\u5668\u3002
          { provide: TerminalToolboxService, useValue: {} },
          { provide: TerminalCapabilitiesService, useValue: {} },
          { provide: ReleaseObservationService, useValue: {} },
          { provide: TerminalSessionService, useValue: {} },
        ],
      })
      class AuditProbeModule {}
      app = await NestFactory.create(AuditProbeModule, { logger: ['error'], abortOnError: false })
      app.setGlobalPrefix('api/v1')
      // \u4e0e main.ts \u540c\u4e00\u7ec4\u9009\u9879\uff1a\u767d\u540d\u5355 + \u7981\u6b62\u591a\u4f59\u5b57\u6bb5 + \u8f6c\u6362
      app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
      await app.listen(0, '127.0.0.1')
      const address = app.getHttpServer().address()
      assert.ok(address && typeof address !== 'string')
      const url = `http://127.0.0.1:${address.port}/api/v1/terminals/${terminalId}/scan-deletion-audits`
      const post = async (body: Record<string, unknown>, authorization = `Bearer ${token}`) => {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization },
          body: JSON.stringify(body),
        })
        return { status: res.status, json: (await res.json()) as Record<string, unknown> }
      }

      for (const code of SPEC_REASON_CODES) {
        const eventId = eventIdFor(`http:${code}`)
        const ok = await post({ ...deviceEventBase, eventId, reasonCode: code })
        assert.equal(ok.status, 200, `\u771f\u8def\u7531\uff1a${code} \u5e94 200\uff08\u5b9e\u9645 ${ok.status} ${JSON.stringify(ok.json)}\uff09`)
        assert.equal(ok.json['acknowledged'], true)
        assert.equal(ok.json['eventId'], eventId)
      }
      const httpBefore = await prisma.terminalScanDeletionAudit.count({ where: { terminalId } })
      for (const bad of UNKNOWN_REASON_CODES.filter((value) => value !== undefined)) {
        const refused = await post({ ...deviceEventBase, eventId: eventIdFor(`http-bad:${JSON.stringify(bad)}`), reasonCode: bad })
        assert.equal(refused.status, 400, `\u771f\u8def\u7531\uff1areasonCode=${JSON.stringify(bad)} \u5e94 400\uff08\u5b9e\u9645 ${refused.status}\uff09`)
      }
      const missing = await post({ ...deviceEventBase, eventId: eventIdFor('http-missing') })
      assert.equal(missing.status, 400, '\u771f\u8def\u7531\uff1a\u7f3a reasonCode \u5e94 400')
      const extra = await post({ ...deviceEventBase, eventId: eventIdFor('http-extra'), reasonCode: 'SCAN_DEVICE_DELIVERED', extra: 1 })
      assert.equal(extra.status, 400, '\u771f\u8def\u7531\uff1a\u591a\u4f59\u5b57\u6bb5\u4ecd 400\uff08\u5168\u5c40\u767d\u540d\u5355\uff09')
      assert.equal(
        await prisma.terminalScanDeletionAudit.count({ where: { terminalId } }),
        httpBefore,
        '\u88ab 400 \u62d2\u6389\u7684\u4e0a\u62a5\u4e00\u884c\u90fd\u4e0d\u80fd\u843d\u5e93',
      )
      const wrongToken = await post({ ...deviceEventBase, eventId: eventIdFor('http-token'), reasonCode: 'SCAN_DEVICE_DELIVERED' }, 'Bearer wrong-token')
      assert.equal(wrongToken.status, 401, '\u771f\u8def\u7531\uff1a\u7ec8\u7aef\u4ee4\u724c\u4e0d\u5bf9\u4ecd 401\uff0c\u65b0\u7801\u4e0d\u7ed5\u8fc7\u9274\u6743')
    console.log(`  PASS 真路由：${SPEC_REASON_CODES.length} 个码各 200；未知码、缺失、多余字段 400 且不落库；错令牌 401`)
    }

    console.log('verify-scan-deletion-audit-reporting: all assertions passed')
  } finally {
    if (app) await app.close().catch(() => undefined)
    await prisma.terminal.deleteMany({ where: { id: terminalId } })
    await prisma.onModuleDestroy()
  }
}

void main().catch((error) => {
  console.error(error)
  process.exit(1)
})
