/**
 * AdminPrintScanService — 统一任务中心（Task 10 Step 1/2）+ 类型感知动作。
 *
 * 聚合口径：只对已有真实数据模型的类型（print/scan/document_process）返回行；
 * 未上线类型返回空集合 + implemented=false，绝不伪造。
 *
 * 动作口径（保守最小集，其余一律 400 拒绝）：
 *   - print.retry  : failed → pending（清 claim 与错误字段，联动 Order.taskStatus，
 *                    终态 completed 永不可重置；CAS updateMany 防并发）。
 *   - scan.cancel  : waiting → cancelled（对齐 ScanTasksService 的 CAS 语义）。
 *   - 不提供 print 强制 release：过期 claim / 卡死 printing 已由 terminals.service
 *     的 30s 自动回收处理；租约未到期就强制释放会造成同一任务双份出纸。
 */

import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService, type PrismaTransactionClient } from '../prisma/prisma.service'
import { signFileUrl } from '../files/signing'
import {
  IMPLEMENTED_PRINT_SCAN_TASK_TYPES,
  type PrintScanTaskType,
} from '../terminals/terminal-capabilities.types'
import type {
  AdminCloseUnpaidPrintTaskResult,
  AdminPrintScanActionResult,
  AdminPrintScanTaskDetail,
  AdminPrintScanTaskItem,
  AdminPrintScanTaskPage,
} from './admin-print-scan.types'

export const ADMIN_UNPAID_PRINT_TASK_CLOSED_ERROR_CODE = 'ADMIN_UNPAID_PRINT_TASK_CLOSED'
const ADMIN_UNPAID_PRINT_TASK_CLOSED_ACTION = 'print_task.admin_unpaid_closed'

type CloseUnpaidBlockReason = Exclude<Extract<AdminPrintScanTaskDetail, { type: 'print' }>['closeUnpaidBlockReason'], null>
type CloseUnpaidInput = { reason: string; expectedUpdatedAt: string }
type CloseUnpaidActor = { actorId: string; actorRole: string }

// 与 print-jobs.service 的 PRINT_JOB_FILE_URL_TTL_MS 同口径：重试后 Agent claim
// 前需要一个未过期的下载链接。
const RETRY_FILE_URL_TTL_MS = 30 * 60 * 1000

// 退款相关的 payStatus（含部分退款/退款中）：这些订单重试出纸会造成"退了钱还出纸"。
const REFUND_PAY_STATUSES = new Set(['refunding', 'partial_refunded', 'refunded'])

/** 从我方 create 落库的签名 URL 中解析 fileId（仅路径解析；来源是本服务写入的可信值）。 */
function parsePrintFileId(fileUrl: string): string | null {
  try {
    const u = new URL(fileUrl, 'http://internal.local')
    return u.pathname.match(/\/files\/([^/]+)\/content$/)?.[1] ?? null
  } catch {
    return null
  }
}

const ALL_TASK_TYPES: readonly PrintScanTaskType[] = [
  'print',
  'scan',
  'document_process',
  'copy',
  'photo',
  'material_pack',
  'format_conversion',
  'signature_stamp',
] as const

export interface ListAdminPrintScanTasksParams {
  type: string
  status?: string
  terminalId?: string
  page: number
  pageSize: number
}

interface SafePrintParams {
  fileName: string | null
  copies: number | null
  colorMode: 'black_white' | 'color' | null
  paperSize: string | null
}

function parseExpectedUpdatedAt(raw: string): Date {
  const value = raw.trim()
  const parsed = new Date(value)
  // 仅接受详情 API 返回的 canonical ISO 字符串，避免 Date.parse 对非标准格式的宽松解释绕过 CAS。
  if (!value || Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new BadRequestException({ error: { code: 'ADMIN_UNPAID_CLOSE_EXPECTED_UPDATED_AT_INVALID', message: '任务版本时间格式无效' } })
  }
  return parsed
}

function normalizeCloseReason(raw: string): string {
  const reason = raw.trim()
  if (reason.length < 10 || reason.length > 500) {
    throw new BadRequestException({ error: { code: 'ADMIN_UNPAID_CLOSE_REASON_INVALID', message: '关闭原因长度必须为 10 至 500 个字符' } })
  }
  return reason
}

