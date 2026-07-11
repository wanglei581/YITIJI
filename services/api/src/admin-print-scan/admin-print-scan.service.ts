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
import { PrismaService } from '../prisma/prisma.service'
import { signFileUrl } from '../files/signing'
import {
  IMPLEMENTED_PRINT_SCAN_TASK_TYPES,
  type PrintScanTaskType,
} from '../terminals/terminal-capabilities.types'
import type {
  AdminPrintScanActionResult,
  AdminPrintScanTaskDetail,
  AdminPrintScanTaskItem,
  AdminPrintScanTaskPage,
} from './admin-print-scan.types'

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
        order: { select: { id: true, orderNo: true } },
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
      ...safe,
    }
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
