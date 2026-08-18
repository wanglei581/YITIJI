import crypto from 'crypto'
import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { AuditService } from '../audit/audit.service'
import { TerminalCapabilitiesService } from '../terminals/terminal-capabilities.service'
import { signFileUrl, verifyFileSignature } from '../files/signing'
import { OrderStatusService } from '../payment/order-status.service'
import { assertPaymentSessionSecretConfigured, createPaymentSessionToken } from '../payment/payment-session-token'
import { PricingService } from '../payment/pricing.service'
import type { OrderPayStatus, PrintPriceLine } from '../payment/payment.types'
import type { CreatePrintJobDto } from './dto/create-print-job.dto'
import { countPagesInRange } from './page-range.util'
import { PrintPageCountService } from './print-page-count.service'
import type { BillingPageSource } from './print-page-count.types'
import { assertVerifiedPrintParameters } from './verified-print-parameters'

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
  /** 后端识别的计费页数（绝不信任前端）；已按 pageRange 取实际出纸页数。 */
  billablePages: number
  /** 计费页数来源。 */
  billingPageSource: BillingPageSource
  /** 短期支付会话 token（只授权本次订单出码 / 轮询；不含文件 URL 或密钥）。 */
  paymentSessionToken: string
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

/**
 * 需要隐私预检的文件用途白名单：只覆盖「用户交进来的原始材料」。
 * 派生产物与系统生成物（cover_letter / self_assessment_report / fair_material 等）
 * 不在此列——它们由本机生成，不是用户手里可能夹带证件号的原件。
 */
const PII_SCAN_REQUIRED_PURPOSES = new Set(['resume_upload', 'resume_scan', 'print_doc', 'id_scan'])
const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/u

/**
 * 打印前隐私预检门控。默认关闭，由 PRINT_REQUIRE_PII_SCAN=true 显式开启；
 * 关闭时只记录不拦截，便于先观察真实流量中有多少文件绕过了 material-check，
 * 再决定何时收紧。生产由 production-runtime-gates 强制为 true。
 *
 * 注意：出纸付费门控已不再是同类开关 —— 它已被删除，claim 无条件只领已付款订单。
 */
export function requirePiiScanBeforePrint(): boolean {
  return process.env['PRINT_REQUIRE_PII_SCAN'] === 'true'
}