/** 与 admin-orders-readonly 同款的安全解析：损坏 JSON → 全 null，不抛错、不透传原文。 */
function parseSafePrintParams(paramsJson: string | null | undefined): SafePrintParams {
  const empty: SafePrintParams = { fileName: null, copies: null, colorMode: null, paperSize: null }
  if (!paramsJson) return empty
  let raw: unknown
  try {
    raw = JSON.parse(paramsJson)
  } catch {
    return empty
  }
  if (typeof raw !== 'object' || raw === null) return empty
  const p = raw as Record<string, unknown>
  const stringValue = (key: string): string | null =>
    typeof p[key] === 'string' && (p[key] as string).trim().length > 0 ? (p[key] as string).trim() : null
  return {
    fileName: stringValue('fileName'),
    copies:
      typeof p['copies'] === 'number' && Number.isInteger(p['copies']) && p['copies'] >= 1 && p['copies'] <= 99
        ? p['copies']
        : null,
    colorMode: p['colorMode'] === 'black_white' || p['colorMode'] === 'color' ? p['colorMode'] : null,
    paperSize: stringValue('paperSize'),
  }
}

@Injectable()
export class AdminPrintScanService {
  constructor(private readonly prisma: PrismaService) {}

  async listTasks(params: ListAdminPrintScanTasksParams): Promise<AdminPrintScanTaskPage> {
    const type = this.asTaskType(params.type)
    const implemented = (IMPLEMENTED_PRINT_SCAN_TASK_TYPES as readonly string[]).includes(type)
    const pagination = { page: params.page, pageSize: params.pageSize, total: 0, totalPages: 0 }

    if (!implemented) {
      return { type, implemented: false, items: [], pagination }
    }

    if (type === 'print') return this.listPrintTasks(params)
    if (type === 'scan') return this.listScanTasks(params)
    return this.listDocumentProcessTasks(params)
  }

  async getTaskDetail(type: string, taskId: string): Promise<AdminPrintScanTaskDetail> {
    const taskType = this.asTaskType(type)
    if (taskType === 'print') return this.printDetail(taskId)
    if (taskType === 'scan') return this.scanDetail(taskId)
    if (taskType === 'document_process') return this.documentProcessDetail(taskId)
    throw new BadRequestException({
      error: { code: 'PRINT_SCAN_TYPE_NOT_IMPLEMENTED', message: '该任务类型尚未上线，没有可查看的任务' },
    })
  }

  /** 类型感知动作。返回值供 controller 写审计。不支持的组合一律 400。 */
  async applyAction(type: string, taskId: string, action: string): Promise<AdminPrintScanActionResult> {
    const taskType = this.asTaskType(type)

    if (taskType === 'print' && action === 'retry') return this.retryPrintTask(taskId)
    if (taskType === 'scan' && action === 'cancel') return this.cancelScanTask(taskId)

    throw new BadRequestException({
      error: {
        code: 'PRINT_SCAN_ACTION_UNSUPPORTED',
        message: '该任务类型不支持此操作（当前仅支持：打印任务失败重试、扫描任务等待中取消）',
      },
    })
  }

  // ── print ──────────────────────────────────────────────────────────────────

  private async listPrintTasks(params: ListAdminPrintScanTasksParams): Promise<AdminPrintScanTaskPage> {
    const where: Record<string, unknown> = {}
    if (params.status) where['status'] = params.status
    if (params.terminalId) where['terminalId'] = params.terminalId

    const [rows, total] = await Promise.all([
      this.prisma.printTask.findMany({
        where,
        select: {
          id: true,
          terminalId: true,
          terminal: { select: { terminalCode: true } },
          endUserId: true,
          status: true,
          paramsJson: true,
          errorCode: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      this.prisma.printTask.count({ where }),
    ])

    const items: AdminPrintScanTaskItem[] = rows.map((row) => {
      const safe = parseSafePrintParams(row.paramsJson)
      return {
        type: 'print' as const,
        taskId: row.id,
        terminalId: row.terminalId,
        terminalCode: row.terminal?.terminalCode ?? null,
        status: row.status,
        ownerType: row.endUserId ? ('member' as const) : ('anonymous' as const),
        errorCode: row.errorCode,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        expiresAt: null,
        ...safe,
      }
    })

    return {
      type: 'print',
      implemented: true,
      items,
      pagination: this.paginate(params, total),
    }
  }

  private async printDetail(taskId: string): Promise<AdminPrintScanTaskDetail> {
    const row = await this.prisma.printTask.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        terminalId: true,
        terminal: { select: { terminalCode: true } },
        endUserId: true,
        status: true,
        paramsJson: true,
        errorCode: true,
        completedAt: true,
        createdAt: true,
        updatedAt: true,
        order: { select: { id: true, orderNo: true, payStatus: true, taskStatus: true } },
        statusLogs: {
          select: { fromStatus: true, toStatus: true, errorCode: true, createdAt: true },
          orderBy: { createdAt: 'asc' },
        },
      },
    })
    if (!row) {
      throw new NotFoundException({ error: { code: 'PRINT_SCAN_TASK_NOT_FOUND', message: '任务不存在' } })
    }
    const safe = parseSafePrintParams(row.paramsJson)
    const eligibility = await this.getCloseUnpaidEligibility(row.id)
    return {
      type: 'print',
      taskId: row.id,
      terminalId: row.terminalId,
      terminalCode: row.terminal?.terminalCode ?? null,
      status: row.status,
      ownerType: row.endUserId ? 'member' : 'anonymous',
      errorCode: row.errorCode,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      expiresAt: null,
      completedAt: row.completedAt?.toISOString() ?? null,
      orderId: row.order?.id ?? null,
      orderNo: row.order?.orderNo ?? null,
      statusLogs: row.statusLogs.map((log) => ({
        fromStatus: log.fromStatus,
        toStatus: log.toStatus,
        errorCode: log.errorCode,
        createdAt: log.createdAt.toISOString(),
      })),
      closeUnpaidEligible: eligibility.eligible,
      closeUnpaidBlockReason: eligibility.reason,
      ...safe,
    }
  }

