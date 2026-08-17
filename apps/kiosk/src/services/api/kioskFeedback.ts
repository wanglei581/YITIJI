// ============================================================
// 一体机匿名问题反馈提交（免登录）。
//
// 对应后端 POST /kiosk/feedback（services/api/src/member-feedback/kiosk-feedback.controller.ts）。
// 该端点刻意没有挂鉴权：一体机是公共位设备，绝大多数用户不登录，
// 而「缺纸 / 页数不对 / 卡住没出完」这类问题只有现场那个人提得出来。
//
// 与 memberFeedback.ts（/me/feedback）的区别，三条都是硬约束：
//   1. 不带 Authorization，且 credentials: 'omit' —— 不捎带会话 Cookie。
//      匿名就要是真的匿名，不能因为用户碰巧登录过就把工单挂到他账号上。
//   2. 不收联系方式。后端 CreateKioskFeedbackDto 根本没有 contactPhone 字段，
//      前端也不提供输入框 —— 匿名工单没有账号归属，一旦落进手机号就是无主敏感数据
//      （CLAUDE.md §11）。自由文本里的 PII 由服务端拒绝（不是脱敏）。
//   3. 只有「提交」一个动作。没有列表 / 详情 / 追加回复 / 关单 ——
//      匿名调用方不应拿到任何可枚举的工单读能力，处置只能走 Admin 侧。
//
// 诚实性（CLAUDE.md §9）：mock 模式与缺终端身份都**抛错**而不是返回假回执。
// 仓库里已有若干返回 { ok: true } 的空壳端点，这里不再制造同类体验。
// ============================================================

import { API_BASE_URL, API_MODE } from './client'
import { getTerminalId } from './screensaver'

/**
 * 封闭词表，与后端 dto/kiosk-feedback.dto.ts 的 KIOSK_FEEDBACK_ISSUE_CODES 一一对应。
 * 客户端只能从这张表里选，category 由服务端映射得出 —— 前端不传也传不了 category。
 * 两份清单的一致性由 verify:kiosk-feedback-entry 静态门禁守护。
 */
export const KIOSK_FEEDBACK_ISSUE_CODES = [
  'print_page_count_mismatch',
  'print_quality_defect',
  'print_incomplete_or_jam',
  'print_other',
  'device_out_of_paper',
  'scan_issue',
  'upload_issue',
  'billing_issue',
  'other',
] as const

export type KioskFeedbackIssueCode = typeof KIOSK_FEEDBACK_ISSUE_CODES[number]

export const KIOSK_FEEDBACK_SATISFACTIONS = ['good', 'fair', 'bad'] as const
export type KioskFeedbackSatisfaction = typeof KIOSK_FEEDBACK_SATISFACTIONS[number]

export interface KioskFeedbackIssueOption {
  code: KioskFeedbackIssueCode
  label: string
}

/**
 * 各入口开放的问题类型子集。与词表同住一个文件：它们是同一份契约的两半，
 * 拆开放会让「选项漂移出白名单」这种错在改动时不易被看见。
 * 子集划分对应后端 dto/kiosk-feedback.dto.ts 文件头列出的两处真实入口。
 */
export const PRINT_DONE_ISSUE_OPTIONS: readonly KioskFeedbackIssueOption[] = [
  { code: 'print_page_count_mismatch', label: '页数与预期不符' },
  { code: 'print_quality_defect', label: '打印发黑 / 发花' },
  { code: 'print_incomplete_or_jam', label: '卡住没出完' },
  { code: 'print_other', label: '其他打印问题' },
]

export const PRINT_HUB_ISSUE_OPTIONS: readonly KioskFeedbackIssueOption[] = [
  { code: 'device_out_of_paper', label: '设备缺纸' },
  { code: 'print_quality_defect', label: '打印质量问题' },
  { code: 'scan_issue', label: '扫描问题' },
  { code: 'upload_issue', label: '上传问题' },
  { code: 'billing_issue', label: '费用问题' },
  { code: 'other', label: '其他问题' },
]

