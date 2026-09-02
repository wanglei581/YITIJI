// ============================================================
// 打印订单详单（支付信息区，C5 P0b）。
//
// 诚实口径：
// - 关联 Order 缺失（payStatus 为 null，历史订单）→ 只显示「暂无支付信息」，
//   不显示金额 0、不推断支付状态。
// - 有 Order → 展示后端真实字段：金额（整数分）、支付状态、支付来源
//   （只可能是 线下收款 / 免费 / 人工确认）、后端识别的计费页数，
//   以及真实发生过的券/权益抵扣额与已退金额（C5-4 只读字段，三态口径见下方渲染处注释）。
// - 取件码仅在后端返回时渲染（门控在服务端）。
// - 「再打一份」本批不做订单侧直连（PrintTask 无可重签文件源），
//   只提供「去我的文档再打印」诚实引导：走我的文档重签 URL → 打印确认，
//   天然创建新 PrintTask + 新 Order，绝不复用旧任务或旧签名链接。
// ============================================================

import { useNavigate } from 'react-router-dom'
import type { MemberPrintOrderItem } from '@ai-job-print/shared'
import { KIcon } from '../../../../components/kiosk-icon'
import { BILLING_PAGE_SOURCE_LABEL, formatAmountCents, paymentSourceLabel, payStatusMeta } from './paymentCopy'
import { PickupCodePanel } from './PickupCodePanel'

function DetailRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="me-payment-row">
      <span>{label}</span>
      <strong>
        {value}
        {hint && <em>{hint}</em>}
      </strong>
    </div>
  )
}

export function OrderPaymentSummary({ item }: { item: MemberPrintOrderItem }) {
  const navigate = useNavigate()
  const payStatus = item.payStatus ?? null

  return (
    <div className="me-payment-summary">
      {payStatus === null ? (
        <p className="me-payment-empty">
          暂无支付信息
          <span>（该订单未关联支付记录，如有疑问请联系现场工作人员）</span>
        </p>
      ) : (
        <div className="me-payment-grid">
          {typeof item.amountCents === 'number' && <DetailRow label="金额" value={formatAmountCents(item.amountCents)} />}
          <DetailRow
            label="支付状态"
            value={payStatusMeta(payStatus).label}
            hint={item.paymentSource ? paymentSourceLabel(item.paymentSource) : undefined}
          />
          {typeof item.billablePages === 'number' && (
            <DetailRow
              label="计费页数"
              value={`${item.billablePages} 页`}
              hint={item.billingPageSource ? BILLING_PAGE_SOURCE_LABEL[item.billingPageSource] : undefined}
            />
          )}
          {/*
            券/权益核销抵扣额与已退金额（C5-4 只读字段）。三态必须分开，不能塌成同一种显示：

            - null   = 该打印任务没有关联 Order（历史任务），即「不知道」→ 整行不渲染。
                       与 duplex 的 null 同口径：未记录不等于为零。
            - 0      = 有 Order，但字段停在 Prisma 列默认值（schema 两列均 @default(0)，
                       只有核销结算 / 退款路径才会写非零）→ 同样不渲染。
                       判断理由：0 并不能证明「系统查过优惠、结论是不适用」——它与
                       「本单从未走过任何核销/退款逻辑」在数据上完全无法区分，把它显示成
                       一行「优惠 0 元」等于替后端断言了一次并不存在的检查
                       （CLAUDE.md §9 不伪造能力）；而给一笔从没退过款的订单挂一行退款额，
                       只会让用户以为发生过退款，是更贵的噪音。
                       附证：复用的 formatAmountCents 对 0 返回「免费」，那是整单免单口径，
                       套到这两行上本身就读不通，从反面印证 0 不该在这里渲染。
            - > 0    = 真实发生过抵扣 / 退款 → 必须显示，这是钱的事，用户有权看见。

            金额一律复用同页的 formatAmountCents（整数分运算，不做浮点除法），不另写格式化。
          */}
          {typeof item.discountCents === 'number' && item.discountCents > 0 && (
            <DetailRow label="优惠抵扣" value={formatAmountCents(item.discountCents)} hint="券 / 权益核销" />
          )}
          {typeof item.refundedAmountCents === 'number' && item.refundedAmountCents > 0 && (
            <DetailRow label="已退金额" value={formatAmountCents(item.refundedAmountCents)} />
          )}
        </div>
      )}

      {item.pickupCode && <PickupCodePanel code={item.pickupCode} />}

      <button
        type="button"
        onClick={() => navigate('/me/documents')}
        className="me-ripple me-print-document-action"
      >
        <KIcon name="files" />
        去我的文档再打印
      </button>
      <p className="me-print-document-note">再打印从「我的文档」重新选择文件发起，将创建新的打印任务与订单</p>
    </div>
  )
}
