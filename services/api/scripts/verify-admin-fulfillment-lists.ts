/**
 * 管理员复印与材料包只读列表。
 *
 * 自建临时 SQLite，不写共享库。真实 HTTP、登录守卫和角色守卫。
 * 有任务、没任务、非管理员 403。响应不含文件地址、手机号、取件码或报价快照。
 *
 * 运行：pnpm --filter @ai-job-print/api verify:admin-fulfillment-lists
 */
import 'reflect-metadata'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { closeSync, mkdtempSync, openSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Module, ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'
import { Reflector } from '@nestjs/core'
import { JwtService } from '@nestjs/jwt'
import { PrismaService } from '../src/prisma/prisma.service'
import { RedisService } from '../src/common/redis/redis.service'
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter'
import { JwtAuthGuard } from '../src/common/guards/jwt-auth.guard'
import { RolesGuard } from '../src/common/guards/roles.guard'
import { AdminFulfillmentListsController } from '../src/admin-print-scan/admin-fulfillment-lists.controller'
import { AdminFulfillmentListsService, type AdminFulfillmentListItem, type AdminFulfillmentListPage } from '../src/admin-print-scan/admin-fulfillment-lists'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

const ITEM_KEYS = ['copies', 'failureReason', 'id', 'lineCount', 'recordNo', 'startedAt', 'status', 'statusLabel', 'terminalCode', 'terminalId']

function pass(label: string): void {
  console.log(`PASS ${label}`)
}

function prepareDatabase(): { cleanup: () => void } {
  if (process.env['NODE_ENV']?.trim().toLowerCase() === 'production') {
    throw new Error('VERIFICATION_DATABASE_PRODUCTION_FORBIDDEN')
  }
  const previousDatabaseUrl = process.env['DATABASE_URL']
  const previousTarget = process.env['VERIFICATION_DATABASE_TARGET']
  const directory = mkdtempSync(join(tmpdir(), 'verify-admin-fulfillment-lists-'))
  const databasePath = join(directory, 'verify-admin-fulfillment-lists.db')
  closeSync(openSync(databasePath, 'a'))
  process.env['DATABASE_URL'] = `file:${databasePath}`
  process.env['VERIFICATION_DATABASE_TARGET'] = 'isolated'
  assertIsolatedVerificationDatabase()
  const apiRoot = join(__dirname, '..')
  const prismaCli = join(apiRoot, 'node_modules', 'prisma', 'build', 'index.js')
  try {
    execFileSync(process.execPath, [prismaCli, 'migrate', 'deploy'], {
      cwd: apiRoot,
      env: { ...process.env, DATABASE_URL: `file:${databasePath}` },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch (error) {
    rmSync(directory, { recursive: true, force: true })
    const err = error as { stderr?: string; stdout?: string; message?: string }
    throw new Error(`prisma migrate deploy failed: ${(err.stderr || err.stdout || err.message || 'unknown').trim()}`)
  }
  return {
    cleanup: () => {
      if (previousDatabaseUrl === undefined) delete process.env['DATABASE_URL']
      else process.env['DATABASE_URL'] = previousDatabaseUrl
      if (previousTarget === undefined) delete process.env['VERIFICATION_DATABASE_TARGET']
      else process.env['VERIFICATION_DATABASE_TARGET'] = previousTarget
      rmSync(directory, { recursive: true, force: true })
    },
  }
}

interface Reply {
  status: number
  raw: string
  body: { data?: AdminFulfillmentListPage; error?: { code?: string; message?: string } }
}

async function main(): Promise<void> {
  const moduleSource = readFileSync(join(__dirname, '../src/admin-print-scan/admin-print-scan.module.ts'), 'utf8')
  assert.match(moduleSource, /AdminFulfillmentListsController/)
  assert.match(moduleSource, /AdminFulfillmentListsService/)
  pass('只读列表挂在打印扫描管理模块上，不改原来的任务控制器')

  const db = prepareDatabase()
  delete process.env['ADMIN_IP_ALLOWLIST']
  const secret = 'verify-admin-fulfillment-lists-secret'
  process.env['JWT_SECRET'] = secret
  const prisma = new PrismaService()
  const jwt = new JwtService({ secret, signOptions: { expiresIn: '15m' } })
  const redis = {
    get: async () => null,
    setJsonIfVersionNotOlder: async () => 'ok',
  } as unknown as RedisService
  const suffix = randomUUID().slice(0, 8)
  const orgId = `ffl-org-${suffix}`
  const adminId = `ffl-admin-${suffix}`
  const partnerId = `ffl-partner-${suffix}`
  const endUserId = `eu-secret-${suffix}`
  const phone = `PHONE-SECRET-${suffix}`
  const quote = `SECRET_QUOTE_${suffix}`
  const fileUrl = `https://files.invalid/secret-${suffix}.pdf`
  const errorMessage = `SECRET_ERROR_MESSAGE_${suffix}`
  const pickup = `PICKUP-SECRET-${suffix}`
  const fileId = `file-secret-${suffix}`
  const itemFileId = `item-file-secret-${suffix}`
  const termA = `ffl-term-a-${suffix}`
  const termB = `ffl-term-b-${suffix}`
  const secrets = [phone, quote, fileUrl, errorMessage, pickup, fileId, itemFileId, endUserId]
  let app: Awaited<ReturnType<typeof NestFactory.create>> | undefined

  async function call(path: string, token?: string): Promise<Reply> {
    const headers: Record<string, string> = {}
    if (token) headers.authorization = `Bearer ${token}`
    const res = await fetch(`${await app!.getUrl()}/api/v1${path}`, { headers })
    const raw = await res.text()
    let body: Reply['body'] = {}
    try { body = JSON.parse(raw) as Reply['body'] } catch { body = {} }
    return { status: res.status, raw, body }
  }

  function assertClean(raw: string, label: string): void {
    for (const secret of secrets) assert.equal(raw.includes(secret), false, `${label} 泄漏了 ${secret}`)
  }

  function assertItem(item: AdminFulfillmentListItem): void {
    assert.deepEqual(Object.keys(item).sort(), ITEM_KEYS)
  }

  try {
    await prisma.organization.create({ data: { id: orgId, name: '履约列表验证机构', type: 'test' } })
    await prisma.user.create({ data: { id: adminId, username: adminId, passwordHash: 'x', name: '履约列表管理员', role: 'admin' } })
    await prisma.user.create({ data: { id: partnerId, username: partnerId, passwordHash: 'x', name: '履约列表机构账号', role: 'partner', orgId } })
    await prisma.endUser.create({ data: { id: endUserId, phoneHash: endUserId, phoneEnc: phone, enabled: true } })
    for (const [id, code] of [[termA, `KSK-A-${suffix}`], [termB, `KSK-B-${suffix}`]] as const) {
      await prisma.terminal.create({ data: { id, terminalCode: code, agentToken: `token-${id}`, deviceFingerprint: id, orgId } })
    }
    const adminToken = jwt.sign({ sub: adminId, ver: 0, jti: randomUUID() })
    const partnerToken = jwt.sign({ sub: partnerId, ver: 0, jti: randomUUID() })

    @Module({
      controllers: [AdminFulfillmentListsController],
      providers: [
        AdminFulfillmentListsService,
        JwtAuthGuard,
        RolesGuard,
        Reflector,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwt },
        { provide: RedisService, useValue: redis },
      ],
    })
    class FixtureModule {}

    app = await NestFactory.create(FixtureModule, { logger: false })
    app.setGlobalPrefix('api/v1')
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
    app.useGlobalFilters(new HttpExceptionFilter())
    await app.listen(0, '127.0.0.1')

    const missing = await call('/admin/print-scan/copy-jobs')
    assert.equal(missing.status, 401)
    assert.equal(missing.body.error?.code, 'AUTH_MISSING_TOKEN')
    const deniedCopy = await call('/admin/print-scan/copy-jobs', partnerToken)
    const deniedPack = await call('/admin/print-scan/material-pack-orders', partnerToken)
    assert.equal(deniedCopy.status, 403)
    assert.equal(deniedPack.status, 403)
    assert.equal(deniedCopy.body.error?.code, 'AUTH_ROLE_FORBIDDEN')
    assert.equal(deniedPack.body.error?.code, 'AUTH_ROLE_FORBIDDEN')
    pass('未登录 401；机构账号打两个只读列表都是 403')

    const emptyCopy = await call('/admin/print-scan/copy-jobs', adminToken)
    const emptyPack = await call('/admin/print-scan/material-pack-orders', adminToken)
    assert.equal(emptyCopy.status, 200)
    assert.equal(emptyPack.status, 200)
    assert.equal(emptyCopy.body.data?.pagination.total, 0)
    assert.equal(emptyPack.body.data?.pagination.total, 0)
    assert.equal(emptyCopy.body.data?.pagination.totalPages, 0)
    assert.deepEqual(emptyCopy.body.data?.items, [])
    assert.deepEqual(emptyPack.body.data?.items, [])
    pass('还没有任务时两个列表都是空的')

    const badCopy = await call('/admin/print-scan/copy-jobs?status=handed', adminToken)
    const badPack = await call('/admin/print-scan/material-pack-orders?status=scanning', adminToken)
    assert.equal(badCopy.status, 400)
    assert.equal(badPack.status, 400)
    assert.equal(badCopy.body.error?.code, 'FULFILLMENT_STATUS_UNKNOWN')
    assert.equal(badPack.body.error?.message, '无法识别的状态筛选')
    pass('认不出的状态筛选被拒绝')

    const paperTask = `ffl-task-paper-${suffix}`
    const unsafeTask = `ffl-task-unsafe-${suffix}`
    await prisma.printTask.create({ data: { id: paperTask, terminalId: termA, fileUrl, fileMd5: 'abc', errorCode: 'PAPER_EMPTY', errorMessage: `${errorMessage} ${fileId}`, status: 'failed' } })
    await prisma.printTask.create({ data: { id: unsafeTask, terminalId: termA, fileUrl, fileMd5: 'def', errorCode: 'bad/code', errorMessage: `${errorMessage} ${fileId}`, status: 'failed' } })
    await prisma.copyJob.create({ data: {
      id: `copy-paper-${suffix}`, terminalId: termA, organizationId: orgId, endUserId, state: 'failed', source: 'flatbed',
      copies: 2, requestKey: `req-paper-${suffix}`, resultCode: 'PAPER_EMPTY', quoteSnapshot: quote, expiresAt: new Date('2026-12-01T00:00:00.000Z'),
      createdAt: new Date('2026-11-18T02:15:00.000Z'),
    } })
    await prisma.copyJob.create({ data: {
      id: `copy-queue-${suffix}`, terminalId: termA, organizationId: orgId, state: 'ready', source: 'flatbed',
      copies: 1, requestKey: `req-queue-${suffix}`, expiresAt: new Date('2026-12-01T00:00:00.000Z'),
      createdAt: new Date('2026-11-18T01:00:00.000Z'),
    } })
    await prisma.copyJob.create({ data: {
      id: `copy-scan-${suffix}`, terminalId: termB, organizationId: orgId, state: 'scanning', source: 'feeder',
      copies: 3, requestKey: `req-scan-${suffix}`, expiresAt: new Date('2026-12-01T00:00:00.000Z'),
      createdAt: new Date('2026-11-18T00:30:00.000Z'),
    } })
    await prisma.copyJob.create({ data: {
      id: `copy-unknown-${suffix}`, terminalId: termA, organizationId: orgId, state: 'failed', source: 'flatbed',
      copies: 1, requestKey: `req-unknown-${suffix}`, resultCode: 'NOT_IN_TABLE', expiresAt: new Date('2026-12-01T00:00:00.000Z'),
      createdAt: new Date('2026-11-17T00:00:00.000Z'),
    } })
    await prisma.copyJob.create({ data: {
      id: `copy-open-${suffix}`, terminalId: termA, organizationId: orgId, state: 'unconfirmed', source: 'flatbed',
      copies: 1, requestKey: `req-open-${suffix}`, expiresAt: new Date('2026-12-01T00:00:00.000Z'),
      createdAt: new Date('2026-11-16T00:00:00.000Z'),
    } })
    await prisma.copyJob.create({ data: {
      id: `copy-unsafe-${suffix}`, terminalId: termA, organizationId: orgId, state: 'failed', source: 'flatbed',
      copies: 1, requestKey: `req-unsafe-${suffix}`, resultCode: 'bad/code', quoteSnapshot: quote, expiresAt: new Date('2026-12-01T00:00:00.000Z'),
      createdAt: new Date('2026-11-15T00:00:00.000Z'),
    } })

    const paperOrder = `ffl-order-paper-${suffix}`
    const mixedOrder = `ffl-order-mixed-${suffix}`
    const unsafeOrder = `ffl-order-unsafe-${suffix}`
    const decoyCopy = `ffl-order-copy-${suffix}`
    const decoyEmpty = `ffl-order-empty-${suffix}`
    await prisma.order.create({ data: { id: paperOrder, orderNo: `MP-PAPER-${suffix}`, type: 'print', terminalId: termA, taskStatus: 'failed', pickupCode: pickup, createdAt: new Date('2026-11-18T03:00:00.000Z') } })
    await prisma.order.create({ data: { id: mixedOrder, orderNo: `MP-MIX-${suffix}`, type: 'print', terminalId: termB, taskStatus: 'completed', createdAt: new Date('2026-11-18T02:00:00.000Z') } })
    await prisma.order.create({ data: { id: unsafeOrder, orderNo: `MP-UNSAFE-${suffix}`, type: 'print', terminalId: termA, taskStatus: 'failed', createdAt: new Date('2026-11-18T01:00:00.000Z') } })
    await prisma.order.create({ data: { id: decoyCopy, orderNo: `MP-DECOY-COPY-${suffix}`, type: 'copy', terminalId: termA, taskStatus: 'failed', createdAt: new Date('2026-11-18T04:00:00.000Z') } })
    await prisma.order.create({ data: { id: decoyEmpty, orderNo: `MP-DECOY-EMPTY-${suffix}`, type: 'print', terminalId: termA, taskStatus: 'failed', createdAt: new Date('2026-11-18T04:30:00.000Z') } })
    await prisma.orderItem.create({ data: { orderId: paperOrder, seq: 1, fileId: itemFileId, colorMode: 'black_white', duplex: 'simplex', copies: 2, billablePages: 1, amountCents: 0, status: 'failed', printTaskId: paperTask } })
    await prisma.orderItem.create({ data: { orderId: paperOrder, seq: 2, fileId: `${itemFileId}-2`, colorMode: 'black_white', duplex: 'simplex', copies: 2, billablePages: 1, amountCents: 0, status: 'failed', printTaskId: paperTask } })
    await prisma.orderItem.create({ data: { orderId: mixedOrder, seq: 1, fileId: `${itemFileId}-m1`, colorMode: 'black_white', duplex: 'simplex', copies: 1, billablePages: 1, amountCents: 0, status: 'completed' } })
    await prisma.orderItem.create({ data: { orderId: mixedOrder, seq: 2, fileId: `${itemFileId}-m2`, colorMode: 'black_white', duplex: 'simplex', copies: 3, billablePages: 1, amountCents: 0, status: 'completed' } })
    await prisma.orderItem.create({ data: { orderId: unsafeOrder, seq: 1, fileId: `${itemFileId}-u`, colorMode: 'black_white', duplex: 'simplex', copies: 1, billablePages: 1, amountCents: 0, status: 'failed', printTaskId: unsafeTask } })
    await prisma.orderItem.create({ data: { orderId: decoyCopy, seq: 1, fileId: `${itemFileId}-c`, colorMode: 'black_white', duplex: 'simplex', copies: 9, billablePages: 1, amountCents: 0, status: 'failed', printTaskId: paperTask } })

    const listed = await call('/admin/print-scan/copy-jobs?pageSize=1', adminToken)
    assert.equal(listed.status, 200)
    assert.equal(listed.body.data?.pagination.total, 6)
    assert.equal(listed.body.data?.items.length, 1)
    assert.equal(listed.body.data?.items[0]?.id, `copy-paper-${suffix}`)
    assert.equal(listed.body.data?.items[0]?.failureReason, '缺纸')
    assert.equal(listed.body.data?.items[0]?.terminalCode, `KSK-A-${suffix}`)
    assert.equal(listed.body.data?.items[0]?.copies, 2)
    assert.equal(listed.body.data?.items[0]?.status, 'failed')
    assert.equal(listed.body.data?.items[0]?.statusLabel, '失败')
    assertItem(listed.body.data!.items[0]!)
    assertClean(listed.raw, '复印第一页')

    const copies = await call(`/admin/print-scan/copy-jobs?terminalId=${termA}&status=failed`, adminToken)
    assert.equal(copies.body.data?.items.map((item) => item.failureReason).join('|'), '缺纸|复印失败（未归类）|复印失败（原因无法识别）')
    const scanning = await call(`/admin/print-scan/copy-jobs?terminalId=${termB}`, adminToken)
    assert.equal(scanning.body.data?.items.length, 1)
    assert.equal(scanning.body.data?.items[0]?.statusLabel, '扫描中')
    assert.equal(scanning.body.data?.items[0]?.failureReason, null)
    const none = await call(`/admin/print-scan/copy-jobs?terminalId=missing-${suffix}`, adminToken)
    assert.deepEqual(none.body.data?.items, [])
    const open = await call('/admin/print-scan/copy-jobs?status=unconfirmed', adminToken)
    assert.equal(open.body.data?.items[0]?.failureReason, '出纸未确认，不能当成已经印完')
    assert.equal(open.body.data?.items[0]?.statusLabel, '出纸未确认')
    for (const reply of [copies, scanning, none, open]) assertClean(reply.raw, '复印筛选')
    pass('复印按时间和终端倒序，状态筛选与失败原因说人话')

    const packs = await call('/admin/print-scan/material-pack-orders', adminToken)
    assert.equal(packs.status, 200)
    assert.equal(packs.body.data?.pagination.total, 3)
    const packRows = packs.body.data?.items ?? []
    packRows.forEach(assertItem)
    assert.deepEqual(packRows.map((item) => item.recordNo), [`MP-PAPER-${suffix}`, `MP-MIX-${suffix}`, `MP-UNSAFE-${suffix}`])
    assert.equal(packRows[0]?.copies, 2)
    assert.equal(packRows[0]?.lineCount, 2)
    assert.equal(packRows[0]?.failureReason, '缺纸')
    assert.equal(packRows[1]?.copies, null)
    assert.equal(packRows[1]?.lineCount, 2)
    assert.equal(packRows[1]?.failureReason, null)
    assert.equal(packRows[1]?.terminalCode, `KSK-B-${suffix}`)
    assert.equal(packRows[2]?.failureReason, '材料包打印失败（原因无法识别）')
    assert.equal(packs.raw.includes(`MP-DECOY-COPY-${suffix}`), false)
    assert.equal(packs.raw.includes(`MP-DECOY-EMPTY-${suffix}`), false)
    assertClean(packs.raw, '材料包')
    const packNone = await call(`/admin/print-scan/material-pack-orders?terminalId=missing-${suffix}`, adminToken)
    assert.deepEqual(packNone.body.data?.items, [])
    const packFailed = await call(`/admin/print-scan/material-pack-orders?status=failed&terminalId=${termA}`, adminToken)
    assert.equal(packFailed.body.data?.items.length, 2)
    pass('材料包只列出有订单行且不是复印的单，失败原因不带回文件地址')
  } finally {
    if (app) await app.close()
    else await prisma.onModuleDestroy()
    db.cleanup()
  }
}

main().then(() => {
  console.log('verify:admin-fulfillment-lists passed')
}).catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
