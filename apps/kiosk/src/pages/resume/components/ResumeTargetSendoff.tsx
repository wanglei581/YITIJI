import { RESUME_SCORING_DIMENSIONS, type ResumeScoringDimensionKey, type ResumeTargetContext } from '@ai-job-print/shared'

/** 稿 21 `ctxStrip`：六格摘要钉在滚动区外面、主按钮上方，不跟着内容滚走。 */
export function ResumeTargetSendoff({
  generic, intent, selectedDimensions, targetIndustry, targetJob, targetExperience, targetScene, targetMajor, targetDegree,
}: {
  generic: boolean
  intent: 'diagnose' | 'optimize'
  selectedDimensions: ResumeScoringDimensionKey[]
  targetIndustry: string
  targetJob: string
  targetExperience: ResumeTargetContext['experience']
  targetScene: ResumeTargetContext['scene']
  targetMajor: string
  targetDegree: string
}) {
  const focus = RESUME_SCORING_DIMENSIONS.filter((item) => selectedDimensions.includes(item.key)).map((item) => item.label).join('、')
  const cells: Array<[string, string]> = generic
    ? [
      ['目标岗位', '暂不指定'],
      ['行业', '暂不指定'],
      ['经验', '暂不指定'],
      ['求职场景', '暂不指定'],
      ['专业', '暂不指定'],
      ['学历', '暂不指定'],
    ]
    : [
      ['目标岗位', targetJob.trim() || '未选'],
      ['行业', targetIndustry || '暂不指定'],
      ['经验', targetExperience || '未选'],
      ['求职场景', targetScene || '未选'],
      ['专业', targetMajor.trim() || '未填'],
      ['学历', targetDegree.trim() || '未填'],
    ]
  return (
    <section className="qx-rt-sendoff" data-testid="resume-target-sendoff" aria-label="这次送出的目标设置">
      <header>
        <b>这次送出的目标设置</b>
        <small>{generic ? '通用诊断 · 六项全部标记为「暂不指定」' : `定向诊断 · 重点：${focus || '暂不指定'}`}</small>
      </header>
      <dl>
        {cells.map(([key, value]) => (
          <div key={key}><dt>{key}</dt><dd>{value}</dd></div>
        ))}
      </dl>
      <p>
        {intent === 'optimize'
          ? '优化先出诊断，再按目标岗位的常用说法重写表达：只改写简历里已有的内容，不编造经历，也不承诺匹配率、提分幅度或录用结果，没有企业匹配，更没有站内投递。'
          : '这六项只用来排简历表达的建议顺序，报告仍固定输出 6 个维度。不做企业匹配、不做录用预测、不做站内投递，也不代表这台机器有对应岗位。'}
      </p>
    </section>
  )
}
