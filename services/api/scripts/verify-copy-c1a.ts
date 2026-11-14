import 'reflect-metadata'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { PrismaService, type PrismaTransactionClient } from '../src/prisma/prisma.service'
import { quoteCopy } from '../src/payment/copy-pricing'
import * as apiCopy from '../src/copy-jobs/copy-job.types'
import * as sharedCopy from '../../../packages/shared/src/types/copyJob'
import * as apiCapability from '../src/terminals/terminal-capabilities.types'
import * as sharedCapability from '../../../packages/shared/src/types/printScanCapability'
import { TerminalCapabilitiesService } from '../src/terminals/terminal-capabilities.service'
import { SCAN_DELETION_REASON_CODES } from '../src/terminals/scan-deletion-reason-codes'
import { SCAN_DELETION_REASON_CODES as sharedReasons } from '../../../packages/shared/src/types/scanDeletionAudit'
import { ReportScanDeletionAuditDto } from '../src/terminals/dto/report-scan-deletion-audit.dto'
import { MemberPrintOrdersService } from '../src/member-print-orders/member-print-orders.service'
import { MemberPrintOrderCreateService } from '../src/member-print-orders/member-print-order-create.service'
import { MemberOrderTimelineService } from '../src/member-print-orders/member-order-timeline.service'
import { PackageOrderService } from '../src/member-print-orders/package-order.service'
import { AdminOrdersReadonlyService } from '../src/admin-orders-readonly/admin-orders-readonly.service'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

const root = resolve(__dirname, '../../..')
const read = (path: string) => readFileSync(resolve(root, path), 'utf8')
const pass = (message: string) => console.log(`PASS ${message}`)
const copyCodes = [
  'COPY_PRINT_TERMINAL', 'COPY_RESCAN', 'COPY_USER_CANCEL', 'COPY_SESSION_CLEAR',
  'COPY_EXPIRED', 'COPY_SCAN_FAILED', 'COPY_STARTUP_RESIDUE',
]

function verifyModel() {
  const fields = [
    'id', 'terminalId', 'organizationId', 'endUserId', 'state', 'source', 'pageCount', 'copies',
    'colorMode', 'duplex', 'billableSides', 'quoteSnapshot', 'orderId', 'order', 'requestKey',
    'generation', 'authorizationVersion', 'resultCode', 'createdAt', 'updatedAt', 'expiresAt',
  ].sort()
  for (const schema of ['prisma/schema.prisma', 'prisma/postgres/schema.prisma']) {
    const source = read(`services/api/${schema}`)
    const body = /model CopyJob \{([\s\S]*?)\n\}/.exec(source)?.[1]
    assert.ok(body, schema)
    assert.deepEqual([...body.matchAll(/^\s{2}(\w+)\s+\w/gm)].map((m) => m[1]).sort(), fields)
    assert.doesNotMatch(body, /file|image|pdf|path|hash|token|content|preview|ocr/i)
    assert.match(body, /orderId\s+String\?\s+@unique/)
    assert.match(body, /@@unique\(\[terminalId, requestKey\]\)/)
    assert.match(body, /onDelete: Restrict/)
    assert.match(source, /copyJob\s+CopyJob\?/)
  }
  assert.deepEqual(apiCopy, sharedCopy)
  assert.equal(read('services/api/src/copy-jobs/copy-job.types.ts').split('\n').slice(1).join('\n'),
    read('packages/shared/src/types/copyJob.ts'))
  for (const base of ['prisma/migrations', 'prisma/postgres/migrations']) {
    assert.match(read(`services/api/${base}/20261104160000_add_copy_job/migration.sql`), /CREATE TABLE "CopyJob"/)
  }
  pass('CopyJob 双 schema 字段白名单、无文件字段、唯一关联及共享契约')
}

const QUOTE_TERMINAL = 'copy-c1a-quote'

/**
 * 复印报价只读本机生效价。桩提供总开关和这台终端的配置价，不再读 PriceConfig。
 * 没有价目行 = 0。向用户收费时非法单价不可报价。不带终端一律 0（到机补价由 P2 做）。
 */
