import { useState } from 'react'
import { amountText } from './orderDisplay'
import { useOrderInvoice } from './useOrderInvoice'

const STATUS_LABEL: Record<string, string> = {
  submitted: '已提交',
  issued: '已开',
  returned: '已退回',
}

const TITLE_LABEL: Record<string, string> = {
  personal: '个人',
  company: '单位',
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-bold text-neutral-500">{label}</p>
      <p className="mt-1 break-words text-sm font-semibold text-neutral-900">{value}</p>
    </div>
  )
}

export function OrderInvoiceSection({
  orderId,
  orderKind,
}: {
  orderId: string
  orderKind: 'print' | 'service'
}) {
  const { view, phase, error, busy, markIssued, returnRequest } = useOrderInvoice(orderId, orderKind)
  const [mode, setMode] = useState<'idle' | 'issue' | 'return'>('idle')
  const [invoiceNo, setInvoiceNo] = useState('')
  const [reason, setReason] = useState('')
  const submitted = view?.status === 'submitted'

  return (
    <section aria-label="开票申请" className="mt-6 rounded-[9px] border border-neutral-900/10 bg-neutral-50 px-4 py-3">
      <h3 className="text-[12.5px] font-extrabold text-neutral-700">开票申请</h3>
      {phase === 'loading' && <p className="mt-2 text-xs text-neutral-500">正在读取开票申请…</p>}
      {phase === 'empty' && !error && <p className="mt-2 text-xs text-neutral-500">没有开票申请</p>}
      {error && <p className="mt-2 text-xs text-error-fg">{error}</p>}
      {phase === 'ready' && view && (
        <>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
            <Field label="抬头类型" value={TITLE_LABEL[view.titleType] ?? view.titleType} />
            <Field label="抬头" value={view.title} />
            <Field label="税号" value={view.taxId?.trim() || '—'} />
            <Field label="邮箱" value={view.email?.trim() || '—'} />
            <Field label="金额" value={amountText(view.amountCents, 'CNY')} />
            <Field label="状态" value={STATUS_LABEL[view.status] ?? view.status} />
            {view.invoiceNo ? <Field label="发票号码" value={view.invoiceNo} /> : null}
            {view.returnReason ? <Field label="退回原因" value={view.returnReason} /> : null}
          </div>
          {submitted && mode === 'idle' && (
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={() => { setMode('issue'); setInvoiceNo(view.invoiceNo ?? '') }}
                className="inline-flex h-9 items-center rounded-[9px] bg-neutral-900 px-4 text-[13px] font-bold text-white disabled:opacity-60"
              >
                标已开
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => { setMode('return'); setReason('') }}
                className="inline-flex h-9 items-center rounded-[9px] border border-neutral-900/15 bg-white px-4 text-[13px] font-bold text-neutral-800 disabled:opacity-60"
              >
                退回
              </button>
            </div>
          )}
          {submitted && mode === 'issue' && (
            <form
              className="mt-3 space-y-2"
              onSubmit={(event) => {
                event.preventDefault()
                // 只在成功后收起；没成（含 409）时钩子已重读申请，表单和刚填的发票号码留着。
                void markIssued(invoiceNo).then((ok) => { if (ok) setMode('idle') })
              }}
            >
              <label className="block text-xs font-bold text-neutral-700">
                发票号码（选填）
                <input
                  name="invoiceNo"
                  value={invoiceNo}
                  maxLength={40}
                  onChange={(event) => setInvoiceNo(event.target.value)}
                  className="mt-1 h-9 w-full rounded-[9px] border border-neutral-900/15 px-3 text-sm"
                />
              </label>
              <div className="flex gap-2">
                <button type="submit" disabled={busy} className="inline-flex h-9 items-center rounded-[9px] bg-neutral-900 px-4 text-[13px] font-bold text-white disabled:opacity-60">确认标已开</button>
                <button type="button" onClick={() => setMode('idle')} className="inline-flex h-9 items-center rounded-[9px] px-4 text-[13px] font-bold text-neutral-600">取消</button>
              </div>
            </form>
          )}
          {submitted && mode === 'return' && (
            <form
              className="mt-3 space-y-2"
              onSubmit={(event) => {
                event.preventDefault()
                if (!reason.trim()) return
                void returnRequest(reason).then((ok) => { if (ok) setMode('idle') })
              }}
            >
              <label className="block text-xs font-bold text-neutral-700">
                退回原因
                <textarea
                  name="returnReason"
                  value={reason}
                  maxLength={200}
                  required
                  onChange={(event) => setReason(event.target.value)}
                  className="mt-1 min-h-16 w-full rounded-[9px] border border-neutral-900/15 px-3 py-2 text-sm"
                />
              </label>
              <div className="flex gap-2">
                <button type="submit" disabled={busy || !reason.trim()} className="inline-flex h-9 items-center rounded-[9px] bg-neutral-900 px-4 text-[13px] font-bold text-white disabled:opacity-60">确认退回</button>
                <button type="button" onClick={() => setMode('idle')} className="inline-flex h-9 items-center rounded-[9px] px-4 text-[13px] font-bold text-neutral-600">取消</button>
              </div>
            </form>
          )}
        </>
      )}
    </section>
  )
}
