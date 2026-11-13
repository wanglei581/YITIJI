import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import type { PrismaTransactionClient } from '../../src/prisma/prisma.service'
import { COPY_ENDED } from '../../src/copy-jobs/copy-job.policy'
import type { CopyJobStore } from '../../src/copy-jobs/copy-job-store.service'
import type { CopyJobsService } from '../../src/copy-jobs/copy-jobs.service'
import type { CopyAgentService } from '../../src/copy-jobs/copy-agent.service'
import type { CopyPermit } from '../../src/copy-jobs/copy-job.types'
import { TerminalAdminService } from '../../src/terminals/terminals-admin.service'
import { TerminalAgentService } from '../../src/terminals/terminals-agent.service'
import { TerminalCredentialSecurityService } from '../../src/terminals/terminal-credential-security.service'
import { KIOSK_SEED_TERMINAL, seedKioskTerminal } from '../../prisma/seed-terminal'

/** 真实管理服务/事务与 HTTP 许可交错，钉住管理提交和许可 CAS 的先后顺序。 */
export async function verifyCopyC1e(store: CopyJobStore, jobs: CopyJobsService, agent: CopyAgentService,
  terminalId: string, otherTerminalId: string, permit: (id: string, op: 'scan' | 'print') => Promise<CopyPermit>) {
  const prisma = store.prisma
  const admin = new TerminalAdminService(prisma, new TerminalAgentService(prisma, store.audit,
    new TerminalCredentialSecurityService(prisma, store.audit)), undefined!, undefined!)
  const original = await prisma.terminal.findUniqueOrThrow({ where: { id: terminalId } })
  const ids: string[] = [], orders: string[] = []
  const orgId = `copy-c1e-${randomUUID()}`
  const actorId = `copy-c1e-admin-${randomUUID()}`
  const check = async (name: string, run: () => Promise<void>) => {
    try { await run() } catch (error) { console.error(`FAIL ${name}`); throw error }
    console.log(`PASS ${name}`)
  }
  const create = async (op: 'scan' | 'print') => {
    const job = await jobs.create({ terminalId, requestKey: randomUUID(), source: 'flatbed',
      colorMode: 'black_white', duplex: 'simplex', copies: 1 }, null)
    ids.push(job.copyId)
    if (op === 'scan') return job
    const scanned = await agent.scanResult(terminalId, job.copyId, { generation: job.generation, pageCount: 2 })
    const confirmed = await jobs.confirm(job.copyId, terminalId, null,
      (job as { controlToken: string }).controlToken, scanned.quoteVersion!)
    orders.push(confirmed.orderId!)
    return confirmed
  }
  const lifecycle = async (state: 'active' | 'maintenance' | 'suspended' | 'retired') => {
    const row = await prisma.terminal.findUniqueOrThrow({ where: { id: terminalId } })
    return admin.updateTerminalLifecycle(terminalId, state,
      { actorId, actorRole: 'admin', reason: '隔离复印并发撤权门禁验证', confirmationText: row.terminalCode },
      { expectedStatus: row.lifecycleStatus as 'active' | 'maintenance' | 'suspended', expectedVersion: row.lifecycleVersion })
  }
  const assign = (next: string | null) => admin.assignTerminalOrg(terminalId, next, undefined,
    async (tx, result) => tx.auditLog.create({ data: { actorId: null, actorRole: 'admin',
      action: 'terminal.org.update', targetType: 'terminal', targetId: terminalId, payloadJson: JSON.stringify(result) } }))
  const changes = [
    { name: '停用', write: () => admin.updateTerminalProfile(terminalId, { enabled: false }),
      restore: () => admin.updateTerminalProfile(terminalId, { enabled: true }) },
    { name: '转维护', write: () => lifecycle('maintenance'), restore: () => lifecycle('active') },
    { name: '解绑机构', write: () => assign(null), restore: () => assign(original.orgId) },
    { name: '改绑机构', write: () => assign(orgId), restore: () => assign(original.orgId) },
  ]
  try {
    await prisma.user.create({ data: { id: actorId, username: actorId, name: '复印隔离管理员',
      passwordHash: 'not-a-login-password', role: 'admin' } })
    await prisma.organization.create({ data: { id: orgId, name: '复印隔离改绑机构', type: 'test' } })
    // 覆盖全部终态及未终态；另一终端的未终态也必须原样保留。
    for (const [tid, states] of [[terminalId, [...COPY_ENDED, 'ready', 'scanning', 'scanned', 'confirmed', 'dispatching', 'spooled']],
      [otherTerminalId, ['ready', 'dispatching']]] as const) {
      for (const state of states) {
        const row = await prisma.copyJob.create({ data: { terminalId: tid, organizationId: original.orgId!,
          state, requestKey: randomUUID(), source: 'flatbed', colorMode: 'black_white', duplex: 'simplex',
          expiresAt: new Date(Date.now() + 300_000) } })
        ids.push(row.id)
      }
    }
    for (const change of changes) {
      for (const op of ['scan', 'print'] as const) {
        await check(`C1e ${change.name}：${op} 读版本后管理先提交，拒绝且状态不前进，仅撤本机未终态`, async () => {
          const job = await create(op), capable = store.capable.bind(store)
          let committed = false
          store.capable = async (...args: Parameters<CopyJobStore['capable']>) => {
            const result = await capable(...args)
            if (!committed) {
              const before = await prisma.copyJob.findMany({ where: { terminalId: { in: [terminalId, otherTerminalId] } } })
              await change.write()
              committed = true
              for (const row of before) {
                const fresh = await store.find(row.id)
                const increment = row.terminalId === terminalId && !COPY_ENDED.includes(row.state) ? 1 : 0
                assert.equal(fresh.authorizationVersion, row.authorizationVersion + increment, `${row.terminalId}/${row.state}`)
                assert.equal(fresh.state, row.state, '管理撤权不得修改状态')
              }
            }
            return result
          }
          try {
            const result = await permit(job.copyId, op)
            assert.ok(committed, '管理事务必须实际先提交')
            assert.equal(result.allowed, false, '管理先提交不得发许可')
            assert.equal(result.reason, 'COPY_STATE_CONFLICT')
            assert.equal((await store.find(job.copyId)).state, job.state)
          } finally { store.capable = capable; await change.restore() }
        })
      }
      await check(`C1e ${change.name}：打印 CAS 先提交，响应前管理提交仍允许，真实终态照收`, async () => {
        const job = await create('print'), find = store.find.bind(store)
        let reads = 0, committed = false
        store.find = async (...args: Parameters<CopyJobStore['find']>) => {
          if (args[0] === job.copyId && ++reads === 2) {
            assert.equal((await find(job.copyId)).state, 'dispatching')
            await change.write()
            committed = true
          }
          return find(...args)
        }
        try {
          const result = await permit(job.copyId, 'print')
          assert.ok(committed)
          assert.equal(result.allowed, true)
          assert.equal(result.authorizationVersion, job.authorizationVersion, '响应须为成功 CAS 快照')
          const fresh = await find(job.copyId)
          assert.equal(fresh.state, 'dispatching')
          assert.equal(fresh.authorizationVersion, job.authorizationVersion + 1)
          assert.equal((await agent.result(terminalId, job.copyId,
            { generation: job.generation, eventId: randomUUID(), state: 'handed' })).state, 'handed')
          assert.equal((await prisma.order.findUniqueOrThrow({ where: { id: job.orderId! } })).taskStatus, 'completed')
        } finally { store.find = find; await change.restore() }
      })
      await check(`C1e ${change.name}：撤权异常时管理字段与授权版本一起回滚`, async () => {
        const job = await create('scan')
        const before = await prisma.terminal.findUniqueOrThrow({ where: { id: terminalId } })
        const transaction = prisma.$transaction.bind(prisma)
        let reached = false
        prisma.$transaction = ((fn: (tx: PrismaTransactionClient) => Promise<unknown>) => transaction(async (tx) => {
          const copyJob = new Proxy(tx.copyJob, { get(target, key) {
            if (key === 'updateMany') return async (...args: Parameters<typeof target.updateMany>) => {
              await target.updateMany(...args)
              reached = true
              throw new Error('C1E_VERIFY_ROLLBACK')
            }
            return Reflect.get(target, key)
          } })
          return fn(new Proxy(tx, { get(target, key) { return key === 'copyJob' ? copyJob : Reflect.get(target, key) } }))
        })) as typeof prisma.$transaction
        try { await assert.rejects(change.write, /C1E_VERIFY_ROLLBACK/); assert.ok(reached) }
        finally { prisma.$transaction = transaction }
        const after = await prisma.terminal.findUniqueOrThrow({ where: { id: terminalId } })
        for (const key of ['enabled', 'lifecycleStatus', 'lifecycleVersion', 'orgId', 'orgBoundAt'] as const) {
          assert.deepEqual(after[key], before[key], `回滚 ${key}`)
        }
        assert.equal((await store.find(job.copyId)).authorizationVersion, job.authorizationVersion)
      })
    }
    await check('C1e 应急吊销：扫描/打印管理先提交拒绝，CAS 先提交仍允许且终态照收，仅撤本机未终态', async () => {
      const target = await prisma.terminal.create({ data: { id: randomUUID(), terminalCode: `copy-c1e-emergency-${randomUUID()}`,
        agentToken: randomUUID(), deviceFingerprint: randomUUID(), orgId: original.orgId } })
      const security = new TerminalCredentialSecurityService(prisma, store.audit)
      const targetJobs: string[] = [], targetOrders: string[] = []
      const revoke = async () => {
        const row = await prisma.terminal.findUniqueOrThrow({ where: { id: target.id } })
        return security.emergencyRevoke(target.id, { actorId, actorRole: 'admin', reason: '隔离复印应急吊销门禁验证' },
          { expectedStatus: 'active', expectedVersion: row.lifecycleVersion, expectedCredentialGeneration: row.credentialGeneration,
            confirmationText: `吊销 ${row.terminalCode}` })
      }
      const recover = async () => {
        for (const state of ['maintenance', 'active'] as const) {
          const row = await prisma.terminal.findUniqueOrThrow({ where: { id: target.id } })
          await admin.updateTerminalLifecycle(target.id, state, { actorId, actorRole: 'admin', reason: '隔离复印恢复运维状态验证' },
            { expectedStatus: row.lifecycleStatus as 'suspended' | 'maintenance', expectedVersion: row.lifecycleVersion })
        }
      }
      try {
        for (const capabilityKey of ['copy', 'scan_device']) await prisma.terminalCapability.create({ data: {
          terminalId: target.id, capabilityKey, status: 'available' } })
        for (const op of ['scan', 'print', 'print'] as const) {
          const job = await jobs.create({ terminalId: target.id, requestKey: randomUUID(), source: 'flatbed',
            colorMode: 'black_white', duplex: 'simplex', copies: 1 }, null)
          targetJobs.push(job.copyId)
          if (op === 'print') {
            const scanned = await agent.scanResult(target.id, job.copyId, { generation: job.generation, pageCount: 2 })
            const confirmed = await jobs.confirm(job.copyId, target.id, null,
              (job as { controlToken: string }).controlToken, scanned.quoteVersion!)
            targetOrders.push(confirmed.orderId!)
          }
          const before = await store.find(job.copyId), capable = store.capable.bind(store), find = store.find.bind(store)
          const others = await prisma.copyJob.findMany({ where: { terminalId: { not: target.id } } })
          const casFirst = targetJobs.length === 3
          let committed = false, reads = 0
          if (casFirst) store.find = async (...args: Parameters<CopyJobStore['find']>) => {
            if (args[0] === job.copyId && ++reads === 2) { await revoke(); committed = true }
            return find(...args)
          }
          else store.capable = async (...args: Parameters<CopyJobStore['capable']>) => {
            const result = await capable(...args)
            if (!committed) { await revoke(); committed = true }
            return result
          }
          try {
            const result = await agent.permit(target.id, job.copyId, op)
            assert.ok(committed)
            assert.equal(result.allowed, casFirst)
            assert.equal(result.authorizationVersion, before.authorizationVersion)
            assert.equal((await find(job.copyId)).authorizationVersion, before.authorizationVersion + 1)
            assert.equal((await find(job.copyId)).state, casFirst ? 'dispatching' : before.state)
            if (casFirst) assert.equal((await agent.result(target.id, job.copyId,
              { generation: job.generation, eventId: randomUUID(), state: 'handed' })).state, 'handed')
            else assert.equal(result.reason, 'COPY_STATE_CONFLICT')
            for (const row of others) assert.equal((await find(row.id)).authorizationVersion, row.authorizationVersion)
          } finally { store.capable = capable; store.find = find; await recover() }
        }
      } finally {
        await prisma.auditLog.deleteMany({ where: { OR: [{ targetId: { in: [...targetJobs, ...targetOrders, target.terminalCode] } }, { actorId }] } })
        await prisma.copyJob.deleteMany({ where: { terminalId: target.id } })
        await prisma.order.deleteMany({ where: { id: { in: targetOrders } } })
        await prisma.terminal.delete({ where: { id: target.id } })
      }
    })
    await check('C1e seed 覆盖归属先提交拒绝旧许可，CAS 先提交的真实终态照收', async () => {
      // CI 的 PostgreSQL 组先灌了 demo 种子（含 KSK-001），用例不碰它：被测的种子覆盖函数换一个本用例独有、事先不存在的终端。
      const tag = randomUUID()
      const identity = { id: `t_c1e_seed_${tag}`, terminalCode: `KSK-C1E-${tag}`,
        agentToken: `seed-terminal-token-c1e-${tag}`, deviceFingerprint: `seed-terminal-fingerprint-c1e-${tag}` }
      assert.equal(KIOSK_SEED_TERMINAL.terminalCode, 'KSK-001', 'demo seed 本身仍只覆盖 KSK-001')
      assert.equal(await prisma.terminal.findUnique({ where: { terminalCode: identity.terminalCode } }), null,
        'seed 门禁的目标终端必须事先不存在')
      const target = await seedKioskTerminal(prisma, original.orgId!, identity)
      assert.equal(target.id, identity.id)
      const seedOrders: string[] = [], seedJobs: string[] = []
      try {
        for (const capabilityKey of ['copy', 'scan_device']) await prisma.terminalCapability.create({ data: {
          terminalId: target.id, capabilityKey, status: 'available' } })
        const job = await jobs.create({ terminalId: target.id, requestKey: randomUUID(), source: 'flatbed',
          colorMode: 'black_white', duplex: 'simplex', copies: 1 }, null)
        seedJobs.push(job.copyId)
        const capable = store.capable.bind(store)
        let committed = false
        store.capable = async (...args: Parameters<CopyJobStore['capable']>) => {
          const result = await capable(...args)
          if (!committed) { await seedKioskTerminal(prisma, orgId, identity); committed = true }
          return result
        }
        try {
          const result = await agent.permit(target.id, job.copyId, 'scan')
          assert.ok(committed)
          assert.equal(result.allowed, false)
          assert.equal(result.reason, 'COPY_STATE_CONFLICT')
          assert.equal((await store.find(job.copyId)).state, 'ready')
          assert.equal((await store.find(job.copyId)).authorizationVersion, job.authorizationVersion + 1)
        } finally { store.capable = capable }
        await agent.scanResult(target.id, job.copyId, { generation: job.generation, pageCount: 2 })
        const view = await store.view(await store.find(job.copyId))
        const confirmed = await jobs.confirm(job.copyId, target.id, null,
          (job as { controlToken: string }).controlToken, view.quoteVersion!)
        seedOrders.push(confirmed.orderId!)
        assert.equal((await agent.permit(target.id, job.copyId, 'print')).allowed, true)
        await seedKioskTerminal(prisma, original.orgId!, identity)
        assert.equal((await store.find(job.copyId)).state, 'dispatching')
        assert.equal((await agent.result(target.id, job.copyId,
          { generation: job.generation, eventId: randomUUID(), state: 'handed' })).state, 'handed')
      } finally {
        await prisma.auditLog.deleteMany({ where: { targetId: { in: [...seedJobs, ...seedOrders] } } })
        await prisma.copyJob.deleteMany({ where: { terminalId: target.id } })
        await prisma.order.deleteMany({ where: { id: { in: seedOrders } } })
        await prisma.terminal.delete({ where: { id: target.id } })
      }
    })
    await check('C1e 无关及恢复写不撤权；suspended/retired 也撤权', async () => {
      const job = await create('scan')
      await admin.updateTerminalProfile(terminalId, { displayName: original.displayName, enabled: true })
      await lifecycle('active')
      await assign(original.orgId)
      assert.equal((await store.find(job.copyId)).authorizationVersion, job.authorizationVersion)
      await lifecycle('suspended')
      assert.equal((await store.find(job.copyId)).authorizationVersion, job.authorizationVersion + 1)
      await lifecycle('maintenance')
      await lifecycle('active')
      assert.equal((await store.find(job.copyId)).authorizationVersion, job.authorizationVersion + 2)
      // retired 永不可恢复，使用独立终端验证并在 finally 中清理。
      const target = await prisma.terminal.create({ data: { id: randomUUID(), terminalCode: `copy-c1e-retired-${randomUUID()}`,
        agentToken: randomUUID(), deviceFingerprint: randomUUID(), orgId: original.orgId } })
      try {
        const pending = await prisma.copyJob.create({ data: { terminalId: target.id, organizationId: original.orgId!,
          requestKey: randomUUID(), source: 'flatbed', colorMode: 'black_white', duplex: 'simplex',
          expiresAt: new Date(Date.now() + 300_000) } })
        await admin.updateTerminalLifecycle(target.id, 'maintenance', { actorId, actorRole: 'admin',
          reason: '隔离复印退役前转维护验证' }, { expectedStatus: 'active', expectedVersion: 0 })
        await admin.updateTerminalLifecycle(target.id, 'retired', { actorId, actorRole: 'admin',
          reason: '隔离复印退役撤权门禁验证', confirmationText: target.terminalCode }, { expectedStatus: 'maintenance', expectedVersion: 1 })
        assert.equal((await store.find(pending.id)).authorizationVersion, pending.authorizationVersion + 2)
      } finally {
        await prisma.auditLog.deleteMany({ where: { targetId: target.terminalCode } })
        await prisma.copyJob.deleteMany({ where: { terminalId: target.id } })
        // 与既有终端门禁一致：已退役身份由数据库强制保留，不绕过 tombstone guard。
        const saved = await prisma.terminal.findUniqueOrThrow({ where: { id: target.id } })
        if (saved.lifecycleStatus !== 'retired') await prisma.terminal.delete({ where: { id: target.id } })
      }
    })
  } finally {
    await prisma.copyJob.deleteMany({ where: { id: { in: ids } } })
    await prisma.order.deleteMany({ where: { id: { in: orders } } })
    await prisma.auditLog.deleteMany({ where: { targetId: { in: [...ids, ...orders, terminalId, original.terminalCode] } } })
    await prisma.organization.delete({ where: { id: orgId } })
    await prisma.auditLog.deleteMany({ where: { actorId } })
    await prisma.user.delete({ where: { id: actorId } })
  }
}
