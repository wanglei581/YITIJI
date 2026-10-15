import { ConflictException } from '@nestjs/common'
import type { PrismaService, PrismaTransactionClient } from '../prisma/prisma.service'
import { isPrintableFileRecord } from './print-page-count.service'
import {
  PARTIAL_OUTPUT_ERROR_CODE,
  PRINT_JOB_UNCONFIRMED_ERROR_CODE,
} from './paid-anomaly-disposition'

/**
 * 会员重新提交和管理员重试共用的资格。管理员另有终端退役、订单 taskStatus
 * 序列点和审计，不在这里。
 *
 * 共享检查的错误码用 PRINT_RETRY_*。管理员独有检查用 PRINT_SCAN_RETRY_*：
 * 终端已退役、终端不在运行状态、文件链接解析失败（ADMIN_UNPARSED_FILE_CODE）。
 * 那些检查留在 admin-print-scan，不进 paidReprintBlockReason。
 *
 * 有订单才看付款：试点 0 元单落库后 payStatus 就是 paid（见 order-status.service
 * markPaid 的 free 分支）。没有订单的自检或内部任务不适用付款条件。
 * 版本门槛放在最后，失败态等更具体的原因先返回。
 */
export type PaidReprintBlockReason =
  | 'not_failed'
  | 'unconfirmed'
  | 'partial_output'
  | 'refunding'
  | 'not_paid'
  | 'file_unavailable'
  | 'agent_version'

const REFUND_PAY_STATUSES = new Set(['refunding', 'partial_refunded', 'refunded'])

export const REPRINT_BLOCKED_CODE: Record<PaidReprintBlockReason, string> = {
  not_failed: 'PRINT_RETRY_INVALID_STATE',
  unconfirmed: 'PRINT_RETRY_UNCONFIRMED_FORBIDDEN',
  partial_output: 'PRINT_RETRY_PARTIAL_OUTPUT_FORBIDDEN',
  refunding: 'PRINT_RETRY_REFUNDED',
  not_paid: 'PRINT_RETRY_NOT_PAID',
  file_unavailable: 'PRINT_RETRY_FILE_UNAVAILABLE',
  agent_version: 'PRINT_RETRY_AGENT_VERSION',
}

export const REPRINT_BLOCKED_MESSAGE: Record<PaidReprintBlockReason, string> = {
  not_failed: '只有失败的打印任务可以重新提交',
  unconfirmed: '这单的出纸结果还没确认，请 5 分钟后再试',
  partial_output: '这单只出了一部分纸',
  refunding: '这单已退款或正在退款，不能重新提交',
  not_paid: '订单未付款，不能重试出纸',
  file_unavailable: '打印文件已过期或已清理，不能重新提交',
  agent_version: '这台终端的打印程序版本过旧，升级到 0.4.13 后才能重新提交',
}

/** 管理员解析不出 fileId 时的额外拒绝，人话与 retryBlockedReason 相同。 */
export const ADMIN_UNPARSED_FILE_CODE = 'PRINT_SCAN_RETRY_FILE_UNAVAILABLE'
export const ADMIN_UNPARSED_FILE_MESSAGE = '打印文件链接无法解析，无法重试'

const REPRINT_VERSION_FLOOR = [0, 4, 13] as const

