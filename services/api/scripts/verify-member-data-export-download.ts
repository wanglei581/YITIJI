import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA, ROUTE_ARGS_METADATA } from '@nestjs/common/constants'
import { RequestMethod } from '@nestjs/common'
import { Redis } from 'ioredis'
import { MemberDataExportRedisService } from '../src/common/redis/member-data-export-redis.service'

interface TicketPayload {
  requestId: string
  endUserId: string
  fileId: string
  executionVersion: number
  requestDigest: string
  endUserDigest: string
}

interface ExportRedisApi {
  registerTicket(args: {
    ticketDigest: string
    payload: TicketPayload
    ttlSeconds: number
  }): Promise<'stored' | 'exists'>
  claimTicket(args: {
    ticketDigest: string
    expectedRequestId: string
    claimDigest: string
    claimTtlSeconds: number
  }): Promise<{ status: 'claimed'; payload: string } | { status: 'missing' | 'busy' }>
  beginFinish(claimDigest: string): Promise<
    { status: 'matched'; payload: string } | { status: 'missing' | 'mismatched' }
  >
  completeClaim(claimDigest: string): Promise<'matched' | 'missing' | 'mismatched'>
  abortClaim(claimDigest: string): Promise<'matched' | 'missing' | 'mismatched'>
  revokeTicketsByRequest(requestDigest: string): Promise<number>
  revokeCapabilitiesByRequest(requestDigest: string): Promise<number>
  revokeCapabilitiesByUser(endUserDigest: string): Promise<number>
  cleanupExpiredClaims(nowEpochSeconds: number, limit: number): Promise<number>
  takeDueClaims(nowEpochSeconds: number, limit: number): Promise<{
    cleaned: number
    recoverable: Array<{ claimDigest: string; payload: TicketPayload }>
  }>
}

let passed = 0
let failed = 0

async function check(label: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn()
    passed += 1
    console.log(`PASS ${label}`)
  } catch (error) {
    failed += 1
    console.error(`FAIL ${label}`)
    console.error(error instanceof Error ? `${error.name}: ${error.message}` : 'UnknownError')
  }
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

async function unusedLoopbackPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert.ok(address && typeof address === 'object')
  const port = address.port
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return port
}

async function startRedis(): Promise<{
  client: Redis
  process: ChildProcess
  directory: string
}> {
  const directory = await mkdtemp(join(tmpdir(), 'member-export-redis-'))
  const port = await unusedLoopbackPort()
  const child = spawn('redis-server', [
    '--bind', '127.0.0.1',
    '--port', String(port),
    '--protected-mode', 'yes',
    '--save', '',
    '--appendonly', 'no',
    '--dir', directory,
    '--databases', '16',
  ], { stdio: 'ignore' })
  const client = new Redis({
    host: '127.0.0.1',
    port,
    db: 15,
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  })
  client.on('error', () => undefined)
  let lastError: unknown
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      if (client.status === 'wait') await client.connect()
      await client.ping()
      return { client, process: child, directory }
    } catch (error) {
      lastError = error
      if (client.status === 'end') {
        client.disconnect()
        await stopRedis(child, directory)
        throw error
      }
      await new Promise((resolve) => setTimeout(resolve, 25))
    }
  }
  client.disconnect()
  await stopRedis(child, directory)
  throw lastError
}

async function stopRedis(child: ChildProcess, directory: string): Promise<void> {
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGTERM')
    await Promise.race([
      new Promise<void>((resolve) => child.once('exit', () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 1_000)),
    ])
  }
  await rm(directory, { recursive: true, force: true })
}

async function scanKeys(client: Redis, pattern: string): Promise<string[]> {
  let cursor = '0'
  const keys: string[] = []
  do {
    const result = await client.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
    cursor = result[0]
    keys.push(...result[1])
  } while (cursor !== '0')
  return keys
}

async function cleanupMarkerKeys(client: Redis, markerPrefix: string): Promise<void> {
  const keys = await scanKeys(client, `${markerPrefix}:*`)
  if (keys.length > 0) await client.del(...keys)
}

