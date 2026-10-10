import { peekSupportContact, helpNeededLine, machineCannotPrintLine, preferUnattended } from '../../copy/unattendedCopy'
// ============================================================
// printProgressModel —— 打印进度页（稿 15-print-fulfill.html）的纯展示辅助
//
// 只有格式化、演示时间轴步骤表与 Agent 错误码的中文说明：不发请求、不轮询、不判定成败。
// 真实状态文案（realStatusPresentation）、轮询间隔与超时仍留在 PrintProgressPage，
// 门禁按页面文件取证。
//
// 稿 15 的九态与真实合同的对应。GET /print/jobs/:taskId 只回 status + errorCode +
// 安全文案，没有逐页进度、已出张数、取件码：
//   printing               本页。pending / claimed / printing 各说各的，只有 printing 才说「正在出纸」
//   client-status-timeout  本页。前端连续 10 分钟没拿到终态；只是查询超时，不改服务端、不猜结果
//   completed              交给 /print/done，它再向服务端核验一次；取件码只取接口真值
//   paper-jam / out-of-paper / result-unconfirmed
//                          交给 /print/done，按 errorCode = PRINTER_ERROR / PAPER_EMPTY /
//                          PRINT_JOB_UNCONFIRMED 分态
//   paid-no-output         交给 /print/done 的通用失败态；服务端不回出纸张数，谁也不能说「一张没出」
//   partial-output         服务端不回已出页数，不渲染「出了 N 页」；求助条「没出全？」留实体出口
//   refund-info            /print/done 的费用说明态；本页只写订单边界，不承诺退款
// ============================================================

import type { PrintJobParams, PrintJobTakeawayUrl } from '@ai-job-print/shared'
import type { BackendJobStatus } from '../../services/print/printJobsApi'
import { formatCents } from './cashierStatus'
import { countPagesInRange } from './pageRange'
import type { PrintFileState } from './printMaterialSession'

const DUPLEX_LABELS: Record<string, string> = {
  simplex: '单面',
  duplex_long_edge: '双面(长边)',
  duplex_short_edge: '双面(短边)',
}

type FilePages = Pick<PrintFileState, 'pages'> | null

/** 每份实际要印的页数：文件页数按页码范围裁过。页数未识别或范围解析不了时返回 null，不估。 */
export function pagesPerCopy(file: FilePages, params: Partial<PrintJobParams> | null | undefined): number | null {
  if (!file || file.pages == null) return null
  return countPagesInRange(params?.pageRange, file.pages)
}

/** 任务行副标题（稿 .job-sub「A4 单面 · 2 页 × 1 份」），只拼真实参数；缺什么就不写什么。 */
export function jobSubline(file: FilePages, params: Partial<PrintJobParams> | null | undefined): string {
  if (!params) return '打印参数以订单记录为准'
  const pages = pagesPerCopy(file, params)
  const copies = params.copies ?? 1
  return [
    params.paperSize,
    params.colorMode === 'color' ? '彩色' : '黑白',
    DUPLEX_LABELS[params.duplex ?? ''] ?? '单面',
    pages != null ? `${pages} 页 × ${copies} 份` : `${copies} 份`,
  ].filter(Boolean).join(' · ')
}

/** 预计出纸（张 / 面）。每份从新的一张纸起印，所以双面按份向上取整。页数未知返回 null。 */
export function expectedSheets(file: FilePages, params: Partial<PrintJobParams> | null | undefined): string | null {
  const pages = pagesPerCopy(file, params)
  if (pages == null || !params) return null
  const pps = params.pagesPerSheet ?? 1
  const copies = params.copies ?? 1
  const facesPerCopy = Math.ceil(pages / pps)
  const isDouble = params.duplex === 'duplex_long_edge' || params.duplex === 'duplex_short_edge'
  const sheetsPerCopy = isDouble ? Math.ceil(facesPerCopy / 2) : facesPerCopy
  return `${sheetsPerCopy * copies} 张（${facesPerCopy * copies} 面）`
}

/** 给用户看的订单号只认 ORD-。内部编号、空串都不显示。 */
export function publicOrderNo(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return /^ORD-[A-Za-z0-9-]+$/.test(trimmed) ? trimmed : null
}

/** 「再印一份」的说明跟真实价目走。0 元写免费试运营，不知道价格就不说要付款。 */
export function reprintHint(amountCents: number | null | undefined): string {
  if (amountCents === 0) return '重新选文件后再确认。免费试运营。'
  if (typeof amountCents === 'number' && Number.isFinite(amountCents) && amountCents > 0) {
    return '重新选文件、核对价格后再付款。'
  }
  return '重新选文件后再确认价格。'
}

/**
 * 完成页取纸说明。页数未知时不写「共 0 面」；份数乘进总页数。
 * 面数沿用 expectedSheets：双面不会把页数再乘 2。
 */
