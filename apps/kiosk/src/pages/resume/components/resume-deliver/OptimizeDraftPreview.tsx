import type { DraftPreviewItem } from './optimizeOverviewModel'
import '../../resume-optimize-overview-qx.css'

/**
 * 草稿预览展示的就是将要导出的那份优化稿，不另用建议的原文/改写拼一份。
 */
export function OptimizeDraftPreview(props: {
  documentText: string
  items: DraftPreviewItem[]
  notice: string
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
        <p className="qx-opt-final-warn">{props.notice}</p>
        <pre className="qx-opt-final-export" data-testid="resume-optimize-final-export">{props.documentText}</pre>
        <div className="qx-opt-final-list" data-testid="resume-optimize-final-body">
          {props.items.map((item) => (
            <article
              key={item.index}
              className="qx-opt-final-item"
              data-used={item.label}
              data-choice={item.choice}
              data-testid={`resume-optimize-final-item-${item.index + 1}`}
            >
              <div className="qx-opt-final-h">
                <b>{item.title}</b>
                <span className="qx-opt-final-choice">{item.choiceLabel}</span>
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
