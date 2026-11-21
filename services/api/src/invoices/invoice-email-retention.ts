import type { PrismaService } from '../prisma/prisma.service'

/** 已开、已退回才按期清邮箱。已提交的邮箱还要用来发电子发票。 */
const EMAIL_CLEAR_STATUSES = ['issued', 'returned'] as const
const DEFAULT_INVOICE_EMAIL_RETENTION_DAYS = 90

/**
 * 开票邮箱保留天数，单独由 INVOICE_EMAIL_RETENTION_DAYS 设，默认 90。
 * 不跟 AI 服务日志的 AI_SERVICE_LOG_RETENTION_DAYS 走：运维为了压缩 AI 日志调小那个值时，不能连带把已开发票的邮箱提前清掉。
 * 非法或未设置时 90。每次调用现读，不在加载时冻住。
 */
export function readInvoiceEmailRetentionDays(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env['INVOICE_EMAIL_RETENTION_DAYS'])
  return Number.isFinite(raw) && raw >= 1 ? Math.floor(raw) : DEFAULT_INVOICE_EMAIL_RETENTION_DAYS
}

/**
 * 清空已开或已退回、并且超过保留期的接收邮箱。天数由调用方传入（readInvoiceEmailRetentionDays）。
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
