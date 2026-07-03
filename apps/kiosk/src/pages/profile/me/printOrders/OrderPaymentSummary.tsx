// ============================================================
// 打印订单详单（支付信息区，C5 P0b）。
//
// 诚实口径：
// - 关联 Order 缺失（payStatus 为 null，历史订单）→ 只显示「暂无支付信息」，
//   不显示金额 0、不推断支付状态。
// - 有 Order → 展示后端真实字段：金额（整数分）、支付状态、支付来源
//   （只可能是 线下收款 / 免费 / 人工确认）、后端识别的计费页数。
// - 取件码仅在后端返回时渲染（门控在服务端）。
// - 「再打一份」本批不做订单侧直连（PrintTask 无可重签文件源），
//   只提供「去我的文档再打印」诚实引导：走我的文档重签 URL → 打印确认，
//   天然创建新 PrintTask + 新 Order，绝不复用旧任务或旧签名链接。
// ============================================================

import { useNavigate } from 'react-router-dom'
import type { MemberPrintOrderItem } from '@ai-job-print/shared'
import { FileTextIcon } from 'lucide-react'
import { BILLING_PAGE_SOURCE_LABEL, formatAmountCents, PAY_STATUS_META, PAYMENT_SOURCE_LABEL } from './paymentCopy'
import { PickupCodePanel } from './PickupCodePanel'

function DetailRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <span className="shrink-0 text-xs text-neutral-500">{label}</span>
      <span className="text-right text-sm font-medium text-neutral-900">
        {value}
        {hint && <span className="ml-1.5 text-xs font-normal text-neutral-400">{hint}</span>}
      </span>
    </div>
  )
}

export function OrderPaymentSummary({ item }: { item: MemberPrintOrderItem }) {
  const navigate = useNavigate()
  const payStatus = item.payStatus ?? null

  return (
    <div className="flex flex-col gap-3 border-t border-neutral-200 pt-3">
      {payStatus === null ? (
        <p className="text-sm text-neutral-500">
          暂无支付信息
          <span className="ml-1.5 text-xs text-neutral-400">（该订单未关联支付记录，如有疑问请联系现场工作人员）</span>
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {typeof item.amountCents === 'number' && <DetailRow label="金额" value={formatAmountCents(item.amountCents)} />}
          <DetailRow
            label="支付状态"
            value={PAY_STATUS_META[payStatus].label}
            hint={item.paymentSource ? PAYMENT_SOURCE_LABEL[item.paymentSource] : undefined}
          />
          {typeof item.billablePages === 'number' && (
            <DetailRow
              label="计费页数"
              value={`${item.billablePages} 页`}
              hint={item.billingPageSource ? BILLING_PAGE_SOURCE_LABEL[item.billingPageSource] : undefined}
            />
          )}
        </div>
      )}

      {item.pickupCode && <PickupCodePanel code={item.pickupCode} />}

      <button
        type="button"
        onClick={() => navigate('/me/documents')}
        className="inline-flex min-h-[48px] items-center justify-center gap-1.5 rounded-xl border border-neutral-200 bg-surface px-4 text-sm font-semibold text-neutral-700 transition-colors hover:bg-neutral-100 focus:outline-none focus:ring-2 focus:ring-primary-300"
      >
        <FileTextIcon className="h-4 w-4" aria-hidden="true" />
        去我的文档再打印
      </button>
      <p className="text-center text-xs text-neutral-400">再打印从「我的文档」重新选择文件发起，将创建新的打印任务与订单</p>
    </div>
  )
}