export function doneTakeaway(
  file: FilePages,
  params: Partial<PrintJobParams> | null | undefined,
): { pagesLabel: string; facesLabel: string } {
  const pages = pagesPerCopy(file, params)
  const copies = params?.copies && params.copies >= 1 ? params.copies : 1
  if (pages == null || pages < 1) {
    return {
      pagesLabel: '全部纸张',
      facesLabel: '请在出纸口取走并核对页数',
    }
  }
  const totalPages = pages * copies
  const sheets = expectedSheets(file, params)
  return {
    pagesLabel: copies > 1 ? `全部 ${totalPages} 页（${pages} 页 × ${copies} 份）` : `全部 ${totalPages} 页`,
    facesLabel: sheets
      ? `共 ${sheets}已全部打印，请在出纸口取走并核对页数`
      : `共 ${totalPages} 面已全部打印，请在出纸口取走并核对页数`,
  }
}

/**
 * 这一单的收款事实，只认进页时带来的 amountCents：
 * 确认页只把 0 元单或已付单送进本页，收银页只在 paid 后送进来；
 * 到机码释放等入口不带金额 —— 那就是 unknown，不得默认写成「已支付」。
 */
export type PaymentFact = 'free' | 'paid' | 'unknown'

export function paymentFactOf(amountCents: number | null): PaymentFact {
  if (amountCents == null) return 'unknown'
  return amountCents === 0 ? 'free' : 'paid'
}

export interface OutOfPaperMoney {
  fact: PaymentFact
  amountCents: number | null
}

/** 缺纸页只展示已核实的收款事实；服务端有订单回执时优先使用回执。 */
export function outOfPaperMoneyOf(
  takeaway: Pick<PrintJobTakeawayUrl, 'payStatus' | 'amountCents'> | null,
  flowAmountCents: number | null,
): OutOfPaperMoney {
  if (!takeaway) return { fact: paymentFactOf(flowAmountCents), amountCents: flowAmountCents }
  return {
    fact: takeaway.payStatus === 'paid' ? paymentFactOf(takeaway.amountCents) : 'unknown',
    amountCents: takeaway.amountCents,
  }
}

export function outOfPaperPill(money: OutOfPaperMoney): string {
  if (money.fact === 'paid' && money.amountCents != null) return `已付 ${formatCents(money.amountCents)} · 缺纸`
  if (money.fact === 'free') return '免费试运营 · 缺纸'
  return '订单保留 · 缺纸'
}

export function outOfPaperDoing(_money: OutOfPaperMoney, contact = peekSupportContact()): string {
  return machineCannotPrintLine(contact, { orderKept: true })
}

/**
 * 卡纸说明的副标题。只有确实收过钱才提已付金额；0 元和金额未知都不说收款。
 * 不写「处理好后可以继续打印」：本页拿不到还剩几次，第 3 次失败时那句是错的。
 * 能不能接着打由 SAME_CODE_RESUME_LINE 说。
 */
export function jamOrderKeptLine(fact: PaymentFact): string {
  return fact === 'paid'
    ? '你的订单和已付金额都保留着'
    : '你的订单还在'
}

/** 一般失败页小青区。收费单保留原句；0 元和金额未知改成不提钱的说法。 */
export function failureStaffDoing(fact: PaymentFact, contact = peekSupportContact()): string {
  return `${fact === 'paid' ? '订单和支付记录都在。' : '你的订单还在。'}${helpNeededLine(contact)}`
}

/**
 * 出纸失败屏（卡纸 / 缺纸 / 一般失败）上的同码接着打说明。
 * 后端规则（services/api/src/print-jobs/self-service-reprint.ts、pickup-code-resume.ts）：
 * 只认出纸失败的那台机器、整份重出、每单自助最多 SELF_SERVICE_REPRINT_LIMIT = 2 次。
 * 本页拿不到还剩几次，所以这句写成任何一次失败都成立的说法，次数用完后的下一步也在句里。
 */
export const SAME_CODE_RESUME_LINE =
  '没打完？等这台机器能打了，回来再输一次同一个到机码就能接着打（整份重打），每单最多 2 次；2 次用完后，请在手机上重新下单。'

/** 结果未确认屏的同码说明：实付 0 元的单满 5 分钟（后端 UNCONFIRMED_SELF_SERVICE_COOLDOWN_MS）才放行。 */
export const UNCONFIRMED_SAME_CODE_LINE =
  '没有的话，过 5 分钟回到这台机器，再输一次同一个到机码，可以整份重打（每单最多 2 次）。'

/**
 * 结果未确认屏、现场建的 0 元单（没有到机码）用的说明。
 * 这类单离开本页后没有自助重打的入口，也没有人来核，所以如实给出唯一的出路：重新打一次（0 元单不花钱）。
 */
export const UNCONFIRMED_ONSITE_FREE_LINE = '没有的话，请回到打印重新选文件再打一次。'

/**
 * 只有「手机下的单、用到机码取、这单 0 元」才说同码接着打：
 * 现场建的单没有到机码；付费单的未确认、部分出纸走原路退款，不说接着打。
 */
export function sameCodeResumeEligible(pickupSource: boolean | undefined, fact: PaymentFact): boolean {
  return pickupSource === true && fact === 'free'
}

