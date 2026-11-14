/**
 * 服务单退款到了自动上限，或退款通知和这一单对不上。
 * 进告警中心，让人能看见。退成或关掉之后这条自己消失。
 * 不进 omitted：每一张卡住的单都要列出来。
 */

import type { PrismaService } from '../prisma/prisma.service'
import { buildSubjectKey } from './derived-alert-identity'

export interface ServiceReturnAlert {
  id: string
  subjectKey: string
  subjectId: string
  episodeToken: string
  type: 'service_return_manual'
  severity: 'error'
  title: string
  detail: string
  terminalCode: string | null
  occurredAt: string
}

type ReturnRow = {
  id: string
  refundAnomaly: string | null
  updatedAt: Date
  terminal: { terminalCode: string } | null
}

const NEEDS_PERSON = {
  OR: [
    { status: 'refund_failed' },
    { refundAnomaly: { not: null }, status: { notIn: ['refunded', 'closed'] } },
  ],
}

function buildAlert(row: ReturnRow): ServiceReturnAlert {
  const subjectKey = buildSubjectKey('service_return_manual', row.id)
  const anomaly = row.refundAnomaly?.trim()
  return {
    id: subjectKey,
    subjectKey,
    subjectId: row.id,
    episodeToken: row.updatedAt.toISOString(),
    type: 'service_return_manual',
    severity: 'error',
    title: '退款待人工处理',
    detail: anomaly || '自动退款已到上限，需要人工处理',
    terminalCode: row.terminal?.terminalCode ?? null,
    occurredAt: row.updatedAt.toISOString(),
  }
}

export async function collectServiceReturnAlerts(prisma: PrismaService): Promise<ServiceReturnAlert[]> {
  const rows = await prisma.serviceOrder.findMany({
    where: NEEDS_PERSON,
    select: {
      id: true,
      refundAnomaly: true,
      updatedAt: true,
      terminal: { select: { terminalCode: true } },
    },
    orderBy: { updatedAt: 'asc' },
  }) as ReturnRow[]
  return rows.map(buildAlert)
}

export async function resolveServiceReturnAlert(
  prisma: PrismaService,
  subjectId: string,
): Promise<ServiceReturnAlert | null> {
  const row = await prisma.serviceOrder.findFirst({
    where: { id: subjectId, ...NEEDS_PERSON },
    select: {
      id: true,
      refundAnomaly: true,
      updatedAt: true,
      terminal: { select: { terminalCode: true } },
    },
  }) as ReturnRow | null
  return row ? buildAlert(row) : null
}
