/**
 * Sprint 1 / Task 2 — Admin 订单管理（admin-orders）验证。
 *
 * 覆盖：
 *   1. 列表 + 脱敏标签：游客（endUserId 空）→ '游客'；会员有昵称 → 昵称；terminalCode 解析；
 *      amountCents=0；payStatus/taskStatus 透传；分页 total/limit/offset。
 *   2. 筛选：type / payStatus / taskStatus / orderNo 模糊（search）。
 *   3. 详情：含关联 PrintTask 打印参数（从 paramsJson 安全解析）+ 状态流转日志；
 *      不泄漏 fileUrl / fileMd5；不存在的订单 → ORDER_NOT_FOUND。
 *   4. 改支付状态：unpaid→paid 成功并回前值；已退款订单再改 → ORDER_ALREADY_REFUNDED。
 *   5. 退款：仅 paid 可退 → refunded + reason + refundedAt；非 paid → ORDER_NOT_REFUNDABLE。
 *   6. 审计：controller 改状态 / 退款各落一条 AuditLog（order.status_change / order.refund）。
 *
 * 运行：pnpm verify:admin-orders
 * 直接实例化 service + controller（与 verify:order 同范式），不起 HTTP。
 */
import 'dotenv/config'
import { randomUUID } from 'crypto'
import { PrismaService } from '../src/prisma/prisma.service'
import { AuditService } from '../src/audit/audit.service'
import { AdminOrdersService } from '../src/admin-orders/admin-orders.service'
import { AdminOrdersController } from '../src/admin-orders/admin-orders.controller'
import type { AuthedUser } from '../src/common/decorators/current-user.decorator'

function pass(m: string) { console.log(`  PASS ${m}`) }
function fail(m: string): never { console.error(`  FAIL ${m}`); process.exit(1) }

function errCode(e: unknown): string | undefined {
  const ex = e as { getResponse?: () => unknown; response?: unknown }
  const resp = (typeof ex.getResponse === 'function' ? ex.getResponse() : ex.response) as
    | { error?: { code?: string } } | undefined
  return resp?.error?.code
}
async function expectCode(fn: () => Promise<unknown>, code: string, label: string): Promise<void> {
  try {
    await fn()
    fail(`${label} — 期望抛 ${code}，但未抛`)
  } catch (e) {
    const c = errCode(e)
    if (c === code) pass(label)
    else fail(`${label} — 期望 ${code}，实际：${c ?? (e as Error).message}`)
  }
}

