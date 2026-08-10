/**
 * Phase C-2C 后续小步 — 会员「我的打印订单」只读归属 / 合规验证。
 *
 * 覆盖（对应需求验收点）：
 *   1. 本人可读 + 倒序：会员只读回本人打印任务，按 createdAt 倒序。
 *   2. 安全字段映射：fileName / copies / colorMode / paperSize 来自 paramsJson；
 *      paramsJson 损坏 / 缺字段 / 非法值 → 对应字段 null（不抛错、不编造）；completedAt 正确。
 *   3. 跨用户隔离：A 看不到 B 的订单；匿名任务（endUserId=null）不出现在任何会员名下。
 *   4. 空列表返回 []（无任何订单的会员）。
 *   5. 不返回敏感字段：结果绝不含 fileUrl / fileMd5 / paramsJson / storageKey / sha256 /
 *      payloadJson / accessTokenHash / errorCode / errorMessage / endUserId / terminalId。
 *   6. 鉴权（EndUserAuthGuard）：匿名 / 错 token / 无会话 → 401；有效 token + 会话 → 通过并注入本人 endUserId。
 *
 * 运行：pnpm verify:member-print-orders
 *
 * service 读路径只依赖 prisma；guard 用最小桩注入 jwt / redis，确定性验证鉴权分支。
 */
import 'dotenv/config'
import { execFileSync } from 'child_process'
import { randomUUID } from 'crypto'
import { closeSync, openSync, rmSync } from 'node:fs'
import path from 'node:path'
import type { ExecutionContext } from '@nestjs/common'
import { PrismaService } from '../src/prisma/prisma.service'
import { MemberPendingTasksController } from '../src/member-print-orders/member-print-orders.controller'
import { MemberPrintOrdersService } from '../src/member-print-orders/member-print-orders.service'
import { EndUserAuthGuard } from '../src/common/guards/end-user-auth.guard'
import { verifyPaymentSessionToken } from '../src/payment/payment-session-token'
import { assertIsolatedVerificationDatabase } from './support/isolated-verification-database'

const apiRoot = path.resolve(__dirname, '..')
const fallbackDbName = process.env['DATABASE_URL'] ? null : `verify-member-print-orders-${randomUUID().slice(0, 8)}.db`
const fallbackDbPath = fallbackDbName ? path.join(apiRoot, 'prisma', fallbackDbName) : null
if (fallbackDbName) {
  process.env['DATABASE_URL'] = `file:./prisma/${fallbackDbName}`
}
assertIsolatedVerificationDatabase()
if (fallbackDbName) prepareFallbackDb()

function pass(m: string) { console.log(`  PASS ${m}`) }
function fail(m: string): never { console.error(`  FAIL ${m}`); process.exit(1) }

function errCode(e: unknown): string | undefined {
  const ex = e as { getResponse?: () => unknown; response?: unknown }
  const resp = (typeof ex.getResponse === 'function' ? ex.getResponse() : ex.response) as
    | { error?: { code?: string } } | undefined
  return resp?.error?.code
}

async function expectGuardCode(fn: () => Promise<unknown>, code: string, label: string): Promise<void> {
  try {
    await fn()
    fail(`${label} — 期望 401 ${code}，但 canActivate 通过（鉴权未拦截）`)
  } catch (e) {
    const c = errCode(e)
    if (c === code) pass(label)
    else fail(`${label} — 期望 ${code}，实际: ${c ?? (e as Error).message}`)
  }
}

