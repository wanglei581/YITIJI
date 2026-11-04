import assert from 'node:assert/strict'
import { randomInt, randomUUID } from 'node:crypto'
import { HttpException } from '@nestjs/common'
import type { Redis } from 'ioredis'
import { encryptPhone, hashPhone } from '../../src/common/crypto/phone-identity'
import type { RedisService } from '../../src/common/redis/redis.service'
import type { MemberDataExportRedisService } from '../../src/common/redis/member-data-export-redis.service'
import { FilesService } from '../../src/files/files.service'
import { StorageService } from '../../src/storage/storage.service'
import { MemberClosureService } from '../../src/member-privacy/member-closure.service'
import { MemberClosureRedisService } from '../../src/member-privacy/member-closure-redis.service'
import { TerminalCapabilitiesService } from '../../src/terminals/terminal-capabilities.service'
import type { CopyJobStore } from '../../src/copy-jobs/copy-job-store.service'
import type { CopyJobsService } from '../../src/copy-jobs/copy-jobs.service'
import type { CopyAgentService } from '../../src/copy-jobs/copy-agent.service'
import type { CopyPermit } from '../../src/copy-jobs/copy-job.types'
import { ClosureMemoryRedis } from './member-closure-verification'

/** 在实际 HTTP 许可与实际数据库之间钉住交错点，不用计时碰运气；Redis transport 用既有夹具。 */
export async function verifyCopyC1c(store: CopyJobStore, jobs: CopyJobsService, agent: CopyAgentService,
  terminalId: string, permit: (id: string, op: 'scan' | 'print') => Promise<CopyPermit>) {
  const prisma = store.prisma, capabilities = new TerminalCapabilitiesService(prisma)
  const members: string[] = [], ids: string[] = [], orders: string[] = []
  const previousSecret = process.env['SECRET_ENCRYPTION_KEY']
  const previousStorage = process.env['FILE_STORAGE_DRIVER']
  process.env['SECRET_ENCRYPTION_KEY'] ??= 'verify-copy-c1c-secret-01234567890123456789'
  process.env['FILE_STORAGE_DRIVER'] = 'local'
  const memory = new ClosureMemoryRedis()
  const closureRedis = new MemberClosureRedisService(memory as unknown as Redis,
    memory as unknown as RedisService, memory as unknown as MemberDataExportRedisService, prisma)
  const closure = new MemberClosureService(prisma, new FilesService(prisma, store.audit, new StorageService()),
    closureRedis, store.audit)
  const actor = { userId: `copy-c1c-admin-${randomUUID()}`, role: 'admin' }
  const setCopy = (status: string) => capabilities.upsert(terminalId, 'copy', status, undefined, actor.userId)
  const create = async (user: string | null = null) => {
    const job = await jobs.create({ terminalId, requestKey: randomUUID(), source: 'flatbed',
      colorMode: 'black_white', duplex: 'simplex', copies: 1 }, user)
    ids.push(job.copyId)
    return { ...job, controlToken: (job as { controlToken: string }).controlToken }
  }
  const confirmed = async (user: string | null = null) => {
    const job = await create(user)
    const scanned = await agent.scanResult(terminalId, job.copyId, { generation: job.generation, pageCount: 2 })
    const result = await jobs.confirm(job.copyId, terminalId, user, job.controlToken, scanned.quoteVersion!)
    orders.push(result.orderId!)
    return { ...job, ...result }
  }
  const check = async (label: string, operation: () => Promise<void>) => {
    try { await operation() } catch (error) { console.error(`FAIL ${label}`); throw error }
    console.log(`PASS ${label}`)
  }
  try {
    await prisma.user.create({ data: { id: actor.userId, username: actor.userId,
      name: '隔离回归管理员', passwordHash: 'not-a-login-password', role: 'admin' } })
    for (const state of ['handed', 'unconfirmed'] as const) {
      await check(`C1c 注销：会员复印 ${state} 后可注销，confirmed/dispatching 时仍阻断`, async () => {
        const phone = `139${randomInt(10000000, 99999999)}`
        const user = await prisma.endUser.create({ data: { phoneHash: hashPhone(phone), phoneEnc: encryptPhone(phone),
          enabled: true, status: 'active' } })
        members.push(user.id)
        const job = await confirmed(user.id)
        const close = () => closure.execute(user.id, { source: 'offline', phoneLast4: phone.slice(-4),
          reasonText: '隔离回归注销', offlineEvidenceNo: 'verify-copy-c1c' }, actor)
        const blocked = () => assert.rejects(close, (error: unknown) => error instanceof HttpException
          && (error.getResponse() as { error: { code: string } }).error.code === 'CLOSURE_BLOCKED_BY_OPEN_ORDERS')
        await blocked()
        assert.equal((await permit(job.copyId, 'print')).allowed, true)
        await blocked()
        await agent.result(terminalId, job.copyId, { generation: job.generation, eventId: randomUUID(), state })
        assert.equal((await close()).status, 'anonymized', `${state} 复印终态不得阻断注销`)
        assert.equal((await store.find(job.copyId)).state, state, 'CopyJob 保留真实语义')
        assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: job.orderId! } })).taskStatus, 'completed')
      })
    }
    await check('C1c 许可：扫描 CAS 成功后用户取消，响应拒绝且不携带撤销后的版本', async () => {
      const job = await create(), originalFind = store.find.bind(store)
      let reads = 0, cancelled = false
      store.find = async (...args: Parameters<CopyJobStore['find']>) => {
        if (args[0] === job.copyId && ++reads === 2) {
          // 第二次 find 只会在许可 CAS 成功后发生；此时让真实取消写库先提交。
          assert.equal((await originalFind(job.copyId)).state, 'scanning')
          const result = await jobs.cancel(job.copyId, terminalId, null, job.controlToken, job.generation)
          assert.equal(result.state, 'cancelled')
          assert.equal(result.authorizationVersion, job.authorizationVersion + 1)
          cancelled = true
        }
        return originalFind(...args)
      }
      try {
        const response = await permit(job.copyId, 'scan')
        assert.ok(cancelled, '取消交错必须实际执行')
        assert.equal(response.allowed, false, '取消提交后仍给扫描许可')
        assert.equal(response.reason, 'COPY_STATE_CONFLICT')
        assert.equal(response.authorizationVersion, job.authorizationVersion, '只能返回 CAS 快照版本')
        assert.equal((await store.find(job.copyId)).state, 'cancelled')
      } finally { store.find = originalFind }
    })
    for (const op of ['scan', 'print'] as const) {
      await check(`C1c 能力：${op} 首读 available 后管理员关闭已提交，拒绝许可并撤回授权`, async () => {
        const job = op === 'scan' ? await create() : await confirmed()
        const originalCapable = store.capable.bind(store)
        let reads = 0, disabled = false
        store.capable = async (...args: Parameters<CopyJobStore['capable']>) => {
          const result = await originalCapable(...args)
          if (++reads === 1) { await setCopy('maintenance'); disabled = true }
          return result
        }
        try {
          const response = await permit(job.copyId, op)
          assert.ok(disabled, '管理员关闭必须先提交')
          assert.equal(response.allowed, false, '关闭提交后仍给新许可')
          assert.equal(response.reason, 'COPY_CAPABILITY_REVOKED')
          const fresh = await store.find(job.copyId)
          assert.equal(fresh.state, op === 'scan' ? 'ready' : 'confirmed')
          assert.equal(fresh.authorizationVersion, job.authorizationVersion + 1, '撤回必须作废旧授权')
        } finally { store.capable = originalCapable; await setCopy('available') }
        const retried = await permit(job.copyId, op)
        assert.equal(retried.allowed, true, '能力恢复后可按新版本重试')
        assert.equal(retried.authorizationVersion, job.authorizationVersion + 1)
      })
    }
    await check('C1c 回报：能力关闭后已派发任务的终态仍可收', async () => {
      const job = await confirmed()
      assert.equal((await permit(job.copyId, 'print')).allowed, true)
      await setCopy('maintenance')
      try {
        assert.equal((await agent.result(terminalId, job.copyId,
          { generation: job.generation, eventId: randomUUID(), state: 'handed' })).state, 'handed')
        assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: job.orderId! } })).taskStatus, 'completed')
      } finally { await setCopy('available') }
    })
  } finally {
    await prisma.copyJob.deleteMany({ where: { id: { in: ids } } })
    await prisma.order.deleteMany({ where: { id: { in: orders } } })
    await prisma.userDataRequest.deleteMany({ where: { endUserId: { in: members } } })
    await prisma.auditLog.deleteMany({ where: { targetId: { in: [...ids, ...orders, ...members] } } })
    await prisma.endUser.deleteMany({ where: { id: { in: members } } })
    await prisma.user.deleteMany({ where: { id: actor.userId } })
    if (previousSecret === undefined) delete process.env['SECRET_ENCRYPTION_KEY']
    else process.env['SECRET_ENCRYPTION_KEY'] = previousSecret
    if (previousStorage === undefined) delete process.env['FILE_STORAGE_DRIVER']
    else process.env['FILE_STORAGE_DRIVER'] = previousStorage
  }
}
