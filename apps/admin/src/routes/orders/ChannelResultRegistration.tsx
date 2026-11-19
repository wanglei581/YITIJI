import { useState } from 'react'
import { adminOrdersReadonlyService, type AdminOrderReadonlyDetail } from '../../services/api/adminOrdersReadonly'
import type { ChannelResultRegistrationOutcome } from '../../services/api/adminOrdersRegistration'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { amountText } from './orderDisplay'

type RegistrationResult = 'refunded' | 'not_refunded'

/**
 * 长期查不到渠道结果时的出路：按商户平台核实结果登记。
 * 只在服务端给出可登记的那一笔时出现（渠道不支持在线查询，或提交渠道满 24 小时还没有答复）。
 * 必须重输订单号确认；「渠道已退成」必填渠道退款单号，「渠道确认没退出去」必填核实说明。
 */
export function ChannelResultRegistration({
  detail,
  onDone,
}: {
  detail: AdminOrderReadonlyDetail
  onDone: (outcome: ChannelResultRegistrationOutcome) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState<RegistrationResult | null>(null)
  const [channelRefundNo, setChannelRefundNo] = useState('')
  const [note, setNote] = useState('')
  const [orderNo, setOrderNo] = useState('')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const entry = detail.channelResultRegistration
  if (!entry) return null

  const filled = result === 'refunded' ? channelRefundNo.trim().length > 0 : result === 'not_refunded' && note.trim().length >= 4
  const ready = filled && orderNo.trim() === detail.orderNo && !pending

  const submit = async () => {
    if (!ready || !result) return
    setPending(true)
    setError(null)
    try {
      const outcome = await adminOrdersReadonlyService.registerChannelResult(detail.id, {
        refundNo: entry.refundNo,
        result,
        ...(result === 'refunded' ? { channelRefundNo: channelRefundNo.trim() } : { note: note.trim() }),
        confirmOrderNo: orderNo.trim(),
      })
      await onDone(outcome)
    } catch (err) {
      setError(userMessageOf(err, '没有登记成，请看上面的状态后再试'))
    } finally {
      setPending(false)
    }
  }

  const choice = (value: RegistrationResult, label: string) => (
    <button
      type="button"
      aria-pressed={result === value}
      onClick={() => { setResult(value); setError(null) }}
      className={`inline-flex h-9 items-center rounded-[9px] border px-4 text-[13px] font-bold ${result === value ? 'border-warning bg-warning text-white' : 'border-neutral-900/10 bg-surface text-neutral-800'}`}
    >
      {label}
    </button>
  )

  return (
    <div className="space-y-2 border-t border-warning/20 pt-3">
      <p className="text-[13px] font-bold text-neutral-800">长期查不到渠道结果</p>
      <p className="text-xs leading-relaxed text-neutral-600">
        退款单 {entry.refundNo}，金额 {amountText(entry.amountCents, detail.currency)}。渠道不支持在线查询，或提交渠道已满 24 小时还没有答复。
        先在商户平台核实这笔退款，再按核实结果登记。登记前会再问一次渠道，渠道有明确答复就按渠道答复记。
      </p>
      {!open ? (
        <button type="button" onClick={() => { setOpen(true); setError(null) }} className="inline-flex h-9 items-center rounded-[9px] border border-neutral-900/10 bg-surface px-4 text-[13px] font-bold text-neutral-800">
          按商户平台核实结果登记
        </button>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            {choice('refunded', '渠道已退成')}
            {choice('not_refunded', '渠道确认没退出去')}
          </div>
          {result === 'refunded' ? (
            <input value={channelRefundNo} onChange={(event) => setChannelRefundNo(event.target.value)} maxLength={64} placeholder="渠道退款单号（必填，照商户平台填）" aria-label="渠道退款单号" className="h-9 w-full rounded-[9px] border border-neutral-900/10 bg-surface px-3 text-[13px]" />
          ) : null}
          {result === 'not_refunded' ? (
            <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={200} rows={2} placeholder="核实说明（必填，4 到 200 字，例如在商户平台查到的情况）" aria-label="核实说明" className="w-full resize-none rounded-[9px] border border-neutral-900/10 bg-surface px-3 py-2 text-[13px]" />
          ) : null}
          <input value={orderNo} onChange={(event) => setOrderNo(event.target.value)} maxLength={64} placeholder={`重输订单号确认：${detail.orderNo}`} aria-label="重输订单号确认" className="h-9 w-full rounded-[9px] border border-neutral-900/10 bg-surface px-3 text-[13px]" />
          <div className="flex gap-2">
            <button type="button" disabled={!ready} onClick={() => void submit()} className="inline-flex h-9 items-center rounded-[9px] bg-warning px-4 text-[13px] font-bold text-white disabled:opacity-40">
              {pending ? '处理中…' : '确认登记'}
            </button>
            <button type="button" disabled={pending} onClick={() => { setOpen(false); setResult(null); setChannelRefundNo(''); setNote(''); setOrderNo('') }} className="inline-flex h-9 items-center rounded-[9px] border border-neutral-900/10 bg-surface px-4 text-[13px] font-bold text-neutral-700">
              取消
            </button>
          </div>
        </div>
      )}
      {error ? <p className="text-xs font-semibold text-error-fg">{error}</p> : null}
    </div>
  )
}
