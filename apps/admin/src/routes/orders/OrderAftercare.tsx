import type { OrderDetailControls } from './useOrderDetail'

export function OrderAftercare({ controls }: { controls: OrderDetailControls }) {
  const { detail, verifyOpen, setVerifyOpen, verifyConfirm, setVerifyConfirm, verifyError, setVerifyError, verifySubmitting, handleVerifyOutcome, abandonConfirmOpen, setAbandonConfirmOpen, abandonError, setAbandonError, abandonSubmitting, handleAbandon } = controls
  if (!detail) return null
  return (<>
            {detail.aftercareStatus === 'manual_check_required' && (
              <div className="mt-4 rounded-[9px] border border-error/30 bg-error-bg px-4 py-3 text-[12.5px] leading-relaxed text-error-fg">
                <p className="font-extrabold">高风险：打印结果未确认</p>
                <p className="mt-1">
                  系统已禁止重新排队，避免重复出纸。请先核查现场出纸情况，再决定是否使用下方既有入口发起全额退款。
                </p>
                {detail.printTaskId && !verifyOpen && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => { setVerifyOpen('printed'); setVerifyConfirm(''); setVerifyError(null) }}
                      className="inline-flex h-9 items-center rounded-[9px] bg-neutral-800 px-4 text-[13px] font-bold text-white"
                    >
                      已核查·已出纸
                    </button>
                    <button
                      type="button"
                      onClick={() => { setVerifyOpen('not_printed'); setVerifyConfirm(''); setVerifyError(null) }}
                      className="inline-flex h-9 items-center rounded-[9px] border border-neutral-900/10 bg-surface px-4 text-[13px] font-bold text-neutral-700"
                    >
                      已核查·未出纸
                    </button>
                  </div>
                )}
                {verifyOpen && (
                  <div className="mt-3 space-y-2">
                    <p className="text-xs">
                      输入确认短语{' '}
                      <span className="font-mono font-semibold">
                        {verifyOpen === 'printed' ? 'VERIFY_PRINTED' : 'VERIFY_NOT_PRINTED'}
                      </span>
                    </p>
                    <input
                      value={verifyConfirm}
                      onChange={(e) => setVerifyConfirm(e.target.value)}
                      className="w-full rounded-[9px] border border-neutral-900/10 bg-surface px-3 py-2 text-[13px] text-neutral-900"
                    />
                    {verifyError && <p className="text-xs font-semibold text-error-fg">{verifyError}</p>}
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={!verifyConfirm.trim() || verifySubmitting}
                        onClick={() => void handleVerifyOutcome()}
                        className="inline-flex h-9 items-center rounded-[9px] bg-neutral-800 px-4 text-[13px] font-bold text-white disabled:opacity-40"
                      >
                        {verifySubmitting ? '处理中…' : '确认核查'}
                      </button>
                      <button
                        type="button"
                        disabled={verifySubmitting}
                        onClick={() => { setVerifyOpen(null); setVerifyConfirm(''); setVerifyError(null) }}
                        className="inline-flex h-9 items-center rounded-[9px] border border-neutral-900/10 bg-surface px-4 text-[13px] font-bold text-neutral-700 disabled:opacity-40"
                      >
                        取消
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
            {detail.printOutcome === 'printed' && (
              <div className="mt-4 rounded-[9px] border border-neutral-900/10 bg-neutral-50 px-4 py-3 text-[12.5px] text-neutral-700">
                已核查：现场确认已出纸。不可退款、不可重新排队。
              </div>
            )}
            {detail.printOutcome === 'not_printed' && (
              <div className="mt-4 rounded-[9px] border border-neutral-900/10 bg-neutral-50 px-4 py-3 text-[12.5px] text-neutral-700">
                已核查：现场确认未出纸。
                {detail.refundRequired
                  ? '系统已标记待退款，不会自动出款；请走下方全额退款。'
                  : '可走下方全额退款。'}
                不可重新排队。
              </div>
            )}
            {detail.refundRequired && detail.printOutcome !== 'not_printed' && (
              <div className="mt-4 rounded-[9px] border border-warning/30 bg-warning-bg px-4 py-3 text-[12.5px] leading-relaxed text-warning-fg">
                {/* 渠道已收款那一类订单的 payStatus 是 closed/unpaid/paying，不是 paid；
                    统一写「已付款」会在管理端摆一个与支付状态相反的结论。 */}
                <p className="font-extrabold">
                  {detail.refundReason === 'ONLINE_PAID_PENDING_REFUND'
                    ? '待退款：渠道已收款，订单未转已支付'
                    : '待退款：已付款但未出纸'}
                </p>
                <p className="mt-1">
                  {detail.refundReason === 'ONLINE_PAID_PENDING_REFUND'
                    ? '取件窗口已关，系统未把该单转为已支付、未发放取件码。'
                    : ''}
                  金额以本页服务端金额为准。系统不会自动出款，请走下方全额退款。
                </p>
              </div>
            )}

            {/* 废弃孤单操作区：仅 taskStatus===pending（未被 Agent 领取的历史孤单）显示 */}
            {detail.taskStatus === 'pending' && detail.printTaskId && (
              <div className="mt-6 rounded-[9px] border border-neutral-900/10 bg-neutral-50 px-4 py-3.5">
                {!abandonConfirmOpen ? (
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-[13px] font-bold text-neutral-800">处置历史孤单</p>
                      <p className="mt-0.5 text-xs text-neutral-500">
                        该任务尚未被终端领取，可由管理员受控废弃。操作不可撤销。
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => { setAbandonConfirmOpen(true); setAbandonError(null) }}
                      className="ml-4 inline-flex h-9 shrink-0 items-center rounded-[9px] border border-neutral-900/10 bg-surface px-4 text-[13px] font-bold text-neutral-700 transition-colors hover:bg-neutral-100"
                    >
                      废弃
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    <p className="text-[13px] font-bold text-neutral-800">确认废弃此打印孤单？</p>
                    <p className="text-xs text-neutral-500">
                      打印任务将标记为 <span className="font-mono font-semibold text-neutral-700">已废弃</span>，写入审计日志，操作不可撤销。
                      若订单已付款且有实收，系统会标记待退款（不会自动出款），请到本页发起退款。
                    </p>
                    {abandonError && (
                      <p className="text-xs font-semibold text-error-fg">{abandonError}</p>
                    )}
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        disabled={abandonSubmitting}
                        onClick={() => void handleAbandon()}
                        className="inline-flex h-9 items-center rounded-[9px] bg-neutral-800 px-4 text-[13px] font-bold text-white transition-colors hover:bg-neutral-700 disabled:opacity-40"
                      >
                        {abandonSubmitting ? '处理中…' : '确认废弃'}
                      </button>
                      <button
                        type="button"
                        disabled={abandonSubmitting}
                        onClick={() => { setAbandonConfirmOpen(false); setAbandonError(null) }}
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
