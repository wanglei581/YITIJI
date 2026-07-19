import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import type {
  AdminOrderReadonlyDetail,
  AdminOrderReadonlyItem,
  AdminOrderReadonlyPage,
  AdminOrderReadonlyPrintSummary,
  AdminOrderStatusLogItem,
} from './admin-orders-readonly.types'

interface OrderRow {
  id: string
  orderNo: string
  type: string
  printTaskId: string | null
  endUserId: string | null
  terminalId: string | null
  amountCents: number
  currency: string
  payStatus: string
  taskStatus: string
  refundReason: string | null
  refundedAt: Date | null
  createdAt: Date
  updatedAt: Date
  printTask: {
    id: string
    terminalId: string | null
    paramsJson: string
    status: string
    errorCode: string | null
    createdAt: Date
    completedAt: Date | null
  } | null
}

interface LabelMaps {
  userLabels: Map<string, string | null>
  terminalCodes: Map<string, string>
}

export interface ListAdminOrdersReadonlyParams {
  type?: string
  payStatus?: string
  taskStatus?: string
  search?: string
  page: number
  pageSize: number
}

const EMPTY_PRINT_SUMMARY: AdminOrderReadonlyPrintSummary = {
  fileName: null,
  copies: null,
  colorMode: null,
  duplex: null,
  paperSize: null,
  pageRange: null,
}

function parseSafePrintSummary(paramsJson: string | null | undefined): AdminOrderReadonlyPrintSummary {
  if (!paramsJson) return { ...EMPTY_PRINT_SUMMARY }
  let raw: unknown
  try {
    raw = JSON.parse(paramsJson)
  } catch {
    return { ...EMPTY_PRINT_SUMMARY }
  }
  if (typeof raw !== 'object' || raw === null) return { ...EMPTY_PRINT_SUMMARY }
  const p = raw as Record<string, unknown>
  const stringValue = (key: string): string | null =>
    typeof p[key] === 'string' && (p[key] as string).trim().length > 0 ? (p[key] as string).trim() : null
  const copies =
    typeof p['copies'] === 'number' && Number.isInteger(p['copies']) && p['copies'] >= 1 && p['copies'] <= 99
      ? p['copies']
      : null
  return {
    fileName: stringValue('fileName'),
    copies,
    colorMode: p['colorMode'] === 'black_white' || p['colorMode'] === 'color' ? p['colorMode'] : null,
    duplex: stringValue('duplex'),
    paperSize: stringValue('paperSize'),
    pageRange: stringValue('pageRange'),
  }
}

@Injectable()
export class AdminOrdersReadonlyService {
  constructor(private readonly prisma: PrismaService) {}