/** 与后端 KIOSK_FEEDBACK_CONTENT_MAX 对齐（会员端是 500，匿名端刻意更短）。 */
export const KIOSK_FEEDBACK_CONTENT_MAX = 300

export interface KioskFeedbackReceipt {
  ticketId: string
  submitterType: 'anonymous_kiosk'
  category: string
  issueCode: KioskFeedbackIssueCode | null
  satisfaction: KioskFeedbackSatisfaction | null
  status: string
  /** true = 命中服务端幂等窗口，返回的是已存在的工单，本次未新建。 */
  deduplicated: boolean
  createdAt: string
}

export interface SubmitKioskFeedbackInput {
  issueCode?: KioskFeedbackIssueCode
  satisfaction?: KioskFeedbackSatisfaction
  content?: string
  relatedPrintTaskId?: string
  relatedScanTaskId?: string
}

export class KioskFeedbackApiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message)
    this.name = 'KioskFeedbackApiError'
  }
}

interface Envelope<T> {
  success: boolean
  data: T
}

/**
 * 提交匿名反馈。
 *
 * 失败一律抛 KioskFeedbackApiError，由调用方如实展示 —— 不吞错、不降级成假成功。
 * 服务端可能返回的业务错误码（原样透传 message 给用户）：
 *   KIOSK_FEEDBACK_EMPTY / KIOSK_FEEDBACK_PII_REJECTED / KIOSK_FEEDBACK_RATE_LIMITED
 *   KIOSK_FEEDBACK_TERMINAL_INVALID / KIOSK_FEEDBACK_PRINT_TASK_INVALID
 */
export async function submitKioskFeedback(
  input: SubmitKioskFeedbackInput,
): Promise<KioskFeedbackReceipt> {
  if (API_MODE !== 'http') {
    // mock 模式不接真实后端。返回假回执等于告诉用户「已受理」而实际无人收到。
    throw new KioskFeedbackApiError('NO_HTTP_BACKEND', '当前未连接真实服务，无法提交反馈', 0)
  }

  const terminalId = getTerminalId()
  if (!terminalId) {
    // 终端身份未解析 = 后端无法定位是哪台机器，也无法做按终端限流。失败关闭。
    throw new KioskFeedbackApiError(
      'NO_TERMINAL_IDENTITY',
      '本机终端身份未确认，暂时无法提交反馈，请联系现场工作人员',
      0,
    )
  }

  const content = input.content?.trim()
  const body = {
    terminalId,
    ...(input.issueCode ? { issueCode: input.issueCode } : {}),
    ...(input.satisfaction ? { satisfaction: input.satisfaction } : {}),
    ...(content ? { content } : {}),
    ...(input.relatedPrintTaskId ? { relatedPrintTaskId: input.relatedPrintTaskId } : {}),
    ...(input.relatedScanTaskId ? { relatedScanTaskId: input.relatedScanTaskId } : {}),
  }

  let res: Response
  try {
    res = await fetch(`${API_BASE_URL}/kiosk/feedback`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      // 匿名端点：不捎带 Cookie，避免把工单意外挂到某个已登录会话上。
      credentials: 'omit',
      body: JSON.stringify(body),
    })
  } catch {
    throw new KioskFeedbackApiError('NETWORK_ERROR', '网络连接失败，反馈未提交，请稍后重试', 0)
  }

  if (!res.ok) {
    let code = 'UNKNOWN_ERROR'
    let message = `提交失败（${res.status}）`
    try {
      const parsed = (await res.json()) as { error?: { code?: string; message?: string } }
      code = parsed.error?.code ?? code
      message = parsed.error?.message ?? message
    } catch {
      /* 非 JSON 响应：保留默认文案，不臆造原因 */
    }
    throw new KioskFeedbackApiError(code, message, res.status)
  }

  const json = (await res.json()) as Envelope<KioskFeedbackReceipt>
  return json.data
}