function payload(seed: string): TicketPayload {
  const requestId = `request-${seed}`
  const endUserId = `member-${seed}`
  return {
    requestId,
    endUserId,
    fileId: `file-${seed}`,
    executionVersion: 3,
    requestDigest: digest(requestId),
    endUserDigest: digest(endUserId),
  }
}

async function verifyRedisPrimitives(redis: ExportRedisApi, client: Redis, markerPrefix: string): Promise<void> {
  await check('ticket 只存摘要、TTL 与 request/user 反向索引', async () => {
    const record = payload('ttl')
    const ticket = randomBytes(32).toString('base64url')
    const result = await redis.registerTicket({
      ticketDigest: digest(ticket),
      payload: record,
      ttlSeconds: 600,
    })
    assert.equal(result, 'stored')
    const keys = await scanKeys(client, `${markerPrefix}:*`)
    assert.ok(keys.length >= 3)
    assert.ok(keys.every((key) => !key.includes(ticket)))
    assert.ok(keys.every((key) => !key.includes(record.requestId) && !key.includes(record.endUserId)))
    const ticketKey = keys.find((key) => key.endsWith(digest(ticket)))
    assert.ok(ticketKey)
    const ttl = await client.ttl(ticketKey)
    assert.ok(ttl > 590 && ttl <= 600)
  })

  await check('跨 request 不消费 ticket，正确 path 可继续 claim', async () => {
    const record = payload('cross-request')
    const ticketDigest = digest(randomBytes(32).toString('base64url'))
    await redis.registerTicket({ ticketDigest, payload: record, ttlSeconds: 600 })
    const wrong = await redis.claimTicket({
      ticketDigest,
      expectedRequestId: 'request-other',
      claimDigest: digest(randomBytes(32).toString('base64url')),
      claimTtlSeconds: 600,
    })
    assert.equal(wrong.status, 'missing')
    const claimDigest = digest(randomBytes(32).toString('base64url'))
    const matched = await redis.claimTicket({
      ticketDigest,
      expectedRequestId: record.requestId,
      claimDigest,
      claimTtlSeconds: 600,
    })
    assert.equal(matched.status, 'claimed')
    assert.deepEqual(JSON.parse((matched as { payload: string }).payload), record)
    assert.equal(await redis.abortClaim(claimDigest), 'matched')
  })

  await check('同 ticket 并发 claim 恰好一个 winner', async () => {
    const record = payload('concurrent')
    const ticketDigest = digest(randomBytes(32).toString('base64url'))
    await redis.registerTicket({ ticketDigest, payload: record, ttlSeconds: 600 })
    const claims = Array.from({ length: 12 }, () => digest(randomBytes(32).toString('base64url')))
    const results = await Promise.all(claims.map((claimDigest) => redis.claimTicket({
      ticketDigest,
      expectedRequestId: record.requestId,
      claimDigest,
      claimTtlSeconds: 600,
    })))
    assert.equal(results.filter((result) => result.status === 'claimed').length, 1)
    const winner = claims[results.findIndex((result) => result.status === 'claimed')]
    assert.ok(winner)
    assert.equal(await redis.abortClaim(winner), 'matched')
  })

  await check('finish/abort compare-and-act 且旧 claim 不删除 replacement', async () => {
    const record = payload('finish')
    const firstTicket = digest(randomBytes(32).toString('base64url'))
    const firstClaim = digest(randomBytes(32).toString('base64url'))
    await redis.registerTicket({ ticketDigest: firstTicket, payload: record, ttlSeconds: 600 })
    assert.equal((await redis.claimTicket({
      ticketDigest: firstTicket,
      expectedRequestId: record.requestId,
      claimDigest: firstClaim,
      claimTtlSeconds: 600,
    })).status, 'claimed')
    assert.equal((await redis.beginFinish(firstClaim)).status, 'matched')
    assert.equal(await redis.abortClaim(firstClaim), 'mismatched')
    assert.equal(await redis.completeClaim(firstClaim), 'matched')

    const replacementTicket = digest(randomBytes(32).toString('base64url'))
    const replacementClaim = digest(randomBytes(32).toString('base64url'))
    await redis.registerTicket({ ticketDigest: replacementTicket, payload: record, ttlSeconds: 600 })
    assert.equal((await redis.claimTicket({
      ticketDigest: replacementTicket,
      expectedRequestId: record.requestId,
      claimDigest: replacementClaim,
      claimTtlSeconds: 600,
    })).status, 'claimed')
    assert.notEqual(await redis.abortClaim(firstClaim), 'matched')
    assert.equal((await redis.beginFinish(replacementClaim)).status, 'matched')
    assert.equal(await redis.completeClaim(replacementClaim), 'matched')
  })

  await check('过期 claim 清理可重试且不消费 ready 账本', async () => {
    const record = payload('expiry')
    const ticketDigest = digest(randomBytes(32).toString('base64url'))
    const claimDigest = digest(randomBytes(32).toString('base64url'))
    await redis.registerTicket({ ticketDigest, payload: record, ttlSeconds: 5 })
    assert.equal((await redis.claimTicket({
      ticketDigest,
      expectedRequestId: record.requestId,
      claimDigest,
      claimTtlSeconds: 1,
    })).status, 'claimed')
    await new Promise((resolve) => setTimeout(resolve, 1_100))
    assert.ok(await redis.cleanupExpiredClaims(Math.floor(Date.now() / 1_000), 10) >= 0)
    assert.equal(await redis.cleanupExpiredClaims(Math.floor(Date.now() / 1_000), 10), 0)
    assert.equal(await redis.abortClaim(claimDigest), 'missing')
  })

  await check('finishing claim 延长恢复租约并由周期任务取回，不会静默过期', async () => {
    const record = payload('finishing-recovery')
    const ticketDigest = digest(randomBytes(32).toString('base64url'))
    const claimDigest = digest(randomBytes(32).toString('base64url'))
    await redis.registerTicket({ ticketDigest, payload: record, ttlSeconds: 5 })
    assert.equal((await redis.claimTicket({
      ticketDigest,
      expectedRequestId: record.requestId,
      claimDigest,
      claimTtlSeconds: 1,
    })).status, 'claimed')
    assert.equal((await redis.beginFinish(claimDigest)).status, 'matched')
    await new Promise((resolve) => setTimeout(resolve, 1_100))
    const due = await redis.takeDueClaims(Math.floor(Date.now() / 1_000) + 120, 10)
    assert.equal(due.recoverable.length, 1)
    assert.equal(due.recoverable[0]?.claimDigest, claimDigest)
    assert.equal(due.recoverable[0]?.payload.requestId, record.requestId)
    assert.equal(await redis.completeClaim(claimDigest), 'matched')
  })

  await check('request/user 反向撤销隔离且不含明文 capability', async () => {
    const first = payload('reverse-a')
    const second = payload('reverse-b')
    const firstTicket = randomBytes(32).toString('base64url')
    const secondTicket = randomBytes(32).toString('base64url')
    await redis.registerTicket({ ticketDigest: digest(firstTicket), payload: first, ttlSeconds: 600 })
    await redis.registerTicket({ ticketDigest: digest(secondTicket), payload: second, ttlSeconds: 600 })
    assert.equal(await redis.revokeTicketsByRequest(first.requestDigest), 1)
    assert.equal(await redis.revokeCapabilitiesByUser(second.endUserDigest), 1)
    const serialized = JSON.stringify(await Promise.all((await scanKeys(client, `${markerPrefix}:*`)).map(async (key) => ({
      key,
      dump: (await client.dump(key))?.toString('base64') ?? null,
    }))))
    assert.ok(!serialized.includes(firstTicket) && !serialized.includes(secondTicket))
  })
}

