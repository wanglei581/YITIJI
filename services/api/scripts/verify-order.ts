/**
 * Sprint 1 / Task 1 — Order 模型 + 打印链路落账 验证。
 *
 * 覆盖（对应 Task 1 验收点）：
 *   1. 创建落账：走真实 PrintJobsService.create()（Kiosk 打印创建的生产路径），
 *      落库一条 PrintTask 必同事务落一条对应 Order：
 *        type='print' / amountCents=0 / currency='CNY' / payStatus='unpaid' /
 *        taskStatus='pending' / printTaskId 关联 / orderNo 形如 ORD-YYYYMMDD-XXXXXX。
 *   2. 会员归属：endUserId 透传到 Order（匿名为 null，会员为本人 id）。
 *   3. 打印链路契约不变：create() 仍返回 { taskId, status:'pending', createdAt }。
 *   4. 状态镜像-认领：claimTasks 把任务 pending→claimed 时，Order.taskStatus 同步为
 *      'claimed' 并回填 Order.terminalId。
 *   5. 状态镜像-回报：patchTaskStatus 把任务 claimed→printing→completed 时，
 *      Order.taskStatus 同步流转；终态写 completedAt。
 *   6. 状态镜像-超时回收：resetExpiredClaims 把过期 claimed 任务回收为 pending 时，
 *      Order.taskStatus 同步回 pending 并清空 terminalId。
 *   7. 非干扰：无对应 Order 的 PrintTask（如 seed 任务）走 claim/patch 不报错（updateMany 0 行）。
 *   8. 单价常量真相源：PRINT_UNIT_PRICE_CENTS = { black_white:20, color:50 }（本轮仅预留不计算）。
 *
 * 运行：pnpm verify:order
 *
 * 直接实例化 service（与 verify:member-print-orders 同范式），不起 HTTP，确定性验证。
 * 终端鉴权用直接落库的测试 Terminal + 其 agentToken；不依赖 register/adminSecret。
 */
import 'dotenv/config'
import { randomUUID, randomBytes } from 'crypto'
import { PrismaService } from '../src/prisma/prisma.service'
import { PrintJobsService } from '../src/print-jobs/print-jobs.service'
import { TerminalsService } from '../src/terminals/terminals.service'
import { AuditService } from '../src/audit/audit.service'
import { signFileUrl } from '../src/files/signing'
import { PRINT_UNIT_PRICE_CENTS } from '../src/print-jobs/print-pricing'

function pass(m: string) { console.log(`  PASS ${m}`) }
function fail(m: string): never { console.error(`  FAIL ${m}`); process.exit(1) }

const ORDER_NO_RE = /^ORD-\d{8}-[0-9A-F]{6}$/

// 全 8 个必填打印参数（与 PrintJobParamsDto 对齐）。
const PARAMS = {
  copies: 2,
  colorMode: 'color' as const,
  duplex: 'simplex' as const,
  paperSize: 'A4' as const,
  orientation: 'auto' as const,
  quality: 'standard' as const,
  scale: 'fit' as const,
  pagesPerSheet: 1 as const,
}