  /**
   * Admin 专用的未付款受控关闭。其交易边界覆盖 PrintTask、Order、状态日志和审计，
   * 严禁复用 AuditService.write（该服务为不阻断业务而吞审计错误）。
   */
  async closeUnpaidPrintTask(
    taskId: string,
    input: CloseUnpaidInput,
    actor: CloseUnpaidActor,
  ): Promise<AdminCloseUnpaidPrintTaskResult> {
    const reason = normalizeCloseReason(input.reason)
    const expectedUpdatedAt = parseExpectedUpdatedAt(input.expectedUpdatedAt)

    return this.prisma.$transaction(async (tx: PrismaTransactionClient) => {
      const task = await tx.printTask.findUnique({
        where: { id: taskId },
        select: {
          id: true,
          status: true,
          claimedAt: true,
          claimExpiry: true,
          updatedAt: true,
          errorCode: true,
          order: { select: { id: true, printTaskId: true, payStatus: true, taskStatus: true } },
        },
      })
      if (!task) {
        throw new NotFoundException({ error: { code: 'PRINT_SCAN_TASK_NOT_FOUND', message: '任务不存在' } })
      }

      // 仅本入口产生的完整终态可幂等回放；其它 cancelled（包括无订单/订单不一致）必须显式冲突。
      if (task.status === 'cancelled') {
        if (
          task.errorCode === ADMIN_UNPAID_PRINT_TASK_CLOSED_ERROR_CODE &&
          task.order?.printTaskId === task.id &&
          task.order.payStatus === 'closed' &&
          task.order.taskStatus === 'cancelled'
        ) {
          return { taskId, type: 'print', fromStatus: 'cancelled', toStatus: 'cancelled', idempotent: true }
        }
        throw new ConflictException({ error: { code: 'ADMIN_UNPAID_CLOSE_CONFLICT', message: '任务已被其他流程关闭，不能作为未付款任务关闭回放' } })
      }

      if (task.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
        throw new ConflictException({ error: { code: 'ADMIN_UNPAID_CLOSE_STALE', message: '任务已更新，请刷新后重试' } })
      }

      const eligibility = await this.getCloseUnpaidEligibility(taskId, tx)
      if (!eligibility.eligible) {
        throw new ConflictException({ error: { code: 'ADMIN_UNPAID_CLOSE_NOT_ELIGIBLE', message: '任务不符合未付款受控关闭条件' } })
      }
      const order = task.order
      if (!order) {
        // getCloseUnpaidEligibility 已覆盖该分支，保留防御性窄化保证后续 CAS 不接受可选 order。
        throw new ConflictException({ error: { code: 'ADMIN_UNPAID_CLOSE_NOT_ELIGIBLE', message: '任务不符合未付款受控关闭条件' } })
      }

      const closedAt = new Date()
      // Agent claim 与本 CAS 竞争：仅 pending + 两个 claim 字段均为 null + 版本戳一致时才能关闭。
      const taskUpdate = await tx.printTask.updateMany({
        where: {
          id: taskId,
          status: 'pending',
          claimedAt: null,
          claimExpiry: null,
          updatedAt: expectedUpdatedAt,
        },
        data: {
          status: 'cancelled',
          completedAt: closedAt,
          errorCode: ADMIN_UNPAID_PRINT_TASK_CLOSED_ERROR_CODE,
          errorMessage: '管理员已关闭未付款且未领取的打印任务',
        },
      })
      if (taskUpdate.count !== 1) {
        throw new ConflictException({ error: { code: 'ADMIN_UNPAID_CLOSE_CONFLICT', message: '任务状态已变化，请刷新后重试' } })
      }

      // 支付出码使用 Order unpaid→paying 的 CAS；双方都限定同一 printTaskId，因此任一方先提交，另一方必失败并回滚。
      const orderUpdate = await tx.order.updateMany({
        where: { id: order.id, printTaskId: taskId, payStatus: 'unpaid', taskStatus: 'pending' },
        data: { payStatus: 'closed', taskStatus: 'cancelled' },
      })
      if (orderUpdate.count !== 1) {
        throw new ConflictException({ error: { code: 'ADMIN_UNPAID_CLOSE_CONFLICT', message: '订单状态已变化，请刷新后重试' } })
      }

      await tx.printTaskStatusLog.create({
        data: {
          taskId,
          fromStatus: 'pending',
          toStatus: 'cancelled',
          errorCode: ADMIN_UNPAID_PRINT_TASK_CLOSED_ERROR_CODE,
        },
      })
      await tx.auditLog.create({
        data: {
          actorId: actor.actorId,
          actorRole: actor.actorRole,
          action: ADMIN_UNPAID_PRINT_TASK_CLOSED_ACTION,
          targetType: 'print_task',
          targetId: taskId,
          payloadJson: JSON.stringify({
            reason,
            expectedUpdatedAt: input.expectedUpdatedAt,
            fromStatus: 'pending',
            toStatus: 'cancelled',
            orderPayStatus: { from: 'unpaid', to: 'closed' },
          }),
        },
      })

      return { taskId, type: 'print', fromStatus: 'pending', toStatus: 'cancelled', idempotent: false }
    })
  }