async function verifyAuthorization(redis: ExportRedisApi): Promise<void> {
  const module = await import('../src/member-privacy/member-data-export-download.service')
  const Service = module.MemberDataExportDownloadService as new (...args: unknown[]) => {
    authorizeDownload(endUserId: string, requestId: string, token: string): Promise<{
      requestId: string
      downloadUrl: string
      expiresAt: string
    }>
  }
  await check('authorization 消费 download step-up，跨用户拒绝且只返回 fragment URL', async () => {
    const row = {
      id: 'request-authorization', endUserId: 'member-owner', requestType: 'export', status: 'ready',
      exportFileId: 'file-authorization', exportExpiresAt: new Date(Date.now() + 3_600_000),
      executionVersion: 7, downloadConsumedAt: null,
    }
    const consumed: Array<{ owner: string; action: string }> = []
    const prisma = { userDataRequest: { findFirst: async ({ where }: { where: { endUserId: string } }) => where.endUserId === row.endUserId ? row : null } }
    const stepUp = { consumeGrant: async (owner: string, action: string) => { consumed.push({ owner, action }) } }
    const service = new Service(prisma, {}, redis, stepUp, {}, undefined)
    await assert.rejects(
      () => service.authorizeDownload('member-other', row.id, 'step-up-cross-user'),
      (error: unknown) => stableCode(error) === 'DATA_EXPORT_DOWNLOAD_UNAVAILABLE',
    )
    const result = await service.authorizeDownload(row.endUserId, row.id, 'step-up-owner')
    const url = new URL(result.downloadUrl)
    assert.equal(url.origin, 'https://kiosk.example.test')
    assert.equal(url.pathname, '/member/export-download')
    assert.equal(url.search, '')
    assert.match(url.hash, /^#request=request-authorization&ticket=[A-Za-z0-9_-]{43}$/)
    assert.deepEqual(consumed.map((entry) => entry.action), ['export_data_download', 'export_data_download'])
  })

  await check('生产下载页配置缺失 fail closed，且不消费 step-up', async () => {
    const previousUrl = process.env['MEMBER_EXPORT_PUBLIC_WEB_BASE_URL']
    const previousNodeEnv = process.env['NODE_ENV']
    delete process.env['MEMBER_EXPORT_PUBLIC_WEB_BASE_URL']
    process.env['NODE_ENV'] = 'production'
    let grants = 0
    try {
      const service = new Service({}, {}, redis, { consumeGrant: async () => { grants += 1 } }, {}, undefined)
      await assert.rejects(
        () => service.authorizeDownload('member-config', 'request-config', 'step-up-config'),
        (error: unknown) => stableCode(error) === 'DATA_EXPORT_DOWNLOAD_CONFIG_UNAVAILABLE',
      )
      assert.equal(grants, 0)
    } finally {
      if (previousUrl === undefined) delete process.env['MEMBER_EXPORT_PUBLIC_WEB_BASE_URL']
      else process.env['MEMBER_EXPORT_PUBLIC_WEB_BASE_URL'] = previousUrl
      if (previousNodeEnv === undefined) delete process.env['NODE_ENV']
      else process.env['NODE_ENV'] = previousNodeEnv
    }
  })

  await check('finish DB 事务失败仍入稳定 targeted job，claim 保持 finishing', async () => {
    const record = payload('finish-compensation')
    const ticketDigest = digest(randomBytes(32).toString('base64url'))
    const claimId = randomBytes(32).toString('base64url')
    const claimDigest = digest(claimId)
    await redis.registerTicket({ ticketDigest, payload: record, ttlSeconds: 600 })
    assert.equal((await redis.claimTicket({
      ticketDigest,
      expectedRequestId: record.requestId,
      claimDigest,
      claimTtlSeconds: 600,
    })).status, 'claimed')
    const jobs: Array<{ name: string; data: unknown; options: Record<string, unknown> }> = []
    const service = new Service(
      { $transaction: async () => { throw new Error('db unavailable') } },
      {},
      redis,
      {},
      {},
      { add: async (name: string, data: unknown, options: Record<string, unknown>) => { jobs.push({ name, data, options }) } },
    ) as unknown as { finishDownload(value: string): Promise<void> }
    await assert.rejects(() => service.finishDownload(claimId), /db unavailable/)
    assert.equal(jobs.length, 1)
    assert.equal(jobs[0]?.name, 'member.export.reconcile')
    assert.equal(jobs[0]?.options['jobId'], `export-reconcile-${record.requestDigest}-3-delivery-finished`)
    assert.equal(await redis.abortClaim(claimDigest), 'mismatched')
    assert.equal(await redis.completeClaim(claimDigest), 'matched')
  })
}

class FakeResponse extends EventEmitter {
  readonly headers = new Map<string, string | number>()
  body: Buffer | null = null
  setHeader(name: string, value: string | number): void { this.headers.set(name.toLowerCase(), value) }
  send(body: Buffer): void { this.body = body }
}

async function verifyController(): Promise<void> {
  const module = await import('../src/member-privacy/member-data-export.controller')
  const Controller = module.MemberDataExportController as new (service: unknown) => {
    download(id: string, ticket: string | undefined, response: FakeResponse): Promise<void>
  }
  await check('公开 controller 仅 GET header capability，无 JWT guard metadata', async () => {
    assert.equal(Reflect.getMetadata(PATH_METADATA, Controller), 'member/data-exports')
    assert.equal(Reflect.getMetadata(GUARDS_METADATA, Controller), undefined)
    assert.equal(Reflect.getMetadata(METHOD_METADATA, Controller.prototype.download), RequestMethod.GET)
    assert.equal(Reflect.getMetadata(PATH_METADATA, Controller.prototype.download), ':id/content')
    assert.equal(Reflect.getMetadata(GUARDS_METADATA, Controller.prototype.download), undefined)
    const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, Controller, 'download') as Record<string, { data?: string }>
    assert.ok(Object.values(args).some((entry) => entry.data === 'x-member-download-ticket'))
    assert.ok(!Object.values(args).some((entry) => entry.data === 'authorization'))
  })

  await check('finish/close 同步仲裁只有一个胜者且安全 header 完整', async () => {
    const calls = { finish: 0, abort: 0 }
    const service = {
      async claimDownload() {
        return { claimId: randomBytes(32).toString('base64url'), buffer: Buffer.from('{"ok":true}'), filename: 'member-data-export.json' }
      },
      async finishDownload() { calls.finish += 1 },
      async abortDownload() { calls.abort += 1 },
    }
    const controller = new Controller(service)
    const closed = new FakeResponse()
    await controller.download('request-close', randomBytes(32).toString('base64url'), closed)
    closed.emit('close')
    closed.emit('finish')
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(calls, { finish: 0, abort: 1 })

    const finished = new FakeResponse()
    await controller.download('request-finish', randomBytes(32).toString('base64url'), finished)
    finished.emit('finish')
    finished.emit('close')
    await new Promise((resolve) => setImmediate(resolve))
    assert.deepEqual(calls, { finish: 1, abort: 1 })
    assert.equal(finished.headers.get('cache-control'), 'no-store, private')
    assert.equal(finished.headers.get('x-content-type-options'), 'nosniff')
    assert.match(String(finished.headers.get('content-disposition')), /^attachment;/)
  })
}

