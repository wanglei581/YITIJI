/**
 * 注销门禁（verify-member-closure.ts）里的开票申请夹具与断言。主文件已近 800 行，开票这一块拆到这里。
 *
 * 每个会员三份申请：
 * - 个人抬头写昵称、已提交（注销时应转「已退回」，原因只写「会员已注销」）；
 * - 单位、已开（单位名称与统一社会信用代码留下，邮箱清空）；
 * - 个人抬头「王小明」（不等于账号昵称）、邮箱不含手机号，经真 AdminInvoiceService 退回，
 *   原因里写了这个姓名和邮箱，审计由真 AuditService 写入。
 * 注销后，本人申请行和指向这些申请的审计里都不能再有这个姓名和邮箱。
 */
import assert from 'node:assert/strict'
import type { AuditService } from '../../src/audit/audit.service'
import { AdminInvoiceService } from '../../src/invoices/admin-invoice.service'
import { InvoiceRequestsService } from '../../src/invoices/invoice-requests.service'
import { invoiceSceneIndexKey, invoiceSessionKey, type InvoiceRedis } from '../../src/invoices/invoice-scene'
import { InvoiceSessionsService } from '../../src/invoices/invoice-sessions.service'
import { CLOSED_MEMBER_INVOICE_RETURN_REASON } from '../../src/member-privacy/member-closure-retention'
import type { MemberClosureInput, MemberClosureService } from '../../src/member-privacy/member-closure.service'
import type { PrismaService } from '../../src/prisma/prisma.service'

export const CLOSURE_INVOICE_NAME = '王小明'
export const CLOSURE_INVOICE_EMAIL = 'wangxiaoming.invoice@example.com'
const CLOSURE_INVOICE_REASON = `${CLOSURE_INVOICE_NAME}的邮箱 ${CLOSURE_INVOICE_EMAIL} 收不到，请重新填写`
const COMPANY_TITLE = '崂山区某印刷服务部'
const COMPANY_TAX_ID = '91000000MA0000000N'

/** 本门禁经真服务写出的开票审计指向的申请号。清场时按它删审计（这些审计的 actorId 为空）。 */
export const closureInvoiceAuditTargets: string[] = []

type Put = (model: string, data: Record<string, unknown>) => Promise<{ id: string }>

export async function seedClosureInvoices(
  deps: { put: Put; prisma: PrismaService; audit: AuditService; operatorId: string },
  endUserId: string,
  identity: { nickname: string; phone: string },
  orderId: string,
): Promise<void> {
  await deps.put('invoiceRequest', { orderKind: 'print', orderId, endUserId, titleType: 'personal', title: identity.nickname,
    email: `${identity.phone}@example.com`, amountCents: 200, status: 'submitted', returnReason: `${identity.nickname} ${identity.phone}` })
  await deps.put('invoiceRequest', { orderKind: 'service', orderId: `svc-${orderId}`, endUserId, titleType: 'company', title: COMPANY_TITLE,
    taxId: COMPANY_TAX_ID, email: `desk-${identity.phone}@example.com`, amountCents: 200, status: 'issued' })
  const named = await deps.put('invoiceRequest', { orderKind: 'print', orderId: `named-${orderId}`, endUserId, titleType: 'personal',
    title: CLOSURE_INVOICE_NAME, email: CLOSURE_INVOICE_EMAIL, amountCents: 200, status: 'submitted' })
  closureInvoiceAuditTargets.push(named.id)
  const admin = new AdminInvoiceService(deps.prisma, deps.audit, new InvoiceRequestsService(deps.prisma))
  const returned = await admin.returnRequest(named.id, { reason: CLOSURE_INVOICE_REASON, operatorId: deps.operatorId })
  assert.equal(returned.status, 'returned')
  assert.equal(returned.returnReason, CLOSURE_INVOICE_REASON, '夹具：退回原因原文应先落在申请行上')
}

