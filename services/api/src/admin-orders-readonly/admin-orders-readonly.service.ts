import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import type {
  AdminOrderReadonlyDetail,
  AdminOrderReadonlyItem,
  AdminOrderReadonlyPage,
  AdminOrderReadonlyPrintOperations,
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

export interface AdminPrintOperationContext {
  actorId: string | null
  actorRole: string
  reason?: string | null
  ipAddress?: string | null
  userAgent?: string | null
  requestId?: string | null
}

const EMPTY_PRINT_SUMMARY: AdminOrderReadonlyPrintSummary = {
  fileName: null,
  copies: null,
  colorMode: null,
  duplex: null,
  paperSize: null,
  pageRange: null,
}

const CANCELABLE_PRINT_STATUSES = new Set(['pending', 'claimed', 'printing'])
const REASSIGNABLE_PRINT_STATUSES = new Set(['pending', 'failed'])
const ADMIN_CANCEL_ERROR_CODE = 'ADMIN_CANCELLED'
const ADMIN_REASSIGN_ERROR_CODE = 'ADMIN_REASSIGNED'

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

function cleanReason(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed.slice(0, 200) : null
}

function operationReason(status: string): string | null {
  if (status === 'pending') return null
  if (status === 'claimed') return '任务已被终端领取，可取消；不能重分配，避免双重出纸'
  if (status === 'printing') return '任务正在出纸，可应急取消；不能重分配，避免双重出纸'
  if (status === 'failed') return '任务已失败，可重分配到其他在线终端'
  if (status === 'completed') return '任务已完成，不能取消或重分配'
  if (status === 'cancelled') return '任务已取消，不能继续操作'
  return '当前状态不支持运营操作'
}

function printOperations(status: string): AdminOrderReadonlyPrintOperations {
  return {
    canCancel: CANCELABLE_PRINT_STATUSES.has(status),
    canReassign: REASSIGNABLE_PRINT_STATUSES.has(status),
    reason: operationReason(status),
  }
}

function badRequest(code: string, message: string): BadRequestException {
  return new BadRequestException({ error: { code, message } })
}

@Injectable()
export class AdminOrdersReadonlyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

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
      print: row.printTask && summary
        ? {
            ...summary,
            status: row.printTask.status,
            createdAt: row.printTask.createdAt.toISOString(),
            completedAt: row.printTask.completedAt ? row.printTask.completedAt.toISOString() : null,
            errorCode: row.printTask.errorCode,
            operations: printOperations(row.printTask.status),
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

  async cancelPrintTask(id: string, ctx: AdminPrintOperationContext): Promise<AdminOrderReadonlyDetail> {
    const reason = cleanReason(ctx.reason)
    const result = await this.prisma.$transaction(async (tx) => {
      const row = (await tx.order.findUnique({
        where: { id },
        select: orderSelect(),
      })) as unknown as OrderRow | null
      if (!row) {
        throw new NotFoundException({ error: { code: 'ORDER_NOT_FOUND', message: `订单 ${id} 不存在` } })
      }
      if (!row.printTask) {
        throw badRequest('PRINT_TASK_NOT_FOUND', '订单未关联打印任务，无法取消')
      }
      const fromStatus = row.printTask.status
      if (!CANCELABLE_PRINT_STATUSES.has(fromStatus)) {
        throw badRequest('PRINT_TASK_CANCEL_NOT_ALLOWED', `任务当前状态 ${fromStatus} 不允许取消`)
      }

      const updated = await tx.printTask.updateMany({
        where: { id: row.printTask.id, status: fromStatus },
        data: {
          status: 'cancelled',
          errorCode: ADMIN_CANCEL_ERROR_CODE,
          errorMessage: reason,
          completedAt: new Date(),
        },
      })
      if (updated.count !== 1) {
        throw badRequest('PRINT_TASK_STATE_CHANGED', '任务状态已变化，请刷新后重试')
      }

      await tx.order.updateMany({
        where: { id: row.id, printTaskId: row.printTask.id },
        data: { taskStatus: 'cancelled' },
      })
      await tx.printTaskStatusLog.create({
        data: {
          taskId: row.printTask.id,
          fromStatus,
          toStatus: 'cancelled',
          errorCode: ADMIN_CANCEL_ERROR_CODE,
        },
      })

      return {
        orderId: row.id,
        orderNo: row.orderNo,
        taskId: row.printTask.id,
        fromStatus,
        terminalId: row.printTask.terminalId,
      }
    })

    await this.audit.write({
      actorId: ctx.actorId,
      actorRole: ctx.actorRole,
      action: 'print_task.admin_cancel',
      targetType: 'print_task',
      targetId: result.taskId,
      payload: {
        orderId: result.orderId,
        orderNo: result.orderNo,
        fromStatus: result.fromStatus,
        toStatus: 'cancelled',
        terminalId: result.terminalId,
        reason,
      },
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
      requestId: ctx.requestId ?? null,
    })

    return this.getById(id)
  }

  async reassignPrintTask(
    id: string,
    targetTerminalRef: string,
    ctx: AdminPrintOperationContext,
  ): Promise<AdminOrderReadonlyDetail> {
    const reason = cleanReason(ctx.reason)
    const terminalRef = targetTerminalRef.trim()
    if (!terminalRef) {
      throw badRequest('PRINT_TARGET_TERMINAL_REQUIRED', '重分配必须选择目标终端')
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const [row, targetTerminal] = await Promise.all([
        tx.order.findUnique({ where: { id }, select: orderSelect() }) as unknown as Promise<OrderRow | null>,
        tx.terminal.findFirst({
          where: { OR: [{ id: terminalRef }, { terminalCode: terminalRef }] },
          select: { id: true, terminalCode: true, enabled: true },
        }),
      ])
      if (!row) {
        throw new NotFoundException({ error: { code: 'ORDER_NOT_FOUND', message: `订单 ${id} 不存在` } })
      }
      if (!row.printTask) {
        throw badRequest('PRINT_TASK_NOT_FOUND', '订单未关联打印任务，无法重分配')
      }
      if (!targetTerminal) {
        throw badRequest('PRINT_TARGET_TERMINAL_NOT_FOUND', '目标终端不存在或未注册')
      }
      if (!targetTerminal.enabled) {
        throw badRequest('PRINT_TARGET_TERMINAL_DISABLED', '目标终端已停用，不能接收打印任务')
      }

      const fromStatus = row.printTask.status
      if (!REASSIGNABLE_PRINT_STATUSES.has(fromStatus)) {
        throw badRequest('PRINT_TASK_REASSIGN_NOT_ALLOWED', `任务当前状态 ${fromStatus} 不允许重分配`)
      }

      const updated = await tx.printTask.updateMany({
        where: { id: row.printTask.id, status: fromStatus },
        data: {
          terminalId: targetTerminal.id,
          status: 'pending',
          claimedAt: null,
          claimExpiry: null,
          completedAt: null,
          errorCode: null,
          errorMessage: null,
        },
      })
      if (updated.count !== 1) {
        throw badRequest('PRINT_TASK_STATE_CHANGED', '任务状态已变化，请刷新后重试')
      }

      await tx.order.updateMany({
        where: { id: row.id, printTaskId: row.printTask.id },
        data: { terminalId: targetTerminal.id, taskStatus: 'pending' },
      })
      await tx.printTaskStatusLog.create({
        data: {
          taskId: row.printTask.id,
          fromStatus,
          toStatus: 'pending',
          errorCode: ADMIN_REASSIGN_ERROR_CODE,
        },
      })

      return {
        orderId: row.id,
        orderNo: row.orderNo,
        taskId: row.printTask.id,
        fromStatus,
        oldTerminalId: row.printTask.terminalId,
        newTerminalId: targetTerminal.id,
        newTerminalCode: targetTerminal.terminalCode,
      }
    })

    await this.audit.write({
      actorId: ctx.actorId,
      actorRole: ctx.actorRole,
      action: 'print_task.admin_reassign',
      targetType: 'print_task',
      targetId: result.taskId,
      payload: {
        orderId: result.orderId,
        orderNo: result.orderNo,
        fromStatus: result.fromStatus,
        toStatus: 'pending',
        oldTerminalId: result.oldTerminalId,
        newTerminalId: result.newTerminalId,
        newTerminalCode: result.newTerminalCode,
        reason,
      },
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
      requestId: ctx.requestId ?? null,
    })

    return this.getById(id)
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
