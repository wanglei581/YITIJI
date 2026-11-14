/**
 * 真 PostgreSQL：两张没结案的服务单同时挂上同一个任务。
 *
 * 部分唯一索引必须只让一条成功。两条事务在更新前会合，避免一前一后跑完、
 * 没测到并发。DATABASE_URL 不是 PostgreSQL 时直接失败。
 */
import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'
import { createRaceBarrier } from './support/serializable-race-barrier'
import { isServiceOrderOpenRefConflict } from '../src/payment/service-order.ref'

process.env['NODE_ENV'] ||= 'test'

function isPostgresUrl(url: string): boolean {
  return url.startsWith('postgresql://') || url.startsWith('postgres://')
}

async function main(): Promise<void> {
  const url = process.env['DATABASE_URL'] ?? ''
  if (!isPostgresUrl(url)) {
    throw new Error('SERVICE_ORDER_OPEN_REF_VERIFY_POSTGRES_REQUIRED: DATABASE_URL must be PostgreSQL')
  }
  assertIsolatedVerificationDatabase()

  const { PrismaService } = await import('../src/prisma/prisma.service')
  const prisma = new PrismaService()
  if (prisma.dbKind !== 'postgres') {
    throw new Error('SERVICE_ORDER_OPEN_REF_VERIFY_POSTGRES_REQUIRED')
  }
  await prisma.onModuleInit()

  const runId = randomBytes(6).toString('hex')
  const terminalId = `term_open_ref_${runId}`
  const ref = `open-ref-${runId}`
  const firstId = `sor_a_${runId}`
  const secondId = `sor_b_${runId}`
  const sessionId = `ks_${runId}`

  try {
    await prisma.terminal.create({
      data: {
        id: terminalId,
        terminalCode: `OPEN-REF-${runId}`,
        agentToken: `agent-open-ref-${runId}`,
        deviceFingerprint: `fp-open-ref-${runId}`,
      },
    })
    const common = {
      terminalId,
      serviceKey: 'resume_optimize',
      amountCents: 100,
      status: 'consumed',
      attemptsUsed: 1,
      kioskSessionId: sessionId,
      provider: 'sandbox',
      expiresAt: new Date(Date.now() + 60_000),
      paidAt: new Date(),
      consumedAt: new Date(),
    }
    await prisma.serviceOrder.create({
      data: { ...common, id: firstId, providerOrderNo: `open-ref-a-${runId}`, channelTxnNo: `txn-a-${runId}`, consumedRef: `other-a-${runId}` },
    })
    await prisma.serviceOrder.create({
      data: { ...common, id: secondId, providerOrderNo: `open-ref-b-${runId}`, channelTxnNo: `txn-b-${runId}`, consumedRef: `other-b-${runId}` },
    })

    const barrier = createRaceBarrier(2)
    const results = await Promise.allSettled([firstId, secondId].map((id) => prisma.$transaction(async (tx) => {
      await barrier.wait()
      return tx.$executeRaw`
        UPDATE "ServiceOrder"
        SET "consumedRef" = ${ref}, "updatedAt" = ${new Date()}
        WHERE "id" = ${id} AND "status" = 'consumed'
      `
    })))
    assert.equal(barrier.timedOut, false, '两条事务必须挤在同一时间窗')
    const succeeded = results.filter((item) => item.status === 'fulfilled')
    const rejected = results.filter((item) => item.status === 'rejected')
    assert.equal(succeeded.length, 1, `并发挂同一任务必须只成功一条：${JSON.stringify(results.map((item) => item.status === 'rejected' ? String(item.reason) : 'ok'))}`)
    assert.equal(rejected.length, 1)
    assert.equal(isServiceOrderOpenRefConflict(rejected[0]?.status === 'rejected' ? rejected[0].reason : null), true, '失败的那条必须是唯一索引冲突')
    const holders = await prisma.serviceOrder.count({
      where: { consumedRef: ref, status: { in: ['pending', 'paid', 'consumed'] } },
    })
    assert.equal(holders, 1, '库里同一任务只能留下一张没结案的单')
    console.log('PASS 同一任务并发挂单只成功一条')
  } finally {
    await prisma.serviceOrder.deleteMany({ where: { terminalId } }).catch(() => undefined)
    await prisma.terminal.delete({ where: { id: terminalId } }).catch(() => undefined)
    await prisma.onModuleDestroy().catch(() => undefined)
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