  private async getCloseUnpaidEligibility(
    taskId: string,
    client: Pick<PrismaService, 'printTask'> | Pick<PrismaTransactionClient, 'printTask'> = this.prisma,
  ): Promise<{ eligible: boolean; reason: CloseUnpaidBlockReason | null }> {
    const task = await client.printTask.findUnique({
      where: { id: taskId },
      select: {
        status: true,
        claimedAt: true,
        claimExpiry: true,
        order: {
          select: {
            id: true,
            payStatus: true,
            taskStatus: true,
            // failed 也不能忽略：支付渠道可能迟到回调成功。关闭后保留任何 attempt
            // 都会让已取消任务的订单被旧回调重新入账，必须先走对账/退款流程。
            paymentAttempts: { select: { id: true }, take: 1 },
          },
        },
      },
    })
    if (!task?.order) return { eligible: false, reason: 'no_associated_order' }
    if (task.status !== 'pending') return { eligible: false, reason: 'task_not_pending' }
    if (task.claimedAt !== null || task.claimExpiry !== null) return { eligible: false, reason: 'task_claimed' }
    if (task.order.payStatus !== 'unpaid') return { eligible: false, reason: 'order_not_unpaid' }
    if (task.order.taskStatus !== 'pending') return { eligible: false, reason: 'order_task_not_pending' }
    if (task.order.paymentAttempts.length > 0) return { eligible: false, reason: 'payment_attempt_exists' }
    return { eligible: true, reason: null }
  }

