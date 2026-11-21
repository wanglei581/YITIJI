import { ApiHttpError } from './client'
import type { AdminOrderReadonlyDetail, AdminOrderReadonlyPage, ListAdminOrdersReadonlyParams } from './adminOrdersReadonly'

/**
 * 演示服务单。金额只是演示数，不是价目。自营点位，青岛真实区名。
 * 默认列表不返回这些行，避免盖住原来的打印演示单。
 */
function demoServiceOrders(): AdminOrderReadonlyDetail[] {
  const paidAt = '2026-11-13T09:12:00+08:00'
  const base = {
    ownerType: 'anonymous' as const,
    userLabel: '现场用户',
    currency: 'CNY',
    channel: 'kiosk',
    pickupStatus: 'none',
    pickupCodeExpiresAt: null,
    billablePages: null,
    printFileName: null,
    copies: null,
    colorMode: null,
    paperSize: null,
    errorCode: null,
    printOutcome: null,
    aftercareStatus: null,
    refundEligible: false,
    refundRequired: false,
    discountCents: 0,
    printTaskId: null,
    print: null,
    statusLogs: [],
    autoRefund: false,
    refundStatus: null,
    refundFailureReason: null,
    printRefundDisposition: null,
    printRefundReason: null,
    refundLedgerNo: null,
    refundLedgerCents: null,
    recordKind: 'service' as const,
    createdAt: '2026-11-13T09:10:00+08:00',
    updatedAt: paidAt,
  }
  const rows: Array<Omit<AdminOrderReadonlyDetail, 'payableCents'>> = [
    {
      ...base,
      id: 'svc_demo_used',
      orderNo: 'SVC-DEMO-SN-01',
      type: 'resume_optimize',
      serviceKey: 'resume_optimize',
      serviceName: 'AI 简历优化',
      serviceStatus: 'consumed',
      terminalCode: 'ZYD-SN-01',
      locationLabel: '市南 · 香港中路',
      amountCents: 100,
      payStatus: 'paid',
      taskStatus: 'completed',
      paidAt,
      refundReason: null,
      refundedAt: null,
      refundedAmountCents: 0,
      refundAttempts: 0,
      retryForbidden: true,
      opsAttention: false,
      opsAttentionCode: null,
      failureReason: null,
      closeReason: null,
    },
    {
      ...base,
      id: 'svc_demo_refunded',
      orderNo: 'SVC-DEMO-SB-02',
      type: 'scan',
      serviceKey: 'scan',
      serviceName: '扫描',
      serviceStatus: 'refunded',
      terminalCode: 'ZYD-SB-02',
      locationLabel: '市北 · 辽宁路',
      amountCents: 100,
      payStatus: 'refunded',
      taskStatus: 'cancelled',
      paidAt: '2026-11-13T10:02:00+08:00',
      refundReason: '扫描没出文件',
      refundedAt: '2026-11-13T10:14:00+08:00',
      refundedAmountCents: 100,
      refundAttempts: 0,
      retryForbidden: true,
      opsAttention: false,
      opsAttentionCode: null,
      failureReason: '扫描没出文件',
      closeReason: null,
      updatedAt: '2026-11-13T10:14:00+08:00',
    },
    {
      ...base,
      id: 'svc_demo_refunding',
      orderNo: 'SVC-DEMO-LC-03',
      type: 'mock_interview',
      serviceKey: 'mock_interview',
      serviceName: 'AI 模拟面试',
      serviceStatus: 'refunding',
      terminalCode: 'ZYD-LC-03',
      locationLabel: '李沧 · 九水路',
      amountCents: 200,
      payStatus: 'refunding',
      taskStatus: 'failed',
      paidAt: '2026-11-13T11:20:00+08:00',
      refundReason: '面试没开起来',
      refundedAt: null,
      refundedAmountCents: 0,
      refundAttempts: 2,
      retryForbidden: false,
      opsAttention: true,
      opsAttentionCode: 'refunding',
      failureReason: '面试没开起来',
      closeReason: null,
      updatedAt: '2026-11-13T11:28:00+08:00',
    },
    {
      ...base,
      id: 'svc_demo_paid',
      orderNo: 'SVC-DEMO-HD-04',
      type: 'scan',
      serviceKey: 'scan',
      serviceName: '扫描',
      serviceStatus: 'paid',
      terminalCode: 'ZYD-HD-04',
      locationLabel: '黄岛 · 长江路',
      amountCents: 100,
      payStatus: 'paid',
      taskStatus: 'pending',
      paidAt: '2026-11-13T12:05:00+08:00',
      refundReason: null,
      refundedAt: null,
      refundedAmountCents: 0,
      refundAttempts: 0,
      retryForbidden: true,
      opsAttention: false,
      opsAttentionCode: null,
      failureReason: null,
      closeReason: null,
      updatedAt: '2026-11-13T12:05:00+08:00',
    },
    {
      ...base,
      id: 'svc_demo_manual',
      orderNo: 'SVC-DEMO-JM-06',
      type: 'scan',
      serviceKey: 'scan',
      serviceName: '扫描',
      serviceStatus: 'refund_failed',
      terminalCode: 'ZYD-JM-06',
      locationLabel: '即墨 · 蓝鳌路',
      amountCents: 100,
      payStatus: 'refund_failed',
      taskStatus: 'failed',
      paidAt: '2026-11-13T13:02:00+08:00',
      refundReason: '扫描没出文件',
      refundedAt: null,
      refundedAmountCents: 0,
      refundAttempts: 8,
      retryForbidden: false,
      opsAttention: true,
      opsAttentionCode: 'refunding',
      failureReason: '扫描没出文件',
      closeReason: null,
      updatedAt: '2026-11-13T13:40:00+08:00',
    },
    {
      ...base,
      id: 'svc_demo_running',
      orderNo: 'SVC-DEMO-SN-05',
      type: 'scan',
      serviceKey: 'scan',
      serviceName: '扫描',
      serviceStatus: 'consumed',
      terminalCode: 'ZYD-SN-01',
      locationLabel: '市南 · 香港中路',
      amountCents: 100,
      payStatus: 'paid',
      taskStatus: 'in_progress',
      paidAt: '2026-11-13T12:20:00+08:00',
      refundReason: null,
      refundedAt: null,
      refundedAmountCents: 0,
      refundAttempts: 0,
      retryForbidden: true,
      opsAttention: false,
      opsAttentionCode: null,
      failureReason: null,
      closeReason: null,
      updatedAt: '2026-11-13T12:21:00+08:00',
    },
  ]
  return rows.map((row) => ({ ...row, payableCents: row.amountCents }))
}

