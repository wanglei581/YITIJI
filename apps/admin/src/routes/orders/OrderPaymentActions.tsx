import type { OrderDetailControls } from './useOrderDetail'
import { PAY_STATUS_MAP, MARK_PAID_SOURCES, markPaidSourceLabel, amountText, fmt } from './orderDisplay'

export function OrderPaymentActions({ controls }: { controls: OrderDetailControls }) {
  const { detail, markPaidResult, setMarkPaidResult, markPaidOpen, setMarkPaidOpen, markPaidSource, setMarkPaidSource, markPaidError, setMarkPaidError, markPaidSubmitting, handleMarkPaid, refundOpen, setRefundOpen, refundReason, setRefundReason, refundError, setRefundError, refundSubmitting, handleRefund } = controls
  if (!detail) return null
  return (<>
            {/*
              收款入账结果：与下方入口**分开渲染**。入账成功后 payStatus 变为 paid、入口随即消失，
              若把结论放在入口内部，成功/失败提示会一起消失变成静默。
            */}
            {markPaidResult && (
              <div className="mt-6 rounded-[9px] border border-success/30 bg-success-bg px-4 py-3 text-[12.5px] leading-relaxed text-success-fg">
                <p className="font-extrabold">收款已入账（服务端确认）</p>
                <p className="mt-1">
                  支付状态 {PAY_STATUS_MAP[markPaidResult.payStatus]?.label ?? markPaidResult.payStatus}
                  {' · '}来源 {markPaidSourceLabel(markPaidResult.paymentSource)}
                  {' · '}入账时间 {fmt(markPaidResult.paidAt)}
                </p>
              </div>
            )}
            {markPaidError && (
              <div className="mt-6 rounded-[9px] border border-error/30 bg-error-bg px-4 py-3 text-[12.5px] leading-relaxed text-error-fg">
                <p className="font-extrabold">收款未入账</p>
                <p className="mt-1">{markPaidError}</p>
                <p className="mt-1">订单支付状态以上方「支付状态」为准；如现场已收钱，请核对后重试或人工处理。</p>
              </div>
            )}

            {/*
              线下 / 人工确认收款入口：对应 POST /admin/orders/:id/mark-paid（admin 角色）。
              后端只允许 unpaid → paid，因此入口只在服务端返回的 payStatus 为 unpaid 时出现；
              已支付 / 已退款 / 支付失败等状态下不渲染，避免给出后端必然拒绝的按钮。
            */}
            {detail.payStatus === 'unpaid' && (
              <div className="mt-6 rounded-[9px] border border-warning/30 bg-warning-bg px-4 py-3.5">
                {!markPaidOpen ? (
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[13px] font-bold text-neutral-800">确认线下收款</p>
                      <p className="mt-0.5 text-xs text-neutral-500">
                        订单尚未入账。仅当线下已实际收到该笔款项时才可确认；确认后订单转为已支付并写入审计日志，不可撤销
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setMarkPaidOpen(true); setMarkPaidError(null); setMarkPaidResult(null) }}
                      className="ml-4 inline-flex h-9 shrink-0 items-center rounded-[9px] bg-warning px-4 text-[13px] font-bold text-white transition-colors hover:bg-warning/90"
                    >
                      确认收款
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {/* 文案随所选来源变化：选了「人工确认（非现场现金）」却让管理员签署
                        「已收到现金」，是逼他为一件没发生的事背书。两种来源的事实不同，
                        确认语就必须不同。 */}
                    <p className="text-[13px] font-bold text-neutral-800">
                      {markPaidSource === 'manual_confirmed' ? '确认该笔款项已另行核实到账？' : '确认已在线下收到现金？'}
                    </p>
                    <p className="text-xs leading-relaxed text-neutral-600">
                      本单应收 <span className="font-bold text-neutral-900">{amountText(detail.amountCents, detail.currency)}</span>。
                      点击确认即表示
                      <span className="font-bold text-neutral-900">
                        {markPaidSource === 'manual_confirmed'
                          ? '你已通过其它渠道核实该笔款项确已到账'
                          : '现场已实际收到该笔现金'}
                      </span>
                      ，系统随即把订单支付状态置为已支付并写入审计日志。操作不可撤销，如需退回只能另行发起全额退款。
                    </p>
                    <fieldset className="space-y-1.5">
                      <legend className="text-xs font-bold text-neutral-700">收款方式</legend>
                      {MARK_PAID_SOURCES.map((source) => (
                        <label
                          key={source.value}
                          className="flex cursor-pointer items-start gap-2 rounded-[9px] border border-neutral-900/10 bg-surface px-3 py-2"
                        >
                          <input
                            type="radio"
                            name="mark-paid-source"
                            value={source.value}
                            checked={markPaidSource === source.value}
                            disabled={markPaidSubmitting}
                            onChange={() => setMarkPaidSource(source.value)}
                            className="mt-0.5"
                          />
                          <span>
                            <span className="block text-[13px] font-bold text-neutral-800">{source.label}</span>
                            <span className="block text-xs text-neutral-500">{source.hint}</span>
                          </span>
                        </label>
                      ))}
                    </fieldset>
                    {markPaidError && (
                      <p className="text-xs font-semibold text-error-fg">{markPaidError}</p>
                    )}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={markPaidSubmitting}
                        onClick={() => void handleMarkPaid()}
                        className="inline-flex h-9 items-center rounded-[9px] bg-warning px-4 text-[13px] font-bold text-white transition-colors hover:bg-warning/90 disabled:opacity-40"
                      >
                        {markPaidSubmitting
                          ? '处理中…'
                          : markPaidSource === 'manual_confirmed' ? '确认已核实到账' : '确认已收到现金'}
                      </button>
                      <button
                        type="button"
                        disabled={markPaidSubmitting}
                        onClick={() => { setMarkPaidOpen(false); setMarkPaidError(null) }}
                        className="inline-flex h-9 items-center rounded-[9px] border border-neutral-900/10 bg-surface px-4 text-[13px] font-bold text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-40"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/*
              Gate 0.3B / API-20 售后退款入口：资格由服务端只读派生，执行仍复用
              canonical RefundService（POST /admin/orders/:id/refund）。
              待退款信号单走同一入口，文案改成「发起退款」并二次确认；不点确认不会发。
            */}
            {detail.refundEligible && (
              <div className="mt-6 rounded-[9px] border border-warning/30 bg-warning-bg px-4 py-3.5">
                {!refundOpen ? (
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[13px] font-bold text-neutral-800">
                        {detail.refundRequired ? '发起退款' : '发起全额退款'}
                      </p>
                      <p className="mt-0.5 text-xs text-neutral-500">
                        {detail.refundRequired
                          ? `${detail.refundReason === 'ONLINE_PAID_PENDING_REFUND' ? '渠道已收款但订单未转已支付' : '已付款未出纸'}。系统不会自动出款；只有管理员点确认后才会向支付渠道发起。金额以本页服务端金额为准。`
                          : `退款 ${amountText(detail.amountCents, detail.currency)}，操作不可撤销，仅管理员可执行`}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setRefundOpen(true); setRefundError(null) }}
                      className="ml-4 inline-flex h-9 shrink-0 items-center rounded-[9px] bg-warning px-4 text-[13px] font-bold text-white transition-colors hover:bg-warning/90"
                    >
                      {detail.refundRequired ? '发起退款' : '退款'}
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    <p className="text-[13px] font-bold text-neutral-800">
                      {detail.refundRequired
                        ? '确认向支付渠道发起退款？这是对外资金动作，点确认后才会出款。'
                        : '确认全额退款'}
                    </p>
                    <textarea
                      value={refundReason}
                      onChange={(e) => setRefundReason(e.target.value)}
                      placeholder="请填写退款原因（必填）"
                      rows={3}
                      maxLength={500}
                      className="w-full resize-none rounded-[9px] border border-neutral-900/10 bg-surface px-3 py-2 text-[13px] text-neutral-900 outline-none placeholder:text-neutral-400 focus:border-primary-600/50"
                    />
                    {refundError && (
                      <p className="text-xs font-semibold text-error-fg">{refundError}</p>
                    )}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={!refundReason.trim() || refundSubmitting}
                        onClick={() => void handleRefund()}
                        className="inline-flex h-9 items-center rounded-[9px] bg-error px-4 text-[13px] font-bold text-white transition-colors hover:bg-error/90 disabled:opacity-40"
                      >
                        {refundSubmitting
                          ? '处理中…'
                          : detail.refundRequired ? '确认发起退款' : '确认退款'}
                      </button>
                      <button
                        type="button"
                        disabled={refundSubmitting}
                        onClick={() => { setRefundOpen(false); setRefundReason(''); setRefundError(null) }}
                        className="inline-flex h-9 items-center rounded-[9px] border border-neutral-900/10 bg-surface px-4 text-[13px] font-bold text-neutral-700 transition-colors hover:bg-neutral-50 disabled:opacity-40"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
  </>)
}
