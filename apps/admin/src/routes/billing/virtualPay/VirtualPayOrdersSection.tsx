import { formatDateTime, formatYuan } from '@ai-job-print/shared'
import { Card, EmptyState, ErrorState, LoadingState, StatusBadge } from '@ai-job-print/ui'
import { RefreshCwIcon, SearchIcon } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
  adminVirtualPayService,
  type VirtualPayOrderItem,
  type VirtualPayOrderListResponse,
} from '../../../services/api/adminVirtualPay'
import { VirtualPayOrderDetailModal } from './VirtualPayOrderDetailModal'
import { VirtualPayRefundModal } from './VirtualPayRefundModal'
import {
  VPAY_IOS_REFUND_NOTICE,
  VPAY_ORDER_STATUS_OPTIONS,
  vpayCreditStatusMeta,
  vpayDiagnosticLabel,
  vpayEnvLabel,
  vpayOrderStatusMeta,
  vpayRefundBlockLabel,
  vpayServiceLabel,
} from './virtualPayLabels'

export function VirtualPayOrdersSection() {
  const [data, setData] = useState<VirtualPayOrderListResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('')
  const [serviceFilter, setServiceFilter] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [appliedSearch, setAppliedSearch] = useState('')
  const [page, setPage] = useState(1)
  const [syncingId, setSyncingId] = useState<string | null>(null)
  const [detailOrder, setDetailOrder] = useState<VirtualPayOrderItem | null>(null)
  const [refundTarget, setRefundTarget] = useState<VirtualPayOrderItem | null>(null)
  const [refundError, setRefundError] = useState<string | null>(null)
  const [refunding, setRefunding] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await adminVirtualPayService.listOrders({
        status: statusFilter || undefined,
        serviceKind: serviceFilter || undefined,
        outTradeNo: appliedSearch || undefined,
        page,
        pageSize: 20,
      })
      setData(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载虚拟支付订单失败')
    } finally {
      setLoading(false)
    }
  }, [appliedSearch, page, serviceFilter, statusFilter])

  useEffect(() => {
    void load()
  }, [load])

  const onSync = async (order: VirtualPayOrderItem) => {
    setSyncingId(order.id)
    setNotice(null)
    setError(null)
    try {
      const res = await adminVirtualPayService.syncOrder(order.id)
      const meta = vpayOrderStatusMeta(res.order.status)
      setNotice(`已完成同步查单，订单 ${order.outTradeNo} 当前状态：${meta.label}。`)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : '同步查单失败')
    } finally {
      setSyncingId(null)
    }
  }

  const onConfirmRefund = async (reason: string) => {
    if (!refundTarget) return
    setRefunding(true)
    setRefundError(null)
    setNotice(null)
    try {
      const updated = await adminVirtualPayService.refundOrder(refundTarget.id, {
        confirm: true,
        ...(reason ? { reason } : {}),
      })
      const meta = vpayOrderStatusMeta(updated.status)
      setRefundTarget(null)
      setNotice(`已提交原路退款申请，订单 ${updated.outTradeNo} 当前状态：${meta.label}（请以通知或同步查单确认为准）。`)
      await load()
    } catch (e) {
      setRefundError(e instanceof Error ? e.message : '发起退款失败')
    } finally {
      setRefunding(false)
    }
  }

  return (
    <Card className="p-0">
      <div className="border-b border-neutral-100 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-[15px] font-bold text-neutral-900">虚拟支付订单与权益</h2>
            <p className="mt-0.5 text-xs text-neutral-500">{VPAY_IOS_REFUND_NOTICE}</p>
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={() => void load()}
            className="inline-flex items-center gap-1.5 rounded-md border border-neutral-200 px-3 py-1.5 text-xs text-neutral-600 disabled:opacity-50"
          >
            <RefreshCwIcon className={['h-3.5 w-3.5', loading ? 'animate-spin' : ''].join(' ')} /> 刷新列表
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select
            aria-label="筛选订单状态"
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1) }}
            className="rounded-md border border-neutral-200 px-2.5 py-1.5 text-xs text-neutral-700"
          >
            {VPAY_ORDER_STATUS_OPTIONS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>

          <select
            aria-label="筛选服务类型"
            value={serviceFilter}
            onChange={(e) => { setServiceFilter(e.target.value); setPage(1) }}
            className="rounded-md border border-neutral-200 px-2.5 py-1.5 text-xs text-neutral-700"
          >
            <option value="">全部服务类型</option>
            <option value="resume_optimize">AI 简历优化</option>
            <option value="mock_interview">AI 模拟面试</option>
          </select>

          <div className="flex items-center gap-1">
            <input
              type="text"
              aria-label="按商户订单号查询"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="输入商户订单号"
              className="w-56 rounded-md border border-neutral-200 px-2.5 py-1.5 font-mono text-xs"
            />
            <button
              type="button"
              onClick={() => { setAppliedSearch(searchInput.trim()); setPage(1) }}
              className="inline-flex items-center gap-1 rounded-md border border-neutral-200 px-3 py-1.5 text-xs text-neutral-700"
            >
              <SearchIcon className="h-3.5 w-3.5" /> 查询
            </button>
          </div>
        </div>

        {error ? <p className="mt-3 rounded-md bg-error-bg px-3 py-2 text-xs text-error-fg" role="alert">{error}</p> : null}
        {notice ? <p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700" role="status">{notice}</p> : null}
      </div>

      {error && !data ? (
        <div className="p-4"><ErrorState message={error} onRetry={() => void load()} /></div>
      ) : !data ? (
        <div className="p-4"><LoadingState /></div>
      ) : data.items.length === 0 ? (
        <div className="p-8">
          <EmptyState title="暂无小程序虚拟支付订单" description="当前筛选条件下没有订单记录。" />
        </div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-900/10 bg-neutral-50/80 text-left text-[11.5px] text-neutral-500">
                  <th className="px-3 py-2.5 font-bold">商户订单号</th>
                  <th className="px-3 py-2.5 font-bold">服务与金额</th>
                  <th className="px-3 py-2.5 font-bold">订单状态</th>
                  <th className="px-3 py-2.5 font-bold">权益状态</th>
                  <th className="px-3 py-2.5 font-bold">诊断说明</th>
                  <th className="px-3 py-2.5 font-bold">创建时间</th>
                  <th className="px-3 py-2.5 text-right font-bold">操作</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => {
                  const orderMeta = vpayOrderStatusMeta(item.status)
                  const creditMeta = vpayCreditStatusMeta(item.credit?.status)
                  const canRefund = item.status === 'paid' && item.credit?.status === 'available' && item.refundable
                  return (
                    <tr key={item.id} className="border-b border-neutral-50">
                      <td className="px-3 py-3">
                        <div className="whitespace-nowrap font-mono text-xs text-neutral-800">{item.outTradeNo}</div>
                        <div className="mt-0.5 text-[11px] text-neutral-400">{vpayEnvLabel(item.env)}</div>
                      </td>
                      <td className="px-3 py-3">
                        <div className="text-neutral-900">{vpayServiceLabel(item.serviceKind)}</div>
                        <div className="mt-0.5 text-xs text-neutral-500">{formatYuan(item.priceCents / 100)}</div>
                      </td>
                      <td className="px-3 py-3">
                        <StatusBadge status={orderMeta.tone} label={orderMeta.label} />
                      </td>
                      <td className="px-3 py-3">
                        <StatusBadge status={creditMeta.tone} label={creditMeta.label} />
                      </td>
                      <td className="px-3 py-3 text-xs text-neutral-600" title={item.lastDiagnosticReason ?? undefined}>
                        {vpayDiagnosticLabel(item.lastDiagnosticReason)}
                      </td>
                      <td className="whitespace-nowrap px-3 py-3 text-xs text-neutral-400">
                        {formatDateTime(item.createdAt)}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <div className="flex flex-wrap justify-end gap-1.5">
                          <button
                            type="button"
                            onClick={() => setDetailOrder(item)}
                            className="rounded-md border border-neutral-200 px-2.5 py-1 text-xs text-neutral-600"
                          >
                            详情
                          </button>
                          <button
                            type="button"
                            disabled={syncingId === item.id || !item.hasOpenId}
                            onClick={() => void onSync(item)}
                            className="rounded-md border border-neutral-200 px-2.5 py-1 text-xs text-neutral-700 disabled:opacity-40"
                          >
                            {syncingId === item.id ? '同步中…' : '同步查单'}
                          </button>
                          {canRefund ? (
                            <button
                              type="button"
                              onClick={() => { setRefundError(null); setRefundTarget(item) }}
                              className="rounded-md border border-rose-200 bg-rose-50 px-2.5 py-1 text-xs font-medium text-rose-700"
                            >
                              原路退款
                            </button>
                          ) : (
                            <span className="self-center text-[11px] text-neutral-400">
                              {vpayRefundBlockLabel(item.refundBlockReason)}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between border-t border-neutral-100 px-4 py-3 text-xs text-neutral-500">
            <span>共 {data.total} 条，第 {data.pagination.page} / {data.pagination.totalPages} 页</span>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="rounded border border-neutral-200 px-2.5 py-1 disabled:opacity-40"
              >
                上一页
              </button>
              <button
                type="button"
                disabled={page >= data.pagination.totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="rounded border border-neutral-200 px-2.5 py-1 disabled:opacity-40"
              >
                下一页
              </button>
            </div>
          </div>
        </>
      )}

      {detailOrder ? <VirtualPayOrderDetailModal order={detailOrder} onClose={() => setDetailOrder(null)} /> : null}
      {refundTarget ? (
        <VirtualPayRefundModal
          order={refundTarget}
          submitting={refunding}
          error={refundError}
          onCancel={() => { setRefundTarget(null); setRefundError(null) }}
          onConfirm={(reason) => void onConfirmRefund(reason)}
        />
      ) : null}
    </Card>
  )
}
