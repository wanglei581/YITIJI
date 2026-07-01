import crypto from 'crypto'
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { signFileUrl, verifyFileSignature } from '../files/signing'
import type { CreatePrintJobDto } from './dto/create-print-job.dto'

export interface PrintJobCreated {
  taskId:    string
  status:    string
  createdAt: string
}

export interface PrintJobStatusResult {
  taskId:        string
  status:        string
  errorCode?:    string
  errorMessage?: string
  completedAt?:  string
}

// Default params matching the shared PrintJobParams shape.
const DEFAULT_PARAMS = {
  copies:        1,
  colorMode:     'black_white',
  duplex:        'simplex',
  paperSize:     'A4',
  orientation:   'auto',
  quality:       'standard',
  scale:         'fit',
  pagesPerSheet: 1,
}

// B1: 30-minute TTL for the signedUrl stored in PrintTask.fileUrl.
// Upload returns a 5-min URL; we re-sign here with a longer TTL so the
// Terminal Agent can still download the file even if claim is delayed.
const PRINT_JOB_FILE_URL_TTL_MS = 30 * 60 * 1000

/**
 * HIGH-3 (SSRF) — 解析并**验签**内部签名 URL。
 *
 * 只接受本系统 files 服务签发的签名 content URL，形如：
 *   /api/v1/files/<fileId>/content?expires=<ms>&sig=<hex>
 * （可带 host，例如 https://host/api/v1/files/...；统一只取 path + query 解析）
 *
 * 返回 fileId 仅当：能解析出 fileId + expires + sig，且 verifyFileSignature 通过
 * （HMAC 正确且未过期）。任何不满足 → 返回 null，由调用方 400 拒绝，
 * 杜绝把任意外部 URL 落库让 Terminal Agent 下载（SSRF）。
 */
function parseAndVerifySignedFileUrl(fileUrl: string): string | null {
  let pathname: string
  let searchParams: URLSearchParams
  try {
    // 相对 URL（/api/v1/...）与绝对 URL（https://host/api/v1/...）都能解析。
    const u = new URL(fileUrl, 'http://internal.local')
    pathname = u.pathname
    searchParams = u.searchParams
  } catch {
    return null
  }

  const match = pathname.match(/\/files\/([^/]+)\/content$/)
  const fileId = match?.[1]
  if (!fileId) return null

  const expires = searchParams.get('expires')
  const sig = searchParams.get('sig')
  if (!expires || !sig) return null

  return verifyFileSignature(fileId, expires, sig) ? fileId : null
}

/** 生成打印运营订单号:ORD-YYYYMMDD-XXXXXXXXXX。唯一索引负责最终防撞。 */
function makeOrderNo(): string {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  const suffix = crypto.randomBytes(5).toString('hex').toUpperCase()
  return `ORD-${yyyy}${mm}${dd}-${suffix}`
}