  private async retryPrintTask(taskId: string): Promise<AdminPrintScanActionResult> {
    const task = await this.prisma.printTask.findUnique({
      where: { id: taskId },
      select: { id: true, status: true, fileUrl: true, order: { select: { payStatus: true } } },
    })
    if (!task) {
      throw new NotFoundException({ error: { code: 'PRINT_SCAN_TASK_NOT_FOUND', message: '任务不存在' } })
    }
    if (task.status !== 'failed') {
      throw new ConflictException({
        error: { code: 'PRINT_SCAN_ACTION_INVALID_STATE', message: '仅失败状态的打印任务可以重试' },
      })
    }
    // 已退款/退款中订单重试会造成"退了钱还出纸"，明确拒绝。
    if (task.order && REFUND_PAY_STATUSES.has(task.order.payStatus)) {
      throw new ConflictException({
        error: { code: 'PRINT_SCAN_RETRY_REFUNDED', message: '该任务的订单已退款或退款中，不能重试出纸' },
      })
    }
    // 失败任务多半已超过 30 分钟签名 TTL，原 fileUrl 重排后 Agent 必然下载失败：
    // 校验文件仍存在（未被隐私策略清理）并重新签发下载链接。
    const fileId = parsePrintFileId(task.fileUrl)
    if (!fileId) {
      throw new ConflictException({
        error: { code: 'PRINT_SCAN_RETRY_FILE_UNAVAILABLE', message: '打印文件链接无法解析，无法重试' },
      })
    }
    const file = await this.prisma.fileObject.findUnique({ where: { id: fileId }, select: { deletedAt: true } })
    if (!file || file.deletedAt) {
      throw new ConflictException({
        error: { code: 'PRINT_SCAN_RETRY_FILE_UNAVAILABLE', message: '打印文件已按隐私策略清理，无法重试' },
      })
    }
    const { url: freshFileUrl } = signFileUrl(fileId, RETRY_FILE_URL_TTL_MS)

    await this.prisma.$transaction(async (tx) => {
      // CAS：并发下只有仍处于 failed 的任务会被重置；数量为 0 视为状态已被他人变更。
      // 同步重签 fileUrl、清空 failed 时写入的 completedAt。
      const updated = await tx.printTask.updateMany({
        where: { id: taskId, status: 'failed' },
        data: {
          status: 'pending',
          claimedAt: null,
          claimExpiry: null,
          completedAt: null,
          errorCode: null,
          errorMessage: null,
          fileUrl: freshFileUrl,
        },
      })
      if (updated.count !== 1) {
        throw new ConflictException({
          error: { code: 'PRINT_SCAN_ACTION_INVALID_STATE', message: '任务状态已变更，请刷新后重试' },
        })
      }
      // 与 resetExpiredClaims 同款：联动 Order.taskStatus，保持订单视图一致。
      await tx.order.updateMany({
        where: { printTaskId: taskId, printTask: { is: { status: 'pending' } } },
        data: { taskStatus: 'pending' },
      })
      await tx.printTaskStatusLog.create({
        data: { taskId, fromStatus: 'failed', toStatus: 'pending', errorCode: 'admin_retry' },
      })
    })

    return { taskId, type: 'print', action: 'retry', fromStatus: 'failed', toStatus: 'pending' }
  }

  // ── scan ───────────────────────────────────────────────────────────────────

