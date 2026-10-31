import { formatClock } from './resumeDecisions'

/**
 * 草稿提示：正在查有没有上次的草稿 / 发现草稿要先选怎么继续。
 * 未登录不存草稿、保存中 / 已保存 / 保存失败不在这里：编辑页用右侧状态行和顶栏胶囊说（见 OptimizeEditView），离开时由「离开前确认」兜住。
 */
export function ResumeDraftBanner(props: {
  loading: boolean
  choicePending: boolean
  draftUpdatedAt?: string | null
  onContinue: () => void
  onRestart: () => void
}) {
  if (props.loading) {
    return <p className="qxt-note" role="status" data-draft-banner="loading">正在查看是否有未完成的编辑…</p>
  }

  if (props.choicePending) {
    const clock = formatClock(props.draftUpdatedAt)
    return (
      <div className="qxt-choice" role="status" data-draft-banner="choice">
        <p>发现上次编辑的草稿{clock ? `（更新于 ${clock}）` : ''}。请先选择如何继续，选择前不打开编辑区，以免覆盖草稿。</p>
        <div className="qxt-choice-acts">
          <button type="button" className="qxt-btn qxt-btn-pri" onClick={props.onContinue}>
            继续上次编辑{clock ? `（更新于 ${clock}）` : ''}
          </button>
          <button type="button" className="qxt-btn qxt-btn-sec" onClick={props.onRestart}>
            从优化结果重新开始
          </button>
        </div>
      </div>
    )
  }

  return null
}
