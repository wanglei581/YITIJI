import { RESUME_SCORING_DIMENSIONS, type ResumeScoringDimensionKey, type ResumeTargetContext } from '@ai-job-print/shared'

/** 稿 21 的方向表。通用诊断时三行都写「暂不指定」，不把默认重点说成已经选过。 */
export function ResumeSourceSummary({ generic, dimensions, target, intent, compact = false }: {
  compact?: boolean
  generic: boolean
  dimensions: ResumeScoringDimensionKey[]
  target: ResumeTargetContext
  intent: 'diagnose' | 'optimize'
}) {
  const focus = RESUME_SCORING_DIMENSIONS.filter((item) => dimensions.includes(item.key)).map((item) => item.label).join('、')
  const background = [target.industry, target.targetJob, target.experience, target.scene, target.major, target.degree].filter(Boolean).join(' · ')
  return (
    <section className="qx-rt-summary" aria-label="确认这次办理的内容" data-testid="resume-direction-table">
      {!compact && <h2 className="qx-rt-sec-h">确认这次办理的内容</h2>}
      <dl className="qx-rt-kv">
        {!compact && <div><dt>这次要做</dt><dd>{intent === 'optimize' ? '先诊断，再逐条优化表达' : 'AI 简历诊断'}</dd></div>}
        <div><dt>诊断范围</dt><dd data-testid="resume-direction-scope">{generic ? '通用诊断 · 暂不指定' : '定向诊断'}</dd></div>
        <div><dt>重点维度</dt><dd data-testid="resume-direction-dims">{generic ? '暂不指定' : focus || '暂不指定'}</dd></div>
        <div><dt>目标背景</dt><dd data-testid="resume-direction-target">{generic ? '暂不指定' : background || '暂不指定'}</dd></div>
        {!compact && <div><dt>带走什么</dt><dd>简历诊断报告，按建议继续修改简历。</dd></div>}
      </dl>
    </section>
  )
}
