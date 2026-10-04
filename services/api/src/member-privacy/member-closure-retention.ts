import { randomBytes } from 'node:crypto'
import { detachMemberAiUsageRecords } from '../ai/usage/ai-usage-retention'
import { decryptPhone } from '../common/crypto/phone-identity'
import type { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service'

export interface ClosureIdentity {
  phoneHash: string
  phoneEnc: string
  wxOpenId: string | null
  nickname: string | null
}

/** 年限待律师确认；空值不自动清理，本包没有到期清理任务。 */
export function readClosureRetentionYears() {
  const read = (key: string): number | null => {
    const raw = process.env[key]?.trim()
    if (!raw) return null
    const value = Number(raw)
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`INVALID_${key}`)
    return value
  }
  return { orders: read('CLOSURE_RETAINED_ORDER_YEARS'), consents: read('CLOSURE_RETAINED_CONSENT_YEARS') }
}

/** 纯随机、不接收原身份参数；绝不使用原手机号、盐或旧哈希派生墓碑。 */
export function newClosurePhoneIdentity() {
  return { phoneHash: `anonymized:${randomBytes(32).toString('hex')}`,
    phoneEnc: `anonymized:${randomBytes(32).toString('hex')}` }
}

export function closureTextScrubber(identity: ClosureIdentity): (text: string) => string {
  const phone = decryptPhone(identity.phoneEnc)
  const known = [phone, identity.phoneHash, identity.phoneEnc, identity.wxOpenId, identity.nickname,
    `${phone.slice(0, 3)}****${phone.slice(-4)}`].filter((x): x is string => Boolean(x))
  const tail = phone.slice(-4)
  return (text) => {
    let safe = text
    for (const value of known) safe = safe.split(value).join('[已去标识]')
    return safe.replace(new RegExp(`(?<!\\d)${tail}(?!\\d)`, 'g'), '[已去标识]')
      .replace(/1[3-9]\d{9}/g, '[电话已清除]')
      .replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, '[IP已清除]')
  }
}

