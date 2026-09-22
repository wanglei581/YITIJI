import { useState } from 'react'
import {
  EDUCATION_LEVEL_OPTIONS,
  EMPLOYMENT_INDUSTRY_SECTORS,
  RESUME_SCORING_DIMENSIONS,
  RESUME_TARGET_EXPERIENCE_OPTIONS,
  RESUME_TARGET_SCENE_OPTIONS,
  type ResumeScoringDimensionKey,
  type ResumeTargetContext,
} from '@ai-job-print/shared'
import { CheckIcon, ListFilterIcon, TargetIcon } from 'lucide-react'
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

  // 专业与学历是选填抽屉（稿 21 target-context）；已经填过的人回来时抽屉保持展开，不把值藏起来。
  const [showMore, setShowMore] = useState(() => Boolean(targetMajor || targetDegree))

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
      <section className="qx-rt-target" aria-labelledby="qx-rt-target-h">
        <header className="qx-rt-blk-h">
          <span className="qx-rt-blk-ic" aria-hidden="true"><TargetIcon size={26} /></span>
          <span>
            <h2 id="qx-rt-target-h">诊断方向设置</h2>
            <small>只影响建议关注顺序，报告仍固定输出 6 个维度</small>
          </span>
        </header>

        {/* 稿 21 target 的 .seg：定向 / 通用二选一，比单个「切换」按钮更说得清现在是哪一种。 */}
        <div className="qx-rt-seg" role="group" aria-label="诊断范围">
          <button type="button" aria-pressed={!genericDiagnosis} onClick={() => onGenericDiagnosisChange(false)}>
            <b>定向诊断</b>
            <small>按你选的重点排建议顺序</small>
          </button>
          <button type="button" aria-pressed={genericDiagnosis} onClick={() => onGenericDiagnosisChange(true)}>
            <b>通用诊断</b>
            <small>不设方向，下面各项都不参与</small>
          </button>
        </div>

        <div className="qx-rt-grp" role="group" aria-labelledby="qx-rt-dims-lb">
          <span className="lb" id="qx-rt-dims-lb">重点关注维度 <small>默认 3 项，可增减</small></span>
          <div className="qx-rt-dimchips">
            {RESUME_SCORING_DIMENSIONS.map((item) => {
              const checked = !genericDiagnosis && selectedDimensions.includes(item.key)
              return (
                <button
                  type="button"
                  key={item.key}
                  className="qx-rt-dimchip"
                  aria-pressed={checked}
                  disabled={genericDiagnosis}
                  onClick={() => onToggleDimension(item.key)}
                >
                  <span className="mk" aria-hidden="true">{checked ? <CheckIcon size={18} strokeWidth={3} /> : null}</span>
                  <span className="tx">{item.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        <label className="qx-rt-field">
          <span className="lb">目标岗位</span>
          <input
            value={targetJob}
            disabled={genericDiagnosis}
            onChange={(e) => onTargetJobChange(e.target.value.slice(0, 80))}
            placeholder="例如：前端工程师、财务助理"
          />
        </label>

        <div className="qx-rt-field">
          <span className="lb">行业方向</span>
          <button
            type="button"
            disabled={genericDiagnosis}
            aria-haspopup="dialog"
            aria-label="选择行业方向"
            onClick={() => setShowIndustryPicker(true)}
          >
            <span className="val">{targetIndustry || '暂不指定'}</span>
            <span className="go">全部 20 个门类 <ListFilterIcon size={18} aria-hidden="true" /></span>
          </button>
        </div>

        <ChipGroup
          id="qx-rt-exp"
          label="经验级别"
          disabled={genericDiagnosis}
          options={RESUME_TARGET_EXPERIENCE_OPTIONS.map((item) => ({ value: item, label: item }))}
          value={targetExperience}
          onChange={(value) => onTargetExperienceChange(value as ResumeTargetContext['experience'])}
        />
        <ChipGroup
          id="qx-rt-scene"
          label="求职场景"
          disabled={genericDiagnosis}
          options={RESUME_TARGET_SCENE_OPTIONS.map((item) => ({ value: item, label: item }))}
          value={targetScene}
          onChange={(value) => onTargetSceneChange(value as ResumeTargetContext['scene'])}
        />

        <button
          type="button"
          className="qx-rt-drawer"
          aria-expanded={showMore}
          aria-controls="qx-rt-more"
          onClick={() => setShowMore((open) => !open)}
        >
          <b>专业与学历</b>
          <small>选填 · 不填也能诊断</small>
          <span className="go">{showMore ? '收起 ↑' : '展开填写 ↓'}</span>
        </button>
        {showMore ? (
          <div id="qx-rt-more" className="qx-rt-more">
            <label className="qx-rt-field">
              <span className="lb">专业（选填）</span>
              <input
                value={targetMajor}
                disabled={genericDiagnosis}
                onChange={(e) => onTargetMajorChange(e.target.value.slice(0, 60))}
                placeholder="例如：计算机科学与技术"
              />
            </label>
            <ChipGroup
              id="qx-rt-degree"
              label="学历（选填）"
              disabled={genericDiagnosis}
              options={[{ value: '', label: '不填写' }, ...EDUCATION_LEVEL_OPTIONS.map((item) => ({ value: item, label: item }))]}
              value={targetDegree}
              onChange={onTargetDegreeChange}
            />
          </div>
        ) : null}

        <p className="qx-rt-hint">
          专业与学历仅用于本人简历表达的诊断重点参考，不影响是否可以诊断。
        </p>
      </section>
    </>
  )
}

/** 稿 21 `.grp > .ops > .chip`：单选点选组。按钮带 aria-pressed，整组以标签命名。 */
function ChipGroup({ id, label, options, value, disabled, onChange }: {
  id: string
  label: string
  options: Array<{ value: string; label: string }>
  value: string | undefined
  disabled?: boolean
  onChange: (value: string) => void
}) {
  return (
    <div className="qx-rt-grp" role="group" aria-labelledby={`${id}-lb`}>
      <span className="lb" id={`${id}-lb`}>{label}</span>
      <div className="ops">
        {options.map((item) => (
          <button
            type="button"
            key={item.value || 'none'}
            className="qx-rt-chip"
            data-mute={item.value === '' ? 'true' : undefined}
            aria-pressed={value === item.value}
            disabled={disabled}
            onClick={() => onChange(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  )
}