function quoteDb(fixture: {
  found?: boolean
  personalChargeEnabled?: boolean
  userChargeMode?: 'user_pays' | 'org_pays'
  prices?: Partial<Record<'print_bw_page' | 'print_color_page', number>>
}): Pick<PrismaTransactionClient, 'terminal' | 'platformSetting'> {
  const found = fixture.found !== false
  const enabled = fixture.personalChargeEnabled !== false
  return {
    platformSetting: {
      findUnique: async () => (enabled ? { value: 'true' } : null),
    },
    terminal: {
      findUnique: async (args: { where: { id?: string; terminalCode?: string } }) => {
        const ref = args.where.id ?? args.where.terminalCode
        if (!found || ref !== QUOTE_TERMINAL) return null
        const prices = fixture.prices ?? {}
        return {
          id: QUOTE_TERMINAL,
          userChargeMode: fixture.userChargeMode ?? 'user_pays',
          org: null,
          servicePrices: Object.entries(prices).map(([serviceKey, unitCents]) => ({ serviceKey, unitCents })),
        }
      },
    },
  } as unknown as Pick<PrismaTransactionClient, 'terminal' | 'platformSetting'>
}

async function verifyQuote() {
  const paying = quoteDb({ prices: { print_bw_page: 0, print_color_page: 7 } })
  const input: apiCopy.CopyPriceInput & { terminalId?: string } = {
    pageCount: 3, copies: 2, colorMode: 'black_white', duplex: 'simplex', terminalId: QUOTE_TERMINAL,
  }
  const free = await quoteCopy(input, paying)
  assert.ok(free.quotable)
  assert.equal(free.quote.amountCents, 0)
  assert.equal(free.quote.billableSides, 6)
  assert.equal(free.quote.serviceKey, 'print_bw_page')
  for (const duplex of apiCopy.COPY_DUPLEX_MODES) {
    const result = await quoteCopy({ ...input, colorMode: 'color', duplex }, paying)
    assert.ok(result.quotable)
    assert.equal(result.quote.amountCents, 42, '颜色、份数和双面不减半')
    assert.equal(result.quote.billableSides, 6)
  }
  const noTerminal = await quoteCopy({ ...input, terminalId: undefined }, paying)
  assert.ok(noTerminal.quotable)
  assert.equal(noTerminal.quote.amountCents, 0, '不带终端一律 0，到机补价由 P2 做')
  const missingBw = await quoteCopy(input, quoteDb({ prices: { print_color_page: 7 } }))
  assert.ok(missingBw.quotable)
  assert.equal(missingBw.quote.amountCents, 0, '缺本机黑白价 = 0，不用彩色价兜底')
  const onlyOther = await quoteCopy({ ...input, colorMode: 'color' }, quoteDb({ prices: { print_bw_page: 0 } }))
  assert.ok(onlyOther.quotable)
  assert.equal(onlyOther.quote.amountCents, 0, '不能把另一种颜色价当缺价兜底')
  for (const unitCents of [-1, 0.5, NaN, Infinity]) {
    const bad = await quoteCopy(input, quoteDb({ prices: { print_bw_page: unitCents } }))
    assert.equal(bad.quotable, false)
    if (!bad.quotable) assert.equal(bad.code, 'COPY_PRICE_INVALID')
  }
  for (const patch of [{ pageCount: 0 }, { copies: 0 }, { copies: 1.5 }, { pageCount: Number.MAX_SAFE_INTEGER }]) {
    assert.equal((await quoteCopy({ ...input, ...patch }, paying)).quotable, false)
  }
  pass('报价：取本机同色打印生效价，0 元、颜色、份数、双面不减半；缺行与不带终端按 0；异常价拒绝')
}