  async list(params: ListAdminOrdersReadonlyParams): Promise<AdminOrderReadonlyPage> {
    const where: Record<string, unknown> = {}
    if (params.type) where['type'] = params.type
    if (params.payStatus) where['payStatus'] = params.payStatus
    if (params.taskStatus) where['taskStatus'] = params.taskStatus
    if (params.search && params.search.trim()) where['orderNo'] = { contains: params.search.trim() }

    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        select: orderSelect(),
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      this.prisma.order.count({ where }),
    ])

    const orderRows = rows as unknown as OrderRow[]
    const labels = await this.lookupLabels(orderRows)
    return {
      items: orderRows.map((row) => this.toItem(row, labels)),
      pagination: {
        page: params.page,
        pageSize: params.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / params.pageSize)),
      },
    }
  }

  async getById(id: string): Promise<AdminOrderReadonlyDetail> {
    const row = (await this.prisma.order.findUnique({
      where: { id },
      select: orderSelect(),
    })) as unknown as OrderRow | null
    if (!row) {
      throw new NotFoundException({ error: { code: 'ORDER_NOT_FOUND', message: `订单 ${id} 不存在` } })
    }

    const labels = await this.lookupLabels([row])
    const item = this.toItem(row, labels)
    const summary = row.printTask ? parseSafePrintSummary(row.printTask.paramsJson) : null
    const statusLogs = row.printTask
      ? await this.prisma.printTaskStatusLog.findMany({
          where: { taskId: row.printTask.id },
          orderBy: { createdAt: 'asc' },
          select: { fromStatus: true, toStatus: true, errorCode: true, createdAt: true },
        })
      : []

    return {
      ...item,
      refundedAt: row.refundedAt ? row.refundedAt.toISOString() : null,
      refundReason: row.refundReason,
      printTaskId: row.printTaskId ?? null,
      print: row.printTask && summary
        ? {
            ...summary,
            status: row.printTask.status,
            createdAt: row.printTask.createdAt.toISOString(),
            completedAt: row.printTask.completedAt ? row.printTask.completedAt.toISOString() : null,
            errorCode: row.printTask.errorCode,
          }
        : null,
      statusLogs: statusLogs.map((log): AdminOrderStatusLogItem => ({
        fromStatus: log.fromStatus,
        toStatus: log.toStatus,
        errorCode: log.errorCode ?? null,
        createdAt: log.createdAt.toISOString(),
      })),
    }
  }

  private async lookupLabels(rows: OrderRow[]): Promise<LabelMaps> {
    const endUserIds = [...new Set(rows.map((row) => row.endUserId).filter((id): id is string => Boolean(id)))]
    const terminalIds = [
      ...new Set(
        rows
          .flatMap((row) => [row.terminalId, row.printTask?.terminalId ?? null])
          .filter((id): id is string => Boolean(id)),
      ),
    ]

    const [users, terminals] = await Promise.all([
      endUserIds.length > 0
        ? this.prisma.endUser.findMany({ where: { id: { in: endUserIds } }, select: { id: true, nickname: true } })
        : Promise.resolve([]),
      terminalIds.length > 0
        ? this.prisma.terminal.findMany({ where: { id: { in: terminalIds } }, select: { id: true, terminalCode: true } })
        : Promise.resolve([]),
    ])

    return {
      userLabels: new Map(users.map((user) => [user.id, user.nickname ?? null])),
      terminalCodes: new Map(terminals.map((terminal) => [terminal.id, terminal.terminalCode])),
    }
  }

  private toItem(row: OrderRow, labels: LabelMaps): AdminOrderReadonlyItem {
    const printSummary = parseSafePrintSummary(row.printTask?.paramsJson)
    const effectiveTerminalId = row.terminalId ?? row.printTask?.terminalId ?? null
    const ownerType = row.endUserId ? 'member' : 'anonymous'
    const nickname = row.endUserId ? labels.userLabels.get(row.endUserId) : null
    return {
      id: row.id,
      orderNo: row.orderNo,
      type: row.type,
      ownerType,
      userLabel: ownerType === 'member' ? (nickname && nickname.length > 0 ? nickname : '会员') : '游客',
      terminalCode: effectiveTerminalId ? labels.terminalCodes.get(effectiveTerminalId) ?? null : null,
      amountCents: row.amountCents,
      currency: row.currency,
      payStatus: row.payStatus,
      taskStatus: row.taskStatus,
      printFileName: printSummary.fileName,
      copies: printSummary.copies,
      colorMode: printSummary.colorMode,
      paperSize: printSummary.paperSize,
      errorCode: row.printTask?.errorCode ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }
  }
}

function orderSelect() {
  return {
    id: true,
    orderNo: true,
    type: true,
    printTaskId: true,
    endUserId: true,
    terminalId: true,
    amountCents: true,
    currency: true,
    payStatus: true,
    taskStatus: true,
    refundReason: true,
    refundedAt: true,
    createdAt: true,
    updatedAt: true,
    printTask: {
      select: {
        id: true,
        terminalId: true,
        paramsJson: true,
        status: true,
        errorCode: true,
        createdAt: true,
        completedAt: true,
      },
    },
  } as const
}
