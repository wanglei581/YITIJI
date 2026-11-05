import assert from 'node:assert/strict'
import { randomInt, randomUUID } from 'node:crypto'
import { HttpException } from '@nestjs/common'
import type { Redis } from 'ioredis'
import type { PrismaTransactionClient } from '../../src/prisma/prisma.service'
import { encryptPhone, hashPhone } from '../../src/common/crypto/phone-identity'
import type { RedisService } from '../../src/common/redis/redis.service'
import type { MemberDataExportRedisService } from '../../src/common/redis/member-data-export-redis.service'
import { FilesService } from '../../src/files/files.service'
import { StorageService } from '../../src/storage/storage.service'
import { MemberClosureService } from '../../src/member-privacy/member-closure.service'
import { MemberClosureRedisService } from '../../src/member-privacy/member-closure-redis.service'
import { AdminOrdersReadonlyService } from '../../src/admin-orders-readonly/admin-orders-readonly.service'
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
      await check(`C1d 版本协议：${op} 读版本后关闭先提交，CAS 拒绝且状态不回退`, async () => {
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
          assert.equal(response.reason, 'COPY_STATE_CONFLICT')
          const fresh = await store.find(job.copyId)
          assert.equal(fresh.state, op === 'scan' ? 'ready' : 'confirmed')
          assert.equal(fresh.authorizationVersion, job.authorizationVersion + 1, '关闭必须作废旧授权')
        } finally { store.capable = originalCapable; await setCopy('available') }
        const retried = await permit(job.copyId, op)
        assert.equal(retried.allowed, true, '能力恢复后可按新版本重试')
        assert.equal(retried.authorizationVersion, job.authorizationVersion + 1)
      })
    }
    await check('C1d 已派发：重复打印许可拒绝、关闭不回退、取消不成功、真实 handed 照收', async () => {
      const job = await confirmed()
      assert.equal((await permit(job.copyId, 'print')).allowed, true)
      const repeated = await permit(job.copyId, 'print')
      assert.equal(repeated.allowed, false, '已派发单不得重复发新许可')
      assert.equal(repeated.reason, 'COPY_ALREADY_DISPATCHED')
      assert.equal(repeated.parameters.pageCount, 2, '拒绝时参数仍可读')
      await setCopy('maintenance')
      try {
        assert.equal((await permit(job.copyId, 'print')).reason, 'COPY_ALREADY_DISPATCHED')
        assert.equal((await store.find(job.copyId)).state, 'dispatching', '关能力不得退回 confirmed')
        assert.equal((await jobs.cancel(job.copyId, terminalId, null, job.controlToken, job.generation)).state,
          'dispatching', '用户不得取消已经派发的任务')
        assert.equal((await agent.result(terminalId, job.copyId,
          { generation: job.generation, eventId: randomUUID(), state: 'handed' })).state, 'handed')
        assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: job.orderId! } })).taskStatus, 'completed')
      } finally { await setCopy('available') }
    })
    await check('C1d 版本协议：四种能力更新及清除均撤权，仅影响本终端未终态单', async () => {
      const ended = await confirmed()
      await permit(ended.copyId, 'print')
      await agent.result(terminalId, ended.copyId, { generation: ended.generation, eventId: randomUUID(), state: 'handed' })
      const finalVersion = (await store.find(ended.copyId)).authorizationVersion
      const otherTerminal = await prisma.terminal.create({ data: { id: randomUUID(), agentToken: randomUUID(), deviceFingerprint: randomUUID(),
        terminalCode: `copy-c1d-${randomUUID()}` } })
      try {
        const other = await prisma.copyJob.create({ data: { terminalId: otherTerminal.id, organizationId:
          (await store.find(ended.copyId)).organizationId, requestKey: randomUUID(), source: 'flatbed', colorMode: 'black_white',
          duplex: 'simplex', copies: 1, expiresAt: new Date(Date.now() + 60_000) } })
        for (const key of ['copy', 'scan_device', 'color_print', 'duplex_print']) {
          for (const clear of [false, true]) {
            const job = await confirmed(), originalCapable = store.capable.bind(store)
            let closed = false
            store.capable = async (...args: Parameters<CopyJobStore['capable']>) => {
              const result = await originalCapable(...args)
              if (!closed) {
                if (clear) await capabilities.clear(terminalId, key)
                else await capabilities.upsert(terminalId, key, 'testing', undefined, actor.userId)
                closed = true
              }
              return result
            }
            try {
              const response = await permit(job.copyId, 'print')
              assert.ok(closed)
              assert.equal(response.allowed, false, `${key} ${clear ? '清除' : '关闭'}先提交必须拒绝`)
              assert.equal(response.reason, 'COPY_STATE_CONFLICT')
              assert.equal((await store.find(job.copyId)).authorizationVersion, job.authorizationVersion + 1)
              assert.equal((await store.find(job.copyId)).state, 'confirmed')
            } finally {
              store.capable = originalCapable
              await capabilities.upsert(terminalId, key, 'available', undefined, actor.userId)
            }
          }
        }
        assert.equal((await store.find(ended.copyId)).authorizationVersion, finalVersion, '终态不撤权')
        assert.equal((await store.find(other.id)).authorizationVersion, other.authorizationVersion, '不得撤销别的终端')
      } finally {
        await prisma.copyJob.deleteMany({ where: { terminalId: otherTerminal.id } })
        await prisma.terminal.delete({ where: { id: otherTerminal.id } })
      }
    })
    await check('C1d 版本协议：撤权异常时能力更新或清除与版本一起回滚', async () => {
      const job = await confirmed()
      const internal = capabilities as unknown as { revokeCopyAuthorization:
        (tx: PrismaTransactionClient, terminalId: string, key: string) => Promise<void> }
      const revoke = internal.revokeCopyAuthorization.bind(capabilities)
      internal.revokeCopyAuthorization = async (...args) => {
        await revoke(...args)
        throw new Error('C1D_VERIFY_ROLLBACK')
      }
      try {
        for (const write of [() => setCopy('maintenance'), () => capabilities.clear(terminalId, 'copy')]) {
          await assert.rejects(write, /C1D_VERIFY_ROLLBACK/)
          assert.equal((await prisma.terminalCapability.findUniqueOrThrow({ where: {
            terminalId_capabilityKey: { terminalId, capabilityKey: 'copy' } } })).status, 'available')
          assert.equal((await store.find(job.copyId)).authorizationVersion, job.authorizationVersion)
        }
      } finally { internal.revokeCopyAuthorization = revoke }
    })
    await check('C1d 版本协议：许可 CAS 先提交，响应前关能力仍按 CAS 许可，终态回报照收', async () => {
      const job = await confirmed(), originalFind = store.find.bind(store)
      let reads = 0, closed = false
      store.find = async (...args: Parameters<CopyJobStore['find']>) => {
        if (args[0] === job.copyId && ++reads === 2) {
          assert.equal((await originalFind(job.copyId)).state, 'dispatching')
          await setCopy('maintenance')
          closed = true
        }
        return originalFind(...args)
      }
      try {
        const response = await permit(job.copyId, 'print')
        assert.ok(closed, '必须在 CAS 后、响应前完成关闭')
        assert.equal(response.allowed, true, 'CAS 先提交的授权不得事后撤回')
        assert.equal(response.authorizationVersion, job.authorizationVersion)
        assert.equal((await originalFind(job.copyId)).authorizationVersion, job.authorizationVersion + 1)
        assert.equal((await agent.result(terminalId, job.copyId,
          { generation: job.generation, eventId: randomUUID(), state: 'handed' })).state, 'handed')
      } finally { store.find = originalFind; await setCopy('available') }
    })
    await check('C1d 后台：复印真实结果、未确认需人工核查及错误码、完成筛选只含 handed', async () => {
      const admin = new AdminOrdersReadonlyService(prisma)
      const orderIds = new Map<string, string>()
      for (const state of ['handed', 'unconfirmed', 'failed', 'cancelled', 'expired']) {
        const job = await confirmed()
        orderIds.set(state, job.orderId!)
        if (['handed', 'unconfirmed', 'failed'].includes(state)) {
          await permit(job.copyId, 'print')
          await agent.result(terminalId, job.copyId, { generation: job.generation, eventId: randomUUID(),
            state: state as 'handed' | 'unconfirmed' | 'failed' })
        } else await prisma.copyJob.update({ where: { id: job.copyId }, data: { state } })
        const detail = await admin.getById(job.orderId!)
        assert.equal(detail.taskStatus, state, '后台不得使用注销映射冒充真实结果')
        assert.equal(detail.taskStatusLabel, ({ handed: '已交给打印机', unconfirmed: '结果未确认', failed: '失败',
          cancelled: '已取消', expired: '已过期' } as Record<string, string>)[state])
        assert.equal(detail.print, null)
        if (state === 'unconfirmed') {
          assert.equal(detail.aftercareStatus, 'manual_check_required')
          assert.equal(detail.opsAttention, true)
          assert.equal(detail.opsAttentionCode, 'copy_result_unconfirmed')
          assert.equal(detail.errorCode, 'COPY_RESULT_UNCONFIRMED')
          assert.equal(detail.retryForbidden, true)
          assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: job.orderId! } })).taskStatus, 'completed')
          const list = await admin.list({ type: 'copy', search: detail.orderNo, page: 1, pageSize: 20 })
          assert.equal(list.items[0].taskStatus, 'unconfirmed')
          assert.equal(list.items[0].aftercareStatus, 'manual_check_required')
          await prisma.copyJob.update({ where: { id: job.copyId }, data: { resultCode: 'DEVICE_RESULT_UNKNOWN' } })
          assert.equal((await admin.getById(job.orderId!)).errorCode, 'DEVICE_RESULT_UNKNOWN')
        }
      }
      for (const type of [undefined, 'copy']) {
        const completed = await admin.list({ type, taskStatus: 'completed', page: 1, pageSize: 100 })
        assert.ok(completed.items.some((row) => row.id === orderIds.get('handed')))
        assert.ok(!completed.items.some((row) => row.id === orderIds.get('unconfirmed')))
        const onlyUnknown = await admin.list({ type, taskStatus: 'completed', search:
          (await admin.getById(orderIds.get('unconfirmed')!)).orderNo, page: 1, pageSize: 1 })
        assert.equal(onlyUnknown.pagination.total, 0, '过滤必须在分页/计数前生效')
      }
      const attention = await admin.list({ type: 'copy', opsAttention: true, page: 1, pageSize: 100 })
      assert.ok(attention.items.some((row) => row.id === orderIds.get('unconfirmed')))
      const combined = await admin.list({ type: 'copy', taskStatus: 'completed', opsAttention: true, page: 1, pageSize: 100 })
      assert.equal(combined.items.length, 0, '运营关注 OR 不得覆盖完成筛选')
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