async function main() {
  console.log('\n=== Sprint 1 / Task 1 Order 模型 + 打印链路落账 验证 ===')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const audit = new AuditService(prisma)
  const printJobs = new PrintJobsService(prisma, audit)
  // 不调用 onModuleInit：避免 seed 任务 + 30s 定时器，保持验证确定性。
  const terminals = new TerminalsService(prisma)
  const resetExpiredClaims = (
    terminals as unknown as { resetExpiredClaims: () => Promise<void> }
  ).resetExpiredClaims.bind(terminals)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const termId = `t_order_${suffix}`
  const agentToken = randomBytes(16).toString('hex')
  const userId = `eu_order_${suffix}`

  // 追踪本测试创建的所有 PrintTask id，用于精确清理。
  const taskIds: string[] = []

  // 铸造一个本系统有效签名 URL（与 service 同读 FILE_SIGNING_SECRET → 验签自洽）。
  // service 只验签 + 重签，不查 FileObject 是否存在，故无需真实文件。
  const signedUrl = (n: string) => signFileUrl(`f_order_${suffix}_${n}`, 60_000).url

  async function cleanup() {
    // Order.printTaskId 是 onDelete:SetNull，必须先删 Order 再删 PrintTask，否则留孤儿订单。
    await prisma.order.deleteMany({ where: { printTaskId: { in: taskIds } } })
    await prisma.printTaskStatusLog.deleteMany({ where: { taskId: { in: taskIds } } })
    await prisma.printTask.deleteMany({ where: { id: { in: taskIds } } })
    await prisma.auditLog.deleteMany({ where: { targetId: { in: taskIds }, action: 'print_job.create' } })
    await prisma.terminal.deleteMany({ where: { id: termId } })
    await prisma.endUser.deleteMany({ where: { id: userId } })
  }

  try {
    await cleanup()

    // 测试终端 + 会员夹具。
    await prisma.terminal.create({
      data: { id: termId, terminalCode: `KSK-ORD-${suffix}`, agentToken, deviceFingerprint: 'verify-order' },
    })
    await prisma.endUser.create({
      data: { id: userId, phoneHash: `ord-${userId}`, phoneEnc: `ord-enc-${userId}`, nickname: '订单测试会员' },
    })
    pass('夹具就绪：测试终端 + 会员')

    // ── 1 + 3. 创建落账（匿名）+ 打印链路契约 ───────────────────────────
    const res1 = await printJobs.create(
      { fileUrl: signedUrl('1'), fileMd5: 'sha256-ord-1', fileName: '简历_测试.pdf', params: PARAMS },
      { endUserId: null, ipAddress: '127.0.0.1', userAgent: 'verify-order' },
    )
    taskIds.push(res1.taskId)
    if (
      typeof res1.taskId === 'string' && res1.taskId.startsWith('ptask_kiosk_') &&
      res1.status === 'pending' && typeof res1.createdAt === 'string' && !Number.isNaN(Date.parse(res1.createdAt))
    ) {
      pass('3. 打印链路契约不变：create() 仍返回 { taskId, status:pending, createdAt }')
    } else fail(`3. create() 返回结构异常：${JSON.stringify(res1)}`)

    const task1 = await prisma.printTask.findUnique({ where: { id: res1.taskId } })
    if (task1 && task1.status === 'pending' && task1.paramsJson.includes('简历_测试.pdf')) {
      pass('1a. PrintTask 已落库（pending，paramsJson 含文件名）')
    } else fail(`1a. PrintTask 落库异常：${JSON.stringify(task1)}`)

    const order1 = await prisma.order.findUnique({ where: { printTaskId: res1.taskId } })
    if (
      order1 &&
      order1.type === 'print' &&
      order1.amountCents === 0 &&
      order1.currency === 'CNY' &&
      order1.payStatus === 'unpaid' &&
      order1.taskStatus === 'pending' &&
      order1.endUserId === null &&
      order1.terminalId === null &&
      ORDER_NO_RE.test(order1.orderNo)
    ) {
      pass(`1b. 对应 Order 已落账：type=print / amountCents=0 / payStatus=unpaid / taskStatus=pending / orderNo=${order1.orderNo}`)
    } else fail(`1b. Order 落账异常：${JSON.stringify(order1)}`)

    // ── 2. 会员归属透传 ────────────────────────────────────────────────
    const res2 = await printJobs.create(
      { fileUrl: signedUrl('2'), fileMd5: 'sha256-ord-2', fileName: '求职信.pdf', params: PARAMS },
      { endUserId: userId },
    )
    taskIds.push(res2.taskId)
    const order2 = await prisma.order.findUnique({ where: { printTaskId: res2.taskId } })
    if (order2 && order2.endUserId === userId && order2.amountCents === 0 && order2.payStatus === 'unpaid') {
      pass('2. 会员归属：endUserId 透传到 Order（会员单）')
    } else fail(`2. 会员 Order endUserId 透传异常：${JSON.stringify(order2)}`)

    // ── 4. 状态镜像-认领（claimTasks） ─────────────────────────────────
    const res3 = await printJobs.create(
      { fileUrl: signedUrl('3'), fileMd5: 'sha256-ord-3', fileName: '认领单.pdf', params: PARAMS },
      { endUserId: null },
    )
    taskIds.push(res3.taskId)
    // 置为最早创建 → claimTasks（认领全局最旧 pending）确定性认领到本任务。
    await prisma.printTask.update({ where: { id: res3.taskId }, data: { createdAt: new Date(0) } })
    const claimed = await terminals.claimTasks(termId, { maxTasks: 1 }, `Bearer ${agentToken}`)
    if (!claimed.length || claimed[0]?.taskId !== res3.taskId) {
      fail(`4. claimTasks 未认领到目标任务（认领到 ${JSON.stringify(claimed.map((c) => c.taskId))}）`)
    }
    const task3 = await prisma.printTask.findUnique({ where: { id: res3.taskId } })
    const order3 = await prisma.order.findUnique({ where: { printTaskId: res3.taskId } })
    if (
      task3?.status === 'claimed' && task3.terminalId === termId &&
      order3?.taskStatus === 'claimed' && order3.terminalId === termId
    ) {
      pass('4. 状态镜像-认领：claim 后 Order.taskStatus=claimed 且回填 Order.terminalId')
    } else fail(`4. 认领镜像异常：task=${JSON.stringify(task3)} order=${JSON.stringify(order3)}`)

    // ── 5. 状态镜像-回报（patchTaskStatus：claimed→printing→completed） ──
    await terminals.patchTaskStatus(res3.taskId, { status: 'printing' }, `Bearer ${agentToken}`, termId)
    const orderPrinting = await prisma.order.findUnique({ where: { printTaskId: res3.taskId } })
    if (orderPrinting?.taskStatus !== 'printing') {
      fail(`5a. printing 镜像异常：${JSON.stringify(orderPrinting)}`)
    }
    await terminals.patchTaskStatus(res3.taskId, { status: 'completed' }, `Bearer ${agentToken}`, termId)
    const taskDone = await prisma.printTask.findUnique({ where: { id: res3.taskId } })
    const orderDone = await prisma.order.findUnique({ where: { printTaskId: res3.taskId } })
    if (taskDone?.status === 'completed' && taskDone.completedAt && orderDone?.taskStatus === 'completed') {
      pass('5. 状态镜像-回报：claimed→printing→completed 全程同步，终态写 completedAt')
    } else fail(`5. 回报镜像异常：task=${JSON.stringify(taskDone)} order=${JSON.stringify(orderDone)}`)

    // ── 6. 状态镜像-超时回收（resetExpiredClaims） ─────────────────────
    const res4 = await printJobs.create(
      { fileUrl: signedUrl('4'), fileMd5: 'sha256-ord-4', fileName: '回收单.pdf', params: PARAMS },
      { endUserId: null },
    )
    taskIds.push(res4.taskId)
    // 模拟“已认领但租约过期”：任务 claimed + claimExpiry 过去；Order 同步为 claimed。
    await prisma.printTask.update({
      where: { id: res4.taskId },
      data: { status: 'claimed', terminalId: termId, claimedAt: new Date(), claimExpiry: new Date(Date.now() - 1000) },
    })
    await prisma.order.updateMany({ where: { printTaskId: res4.taskId }, data: { taskStatus: 'claimed', terminalId: termId } })
    await resetExpiredClaims()
    const task4 = await prisma.printTask.findUnique({ where: { id: res4.taskId } })
    const order4 = await prisma.order.findUnique({ where: { printTaskId: res4.taskId } })
    if (
      task4?.status === 'pending' && task4.terminalId === null &&
      order4?.taskStatus === 'pending' && order4.terminalId === null
    ) {
      pass('6. 状态镜像-超时回收：过期 claimed 回收为 pending，Order 同步回 pending 并清空 terminalId')
    } else fail(`6. 超时回收镜像异常：task=${JSON.stringify(task4)} order=${JSON.stringify(order4)}`)

    // ── 7. 非干扰：无 Order 的 PrintTask 走 claim/patch 不报错 ──────────
    const bareId = `ptask_bare_${suffix}`
    taskIds.push(bareId)
    await prisma.printTask.create({
      data: {
        id: bareId, fileUrl: 'sig://bare', fileMd5: 'sha256-bare',
        paramsJson: JSON.stringify(PARAMS), status: 'claimed', terminalId: termId, claimedAt: new Date(),
      },
    })
    // 这条任务没有对应 Order（直接落库，未走 create()）。
    const ack = await terminals.patchTaskStatus(bareId, { status: 'printing' }, `Bearer ${agentToken}`, termId)
    const bareTask = await prisma.printTask.findUnique({ where: { id: bareId } })
    const bareOrder = await prisma.order.findUnique({ where: { printTaskId: bareId } })
    if (ack.acknowledged === true && bareTask?.status === 'printing' && bareOrder === null) {
      pass('7. 非干扰：无对应 Order 的 PrintTask 状态更新不报错、不凭空造单')
    } else fail(`7. 非干扰异常：ack=${JSON.stringify(ack)} task=${JSON.stringify(bareTask)} order=${JSON.stringify(bareOrder)}`)

    // ── 8. 单价常量真相源 ──────────────────────────────────────────────
    if (PRINT_UNIT_PRICE_CENTS.black_white === 20 && PRINT_UNIT_PRICE_CENTS.color === 50) {
      pass('8. 单价常量真相源：black_white=20 / color=50（分），本轮仅预留不计算')
    } else fail(`8. 单价常量异常：${JSON.stringify(PRINT_UNIT_PRICE_CENTS)}`)
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