@Injectable()
export class PrintJobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly pageCount: PrintPageCountService,
    private readonly pricing: PricingService,
    private readonly orderStatus: OrderStatusService,
    private readonly capabilities: TerminalCapabilitiesService,
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

    // 合同审查只允许打印系统生成的风险提示报告，原合同属于短期高敏原件，
    // 即使调用方拿到了仍有效的内部签名 URL，也不得绕过合同审查页面直接建打印单。
    // 报告哈希必须采用服务端落库值，不能信任 Kiosk 可篡改/遗漏的 fileMd5。
    const sourceFile = await this.prisma.fileObject.findUnique({
      where: { id: fileId },
      select: { purpose: true, sha256: true },
    })
    if (sourceFile?.purpose === 'contract_upload') {
      throw new BadRequestException({
        error: {
          code: 'PRINT_CONTRACT_SOURCE_FORBIDDEN',
          message: '合同审查原件不可直接打印，请仅打印风险提示报告',
        },
      })
    }
    let trustedFileHash = dto.fileMd5 ?? ''
    if (sourceFile?.purpose === 'contract_review_report') {
      if (!SHA256_HEX_PATTERN.test(sourceFile.sha256)) {
        throw new BadRequestException({
          error: {
            code: 'PRINT_CONTRACT_REPORT_INVALID',
            message: '合同风险提示报告校验信息无效，请重新生成后再打印',
          },
        })
      }
      trustedFileHash = sourceFile.sha256
    }

    // 招聘会资料 bridge 被下架/禁打/删除后，已确认任务可保留文件继续履约；
    // 旧 HMAC URL 不得借该保留窗口创建新任务。此检查只收紧已验签的标准 FileObject 路径。
    const revokedFairMaterialBridge = await this.prisma.fairMaterialPrintBridge.findFirst({
      where: { fileObjectId: fileId, revokedAt: { not: null } },
      select: { id: true },
    })
    if (revokedFairMaterialBridge) {
      throw new BadRequestException({
        error: {
          code: 'PRINT_FILE_REVOKED',
          message: '打印文件已撤销，请返回资料页重新选择可打印文件',
        },
      })
    }

    // 即使招聘会状态更新与 bridge 撤销并发，建单仍须实时 fail-closed。
    // 不接受 FairMaterial URL，只对已验签的标准 FileObject 检查其 bridge 来源状态。
    const bridgeSource = await this.prisma.fairMaterialPrintBridge.findFirst({
      where: { fileObjectId: fileId },
      include: { material: { include: { jobFair: true } } },
    })
    if (
      bridgeSource && (
        bridgeSource.status !== 'ready' ||
        bridgeSource.revokedAt ||
        bridgeSource.material.deletedAt ||
        !bridgeSource.material.allowPrint ||
        bridgeSource.material.publishStatus !== 'published' ||
        bridgeSource.material.jobFair.reviewStatus !== 'approved' ||
        bridgeSource.material.jobFair.publishStatus !== 'published'
      )
    ) {
      throw new BadRequestException({
        error: {
          code: 'PRINT_FILE_REVOKED',
          message: '打印文件已撤销，请返回资料页重新选择可打印文件',
        },
      })
    }

    // 隐私预检门控：建单前确认该文件走过 pii_scan 且用户已逐项裁决。
    //
    // 背景：此前服务端完全不校验此事（print-jobs 下 documentProcessTask 零引用），
    // 「打印前必须做隐私检查」只是前端流程约定 —— 直接调 POST /print/jobs 即可跳过
    // 整个 material-check；而 print-scan/convert、print-scan/sign、scan/result
    // 三条前端路径本来就绕过该步骤。
    //
    // 范围只覆盖「用户上传的原件」：派生产物（convert/sign 的输出、AI 生成的简历与
    // 报告、招聘会运营资料）不是用户手里的原始材料，其风险由各自上游承担，此处放行
    // 但记录，避免一刀切把既有打印链路堵死。
    await this.assertPiiScanned(fileId)

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
      select: { id: true, enabled: true, lifecycleStatus: true },
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
    if (terminal.lifecycleStatus !== 'active') {
      throw new BadRequestException({
        error: {
          code: 'PRINT_TERMINAL_NOT_ACTIVE',
          message: '目标终端当前不接收新打印任务',
        },
      })
    }
    const targetTerminalId = terminal.id

    // Task 10 服务端能力门禁：管理员把该终端 document_print 配为非 available 时
    // 拒绝创建（未配置行放行，见 TerminalCapabilitiesService.assertUserTaskAllowed）。
    await this.capabilities.assertUserTaskAllowed(targetTerminalId, 'document_print')

    // 打印参数门禁第 1 层（全局产品边界）：N-up 恒拒；彩色/双面在此层放行。
    assertVerifiedPrintParameters(dto.params)
    // 第 2 层（按终端 fail-closed）：这台机器的彩色/双面验过没有。未登记一律拒绝，
    // 必须在报价与落库**之前** —— 否则会出现「按彩色计价成单、实际出黑白纸」的资损。
    await this.capabilities.assertPrintParamsAllowed(targetTerminalId, dto.params)

    // 计费页数：后端从签名 fileUrl 识别真实内容页数（**绝不信任前端 pages**）；
    // 未知 MIME / 识别失败 / 0 页 / 签名无效 / 文件缺失 → fail-closed 抛错，拒绝建（付费）订单。
    const { billablePages: documentPages, billingPageSource } = await this.pageCount.resolveBillablePages(dto.fileUrl)
    // 页码范围：Agent 只打印 pageRange 选中页，计费必须与实际出纸一致，否则按整份文件收费即超收。
    // 选中页数为 0 / 范围非法 → fail-closed，绝不回退成整份文件页数。
    const billablePages = countPagesInRange(dto.params?.pageRange, documentPages)
    if (billablePages === null) {
      throw new BadRequestException({
        error: {
          code: 'PRINT_PAGE_RANGE_INVALID',
          message: '页码范围无效或未选中任何页面',
        },
      })
    }
    // 报价：金额只由 PricingService 依 PriceConfig 计算（**不信任前端 amount**）；无 active 价目 / 异常 → fail-closed。
    const copies = dto.params?.copies ?? DEFAULT_PARAMS.copies
    const colorMode: 'black_white' | 'color' = dto.params?.colorMode ?? 'black_white'
    const quote = await this.pricing.quotePrint({ billablePages, billingPageSource, copies, colorMode })
    assertPaymentSessionSecretConfigured()

    // fileName 持久化：PrintTask 当前无独立 fileName 列（本阶段不做 migration，方案②约定）。
    // 折中：把 fileName 落进 paramsJson，使任务详情 / 日志 / DB 中可见文件名。
    // Agent 端 parseParams 会原样带上该字段，print() 忽略未知键，无副作用。
    const storedParams: Record<string, unknown> = {
      ...(dto.params ?? DEFAULT_PARAMS),
      ...(dto.fileName ? { fileName: dto.fileName } : {}),
    }

    const orderNo = makeOrderNo()
    const { task, order } = await this.prisma.$transaction(async (tx) => {
      // 与 active -> maintenance 转换共用 Terminal 行锁，防止排空开始后仍建入新任务。
      const activeLock = await tx.terminal.updateMany({
        where: { id: targetTerminalId, enabled: true, lifecycleStatus: 'active' },
        data: { lifecycleStatus: 'active' },
      })
      if (activeLock.count !== 1) {
        throw new BadRequestException({
          error: { code: 'PRINT_TERMINAL_NOT_ACTIVE', message: '目标终端已进入维护状态，不再接收新打印任务' },
        })
      }
      const task = await tx.printTask.create({
        data: {
          id:         taskId,
          fileUrl:    storedFileUrl,
          // 文件血缘落库：此前 fileId 只进 AuditLog payload，DB 无法回答
          // 「该文件被打印过几次 / 打的是原件还是遮挡件」。fileUrl 是带 TTL 的重签名
          // 串，不能当稳定外键用，故单列持久化已验签的 fileId。
          fileId,
          terminalId: targetTerminalId,
          endUserId:  ctx.endUserId ?? null,
          // fileMd5 列名保留（方案②），实际承载 SHA-256。合同报告强制使用服务端落库哈希，
          // 其他既有打印流程暂保持 DTO 兼容，由 Agent 统一执行 SHA-256 比对。
          fileMd5:    trustedFileHash,
          paramsJson: JSON.stringify(storedParams),
          status:     'pending',
        },
      })
      const order = await tx.order.create({
        data: {
          orderNo,
          type:        'print',
          // channel: 一体机现场下单。两端建单写的字段相同（小程序侧 terminalId 是用户选的门店），
          // 不显式标注则会员单无法区分来源——见 docs/product/miniapp-console-sharing-2026-08.md M1。
          channel:     'kiosk',
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
        hasFileHash: Boolean(trustedFileHash),
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
      paymentSessionToken: createPaymentSessionToken({
        orderId:     order.id,
        orderNo:     order.orderNo,
        terminalId:  targetTerminalId,
        amountCents: order.amountCents,
        printTaskId: task.id,
      }),
    }
  }

  /**
   * 建单前确认文件走过隐私预检。
   *
   * 判定：文件为「用户上传的原件」（assetCategory 非派生 + purpose 在白名单内）时，
   * 必须存在一条 completed 的 pii_scan DocumentProcessTask，且不残留 pending 裁决。
   * 派生产物与系统生成物放行。
   *
   * 门控关闭时（默认）只写审计不拦截，用于先观察真实绕过量。
   */
  private async assertPiiScanned(fileId: string): Promise<void> {
    const file = await this.prisma.fileObject.findUnique({
      where: { id: fileId },
      select: { purpose: true, assetCategory: true },
    })
    // 文件不存在交由后续既有校验处理，此处不越权报错
    if (!file) return

    const isDerived = file.assetCategory === 'derived' || file.assetCategory === 'optimized'
    if (isDerived || !PII_SCAN_REQUIRED_PURPOSES.has(file.purpose)) return

    const scan = await this.prisma.documentProcessTask.findFirst({
      where: { sourceFileId: fileId, kind: 'pii_scan', status: 'completed' },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    })

    let pendingFindings = 0
    if (scan) {
      pendingFindings = await this.prisma.piiFinding.count({
        where: { taskId: scan.id, action: 'pending' },
      })
    }

    const ok = Boolean(scan) && pendingFindings === 0
    if (ok) return

    const reason = !scan ? 'PII_SCAN_MISSING' : 'PII_DECISIONS_PENDING'

    if (!requirePiiScanBeforePrint()) {
      // 观察期：不拦截，只留痕，便于统计真实绕过量后再收紧
      await this.audit.write({
        actorId:    null,
        actorRole:  'kiosk',
        action:     'print_job.pii_scan_bypassed',
        targetType: 'file_object',
        targetId:   fileId,
        payload: { reason, purpose: file.purpose, assetCategory: file.assetCategory, pendingFindings },
      }).catch(() => undefined)
      return
    }

    throw new BadRequestException({
      error: {
        code: 'PRINT_PII_SCAN_REQUIRED',
        message: !scan
          ? '这份文件还没做隐私检查，请返回材料检查步骤完成后再打印'
          : '还有隐私片段没有确认保留或遮挡，请逐项确认后再打印',
      },
    })
  }

  async getStatus(taskId: string): Promise<PrintJobStatusResult> {
    const task = await this.prisma.printTask.findUnique({ where: { id: taskId } })
    if (!task) {
      throw new NotFoundException({
        error: { code: 'PRINT_TASK_NOT_FOUND', message: `任务 ${taskId} 不存在` },
      })
    }
    // 失败判定：终态 failed，或已落库 errorCode/errorMessage（Agent 回传过失败信息）。
    // cancelled 是受控关闭，不得因其运维 errorCode 伪装成设备打印失败。
    // DB 里的原始 task.errorCode / task.errorMessage 保持不动，供后台/排障视图使用；
    // 用户端只回**安全用户文案**，绝不把 Agent 原始 errorMessage 透出。
    const hasFailure = task.status !== 'cancelled' && (
      task.status === 'failed' || Boolean(task.errorCode) || Boolean(task.errorMessage)
    )
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
