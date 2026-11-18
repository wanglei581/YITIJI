import { useState } from 'react'
import { adminOrdersReadonlyService } from '../../services/api/adminOrdersReadonly'
import { userMessageOf } from '../../services/api/userErrorMessage'
import type { OrderDetailControls } from './useOrderDetail'
import { amountText, autoRefundStatusText, orderPaperReleased, payStatusPresentation } from './orderDisplay'

export function PrintReturnHoldActions({ controls }: { controls: OrderDetailControls }) {
  const { detail, openDetail, refresh } = controls
  const [pending, setPending] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  const [verifiedOpen, setVerifiedOpen] = useState(false)
  if (!detail || detail.recordKind === 'service') return null

  const hold = (detail.printRefundDisposition === 'manual' || detail.printRefundDisposition === 'auto_failed')
    && Boolean(detail.refundLedgerNo)
  const paperOut = orderPaperReleased(detail)
  const verified = detail.payStatus === 'paid'
    && paperOut
    && detail.refundStatus !== 'pending'
    && detail.refundStatus !== 'success'

  const run = async (action: 'confirm-refunded' | 'release-paper' | 'close') => {
    setPending(action)
    setError(null)
    setNote(null)
    try {
      const result = await adminOrdersReadonlyService.resolvePrintReturnHold(detail.id, action)
      setNote(`已处理。支付状态 ${payStatusPresentation(result.payStatus).label}，退款状态 ${autoRefundStatusText(result.refundStatus)}。金额 ${amountText(result.amountCents, detail.currency)}。`)
      void refresh()
      await openDetail(detail.id)
    } catch (err) {
      setError(userMessageOf(err, '这一步没有完成，请看上面的状态后再试'))
    } finally {
      setPending(null)
    }
  }

  const submitVerified = async () => {
    if (!reason.trim()) return
    setPending('verified')
    setError(null)
    try {
      await adminOrdersReadonlyService.refundAfterPaperCheck(detail.id, reason.trim())
      setVerifiedOpen(false)
      setReason('')
      setNote('已按核对后的路径发起退款。请看本页现在的支付状态。')
      void refresh()
      await openDetail(detail.id)
    } catch (err) {
      setError(userMessageOf(err, '核对后的退款没有完成，请稍后重试'))
    } finally {
      setPending(null)
    }
  }

  if (!hold && !verified) return note || error ? <p className="mt-4 text-xs text-neutral-600">{error ?? note}</p> : null

  return (
    <div className="mt-6 space-y-3 rounded-[9px] border border-warning/30 bg-warning-bg px-4 py-3.5">
      {hold ? (
        <>
          <p className="text-[13px] font-bold text-neutral-800">待人工处理</p>
          <p className="text-xs leading-relaxed text-neutral-600">
            退款单 {detail.refundLedgerNo}，金额 {amountText(detail.refundLedgerCents ?? 0, detail.currency)}。
            三选一：确认已经退成、改为出纸，或关闭这张单。做完只剩一种状态。
          </p>
          <div className="flex flex-wrap gap-2">
            {paperOut ? (
              <p className="text-xs text-neutral-600">纸已经出去，不能关单。确认退成也不能用，请走核对后仍退款。</p>
            ) : (
              <>
                <button type="button" disabled={pending !== null} onClick={() => void run('confirm-refunded')} className="inline-flex h-9 items-center rounded-[9px] bg-warning px-4 text-[13px] font-bold text-white disabled:opacity-40">
                  {pending === 'confirm-refunded' ? '处理中…' : `确认退成 ${amountText(detail.refundLedgerCents ?? 0, detail.currency)}`}
                </button>
                <button type="button" disabled={pending !== null} onClick={() => void run('release-paper')} className="inline-flex h-9 items-center rounded-[9px] border border-neutral-900/10 bg-surface px-4 text-[13px] font-bold text-neutral-800 disabled:opacity-40">
                  {pending === 'release-paper' ? '处理中…' : '确认改为出纸'}
                </button>
                <button type="button" disabled={pending !== null} onClick={() => void run('close')} className="inline-flex h-9 items-center rounded-[9px] border border-neutral-900/10 bg-surface px-4 text-[13px] font-bold text-neutral-800 disabled:opacity-40">
                  {pending === 'close' ? '处理中…' : '确认关单'}
                </button>
              </>
            )}
          </div>
          {paperOut ? null : (
            <p className="text-xs text-neutral-500">
              改为出纸和关单都不会把这笔钱记成已退回。关单后纸也不会再出。
              {detail.refundStatus === 'pending' ? '渠道还在处理时，改为出纸会先查渠道。没有查到失败就不会放行。' : ''}
            </p>
          )}
        </>
      ) : null}
      {verified ? (
        <div className="space-y-2">
          <p className="text-[13px] font-bold text-neutral-800">核对后仍退款，纸可能已经出去</p>
          {!verifiedOpen ? (
            <button type="button" onClick={() => { setVerifiedOpen(true); setError(null) }} className="inline-flex h-9 items-center rounded-[9px] bg-warning px-4 text-[13px] font-bold text-white">
              核对后仍退款
            </button>
          ) : (
            <>
              <textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="请填写核对说明（必填）" rows={2} maxLength={500} className="w-full resize-none rounded-[9px] border border-neutral-900/10 bg-surface px-3 py-2 text-[13px]" />
              <div className="flex gap-2">
                <button type="button" disabled={!reason.trim() || pending !== null} onClick={() => void submitVerified()} className="inline-flex h-9 items-center rounded-[9px] bg-error px-4 text-[13px] font-bold text-white disabled:opacity-40">
                  {pending === 'verified' ? '处理中…' : `确认退回 ${amountText(detail.payableCents, detail.currency)}`}
                </button>
                <button type="button" disabled={pending !== null} onClick={() => { setVerifiedOpen(false); setReason('') }} className="inline-flex h-9 items-center rounded-[9px] border border-neutral-900/10 bg-surface px-4 text-[13px] font-bold text-neutral-700">
                  取消
                </button>
              </div>
            </>
          )}
        </div>
      ) : null}
      {error ? <p className="text-xs font-semibold text-error-fg">{error}</p> : null}
      {note ? <p className="text-xs font-semibold text-neutral-700">{note}</p> : null}
    </div>
  )
}
