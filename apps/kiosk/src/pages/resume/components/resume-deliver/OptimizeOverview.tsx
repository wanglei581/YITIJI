import type { ResumeOptimizeModule } from '@ai-job-print/shared'
import { ResumeModuleDecisions } from './ResumeModuleDecisions'
import type { ResumeDecisionMap, ResumeModuleDecision } from './resumeDecisions'

export function OptimizeSummary({ count }: { count: number }) {
  return (
    <section className="qx-r1-summary" aria-label="优化内容摘要">
      <h2>本次优化内容</h2>
      <p>{count > 0 ? `共有 ${count} 组可对照修改项。先选择改法，再编辑并导出新简历。` : '已取得优化版简历，可进入编辑区逐项核对后导出。'}</p>
      <div className="qx-r1-stats">
        <span>建议组数<b>{count}</b></span>
        <span>原文保留<b>可随时切回</b></span>
        <span>带走什么<b>新简历 · 修改清单</b></span>
      </div>
    </section>
  )
}

/** 稿 23 overview：同一份建议的概览，编辑与导出仍使用既有工作区。 */
export function OptimizeOverview(props: {
  modules: ResumeOptimizeModule[]
  decisions: ResumeDecisionMap
  disabled: boolean
  onDecisionChange: (key: string, next: ResumeModuleDecision) => void
  onCompare: () => void
  onEditor: () => void
}) {
  return (
    <div className="qx-r1-overview qx-scroll">
      <ResumeModuleDecisions modules={props.modules} decisions={props.decisions} disabled={props.disabled} onDecisionChange={props.onDecisionChange} onCompare={props.onCompare} />
      <button type="button" className="qx-btn" data-variant="primary" onClick={props.onEditor}>编辑与导出新简历</button>
    </div>
  )
}
