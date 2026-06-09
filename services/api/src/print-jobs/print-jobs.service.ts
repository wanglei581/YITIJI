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

/**
 * 生成打印运营订单号：ORD-YYYYMMDD-XXXXXX（后 6 位随机 hex，防撞）。
 * orderNo 列 @unique 做最终兜底；天文级别概率的碰撞会让事务失败 → 500，与 printTask 落库失败一致。
 */
function makeOrderNo(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase() // 6 hex chars
  return `ORD-${y}${m}${d}-${rand}`
}

@Injectable()
export class PrintJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async create(
    dto: CreatePrintJobDto,
    ctx: { ipAddress?: string | null; userAgent?: string | null; endUserId?: string | null } = {},
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

    // Sprint 1 / Task 1：一个打印任务对应一个打印运营订单（Order）。
    const orderNo = makeOrderNo()

    // PrintTask 与 Order 同一事务落库，保证"有打印任务必有对应订单"——二者同成功或同回滚。
    // Order.create 的数据完全确定、同库无外部依赖，正常不会独立失败；真要失败（如 DB 不可用）
    // 则 PrintTask 一并回滚、请求 500，与今天 printTask.create 失败行为一致，不会产生孤儿任务。
    const { task, order } = await this.prisma.$transaction(async (tx) => {
      const task = await tx.printTask.create({
        data: {
          id:         taskId,
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
          endUserId:   ctx.endUserId ?? null,
          // Sprint 1：不接真实支付，且在"不改 Kiosk 前端"前提下后端拿不到可靠页数，
          // 绝不用 pageCount=1 伪造金额 → amountCents 恒为 0（'未计费'），payStatus='unpaid'。
          // 单价真相源见 ./print-pricing.ts（PRINT_UNIT_PRICE_CENTS）。
          // TODO: calculate amountCents after reliable page count / quote flow is connected.
          amountCents: 0,
          payStatus:   'unpaid',
          // taskStatus 镜像 PrintTask.status（初始 pending）；真相源仍是 PrintTask，
          // 后续状态流转由 terminals.service 在各状态写入点同步镜像。
          taskStatus:  task.status,
        },
      })
      return { task, order }
    })

    // HIGH-3 (审计)：记录打印任务创建。actor 为匿名 Kiosk（无登录态），
    // 只记 fileId / 文件名 / 参数摘要 —— 不写文件正文、不写签名 URL（含 sig）等敏感串。
    // Sprint 1：附带新建的订单号 / 订单 id，便于审计串联打印任务与运营订单。
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
