/**
 * Admin 打印扫描统一任务中心契约（Task 10 Step 1/2）。
 *
 * 判别联合按任务类型分派；photo/copy/material_pack/format_conversion/
 * signature_stamp 当前没有数据模型（未上线），列表对它们返回空集合 +
 * implemented=false，不伪造行数据。
 *
 * 安全约束（对齐 admin-ops / admin-orders-readonly 先例）：
 *   - 不返回 fileUrl / fileMd5 / 签名 URL / errorMessage 原文 / paramsJson 原文;
 *     文件仅暴露 fileId 等安全元数据。
 *   - 归属仅 member/anonymous，不暴露 endUserId。
 */

import type { PrintScanTaskType } from '../terminals/terminal-capabilities.types'

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
  | (AdminPrintScanTaskBase & {
      type: 'scan'
      scanType: string
      hasResultFile: boolean
    })
  | (AdminPrintScanTaskBase & {
      type: 'document_process'
      kind: string
      hasResultFile: boolean
    })

export type AdminPrintScanTaskDetail =
  | (Extract<AdminPrintScanTaskItem, { type: 'print' }> & {
      completedAt: string | null
      orderId: string | null
      orderNo: string | null
      statusLogs: { fromStatus: string; toStatus: string; errorCode: string | null; createdAt: string }[]
      /** Admin 受控关闭未付款打印任务的资格；阻断原因不含支付/渠道原文。 */
      closeUnpaidEligible: boolean
      closeUnpaidBlockReason:
        | 'no_associated_order'
        | 'task_not_pending'
        | 'task_claimed'
        | 'order_not_unpaid'
        | 'order_task_not_pending'
        | 'payment_attempt_exists'
        | null
    })
  | (Extract<AdminPrintScanTaskItem, { type: 'scan' }> & {
      fileId: string | null
    })
  | (Extract<AdminPrintScanTaskItem, { type: 'document_process' }> & {
      sourceFileId: string
      resultFileId: string | null
    })

export interface AdminPrintScanTaskPage {
  /** 查询的任务类型；未上线类型 implemented=false 且 items 恒为空。 */
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