async function main() {
  console.log('\n=== Sprint 1 / Task 2 Admin 订单管理验证 ===')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const service = new AdminOrdersService(prisma)
  const controller = new AdminOrdersController(service, audit)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase()
  const tag = `VFY${suffix}`              // 嵌进 orderNo，便于 search 隔离
  const no = (n: number) => `ORD-${tag}-${n}`
  const termId = `t_ao_${suffix}`
  const termCode = `KSK-AO-${suffix}`
  const memberId = `eu_ao_${suffix}`
  const taskId = `ptask_ao_${suffix}`
  const adminUserId = `admin_${suffix}` // AuditLog.actorId 外键到 User，需真实存在

  const orderIds: string[] = []
  const mkOrder = async (
    n: number, type: string, payStatus: string, taskStatus: string,
    endUserId: string | null, terminalId: string | null, printTaskId: string | null,
  ): Promise<string> => {
    const o = await prisma.order.create({
      data: {
        orderNo: no(n), type, payStatus, taskStatus,
        endUserId, terminalId, printTaskId,
        amountCents: 0, currency: 'CNY',
      },
    })
    orderIds.push(o.id)
    return o.id
  }

  async function cleanup() {
    await prisma.auditLog.deleteMany({ where: { targetId: { in: orderIds }, targetType: 'order' } })
    await prisma.order.deleteMany({ where: { orderNo: { contains: tag } } })
    await prisma.printTaskStatusLog.deleteMany({ where: { taskId } })
    await prisma.printTask.deleteMany({ where: { id: taskId } })
    await prisma.terminal.deleteMany({ where: { id: termId } })
    await prisma.endUser.deleteMany({ where: { id: memberId } })
    await prisma.user.deleteMany({ where: { id: adminUserId } })
  }

  try {
    await cleanup()
    orderIds.length = 0

    // 夹具：admin 运营账号（审计外键）、会员、终端、一条带打印参数 + 状态日志的 PrintTask
    await prisma.user.create({ data: { id: adminUserId, username: `admin_${suffix}`, passwordHash: 'verify-not-a-real-hash', name: '订单审计验证管理员', role: 'admin' } })
    await prisma.endUser.create({ data: { id: memberId, phoneHash: `ao-${memberId}`, phoneEnc: `ao-enc-${memberId}`, nickname: '订单测试会员' } })
    await prisma.terminal.create({ data: { id: termId, terminalCode: termCode, agentToken: `tok_${suffix}`, deviceFingerprint: 'verify-ao' } })
    await prisma.printTask.create({
      data: {
        id: taskId, fileUrl: 'sig://secret-ao', fileMd5: 'sha256-ao', status: 'completed',
        completedAt: new Date('2026-06-09T01:13:40.000Z'),
        paramsJson: JSON.stringify({ fileName: '王某某_简历.pdf', copies: 2, colorMode: 'color', duplex: 'simplex', paperSize: 'A4' }),
      },
    })
    await prisma.printTaskStatusLog.createMany({
      data: [
        { taskId, fromStatus: 'pending', toStatus: 'claimed', createdAt: new Date('2026-06-09T01:12:30.000Z') },
        { taskId, fromStatus: 'claimed', toStatus: 'printing', createdAt: new Date('2026-06-09T01:13:00.000Z') },
        { taskId, fromStatus: 'printing', toStatus: 'completed', createdAt: new Date('2026-06-09T01:13:40.000Z') },
      ],
    })

    // 订单夹具
    const idGuestPrint  = await mkOrder(1, 'print', 'unpaid',   'completed', null,     termId, taskId)  // 游客 + 带打印详情
    const idMemberPaid  = await mkOrder(2, 'print', 'paid',     'completed', memberId, termId, null)     // 会员 + 已支付
    const idRefunded    = await mkOrder(3, 'print', 'refunded', 'cancelled', null,     null,   null)
    const idScan        = await mkOrder(4, 'scan',  'unpaid',   'pending',   null,     null,   null)
    const idUnpaid2     = await mkOrder(5, 'print', 'unpaid',   'pending',   null,     null,   null)     // 退款不可用测试
    pass('夹具就绪：会员/终端/PrintTask + 5 笔订单')

    // ── 1. 列表 + 脱敏标签 + 字段 ──────────────────────────────
    const all = await service.list({ search: tag, limit: 100 })
    if (all.total !== 5 || all.items.length !== 5 || all.limit !== 100 || all.offset !== 0) {
      fail(`1. 列表 total/分页异常：${JSON.stringify({ total: all.total, len: all.items.length })}`)
    }
    const guest = all.items.find((o) => o.id === idGuestPrint)!
    const member = all.items.find((o) => o.id === idMemberPaid)!
    if (
      guest.userLabel === '游客' && guest.terminalCode === termCode && guest.amountCents === 0 &&
      guest.payStatus === 'unpaid' && guest.type === 'print' &&
      member.userLabel === '订单测试会员' && member.terminalCode === termCode
    ) {
      pass('1. 列表脱敏标签：游客→「游客」、会员→昵称；terminalCode 解析；amountCents=0；状态透传')
    } else fail(`1. 字段异常：guest=${JSON.stringify(guest)} member=${JSON.stringify(member)}`)

    // ── 2. 筛选 ────────────────────────────────────────────────
    const scanOnly = await service.list({ search: tag, type: 'scan' })
    const paidOnly = await service.list({ search: tag, payStatus: 'paid' })
    const pendingOnly = await service.list({ search: tag, taskStatus: 'pending' })
    const searchOne = await service.list({ search: no(2) })
    if (
      scanOnly.total === 1 && scanOnly.items[0]?.id === idScan &&
      paidOnly.total === 1 && paidOnly.items[0]?.id === idMemberPaid &&
      pendingOnly.total === 2 &&
      searchOne.total === 1 && searchOne.items[0]?.id === idMemberPaid
    ) {
      pass('2. 筛选：type / payStatus / taskStatus / orderNo 模糊均生效')
    } else fail(`2. 筛选异常：scan=${scanOnly.total} paid=${paidOnly.total} pending=${pendingOnly.total} search=${searchOne.total}`)

    // ── 3. 详情 + 不泄漏敏感字段 ──────────────────────────────
    const detail = await service.getById(idGuestPrint)
    const serialized = JSON.stringify(detail)
    const leak = serialized.includes('sig://') || serialized.includes('sha256-') ||
      Object.prototype.hasOwnProperty.call(detail, 'fileUrl') || Object.prototype.hasOwnProperty.call(detail, 'fileMd5')
    if (
      detail.print && detail.print.fileName === '王某某_简历.pdf' && detail.print.copies === 2 &&
      detail.print.colorMode === 'color' && detail.print.status === 'completed' &&
      detail.statusLogs.length === 3 && detail.statusLogs[2]?.toStatus === 'completed' && !leak
    ) {
      pass('3. 详情：打印参数解析 + 3 条状态日志；无 fileUrl/fileMd5 泄漏')
    } else fail(`3. 详情异常：print=${JSON.stringify(detail.print)} logs=${detail.statusLogs.length} leak=${leak}`)

    await expectCode(() => service.getById('order_does_not_exist'), 'ORDER_NOT_FOUND', '3b. 不存在订单 → ORDER_NOT_FOUND')

    // ── 4. 改支付状态 ──────────────────────────────────────────
    const upd = await service.updateStatus(idGuestPrint, { payStatus: 'paid' })
    if (upd.previous.payStatus === 'unpaid' && upd.detail.payStatus === 'paid') {
      pass('4. 改支付状态：unpaid→paid 成功并回前值')
    } else fail(`4. 改状态异常：${JSON.stringify(upd)}`)
    await expectCode(() => service.updateStatus(idRefunded, { payStatus: 'paid' }), 'ORDER_ALREADY_REFUNDED', '4b. 已标记退款订单改支付状态 → ORDER_ALREADY_REFUNDED')

    // ── 4c. 改 taskStatus（修正1）：仅改 Order 列，不动 PrintTask.status ──
    const taskUpd = await service.updateStatus(idGuestPrint, { taskStatus: 'cancelled' })
    const linkedTask = await prisma.printTask.findUnique({ where: { id: taskId }, select: { status: true } })
    if (taskUpd.previous.taskStatus === 'completed' && taskUpd.detail.taskStatus === 'cancelled' && linkedTask?.status === 'completed') {
      pass('4c. 改 taskStatus：Order.taskStatus→cancelled，关联 PrintTask.status 仍为 completed（不反向修改）')
    } else fail(`4c. taskStatus 语义异常：order=${taskUpd.detail.taskStatus} printTask=${linkedTask?.status}`)

    // ── 4d. 空请求拦截 ──
    await expectCode(() => service.updateStatus(idScan, {}), 'ORDER_NO_STATUS_CHANGE', '4d. 既无 payStatus 又无 taskStatus → ORDER_NO_STATUS_CHANGE')

    // ── 5. 退款 ────────────────────────────────────────────────
    const ref = await service.refund(idMemberPaid, '用户取消，柜台退现')
    if (ref.previousPayStatus === 'paid' && ref.detail.payStatus === 'refunded' &&
        ref.detail.refundReason === '用户取消，柜台退现' && ref.detail.refundedAt) {
      pass('5. 退款：paid→refunded + 原因 + refundedAt')
    } else fail(`5. 退款异常：${JSON.stringify(ref)}`)
    await expectCode(() => service.refund(idUnpaid2, 'x'), 'ORDER_NOT_REFUNDABLE', '5b. 非 paid 订单退款 → ORDER_NOT_REFUNDABLE')

    // ── 6. 审计（controller 层）─────────────────────────────────
    const user: AuthedUser = { userId: adminUserId, role: 'admin', orgId: null }
    const req = { headers: { 'user-agent': 'verify-admin-orders' }, requestId: `req_${suffix}`, ip: '127.0.0.1' }
    // idGuestPrint 当前 paid（上面改过）→ controller 改回 failed，落审计
    await controller.updateStatus(idGuestPrint, { payStatus: 'failed' }, user, req)
    // idScan 当前 unpaid → 先 controller 标 paid（落审计），再 controller 退款（落审计）
    await controller.updateStatus(idScan, { payStatus: 'paid' }, user, req)
    await controller.refund(idScan, { reason: '审计链路验证退款' }, user, req)

    const statusAudits = await prisma.auditLog.count({
      where: { actorId: user.userId, action: 'order.status_change', targetType: 'order' },
    })
    const refundAudits = await prisma.auditLog.count({
      where: { actorId: user.userId, action: 'order.refund', targetType: 'order', targetId: idScan },
    })
    if (statusAudits === 2 && refundAudits === 1) {
      pass('6. 审计：order.status_change ×2 + order.refund ×1 已落 AuditLog')
    } else fail(`6. 审计异常：status_change=${statusAudits} refund=${refundAudits}`)
  } finally {
    await cleanup()
    await prisma.onModuleDestroy()
  }

  console.log('\nALL PASS')
}

main().catch((error: unknown) => {
  console.error('\nFatal error:', (error as Error).message)
  console.error((error as Error).stack)
  process.exit(1)
})
