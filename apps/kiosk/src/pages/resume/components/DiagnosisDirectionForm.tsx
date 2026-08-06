import { useState } from 'react'
import { Card } from '@ai-job-print/ui'
import {
  EDUCATION_LEVEL_OPTIONS,
  EMPLOYMENT_INDUSTRY_SECTORS,
  RESUME_SCORING_DIMENSIONS,
  RESUME_TARGET_EXPERIENCE_OPTIONS,
  RESUME_TARGET_SCENE_OPTIONS,
  type ResumeScoringDimensionKey,
  type ResumeTargetContext,
} from '@ai-job-print/shared'
import { ListFilterIcon, TargetIcon } from 'lucide-react'
import { KioskFilterPickerModal } from '../../../components/KioskFilterPickerModal'

interface DiagnosisDirectionFormProps {
  genericDiagnosis: boolean
  selectedDimensions: ResumeScoringDimensionKey[]
  targetIndustry: string
  targetJob: string
  targetExperience: ResumeTargetContext['experience']
  targetScene: ResumeTargetContext['scene']
  targetMajor: string
  targetDegree: string
  onGenericDiagnosisChange: (value: boolean) => void
  onToggleDimension: (key: ResumeScoringDimensionKey) => void
  onTargetIndustryChange: (value: string) => void
  onTargetJobChange: (value: string) => void
  onTargetExperienceChange: (value: ResumeTargetContext['experience']) => void
  onTargetSceneChange: (value: ResumeTargetContext['scene']) => void
  onTargetMajorChange: (value: string) => void
  onTargetDegreeChange: (value: string) => void
}

export function DiagnosisDirectionForm({
  genericDiagnosis,
  selectedDimensions,
  targetIndustry,
  targetJob,
  targetExperience,
  targetScene,
  targetMajor,
  targetDegree,
  onGenericDiagnosisChange,
  onToggleDimension,
  onTargetIndustryChange,
  onTargetJobChange,
  onTargetExperienceChange,
  onTargetSceneChange,
  onTargetMajorChange,
  onTargetDegreeChange,
}: DiagnosisDirectionFormProps) {
  const [showIndustryPicker, setShowIndustryPicker] = useState(false)

  return (
    <>
      <KioskFilterPickerModal
        open={showIndustryPicker}
        title="选择行业门类"
        description="覆盖 GB/T 4754-2017 的 20 个行业门类；更细行业将在后续分级字典中选择。"
        sections={[{
          id: 'industry',
          label: '行业门类',
          value: targetIndustry,
          allLabel: '暂不指定',
          options: EMPLOYMENT_INDUSTRY_SECTORS.map((item) => ({ value: item.label, label: item.label })),
        }]}
        onChange={(_, value) => onTargetIndustryChange(value)}
        onClear={() => onTargetIndustryChange('')}
        onClose={() => setShowIndustryPicker(false)}
      />
      <Card className="flex h-full flex-col p-5">
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

      <div className="mb-3 flex items-end justify-between gap-3">
        <p className="text-sm font-semibold text-neutral-700">
          重点关注维度 <span className="font-medium text-neutral-400">(默认 3 项，可增减)</span>
        </p>
      </div>

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

      <div className="mt-4 grid flex-1 content-start gap-3 md:grid-cols-2">
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
        <div className="block">
          <span className="mb-2 block text-sm font-semibold text-neutral-700">行业方向</span>
          <button
            type="button"
            disabled={genericDiagnosis}
            aria-haspopup="dialog"
            aria-label="选择行业方向"
            onClick={() => setShowIndustryPicker(true)}
            className="flex h-16 w-full items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-white px-4 text-left text-base outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 disabled:bg-neutral-50"
          >
            <span className="min-w-0 truncate">{targetIndustry || '暂不指定'}</span>
            <ListFilterIcon className="h-5 w-5 shrink-0 text-neutral-400" aria-hidden="true" />
          </button>
        </div>
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
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-neutral-700">专业（选填）</span>
          <input
            value={targetMajor}
            disabled={genericDiagnosis}
            onChange={(e) => onTargetMajorChange(e.target.value.slice(0, 60))}
            placeholder="例如：计算机科学与技术"
            className="h-16 w-full rounded-xl border border-neutral-200 px-4 text-base outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 disabled:bg-neutral-50"
          />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-neutral-700">学历（选填）</span>
          <select
            value={targetDegree}
            disabled={genericDiagnosis}
            onChange={(e) => onTargetDegreeChange(e.target.value)}
            className="h-16 w-full rounded-xl border border-neutral-200 px-4 text-base outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100 disabled:bg-neutral-50"
          >
            <option value="">不填写</option>
            {EDUCATION_LEVEL_OPTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-neutral-500">
        专业与学历仅用于本人简历表达的诊断重点参考，不影响是否可以诊断。
      </p>
      </Card>
    </>
  )
}
