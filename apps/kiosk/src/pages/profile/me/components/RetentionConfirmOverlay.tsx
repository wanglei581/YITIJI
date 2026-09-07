import type { FileRetentionUpdateRequest } from '@ai-job-print/shared'

type SelectableRetentionPolicy = FileRetentionUpdateRequest['retentionPolicy']

const POLICY_LABELS: Record<SelectableRetentionPolicy, string> = {
  months_3: '保存 3 个月',
  months_6: '保存 6 个月',
  long_term: '长期保存',
}

function retentionConfirmText(policy: SelectableRetentionPolicy): string {
  return policy === 'long_term'
    ? '长期保存会持续保留该成果物，便于后续查看、下载和打印；你可以随时改回较短期限或删除。'
    : '保存 6 个月会延长该文件在账号内的保留时间；你可以随时改回 3 个月或删除。'
}

export function RetentionConfirmOverlay({
  policy,
  onConfirm,
  onCancel,
  busy,
}: {
  policy: SelectableRetentionPolicy
  onConfirm: () => void
  onCancel: () => void
  busy: boolean
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="retention-confirm-title"
        aria-describedby="retention-confirm-desc"
        className="me-dialog me-retention-dialog w-[23rem] max-w-full p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <p id="retention-confirm-title" className="text-base font-semibold text-[color:var(--ink)]">
          确认{POLICY_LABELS[policy]}
        </p>
        <p id="retention-confirm-desc" className="mt-2 text-sm leading-relaxed text-[color:var(--ink-2)]">
          {retentionConfirmText(policy)}点击“同意并保存”即表示你已知悉文件保存期限说明。
        </p>
        <div className="mt-5 flex gap-3">
          <button type="button" onClick={onCancel} className="me-ripple me-dialog-button">
            取消
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onConfirm}
            className={['me-ripple me-dialog-button primary', busy ? 'is-disabled' : ''].join(' ')}
          >
            {busy ? '保存中' : '同意并保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
