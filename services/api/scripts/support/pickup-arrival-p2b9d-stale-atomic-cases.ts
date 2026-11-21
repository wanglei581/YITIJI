/**
 * P2b9d 第 8 条：消除过期付款补收退款写 channelSubmittedAt 的非原子缝隙（agy #8）。
 * - provider 存在时，db.refund.create 原子带入 channelSubmittedAt（不会先出现 pending + null 的空窗），
 *   且在 provider.refund() 进入时即已被 writePrintOutcomeIfRefundClear 拦住。
 * - provider 不存在时，直接以 status='failed' 且 channelSubmittedAt=null 落库。
 */
import assert from 'node:assert/strict'
import { PaymentProviderRegistry } from '../../src/payment/payment-provider.factory'
import type { PaymentProvider } from '../../src/payment/payment-provider.types'
import { writePrintOutcomeIfRefundClear } from '../../src/payment/refund-paper-exclusion'
import { refundExpiredAttemptCollection } from '../../src/payment/stale-attempt-collection'
import type { PrismaService } from '../../src/prisma/prisma.service'

const PAGES = JSON.stringify({ copies: 1, colorMode: 'black_white' })

export async function runP2b9dStaleAtomicCases(
  db: PrismaService,
  input: { tag: string; orderIds: string[]; taskIds: string[] },
): Promise<void> {
  const tag = input.tag
  const orgId = `org_p2b9d8_${tag}`
  const terminalId = `term_p2b9d8_${tag}`
  await db.organization.create({ data: { id: orgId, name: '过期付款原子写提交时间', type: 'school_employment_center' } })
  await db.terminal.create({
    data: { id: terminalId, terminalCode: terminalId, agentToken: `tok-${terminalId}`, deviceFingerprint: `fp-${terminalId}`, orgId, enabled: true, lifecycleStatus: 'active' },
  })
  const created: string[] = []
  const seed = async (label: string) => {
    const id = `ord_${tag}_p2b9d8_${label}`
    const taskId = `pt_${id}`
    const attemptId = `pa_old_${id}`
    const orderNo = `P9D8${tag}${label}`.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32)
    created.push(id)
    input.orderIds.push(id)
    input.taskIds.push(taskId)
    await db.printTask.create({
      data: { id: taskId, fileUrl: 'https://example.invalid/print', fileMd5: 'md5', status: 'failed', errorCode: 'PRINT_JOB_UNCONFIRMED', printOutcome: null, orderId: id, terminalId },
    })
    await db.order.create({
      data: {
        id, orderNo, type: 'print', terminalId, amountCents: 200, discountCents: 0, payStatus: 'paid', paymentSource: 'wechat',
        paidAt: new Date(Date.now() - 30 * 60_000), pickupStatus: 'pending', taskStatus: 'failed', billablePages: 2,
        printParamsJson: PAGES, itemsJson: '[]', channel: 'kiosk', printTaskId: taskId,
      },
    })
    await db.paymentAttempt.create({
      data: { id: attemptId, orderId: id, channel: 'wechat', amountCents: 300, status: 'expired', prepayId: `prepay_${attemptId}`.slice(0, 64) },
    })
    return { id, taskId, attemptId, orderNo }
  }

  try {
    // 1. provider 存在：拦截 create 入参确认原子带入 channelSubmittedAt，且 provider.refund() 期间核验出纸立即被挡。
    const atomic = await seed('atom')
    let createdWithSubmittedAt = false
    let blockedInsideProvider = false
    const origCreate = db.refund.create.bind(db.refund)
    const wrappedDb = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === 'refund') {
          return new Proxy(target.refund, {
            get(rTarget, rProp, rReceiver) {
              if (rProp === 'create') {
                return (args: Parameters<typeof origCreate>[0]) => {
                  const data = args.data as { channelSubmittedAt?: unknown; status?: unknown }
                  createdWithSubmittedAt = data.status === 'pending' && data.channelSubmittedAt instanceof Date
                  return origCreate(args)
                }
              }
              return Reflect.get(rTarget, rProp, rReceiver)
            },
          })
        }
        return Reflect.get(target, prop, receiver)
      },
    })
    const provider = {
      channel: 'wechat',
      refund: async () => {
        const wrote = await db.$transaction((tx) => writePrintOutcomeIfRefundClear(tx, db.dbKind, {
          taskId: atomic.taskId,
          orderId: atomic.id,
          outcome: 'printed',
          unconfirmedErrorCode: 'PRINT_JOB_UNCONFIRMED',
        }))
        blockedInsideProvider = !wrote
        return { status: 'processing' as const, channelRefundNo: null }
      },
    } as unknown as PaymentProvider
    await refundExpiredAttemptCollection(wrappedDb, new PaymentProviderRegistry([provider]), {
      orderId: atomic.id,
      orderNo: atomic.orderNo,
      payStatus: 'paid',
      attemptId: atomic.attemptId,
      attemptStatus: 'expired',
      attemptAmountCents: 300,
      orderAmountCents: 200,
      channel: 'wechat',
      channelTxnNo: `wxtxn_atom_${tag}`,
      result: 'success',
    })
    assert.equal(createdWithSubmittedAt, true, 'db.refund.create 必须原子写入 channelSubmittedAt，消除非原子缝隙')
    assert.equal(blockedInsideProvider, true, '已原子写入 channelSubmittedAt，核验出纸必须被拦下')
    const atomicRefund = await db.refund.findFirstOrThrow({ where: { orderId: atomic.id } })
    assert.equal(atomicRefund.status, 'pending')
    assert.ok(atomicRefund.channelSubmittedAt)

    // 2. provider 不存在：直接以 failed 且 channelSubmittedAt=null 落库。
    const disabled = await seed('dis')
    await refundExpiredAttemptCollection(db, new PaymentProviderRegistry([]), {
      orderId: disabled.id,
      orderNo: disabled.orderNo,
      payStatus: 'paid',
      attemptId: disabled.attemptId,
      attemptStatus: 'expired',
      attemptAmountCents: 300,
      orderAmountCents: 200,
      channel: 'wechat',
      channelTxnNo: `wxtxn_dis_${tag}`,
      result: 'success',
    })
    const disRefund = await db.refund.findFirstOrThrow({ where: { orderId: disabled.id } })
    assert.equal(disRefund.status, 'failed')
    assert.equal(disRefund.channelSubmittedAt, null, '没有 provider 时不得写 channelSubmittedAt')
  } finally {
    await db.refund.deleteMany({ where: { orderId: { in: created } } })
    await db.paymentAttempt.deleteMany({ where: { orderId: { in: created } } })
    await db.auditLog.deleteMany({ where: { targetId: { in: created } } })
    await db.order.deleteMany({ where: { id: { in: created } } })
    await db.printTask.deleteMany({ where: { orderId: { in: created } } })
    await db.terminal.delete({ where: { id: terminalId } }).catch(() => undefined)
    await db.organization.delete({ where: { id: orgId } }).catch(() => undefined)
  }
}
