interface AnonymousJobFitConsentDialogProps {
  busy: boolean
  error: string | null
  onCancel: () => void
  onConfirm: () => void
}

/** 匿名用户在服务端 fail-closed 后自行决定是否允许一次岗位匹配分析。 */
export function AnonymousJobFitConsentDialog({
  busy,
  error,
  onCancel,
  onConfirm,
}: AnonymousJobFitConsentDialogProps) {
  return (
    <div className="jfq-modal" role="dialog" aria-modal="true" aria-labelledby="job-fit-anonymous-consent-title">
      <div className="jfq-modal-card">
        <h2 id="job-fit-anonymous-consent-title">确认岗位匹配授权</h2>
        <p>本次岗位匹配参考会使用本次简历诊断内容，帮助你准备简历和投递材料。</p>
        <p>分析结果和授权状态按简历诊断到期策略保存；你可随时撤回后续分析授权。</p>
        <p>分析结果仅供本人参考，不代表任何招聘结果，也不会向企业共享简历。</p>
        {error && <p className="jfq-alert" aria-live="polite">{error}</p>}
        <div className="jfq-modal-actions">
          <button type="button" className="qx-btn" data-variant="ghost" disabled={busy} onClick={onCancel}>
            暂不授权
          </button>
          <button type="button" className="qx-btn" data-variant="primary" disabled={busy} onClick={onConfirm}>
            {busy ? '授权并分析中…' : '同意并继续'}
          </button>
        </div>
      </div>
    </div>
  )
}