function mockCtx(headers: Record<string, string>): ExecutionContext {
  const req = { headers }
  return { switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext
}

// 任何打印订单条目都绝不允许出现的敏感键。
const FORBIDDEN_KEYS = [
  'fileUrl', 'fileMd5', 'paramsJson', 'storageKey', 'sha256',
  'payloadJson', 'accessTokenHash', 'errorCode', 'errorMessage',
  'endUserId', 'terminalId', 'pages', 'amount', 'paidStatus',
]

async function main() {
  console.log('\n=== Phase C-2C 会员「我的打印订单」只读归属 / 合规验证 ===')

  const prisma = new PrismaService()
  await prisma.onModuleInit()
  const orders = new MemberPrintOrdersService(prisma)

  const suffix = randomUUID().replace(/-/g, '').slice(0, 12)
  const userA = `eu_po_a_${suffix}`
  const userB = `eu_po_b_${suffix}`
  const userC = `eu_po_c_${suffix}` // 无任何订单 → 空列表
  const userD = `eu_po_d_${suffix}` // P0a 支付字段：unpaid / paid / refunded / 无 Order
  const userE = `eu_po_e_${suffix}` // pending-tasks：active / payment / terminal-state 过滤
  const allUserIds = [userA, userB, userC, userD, userE]
  const resumeTerminalId = `terminal_po_${suffix}`

  // 显式登记本测试创建的 PrintTask id：PrintTask→EndUser 是 onDelete:SetNull（非级联），
  // 删用户不会删任务，必须按 id 显式清理（含匿名任务）。
  const t = (k: string) => `ptask_po_${k}_${suffix}`
  const taskIds = [
    t('a1'), t('a2'), t('a_bad'), t('b1'), t('anon'),
    t('d_unpaid'), t('d_paid'), t('d_refunded'), t('d_noorder'),
    t('e_unpaid'), t('e_paying'), t('e_paid'), t('e_claimed'), t('e_printing'),
    t('e_completed'), t('e_failed'), t('e_cancelled'), t('e_closed'), t('e_refunded_claimed'),
  ]

  async function cleanup() {
    await prisma.order.deleteMany({ where: { printTaskId: { in: taskIds } } })
    await prisma.printTask.deleteMany({ where: { id: { in: taskIds } } })
    await prisma.endUser.deleteMany({ where: { id: { in: allUserIds } } })
    await prisma.terminal.deleteMany({ where: { id: resumeTerminalId } })
  }

  try {
    await cleanup()
    for (const [id, n] of [[userA, '会员A'], [userB, '会员B'], [userC, '会员C'], [userD, '会员D'], [userE, '会员E']] as const) {
      await prisma.endUser.create({ data: { id, phoneHash: `po-${id}`, phoneEnc: `po-enc-${id}`, nickname: n } })
    }
    pass('五个测试会员已创建')

    // 时间锚点：用固定偏移制造确定的 createdAt 倒序（a2 比 a1 新）。
    const base = new Date('2026-06-08T00:00:00.000Z').getTime()
    const at = (offsetMin: number) => new Date(base + offsetMin * 60_000)

    // A 的两条正常任务：a2（彩色双份，已完成）应排在 a1（黑白单份，排队中）之前。
    await prisma.printTask.create({
      data: {
        id: t('a1'), endUserId: userA, fileUrl: 'sig://secret-a1', fileMd5: 'sha256-a1',
        status: 'pending', createdAt: at(10),
        paramsJson: JSON.stringify({ fileName: '简历_张三.pdf', copies: 1, colorMode: 'black_white', paperSize: 'A4', duplex: 'simplex' }),
      },
    })
    await prisma.printTask.create({
      data: {
        id: t('a2'), endUserId: userA, fileUrl: 'sig://secret-a2', fileMd5: 'sha256-a2',
        status: 'completed', createdAt: at(20), completedAt: at(25),
        paramsJson: JSON.stringify({ fileName: '求职信.pdf', copies: 2, colorMode: 'color', paperSize: 'A4' }),
      },
    })
    // A 的"脏 paramsJson"任务：损坏 JSON → 所有 params 派生字段必须安全降级为 null。
    await prisma.printTask.create({
      data: {
        id: t('a_bad'), endUserId: userA, fileUrl: 'sig://secret-abad', fileMd5: 'sha256-abad',
        status: 'failed', createdAt: at(5), paramsJson: '{not valid json',
      },
    })
    // B 的一条任务。
    await prisma.printTask.create({
      data: {
        id: t('b1'), endUserId: userB, fileUrl: 'sig://secret-b1', fileMd5: 'sha256-b1',
        status: 'printing', createdAt: at(15),
        paramsJson: JSON.stringify({ fileName: 'B的文件.pdf', copies: 3, colorMode: 'black_white', paperSize: 'A4' }),
      },
    })
    // 匿名 Kiosk 任务：endUserId 为空，绝不应出现在任何会员名下。
    await prisma.printTask.create({
      data: {
        id: t('anon'), endUserId: null, fileUrl: 'sig://secret-anon', fileMd5: 'sha256-anon',
        status: 'completed', createdAt: at(30), paramsJson: JSON.stringify({ fileName: '匿名.pdf', copies: 1, colorMode: 'color', paperSize: 'A4' }),
      },
    })
    pass('打印任务夹具已创建（A×3 含1条脏params / B×1 / 匿名×1）')

    const defaultPage = { cursor: null, pageSize: 50 }

    // ── 1. 本人可读 + 倒序 ──────────────────────────────────────
    const pageA = await orders.list(userA, defaultPage)
    const listA = pageA.items
    const idsA = listA.map((o) => o.id)
    if (
      listA.length === 3 &&
      pageA.total === 3 &&
      pageA.nextCursor === null &&
      idsA[0] === t('a2') && idsA[1] === t('a1') && idsA[2] === t('a_bad') && // createdAt 20 > 10 > 5
      !idsA.includes(t('b1')) && !idsA.includes(t('anon'))
    ) {
      pass('1. 本人可读 + 倒序：A 读回本人 3 条分页结果，按 createdAt 倒序，且不含 B / 匿名任务')
    } else fail(`1. A 列表异常：${JSON.stringify(idsA)}`)

    const firstSlice = await orders.list(userA, { cursor: null, pageSize: 2 })
    const secondSlice = await orders.list(userA, { cursor: firstSlice.nextCursor, pageSize: 2 })
    const cursorOk =
      firstSlice.items.map((o) => o.id).join(',') === `${t('a2')},${t('a1')}` &&
      firstSlice.nextCursor === t('a1') &&
      firstSlice.total === 3 &&
      secondSlice.items.map((o) => o.id).join(',') === t('a_bad') &&
      secondSlice.nextCursor === null &&
      secondSlice.total === 3
    if (cursorOk) pass('1b. 游标分页：pageSize=2 时能拿到下一页且无重复')
    else fail(`1b. 游标分页异常：first=${JSON.stringify(firstSlice)} second=${JSON.stringify(secondSlice)}`)

    // ── 2. 安全字段映射 ─────────────────────────────────────────
    const a2 = listA.find((o) => o.id === t('a2'))!
    const a2Ok =
      a2.fileName === '求职信.pdf' && a2.copies === 2 && a2.colorMode === 'color' &&
      a2.paperSize === 'A4' && a2.status === 'completed' &&
      typeof a2.completedAt === 'string' && a2.completedAt.startsWith('2026-06-08')
    const aBad = listA.find((o) => o.id === t('a_bad'))!
    const badOk =
      aBad.fileName === null && aBad.copies === null && aBad.colorMode === null &&
      aBad.paperSize === null && aBad.status === 'failed' && aBad.completedAt === null
    if (a2Ok && badOk) {
      pass('2. 安全字段映射：正常 params 正确解析；损坏 paramsJson 全部安全降级为 null；completedAt 正确')
    } else fail(`2. 字段映射异常：a2=${JSON.stringify(a2)} aBad=${JSON.stringify(aBad)}`)

    // ── 3. 跨用户隔离 ───────────────────────────────────────────
    const listB = (await orders.list(userB, defaultPage)).items
    const isolationOk =
      listB.length === 1 && listB[0].id === t('b1') &&
      !listB.some((o) => o.id === t('a1') || o.id === t('a2') || o.id === t('a_bad') || o.id === t('anon'))
    if (isolationOk) pass('3. 跨用户隔离：B 只看到本人 1 条；A 的订单与匿名任务均不可见')
    else fail(`3. 跨用户隔离失败：listB=${JSON.stringify(listB.map((o) => o.id))}`)

    // ── 4. 空列表返回 [] ────────────────────────────────────────
    const pageC = await orders.list(userC, defaultPage)
    if (JSON.stringify(pageC.items) === '[]' && pageC.total === 0 && pageC.nextCursor === null) {
      pass('4. 空列表返回空分页结果（无订单会员 C）')
    } else fail(`4. 空列表未返回空分页结果：${JSON.stringify(pageC)}`)

    // ── 5. 不返回敏感字段 ───────────────────────────────────────
    const allItems = [...listA, ...listB]
    const allowedKeys = new Set(['id', 'status', 'fileName', 'createdAt', 'completedAt', 'copies', 'colorMode', 'paperSize', 'amountCents', 'payStatus', 'paymentSource', 'billablePages', 'billingPageSource', 'pickupCode', 'refundedAmountCents', 'discountCents'])
    let leak: string | null = null
    for (const item of allItems) {
      for (const k of Object.keys(item)) {
        if (!allowedKeys.has(k)) { leak = `未知键 ${k}`; break }
      }
      const serialized = JSON.stringify(item)
      for (const f of FORBIDDEN_KEYS) {
        if (Object.prototype.hasOwnProperty.call(item, f)) { leak = `敏感键 ${f}`; break }
      }
      // 兜底：序列化后不得包含任何 fileUrl / fileMd5 原值。
      if (serialized.includes('sig://') || serialized.includes('sha256-')) { leak = '序列化命中 fileUrl/fileMd5 原值'; break }
      if (leak) break
    }
    if (!leak) pass('5. 不返回敏感字段：仅白名单键(含 P0a 支付安全字段)，无 fileUrl/fileMd5/paramsJson/内部错误/越权字段')
    else fail(`5. 敏感字段泄漏：${leak}`)

    // ── 6. 鉴权（EndUserAuthGuard）─────────────────────────────
    const guardNoToken = new EndUserAuthGuard({} as never, {} as never, {} as never)
    await expectGuardCode(() => guardNoToken.canActivate(mockCtx({})), 'MEMBER_MISSING_TOKEN', '6a. 匿名（无 Authorization）→ 401 MEMBER_MISSING_TOKEN')

    const jwtThrows = { verify: () => { throw new Error('bad') } } as never
    const guardBad = new EndUserAuthGuard(jwtThrows, {} as never, {} as never)
    await expectGuardCode(() => guardBad.canActivate(mockCtx({ authorization: 'Bearer bad.token' })), 'MEMBER_TOKEN_INVALID', '6b. 错 token → 401 MEMBER_TOKEN_INVALID')

    const jwtOk = { verify: () => ({ sub: userA, jti: 'sess-x' }) } as never
    const guardNoSession = new EndUserAuthGuard(jwtOk, { get: async () => null } as never, {} as never)
    await expectGuardCode(() => guardNoSession.canActivate(mockCtx({ authorization: 'Bearer ok.token' })), 'MEMBER_SESSION_EXPIRED', '6c. 有效 token 但无 Redis 会话（含过期会话）→ 401 MEMBER_SESSION_EXPIRED')

    const prismaActive = { endUser: { findUnique: async () => ({ enabled: true, status: 'active' }) } } as never
    const guardOk = new EndUserAuthGuard(jwtOk, { get: async () => userA } as never, prismaActive)
    const ctx = mockCtx({ authorization: 'Bearer ok.token' })
    const allowed = await guardOk.canActivate(ctx)
    const injected = (ctx.switchToHttp().getRequest() as { endUser?: { endUserId: string } }).endUser
    if (allowed === true && injected?.endUserId === userA) pass('6d. 有效会员 token + 会话 → 通过并注入本人 endUserId')
    else fail('6d. 有效会员鉴权未通过或未注入 endUser')

    // ── 7. P0a 支付字段真实化：join Order，诚实字段 + pickupCode 门控 + 无 live 网关来源 ──
    const dPay = { unpaid: t('d_unpaid'), paid: t('d_paid'), refunded: t('d_refunded'), noorder: t('d_noorder') }
    for (const [key, id] of Object.entries(dPay)) {
      await prisma.printTask.create({
        data: {
          id, endUserId: userD, fileUrl: `sig://secret-d-${key}`, fileMd5: `sha256-d-${key}`,
          status: 'pending', createdAt: at(40),
          paramsJson: JSON.stringify({ fileName: `${key}.pdf`, copies: 1, colorMode: 'black_white', paperSize: 'A4' }),
        },
      })
    }
    const ord8 = suffix.slice(0, 8).toUpperCase()
    // unpaid 订单故意带 pickupCode（DB 里有值），门控必须隐藏它；paid 可见；refunded 隐藏。
    await prisma.order.create({ data: { orderNo: `ORD-DU-${ord8}`, type: 'print', printTaskId: dPay.unpaid, endUserId: userD, amountCents: 100, billablePages: 1, billingPageSource: 'pdf_lightweight_scan', payStatus: 'unpaid', paymentSource: null, taskStatus: 'pending', pickupCode: `UNPD${ord8}` } })
    await prisma.order.create({ data: { orderNo: `ORD-DP-${ord8}`, type: 'print', printTaskId: dPay.paid, endUserId: userD, amountCents: 200, billablePages: 2, billingPageSource: 'pdf_lightweight_scan', payStatus: 'paid', paymentSource: 'offline', paidAt: at(41), taskStatus: 'pending', pickupCode: `PAID${ord8}` } })
    await prisma.order.create({ data: { orderNo: `ORD-DR-${ord8}`, type: 'print', printTaskId: dPay.refunded, endUserId: userD, amountCents: 200, billablePages: 2, billingPageSource: 'pdf_lightweight_scan', payStatus: 'refunded', paymentSource: 'offline', paidAt: at(41), refundReason: '测试退款', refundedAt: at(42), taskStatus: 'pending', pickupCode: `RFND${ord8}` } })
    // dPay.noorder 无 Order

    const listD = (await orders.list(userD, defaultPage)).items
    const findD = (id: string) => listD.find((x) => x.id === id)
    const uItem = findD(dPay.unpaid)
    const pItem = findD(dPay.paid)
    const rItem = findD(dPay.refunded)
    const nItem = findD(dPay.noorder)

    const okUnpaid = !!uItem && uItem.amountCents === 100 && uItem.payStatus === 'unpaid' && uItem.paymentSource === null && uItem.billablePages === 1 && uItem.billingPageSource === 'pdf_lightweight_scan' && uItem.pickupCode === null
    const okPaid = !!pItem && pItem.payStatus === 'paid' && pItem.paymentSource === 'offline' && pItem.amountCents === 200 && typeof pItem.pickupCode === 'string' && (pItem.pickupCode ?? '').length > 0
    const okRefunded = !!rItem && rItem.payStatus === 'refunded' && rItem.pickupCode === null
    const okNoOrder = !!nItem && nItem.amountCents === null && nItem.payStatus === null && nItem.paymentSource === null && nItem.billablePages === null && nItem.billingPageSource === null && nItem.pickupCode === null
    const noLiveGateway = listD.every((x) => x.paymentSource !== 'wechat' && x.paymentSource !== 'alipay')

    if (okUnpaid && okPaid && okRefunded && okNoOrder && noLiveGateway) {
      pass('7. 支付字段真实化：有 Order 返回诚实字段；无 Order 全 null；unpaid/refunded 隐藏 pickupCode、paid 可见；无微信/支付宝来源')
    } else {
      fail(`7. 支付字段异常：unpaid=${JSON.stringify(uItem)} paid=${JSON.stringify(pItem)} refunded=${JSON.stringify(rItem)} noOrder=${JSON.stringify(nItem)} noLiveGateway=${noLiveGateway}`)
    }

    // ── 8. /me/pending-tasks：本人 active 任务 + 支付/打印恢复语义 ──
    process.env['PAYMENT_SESSION_SECRET'] ??= 'verify-member-pending-tasks-secret-32-bytes'
    await prisma.terminal.create({
      data: {
        id: resumeTerminalId,
        terminalCode: `KSK-PO-${suffix}`,
        agentToken: `agent-po-${suffix}`,
        deviceFingerprint: `fp-po-${suffix}`,
      },
    })
    const resumeTaskRows = [
      ['e_unpaid', 'pending', 60],
      ['e_paying', 'pending', 61],
      ['e_paid', 'pending', 62],
      ['e_claimed', 'claimed', 63],
      ['e_printing', 'printing', 64],
      ['e_completed', 'completed', 65],
      ['e_failed', 'failed', 66],
      ['e_cancelled', 'cancelled', 67],
      ['e_closed', 'pending', 68],
      ['e_refunded_claimed', 'claimed', 69],
    ] as const
    for (const [key, status, minute] of resumeTaskRows) {
      await prisma.printTask.create({
        data: {
          id: t(key),
          endUserId: userE,
          terminalId: resumeTerminalId,
          fileUrl: `sig://resume-${key}`,
          fileMd5: `sha256-resume-${key}`,
          status,
          createdAt: at(minute),
          updatedAt: at(minute),
          paramsJson: JSON.stringify({ fileName: `${key}.pdf`, copies: 1, colorMode: 'black_white', paperSize: 'A4' }),
        },
      })
    }
    const resumeOrder = async (key: string, payStatus: string, amountCents: number) => {
      const orderNo = `ORD-${key.toUpperCase()}-${ord8}`
      return prisma.order.create({
        data: {
          orderNo,
          type: 'print',
          printTaskId: t(key),
          endUserId: userE,
          terminalId: resumeTerminalId,
          amountCents,
          payStatus,
          taskStatus: key.includes('claimed') ? 'claimed' : 'pending',
          itemsJson: JSON.stringify([{ serviceKey: 'print_bw_page', unitCents: 20, quantity: 2, subtotalCents: 40 }]),
        },
      })
    }
    await resumeOrder('e_unpaid', 'unpaid', 40)
    await resumeOrder('e_paying', 'paying', 40)
    await resumeOrder('e_paid', 'paid', 40)
    await resumeOrder('e_claimed', 'paid', 40)
    await resumeOrder('e_closed', 'closed', 40)
    await resumeOrder('e_refunded_claimed', 'refunded', 40)

    const pendingController = new MemberPendingTasksController(orders)
    const pendingEnvelope = await pendingController.list({ endUserId: userE, sessionId: 'verify-session-e' })
    const pending = pendingEnvelope.data
    const pendingGuards = Reflect.getMetadata('__guards__', MemberPendingTasksController) as unknown[] | undefined
    if (
      Reflect.getMetadata('path', MemberPendingTasksController) === 'me/pending-tasks' &&
      pendingGuards?.includes(EndUserAuthGuard)
    ) {
      pass('8. GET /me/pending-tasks controller 已注册并受 EndUserAuthGuard 保护，复用 CurrentEndUser 身份')
    } else fail('8. /me/pending-tasks controller 路径未注册')
    const pendingIds = pending.map((item) => item.id)
    const expectedPendingIds = [t('e_printing'), t('e_claimed'), t('e_paid'), t('e_paying'), t('e_unpaid')]
    if (JSON.stringify(pendingIds) === JSON.stringify(expectedPendingIds)) {
      pass('8a. pending-tasks 仅返回本人可续办 active PrintTask，按 updatedAt 倒序；任务终态与支付终态被排除')
    } else fail(`8a. pending-tasks 过滤/排序异常：${JSON.stringify(pendingIds)}`)

    const unpaidResume = pending.find((item) => item.id === t('e_unpaid'))
    const payingResume = pending.find((item) => item.id === t('e_paying'))
    const paidResume = pending.find((item) => item.id === t('e_paid'))
    const claimedResume = pending.find((item) => item.id === t('e_claimed'))
    const printingResume = pending.find((item) => item.id === t('e_printing'))
    if (
      unpaidResume?.resume.kind === 'payment' &&
      payingResume?.resume.kind === 'payment' &&
      paidResume?.resume.kind === 'print-progress' &&
      claimedResume?.resume.kind === 'print-progress' &&
      printingResume?.resume.kind === 'print-progress'
    ) {
      pass('8b. unpaid/paying 恢复到支付；paid pending 与 claimed/printing 恢复到真实打印进度')
    } else fail(`8b. 恢复语义异常：${JSON.stringify(pending)}`)

    const paymentResume = unpaidResume?.resume.kind === 'payment' ? unpaidResume.resume : null
    const tokenCheck = paymentResume?.paymentSessionToken
      ? verifyPaymentSessionToken(paymentResume.paymentSessionToken, {
          orderId: paymentResume.orderId,
          orderNo: paymentResume.orderNo,
          terminalId: resumeTerminalId,
          amountCents: paymentResume.amountCents,
          printTaskId: t('e_unpaid'),
        })
      : null
    if (tokenCheck?.ok === true && paymentResume?.priceLines.length === 1) {
      pass('8c. 支付恢复只复用本人真实 Order，并签发受订单/终端/金额/task 绑定的短期 payment session')
    } else fail(`8c. 支付恢复 token/价目明细异常：${JSON.stringify(paymentResume)}`)

    const pendingForOtherUser = await orders.listPending(userB)
    if (pendingForOtherUser.every((item) => item.id !== t('e_unpaid') && item.id !== t('e_printing'))) {
      pass('8d. pending-tasks 按 EndUserAuthGuard 注入的 endUserId 查询，其他会员无法读取 E 的任务')
    } else fail(`8d. pending-tasks 跨用户泄漏：${JSON.stringify(pendingForOtherUser)}`)

    const pendingSerialized = JSON.stringify(pending)
    if (!pendingSerialized.includes('sig://') && !pendingSerialized.includes('sha256-resume') && !pendingSerialized.includes('paramsJson')) {
      pass('8e. pending-tasks 不返回 fileUrl/fileMd5/paramsJson 或任意文件内容')
    } else fail('8e. pending-tasks 响应泄漏文件敏感字段')
  } finally {
    await cleanup()
    await prisma.onModuleDestroy()
    cleanupFallbackDb()
  }

  console.log('\nALL PASS')
}

main().catch((error: unknown) => {
  console.error('\nFatal error:', (error as Error).message)
  console.error((error as Error).stack)
  cleanupFallbackDb()
  process.exit(1)
})

function cleanupFallbackDb(): void {
  if (!fallbackDbPath) return
  for (const suffix of ['', '-wal', '-shm']) {
    rmSync(`${fallbackDbPath}${suffix}`, { force: true })
  }
}

function prepareFallbackDb(): void {
  if (!fallbackDbPath) return
  try {
    closeSync(openSync(fallbackDbPath, 'a'))
    execFileSync('pnpm', ['exec', 'prisma', 'db', 'push'], { cwd: apiRoot, stdio: 'pipe' })
  } catch (error) {
    const details = (error as { stdout?: Buffer; stderr?: Buffer })
    console.error(details.stdout?.toString() ?? '')
    console.error(details.stderr?.toString() ?? '')
    cleanupFallbackDb()
    throw error
  }
}