/** 取开头的主.次.修订。0.4.13-production 视为 0.4.13；凑不齐三段数字即不合法。 */
export function leadingAgentVersion(raw: string | null | undefined): [number, number, number] | null {
  if (!raw) return null
  const match = /^(\d+)\.(\d+)\.(\d+)(?:$|[^0-9])/.exec(raw.trim())
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** 逐段数字比较，不用字符串。0.4.13 高于 0.4.9。 */
export function agentVersionMeetsReprintFloor(raw: string | null | undefined): boolean {
  const parsed = leadingAgentVersion(raw)
  if (!parsed) return false
  for (let i = 0; i < 3; i += 1) {
    if (parsed[i] > REPRINT_VERSION_FLOOR[i]) return true
    if (parsed[i] < REPRINT_VERSION_FLOOR[i]) return false
  }
  return true
}

export function paidReprintBlockReason(input: {
  status: string
  errorCode?: string | null
  hasOrder: boolean
  payStatus?: string | null
  file: { status?: string | null; deletedAt?: Date | null; expiresAt?: Date | null } | null
  terminalId?: string | null
  agentVersion?: string | null
  /** 事务外的预检跳过版本。真正放行必须在锁住 PrintTask 之后再读心跳。 */
  skipAgentVersion?: boolean
  /**
   * 自助续打已经按免费 / 付费 / 冷却期处理过这两种异常。
   * 管理员不得传 true：未确认和部分出纸在后台仍然拒绝，不提供强制重打。
   */
  selfServiceAnomalyCleared?: boolean
}): PaidReprintBlockReason | null {
  if (input.status !== 'failed') return 'not_failed'
  if (!input.selfServiceAnomalyCleared && input.errorCode === PRINT_JOB_UNCONFIRMED_ERROR_CODE) return 'unconfirmed'
  if (!input.selfServiceAnomalyCleared && input.errorCode === PARTIAL_OUTPUT_ERROR_CODE) return 'partial_output'
  if (input.hasOrder && input.payStatus != null && REFUND_PAY_STATUSES.has(input.payStatus)) return 'refunding'
  if (input.hasOrder && input.payStatus !== 'paid') return 'not_paid'
  if (!isPrintableFileRecord(input.file)) return 'file_unavailable'
  if (
    !input.skipAgentVersion
    && (!input.terminalId || !agentVersionMeetsReprintFloor(input.agentVersion))
  ) return 'agent_version'
  return null
}

export function retryBlockedReason(
  reason: PaidReprintBlockReason | null,
  options?: { fileIdParsed?: boolean },
): string | null {
  if (reason === null) return null
  if (reason === 'file_unavailable' && options?.fileIdParsed === false) return ADMIN_UNPARSED_FILE_MESSAGE
  return REPRINT_BLOCKED_MESSAGE[reason]
}

function throwShared(reason: PaidReprintBlockReason): never {
  throw new ConflictException({
    error: { code: REPRINT_BLOCKED_CODE[reason], message: REPRINT_BLOCKED_MESSAGE[reason] },
  })
}

export function throwIfMemberReprintBlocked(reason: PaidReprintBlockReason | null): void {
  if (reason === null) return
  throwShared(reason)
}

/**
 * 与会员端同一错误码、同一句人话。partial_output 必须单独分支：
 * 这一支改成直接 return 时，已付款的「只出一部分」会落到后面的重试写入。
 * 不提供强制重打。
 */
export function throwIfAdminReprintBlocked(
  reason: PaidReprintBlockReason | null,
  options?: { fileIdParsed?: boolean },
): void {
  if (reason === null) return
  if (reason === 'partial_output') {
    throwShared('partial_output')
  }
  if (reason === 'file_unavailable' && options?.fileIdParsed === false) {
    throw new ConflictException({
      error: { code: ADMIN_UNPARSED_FILE_CODE, message: ADMIN_UNPARSED_FILE_MESSAGE },
    })
  }
  throwShared(reason)
}

export function parseSignedPrintFileId(fileUrl: string): string | null {
  try {
    const parsed = new URL(fileUrl, 'http://internal.local')
    return parsed.pathname.match(/\/files\/([^/]+)\/content$/)?.[1] ?? null
  } catch {
    return null
  }
}

type HeartbeatReader = Pick<PrismaTransactionClient, 'terminalHeartbeat'>

async function latestAgentVersions(
  prisma: HeartbeatReader,
  terminalIds: string[],
): Promise<Map<string, string | null>> {
  const unique = [...new Set(terminalIds)]
  const versions = new Map<string, string | null>()
  if (unique.length === 0) return versions
  const grouped = await prisma.terminalHeartbeat.groupBy({
    by: ['terminalId'],
    where: { terminalId: { in: unique } },
    _max: { createdAt: true },
  })
  const pairs = grouped.filter((row) => row._max.createdAt != null)
  if (pairs.length === 0) return versions
  const rows = await prisma.terminalHeartbeat.findMany({
    where: {
      OR: pairs.map((row) => ({
        terminalId: row.terminalId,
        createdAt: row._max.createdAt as Date,
      })),
    },
    select: { terminalId: true, agentVersion: true },
  })
  for (const row of rows) {
    if (!versions.has(row.terminalId)) versions.set(row.terminalId, row.agentVersion)
  }
  return versions
}

export async function latestHeartbeatAgentVersions(
  prisma: HeartbeatReader | PrismaService,
  terminalIds: string[],
): Promise<Map<string, string | null>> {
  return latestAgentVersions(prisma, terminalIds)
}

export async function latestHeartbeatAgentVersion(
  prisma: HeartbeatReader | PrismaService,
  terminalId: string | null | undefined,
): Promise<string | null> {
  if (!terminalId) return null
  const versions = await latestHeartbeatAgentVersions(prisma, [terminalId])
  return versions.get(terminalId) ?? null
}

export async function loadPaidReprintBlock(
  prisma: PrismaService,
  task: { id: string; status: string; errorCode?: string | null; terminalId?: string | null },
  file: { status?: string | null; deletedAt?: Date | null; expiresAt?: Date | null } | null,
  options?: { skipAgentVersion?: boolean },
): Promise<PaidReprintBlockReason | null> {
  const order = await prisma.order.findFirst({
    where: { printTaskId: task.id },
    select: { payStatus: true },
  })
  const agentVersion = options?.skipAgentVersion
    ? null
    : await latestHeartbeatAgentVersion(prisma, task.terminalId)
  return paidReprintBlockReason({
    status: task.status,
    errorCode: task.errorCode,
    hasOrder: order != null,
    payStatus: order?.payStatus ?? null,
    file,
    terminalId: task.terminalId,
    agentVersion,
    skipAgentVersion: options?.skipAgentVersion,
  })
}

export async function adminPrintRetryBlockedReasons(
  prisma: PrismaService,
  tasks: Array<{
    id: string
    terminalId: string | null
    status: string
    errorCode: string | null
    fileUrl: string
    hasOrder: boolean
    payStatus: string | null
  }>,
): Promise<Map<string, string | null>> {
  const versions = await latestAgentVersions(
    prisma,
    tasks.map((task) => task.terminalId).filter((id): id is string => Boolean(id)),
  )
  const fileIds = [...new Set(
    tasks.map((task) => parseSignedPrintFileId(task.fileUrl)).filter((id): id is string => Boolean(id)),
  )]
  const files = fileIds.length
    ? await prisma.fileObject.findMany({
        where: { id: { in: fileIds } },
        select: { id: true, status: true, deletedAt: true, expiresAt: true },
      })
    : []
  const fileById = new Map(files.map((file) => [file.id, file]))
  const reasons = new Map<string, string | null>()
  for (const task of tasks) {
    const fileId = parseSignedPrintFileId(task.fileUrl)
    const reason = paidReprintBlockReason({
      status: task.status,
      errorCode: task.errorCode,
      hasOrder: task.hasOrder,
      payStatus: task.payStatus,
      file: fileId ? fileById.get(fileId) ?? null : null,
      terminalId: task.terminalId,
      agentVersion: task.terminalId ? versions.get(task.terminalId) ?? null : null,
    })
    reasons.set(task.id, retryBlockedReason(reason, { fileIdParsed: fileId != null }))
  }
  return reasons
}