  private async listScanTasks(params: ListAdminPrintScanTasksParams): Promise<AdminPrintScanTaskPage> {
    const where: Record<string, unknown> = {}
    if (params.status) where['status'] = params.status
    if (params.terminalId) where['terminalId'] = params.terminalId

    const [rows, total] = await Promise.all([
      this.prisma.scanTask.findMany({
        where,
        select: {
          id: true,
          terminalId: true,
          terminal: { select: { terminalCode: true } },
          endUserId: true,
          scanType: true,
          status: true,
          fileId: true,
          errorCode: true,
          expiresAt: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      this.prisma.scanTask.count({ where }),
    ])

    const items: AdminPrintScanTaskItem[] = rows.map((row) => ({
      type: 'scan' as const,
      taskId: row.id,
      terminalId: row.terminalId,
      terminalCode: row.terminal?.terminalCode ?? null,
      status: row.status,
      ownerType: row.endUserId ? ('member' as const) : ('anonymous' as const),
      errorCode: row.errorCode,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      scanType: row.scanType,
      hasResultFile: Boolean(row.fileId),
    }))

    return { type: 'scan', implemented: true, items, pagination: this.paginate(params, total) }
  }

  private async scanDetail(taskId: string): Promise<AdminPrintScanTaskDetail> {
    const row = await this.prisma.scanTask.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        terminalId: true,
        terminal: { select: { terminalCode: true } },
        endUserId: true,
        scanType: true,
        status: true,
        fileId: true,
        errorCode: true,
        expiresAt: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    if (!row) {
      throw new NotFoundException({ error: { code: 'PRINT_SCAN_TASK_NOT_FOUND', message: '任务不存在' } })
    }
    return {
      type: 'scan',
      taskId: row.id,
      terminalId: row.terminalId,
      terminalCode: row.terminal?.terminalCode ?? null,
      status: row.status,
      ownerType: row.endUserId ? 'member' : 'anonymous',
      errorCode: row.errorCode,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      scanType: row.scanType,
      hasResultFile: Boolean(row.fileId),
      fileId: row.fileId,
    }
  }

  private async cancelScanTask(taskId: string): Promise<AdminPrintScanActionResult> {
    const task = await this.prisma.scanTask.findUnique({
      where: { id: taskId },
      select: { id: true, status: true },
    })
    if (!task) {
      throw new NotFoundException({ error: { code: 'PRINT_SCAN_TASK_NOT_FOUND', message: '任务不存在' } })
    }
    if (task.status !== 'waiting') {
      throw new ConflictException({
        error: { code: 'PRINT_SCAN_ACTION_INVALID_STATE', message: '仅等待中的扫描任务可以取消' },
      })
    }

    // CAS：对齐 scan-tasks 服务的取消语义（waiting → cancelled，并发下不覆盖终态）。
    const updated = await this.prisma.scanTask.updateMany({
      where: { id: taskId, status: 'waiting' },
      data: { status: 'cancelled' },
    })
    if (updated.count !== 1) {
      throw new ConflictException({
        error: { code: 'PRINT_SCAN_ACTION_INVALID_STATE', message: '任务状态已变更，请刷新后重试' },
      })
    }

    return { taskId, type: 'scan', action: 'cancel', fromStatus: 'waiting', toStatus: 'cancelled' }
  }

  // ── document_process ───────────────────────────────────────────────────────

  private async listDocumentProcessTasks(params: ListAdminPrintScanTasksParams): Promise<AdminPrintScanTaskPage> {
    const where: Record<string, unknown> = {}
    if (params.status) where['status'] = params.status
    // DocumentProcessTask 没有终端归属字段；按终端过滤时如实返回空集合。
    if (params.terminalId) {
      return {
        type: 'document_process',
        implemented: true,
        items: [],
        pagination: this.paginate(params, 0),
      }
    }

    const [rows, total] = await Promise.all([
      this.prisma.documentProcessTask.findMany({
        where,
        select: {
          id: true,
          kind: true,
          status: true,
          endUserId: true,
          resultFileId: true,
          errorCode: true,
          expiresAt: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: { createdAt: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      this.prisma.documentProcessTask.count({ where }),
    ])

    const items: AdminPrintScanTaskItem[] = rows.map((row) => ({
      type: 'document_process' as const,
      taskId: row.id,
      terminalId: null,
      terminalCode: null,
      status: row.status,
      ownerType: row.endUserId ? ('member' as const) : ('anonymous' as const),
      errorCode: row.errorCode,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      kind: row.kind,
      hasResultFile: Boolean(row.resultFileId),
    }))

    return { type: 'document_process', implemented: true, items, pagination: this.paginate(params, total) }
  }

  private async documentProcessDetail(taskId: string): Promise<AdminPrintScanTaskDetail> {
    const row = await this.prisma.documentProcessTask.findUnique({
      where: { id: taskId },
      select: {
        id: true,
        kind: true,
        status: true,
        endUserId: true,
        sourceFileId: true,
        resultFileId: true,
        errorCode: true,
        expiresAt: true,
        createdAt: true,
        updatedAt: true,
      },
    })
    if (!row) {
      throw new NotFoundException({ error: { code: 'PRINT_SCAN_TASK_NOT_FOUND', message: '任务不存在' } })
    }
    return {
      type: 'document_process',
      taskId: row.id,
      terminalId: null,
      terminalCode: null,
      status: row.status,
      ownerType: row.endUserId ? 'member' : 'anonymous',
      errorCode: row.errorCode,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
      kind: row.kind,
      hasResultFile: Boolean(row.resultFileId),
      sourceFileId: row.sourceFileId,
      resultFileId: row.resultFileId,
    }
  }

  // ── helpers ────────────────────────────────────────────────────────────────

  private asTaskType(raw: string): PrintScanTaskType {
    if (!(ALL_TASK_TYPES as readonly string[]).includes(raw)) {
      throw new BadRequestException({ error: { code: 'PRINT_SCAN_TYPE_INVALID', message: '未知的任务类型' } })
    }
    return raw as PrintScanTaskType
  }

  private paginate(params: ListAdminPrintScanTasksParams, total: number) {
    return {
      page: params.page,
      pageSize: params.pageSize,
      total,
      totalPages: total === 0 ? 0 : Math.ceil(total / params.pageSize),
    }
  }
}
