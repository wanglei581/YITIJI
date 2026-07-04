import crypto from 'crypto'
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { signFileUrl, verifyFileSignature } from '../files/signing'
import { OrderStatusService } from '../payment/order-status.service'
import { PricingService } from '../payment/pricing.service'
import type { OrderPayStatus, PrintPriceLine } from '../payment/payment.types'
import type { CreatePrintJobDto } from './dto/create-print-job.dto'
import { PrintPageCountService } from './print-page-count.service'
import type { BillingPageSource } from './print-page-count.types'

export interface PrintJobCreated {
  taskId:    string
  status:    string
  createdAt: string
  // ── C5-3 收银/履约衔接（additive；只回安全计费/支付元数据，无文件原文/签名 URL）──
  //
  // orderId 与 taskId 同为不可猜 cuid，Kiosk 匿名层鉴权口径一致（见 payment.controller 注释）；
  // Kiosk 据 amountCents 分流：>0 进收银页出码支付，==0（免费单，已 paid+free）直接进履约。
  /** 关联订单 id（收银出码 / 支付状态轮询用）。 */
  orderId:   string
  /** 运营订单号（展示用）。 */
  orderNo:   string
  /** 应付金额（分），后端计价，>= 0；0 表示免费单。 */
  amountCents: number
  /** 建单即时支付状态：付费单 `unpaid`，免费单经状态机置 `paid`（free）。 */
  payStatus: OrderPayStatus
  /** 计费明细快照（收银页「价目明细」展示用；即 Order.itemsJson 内容）。 */
  priceLines: PrintPriceLine[]
  /** 后端识别的计费页数（绝不信任前端）。 */
  billablePages: number
  /** 计费页数来源。 */
  billingPageSource: BillingPageSource
}

export interface PrintJobStatusResult {
  taskId:        string
  status:        string
  errorCode?:    string
  /**
   * 兼容字段：旧调用方仍读 `errorMessage`。这里只回**安全用户文案**
   * （与 failureReasonForUser 一致），**绝不**返回 Terminal Agent 原始 errorMessage
   * （可能含设备路径、驱动异常、内部堆栈、主机名等排障细节）。
   */
  errorMessage?: string
  /** 面向本人的安全中文失败原因；仅在任务失败时给出。 */
  failureReasonForUser?: string
  completedAt?:  string
}

/**
 * 失败错误码 → 面向用户的安全中文文案白名单。
 *
 * 用户端只应看到「能做什么 / 找谁处理」的可操作提示，
 * 不得看到 Agent 原始 errorMessage（设备路径 / 驱动异常 / 内部堆栈 / 主机信息）。
 * DB 仍保留原始 errorCode/errorMessage 供后台排障（见 getStatus 注释）。
 */
const USER_FAILURE_REASONS: Record<string, string> = {
  DOWNLOAD_HASH_MISMATCH: '文件校验未通过，请返回重新上传后再打印',
  PRINTER_NOT_FOUND:      '未找到打印机，请联系工作人员检查打印机连接',
  PRINTER_OFFLINE:        '打印机离线，请联系工作人员检查设备',
  PAPER_EMPTY:            '打印机缺纸，请联系工作人员补纸',
  PRINTER_ERROR:          '打印机可能卡纸或发生设备故障，请联系工作人员处理',
  PRINT_JOB_UNCONFIRMED:  '打印作业未确认完成，请工作人员检查出纸状态',
  PRINT_TIMEOUT:          '打印超时，请稍后重试',
  PRINT_COMMAND_FAILED:   '打印执行失败，请稍后重试或联系工作人员',
  UNSUPPORTED_FILE_TYPE:  '该文件格式暂不支持打印，请上传 PDF 或图片',
  FILE_NOT_FOUND:         '打印文件已失效，请返回重新上传',
}

/** 未知错误码 / 仅有原始 errorMessage 时的统一安全兜底文案。 */
const DEFAULT_USER_FAILURE_REASON = '打印任务失败，请联系工作人员处理或稍后重试'

/**
 * 纯函数：把内部 errorCode 映射为面向用户的安全中文失败原因。
 *
 * 只按**白名单错误码**返回可操作文案；未知错误码或缺失 errorCode → 统一兜底文案。
 * 永不拼接原始 errorMessage —— 杜绝把 Agent 排障细节透出到用户端。
 */
