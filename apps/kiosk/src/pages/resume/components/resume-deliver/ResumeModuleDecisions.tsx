import type { ResumeOptimizeModule } from '@ai-job-print/shared'
import { moduleKeyOf, type ResumeDecisionMap, type ResumeModuleDecision } from './resumeDecisions'

export function ResumeModuleDecisions(props: {
  modules: ResumeOptimizeModule[]
  decisions: ResumeDecisionMap
  onDecisionChange: (key: string, next: ResumeModuleDecision) => void
  onCompare: () => void
  disabled?: boolean
}) {
  if (props.modules.length === 0) return null
  return (
    <div className="qx-card qx-rd-mods">
      <p>{props.modules.length} 组可对照修改项。可切回原文；该选择随草稿保存，导出时不会把已回退的模块再写成优化版。</p>
      <button type="button" className="qx-btn" data-variant="ghost" onClick={props.onCompare}>
        逐条看完整对照
      </button>
      <ul className="qx-rd-mod-list">
        {props.modules.map((module, index) => {
          const key = moduleKeyOf(module, index)
          const current: ResumeModuleDecision = props.decisions[key] ?? 'optimized'
          return (
            <li key={key} className="qx-rd-mod-row">
              <p>{module.title || `第 ${index + 1} 组`}</p>
              <div className="qx-rd-mod-toggle">
                <button
                  type="button"
                  className="qx-btn"
                  data-variant="ghost"
                  aria-pressed={current === 'original'}
                  disabled={props.disabled}
                  onClick={() => props.onDecisionChange(key, 'original')}
                >
                  回到原文
                </button>
                <button
                  type="button"
                  className="qx-btn"
                  data-variant="ghost"
                  aria-pressed={current === 'optimized'}
                  disabled={props.disabled}
                  onClick={() => props.onDecisionChange(key, 'optimized')}
                >
                  使用优化稿
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