let serviceDemoState = demoServiceOrders()

const now = () => new Date().toISOString()

export function serviceDemoPage(params: ListAdminOrdersReadonlyParams): AdminOrderReadonlyPage {
  const items = serviceDemoState.filter((row) => {
    if (params.type && row.serviceKey !== params.type) return false
    if (params.serviceStatus && row.serviceStatus !== params.serviceStatus) return false
    if (params.search && !`${row.orderNo} ${row.terminalCode ?? ''} ${row.locationLabel ?? ''}`.includes(params.search)) return false
    return true
  })
  return {
    items,
    pagination: { page: params.page, pageSize: params.pageSize, total: items.length, totalPages: 1 },
  }
}

export function findServiceDemo(id: string): AdminOrderReadonlyDetail | undefined {
  return serviceDemoState.find((row) => row.id === id)
}

export function retryServiceDemoRefund(id: string): AdminOrderReadonlyDetail {
  const index = serviceDemoState.findIndex((row) => row.id === id)
  const row = index >= 0 ? serviceDemoState[index] : undefined
  if (!row || (row.serviceStatus !== 'refunding' && row.serviceStatus !== 'refund_failed')) {
    throw new ApiHttpError('SERVICE_REFUND_NOT_RETRYABLE', '这张单现在不在退款中', 409)
  }
  const refundedAt = now()
  const next: AdminOrderReadonlyDetail = {
    ...row,
    serviceStatus: 'refunded',
    payStatus: 'refunded',
    taskStatus: 'cancelled',
    refundedAt,
    refundedAmountCents: row.amountCents,
    opsAttention: false,
    opsAttentionCode: null,
    retryForbidden: true,
    updatedAt: refundedAt,
  }
  serviceDemoState = serviceDemoState.map((item, i) => (i === index ? next : item))
  return next
}

export function refundServiceDemo(id: string): AdminOrderReadonlyDetail {
  const index = serviceDemoState.findIndex((row) => row.id === id)
  const row = index >= 0 ? serviceDemoState[index] : undefined
  const stuck = row?.serviceStatus === 'paid' || (row?.serviceStatus === 'consumed' && row.taskStatus === 'in_progress')
  if (!row || !stuck) {
    throw new ApiHttpError('SERVICE_REFUND_NOT_RETRYABLE', '这张单现在不能原路退款', 409)
  }
  const refundedAt = now()
  const next: AdminOrderReadonlyDetail = {
    ...row,
    serviceStatus: 'refunded',
    payStatus: 'refunded',
    taskStatus: 'cancelled',
    refundReason: '管理员原路退款',
    refundedAt,
    refundedAmountCents: row.amountCents,
    opsAttention: false,
    opsAttentionCode: null,
    retryForbidden: true,
    updatedAt: refundedAt,
  }
  serviceDemoState = serviceDemoState.map((item, i) => (i === index ? next : item))
  return next
}
