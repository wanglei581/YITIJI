import type { DraftPreviewItem } from './optimizeOverviewModel'

/**
 * 草稿预览：把每条当前选择拼成将要导出的那一版。
 * 待定的句子就是稿里的改写，不是原文。自己写不会出现在这里。
 */
export function OptimizeDraftPreview(props: {
  items: DraftPreviewItem[]
  onClose: () => void
  onEdit: () => void
}) {
  return (
    <div className="qx-rd-overlay" data-testid="resume-optimize-final" role="dialog" aria-modal="true" aria-label="草稿预览">
      <div className="qx-opt-layer">
        <div className="qx-opt-layer-h">
          <h2>草稿预览</h2>
          <button type="button" className="qx-btn" data-variant="ghost" data-testid="resume-optimize-final-close" onClick={props.onClose}>
            关闭
          </button>
        </div>
        <p className="qx-opt-final-warn">
          这是按你现在的选择拼出来的、将要导出的那一版。选了「用改写」或「保留原文」的，已经写进优化稿。还没点选的，导出仍用稿里的改写。自己写要在编辑区里改，这里不会自动替换。
        </p>
        <div className="qx-opt-final-list" data-testid="resume-optimize-final-body">
          {props.items.map((item) => (
            <article key={item.index} className="qx-opt-final-item" data-used={item.label} data-testid={`resume-optimize-final-item-${item.index + 1}`}>
              <div className="qx-opt-final-h">
                <b>{item.title}</b>
                <span className="chip" data-d={item.label}>{item.label}</span>
              </div>
              {item.text ? <p>{item.text}</p> : null}
              {item.note ? <span className="why">{item.note}</span> : null}
            </article>
          ))}
        </div>
        <div className="qx-opt-final-act">
          <button type="button" className="qx-opt-sbtn" data-testid="resume-optimize-final-save" onClick={props.onEdit}>
            <span>进入优化版编辑</span>
            <small>导出用的就是这一份</small>
          </button>
          <button type="button" className="qx-opt-sbtn" data-variant="ghost" disabled data-testid="resume-optimize-final-print">
            <span>打印这份草稿</span>
            <small>先导出，才有可以打印的文件</small>
          </button>
        </div>
      </div>
    </div>
  )
}
