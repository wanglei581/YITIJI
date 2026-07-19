import { Card } from '@ai-job-print/ui'
import {
  RESUME_SCORING_DIMENSIONS,
  RESUME_TARGET_EXPERIENCE_OPTIONS,
  RESUME_TARGET_SCENE_OPTIONS,
  type ResumeScoringDimensionKey,
  type ResumeTargetContext,
} from '@ai-job-print/shared'
import { TargetIcon } from 'lucide-react'

const INDUSTRY_OPTIONS = ['互联网/科技', '先进制造', '现代服务', '教育/科研', '通用']

interface DiagnosisDirectionFormProps {
  genericDiagnosis: boolean
  selectedDimensions: ResumeScoringDimensionKey[]
  targetIndustry: string
  targetJob: string
  targetExperience: ResumeTargetContext['experience']
  targetScene: ResumeTargetContext['scene']
  onGenericDiagnosisChange: (value: boolean) => void
  onToggleDimension: (key: ResumeScoringDimensionKey) => void
  onTargetIndustryChange: (value: string) => void
  onTargetJobChange: (value: string) => void
  onTargetExperienceChange: (value: ResumeTargetContext['experience']) => void
  onTargetSceneChange: (value: ResumeTargetContext['scene']) => void
}

export function DiagnosisDirectionForm({
  genericDiagnosis,
  selectedDimensions,
  targetIndustry,
  targetJob,
  targetExperience,
  targetScene,
  onGenericDiagnosisChange,
  onToggleDimension,
  onTargetIndustryChange,
  onTargetJobChange,
  onTargetExperienceChange,
  onTargetSceneChange,
}: DiagnosisDirectionFormProps) {
  return (
    <Card className="p-5">
      {/* card-head: g-icon 方块 + 标题 + 切换按钮，对应原型 .card-head 结构 */}
      <div className="mb-4 flex items-center gap-4">
        <span
          className="fy-g-icon flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-primary-50 text-primary-600"
          aria-hidden="true"
        >
          <TargetIcon className="h-8 w-8" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-bold text-neutral-900">诊断方向设置</h2>
          <p className="mt-0.5 text-sm text-neutral-500">只影响建议关注顺序，报告仍固定输出 6 个维度</p>
        </div>
        <button
          type="button"
          aria-pressed={genericDiagnosis}
          onClick={() => onGenericDiagnosisChange(!genericDiagnosis)}
          className={[
            'min-h-[48px] shrink-0 rounded-full border px-5 text-sm font-semibold transition-colors active:scale-[0.98]',
            genericDiagnosis
              ? 'border-primary-500 bg-primary-50 text-primary-700'
              : 'border-neutral-200 bg-white text-neutral-600',
          ].join(' ')}
        >
          切换为通用诊断
        </button>
      </div>

      {/* 重点维度 chips */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {RESUME_SCORING_DIMENSIONS.map((item) => {
          const checked = !genericDiagnosis && selectedDimensions.includes(item.key)
          return (
            <button
              type="button"
              key={item.key}
              aria-pressed={checked}
              disabled={genericDiagnosis}
              onClick={() => onToggleDimension(item.key)}
              className={[
                'fy-dim-chip min-h-[58px] rounded-2xl border px-3 text-sm font-semibold transition-colors active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50',
                checked ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-neutral-200 bg-white text-neutral-600',
              ].join(' ')}
            >
              {item.label}
            </button>
          )
        })}
      </div>

      {/* 目标岗位 / 行业方向 / 经验级别 / 求职场景 */}
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-neutral-700">目标岗位</span>
          <input
            value={targetJob}
            disabled={genericDiagnosis}
            onChange={(e) => onTargetJobChange(e.target.value.slice(0, 80))}
            placeholder="例如：前端工程师、财务助理"
            className="h-16 w-full rounded-xl border border-neutral-200 px-4 text-base outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 disabled:bg-neutral-50"
          />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-neutral-700">行业方向</span>
          <select
            value={targetIndustry}
            disabled={genericDiagnosis}
            onChange={(e) => onTargetIndustryChange(e.target.value)}
            className="h-16 w-full rounded-xl border border-neutral-200 px-4 text-base outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 disabled:bg-neutral-50"
          >
            {INDUSTRY_OPTIONS.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-neutral-700">经验级别</span>
          <select
            value={targetExperience}
            disabled={genericDiagnosis}
            onChange={(e) => onTargetExperienceChange(e.target.value as ResumeTargetContext['experience'])}
            className="h-16 w-full rounded-xl border border-neutral-200 px-4 text-base outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 disabled:bg-neutral-50"
          >
            {RESUME_TARGET_EXPERIENCE_OPTIONS.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-neutral-700">求职场景</span>
          <select
            value={targetScene}
            disabled={genericDiagnosis}
            onChange={(e) => onTargetSceneChange(e.target.value as ResumeTargetContext['scene'])}
            className="h-16 w-full rounded-xl border border-neutral-200 px-4 text-base outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 disabled:bg-neutral-50"
          >
            {RESUME_TARGET_SCENE_OPTIONS.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
      </div>
    </Card>
  )
}
