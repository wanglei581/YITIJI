import { useState } from 'react'
import { Button } from '@ai-job-print/ui'
import type { PartnerPolicyRecord } from '../../services/api/policies'

/** 待审核政策的拒绝。原因必填，空着不能提交。 */
export function PolicyRejectDialog({
  row,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  row: PartnerPolicyRecord
  busy: boolean
  error: string | null
  onClose: () => void
  onConfirm: (reason: string) => void
}) {
  const [reason, setReason] = useState('')
  const trimmed = reason.trim()
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal="true" aria-labelledby="policy-reject-title">
      <div className="w-full max-w-md rounded-xl bg-surface p-6 shadow-xl">
        <h2 id="policy-reject-title" className="text-base font-semibold text-neutral-900">拒绝这条政策</h2>
        <p className="mt-2 text-sm leading-relaxed text-neutral-600">「{row.title}」拒绝后，机构改完可以重新提审。</p>
        <label className="mt-4 block text-xs font-medium text-neutral-600">
          拒绝原因
          <textarea
            value={reason}
            maxLength={500}
            onChange={(event) => setReason(event.target.value)}
            className="mt-1 h-24 w-full resize-none rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-800 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500"
          />
        </label>
        {error && <p role="alert" className="mt-2 text-xs text-error-fg">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={onClose} disabled={busy}>取消</Button>
          <Button size="sm" variant="danger" onClick={() => onConfirm(trimmed)} disabled={busy || trimmed.length === 0}>
            {busy ? '处理中…' : '确认拒绝'}
          </Button>
        </div>
      </div>
    </div>
  )
}
