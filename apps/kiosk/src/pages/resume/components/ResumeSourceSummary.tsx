import { RESUME_SCORING_DIMENSIONS, type ResumeScoringDimensionKey, type ResumeTargetContext } from '@ai-job-print/shared'

/** 稿 21 summary 的办理摘要；只读本人选项，不构造解析结果。 */
export function ResumeSourceSummary({ generic, dimensions, target, intent, compact = false }: {
  compact?: boolean
  generic: boolean
  dimensions: ResumeScoringDimensionKey[]
  target: ResumeTargetContext
  intent: 'diagnose' | 'optimize'
}) {
  const focus = RESUME_SCORING_DIMENSIONS.filter((item) => dimensions.includes(item.key)).map((item) => item.label).join('、')
  return (
    <section className="qx-rt-summary" aria-label="确认这次办理的内容">
      {!compact && <h2 className="qx-rt-sec-h">确认这次办理的内容</h2>}
      <dl className="qx-rt-kv">
        {!compact && <div><dt>这次要做</dt><dd>{intent === 'optimize' ? '先诊断，再逐条优化表达' : 'AI 简历诊断'}</dd></div>}
        <div><dt>诊断范围</dt><dd>{generic ? '通用诊断 · 暂不指定方向' : '定向诊断'}</dd></div>
        <div><dt>重点关注</dt><dd>{generic ? '完整查看六个维度' : focus || '暂不指定重点'}</dd></div>
        <div><dt>目标与背景</dt><dd>{generic ? '本次不使用目标与背景设置' : [target.industry, target.targetJob, target.experience, target.scene, target.major, target.degree].filter(Boolean).join(' · ') || '暂不指定'}</dd></div>
        {!compact && <div><dt>带走什么</dt><dd>简历诊断报告，按建议继续修改简历。</dd></div>}
      </dl>
    </section>
  )
}
