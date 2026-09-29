/**
 * verify:member-order-timeline — 跨端订单时间线 + 会员本机领取（主执行窗口交付单 v1）。
 *
 * 覆盖：
 *   A. 静态接线：timeline 声明在 :orderId 之前；claim-here 挂 TerminalIdentityGuard + 限流、不挂维护拦截；
 *      shared 与 API 两份展示状态取值一致；异常过滤器只为 PICKUP_TERMINAL_MISMATCH 透传网点三字段。
 *   B. 展示状态派生纯函数：每个分支、每个取值至少一例；过滤桶与派生桶一致（纯函数层）。
 *   C. 真实库：三来源（一体机任务 / 手机单件未到机 / 材料包）交错时间 + 同毫秒并列，逐页翻完不重不漏、
 *      严格倒序；total 与 status/kind 过滤一致；waiting ∪ printing ∪ done = all 且互不相交；
 *      材料包子任务不出现在 kiosk_task；序列化后的整页 JSON 不含任何到机码明文；
 *      pickupCode 与旧 /me/print-orders 逐字段同口径；claimableHere 五个条件逐一反例、终端验签失败为 false。
 *   D. claim-here：本人+本机成功、幂等（不重复派发）、他人 404、异机 409 带网点且锁机计数不变、
 *      退款（pending/claimed 两种）/ 过期 / 已用 / 文件失效各拒，且每一种都与到机码入口 claim 同一错误码。
 *
 * 写库：必须 VERIFICATION_DATABASE_TARGET=isolated；SQLite 缺表时按迁移建表。Redis 用进程内替身。
 */
