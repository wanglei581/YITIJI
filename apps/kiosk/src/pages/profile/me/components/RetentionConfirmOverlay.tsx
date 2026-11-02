import type { FileRetentionUpdateRequest } from '@ai-job-print/shared'
import { QxTouchOverlay } from '../../../../components/qingxu/touch/QxTouchOverlay'

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

/** 改保存期限前的确认。放在触屏壳的弹层里（QxMePage 的 overlay），不再用页面里的固定定位层。 */
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
    <QxTouchOverlay
      kind="dialog"
      title={`确认${POLICY_LABELS[policy]}`}
      onClose={onCancel}
      actions={(
        <>
          <button type="button" className="qxt-btn qxt-btn-sec" onClick={onCancel}>取消</button>
          <button type="button" className="qxt-btn qxt-btn-pri" disabled={busy} onClick={onConfirm}>
            {busy ? '保存中' : '同意并保存'}
          </button>
        </>
      )}
    >
      <p>{retentionConfirmText(policy)}点击“同意并保存”即表示你已知悉文件保存期限说明。</p>
    </QxTouchOverlay>
  )
}
