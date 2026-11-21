import { formatYuan } from '@ai-job-print/shared'
import { useState } from 'react'
import type { VirtualPayOrderItem } from '../../../services/api/adminVirtualPay'
import { VPAY_IOS_REFUND_NOTICE, vpayServiceLabel } from './virtualPayLabels'

interface Props {
  order: VirtualPayOrderItem
  submitting: boolean
  error: string | null
  onCancel: () => void
  onConfirm: (reason: string) => void
}

export function VirtualPayRefundModal({ order, submitting, error, onCancel, onConfirm }: Props) {
  const [checked, setChecked] = useState(false)
  const [reason, setReason] = useState('')

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-label="确认发起小程序虚拟支付原路退款"
    >
      <div className="w-full max-w-lg rounded-xl bg-white p-5 shadow-xl">
        <h3 className="text-base font-bold text-neutral-900">确认发起原路退款</h3>

        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs leading-relaxed text-amber-900">
          <div className="font-semibold">重要渠道限制提醒</div>
          <p className="mt-1">{VPAY_IOS_REFUND_NOTICE}</p>
        </div>

        <dl className="mt-3 space-y-1.5 rounded-lg border border-neutral-200 bg-neutral-50 p-3 text-sm">
          <div className="flex justify-between gap-2">
            <dt className="text-neutral-500">商户订单号</dt>
            <dd className="font-mono text-xs text-neutral-900">{order.outTradeNo}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-neutral-500">购买服务</dt>
            <dd className="text-neutral-900">{vpayServiceLabel(order.serviceKind)}</dd>
          </div>
          <div className="flex justify-between gap-2">
            <dt className="text-neutral-500">原路退回金额</dt>
            <dd className="font-semibold text-neutral-900">{formatYuan(order.priceCents / 100)}</dd>
          </div>
        </dl>

        <div className="mt-3">
          <label className="block text-xs font-medium text-neutral-700" htmlFor="vpay-refund-reason">
            退款备注（选填，最多 200 字，记入审计）
          </label>
          <input
            id="vpay-refund-reason"
            type="text"
            maxLength={200}
            value={reason}
            disabled={submitting}
            onChange={(e) => setReason(e.target.value)}
            placeholder="例如：用户未使用权益申请原路退款"
            className="mt-1 w-full rounded-md border border-neutral-200 px-3 py-2 text-sm"
          />
        </div>

        <label className="mt-3 flex cursor-pointer items-start gap-2 text-xs text-neutral-700">
          <input
            type="checkbox"
            checked={checked}
            disabled={submitting}
            onChange={(e) => setChecked(e.target.checked)}
            className="mt-0.5"
          />
          <span>
            我已核实该订单非 iOS 渠道、对应权益未核销，确认锁定该权益并向微信提交原路退款申请。
          </span>
        </label>

        {error ? (
          <p className="mt-3 rounded-md bg-error-bg px-3 py-2 text-xs text-error-fg" role="alert">
            {error}
          </p>
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            disabled={submitting}
            onClick={onCancel}
            className="rounded-md border border-neutral-200 px-4 py-2 text-xs text-neutral-600 disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            disabled={!checked || submitting}
            onClick={() => onConfirm(reason.trim())}
            className="rounded-md bg-rose-600 px-4 py-2 text-xs font-medium text-white disabled:opacity-50"
          >
            {submitting ? '正在提交…' : '确认发起原路退款'}
          </button>
        </div>
      </div>
    </div>
  )
}