import 'dotenv/config'
import { execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'

const apiRoot = path.resolve(__dirname, '..')
const repoRoot = path.resolve(apiRoot, '..', '..')
let fallbackDbPath: string | null = null
if (!process.env.DATABASE_URL) {
  const name = `verify-member-order-timeline-${randomUUID().slice(0, 8)}.db`
  fallbackDbPath = path.join(apiRoot, 'prisma', name)
  process.env.DATABASE_URL = `file:./prisma/${name}`
}
process.env.NODE_ENV = 'test'
process.env.FILE_STORAGE_DRIVER = 'local'
process.env.FILE_STORAGE_DIR = process.env.FILE_STORAGE_DIR || path.join(apiRoot, '.verify-member-order-timeline-files')
process.env.FILE_SIGNING_SECRET = process.env.FILE_SIGNING_SECRET || 'verify-file-signing-secret-0123456789abcdef'
process.env.PAYMENT_SESSION_SECRET = process.env.PAYMENT_SESSION_SECRET || 'verify-payment-session-secret-0123456789abcdef'
process.env.SECRET_ENCRYPTION_KEY = process.env.SECRET_ENCRYPTION_KEY || 'verify-secret-encryption-key-0123456789abcdef'
process.env.JWT_SECRET = process.env.JWT_SECRET || 'verify-jwt-secret-0123456789abcdef'

import { ArgumentsHost, ConflictException } from '@nestjs/common'
import { AuditService } from '../src/audit/audit.service'
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter'
import type { RedisService } from '../src/common/redis/redis.service'
import { MemberOrderClaimHereService } from '../src/member-print-orders/member-order-claim-here.service'
import {
  deriveOrderDisplayStatus,
  deriveTaskDisplayStatus,
  hasUsableArrivalCode,
  isClaimableHere,
  timelineStatusBucket,
  type ClaimableOrder,
} from '../src/member-print-orders/member-order-timeline.status'
import {
  MemberOrderTimelineService,
  decodeTimelineCursor,
  encodeTimelineCursor,
  parseTimelineQuery,
} from '../src/member-print-orders/member-order-timeline.service'
import { MemberPrintOrderCreateService } from '../src/member-print-orders/member-print-order-create.service'
import { MemberPrintOrdersService } from '../src/member-print-orders/member-print-orders.service'
import {
  MEMBER_ORDER_TIMELINE_DISPLAY_STATUSES,
  type MemberOrderTimelineItem,
  type MemberOrderTimelineKindFilter,
  type MemberOrderTimelineStatusFilter,
} from '../src/member-print-orders/member-print-orders.types'
import { PackageOrderService } from '../src/member-print-orders/package-order.service'
import { OrderQuoteService } from '../src/payment/order-quote.service'
import { OrderStatusService } from '../src/payment/order-status.service'
import { seedDevDefaultPriceConfig } from '../src/payment/price-config.seed'
import { PricingService } from '../src/payment/pricing.service'
import { PICKUP_RELEASED_REPLAY_MS, PickupOrderService } from '../src/print-jobs/pickup-order.service'
import { PrintPageCountService } from '../src/print-jobs/print-page-count.service'
import { PrismaService } from '../src/prisma/prisma.service'
import { LOCAL_BUCKET_SENTINEL } from '../src/storage/storage.interface'
import { StorageService } from '../src/storage/storage.service'
import { setPrintScanCapabilityModeForTest, TerminalCapabilitiesService } from '../src/terminals/terminal-capabilities.service'
import { TerminalSessionService } from '../src/terminals/terminal-session.service'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'
import { buildRealPdf } from './support/minimal-pdf'

let passed = 0
function pass(message: string): void { passed += 1; console.log(`  PASS ${message}`) }
function fail(message: string): never { throw new Error(message) }
function check(ok: boolean, message: string, detail = ''): void {
  if (!ok) fail(`${message}${detail ? ` —— ${detail}` : ''}`)
  pass(message)
}

async function capture(action: () => Promise<unknown>): Promise<{ thrown: boolean; status: number | null; code: string | null; body: unknown; value: unknown }> {
  try {
    const value = await action()
    return { thrown: false, status: null, code: null, body: null, value }
  } catch (error) {
    const ex = error as { getStatus?: () => number; getResponse?: () => unknown; message?: string }
    const status = typeof ex.getStatus === 'function' ? ex.getStatus() : null
    const body = typeof ex.getResponse === 'function' ? ex.getResponse() : null
    const b = body as { error?: { code?: string }; message?: string } | string | null
    const code = typeof b === 'string' ? b : b?.error?.code ?? b?.message ?? ex.message ?? null
    return { thrown: true, status, code, body, value: null }
  }
}

class FakeRedis {
  store = new Map<string, string>()
  async get(key: string): Promise<string | null> { return this.store.get(key) ?? null }
  async setEx(key: string, _ttl: number, value: string): Promise<void> { this.store.set(key, value) }
  async del(key: string): Promise<number> { return this.store.delete(key) ? 1 : 0 }
  async getDel(key: string): Promise<string | null> { const v = this.store.get(key) ?? null; this.store.delete(key); return v }
  async incrWithTtl(key: string, _ttl: number): Promise<number> {
    const next = Number(this.store.get(key) ?? '0') + 1
    this.store.set(key, String(next))
    return next
  }
  async decrementFloorKeepTtl(key: string): Promise<number> {
    const v = Number(this.store.get(key) ?? 'NaN')
    if (!Number.isFinite(v)) return 0
    if (v <= 1) { this.store.delete(key); return 0 }
    this.store.set(key, String(v - 1))
    return v - 1
  }
  clearRates(): void { for (const key of [...this.store.keys()]) if (key.startsWith('pickup:claim:rate')) this.store.delete(key) }
}

function sqlitePath(): string {
  const url = process.env.DATABASE_URL ?? ''
  if (!url.startsWith('file:')) return ''
  const raw = url.slice('file:'.length).split(/[?#]/, 1)[0] ?? ''
  return path.isAbsolute(raw) ? raw : path.join(apiRoot, raw)
}

function applySqliteMigrations(dbPath: string): void {
  const root = path.join(apiRoot, 'prisma', 'migrations')
  const migrations = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(root, entry.name, 'migration.sql'))
    .sort()
  for (const migration of migrations) {
    execFileSync('sqlite3', [dbPath], { input: readFileSync(migration), stdio: ['pipe', 'pipe', 'pipe'] })
  }
}

// ── A. 静态接线 ──────────────────────────────────────────────────────────────
function staticWiring(): void {
  console.log('\n[A] 静态接线')
  const controller = readFileSync(path.join(apiRoot, 'src/member-print-orders/member-print-orders.controller.ts'), 'utf8')
  // 只认行首的装饰器，注释里提到的不算。
  const timelineAt = controller.search(/^ {2}@Get\('timeline'\)/m)
  const detailAt = controller.search(/^ {2}@Get\(':orderId'\)/m)
  check(timelineAt > 0 && detailAt > 0 && timelineAt < detailAt, "GET timeline 声明在 @Get(':orderId') 之前（否则 timeline 被当成 orderId）")
  const block = /@Post\(':orderId\/claim-here'\)([\s\S]*?)claimHere\(/.exec(controller)?.[1] ?? ''
  check(
    block.includes('@UseGuards(TerminalIdentityGuard)') && block.includes('@Throttle(') && !block.includes('MaintenanceBlocked'),
    'claim-here 挂终端身份守卫与限流；不挂维护拦截（与 claim-pickup 一致）',
  )
  check(/@Controller\('me\/print-orders'\)\s*\n@UseGuards\(EndUserAuthGuard\)/.test(controller), 'timeline / claim-here 所在控制器类级挂 EndUserAuthGuard')

  const shared = readFileSync(path.join(repoRoot, 'packages/shared/src/types/memberPrintOrders.ts'), 'utf8')
  const union = /export type MemberOrderTimelineDisplayStatus =([\s\S]*?)\n\n/.exec(shared)?.[1] ?? ''
  const sharedValues = [...union.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort()
  check(
    JSON.stringify(sharedValues) === JSON.stringify([...MEMBER_ORDER_TIMELINE_DISPLAY_STATUSES].sort()),
    'shared 与 API 两份展示状态取值一致',
    `shared=${sharedValues.join(',')}`,
  )

  const claimHereSrc = readFileSync(path.join(apiRoot, 'src/member-print-orders/member-order-claim-here.service.ts'), 'utf8')
  check(
    claimHereSrc.includes("this.pickupOrders.settleClaim(order, terminal, 'member_order')")
      && !/REFUNDED|PICKUP_CODE_EXPIRED|assertOrderFileReady|printTask\.create/.test(claimHereSrc),
    'claim-here 找到单后交给 settleClaim，本文件里没有复制任何核销判定',
  )

  // 异常过滤器：只为 PICKUP_TERMINAL_MISMATCH 透传三字段；其它错误码带 terminal 也照丢。
  const run = (exception: unknown) => {
    const captured: { status?: number; body?: { error: Record<string, unknown> } } = {}
    const response = {
      status(code: number) { captured.status = code; return this },
      json(body: { error: Record<string, unknown> }) { captured.body = body; return this },
    }
    const host = {
      switchToHttp: () => ({ getResponse: () => response, getRequest: () => ({ requestId: 'verify-timeline' }) }),
    } as unknown as ArgumentsHost
    new HttpExceptionFilter().catch(exception, host)
    return captured
  }
  const mismatch = run(new ConflictException({
    error: {
      code: 'PICKUP_TERMINAL_MISMATCH',
      message: 'x',
      terminal: { id: 't1', displayName: '一号大厅', locationLabel: '二楼', secret: 'leak', agentToken: 'tok' },
    },
  }))
  const t = mismatch.body?.error['terminal'] as Record<string, unknown> | undefined
  check(
    mismatch.status === 409 && t?.['displayName'] === '一号大厅' && t?.['locationLabel'] === '二楼'
      && Object.keys(t ?? {}).sort().join(',') === 'displayName,id,locationLabel',
    '过滤器为 PICKUP_TERMINAL_MISMATCH 透传网点，且只透传 id/displayName/locationLabel',
    JSON.stringify(mismatch.body),
  )
  const other = run(new ConflictException({ error: { code: 'SOMETHING_ELSE', message: 'x', terminal: { id: 't1', displayName: 'a' } } }))
  check(other.body?.error['terminal'] === undefined, '其它错误码带 terminal 字段不透传（白名单不放宽）')
}

// ── B. 纯函数 ────────────────────────────────────────────────────────────────
function pureRules(): void {
  console.log('\n[B] 展示状态派生与本机可领取（纯函数）')
  const seen = new Set<string>()
  const task = (status: string, pay: string | null, expected: string) => {
    const got = deriveTaskDisplayStatus(status, pay === null ? null : { payStatus: pay })
    seen.add(got)
    check(got === expected, `一体机任务 ${status} + ${pay ?? '无订单'} → ${expected}`, `实际 ${got}`)
  }
  task('completed', 'paid', 'completed')
  task('failed', 'paid', 'failed')
  task('cancelled', 'unpaid', 'cancelled')
  task('printing', 'paid', 'printing')
  task('claimed', 'paid', 'printing')
  task('pending', null, 'queued')
  task('pending', 'paid', 'queued')
  task('pending', 'unpaid', 'awaiting_payment')
  task('pending', 'paying', 'awaiting_payment')
  task('pending', 'refunding', 'cancelled')
  task('pending', 'refunded', 'cancelled')
  task('pending', 'closed', 'expired')
  task('pending', 'failed', 'expired')

  const order = (pickupStatus: string, payStatus: string, taskStatus: string, expected: string) => {
    const got = deriveOrderDisplayStatus({ pickupStatus, payStatus, taskStatus })
    seen.add(got)
    check(got === expected, `手机单 pickup=${pickupStatus} pay=${payStatus} task=${taskStatus} → ${expected}`, `实际 ${got}`)
  }
  order('used', 'paid', 'completed', 'completed')
  order('used', 'paid', 'failed', 'failed')
  order('used', 'paid', 'printing', 'printing')
  order('used', 'paid', 'claimed', 'printing')
  order('used', 'paid', 'pending', 'queued')
  order('used', 'refunded', 'cancelled', 'cancelled')
  order('cancelled', 'closed', 'cancelled', 'cancelled')
  order('expired', 'closed', 'expired', 'expired')
  order('pending', 'refunding', 'pending_release', 'cancelled')
  order('claimed', 'refunded', 'awaiting_payment', 'cancelled')
  order('pending', 'closed', 'pending_release', 'expired')
  order('pending', 'unpaid', 'pending_release', 'awaiting_arrival')
  order('pending', 'paid', 'pending_release', 'awaiting_arrival')
  order('claimed', 'unpaid', 'awaiting_payment', 'awaiting_payment')
  order('claimed', 'paying', 'awaiting_payment', 'awaiting_payment')
  order('claimed', 'paid', 'awaiting_payment', 'queued')
  order('none', 'paid', 'completed', 'completed')
  order('none', 'paid', 'pending', 'queued')
  const missing = MEMBER_ORDER_TIMELINE_DISPLAY_STATUSES.filter((s) => !seen.has(s))
  check(missing.length === 0, '八个展示状态每个至少命中一次', `缺 ${missing.join(',')}`)
  check(
    ['awaiting_arrival', 'awaiting_payment'].every((s) => timelineStatusBucket(s as never) === 'waiting')
      && ['queued', 'printing'].every((s) => timelineStatusBucket(s as never) === 'printing')
      && ['completed', 'failed', 'cancelled', 'expired'].every((s) => timelineStatusBucket(s as never) === 'done'),
    '过滤桶：waiting=待到机+待付款，printing=排队+打印中，done=四个结束态',
  )

  const now = new Date()
  const base: ClaimableOrder = {
    terminalId: 'T',
    pickupCodeHash: 'h',
    pickupStatus: 'pending',
    payStatus: 'unpaid',
    pickupCodeExpiresAt: new Date(now.getTime() + 3600_000),
    printTaskId: null,
    pickupClaimedAt: null,
    paidAt: null,
  }
  check(isClaimableHere(base, 'T', now) === true, 'claimableHere 正例：本机 + pending + unpaid + 未过期')
  check(isClaimableHere(base, null, now) === false, 'claimableHere 反例 1：无已验签终端身份')
  check(isClaimableHere(base, 'OTHER', now) === false, 'claimableHere 反例 2：订单绑定的不是本机')
  check(
    ['used', 'expired', 'cancelled', 'none'].every((p) => isClaimableHere({ ...base, pickupStatus: p }, 'T', now) === false),
    'claimableHere 反例 3：取件态不在 pending/claimed',
  )
  check(
    ['refunding', 'partial_refunded', 'refunded', 'closed', 'failed'].every((p) => isClaimableHere({ ...base, payStatus: p }, 'T', now) === false),
    'claimableHere 反例 4：付款态不在 unpaid/paying/paid',
  )
  check(
    isClaimableHere({ ...base, pickupCodeExpiresAt: new Date(now.getTime() - 1000) }, 'T', now) === false
      && isClaimableHere({ ...base, pickupStatus: 'claimed', pickupClaimedAt: new Date(now.getTime() - 24 * 3600_000) }, 'T', now) === false,
    'claimableHere 反例 5：已过期（pending 过截止 / claimed 未付租约已过）',
  )
  check(isClaimableHere({ ...base, pickupStatus: 'claimed', payStatus: 'paid', pickupClaimedAt: now }, 'T', now) === true, 'claimableHere：claimed + paid 未放行仍可本机领取（放行）')
  check(
    hasUsableArrivalCode(base, now) && !hasUsableArrivalCode({ ...base, pickupCodeHash: null }, now)
      && !hasUsableArrivalCode({ ...base, pickupStatus: 'claimed' }, now)
      && !hasUsableArrivalCode({ ...base, payStatus: 'refunded' }, now)
      && !hasUsableArrivalCode({ ...base, pickupCodeExpiresAt: new Date(now.getTime() - 1) }, now),
    'hasArrivalCode 与出码判据一致（有码、pending、可付、未过期）',
  )
  const cursor = { createdAt: new Date('2026-09-29T01:02:03.004Z'), id: 'abc', kind: 'package' as const }
  const round = decodeTimelineCursor(encodeTimelineCursor(cursor))
  check(round.id === 'abc' && round.kind === 'package' && round.createdAt.getTime() === cursor.createdAt.getTime(), '游标编码可往返')
  for (const bad of ['!!!', Buffer.from('{"c":"x","i":"a","k":"package"}').toString('base64url'), Buffer.from('{"c":"2026-09-29T01:02:03.004Z","i":"a","k":"nope"}').toString('base64url')]) {
    const res = (() => { try { parseTimelineQuery({ cursor: bad }); return null } catch (e) { return e as { getStatus: () => number; getResponse: () => { error: { code: string } } } } })()
    check(res?.getStatus() === 400 && res.getResponse().error.code === 'MEMBER_TIMELINE_CURSOR_INVALID', `坏游标 400：${bad.slice(0, 12)}…`)
  }
  const badStatus = (() => { try { parseTimelineQuery({ status: 'paid' }); return 0 } catch (e) { return (e as { getStatus: () => number }).getStatus() } })()
  const bigPage = parseTimelineQuery({ pageSize: '500' }).pageSize
  check(badStatus === 400 && bigPage === 50 && parseTimelineQuery({}).pageSize === 20, 'status 白名单 400；pageSize 默认 20、封顶 50')
}

// ── C/D. 真实库 ──────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log('\n=== verify:member-order-timeline ===')
  staticWiring()
  pureRules()

  assertIsolatedVerificationDatabase()
  const prisma = new PrismaService()
  await prisma.onModuleInit()
  try {
    await prisma.order.findFirst({ select: { id: true } })
  } catch {
    const dbPath = sqlitePath()
    if (!dbPath) fail('PostgreSQL 验证库缺少 Order 表，请先 migrate deploy')
    applySqliteMigrations(dbPath)
  }

  const storage = new StorageService()
  const audit = new AuditService(prisma)
  const capabilities = new TerminalCapabilitiesService(prisma)
  const orderStatus = new OrderStatusService(prisma, audit)
  const pageCount = new PrintPageCountService(prisma, storage)
  const quote = new OrderQuoteService(pageCount, new PricingService(prisma), capabilities, prisma)
  const cloudOrders = new MemberPrintOrderCreateService(prisma, quote, capabilities, orderStatus, audit)
  const packages = new PackageOrderService(prisma, quote, capabilities, audit, orderStatus)
  const redis = new FakeRedis()
  const pickup = new PickupOrderService(prisma, capabilities, audit, redis as unknown as RedisService, storage)
  const sessions = new TerminalSessionService(redis as unknown as RedisService, prisma, { validateTerminalToken: async () => undefined })
  const timeline = new MemberOrderTimelineService(prisma, cloudOrders, packages, sessions)
  const claimHere = new MemberOrderClaimHereService(prisma, redis as unknown as RedisService, pickup)
  const legacy = new MemberPrintOrdersService(prisma)

  const sfx = randomUUID().replace(/-/g, '').slice(0, 10)
  const U = `eu_tl_${sfx}`
  const O = `eu_tl_o_${sfx}`
  const T = `term_tl_${sfx}`
  const T2 = `term_tl_b_${sfx}`
  const storageKeys: string[] = []
  const arrivalCodes: string[] = []
  let src = 0
  // 每次领取换一个来源并清空限流桶：本门禁测的是核销判定，不是限额（限额由 verify:pickup-code-share 守）。
  const source = () => { redis.clearRates(); return `src-${(src += 1)}` }

  async function seedTerminal(id: string, displayName: string, locationLabel: string): Promise<void> {
    await prisma.terminal.create({
      data: { id, terminalCode: `C-${id}`, agentToken: `tok-${id}`, deviceFingerprint: `fp-${id}`, displayName, locationLabel },
    })
    await prisma.terminalHeartbeat.create({ data: { terminalId: id, status: 'online', localTaskDatabaseAvailable: true } })
    await prisma.terminalCapability.create({ data: { terminalId: id, capabilityKey: 'document_print', status: 'available' } })
  }
  async function seedFile(owner: string, label: string): Promise<string> {
    const id = `file_tl_${label}_${sfx}`
    const key = `verify/member-order-timeline/${id}.pdf`
    storageKeys.push(key)
    const pdf = buildRealPdf(1)
    await storage.putObject(key, pdf, 'application/pdf', LOCAL_BUCKET_SENTINEL)
    const sha = createHash('sha256').update(pdf).digest('hex')
    await prisma.fileObject.create({
      data: {
        id, storageKey: key, bucket: LOCAL_BUCKET_SENTINEL, region: 'local', filename: `材料-${label}.pdf`,
        mimeType: 'application/pdf', sizeBytes: pdf.length, sha256: sha, endUserId: owner, ownerType: 'user', ownerId: owner,
        purpose: 'print_doc', status: 'active', expiresAt: new Date(Date.now() + 30 * 3600_000),
      },
    })
    const scan = await prisma.documentProcessTask.create({
      data: {
        kind: 'pii_scan', status: 'completed', requesterMode: 'member', sourceFileId: id, endUserId: owner,
        expiresAt: new Date(Date.now() + 3600_000), paramsJson: JSON.stringify({ sourceSha256: sha }),
      },
    })
    await prisma.piiFinding.create({ data: { taskId: scan.id, type: 'phone', label: '手机号', action: 'keep' } })
    return id
  }
  const single = async (owner: string, fileId: string, terminalId: string) => {
    const created = await cloudOrders.create(owner, { fileId, terminalId, copies: 1, colorMode: 'black_white', duplex: 'simplex' }, randomUUID())
    if (created.pickupCode) arrivalCodes.push(created.pickupCode)
    return created
  }
  const pack = async (fileIds: string[], terminalId: string) => {
    const created = await packages.create(U, { terminalId, files: fileIds.map((fileId) => ({ fileId })), params: { copies: 2, colorMode: 'black_white', duplex: 'simplex' } }, randomUUID())
    if (created.pickupCode) arrivalCodes.push(created.pickupCode)
    return created
  }
  let kioskSeq = 0
  const kioskTask = async (status: string, order: { payStatus: string; mintPickup?: boolean } | null) => {
    kioskSeq += 1
    const id = `ptask_tl_${kioskSeq}_${sfx}`
    await prisma.printTask.create({
      data: {
        id, terminalId: T, endUserId: U, fileUrl: 'https://invalid.example/x', fileMd5: '', status,
        paramsJson: JSON.stringify({ fileName: `现场-${kioskSeq}.pdf`, copies: 2, colorMode: 'color', duplex: 'duplex_long_edge', paperSize: 'A4', pageRange: '1-2' }),
      },
    })
    if (order) {
      const row = await prisma.order.create({
        data: {
          orderNo: `ORD-TL-${kioskSeq}-${sfx}`, endUserId: U, terminalId: T, printTaskId: id, amountCents: 300,
          payStatus: order.mintPickup ? 'unpaid' : order.payStatus, taskStatus: status === 'completed' ? 'completed' : 'pending',
        },
      })
      if (order.mintPickup) await orderStatus.markPaid(row.id, { paymentSource: 'offline', operatorId: 'verify-timeline' })
    }
    return id
  }
  const sessionFor = async (terminalId: string) => {
    const token = `sess-${randomUUID()}`
    await redis.setEx(`term:session:${token}`, 1800, JSON.stringify({ terminalId, generation: 0, issuedAt: new Date().toISOString() }))
    return token
  }

  try {
    setPrintScanCapabilityModeForTest('strict')
    for (const id of [U, O]) await prisma.endUser.create({ data: { id, phoneHash: `hash-${id}`, phoneEnc: `enc-${id}` } })
    await seedTerminal(T, '青序一号大厅', '一楼东侧')
    await seedTerminal(T2, '青序二号大厅', '三楼')
    await seedDevDefaultPriceConfig(prisma)
    const fA = await seedFile(U, 'a')
    const fB = await seedFile(U, 'b')
    const fO = await seedFile(O, 'o')

    // ── 造数：三路来源 ──
    const K1 = await kioskTask('completed', null)
    const K2 = await kioskTask('pending', { payStatus: 'paid', mintPickup: true })
    const K3 = await kioskTask('pending', { payStatus: 'unpaid' })
    const K4 = await kioskTask('pending', { payStatus: 'refunded' })
    const K5 = await kioskTask('pending', { payStatus: 'closed' })
    const K6 = await kioskTask('printing', { payStatus: 'paid' })
    const K7 = await kioskTask('failed', { payStatus: 'paid' })
    const K8 = await kioskTask('completed', { payStatus: 'paid', mintPickup: true })
    const K9 = await kioskTask('pending', null)
    const C1 = await single(U, fA, T)
    const C2 = await single(U, fA, T2)
    const C3 = await single(U, fA, T)
    await cloudOrders.cancel(U, C3.id, {})
    const C4 = await single(U, fA, T)
    await prisma.order.update({ where: { id: C4.id }, data: { pickupCodeExpiresAt: new Date(Date.now() - 60_000) } })
    const C5 = await single(U, fA, T)
    await pickup.claim(C5.pickupCode!, T, source())
    await orderStatus.markPaid(C5.id, { paymentSource: 'offline', operatorId: 'verify-timeline' })
    const C5released = await pickup.claim(C5.pickupCode!, T, source()) as { released: boolean; taskId: string }
    if (!C5released.released) fail('造数：C5 应已放行')
    const C6 = await single(U, fA, T)
    await pickup.claim(C6.pickupCode!, T, source())
    const C9 = await single(U, fA, T)
    await pickup.claim(C9.pickupCode!, T, source())
    await orderStatus.markPaid(C9.id, { paymentSource: 'offline', operatorId: 'verify-timeline' })
    const P1 = await pack([fA, fB], T)
    const P2 = await pack([fA, fB], T)
    await pickup.claim(P2.pickupCode!, T, source())
    await orderStatus.markPaid(P2.orderId, { paymentSource: 'offline', operatorId: 'verify-timeline' })
    const P2released = await pickup.claim(P2.pickupCode!, T, source()) as { released: boolean; taskId: string }
    if (!P2released.released) fail('造数：P2 应已放行')
    const P3 = await pack([fA, fB], T)
    await pickup.claim(P3.pickupCode!, T, source())
    await orderStatus.markPaid(P3.orderId, { paymentSource: 'offline', operatorId: 'verify-timeline' })
    await pickup.claim(P3.pickupCode!, T, source())
    // 模拟整包出完：派发链在 Agent 回报里推进，这里直接落终态，只为覆盖「已派发 + 已完成」这一支。
    await prisma.order.update({ where: { id: P3.orderId }, data: { taskStatus: 'completed' } })
    const packageChildTasks = await prisma.printTask.findMany({ where: { orderId: { in: [P2.orderId, P3.orderId] } }, select: { id: true } })
    if (packageChildTasks.length === 0) fail('造数：材料包应已派发子任务')
    const OO = await single(O, fO, T)

    // 交错时间 + 跨来源同毫秒并列（C1 与 K3、P1 与 K6 同一时刻）
    const base = Date.now() - 3600_000
    const plan: Array<[string, 'task' | 'order', number]> = [
      [K1, 'task', 0], [C1.id, 'order', 1], [K3, 'task', 1], [P1.orderId, 'order', 2], [K6, 'task', 2],
      [K2, 'task', 3], [C2.id, 'order', 4], [K4, 'task', 5], [C3.id, 'order', 6], [K5, 'task', 7],
      [C4.id, 'order', 8], [C5released.taskId, 'task', 9], [K7, 'task', 10], [C6.id, 'order', 11],
      [P2.orderId, 'order', 12], [K8, 'task', 13], [K9, 'task', 13], [C9.id, 'order', 14], [P3.orderId, 'order', 15],
    ]
    for (const [id, kind, slot] of plan) {
      const createdAt = new Date(base - slot * 1000)
      if (kind === 'task') await prisma.printTask.update({ where: { id }, data: { createdAt } })
      else await prisma.order.update({ where: { id }, data: { createdAt } })
    }

    console.log('\n[C] 时间线')
    const sessT = await sessionFor(T)
    const verifiedT = await timeline.resolveVerifiedTerminal(T, sessT)
    const forged = await timeline.resolveVerifiedTerminal(T, 'not-a-session')
    const mismatchedHeader = await timeline.resolveVerifiedTerminal(T2, sessT)
    check(verifiedT === T && forged === null && mismatchedHeader === null && (await timeline.resolveVerifiedTerminal(undefined, undefined)) === null,
      '可选终端解析：验签通过才算本机；伪造令牌 / 令牌与终端头不符 / 缺头一律按无终端')

    const collect = async (status: MemberOrderTimelineStatusFilter, kind: MemberOrderTimelineKindFilter, pageSize: number, terminal: string | null) => {
      const items: MemberOrderTimelineItem[] = []
      const raws: string[] = []
      let cursor: string | undefined
      let total = -1
      for (let i = 0; i < 100; i += 1) {
        const page = await timeline.list(U, parseTimelineQuery({ cursor, pageSize: String(pageSize), status, kind }), terminal)
        raws.push(JSON.stringify(page))
        if (total === -1) total = page.total
        else if (total !== page.total) fail(`翻页中 total 变了：${total} → ${page.total}`)
        items.push(...page.items)
        if (!page.nextCursor) break
        cursor = page.nextCursor
      }
      return { items, total, raws }
    }

    const expectedTasks = await prisma.printTask.findMany({ where: { endUserId: U, orderId: null }, select: { id: true } })
    const expectedCloud = await prisma.order.findMany({ where: { endUserId: U, sourceFileId: { not: null }, printTaskId: null }, select: { id: true } })
    const expectedPackage = await prisma.order.findMany({ where: { endUserId: U, orderItems: { some: {} } }, select: { id: true } })
    const expectedKeys = new Set([
      ...expectedTasks.map((r) => `kiosk_task:${r.id}`),
      ...expectedCloud.map((r) => `cloud_single:${r.id}`),
      ...expectedPackage.map((r) => `package:${r.id}`),
    ])
    const keyOf = (i: MemberOrderTimelineItem) => `${i.kind}:${i.id}`

    for (const size of [1, 2, 3, 7, 50]) {
      const { items, total } = await collect('all', 'all', size, verifiedT)
      const keys = items.map(keyOf)
      const sorted = items.every((it, idx) => idx === 0 || items[idx - 1].createdAt >= it.createdAt)
      check(
        keys.length === new Set(keys).size && keys.length === expectedKeys.size && keys.every((k) => expectedKeys.has(k)) && total === expectedKeys.size && sorted,
        `pageSize=${size}：三来源逐页翻完不重不漏、按时间倒序、total=${expectedKeys.size}`,
        `got ${keys.length} total ${total} sorted ${sorted}`,
      )
    }

    const all = await collect('all', 'all', 4, verifiedT)
    const byKey = new Map(all.items.map((i) => [keyOf(i), i]))
    const get = (kind: string, id: string) => byKey.get(`${kind}:${id}`) ?? fail(`时间线缺 ${kind}:${id}`)
    check(
      packageChildTasks.length >= 2 && packageChildTasks.every((t) => !byKey.has(`kiosk_task:${t.id}`)) && Boolean(byKey.get(`package:${P2.orderId}`)),
      '材料包逐份派发的子任务不出现在 kiosk_task，只以材料包一条出现',
    )
    check(
      Boolean(byKey.get(`kiosk_task:${C5released.taskId}`)) && !byKey.has(`cloud_single:${C5.id}`),
      '手机单件放行后以它的打印任务出现（kiosk_task），不再重复成 cloud_single',
    )
    check(!all.items.some((i) => i.orderId === OO.id), '他人的订单不出现在本人时间线')

    // 展示状态落到真实行
    const expectDisplay: Array<[string, string, string]> = [
      ['kiosk_task', K1, 'completed'], ['kiosk_task', K2, 'queued'], ['kiosk_task', K3, 'awaiting_payment'],
      ['kiosk_task', K4, 'cancelled'], ['kiosk_task', K5, 'expired'], ['kiosk_task', K6, 'printing'],
      ['kiosk_task', K7, 'failed'], ['kiosk_task', C5released.taskId, 'queued'],
      ['cloud_single', C1.id, 'awaiting_arrival'], ['cloud_single', C2.id, 'awaiting_arrival'],
      ['cloud_single', C3.id, 'cancelled'], ['cloud_single', C4.id, 'expired'], ['cloud_single', C6.id, 'awaiting_payment'],
      ['package', P1.orderId, 'awaiting_arrival'], ['package', P2.orderId, 'queued'],
      ['kiosk_task', K9, 'queued'], ['cloud_single', C9.id, 'queued'], ['package', P3.orderId, 'completed'],
    ]
    const wrong = expectDisplay.filter(([k, id, s]) => get(k, id).displayStatus !== s)
    check(wrong.length === 0, '真实行上的展示状态符合规则（18 条）', JSON.stringify(wrong.map(([k, id]) => [k, id, get(k, id).displayStatus])))
    const c4row = await prisma.order.findUniqueOrThrow({ where: { id: C4.id } })
    check(c4row.pickupStatus === 'expired', '列表前按既有口径把到期未取的单落成 expired（与小程序列表一致）')

    // 字段
    const p1 = get('package', P1.orderId)
    const c1 = get('cloud_single', C1.id)
    const k3 = get('kiosk_task', K3)
    check(p1.title === null && p1.itemCount === 2 && p1.copies === 2 && p1.colorMode === 'black_white' && p1.duplex === 'simplex' && p1.pageRange === null,
      '材料包：title=null、itemCount=份数、共用参数来自材料包行、页范围不给', JSON.stringify(p1))
    check(c1.title === '材料-a.pdf' && c1.itemCount === 1 && c1.printTaskId === null && c1.terminal?.displayName === '青序一号大厅' && c1.terminal.locationLabel === '一楼东侧'
      && c1.hasArrivalCode === true && typeof c1.arrivalCodeExpiresAt === 'string' && c1.orderNo === C1.orderNo,
    '单件：文件名、网点、hasArrivalCode=true 与截止时间', JSON.stringify(c1))
    check(k3.title === '现场-3.pdf' && k3.copies === 2 && k3.colorMode === 'color' && k3.duplex === 'duplex_long_edge' && k3.pageRange === '1-2' && k3.hasArrivalCode === false && k3.arrivalCodeExpiresAt === null,
      '一体机任务：参数按旧列表白名单解析；没有到机码', JSON.stringify(k3))
    check(get('cloud_single', C3.id).hasArrivalCode === false && get('cloud_single', C6.id).hasArrivalCode === false,
      '已取消 / 已被机器领走的单 hasArrivalCode=false')

    // 到机码明文不下发
    const reissuedFree = arrivalCodes.length
    const leaked = arrivalCodes.filter((code) => all.raws.some((raw) => raw.includes(code)))
    const keysSeen = new Set(all.items.flatMap((i) => Object.keys(i)))
    check(reissuedFree >= 8 && leaked.length === 0 && !keysSeen.has('share') && !keysSeen.has('pickupCodeEnc') && !keysSeen.has('paymentSessionToken'),
      `整页 JSON 里没有任何到机码明文（查了 ${reissuedFree} 枚），也没有 share / paymentSessionToken`, `泄露 ${leaked.length}`)

    // pickupCode 与旧列表同口径
    const legacyPage = await legacy.list(U, { cursor: null, pageSize: 50 })
    const legacyById = new Map(legacyPage.items.map((i) => [i.id, i]))
    const payKeys = ['amountCents', 'payStatus', 'paymentSource', 'billablePages', 'pickupCode', 'refundedAmountCents', 'discountCents', 'refundRequired'] as const
    const diffs: string[] = []
    for (const it of all.items.filter((i) => i.kind === 'kiosk_task')) {
      const old = legacyById.get(it.id) as unknown as Record<string, unknown> | undefined
      if (!old) { diffs.push(`${it.id} 不在旧列表`); continue }
      for (const k of payKeys) if (JSON.stringify(old[k] ?? null) !== JSON.stringify((it as unknown as Record<string, unknown>)[k])) diffs.push(`${it.id}.${k}`)
    }
    const k2 = get('kiosk_task', K2)
    const k8 = get('kiosk_task', K8)
    check(diffs.length === 0 && typeof k2.pickupCode === 'string' && k2.pickupCode.length > 0 && k8.pickupCode === null,
      '一体机任务的支付字段与取件凭证码和旧 /me/print-orders 逐字段一致（已付未完成给码，已完成不给）', diffs.join(';'))

    // status / kind 过滤
    const buckets: Record<string, Set<string>> = {}
    for (const status of ['waiting', 'printing', 'done'] as const) {
      const got = await collect(status, 'all', 3, verifiedT)
      const bad = got.items.filter((i) => timelineStatusBucket(i.displayStatus) !== status)
      buckets[status] = new Set(got.items.map(keyOf))
      check(bad.length === 0 && got.total === got.items.length, `status=${status}：每条的展示状态都属于该桶，total=${got.total} 与翻出条数一致`, JSON.stringify(bad.map((i) => [i.kind, i.displayStatus])))
    }
    const union = new Set([...buckets.waiting, ...buckets.printing, ...buckets.done])
    const overlap = [...buckets.waiting].filter((k) => buckets.printing.has(k) || buckets.done.has(k)).length
      + [...buckets.printing].filter((k) => buckets.done.has(k)).length
    check(union.size === expectedKeys.size && overlap === 0 && buckets.waiting.size + buckets.printing.size + buckets.done.size === expectedKeys.size,
      'waiting ∪ printing ∪ done = all，且三桶互不相交（查询条件与派生规则同口径）')
    for (const kind of ['kiosk_task', 'cloud_single', 'package'] as const) {
      const got = await collect('all', kind, 2, verifiedT)
      const expectCount = [...expectedKeys].filter((k) => k.startsWith(`${kind}:`)).length
      check(got.items.every((i) => i.kind === kind) && got.total === expectCount && got.items.length === expectCount, `kind=${kind}：只回该来源，total=${expectCount}`)
    }
    const waitingPkg = await collect('waiting', 'package', 1, verifiedT)
    check(waitingPkg.total === 1 && waitingPkg.items[0]?.id === P1.orderId, 'status 与 kind 组合过滤：total 同样按组合口径')

    // claimableHere
    const claimable = all.items.filter((i) => i.claimableHere).map(keyOf).sort()
    check(JSON.stringify(claimable) === JSON.stringify([`cloud_single:${C1.id}`, `cloud_single:${C6.id}`, `cloud_single:${C9.id}`, `package:${P1.orderId}`].sort()),
      'claimableHere 只在本机、未过期、可付且未派发的单上为 true（含已付待放行；C2 在别的网点、C3 已取消、C4 已过期、已放行都为 false）', claimable.join(','))
    const noTerm = await collect('all', 'all', 50, null)
    const forgedList = await collect('all', 'all', 50, forged)
    check(noTerm.items.every((i) => !i.claimableHere) && forgedList.items.every((i) => !i.claimableHere), '无终端 / 终端头验签失败时 claimableHere 全为 false')
    const t2Session = await timeline.resolveVerifiedTerminal(T2, await sessionFor(T2))
    const atT2 = await collect('all', 'all', 50, t2Session)
    check(atT2.items.filter((i) => i.claimableHere).map((i) => i.id).join(',') === C2.id, '换到二号大厅：只有绑在二号大厅的单可本机领取')

    // ── D. claim-here ──
    console.log('\n[D] 本机领取 claim-here')
    const failKey = `pickup:claim:fail:${T}`
    redis.clearRates()
    const h1 = await capture(() => claimHere.claimHere(U, C1.id, T, source()))
    const h1v = h1.value as { released: boolean; orderId: string; orderNo: string; terminalId: string; amountCents: number; paymentSessionToken: string; priceLines: unknown[] }
    const c1after = await prisma.order.findUniqueOrThrow({ where: { id: C1.id } })
    const claimAudit = await prisma.auditLog.findFirst({ where: { action: 'print_order.pickup_claim', targetId: C1.id }, orderBy: { createdAt: 'desc' } })
    check(!h1.thrown && h1v.released === false && h1v.orderId === C1.id && h1v.terminalId === T && typeof h1v.paymentSessionToken === 'string' && Array.isArray(h1v.priceLines)
      && c1after.pickupStatus === 'claimed' && Boolean(claimAudit?.payloadJson.includes('"via":"member_order"')),
    '本人 + 本机：未付款单认领成功（与 claim-pickup 同形），审计沿用 print_order.pickup_claim 并带 via', JSON.stringify(h1))
    const h1b = await capture(() => claimHere.claimHere(U, C1.id, T, source()))
    const tasksC1 = await prisma.printTask.count({ where: { OR: [{ orderId: C1.id }, { order: { is: { id: C1.id } } }] } })
    check(!h1b.thrown && (h1b.value as { orderId: string; released: boolean; amountCents: number }).orderId === C1.id
      && (h1b.value as { released: boolean }).released === false && (h1b.value as { amountCents: number }).amountCents === h1v.amountCents && tasksC1 === 0,
    '重复调用：同样结果、不派发打印任务')

    await orderStatus.markPaid(C1.id, { paymentSource: 'offline', operatorId: 'verify-timeline' })
    const h2 = await capture(() => claimHere.claimHere(U, C1.id, T, source()))
    const h2v = h2.value as { released: boolean; taskId: string }
    const h3 = await capture(() => claimHere.claimHere(U, C1.id, T, source()))
    const h3v = h3.value as { released: boolean; taskId: string }
    const c1Tasks = await prisma.printTask.findMany({ where: { order: { is: { id: C1.id } } }, select: { id: true } })
    const releaseAudit = await prisma.auditLog.findFirst({ where: { action: 'print_order.release', targetId: h2v?.taskId } })
    check(!h2.thrown && h2v.released === true && typeof h2v.taskId === 'string' && !h3.thrown && h3v.released === true && h3v.taskId === h2v.taskId
      && c1Tasks.length === 1 && Boolean(releaseAudit?.payloadJson.includes('"via":"member_order"')),
    '已付款：本机领取直接放行；再点一次回同一任务，不重复派发', JSON.stringify([h2, h3]))

    const foreign = await capture(() => claimHere.claimHere(U, OO.id, T, source()))
    const missing = await capture(() => claimHere.claimHere(U, `nope_${sfx}`, T, source()))
    check(foreign.status === 404 && foreign.code === 'PRINT_ORDER_NOT_FOUND' && missing.status === 404 && missing.code === 'PRINT_ORDER_NOT_FOUND'
      && (await prisma.order.findUniqueOrThrow({ where: { id: OO.id } })).pickupStatus === 'pending',
    '他人订单与不存在的订单同样 404 PRINT_ORDER_NOT_FOUND，且他人订单状态不变')

    await redis.setEx(failKey, 600, '3')
    const rejectedBefore = await prisma.auditLog.count({ where: { action: 'print_order.pickup_claim_rejected', targetId: C2.id } })
    const mismatch = await capture(() => claimHere.claimHere(U, C2.id, T, source()))
    const mismatchTerminal = (mismatch.body as { error?: { terminal?: { id: string; displayName: string | null; locationLabel: string | null } } })?.error?.terminal
    check(mismatch.status === 409 && mismatch.code === 'PICKUP_TERMINAL_MISMATCH' && mismatchTerminal?.id === T2 && mismatchTerminal.displayName === '青序二号大厅'
      && (await redis.get(failKey)) === '3'
      && (await prisma.auditLog.count({ where: { action: 'print_order.pickup_claim_rejected', targetId: C2.id } })) === rejectedBefore
      && (await prisma.order.findUniqueOrThrow({ where: { id: C2.id } })).pickupStatus === 'pending',
    '异机：409 PICKUP_TERMINAL_MISMATCH 带网点名，不计入锁机、不写枚举审计、订单不变', JSON.stringify(mismatch.body))

    // 会员入口成功不动到机码失败计数（不给枚举续命）；到机码入口首次认领成功只抵掉一次（1.8 P-2：4 → 3）。
    const C7 = await single(U, fA, T)
    await redis.setEx(failKey, 600, '4')
    await claimHere.claimHere(U, C7.id, T, source())
    const afterMember = await redis.get(failKey)
    const C8 = await single(U, fA, T)
    await pickup.claim(C8.pickupCode!, T, source())
    check(afterMember === '4' && (await redis.get(failKey)) === '3', '会员本机领取成功不动本机到机码失败计数；到机码首次认领成功只抵掉一次')

    // 拒绝场景：claim-here 与到机码入口同一判定、同一错误码
    const parity = async (label: string, prepare: (orderId: string) => Promise<void>, expected: string, firstClaim = false) => {
      const a = await single(U, fA, T)
      const b = await single(U, fA, T)
      if (firstClaim) {
        await claimHere.claimHere(U, a.id, T, source())
        await pickup.claim(b.pickupCode!, T, source())
      }
      await prepare(a.id)
      await prepare(b.id)
      redis.clearRates()
      const viaMember = await capture(() => claimHere.claimHere(U, a.id, T, source()))
      const viaCode = await capture(() => pickup.claim(b.pickupCode!, T, source()))
      check(viaMember.code === expected && viaCode.code === expected && viaMember.status === viaCode.status,
        `${label}：claim-here 与到机码入口同为 ${expected}`, `member=${viaMember.code} code=${viaCode.code}`)
    }
    await parity('已退款（pending）', async (id) => { await prisma.order.update({ where: { id }, data: { payStatus: 'refunded' } }) }, 'ORDER_REFUNDED')
    await parity('退款中（已被机器领过 claimed）', async (id) => { await prisma.order.update({ where: { id }, data: { payStatus: 'refunding' } }) }, 'ORDER_REFUNDED', true)
    await parity('已过期', async (id) => { await prisma.order.update({ where: { id }, data: { pickupCodeExpiresAt: new Date(Date.now() - 1000) } }) }, 'PICKUP_CODE_EXPIRED')
    const fDead = await seedFile(U, 'dead')
    const deadA = await single(U, fDead, T)
    const deadB = await single(U, fDead, T)
    await prisma.fileObject.update({ where: { id: fDead }, data: { status: 'deleted' } })
    redis.clearRates()
    const deadMember = await capture(() => claimHere.claimHere(U, deadA.id, T, source()))
    const deadCode = await capture(() => pickup.claim(deadB.pickupCode!, T, source()))
    check(deadMember.code === 'PRINT_FILE_EXPIRED' && deadCode.code === 'PRINT_FILE_EXPIRED', '文件已失效：两个入口同为 PRINT_FILE_EXPIRED', `${deadMember.code}/${deadCode.code}`)

    // 已用：放行超过同机回放窗口后再领
    await prisma.printTask.update({ where: { id: h2v.taskId }, data: { createdAt: new Date(Date.now() - PICKUP_RELEASED_REPLAY_MS - 60_000) } })
    const used = await capture(() => claimHere.claimHere(U, C1.id, T, source()))
    const tasksAfterUsed = await prisma.printTask.count({ where: { order: { is: { id: C1.id } } } })
    check(used.code === 'PICKUP_CODE_ALREADY_USED' && tasksAfterUsed === 1, '已用且超过同机回放窗口：PICKUP_CODE_ALREADY_USED，不再派发')
    // 本机不在线：与到机码入口同一道终端就绪检查
    await prisma.terminalHeartbeat.updateMany({ where: { terminalId: T2 }, data: { createdAt: new Date(Date.now() - 10 * 60_000) } })
    const offline = await capture(() => claimHere.claimHere(U, C2.id, T2, source()))
    check(offline.status === 403 && offline.code === 'PRINT_TERMINAL_NOT_READY', '本机离线：403 PRINT_TERMINAL_NOT_READY（与到机码入口同一检查）', String(offline.code))

    console.log(`\nALL PASS (${passed})`)
  } finally {
    setPrintScanCapabilityModeForTest(null)
    await prisma.onModuleDestroy()
    for (const key of storageKeys) {
      try { rmSync(path.join(process.env.FILE_STORAGE_DIR!, key), { force: true }) } catch { /* ignore */ }
    }
    if (fallbackDbPath) rmSync(fallbackDbPath, { force: true })
  }
}

main().catch((error: unknown) => {
  console.error(`\n  FAIL ${(error as Error).message}`)
  process.exit(1)
})