export function failureReasonForUser(errorCode?: string | null): string {
  if (errorCode && Object.prototype.hasOwnProperty.call(USER_FAILURE_REASONS, errorCode)) {
    return USER_FAILURE_REASONS[errorCode]
  }
  return DEFAULT_USER_FAILURE_REASON
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
    private readonly pageCount: PrintPageCountService,
    private readonly pricing: PricingService,
    private readonly orderStatus: OrderStatusService,
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

    // B1: re-sign with 30-min TTL so the Terminal Agent can download even after
    // a claim delay (上送的 5-min URL 可能在 claim 前已过期)。
    const { url: storedFileUrl } = signFileUrl(fileId, PRINT_JOB_FILE_URL_TTL_MS)
    const terminalRef = ctx.terminalId?.trim()
    if (!terminalRef) {
      throw new BadRequestException({
        error: {
          code: 'PRINT_TERMINAL_REQUIRED',
          message: '打印任务必须绑定目标终端',
        },
      })
    }
    const terminal = await this.prisma.terminal.findFirst({
      where: { OR: [{ id: terminalRef }, { terminalCode: terminalRef }] },
      select: { id: true, enabled: true },
    })
    if (!terminal) {
      throw new BadRequestException({
        error: {
          code: 'PRINT_TERMINAL_NOT_FOUND',
          message: '目标终端不存在',
        },
      })
    }
    if (!terminal.enabled) {
      throw new BadRequestException({
        error: {
          code: 'PRINT_TERMINAL_DISABLED',
          message: '目标终端已停用',
        },
      })
    }
    const targetTerminalId = terminal.id

    // 计费页数：后端从签名 fileUrl 识别真实内容页数（**绝不信任前端 pages**）；
    // 未知 MIME / 识别失败 / 0 页 / 签名无效 / 文件缺失 → fail-closed 抛错，拒绝建（付费）订单。
    const { billablePages, billingPageSource } = await this.pageCount.resolveBillablePages(dto.fileUrl)
    // 报价：金额只由 PricingService 依 PriceConfig 计算（**不信任前端 amount**）；无 active 价目 / 异常 → fail-closed。
    const copies = dto.params?.copies ?? DEFAULT_PARAMS.copies
    const colorMode: 'black_white' | 'color' = dto.params?.colorMode ?? 'black_white'
    const quote = await this.pricing.quotePrint({ billablePages, billingPageSource, copies, colorMode })

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
          fileUrl:    storedFileUrl,
          terminalId: targetTerminalId,
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
          terminalId:  targetTerminalId,
          // 金额由 PricingService 依 PriceConfig 计算(不信任前端)；页数为后端识别。
          amountCents:       quote.amountCents,
          billablePages:     quote.billablePages,
          billingPageSource: quote.billingPageSource,
          // C5-2：计费明细快照（只存 PricingService 输出的 PrintPriceLine[]，
          // 不引入商品体系）；下单时定价固化，后续改价不影响历史单。
          itemsJson:         JSON.stringify(quote.lines),
          // 初始 unpaid + paymentSource=null；免费单在事务后经状态机置 paid+free，
          // 付费单保持 unpaid，绝不包装成线上待支付/已收款。
          payStatus:     'unpaid',
          paymentSource: null,
          taskStatus:    task.status,
        },
      })
      return { task, order }
    })

    // 免费单（报价为 0，如 0 价项）：经状态机置 paid + paymentSource=free + paidAt + pickupCode + 审计，
    // 不伪造真实收款；付费单保持 unpaid + paymentSource=null。
    if (quote.amountCents === 0) {
      await this.orderStatus.markPaid(order.id, { paymentSource: 'free' })
    }

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
        terminalId:  targetTerminalId,
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
      // C5-3：付费单 unpaid（Kiosk 进收银页出码），免费单已由上方 markPaid(free) 置 paid。
      orderId:           order.id,
      orderNo:           order.orderNo,
      amountCents:       quote.amountCents,
      payStatus:         (quote.amountCents === 0 ? 'paid' : 'unpaid') as OrderPayStatus,
      priceLines:        quote.lines,
      billablePages:     quote.billablePages,
      billingPageSource: quote.billingPageSource,
    }
  }

  async getStatus(taskId: string): Promise<PrintJobStatusResult> {
    const task = await this.prisma.printTask.findUnique({ where: { id: taskId } })
    if (!task) {
      throw new NotFoundException({
        error: { code: 'PRINT_TASK_NOT_FOUND', message: `任务 ${taskId} 不存在` },
      })
    }
    // 失败判定：终态 failed，或已落库 errorCode/errorMessage（Agent 回传过失败信息）。
    // DB 里的原始 task.errorCode / task.errorMessage 保持不动，供后台/排障视图使用；
    // 用户端只回**安全用户文案**，绝不把 Agent 原始 errorMessage 透出。
    const hasFailure = task.status === 'failed' || Boolean(task.errorCode) || Boolean(task.errorMessage)
    const safeReason = hasFailure ? failureReasonForUser(task.errorCode) : undefined
    return {
      taskId:       task.id,
      status:       task.status,
      // errorCode 是内部机器码（如 PRINTER_OFFLINE），非排障细节，保留给前端本地映射兜底。
      errorCode:    task.errorCode ?? undefined,
      // 兼容字段：只回安全用户文案，不回 task.errorMessage 原文。
      errorMessage: safeReason,
      failureReasonForUser: safeReason,
      completedAt:  task.completedAt?.toISOString(),
    }
  }
}
