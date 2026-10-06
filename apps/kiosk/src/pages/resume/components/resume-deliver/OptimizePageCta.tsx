import type { ReactNode } from 'react'
import type { ResumeExportFormat } from '@ai-job-print/shared'
import { QxAiHelp, QxStepActions } from '../../../../components/qingxu/QxAiHelp'
import { SOURCE_MISSING_REASON } from './optimizeSourceFile'

function formatLabel(format: ResumeExportFormat): string {
  if (format === 'pdf') return 'PDF'
  if (format === 'docx') return 'Word'
  if (format === 'md') return 'Markdown'
  return 'TXT'
}

/** 总览底栏三颗：看上传原件、草稿预览、逐条处理。编辑区仍是返回总览和确认导出。 */
export function OptimizePageCta(props: {
  assistant: ReactNode
  showOverview: boolean
  editorOpen: boolean
  moduleCount: number
  sourceReady: boolean
  exporting: boolean
  exportFormat: ResumeExportFormat
  exportBlocked: boolean
  titleBlocked: boolean
  onReport: () => void
  onSource: () => void
  onFinal: () => void
  onCompare: () => void
  onOverview: () => void
  onExport: () => void
}) {
  return (
    <>
      <QxStepActions onPrev={props.onReport} prevLabel="返回报告">{props.assistant}</QxStepActions>
      {props.editorOpen && props.showOverview && (
        <div className="qx-opt-cta">
          {!props.sourceReady && <p className="qx-opt-source-reason" id="resume-optimize-source-reason" data-testid="resume-optimize-source-reason">{SOURCE_MISSING_REASON}</p>}
          <button type="button" className="qx-btn" data-variant="ghost" data-testid="resume-optimize-source-open" disabled={!props.sourceReady} aria-describedby={props.sourceReady ? undefined : 'resume-optimize-source-reason'} onClick={props.onSource}>看上传原件</button>
          <button type="button" className="qx-btn" data-variant="ghost" data-testid="resume-optimize-final-open" onClick={props.onFinal}>草稿预览</button>
          <button type="button" className="qx-btn" data-variant="primary" data-testid="resume-optimize-primary" onClick={props.onCompare}>
            逐条处理这 {props.moduleCount} 条<em aria-hidden="true">→</em>
          </button>
        </div>
      )}
      {props.editorOpen && !props.showOverview && (
        <div className="qx-opt-cta">
          {props.moduleCount > 0 && (
            <button type="button" className="qx-btn" data-variant="ghost" onClick={props.onOverview}>返回建议总览</button>
          )}
          {/* 导出的就是编辑区里的这一份：亲手改过的段落以编辑区为准。 */}
          <button type="button" className="qx-btn" data-variant="primary" aria-disabled={props.exportBlocked || props.titleBlocked || undefined} onClick={props.onExport}>
            {props.exporting ? '正在生成文件…' : `确认优化版，导出 ${formatLabel(props.exportFormat)}`}
          </button>
        </div>
      )}
    </>
  )
}
