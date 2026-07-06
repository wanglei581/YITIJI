import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { AuditService } from '../audit/audit.service'
import { PrismaService } from '../prisma/prisma.service'

type AdminPrintOrderActionResult = {
  orderId: string
  orderNo: string
  printTaskId: string
  taskStatus: string
  terminalId: string | null
  terminalCode: string | null
  payStatus: string
  updatedAt: string
}

type OrderWithPrintTask = {
  id: string
  orderNo: string
  type: string
  printTaskId: string | null
  payStatus: string
  taskStatus: string
  terminalId: string | null
  printTask: {
    id: string
    status: string
    terminalId: string | null
  } | null
}

@Injectable()
export class AdminPrintOrderActionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async cancelOrder(
    orderId: string,
    opts: { reason?: string; operatorId?: string },
  ): Promise<AdminPrintOrderActionResult> {
    const order = await this.requirePendingPrintOrder(orderId)
    const reason = opts.reason?.trim() || null

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.printTask.updateMany({
        where: { id: order.printTask!.id, status: 'pending' },
        data: {
          status: 'cancelled',
          claimExpiry: null,
          errorCode: 'ADMIN_CANCELLED',
          errorMessage: reason,
          completedAt: null,
        },
      })
      if (updated.count !== 1) {
        throw new BadRequestException({
          error: { code: 'ORDER_TASK_NOT_PENDING', message: 'print task is no longer pending' },
        })
      }

      await tx.printTaskStatusLog.create({
        data: {
          taskId: order.printTask!.id,
          fromStatus: 'pending',
          toStatus: 'cancelled',
          errorCode: 'ADMIN_CANCELLED',
        },
      })
      await tx.order.update({
        where: { id: order.id },
        data: { taskStatus: 'cancelled' },
      })
    })

    await this.audit.write({
      actorId: null,
      actorRole: 'system',
      action: 'order.print.cancel',
      targetType: 'order',
      targetId: order.id,
      payload: {
        operatorId: opts.operatorId ?? null,
        printTaskId: order.printTask!.id,
        terminalId: order.terminalId,
        reason,
      },
    })

    return this.toResult(order.id)
  }

  async reassignOrder(
    orderId: string,
    opts: { terminalId: string; reason?: string; operatorId?: string },
  ): Promise<AdminPrintOrderActionResult> {
    const order = await this.requirePendingPrintOrder(orderId)
    const terminalRef = opts.terminalId.trim()
    if (!terminalRef) {
      throw new BadRequestException({
        error: { code: 'TERMINAL_ID_REQUIRED', message: 'terminalId is required' },
      })
    }

    const targetTerminal = await this.prisma.terminal.findFirst({
      where: { OR: [{ id: terminalRef }, { terminalCode: terminalRef }] },
      select: { id: true, terminalCode: true, enabled: true },
    })
    if (!targetTerminal) {
      throw new NotFoundException({
        error: { code: 'TERMINAL_NOT_FOUND', message: 'target terminal not found' },
      })
    }
    if (!targetTerminal.enabled) {
      throw new BadRequestException({
        error: { code: 'TERMINAL_DISABLED', message: 'target terminal is disabled' },
      })
    }

    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.printTask.updateMany({
        where: { id: order.printTask!.id, status: 'pending' },
        data: {
          terminalId: targetTerminal.id,
          claimExpiry: null,
          claimedAt: null,
        },
      })
      if (updated.count !== 1) {
        throw new BadRequestException({
          error: { code: 'ORDER_TASK_NOT_PENDING', message: 'print task is no longer pending' },
        })
      }

      await tx.printTaskStatusLog.create({
        data: {
          taskId: order.printTask!.id,
          fromStatus: 'pending',
          toStatus: 'pending',
          errorCode: 'ADMIN_REASSIGNED',
        },
      })
      await tx.order.update({
        where: { id: order.id },
        data: { taskStatus: 'pending', terminalId: targetTerminal.id },
      })
    })

    await this.audit.write({
      actorId: null,
      actorRole: 'system',
      action: 'order.print.reassign',
      targetType: 'order',
      targetId: order.id,
      payload: {
        operatorId: opts.operatorId ?? null,
        printTaskId: order.printTask!.id,
        oldTerminalId: order.terminalId,
        newTerminalId: targetTerminal.id,
        newTerminalCode: targetTerminal.terminalCode,
        reason: opts.reason?.trim() || null,
      },
    })

    return this.toResult(order.id)
  }

  private async requirePendingPrintOrder(orderId: string): Promise<OrderWithPrintTask> {
    const order = (await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNo: true,
        type: true,
        printTaskId: true,
        payStatus: true,
        taskStatus: true,
        terminalId: true,
        printTask: { select: { id: true, status: true, terminalId: true } },
      },
    })) as OrderWithPrintTask | null
    if (!order) {
      throw new NotFoundException({ error: { code: 'ORDER_NOT_FOUND', message: 'order not found' } })
    }
    if (order.type !== 'print' || !order.printTaskId || !order.printTask) {
      throw new BadRequestException({
        error: { code: 'ORDER_PRINT_TASK_MISSING', message: 'order is not bound to a print task' },
      })
    }
    if (order.taskStatus !== 'pending' || order.printTask.status !== 'pending') {
      throw new BadRequestException({
        error: { code: 'ORDER_TASK_NOT_PENDING', message: 'only pending print orders can be changed' },
      })
    }
    return order
  }

  private async toResult(orderId: string): Promise<AdminPrintOrderActionResult> {
    const row = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: {
        id: true,
        orderNo: true,
        printTaskId: true,
        taskStatus: true,
        terminalId: true,
        payStatus: true,
        updatedAt: true,
        printTask: {
          select: {
            terminal: { select: { terminalCode: true } },
          },
        },
      },
    })
    if (!row || !row.printTaskId) {
      throw new NotFoundException({ error: { code: 'ORDER_NOT_FOUND', message: 'order not found' } })
    }
    return {
      orderId: row.id,
      orderNo: row.orderNo,
      printTaskId: row.printTaskId,
      taskStatus: row.taskStatus,
      terminalId: row.terminalId,
      terminalCode: row.printTask?.terminal?.terminalCode ?? null,
      payStatus: row.payStatus,
      updatedAt: row.updatedAt.toISOString(),
    }
  }
}
