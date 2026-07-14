// Admin 打印扫描运维 API 客户端（Task 10）。
//
// 端点（admin JwtAuthGuard + RolesGuard，均为 ApiResponse<T> 包装，需拆 .data）：
//   GET  /admin/print-scan/tasks                          按类型分页任务列表
//   GET  /admin/print-scan/tasks/:type/:taskId            类型感知详情
//   POST /admin/print-scan/tasks/:type/:taskId/actions    print.retry / scan.cancel（写审计）
//   GET  /admin/terminals/:terminalId/capabilities        终端能力开关列表
//   PUT  /admin/terminals/:terminalId/capabilities/:key   upsert 单个能力开关（写审计）
//
// 诚实约束：photo/copy/material_pack/format_conversion/signature_stamp 未上线，
// 后端返回 implemented=false + 空 items；本客户端与页面不得伪造这些类型的数据。
import { API_BASE_URL, API_MODE, ApiHttpError } from './client'
import { authHeader, redirectToLogin } from '../auth'

// ── 契约类型（源：services/api/src/admin-print-scan/admin-print-scan.types.ts
//    与 packages/shared/src/types/printScanCapability.ts） ────────────────────

export type PrintScanTaskType =
  | 'print'
  | 'scan'
  | 'copy'
  | 'photo'
  | 'material_pack'
  | 'format_conversion'
  | 'signature_stamp'
  | 'document_process'

export type PrintScanCapabilityKey =
  | 'document_print'
  | 'phone_upload'
  | 'cloud_upload'
  | 'usb_import'
  | 'material_pack'
  | 'scan'
  | 'copy'
  | 'id_photo'
  | 'format_convert'
  | 'signature_stamp'

export type PrintScanCapabilityStatus = 'available' | 'testing' | 'maintenance' | 'unsupported' | 'not_verified'

/**
 * 词汇债治理（2026-07-12 D4 拍板）：cloud_upload 与 phone_upload 语义相同，视为已弃用别名。
 * key = 已弃用旧键，value = 现役承接键，仅用于 Admin 界面提示，不改变实际配置读写。
 */
export const DEPRECATED_CAPABILITY_ALIAS: Partial<Record<PrintScanCapabilityKey, PrintScanCapabilityKey>> = {
  cloud_upload: 'phone_upload',
}

export interface TerminalCapabilityView {
  capabilityKey: PrintScanCapabilityKey
  status: PrintScanCapabilityStatus
  note: string | null
  configured: boolean
  updatedAt: string | null
}

export interface AdminPrintScanTaskBase {
  taskId: string
  terminalId: string | null
  terminalCode: string | null
  status: string
  ownerType: 'member' | 'anonymous'
  errorCode: string | null
  createdAt: string
  updatedAt: string
  expiresAt: string | null
}

export type AdminPrintScanTaskItem =
  | (AdminPrintScanTaskBase & {
      type: 'print'
      fileName: string | null
      copies: number | null
      colorMode: 'black_white' | 'color' | null
      paperSize: string | null
    })
  | (AdminPrintScanTaskBase & { type: 'scan'; scanType: string; hasResultFile: boolean })
  | (AdminPrintScanTaskBase & { type: 'document_process'; kind: string; hasResultFile: boolean })

export type AdminPrintScanTaskDetail =
  | (Extract<AdminPrintScanTaskItem, { type: 'print' }> & {
      completedAt: string | null
      orderId: string | null
      orderNo: string | null
      statusLogs: { fromStatus: string; toStatus: string; errorCode: string | null; createdAt: string }[]
      /** 仅由打印任务详情端点提供的受控取消资格。 */
      closeUnpaidEligible: boolean
      /** 后端可安全展示给管理员的阻断原因。 */
      closeUnpaidBlockReason: string | null
    })
  | (Extract<AdminPrintScanTaskItem, { type: 'scan' }> & { fileId: string | null })
  | (Extract<AdminPrintScanTaskItem, { type: 'document_process' }> & {
      sourceFileId: string
      resultFileId: string | null
    })

export interface AdminPrintScanTaskPage {
  type: PrintScanTaskType
  implemented: boolean
  items: AdminPrintScanTaskItem[]
  pagination: { page: number; pageSize: number; total: number; totalPages: number }
}

export type AdminPrintScanAction = 'retry' | 'cancel'

export interface AdminPrintScanActionResult {
  taskId: string
  type: PrintScanTaskType
  action: AdminPrintScanAction
  fromStatus: string
  toStatus: string
}

export interface AdminCloseUnpaidPrintTaskResult {
  taskId: string
  type: 'print'
  fromStatus: 'pending' | 'cancelled'
  toStatus: 'cancelled'
  idempotent: boolean
}

