/**
 * 打印订单自动原路退失败，订单仍是已付款。进告警中心，退成或不再是失败后退款行消失。
 * 不复用服务单那条：那边按服务单 id 消警，打印单对不上。
 */
import type { PrismaService } from '../prisma/prisma.service'
import {
  PAID_NO_PAPER_AUTO_REASON,
  PRINT_REFUND_FAILED_DETAIL,
  PRINT_RETURN_MANUAL_TYPE,
} from '../payment/print-no-paper-refund.constants'
import { buildSubjectKey } from './derived-alert-identity'

export interface PrintReturnAlert {
  id: string
  subjectKey: string
  subjectId: string
  episodeToken: string
  type: typeof PRINT_RETURN_MANUAL_TYPE
  severity: 'error'
  title: string
  detail: string
  terminalCode: string | null
  occurredAt: string
}

type ReturnRow = {
  orderId: string
  updatedAt: Date
  order: { terminalId: string | null }
}

function buildAlert(row: ReturnRow, terminalCode: string | null): PrintReturnAlert {
  const subjectKey = buildSubjectKey(PRINT_RETURN_MANUAL_TYPE, row.orderId)
  return {
    id: subjectKey,
    subjectKey,
    subjectId: row.orderId,
    episodeToken: row.updatedAt.toISOString(),
    type: PRINT_RETURN_MANUAL_TYPE,
    severity: 'error',
    title: '打印没出纸，待人工处理',
    detail: PRINT_REFUND_FAILED_DETAIL,
    terminalCode,
    occurredAt: row.updatedAt.toISOString(),
  }
}

async function loadRows(prisma: PrismaService, orderId?: string): Promise<PrintReturnAlert[]> {
  const rows = await prisma.refund.findMany({
    where: {
      reason: PAID_NO_PAPER_AUTO_REASON,
      status: 'failed',
      order: { payStatus: 'paid', ...(orderId ? { id: orderId } : {}) },
    },
    select: {
      orderId: true,
      updatedAt: true,
      order: { select: { terminalId: true } },
    },
    orderBy: { updatedAt: 'asc' },
  }) as ReturnRow[]
  const terminalIds = [...new Set(rows.map((row) => row.order.terminalId).filter((id): id is string => Boolean(id)))]
  const terminals = terminalIds.length === 0
    ? []
    : await prisma.terminal.findMany({
      where: { id: { in: terminalIds } },
      select: { id: true, terminalCode: true },
    })
  const codes = new Map(terminals.map((terminal) => [terminal.id, terminal.terminalCode]))
  return rows.map((row) => buildAlert(row, row.order.terminalId ? codes.get(row.order.terminalId) ?? null : null))
}

export async function collectPrintReturnAlerts(prisma: PrismaService): Promise<PrintReturnAlert[]> {
  return loadRows(prisma)
}

export async function resolvePrintReturnAlert(
  prisma: PrismaService,
  subjectId: string,
): Promise<PrintReturnAlert | null> {
  const rows = await loadRows(prisma, subjectId)
  return rows[0] ?? null
}