export async function assertClosureInvoices(
  prisma: PrismaService,
  endUserId: string,
  identity: { nickname: string; phone: string },
  orderId: string,
): Promise<void> {
  const rows = await prisma.invoiceRequest.findMany({ where: { endUserId } })
  // 期望行数 2 → 3：本夹具多了一份「王小明」退回申请（返工包 P2c1b 第 3 条要求的用例），不是行数口径变化。
  assert.equal(rows.length, 3, '开票申请行被删了')
  const personalInvoice = rows.find((row) => row.orderKind === 'print' && row.orderId === orderId)!
  const companyInvoice = rows.find((row) => row.orderKind === 'service' && row.orderId === `svc-${orderId}`)!
  const namedInvoice = rows.find((row) => row.orderKind === 'print' && row.orderId === `named-${orderId}`)!
  assert.ok(personalInvoice && companyInvoice && namedInvoice, '三份开票申请都应留下')
  assert.equal(personalInvoice.title, '[已去标识]')
  assert.equal(personalInvoice.email, null)
  assert.ok(personalInvoice.emailClearedAt)
  assert.equal(personalInvoice.amountCents, 200)
  // 期望值改动（返工包 P2c1b 第 3 条）：已提交、未处理的申请随注销转「已退回」，原因只写「会员已注销」。
  assert.equal(personalInvoice.status, 'returned')
  assert.equal(personalInvoice.returnReason, CLOSED_MEMBER_INVOICE_RETURN_REASON)
  assert.equal(JSON.stringify(personalInvoice).includes(identity.phone), false)
  assert.equal(JSON.stringify(personalInvoice).includes(identity.nickname), false)
  assert.equal(companyInvoice.title, COMPANY_TITLE)
  assert.equal(companyInvoice.taxId, COMPANY_TAX_ID)
  assert.equal(companyInvoice.email, null)
  assert.equal(companyInvoice.amountCents, 200)
  assert.equal(companyInvoice.status, 'issued')
  assert.equal(namedInvoice.title, '[已去标识]')
  assert.equal(namedInvoice.email, null)
  assert.equal(namedInvoice.status, 'returned')
  // 期望值改动（返工包 P2c1c 第 2 条）：已退回申请不是法定已开发票存根，注销时退回原因直接清空为 null，
  // 彻底消除仅开过单位发票时退回原因里管理员手写的非账号姓名与 15 位旧税号残留。
  assert.equal(namedInvoice.returnReason, null, '已退回申请注销后应清空退回原因')
  for (const row of rows) {
    const text = JSON.stringify(row)
    assert.equal(text.includes(CLOSURE_INVOICE_NAME), false, `申请 ${row.id} 注销后还留着姓名抬头`)
    assert.equal(text.includes(CLOSURE_INVOICE_EMAIL), false, `申请 ${row.id} 注销后还留着发票邮箱`)
  }
  const audits = await prisma.auditLog.findMany({ where: { targetId: { in: rows.map((row) => row.id) } } })
  assert.ok(audits.some((row) => row.action === 'invoice.return' && row.targetId === namedInvoice.id), '阳性对照：退回审计应已写入')
  for (const row of audits) {
    assert.equal(row.payloadJson.includes(CLOSURE_INVOICE_NAME), false, `审计 ${row.action} 里还留着姓名抬头`)
    assert.equal(row.payloadJson.includes(CLOSURE_INVOICE_EMAIL), false, `审计 ${row.action} 里还留着发票邮箱`)
  }
}

function errorCodeOf(error: unknown): string | undefined {
  return (error as { getResponse?: () => { error?: { code?: string } } }).getResponse?.()?.error?.code
}

/**
 * 覆盖注销前已创建扫码开票会话的三层防线（Redis 吊销 + submit 活跃校验 + 数据库触发器）：
 * 1. 注销前为目标会员和对照会员各建一个开票码，目标会员提前扫码兑换好 submitToken；
 * 2. 目标会员完成注销变为 anonymized；
 * 3. 目标会员的 invoice_session:* 与 invoice_session_scene:* 必须已被清空（对照会员的不受影响）；
 * 4. 持旧 scene / 旧 submitToken、直接调用 InvoiceRequestsService.submit、以及绕过业务层直写 Prisma 都必须失败且库里 0 新行。
 */