export interface ListPrintScanTasksParams {
  type: PrintScanTaskType
  status?: string
  terminalId?: string
  page?: number
  pageSize?: number
}

export interface CancelUnpaidPrintTaskInput {
  reason: string
  expectedUpdatedAt: string
}

interface AdminPrintScanServiceInterface {
  listTasks(params: ListPrintScanTasksParams): Promise<AdminPrintScanTaskPage>
  getTaskDetail(type: PrintScanTaskType, taskId: string): Promise<AdminPrintScanTaskDetail>
  applyTaskAction(type: PrintScanTaskType, taskId: string, action: AdminPrintScanAction): Promise<AdminPrintScanActionResult>
  cancelUnpaidPrintTask(taskId: string, input: CancelUnpaidPrintTaskInput): Promise<AdminCloseUnpaidPrintTaskResult>
  listCapabilities(terminalId: string): Promise<{ terminalCode: string; capabilities: TerminalCapabilityView[] }>
  updateCapability(
    terminalId: string,
    capabilityKey: PrintScanCapabilityKey,
    patch: { status: PrintScanCapabilityStatus; note?: string },
  ): Promise<{ terminalCode: string; capability: TerminalCapabilityView }>
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', ...authHeader(), ...(init?.headers ?? {}) },
    credentials: 'include',
  })
  if (!res.ok) {
    let code = `HTTP_${res.status}`
    let message = res.statusText
    try {
      const body = (await res.json()) as { error?: { code?: string; message?: string }; message?: string }
      if (body.error?.code) code = body.error.code
      if (body.error?.message) message = body.error.message
      else if (typeof body.message === 'string') message = body.message
    } catch {
      /* keep defaults */
    }
    if (res.status === 401) {
      redirectToLogin()
      throw new ApiHttpError(code || 'AUTH_REQUIRED', '登录已过期', res.status)
    }
    throw new ApiHttpError(code, message, res.status)
  }
  // 后端以 ApiResponse<T>（{ success, data }）包装，统一拆 .data。
  const body = (await res.json()) as { data: T }
  return body.data
}