async function verifyCapabilities(prisma: PrismaService, terminalId: string) {
  const input = { colorMode: 'color', duplex: 'duplex_long_edge' } as const
  const keys = ['copy', 'scan_device', 'color_print', 'duplex_print']
  for (const contract of [apiCapability, sharedCapability]) {
    assert.ok(contract.DEFAULT_DENY_CAPABILITY_KEYS.includes('copy'))
    assert.deepEqual(contract.evaluateCopyCapabilities(input, []).deniedKeys, keys)
    const rows = keys.map((capabilityKey) => ({ capabilityKey, status: 'available' }))
    assert.equal(contract.evaluateCopyCapabilities(input, rows).allowed, true)
    for (const key of keys) {
      for (const status of ['testing', 'maintenance', 'unsupported', 'not_verified', 'disabled']) {
        assert.equal(contract.evaluateCopyCapabilities(input, rows.map((r) => r.capabilityKey === key ? { ...r, status } : r)).allowed, false)
      }
      assert.equal(contract.evaluateCopyCapabilities(input, rows.filter((r) => r.capabilityKey !== key)).allowed, false)
    }
    assert.equal(contract.evaluateCopyCapabilities(input, rows.map((r) => ({ ...r, configured: false }))).allowed, false)
    assert.equal(contract.evaluateCopyCapabilities({ colorMode: 'black_white', duplex: 'simplex' }, rows.slice(0, 2)).allowed, true)
  }
  const service = new TerminalCapabilitiesService(prisma)
  await assert.rejects(service.assertUserTaskAllowed(terminalId, 'copy'), 'copy 缺行必须拒绝')
  pass('copy 双端默认拒绝；建单/确认判定要求各项显式 available')
}

async function verifyDeletion() {
  assert.deepEqual(SCAN_DELETION_REASON_CODES, sharedReasons)
  assert.deepEqual(SCAN_DELETION_REASON_CODES.filter((code) => code.startsWith('COPY_')), copyCodes)
  const terminal = read('apps/terminal-agent/src/agent/scan-device/scan-temp-dir.ts')
  // 终端程序 A2（#1584）把删除码从联合类型改成常量数组 SCAN_DEVICE_DELETION_REASONS；两种写法都认，
  // 只取声明那一段里的字面量，不扫全文件（文件里别处也会引用这些码）。
  const declaration = terminal.match(/export const SCAN_DEVICE_DELETION_REASONS = \[([\s\S]*?)\] as const/)?.[1]
    ?? terminal.match(/export type ScanDeviceDeletionReason =((?:\s*\| '[A-Z_]+')+)/)?.[1] ?? ''
  const legacyCodes = [...new Set([...declaration.matchAll(/'(SCAN_DEVICE_[A-Z_]+)'/g)].map((m) => m[1]))]
  assert.equal(legacyCodes.length, 6, '保留终端已支持的六个屏上扫描删除码')
  for (const code of legacyCodes) assert.ok((SCAN_DELETION_REASON_CODES as readonly string[]).includes(code))
  for (const reasonCode of [...copyCodes, 'COPY_UNKNOWN', 'copy_expired']) {
    const dto = plainToInstance(ReportScanDeletionAuditDto, {
      eventId: 'a'.repeat(64), identifierHash: 'b'.repeat(64), reasonCode,
      createdAt: '2026-11-04T12:00:00.000Z', lastDeleteAttemptAt: '2026-11-04T12:01:00.000Z',
      result: 'pending_delete', deleteAttempts: 1,
    })
    assert.equal((await validate(dto)).length === 0, copyCodes.includes(reasonCode), reasonCode)
  }
  pass('删除审计：API/共享全码一致，DTO 新码可收，旧终端码仍兼容（终端 COPY 待下包）')
}

/** 只使用列表/详情依赖的 prisma，其余写接口的依赖不参与本门禁。 */
function readService<T>(prototype: T, prisma: PrismaService): T {
  return Object.assign(Object.create(prototype as object), { prisma }) as T
}