async function verifyReconciler(): Promise<void> {
  const module = await import('../src/member-privacy/member-data-export-reconciler.service')
  const Reconciler = module.MemberDataExportReconcilerService as new (...args: unknown[]) => {
    reconcile(data: { requestId?: string; executionVersion?: number; reason: string }): Promise<unknown>
    reconcileRequest(requestId: string, executionVersion?: number): Promise<unknown>
    cleanupOrphanFiles(args?: { limit?: number }): Promise<{ deleted: number }>
  }
  await check('reconciler 物理删除 + FileObject 软删后才 CAS terminal', async () => {
    const row = {
      id: 'request-cleanup', requestType: 'export', status: 'handling', executionVersion: 2,
      executionStep: 'download_cleanup_pending', exportFileId: 'file-cleanup', exportExpiresAt: new Date(Date.now() + 60_000),
      downloadConsumedAt: new Date(), activeKey: 'member:privacy-exclusive', endUserId: 'member-cleanup',
    }
    const file = { id: 'file-cleanup', endUserId: row.endUserId, storageKey: 'opaque', bucket: 'local', deletedAt: null, purpose: 'member_data_export' }
    const updates: unknown[] = []
    let deleted = false
    const prisma = {
      userDataRequest: {
        findUnique: async () => ({ ...row }),
        updateMany: async (args: unknown) => { updates.push(args); return { count: 1 } },
      },
      fileObject: { findUnique: async () => ({ ...file, deletedAt: deleted ? new Date() : null }) },
      $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
        userDataRequest: {
          findUnique: async () => ({ ...row }),
          updateMany: async (args: unknown) => { updates.push(args); return { count: 1 } },
        },
      }),
    }
    const locks = { setNxEx: async () => true, getAndDelIfEquals: async () => 'matched' }
    const capabilities = { revokeCapabilitiesByRequest: async () => 0 }
    const files = { systemDelete: async () => { deleted = true } }
    const storage = { headObject: async () => deleted ? null : { sizeBytes: 10 } }
    const audit = { writeRequired: async () => 'audit-cleanup' }
    const reconciler = new Reconciler(prisma, locks, capabilities, files, storage, audit)
    await reconciler.reconcileRequest(row.id, row.executionVersion)
    assert.equal(deleted, true)
    assert.ok(updates.some((entry) => JSON.stringify(entry).includes('"activeKey":null')))
  })

  await check('NotFound 幂等需双证据；存储失败保留 activeKey 并写 EXPORT_CLEANUP_FAILED', async () => {
    const updates: Array<{ data?: Record<string, unknown> }> = []
    const row = {
      id: 'request-failure', requestType: 'export', status: 'handling', executionVersion: 4,
      executionStep: 'download_cleanup_pending', exportFileId: 'file-failure', exportExpiresAt: new Date(Date.now() + 60_000),
      downloadConsumedAt: new Date(), activeKey: 'keep-me', endUserId: 'member-failure',
    }
    const prisma = {
      userDataRequest: {
        findUnique: async () => ({ ...row }),
        updateMany: async (args: { data?: Record<string, unknown> }) => { updates.push(args); return { count: 1 } },
      },
      fileObject: { findUnique: async () => ({ id: row.exportFileId, endUserId: row.endUserId, storageKey: 'opaque', bucket: 'local', deletedAt: null, purpose: 'member_data_export' }) },
      $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
        userDataRequest: {
          findUnique: async () => ({ ...row }),
          updateMany: async (args: { data?: Record<string, unknown> }) => { updates.push(args); return { count: 1 } },
        },
      }),
    }
    const locks = { setNxEx: async () => true, getAndDelIfEquals: async () => 'matched' }
    const capabilities = { revokeCapabilitiesByRequest: async () => 0 }
    const files = { systemDelete: async () => { throw new Error('storage unavailable') } }
    const storage = { headObject: async () => { throw new Error('storage unavailable') } }
    const audit = { writeRequired: async () => 'audit-failed' }
    const reconciler = new Reconciler(prisma, locks, capabilities, files, storage, audit)
    await reconciler.reconcileRequest(row.id, row.executionVersion)
    const failure = updates.find((entry) => entry.data?.['failureCode'] === 'EXPORT_CLEANUP_FAILED')
    assert.ok(failure)
    assert.notEqual(failure.data?.['activeKey'], null)
  })

  await check('delivery_finished targeted job 可补偿 ready→cleanup→completed', async () => {
    const row: Record<string, unknown> = {
      id: 'request-delivery', endUserId: 'member-delivery', requestType: 'export', status: 'ready', executionVersion: 5,
      executionStep: null, exportFileId: 'file-delivery', exportExpiresAt: new Date(Date.now() + 60_000),
      downloadConsumedAt: null, activeKey: 'keep-until-clean', lastAttemptAt: null, requestedAt: new Date(), workerJobId: 'job',
    }
    let deleted = false
    const requestApi = {
      findUnique: async () => ({ ...row }),
      updateMany: async ({ data }: { data: Record<string, unknown> }) => { Object.assign(row, data); return { count: 1 } },
    }
    const prisma = {
      userDataRequest: requestApi,
      fileObject: { findUnique: async () => ({ id: row['exportFileId'], endUserId: row['endUserId'], purpose: 'member_data_export', storageKey: 'opaque', bucket: 'local', deletedAt: deleted ? new Date() : null }) },
      $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({ userDataRequest: requestApi }),
    }
    const reconciler = new Reconciler(
      prisma,
      { setNxEx: async () => true, getAndDelIfEquals: async () => 'matched' },
      { revokeCapabilitiesByRequest: async () => 0 },
      { systemDelete: async () => { deleted = true } },
      { headObject: async () => deleted ? null : { sizeBytes: 10 } },
      { writeRequired: async () => 'audit-delivery' },
    )
    await reconciler.reconcile({ requestId: String(row['id']), executionVersion: 5, reason: 'delivery_finished' })
    assert.ok(row['downloadConsumedAt'] instanceof Date)
    assert.equal(row['status'], 'completed')
    assert.equal(row['activeKey'], null)
  })

  await check('bound orphan 清后回普通 failed；无引用 orphan 有界清理', async () => {
    const row: Record<string, unknown> = {
      id: 'request-orphan', endUserId: 'member-orphan', requestType: 'export', status: 'failed', executionVersion: 8,
      executionStep: 'orphan_cleanup_pending', exportFileId: 'file-bound', exportExpiresAt: null,
      downloadConsumedAt: null, activeKey: 'must-remain', lastAttemptAt: new Date(), requestedAt: new Date(), workerJobId: null,
    }
    const deleted = new Set<string>()
    const filesById: Record<string, { id: string; endUserId: string; purpose: string; storageKey: string; bucket: string; deletedAt: Date | null; createdAt: Date }> = {
      'file-bound': { id: 'file-bound', endUserId: 'member-orphan', purpose: 'member_data_export', storageKey: 'bound', bucket: 'local', deletedAt: null, createdAt: new Date(0) },
      'file-unreferenced': { id: 'file-unreferenced', endUserId: 'member-other', purpose: 'member_data_export', storageKey: 'orphan', bucket: 'local', deletedAt: null, createdAt: new Date(0) },
    }
    const requestApi = {
      findUnique: async () => ({ ...row }),
      findFirst: async ({ where }: { where: { exportFileId: string } }) => where.exportFileId === 'file-bound' ? { id: row['id'] } : null,
      updateMany: async ({ data }: { data: Record<string, unknown> }) => { Object.assign(row, data); return { count: 1 } },
    }
    const prisma = {
      userDataRequest: requestApi,
      fileObject: {
        findUnique: async ({ where }: { where: { id: string } }) => {
          const file = filesById[where.id]
          return file ? { ...file, deletedAt: deleted.has(file.id) ? new Date() : file.deletedAt } : null
        },
        findMany: async () => [{ id: 'file-unreferenced' }],
      },
      $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({ userDataRequest: requestApi }),
    }
    const reconciler = new Reconciler(
      prisma,
      { setNxEx: async () => true, getAndDelIfEquals: async () => 'matched' },
      { revokeCapabilitiesByRequest: async () => 0 },
      { systemDelete: async (id: string) => { deleted.add(id) } },
      { headObject: async (key: string) => deleted.has(key === 'bound' ? 'file-bound' : 'file-unreferenced') ? null : { sizeBytes: 1 } },
      { writeRequired: async () => 'audit-orphan' },
    )
    await reconciler.reconcileRequest(String(row['id']), 8)
    assert.equal(row['status'], 'failed')
    assert.equal(row['executionStep'], null)
    assert.equal(row['exportFileId'], null)
    assert.equal(row['activeKey'], 'must-remain')
    assert.equal((await reconciler.cleanupOrphanFiles({ limit: 5 })).deleted, 1)
  })

  await check('required audit 失败不释放 activeKey', async () => {
    const row = {
      id: 'request-audit-failure', endUserId: 'member-audit', requestType: 'export', status: 'handling', executionVersion: 9,
      executionStep: 'download_cleanup_pending', exportFileId: 'file-audit', exportExpiresAt: new Date(Date.now() + 60_000),
      downloadConsumedAt: new Date(), activeKey: 'retain-on-audit-failure', lastAttemptAt: new Date(), requestedAt: new Date(), workerJobId: 'job',
    }
    let deleted = false
    const requestApi = { findUnique: async () => ({ ...row }), updateMany: async () => { throw new Error('must not update') } }
    const prisma = {
      userDataRequest: requestApi,
      fileObject: { findUnique: async () => ({ id: row.exportFileId, endUserId: row.endUserId, purpose: 'member_data_export', storageKey: 'opaque', bucket: 'local', deletedAt: deleted ? new Date() : null }) },
      $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({ userDataRequest: requestApi }),
    }
    const reconciler = new Reconciler(
      prisma,
      { setNxEx: async () => true, getAndDelIfEquals: async () => 'matched' },
      { revokeCapabilitiesByRequest: async () => 0 },
      { systemDelete: async () => { deleted = true } },
      { headObject: async () => null },
      { writeRequired: async () => { throw new Error('required audit unavailable') } },
    )
    await assert.rejects(() => reconciler.reconcileRequest(row.id, row.executionVersion), /required audit unavailable/)
    assert.equal(row.activeKey, 'retain-on-audit-failure')
  })
}

