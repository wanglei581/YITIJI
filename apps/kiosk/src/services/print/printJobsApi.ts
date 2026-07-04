// ============================================================
// Print Jobs API — W6
//
// Thin fetch wrappers around:
//   POST /api/v1/print/jobs          — create a job, get taskId
//   GET  /api/v1/print/jobs/:taskId  — poll task status
//
// Only used when API_MODE === 'http' and file.fileUrl is set.
// Callers should handle errors (network failure, 404, etc.)
// and fall back to simulation as needed.
// ============================================================

import { API_BASE_URL } from '../api/client'
import type {
  BillingPageSource,
  OrderPayStatus,
  PrintJobParams,
  PrintPriceLine,
} from '@ai-job-print/shared'

export interface CreatePrintJobInput {
  fileUrl:   string
  /**
   * 文件哈希（hex）。方案②：字段名保留 `fileMd5`，但应传入上传返回的 **SHA-256**
   * （KioskUploadResult.sha256）。后端原样存储，Terminal Agent 用 SHA-256 比对。
   */
  fileMd5?:  string
  fileName?: string
  params:    PrintJobParams
  token?:    string | null
}

export interface PrintJobCreated {
  taskId:    string
  status:    string
  createdAt: string
  // ── C5-3 收银/履约衔接（后端 additive 返回；镜像 print-jobs.service PrintJobCreated）──
  /** 关联订单 id（收银出码 / 支付轮询用；不可猜 cuid，鉴权口径同 taskId）。 */
  orderId:   string
  /** 运营订单号（展示用）。 */
  orderNo:   string
  /** 应付金额（分），>= 0；0 表示免费单（已 paid）。Kiosk 据此分流：>0 进收银页，==0 直接履约。 */
  amountCents: number
  /** 建单即时支付状态：付费单 `unpaid`，免费单 `paid`（free）。 */
  payStatus: OrderPayStatus
  /** 计费明细快照（收银页「价目明细」展示）。 */
  priceLines: PrintPriceLine[]
  /** 后端识别的计费页数。 */
  billablePages: number
  /** 计费页数来源。 */
  billingPageSource: BillingPageSource
}

/** Backend status values — subset of shared PrintTaskStatus */
export type BackendJobStatus = 'pending' | 'claimed' | 'printing' | 'completed' | 'failed'

export interface PrintJobStatusResult {
  taskId:        string
  status:        BackendJobStatus
  errorCode?:    string
  /**
   * 后端已收口为**安全用户文案**（不再是 Agent 原始错误）。展示失败原因时优先用
   * `failureReasonForUser`，本字段仅作兼容保留，不应直接透出。
   */
  errorMessage?: string
  /** 后端下发的安全中文失败原因（仅失败时有值）。前台展示失败原因的首选来源。 */
  failureReasonForUser?: string
  completedAt?:  string
}

export async function createPrintJob(input: CreatePrintJobInput): Promise<PrintJobCreated> {
  const { token, ...body } = input
  const terminalId = (import.meta.env['VITE_TERMINAL_ID'] ?? '').trim()
  if (!terminalId) {
    throw new Error('createPrintJob failed: missing terminal id')
  }
  const res = await fetch(`${API_BASE_URL}/print/jobs`, {
    method:  'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Terminal-Id': terminalId,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body:    JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`createPrintJob failed: ${res.status} ${text}`)
  }
  return res.json() as Promise<PrintJobCreated>
}

export async function getPrintJobStatus(taskId: string): Promise<PrintJobStatusResult> {
  const res = await fetch(`${API_BASE_URL}/print/jobs/${taskId}`)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`getPrintJobStatus failed: ${res.status} ${text}`)
  }
  return res.json() as Promise<PrintJobStatusResult>
}
