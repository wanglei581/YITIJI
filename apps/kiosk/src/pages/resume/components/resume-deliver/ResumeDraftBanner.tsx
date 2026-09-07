import { formatClock } from './resumeDecisions'
import type { DraftSaveStatus } from './useResumeDraftAutosave'

export function ResumeDraftBanner(props: {
  guest: boolean
  loading: boolean
  choicePending: boolean
  draftUpdatedAt?: string | null
  onContinue: () => void
  onRestart: () => void
  saveStatus: DraftSaveStatus
  savedAt?: string | null
}) {
  if (props.guest) {
    return (
      <div className="qx-card qx-rd-draft" role="status" data-draft-banner="guest">
        <p>未登录，草稿不会保存。登录后可自动保存草稿与保留多版本。</p>
      </div>
    )
  }

  if (props.loading) {
    return (
      <div className="qx-card qx-rd-draft" role="status" data-draft-banner="loading">
        <p>正在查看是否有未完成的编辑…</p>
      </div>
    )
  }

  if (props.choicePending) {
    const clock = formatClock(props.draftUpdatedAt)
    return (
      <div className="qx-card qx-rd-draft" role="status" data-draft-banner="choice">
        <p>发现上次编辑的草稿{clock ? `（更新于 ${clock}）` : ''}。请先选择如何继续，选择前不打开编辑区，以免覆盖草稿。</p>
        <div className="qx-rd-draft-actions">
          <button type="button" className="qx-btn" data-variant="primary" onClick={props.onContinue}>
            继续上次编辑{clock ? `（更新于 ${clock}）` : ''}
          </button>
          <button type="button" className="qx-btn" data-variant="ghost" onClick={props.onRestart}>
            从优化结果重新开始
          </button>
        </div>
      </div>
    )
  }

  if (props.saveStatus === 'failed') {
    return (
      <p className="qx-rd-draft-status" data-tone="bad" role="status">保存失败，改动仅在当前页面有效，离机将丢失</p>
    )
  }
  if (props.saveStatus === 'saved' && props.savedAt) {
    return (
      <p className="qx-rd-draft-status" role="status">草稿已保存 {formatClock(props.savedAt, true)}</p>
    )
  }
  if (props.saveStatus === 'saving') {
    return <p className="qx-rd-draft-status" role="status">正在保存草稿…</p>
  }
  return null
}