async function verifyScheduler(): Promise<void> {
  const module = await import('../src/member-privacy/member-privacy.scheduler')
  const Scheduler = module.MemberPrivacyScheduler as new (queue?: unknown) => { onModuleInit(): Promise<void> }
  await check('scheduler 仅 queue 存在时稳定 upsert 60 秒 periodic sweep', async () => {
    await new Scheduler(undefined).onModuleInit()
    const calls: unknown[][] = []
    await new Scheduler({ upsertJobScheduler: async (...args: unknown[]) => { calls.push(args) } }).onModuleInit()
    assert.equal(calls.length, 1)
    assert.equal(calls[0]?.[0], 'member-export-reconcile-sweep-v1')
    assert.deepEqual(calls[0]?.[1], { every: 60_000 })
    assert.equal((calls[0]?.[2] as { name?: string }).name, 'member.export.reconcile')
    assert.deepEqual((calls[0]?.[2] as { data?: unknown }).data, { reason: 'periodic_sweep' })
  })
}

async function verifySafeLogging(): Promise<void> {
  await check('运行时日志不包含 capability、对象 key、内容或原始异常消息', async () => {
    const sources = await Promise.all([
      '../src/member-privacy/member-data-export-download.service.ts',
      '../src/member-privacy/member-data-export-reconciler.service.ts',
      '../src/member-privacy/member-data-export.controller.ts',
      '../src/member-privacy/member-privacy.scheduler.ts',
    ].map((path) => readFile(new URL(path, import.meta.url), 'utf8')))
    const loggerLines = sources.flatMap((source) => source.split('\n').filter((line) => line.includes('this.logger.')))
    for (const line of loggerLines) {
      assert.doesNotMatch(line, /ticket|claimId|storageKey|objectKey|buffer|content|phone|error\.message|\$\{error\}/i)
    }
  })
}

