/**
 * 已付款没出纸：自动退失败，或待人工（含金额对不上、渠道还没确认、已经放行不能再退成）。
 * 自动退成功从列表消失。退款停在失败、待确认或待人工时，订单即使已是退款中也还留在列表里。
 * 不复用服务单那条。
 */
import type { PrismaService } from '../prisma/prisma.service'
import { PRINT_RETURN_MANUAL_TYPE } from '../payment/print-no-paper-refund.constants'
import { listPrintReturnHolds } from '../payment/print-return-disposition'
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

function buildAlert(
  row: { orderId: string; updatedAt: Date; reason: string },
  terminalCode: string | null,
): PrintReturnAlert {
  const subjectKey = buildSubjectKey(PRINT_RETURN_MANUAL_TYPE, row.orderId)
  return {
    id: subjectKey,
    subjectKey,
    subjectId: row.orderId,
    episodeToken: row.updatedAt.toISOString(),
    type: PRINT_RETURN_MANUAL_TYPE,
    severity: 'error',
    title: '打印没出纸，待人工处理',
    detail: row.reason,
    terminalCode,
    occurredAt: row.updatedAt.toISOString(),
  }
}

async function loadRows(prisma: PrismaService, orderId?: string): Promise<PrintReturnAlert[]> {
  const holds = (await listPrintReturnHolds(prisma)).filter((hold) => !orderId || hold.orderId === orderId)
  const terminalIds = [...new Set(holds.map((hold) => hold.terminalId).filter((id): id is string => Boolean(id)))]
  const terminals = terminalIds.length === 0
    ? []
    : await prisma.terminal.findMany({
      where: { id: { in: terminalIds } },
      select: { id: true, terminalCode: true },
    })
  const codes = new Map(terminals.map((terminal) => [terminal.id, terminal.terminalCode]))
  return holds.map((hold) => buildAlert(hold, hold.terminalId ? codes.get(hold.terminalId) ?? null : null))
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
