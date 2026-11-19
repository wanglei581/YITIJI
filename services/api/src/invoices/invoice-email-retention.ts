import type { PrismaService } from '../prisma/prisma.service'

/** 已开、已退回才按期清邮箱。已提交的邮箱还要用来发电子发票。 */
const EMAIL_CLEAR_STATUSES = ['issued', 'returned'] as const

/**
 * 清空已开或已退回、并且超过保留期的接收邮箱。
 * 天数由调用方传入，与 AI 服务日志同一口径（readAiServiceLogRetentionDays，默认 90 天）。
 * 不删申请行，不清抬头和税号。
 */
export async function clearExpiredInvoiceEmails(
  prisma: PrismaService,
  retentionDays: number,
  now = new Date(),
): Promise<{ clearedCount: number }> {
  if (!Number.isInteger(retentionDays) || retentionDays < 1) {
    throw new Error('INVOICE_EMAIL_RETENTION_DAYS')
  }
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000)
  const result = await prisma.invoiceRequest.updateMany({
    where: {
      status: { in: [...EMAIL_CLEAR_STATUSES] },
      email: { not: null },
      updatedAt: { lt: cutoff },
    },
    data: { email: null, emailClearedAt: now },
  })
  return { clearedCount: result.count }
}
