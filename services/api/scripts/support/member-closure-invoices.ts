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
import { CLOSED_MEMBER_INVOICE_RETURN_REASON } from '../../src/member-privacy/member-closure-retention'
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
  const admin = new AdminInvoiceService(deps.prisma, deps.audit)
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
  assert.ok(namedInvoice.returnReason, '退回原因应保留（擦过的）')
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
