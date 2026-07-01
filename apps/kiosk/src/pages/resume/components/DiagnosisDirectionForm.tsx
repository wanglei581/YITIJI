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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <TargetIcon className="h-5 w-5 text-primary-600" aria-hidden="true" />
            <p className="text-base font-bold text-gray-900">诊断方向设置</p>
          </div>
          <p className="mt-1 max-w-[58ch] text-sm leading-relaxed text-gray-500">
            只影响建议关注顺序，报告仍固定输出 6 个诊断维度，方便后续复查和对比。
          </p>
        </div>
        <button
          type="button"
          aria-pressed={genericDiagnosis}
          onClick={() => onGenericDiagnosisChange(!genericDiagnosis)}
          className={[
            'min-h-[44px] rounded-full border px-4 text-sm font-semibold transition-colors active:scale-[0.98]',
            genericDiagnosis ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 bg-white text-gray-600',
          ].join(' ')}
        >
          通用诊断
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
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
                'min-h-[56px] rounded-2xl border px-3 text-sm font-semibold transition-colors active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50',
                checked ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 bg-white text-gray-600',
              ].join(' ')}
            >
              {item.label}
            </button>
          )
        })}
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="block">
          <span className="text-xs font-semibold text-gray-500">目标岗位</span>
          <input
            value={targetJob}
            disabled={genericDiagnosis}
            onChange={(e) => onTargetJobChange(e.target.value.slice(0, 80))}
            placeholder="例如：前端工程师、财务助理"
            className="mt-1 h-12 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 disabled:bg-gray-50"
          />
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-gray-500">行业方向</span>
          <select
            value={targetIndustry}
            disabled={genericDiagnosis}
            onChange={(e) => onTargetIndustryChange(e.target.value)}
            className="mt-1 h-12 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 disabled:bg-gray-50"
          >
            {INDUSTRY_OPTIONS.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-gray-500">经验级别</span>
          <select
            value={targetExperience}
            disabled={genericDiagnosis}
            onChange={(e) => onTargetExperienceChange(e.target.value as ResumeTargetContext['experience'])}
            className="mt-1 h-12 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 disabled:bg-gray-50"
          >
            {RESUME_TARGET_EXPERIENCE_OPTIONS.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-xs font-semibold text-gray-500">求职场景</span>
          <select
            value={targetScene}
            disabled={genericDiagnosis}
            onChange={(e) => onTargetSceneChange(e.target.value as ResumeTargetContext['scene'])}
            className="mt-1 h-12 w-full rounded-xl border border-gray-200 px-3 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 disabled:bg-gray-50"
          >
            {RESUME_TARGET_SCENE_OPTIONS.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
      </div>
    </Card>
  )
}
