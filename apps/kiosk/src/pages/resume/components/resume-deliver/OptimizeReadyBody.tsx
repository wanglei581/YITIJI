import { COMPLIANCE_COPY } from '@ai-job-print/shared'
import type { GeneratedResume, ResumeLayoutSettings, ResumeOptimizeModule } from '@ai-job-print/shared'
import type { CSSProperties } from 'react'
import { OptimizedResumeEditor } from '../OptimizedResumeEditor'
import { ResumeHtmlPreviewNote } from './ResumeAigcBadge'
import type { ResumeLayoutAdjustAction } from '../../../../services/api/ai'

export function OptimizeReadyBody(props: {
  resume: GeneratedResume
  modules: ResumeOptimizeModule[]
  unconfirmed: string[]
  layout: ResumeLayoutSettings
  previewClassName: string
  previewStyle: CSSProperties
  loading: boolean
  exporting: boolean
  adjusting: ResumeLayoutAdjustAction | null
  lastResumeBeforeAiAdjust: GeneratedResume | null
  adjustWarnings: string[]
  adjustError: string | null
  onResumeChange: (next: GeneratedResume) => void
  onCompare: () => void
  onAiAdjust: (action: ResumeLayoutAdjustAction) => void
  onUndoAi: () => void
}) {
  const { loading, exporting, resume: optimizedResume, adjusting } = props
  const aiAdjustDisabled = loading || exporting || !optimizedResume || Boolean(adjusting)
  return (
    <div className="qx-rd-main">
      <p>{COMPLIANCE_COPY.KIOSK_RESUME_OPTIMIZE_DISCLAIMER}页面只展示表达调整参考，不承诺提分或招聘结果。</p>
      {props.modules.length > 0 && (
        <div className="qx-card qx-rd-mods">
          <p>{props.modules.length} 组可对照修改项。对照要一条一条读才有用。</p>
          <button type="button" className="qx-btn" data-variant="ghost" onClick={props.onCompare}>
            逐条看完整对照
          </button>
        </div>
      )}
      {props.unconfirmed.length > 0 && <p className="qx-rd-unconfirmed">待本人确认：{props.unconfirmed.join('、')}</p>}
      <ResumeHtmlPreviewNote />
      <OptimizedResumeEditor
        resume={props.resume}
        onChange={props.onResumeChange}
        layout={props.layout}
        previewClassName={props.previewClassName}
        previewStyle={props.previewStyle}
      />
      <div className="qx-card">
        <h3>AI 辅助调整</h3>
        <p>仅基于当前简历和原文做表达密度调整，不新增经历或事实</p>
        <div className="qx-rd-fmt">
          <button type="button" className="qx-btn" data-variant="ghost" disabled={aiAdjustDisabled} onClick={() => props.onAiAdjust('condense')}>
            {props.adjusting === 'condense' ? '正在精简…' : 'AI 精简'}
          </button>
          <button type="button" className="qx-btn" data-variant="ghost" disabled={aiAdjustDisabled} onClick={() => props.onAiAdjust('reformat')}>
            {props.adjusting === 'reformat' ? '正在调整…' : 'AI 调整排版'}
          </button>
        </div>
        {props.lastResumeBeforeAiAdjust && (
          <button type="button" className="qx-btn" data-variant="teal" onClick={props.onUndoAi}>撤销 AI 调整</button>
        )}
        {props.adjustWarnings.slice(0, 3).map((warning) => <p key={warning}>{warning}</p>)}
        {props.adjustError && <p className="qx-rd-error">{props.adjustError}</p>}
      </div>
    </div>
  )
}