@Injectable()
export class PrintJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(
    dto: CreatePrintJobDto,
    ctx: {
      ipAddress?: string | null
      userAgent?: string | null
      endUserId?: string | null
      terminalId?: string | null
    } = {},
  ): Promise<PrintJobCreated> {
    const taskId = `ptask_kiosk_${crypto.randomBytes(8).toString('hex')}`

    // HIGH-3 (SSRF)：fileUrl 必须是本系统签名 URL，且签名/有效期校验通过。
    // 非法 URL（外部地址、无签名、签名错误、已过期）直接 400，绝不落库给 Agent 下载。
    const fileId = parseAndVerifySignedFileUrl(dto.fileUrl)
    if (!fileId) {
      throw new BadRequestException({
        error: {
          code: 'PRINT_INVALID_FILE_URL',
          message: 'fileUrl 必须是本系统签发的有效签名文件链接',
        },
      })
    }

    const targetTerminalId = await this.resolveTargetTerminalId(ctx.terminalId)

    // B1: re-sign with 30-min TTL so the Terminal Agent can download even after
    // a claim delay (上送的 5-min URL 可能在 claim 前已过期)。
    const { url: storedFileUrl } = signFileUrl(fileId, PRINT_JOB_FILE_URL_TTL_MS)

    // fileName 持久化：PrintTask 当前无独立 fileName 列（本阶段不做 migration，方案②约定）。
    // 折中：把 fileName 落进 paramsJson，使任务详情 / 日志 / DB 中可见文件名。
    // Agent 端 parseParams 会原样带上该字段，print() 忽略未知键，无副作用。
    const storedParams: Record<string, unknown> = {
      ...(dto.params ?? DEFAULT_PARAMS),
      ...(dto.fileName ? { fileName: dto.fileName } : {}),
    }

    const orderNo = makeOrderNo()
    const { task, order } = await this.prisma.$transaction(async (tx) => {
      const task = await tx.printTask.create({
        data: {
          id:         taskId,
          terminalId: targetTerminalId,
          fileUrl:    storedFileUrl,
          endUserId:  ctx.endUserId ?? null,
          // fileMd5 列名保留（方案②），实际承载 SHA-256（files 服务计算 → Kiosk 上送 → Agent SHA-256 比对）。
          fileMd5:    dto.fileMd5 ?? '',
          paramsJson: JSON.stringify(storedParams),
          status:     'pending',
        },
      })
      const order = await tx.order.create({
        data: {
          orderNo,
          type:        'print',
          printTaskId: task.id,
          terminalId:  targetTerminalId,
          endUserId:   ctx.endUserId ?? null,
          // 当前未接真实报价/支付;不伪造页数或金额。
          amountCents: 0,
          payStatus:   'unpaid',
          taskStatus:  task.status,
        },
      })
      return { task, order }
    })

    // HIGH-3 (审计)：记录打印任务创建。actor 为匿名 Kiosk（无登录态），
    // 只记 fileId / 文件名 / 参数摘要 —— 不写文件正文、不写签名 URL（含 sig）等敏感串。
    await this.audit.write({
      actorId:    null,
      actorRole:  'kiosk',
      action:     'print_job.create',
      targetType: 'print_task',
      targetId:   task.id,
      payload: {
        fileId,
        fileName:    dto.fileName ?? null,
        hasFileHash: Boolean(dto.fileMd5),
        params:      dto.params ?? DEFAULT_PARAMS,
        hasEndUser:  Boolean(ctx.endUserId),
        terminalId:   targetTerminalId,
        orderId:     order.id,
        orderNo:     order.orderNo,
      },
      ipAddress: ctx.ipAddress ?? null,
      userAgent: ctx.userAgent ?? null,
    })

    return {
      taskId:    task.id,
      status:    task.status,
      createdAt: task.createdAt.toISOString(),
    }
  }

  private async resolveTargetTerminalId(rawTerminalId: string | null | undefined): Promise<string> {
    const terminalRef = rawTerminalId?.trim()
    if (!terminalRef) {
      throw new BadRequestException({
        error: {
          code: 'PRINT_TERMINAL_REQUIRED',
          message: '创建打印任务必须绑定当前一体机终端',
        },
      })
    }

    const terminal = await this.prisma.terminal.findFirst({
      where: {
        OR: [
          { id: terminalRef },
          { terminalCode: terminalRef },
        ],
      },
      select: { id: true, enabled: true },
    })
    if (!terminal) {
      throw new BadRequestException({
        error: {
          code: 'PRINT_TERMINAL_NOT_FOUND',
          message: '目标一体机终端不存在或未注册',
        },
      })
    }
    if (!terminal.enabled) {
      throw new BadRequestException({
        error: {
          code: 'PRINT_TERMINAL_DISABLED',
          message: '目标一体机终端已停用，不能创建打印任务',
        },
      })
    }
    return terminal.id
  }

  async getStatus(taskId: string): Promise<PrintJobStatusResult> {
    const task = await this.prisma.printTask.findUnique({ where: { id: taskId } })
    if (!task) {
      throw new NotFoundException({
        error: { code: 'PRINT_TASK_NOT_FOUND', message: `任务 ${taskId} 不存在` },
      })
    }
    return {
      taskId:       task.id,
      status:       task.status,
      errorCode:    task.errorCode    ?? undefined,
      errorMessage: task.errorMessage ?? undefined,
      completedAt:  task.completedAt?.toISOString(),
    }
  }
}