export async function verifyClosureRevokesInvoiceSessions(deps: {
  prisma: PrismaService
  redis: InvoiceRedis
  closure: MemberClosureService
  admin: { userId: string; role: string }
  baseInput: MemberClosureInput
  victim: { id: string; phoneLast4: string }
  otherId: string
  terminalId: string
  put: Put
  orderNo: () => string
}): Promise<void> {
  const victimOrder = await deps.put('order', {
    orderNo: deps.orderNo(),
    endUserId: deps.victim.id,
    terminalId: deps.terminalId,
    payStatus: 'paid',
    taskStatus: 'completed',
    pickupStatus: 'used',
    amountCents: 300,
  })
  const controlOrder = await deps.put('order', {
    orderNo: deps.orderNo(),
    endUserId: deps.otherId,
    terminalId: deps.terminalId,
    payStatus: 'paid',
    taskStatus: 'completed',
    pickupStatus: 'used',
    amountCents: 300,
  })
  const invoiceRequests = new InvoiceRequestsService(deps.prisma)
  const invoiceSessions = new InvoiceSessionsService(deps.redis, invoiceRequests)
  const victimSession = await invoiceSessions.create({
    terminalId: deps.terminalId,
    endUserId: deps.victim.id,
    orderKind: 'print',
    orderId: victimOrder.id,
    origin: 'https://kiosk.example',
  })
  const victimResolved = await invoiceSessions.resolveScene(victimSession.sceneToken)
  const controlSession = await invoiceSessions.create({
    terminalId: deps.terminalId,
    endUserId: deps.otherId,
    orderKind: 'print',
    orderId: controlOrder.id,
    origin: 'https://kiosk.example',
  })
  const victimSessionRedisKey = invoiceSessionKey(victimSession.sessionId)
  const victimSceneRedisKey = invoiceSceneIndexKey(victimSession.sceneToken)
  const controlSessionRedisKey = invoiceSessionKey(controlSession.sessionId)
  const controlSceneRedisKey = invoiceSceneIndexKey(controlSession.sceneToken)
  try {
    const rawVictimBefore = await deps.redis.get(victimSessionRedisKey)
    assert.ok(rawVictimBefore, '阳性对照：注销前开票会话应写在 Redis 里')
    assert.equal(await deps.redis.get(victimSceneRedisKey), victimSession.sessionId, '阳性对照：注销前场景码索引应写在 Redis 里')

    const closed = await deps.closure.execute(
      deps.victim.id,
      { ...deps.baseInput, phoneLast4: deps.victim.phoneLast4 },
      deps.admin,
    )
    assert.equal(closed.status, 'anonymized')
    assert.equal(await deps.redis.get(victimSessionRedisKey), null, '注销后 invoice_session:* 必须被吊销')
    assert.equal(await deps.redis.get(victimSceneRedisKey), null, '注销后 invoice_session_scene:* 必须被吊销')
    assert.ok(await deps.redis.get(controlSessionRedisKey), '注销不得误删另一会员的开票会话')
    assert.equal(await deps.redis.get(controlSceneRedisKey), controlSession.sessionId, '注销不得误删另一会员的场景码')

    await assert.rejects(
      () => invoiceSessions.resolveScene(victimSession.sceneToken),
      (error: unknown) => errorCodeOf(error) === 'INVOICE_SCENE_UNUSABLE',
    )
    await assert.rejects(
      () => invoiceSessions.submit(victimSession.sessionId, {
        submitToken: victimResolved.submitToken,
        titleType: 'personal',
        title: '周明哲',
        email: 'zhoumz@example.com',
      }),
      (error: unknown) => errorCodeOf(error) === 'INVOICE_SCENE_UNUSABLE',
    )
    // 即使旧会话键因异常重放或并发未清，业务层活跃会员校验仍须拒绝写入。
    await deps.redis.setEx(victimSessionRedisKey, 60, rawVictimBefore)
    await assert.rejects(
      () => invoiceSessions.submit(victimSession.sessionId, {
        submitToken: victimResolved.submitToken,
        titleType: 'personal',
        title: '周明哲',
        email: 'zhoumz@example.com',
      }),
      (error: unknown) => errorCodeOf(error) === 'ACCOUNT_UNAVAILABLE',
    )
    await assert.rejects(
      () => invoiceRequests.submit(deps.victim.id, {
        orderKind: 'print',
        orderId: victimOrder.id,
        titleType: 'personal',
        title: '周明哲',
        email: 'zhoumz@example.com',
      }),
      (error: unknown) => errorCodeOf(error) === 'ACCOUNT_UNAVAILABLE',
    )
    // 绕过业务层直写数据库也必须被关闭会员写入触发器拦截。
    await assert.rejects(
      () => deps.prisma.invoiceRequest.create({
        data: {
          orderKind: 'print',
          orderId: victimOrder.id,
          endUserId: deps.victim.id,
          titleType: 'personal',
          title: '周明哲',
          email: 'zhoumz@example.com',
          amountCents: 300,
          status: 'submitted',
        },
      }),
      (error: unknown) => {
        const record = error as { message?: unknown; meta?: { driverAdapterError?: { cause?: { originalMessage?: unknown } } } } | null
        return String(record?.message ?? '').includes('MEMBER_CLOSED_WRITE_FORBIDDEN')
          || String(record?.meta?.driverAdapterError?.cause?.originalMessage ?? '').includes('MEMBER_CLOSED_WRITE_FORBIDDEN')
      },
    )
    assert.equal(await deps.prisma.invoiceRequest.count({ where: { endUserId: deps.victim.id } }), 0, '注销后开票申请必须保持 0 新行')
  } finally {
    await deps.redis.del(victimSessionRedisKey)
    await deps.redis.del(victimSceneRedisKey)
    await deps.redis.del(controlSessionRedisKey)
    await deps.redis.del(controlSceneRedisKey)
  }
}
