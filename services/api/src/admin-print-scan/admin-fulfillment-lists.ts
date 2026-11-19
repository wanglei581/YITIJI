/**
 * 管理员只读列表：屏上复印（CopyJob）与材料包订单（Order + OrderItem）。
 *
 * 不进统一任务聚合。聚合端点对 copy / material_pack 仍返回 implemented=false，
 * 避免把新行混进打印、扫描、文档处理那张表。
 *
 * 材料包没有单独的任务表。会员材料包订单写在 Order（type 仍是 print）和 OrderItem 上，
 * 识别口径与会员订单时间线相同：有订单行、不是复印单。PrintMaterialPack 只是目录，不在这里列。
 * 格式转换没有任务表或订单表，只有文件上的 derivationKind，本模块不给它造列表。
 *
 * 响应只留运维要看的字段。不返回文件地址、文件编号、手机号、取件码、报价快照或用户编号。
 */

import { BadRequestException, Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'

export const COPY_LIST_STATUSES = [
  'queued', 'scanning', 'printing', 'completed', 'failed', 'cancelled', 'expired', 'unconfirmed',
] as const
export const PACK_LIST_STATUSES = [
  'queued', 'printing', 'completed', 'failed', 'cancelled', 'expired',
] as const

export type AdminFulfillmentStatus =
  | (typeof COPY_LIST_STATUSES)[number]
  | 'unclassified'

export interface AdminFulfillmentListItem {
  id: string
  recordNo: string
  terminalId: string | null
  terminalCode: string | null
  startedAt: string
  copies: number | null
  lineCount: number | null
  status: AdminFulfillmentStatus
  statusLabel: string
  failureReason: string | null
}

export interface AdminFulfillmentListPage {
  items: AdminFulfillmentListItem[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
}

const COPY_STATE_GROUPS: Record<(typeof COPY_LIST_STATUSES)[number], readonly string[]> = {
  queued: ['ready', 'page_ready', 'scanned', 'confirmed'],
  scanning: ['scanning'],
  printing: ['dispatching', 'spooled'],
  completed: ['handed'],
  failed: ['failed'],
  cancelled: ['cancelled'],
  expired: ['expired'],
  unconfirmed: ['unconfirmed'],
}

const PACK_STATE_GROUPS: Record<(typeof PACK_LIST_STATUSES)[number], readonly string[]> = {
  queued: ['pending_release', 'pending', 'awaiting_payment'],
  printing: ['claimed', 'printing'],
  completed: ['completed'],
  failed: ['failed'],
  cancelled: ['cancelled', 'closed'],
  expired: ['expired'],
}

const STATUS_LABELS: Record<AdminFulfillmentStatus, string> = {
  queued: '排队',
  scanning: '扫描中',
  printing: '打印中',
  completed: '完成',
  failed: '失败',
  cancelled: '已取消',
  expired: '已过期',
  unconfirmed: '出纸未确认',
  unclassified: '状态未归类',
}

/** 给管理员看的说法。未知或带路径的原码不原样返回。 */
const FAILURE_PHRASES: Record<string, string> = {
  DOWNLOAD_HASH_MISMATCH: '文件校验未通过',
  PRINTER_NOT_FOUND: '找不到打印机',
  PRINTER_OFFLINE: '打印机离线',
  printer_offline: '打印机离线',
  PAPER_EMPTY: '缺纸',
  PRINTER_ERROR: '打印机故障或卡纸',
  printer_jam: '打印机卡纸',
  PRINT_JOB_UNCONFIRMED: '出纸未确认，不能当成已经印完',
  PARTIAL_OUTPUT: '只打出了一部分',
  PRINT_TIMEOUT: '打印超时',
  PRINT_QUEUE_TIMEOUT: '排队超时未领取',
  PRINT_COMMAND_FAILED: '打印命令执行失败',
  UNSUPPORTED_FILE_TYPE: '文件格式不支持',
  FILE_NOT_FOUND: '打印文件已失效',
  COPY_SCAN_FAILED: '扫描没有完成',
  COPY_DEVICE_UNAVAILABLE: '扫描设备不可用',
  COPY_DEVICE_BUSY: '设备正忙，这次没有印出来',
  COPY_PROCESS_STOP_UNCONFIRMED: '扫描进程尚未确认退出',
  COPY_CAPABILITY_REVOKED: '本机复印开关已关闭',
  COPY_STORAGE_UNSAFE: '本机暂存不安全，已停止',
  COPY_SCAN_RESULT_UNCONFIRMED: '扫描结果未确认',
  COPY_BACKEND_UNAVAILABLE: '没能向云端确认结果',
  COPY_RESTART_UNCONFIRMED: '终端程序重启后未能确认是否出纸',
  COPY_UNAUTHORIZED: '这台终端无权继续这一单',
  unknown: '复印失败（未归类）',
}

const SAFE_CODE = /^[A-Za-z0-9_]{1,64}$/

function failurePhrase(code: string | null, kind: 'copy' | 'pack'): string {
  const fallback = kind === 'copy' ? '没有记录失败原因' : '没有记录失败原因'
  const unknown = kind === 'copy' ? '复印失败（未归类）' : '材料包打印失败（未归类）'
  const unsafe = kind === 'copy' ? '复印失败（原因无法识别）' : '材料包打印失败（原因无法识别）'
  if (!code) return fallback
  if (!SAFE_CODE.test(code)) return unsafe
  return Object.prototype.hasOwnProperty.call(FAILURE_PHRASES, code) ? FAILURE_PHRASES[code]! : unknown
}

function copyBucket(state: string): AdminFulfillmentStatus {
  const found = COPY_LIST_STATUSES.find((key) => COPY_STATE_GROUPS[key].includes(state))
  return found ?? 'unclassified'
}

function packBucket(taskStatus: string): AdminFulfillmentStatus {
  const found = PACK_LIST_STATUSES.find((key) => PACK_STATE_GROUPS[key].includes(taskStatus))
  return found ?? 'unclassified'
}

function copyFailure(state: string, resultCode: string | null): string | null {
  if (state === 'unconfirmed') return resultCode ? failurePhrase(resultCode, 'copy') : '出纸未确认，不能当成已经印完'
  if (state !== 'failed') return null
  return failurePhrase(resultCode, 'copy')
}

function pagination(page: number, pageSize: number, total: number) {
  return { page, pageSize, total, totalPages: total === 0 ? 0 : Math.ceil(total / pageSize) }
}

function optionalFilter(raw: string | undefined): string | undefined {
  const value = raw?.trim()
  return value ? value : undefined
}

@Injectable()
export class AdminFulfillmentListsService {
  constructor(private readonly prisma: PrismaService) {}

  async listCopyJobs(input: { status?: string; terminalId?: string; page: number; pageSize: number }): Promise<AdminFulfillmentListPage> {
    const status = optionalFilter(input.status)
    const states = this.copyStates(status)
    const terminalId = optionalFilter(input.terminalId)
    const where = {
      ...(terminalId ? { terminalId } : {}),
      ...(states ? { state: { in: [...states] } } : {}),
    }
    const [total, rows] = await Promise.all([
      this.prisma.copyJob.count({ where }),
      this.prisma.copyJob.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        select: {
          id: true,
          terminalId: true,
          createdAt: true,
          copies: true,
          state: true,
          resultCode: true,
        },
      }),
    ])
    const codes = await this.terminalCodes(rows.map((row) => row.terminalId))
    return {
      items: rows.map((row) => {
        const bucket = copyBucket(row.state)
        return {
          id: row.id,
          recordNo: row.id,
          terminalId: row.terminalId,
          terminalCode: codes.get(row.terminalId) ?? null,
          startedAt: row.createdAt.toISOString(),
          copies: row.copies,
          lineCount: null,
          status: bucket,
          statusLabel: STATUS_LABELS[bucket],
          failureReason: copyFailure(row.state, row.resultCode),
        }
      }),
      pagination: pagination(input.page, input.pageSize, total),
    }
  }

  async listMaterialPackOrders(input: { status?: string; terminalId?: string; page: number; pageSize: number }): Promise<AdminFulfillmentListPage> {
    const status = optionalFilter(input.status)
    const taskStatuses = this.packStates(status)
    const terminalId = optionalFilter(input.terminalId)
    const where = {
      orderItems: { some: {} },
      copyJob: { is: null },
      type: { not: 'copy' },
      ...(terminalId ? { terminalId } : {}),
      ...(taskStatuses ? { taskStatus: { in: [...taskStatuses] } } : {}),
    }
    const [total, rows] = await Promise.all([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (input.page - 1) * input.pageSize,
        take: input.pageSize,
        select: {
          id: true,
          orderNo: true,
          terminalId: true,
          createdAt: true,
          taskStatus: true,
          orderItems: {
            orderBy: { seq: 'asc' },
            select: { copies: true, status: true, printTaskId: true },
          },
        },
      }),
    ])
    const codes = await this.terminalCodes(rows.map((row) => row.terminalId).filter((id): id is string => Boolean(id)))
    const reasons = await this.packFailureReasons(rows)
    return {
      items: rows.map((row) => {
        const bucket = packBucket(row.taskStatus)
        const copies = sharedCopies(row.orderItems.map((item) => item.copies))
        return {
          id: row.id,
          recordNo: row.orderNo,
          terminalId: row.terminalId,
          terminalCode: row.terminalId ? codes.get(row.terminalId) ?? null : null,
          startedAt: row.createdAt.toISOString(),
          copies,
          lineCount: row.orderItems.length,
          status: bucket,
          statusLabel: STATUS_LABELS[bucket],
          failureReason: bucket === 'failed' ? reasons.get(row.id) ?? '没有记录失败原因' : null,
        }
      }),
      pagination: pagination(input.page, input.pageSize, total),
    }
  }

  private copyStates(status: string | undefined): readonly string[] | undefined {
    if (!status) return undefined
    if (!isListed(status, COPY_LIST_STATUSES)) this.rejectStatus()
    return COPY_STATE_GROUPS[status]
  }

  private packStates(status: string | undefined): readonly string[] | undefined {
    if (!status) return undefined
    if (!isListed(status, PACK_LIST_STATUSES)) this.rejectStatus()
    return PACK_STATE_GROUPS[status]
  }

  private rejectStatus(): never {
    throw new BadRequestException({ error: { code: 'FULFILLMENT_STATUS_UNKNOWN', message: '无法识别的状态筛选' } })
  }

  private async terminalCodes(ids: string[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids)]
    if (unique.length === 0) return new Map()
    const terminals = await this.prisma.terminal.findMany({
      where: { id: { in: unique } },
      select: { id: true, terminalCode: true },
    })
    return new Map(terminals.map((terminal) => [terminal.id, terminal.terminalCode]))
  }

  private async packFailureReasons(rows: Array<{ id: string; taskStatus: string; orderItems: Array<{ status: string; printTaskId: string | null }> }>): Promise<Map<string, string>> {
    const failed = rows.filter((row) => packBucket(row.taskStatus) === 'failed')
    const taskIds = [...new Set(failed.flatMap((row) => row.orderItems.filter((item) => item.status === 'failed' && item.printTaskId).map((item) => item.printTaskId!)))]
    const tasks = taskIds.length === 0 ? [] : await this.prisma.printTask.findMany({
      where: { id: { in: taskIds } },
      select: { id: true, errorCode: true },
    })
    const byTask = new Map(tasks.map((task) => [task.id, task.errorCode]))
    const reasons = new Map<string, string>()
    for (const row of failed) {
      const phrases = [...new Set(row.orderItems
        .filter((item) => item.status === 'failed')
        .map((item) => failurePhrase(item.printTaskId ? byTask.get(item.printTaskId) ?? null : null, 'pack')))]
      reasons.set(row.id, phrases.join('；') || '没有记录失败原因')
    }
    return reasons
  }
}

function isListed<T extends string>(value: string, allowed: readonly T[]): value is T {
  return (allowed as readonly string[]).includes(value)
}

function sharedCopies(copies: number[]): number | null {
  if (copies.length === 0) return null
  return copies.every((value) => value === copies[0]) ? copies[0]! : null
}
