import { formatDateTime, formatYuan } from '@ai-job-print/shared'
import { StatusBadge } from '@ai-job-print/ui'
import type { VirtualPayOrderItem } from '../../../services/api/adminVirtualPay'
import {
  vpayCreditStatusMeta,
  vpayDiagnosticLabel,
  vpayEnvLabel,
  vpayOrderStatusMeta,
  vpayServiceLabel,
} from './virtualPayLabels'

interface Props {
  order: VirtualPayOrderItem
  onClose: () => void
}

export function VirtualPayOrderDetailModal({ order, onClose }: Props) {
  const orderMeta = vpayOrderStatusMeta(order.status)
  const creditMeta = vpayCreditStatusMeta(order.credit?.status)

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="小程序虚拟支付订单详情"
    >
      <div className="w-full max-w-xl rounded-xl bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-base font-bold text-neutral-900">虚拟支付订单详情</h3>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-neutral-200 px-3 py-1 text-xs text-neutral-600"
          >
            关闭
          </button>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
          <div>
            <dt className="text-xs text-neutral-500">商户订单号</dt>
            <dd className="mt-0.5 break-all font-mono text-xs text-neutral-900">{order.outTradeNo}</dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">微信订单号</dt>
            <dd className="mt-0.5 break-all font-mono text-xs text-neutral-900">{order.wxOrderId || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">服务类型与金额</dt>
            <dd className="mt-0.5 text-neutral-900">
              {vpayServiceLabel(order.serviceKind)} · {formatYuan(order.priceCents / 100)}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">下单环境与道具</dt>
            <dd className="mt-0.5 text-neutral-900">
              {vpayEnvLabel(order.env)} · <span className="font-mono text-xs">{order.productId}</span>
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">订单状态</dt>
            <dd className="mt-0.5">
              <StatusBadge status={orderMeta.tone} label={orderMeta.label} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">权益状态</dt>
            <dd className="mt-0.5">
              <StatusBadge status={creditMeta.tone} label={creditMeta.label} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">商户退款单号</dt>
            <dd className="mt-0.5 break-all font-mono text-xs text-neutral-900">{order.refundOrderId || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">微信退款单号</dt>
            <dd className="mt-0.5 break-all font-mono text-xs text-neutral-900">{order.wxRefundId || '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">支付时间</dt>
            <dd className="mt-0.5 text-xs text-neutral-700">{order.paidAt ? formatDateTime(order.paidAt) : '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">退款完成时间</dt>
            <dd className="mt-0.5 text-xs text-neutral-700">
              {order.refundedAt ? formatDateTime(order.refundedAt) : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">核销关联服务单</dt>
            <dd className="mt-0.5 break-all font-mono text-xs text-neutral-700">
              {order.credit?.consumedServiceOrderId || '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-neutral-500">账号关联与查单失败计数</dt>
            <dd className="mt-0.5 text-xs text-neutral-700">
              {order.hasOpenId ? '已关联微信标识' : '已注销去标识'} · 连续查单失败 {order.queryFailCount} 次
            </dd>
          </div>
          <div className="col-span-2">
            <dt className="text-xs text-neutral-500">退款备注</dt>
            <dd className="mt-0.5 text-xs text-neutral-700">{order.refundReason || '—'}</dd>
          </div>
          <div className="col-span-2">
            <dt className="text-xs text-neutral-500">诊断说明</dt>
            <dd className="mt-0.5 text-xs text-neutral-700" title={order.lastDiagnosticReason ?? undefined}>
              {vpayDiagnosticLabel(order.lastDiagnosticReason)}
            </dd>
          </div>
        </dl>
      </div>
    </div>
  )
}