async function main(): Promise<void> {
  console.log('\n=== Wave 1-B 一次性下载与对账验证 ===')
  const marker = `verify-member-export-${randomUUID().replace(/-/g, '')}`
  process.env['MEMBER_EXPORT_REDIS_NAMESPACE'] = marker
  process.env['MEMBER_EXPORT_PUBLIC_WEB_BASE_URL'] = 'https://kiosk.example.test'
  const runtime = await startRedis()
  try {
    const redis = new MemberDataExportRedisService(runtime.client) as unknown as ExportRedisApi
    await verifyRedisPrimitives(redis, runtime.client, marker)
    await verifyAuthorization(redis)
    await verifyController()
    await verifyReconciler()
    await verifyScheduler()
    await verifySafeLogging()
  } finally {
    await cleanupMarkerKeys(runtime.client, marker).catch(() => undefined)
    runtime.client.disconnect()
    await stopRedis(runtime.process, runtime.directory)
    delete process.env['MEMBER_EXPORT_REDIS_NAMESPACE']
    delete process.env['MEMBER_EXPORT_PUBLIC_WEB_BASE_URL']
  }

  if (failed > 0) {
    console.error(`\n❌ ${failed} 项失败，${passed} 项通过\n`)
    process.exitCode = 1
    return
  }
  console.log(`\n✅ member data export download verification passed (${passed} checks)\n`)
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? `${error.name}: ${error.message}` : 'UnknownError')
  process.exitCode = 1
})

function stableCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null
  const response = (error as { getResponse?: () => unknown }).getResponse?.()
  if (!response || typeof response !== 'object') return null
  const nested = (response as { error?: { code?: unknown } }).error?.code
  return typeof nested === 'string' ? nested : null
}