async function verifyOrders(prisma: PrismaService, suffix: string) {
  const user = `copy-user-${suffix}`
  const cloud = readService(MemberPrintOrderCreateService.prototype, prisma)
  const packages = readService(PackageOrderService.prototype, prisma)
  const member = new MemberPrintOrdersService(prisma)
  const timeline = readService(MemberOrderTimelineService.prototype, prisma)
  Object.assign(timeline, { cloudOrders: cloud, packages })
  const page = { cursor: null, pageSize: 20 }
  const ids: string[] = []
  await prisma.endUser.create({ data: { id: user, phoneHash: user, phoneEnc: user, enabled: true, status: 'active' } })
  try {
    // 真的复印单，以及带旧文件/任务/材料包数据的 copy 反例，均不可从用户接口泄漏。
    for (let index = 0; index < 3; index++) {
      const order = await prisma.order.create({ data: {
        orderNo: `COPY-${suffix}-${index}`, type: 'copy', endUserId: user,
        ...(index === 1 ? { sourceFileId: 'must-not-leak', sourceFileName: 'must-not-leak.pdf' } : {}),
        ...(index === 2 ? { orderItems: { create: { seq: 1, fileId: 'must-not-leak', copies: 1,
          colorMode: 'black_white', duplex: 'simplex', billablePages: 1, amountCents: 0 } } } : {}),
      } })
      ids.push(order.id)
      await prisma.copyJob.create({ data: { terminalId: suffix, organizationId: suffix, endUserId: user,
        source: 'flatbed', requestKey: `key-${index}`, orderId: order.id, expiresAt: new Date(Date.now() + 60_000) } })
      await assert.rejects(cloud.detail(user, order.id), (e: unknown) => (e as { getStatus(): number }).getStatus() === 404)
      await assert.rejects(packages.detail(user, order.id), (e: unknown) => (e as { getStatus(): number }).getStatus() === 404)
    }
    assert.deepEqual(await cloud.listCloud(user), [])
    assert.equal((await packages.list(user, page)).total, 0)
    assert.equal((await member.list(user, page)).total, 0)
    const query = { cursor: null, pageSize: 20, kind: 'all' as const, status: 'all' as const }
    const result = await timeline.list(user, query, null)
    assert.deepEqual(result.items, [])
    // PrintTask 查询也显式排除 type=copy，不能靠「目前不会关联」侥幸隐藏。
    await prisma.printTask.create({ data: { id: `copy-task-${suffix}`, endUserId: user,
      fileUrl: 'must-not-leak', fileMd5: 'must-not-leak', status: 'pending' } })
    await prisma.order.update({ where: { id: ids[0] }, data: { printTaskId: `copy-task-${suffix}` } })
    assert.equal((await member.list(user, page)).total, 0)
    assert.deepEqual(await member.listPending(user), [])
    assert.deepEqual((await timeline.list(user, query, null)).items, [])
    const admin = new AdminOrdersReadonlyService(prisma)
    const adminList = await admin.list({ type: 'copy', search: suffix, page: 1, pageSize: 20 })
    assert.equal(adminList.items.length, 3)
    for (const item of adminList.items) {
      assert.equal(item.type, 'copy')
      assert.equal(item.typeLabel, '复印')
      assert.equal(item.printFileName, null)
      const detail = await admin.getById(item.id)
      assert.equal(detail.print, null)
      assert.equal(detail.printTaskId, null)
      assert.doesNotMatch(JSON.stringify(detail), /must-not-leak|fileUrl|downloadUrl|https?:\/\//)
    }
    await assert.rejects(prisma.copyJob.create({ data: { terminalId: suffix, organizationId: suffix,
      source: 'feeder', requestKey: 'key-0', expiresAt: new Date() } }), /Unique constraint/)
    await assert.rejects(prisma.copyJob.create({ data: { terminalId: `${suffix}-other`, organizationId: suffix,
      source: 'feeder', requestKey: 'other', orderId: ids[0], expiresAt: new Date() } }), /Unique constraint/)
    await assert.rejects(prisma.order.delete({ where: { id: ids[0] } }), /Foreign key constraint/)
    pass('用户订单列表/时间线/详情过滤复印；后台标复印且无文件；数据库唯一与关联约束')
  } finally {
    await prisma.copyJob.deleteMany({ where: { terminalId: suffix } })
    await prisma.order.deleteMany({ where: { id: { in: ids } } })
    await prisma.printTask.deleteMany({ where: { id: `copy-task-${suffix}` } })
    await prisma.endUser.delete({ where: { id: user } })
  }
}

async function main() {
  assertIsolatedVerificationDatabase()
  verifyModel()
  await verifyQuote()
  await verifyDeletion()
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const suffix = randomUUID()
  try {
    await verifyCapabilities(prisma, suffix)
    await verifyOrders(prisma, suffix)
  } finally { await prisma.onModuleDestroy() }
  console.log('PASS verify-copy-c1a')
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1 })