/** 小青区首句的前半截：先说钱的事实，再说任务阶段（稿「支付成功，正在出纸。」）。 */
export function paymentLead(payment: PaymentFact): string {
  if (payment === 'paid') return '支付成功，'
  if (payment === 'free') return '订单已建立，'
  return '任务已提交，'
}

/** 顶栏状态胶囊。拿不到金额时退回任务阶段，不编收款结论。 */
export function paymentPill(payment: PaymentFact, amountCents: number | null, fallback: string): string {
  if (payment === 'free') return '免费试运营'
  if (payment === 'paid' && amountCents != null) return `已付 ${formatCents(amountCents)} · 只收纸张费`
  return fallback
}

/** 返回 tl-done | tl-active | '' */
export function tlItemClass(tlIdx: number, currentIdx: number, isRealApi: boolean): string {
  // 0 = 提交任务, 1 = 排队等待, 2 = 打印中, 3 = 完成取件(永远pending)
  if (tlIdx === 3) return ''
  if (tlIdx === 0) {
    return isRealApi || currentIdx > 0 ? 'tl-done' : 'tl-active'
  }
  if (tlIdx < currentIdx) return 'tl-done'
  if (tlIdx === currentIdx) return 'tl-active'
  return ''
}

export type Step = 'submitting' | 'queuing' | 'printing'

export const STEPS: { key: Step; label: string; duration: number }[] = [
  { key: 'submitting', label: '提交任务', duration: 1200 },
  { key: 'queuing',    label: '排队等待', duration: 1000 },
  { key: 'printing',   label: '打印中',   duration: 2500 },
]

export const FAIL_REASONS = (contact = peekSupportContact()) => [
  machineCannotPrintLine(contact, { orderKept: true }),
  machineCannotPrintLine(contact, { orderKept: true }),
  '任务处理超时，请稍后重试',
  '文件解析失败，请重新上传文件',
]

const ERROR_CODE_MESSAGES = (contact = peekSupportContact()): Record<string, string> => ({
  DOWNLOAD_HASH_MISMATCH: '文件校验未通过（上传可能中断或文件已变化），请返回重新上传后再打印',
  PRINTER_NOT_FOUND: machineCannotPrintLine(contact, { orderKept: true }),
  PRINTER_OFFLINE: machineCannotPrintLine(contact, { orderKept: true }),
  PAPER_EMPTY: machineCannotPrintLine(contact, { orderKept: true }),
  PRINTER_ERROR: machineCannotPrintLine(contact, { orderKept: true }),
  PRINT_JOB_UNCONFIRMED: machineCannotPrintLine(contact, { orderKept: true }),
  PRINT_TIMEOUT: '打印超时，请稍后重试',
  PRINT_COMMAND_FAILED: machineCannotPrintLine(contact, { orderKept: true }),
  UNSUPPORTED_FILE_TYPE: '该文件格式暂不支持打印，请上传 PDF 或 JPG / PNG',
  FILE_NOT_FOUND: '打印文件已失效，请返回重新上传',
})

export function errorCodeToMessage(code?: string, contact = peekSupportContact()): string | undefined {
  return code ? ERROR_CODE_MESSAGES(contact)[code] : undefined
}

export const stepIndex = (key: Step) => STEPS.findIndex((s) => s.key === key)

export function backendStatusToStep(status: BackendJobStatus): Step {
  if (status === 'printing') return 'printing'
  return 'queuing'
}

/**
 * 出纸中若这么久没有新的任务状态，就不再说「正在出纸」。
 * 终端心跳默认 30 秒。晚一次心跳仍可能是同一条「正在出纸」，所以留到一个半心跳（45 秒）。
 * 超过这个时间，页面没有新的进度可说。不把这一单改成失败：大约 10 分钟后的收口在服务端。
 */
export const PRINT_PROGRESS_QUIET_MS = 45_000

export function printProgressQuietCopy(contact = peekSupportContact()): string {
  return `这台机器暂时没有回报打印进度，请先看出纸口。${machineCannotPrintLine(contact, { orderKept: true })}`
}

/** 同一份回报不算「新状态」。状态、失败原因或完成时间变了才重新计时。 */
export function progressStatusFingerprint(result: {
  status?: string
  errorCode?: string
  failureReasonForUser?: string
  completedAt?: string | null
}): string {
  return [
    result.status ?? '',
    result.errorCode ?? '',
    result.failureReasonForUser ?? '',
    result.completedAt ?? '',
  ].join('\u001f')
}

/** 已经知道失败之后的进度页文案。不再套用排队或「等待领取」。
 *  ask 只放顶栏和出错的那一步；红条只用 wayOut，不再把原因写第三遍。
 */
export function progressFailurePresentation(reason: string, contact = peekSupportContact()): {
  headerTitle: string
  badge: string
  ask: string
  doing: string
  wayOut: string
} {
  const text = reason.trim()
  return {
    headerTitle: '打印没有完成',
    badge: '打印未完成',
    ask: preferUnattended(text, machineCannotPrintLine(contact, { orderKept: true })),
    doing: `可以查看打印订单，或重新选文件再印。${helpNeededLine(contact)}`,
    wayOut: `请用下面的按钮求助、查看订单，或重新打印。${helpNeededLine(contact)}`,
  }
}
