interface AnonymousJobFitConsentCardProps {
  busy: boolean
  onRevoke: () => void
}

/** 授权与撤回同等可达；撤回不伪称会删除既有岗位匹配报告。 */
export function AnonymousJobFitConsentCard({ busy, onRevoke }: AnonymousJobFitConsentCardProps) {
  return (
    <div className="qx-card jfq-consent-card">
      <p>
        你已授权本次匿名简历诊断用于岗位匹配参考。撤回仅影响后续分析，已有报告按诊断到期策略保存。
      </p>
      <button type="button" className="qx-btn" data-variant="ghost" disabled={busy} onClick={onRevoke}>
        {busy ? '撤回中…' : '撤回本次授权'}
      </button>
    </div>
  )
}
