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

import type { PrintJobParams } from '@ai-job-print/shared'
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

/** 小青区首句的前半截：先说钱的事实，再说任务阶段（稿「支付成功，正在出纸。」）。 */
export function paymentLead(payment: PaymentFact): string {
  if (payment === 'paid') return '支付成功，'
  if (payment === 'free') return '订单已建立，'
  return '任务已提交，'
}

/** 顶栏状态胶囊。拿不到金额时退回任务阶段，不编收款结论。 */
export function paymentPill(payment: PaymentFact, amountCents: number | null, fallback: string): string {
  if (payment === 'free') return '本次未收款 · 系统报价 0 元'
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

export const FAIL_REASONS = [
  '打印机离线，请联系工作人员或稍后重试',
  '打印机缺纸，请联系工作人员补纸',
  '任务处理超时，请稍后重试',
  '文件解析失败，请重新上传文件',
]

const ERROR_CODE_MESSAGES: Record<string, string> = {
  DOWNLOAD_HASH_MISMATCH: '文件校验未通过（上传可能中断或文件已变化），请返回重新上传后再打印',
  PRINTER_NOT_FOUND: '未找到打印机，请联系工作人员检查打印机连接',
  PRINTER_OFFLINE: '打印机离线，请联系工作人员检查电源 / 网线 / USB 后重试',
  PAPER_EMPTY: '打印机缺纸，当前无法打印，请联系工作人员补纸后重试',
  PRINTER_ERROR: '打印机可能卡纸或发生设备故障，当前暂时无法继续使用，请联系工作人员处理',
  PRINT_JOB_UNCONFIRMED: '打印作业已提交到打印队列，但未确认完成，请工作人员检查纸张、卡纸和出纸状态',
  PRINT_TIMEOUT: '打印超时，请稍后重试',
  PRINT_COMMAND_FAILED: '打印执行失败，请稍后重试或联系工作人员',
  UNSUPPORTED_FILE_TYPE: '该文件格式暂不支持打印，请上传 PDF 或 JPG / PNG',
  FILE_NOT_FOUND: '打印文件已失效，请返回重新上传',
}

export function errorCodeToMessage(code?: string): string | undefined {
  return code ? ERROR_CODE_MESSAGES[code] : undefined
}

export const stepIndex = (key: Step) => STEPS.findIndex((s) => s.key === key)

export function backendStatusToStep(status: BackendJobStatus): Step {
  if (status === 'printing') return 'printing'
  return 'queuing'
}