/** 逐行处理自由文本，避免清掉财务状态、金额与条款版本。 */
export async function retainClosureRecords(tx: PrismaTransactionClient, endUserId: string, scrub: (text: string) => string) {
  const counts: Record<string, number> = {}
  const orders = await tx.order.findMany({ where: { endUserId } })
  const orderIds = orders.map((row) => row.id)
  for (const row of orders) await tx.order.update({ where: { id: row.id }, data: {
    sourceFileId: null, sourceFileSha256: null, sourceFileName: null, printParamsJson: '{}', itemsJson: '[]',
    refundReason: row.refundReason ? scrub(row.refundReason) : null,
    paidBy: row.paidBy ? scrub(row.paidBy) : null,
    pickupCodeHash: null, pickupCodeEnc: null, pickupCode: null,
    idempotencyKey: null, idempotencyPayloadHash: null,
  } })
  counts.Order = orders.length
  const tasks = await tx.printTask.findMany({ where: { OR: [{ endUserId }, { orderId: { in: orderIds } },
    { id: { in: orders.flatMap((row) => row.printTaskId ? [row.printTaskId] : []) } }] } })
  for (const row of tasks) await tx.printTask.update({ where: { id: row.id }, data: {
    fileUrl: '', fileId: null, fileMd5: '', paramsJson: '{}',
    errorMessage: row.errorMessage ? scrub(row.errorMessage) : null,
  } })
  counts.PrintTask = tasks.length
  const taskIds = tasks.map((row) => row.id)
  counts.OrderItem = (await tx.orderItem.updateMany({ where: { orderId: { in: orderIds } }, data: { fileId: '' } })).count
  const logs = await tx.printTaskStatusLog.findMany({ where: { taskId: { in: taskIds } } })
  for (const row of logs) if (row.errorCode) await tx.printTaskStatusLog.update({ where: { id: row.id }, data: { errorCode: scrub(row.errorCode) } })
  counts.PrintTaskStatusLog = logs.length
  const ledger = await tx.orderSubmissionLedger.findMany({ where: { endUserId } })
  for (const row of ledger) await tx.orderSubmissionLedger.update({ where: { id: row.id }, data: {
    idempotencyKey: randomBytes(32).toString('hex'), payloadHash: '', leaseToken: null, leaseExpiresAt: null,
  } })
  counts.OrderSubmissionLedger = ledger.length
  const redemptions = await tx.redemptionRecord.findMany({ where: { endUserId } })
  for (const row of redemptions) await tx.redemptionRecord.update({ where: { id: row.id }, data: {
    serviceRefId: `anonymized:${randomBytes(32).toString('hex')}`,
    idempotencyKey: randomBytes(32).toString('hex'),
  } })
  counts.RedemptionRecord = redemptions.length
  const grants = await tx.benefitGrant.findMany({ where: { endUserId } })
  for (const row of grants) await tx.benefitGrant.update({ where: { id: row.id }, data: {
    title: scrub(row.title), description: row.description ? scrub(row.description) : null,
    sourceRef: null,
    ...(row.status === 'active' ? { status: 'revoked' } : {}),
  } })
  counts.BenefitGrant = grants.length
  counts.BenefitClaim = await tx.benefitClaim.count({ where: { endUserId } })
  const tickets = await tx.feedbackTicket.findMany({ where: { endUserId } })
  for (const row of tickets) await tx.feedbackTicket.update({ where: { id: row.id }, data: {
    contactPhoneEnc: null, dedupKey: null, relatedScanTaskId: null,
    // 账号注销后没有人可回复：未结的反馈一并关闭，否则管理员回复时要给已注销账号写通知，会被迟到写入防线拒绝。
    ...(row.status === 'closed' ? {} : { status: 'closed' }),
    title: row.title ? scrub(row.title) : null, content: scrub(row.content),
  } })
  counts.FeedbackTicket = tickets.length
  const replies = await tx.feedbackReply.findMany({ where: { ticketId: { in: tickets.map((row) => row.id) } } })
  for (const row of replies) await tx.feedbackReply.update({ where: { id: row.id }, data: { content: scrub(row.content) } })
  counts.FeedbackReply = replies.length
  counts.MemberLegalConsent = (await tx.memberLegalConsent.updateMany({ where: { endUserId }, data: { ipAddress: null } })).count
  counts.UserAiConsent = await tx.userAiConsent.count({ where: { endUserId } })
  const serviceLogs = await tx.aiServiceLog.findMany({ where: { endUserId } })
  for (const row of serviceLogs) await tx.aiServiceLog.update({ where: { id: row.id }, data: {
    endUserId: null, tokenUsageJson: '{}', clientDeclarationJson: null,
    errorCode: row.errorCode ? scrub(row.errorCode) : null,
  } })
  counts.AiServiceLog = serviceLogs.length
  // 终端号、机构号是我们自己的设备与客户标识，不是个人信息：保留，否则按终端 / 按机构的营收与 AI 成本统计会丢行。
  counts.AiUsageRecord = await detachMemberAiUsageRecords(tx as unknown as PrismaService, endUserId)
  const attempts = await tx.paymentAttempt.findMany({ where: { orderId: { in: orderIds } } })
  for (const row of attempts) await tx.paymentAttempt.update({ where: { id: row.id }, data: {
    prepayId: null, qrCodeContent: null, failReason: row.failReason ? scrub(row.failReason) : null,
  } })
  counts.PaymentAttempt = attempts.length
  const refunds = await tx.refund.findMany({ where: { orderId: { in: orderIds } } })
  for (const row of refunds) await tx.refund.update({ where: { id: row.id }, data: { reason: row.reason ? scrub(row.reason) : null } })
  counts.Refund = refunds.length
  // UserDataRequest 的计数/执行来源由执行器保存；导出能力失效，失败原文不再留存。
  counts.UserDataRequest = await tx.userDataRequest.count({ where: { endUserId } })
  await tx.userDataRequest.updateMany({ where: { endUserId, requestType: { not: 'delete' } }, data: {
    exportFileId: null, exportExpiresAt: null, activeKey: null, workerJobId: null,
    progressJson: null, failureMessage: null, failureCode: null, idempotencyKey: null,
    executionVersion: { increment: 1 },
  } })
  await tx.userDataRequest.updateMany({ where: { endUserId, requestType: 'export', status: { in: ['pending', 'handling', 'ready', 'failed'] } }, data: {
    status: 'cancelled', handledAt: new Date(), executionStep: null,
  } })
  // 历史 memberId 列当前不写入；保留匿名服务人次、清掉会员与设备关联。
  counts.KioskSession = (await tx.kioskSession.updateMany({ where: { memberId: endUserId }, data: {
    memberId: null, clientSessionId: null, categoriesJson: '[]',
  } })).count
  return counts
}
