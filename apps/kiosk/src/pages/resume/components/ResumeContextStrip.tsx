import type { ResumeScoringDimensionKey, ResumeTargetContext } from '@ai-job-print/shared'
import { RESUME_SCORING_DIMENSIONS } from '@ai-job-print/shared'

interface ResumeContextStripProps {
  generic: boolean
  dimensions: ResumeScoringDimensionKey[]
  industry: string
  job: string
  experience: ResumeTargetContext['experience']
  scene: ResumeTargetContext['scene']
  major: string
  degree: string
}

/** 工作台底部固定摘要：现在选了什么，不构造诊断结果。 */
export function ResumeContextStrip(props: ResumeContextStripProps) {
  const focus = RESUME_SCORING_DIMENSIONS.filter((item) => props.dimensions.includes(item.key)).map((item) => item.label).join('、')
  const background = [props.industry, props.job, props.experience, props.scene, props.major, props.degree].filter(Boolean).join(' · ')
  return (
    <p className="qx-rt-ctxstrip" aria-live="polite">
      {props.generic
        ? '当前：通用诊断 · 暂不指定'
        : `当前：${focus || '重点暂不指定'} · ${background || '目标背景暂不指定'}`}
    </p>
  )
}