const httpAdapter: AdminPrintScanServiceInterface = {
  listTasks: (params) => {
    const q = new URLSearchParams()
    q.set('type', params.type)
    if (params.status) q.set('status', params.status)
    if (params.terminalId) q.set('terminalId', params.terminalId)
    if (params.page) q.set('page', String(params.page))
    if (params.pageSize) q.set('pageSize', String(params.pageSize))
    return request(`/admin/print-scan/tasks?${q.toString()}`)
  },
  getTaskDetail: (type, taskId) =>
    request(`/admin/print-scan/tasks/${encodeURIComponent(type)}/${encodeURIComponent(taskId)}`),
  applyTaskAction: (type, taskId, action) =>
    request(`/admin/print-scan/tasks/${encodeURIComponent(type)}/${encodeURIComponent(taskId)}/actions`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    }),
  cancelUnpaidPrintTask: (taskId, input) =>
    request(`/admin/print-scan/tasks/print/${encodeURIComponent(taskId)}/close-unpaid`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  listCapabilities: (terminalId) => request(`/admin/terminals/${encodeURIComponent(terminalId)}/capabilities`),
  updateCapability: (terminalId, capabilityKey, patch) =>
    request(`/admin/terminals/${encodeURIComponent(terminalId)}/capabilities/${encodeURIComponent(capabilityKey)}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    }),
}

// ── Mock（本地演示，无后端；只演示已上线类型，不伪造未上线类型） ─────────────

const MOCK_CAPABILITIES: TerminalCapabilityView[] = [
  { capabilityKey: 'document_print', status: 'available', note: null, configured: true, updatedAt: new Date().toISOString() },
  { capabilityKey: 'phone_upload', status: 'available', note: null, configured: true, updatedAt: new Date().toISOString() },
  { capabilityKey: 'cloud_upload', status: 'unsupported', note: '已弃用，等同「手机扫码上传」，请改用该项配置', configured: true, updatedAt: new Date().toISOString() },
  { capabilityKey: 'usb_import', status: 'not_verified', note: 'Windows 真机未验收', configured: true, updatedAt: new Date().toISOString() },
  { capabilityKey: 'material_pack', status: 'not_verified', note: null, configured: false, updatedAt: null },
  { capabilityKey: 'scan', status: 'not_verified', note: 'SMB 链路待真机验收', configured: true, updatedAt: new Date().toISOString() },
  { capabilityKey: 'copy', status: 'not_verified', note: null, configured: false, updatedAt: null },
  { capabilityKey: 'id_photo', status: 'not_verified', note: null, configured: false, updatedAt: null },
  { capabilityKey: 'format_convert', status: 'not_verified', note: null, configured: false, updatedAt: null },
  { capabilityKey: 'signature_stamp', status: 'not_verified', note: null, configured: false, updatedAt: null },
]

const MOCK_PRINT_TASKS: AdminPrintScanTaskItem[] = [
  {
    type: 'print', taskId: 'pt_demo_1', terminalId: 'term_demo', terminalCode: 'KSK-001',
    status: 'failed', ownerType: 'member', errorCode: 'printer_offline',
    createdAt: new Date(Date.now() - 3600_000).toISOString(), updatedAt: new Date().toISOString(), expiresAt: null,
    fileName: '演示简历.pdf', copies: 1, colorMode: 'black_white', paperSize: 'A4',
  },
  {
    type: 'print', taskId: 'pt_demo_2', terminalId: 'term_demo', terminalCode: 'KSK-001',
    status: 'completed', ownerType: 'anonymous', errorCode: null,
    createdAt: new Date(Date.now() - 7200_000).toISOString(), updatedAt: new Date().toISOString(), expiresAt: null,
    fileName: '求职材料.pdf', copies: 2, colorMode: 'color', paperSize: 'A4',
  },
]

const mockAdapter: AdminPrintScanServiceInterface = {
  listTasks: async (params) => {
    const implemented = params.type === 'print' || params.type === 'scan' || params.type === 'document_process'
    const items = params.type === 'print' ? MOCK_PRINT_TASKS.filter((t) => !params.status || t.status === params.status) : []
    return {
      type: params.type,
      implemented,
      items,
      pagination: { page: 1, pageSize: params.pageSize ?? 20, total: items.length, totalPages: items.length ? 1 : 0 },
    }
  },
  getTaskDetail: async (type, taskId) => {
    const item = MOCK_PRINT_TASKS.find((t) => t.taskId === taskId)
    if (!item || type !== 'print' || item.type !== 'print') throw new ApiHttpError('PRINT_SCAN_TASK_NOT_FOUND', '任务不存在', 404)
    return {
      ...item,
      completedAt: null,
      orderId: null,
      orderNo: null,
      statusLogs: [],
      closeUnpaidEligible: false,
      closeUnpaidBlockReason: item.status === 'pending' ? 'no_associated_order' : 'task_not_pending',
    }
  },
  applyTaskAction: async (type, taskId, action) => {
    if (type !== 'print' || action !== 'retry') throw new ApiHttpError('PRINT_SCAN_ACTION_UNSUPPORTED', '该任务类型不支持此操作', 400)
    const item = MOCK_PRINT_TASKS.find((t) => t.taskId === taskId)
    if (!item) throw new ApiHttpError('PRINT_SCAN_TASK_NOT_FOUND', '任务不存在', 404)
    if (item.status !== 'failed') throw new ApiHttpError('PRINT_SCAN_ACTION_INVALID_STATE', '仅失败状态的打印任务可以重试', 409)
    item.status = 'pending'
    item.errorCode = null
    return { taskId, type, action, fromStatus: 'failed', toStatus: 'pending' }
  },
  cancelUnpaidPrintTask: async (taskId) => {
    const item = MOCK_PRINT_TASKS.find((t) => t.taskId === taskId)
    if (!item) throw new ApiHttpError('PRINT_SCAN_TASK_NOT_FOUND', '任务不存在', 404)
    if (item.status !== 'pending') {
      throw new ApiHttpError('ADMIN_UNPAID_CLOSE_NOT_ELIGIBLE', '当前状态不允许取消未支付打印任务', 409)
    }
    const fromStatus = item.status
    item.status = 'cancelled'
    item.updatedAt = new Date().toISOString()
    return { taskId, type: 'print', fromStatus, toStatus: 'cancelled', idempotent: false }
  },
  listCapabilities: async () => ({ terminalCode: 'KSK-001', capabilities: MOCK_CAPABILITIES.map((c) => ({ ...c })) }),
  updateCapability: async (_terminalId, capabilityKey, patch) => {
    const row = MOCK_CAPABILITIES.find((c) => c.capabilityKey === capabilityKey)
    if (!row) throw new ApiHttpError('CAPABILITY_KEY_INVALID', '未知的能力键', 400)
    row.status = patch.status
    row.note = patch.note?.trim() || null
    row.configured = true
    row.updatedAt = new Date().toISOString()
    return { terminalCode: 'KSK-001', capability: { ...row } }
  },
}

export const adminPrintScanService: AdminPrintScanServiceInterface = API_MODE === 'http' ? httpAdapter : mockAdapter
