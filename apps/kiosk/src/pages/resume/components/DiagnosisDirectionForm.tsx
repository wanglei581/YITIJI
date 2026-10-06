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
import { CheckIcon, ShieldCheckIcon, TargetIcon } from 'lucide-react'
import {
  COMMON_SECTOR_LABELS,
  JOB_CATEGORIES,
  JOB_OTHER,
  MAJOR_OPTIONS,
  TARGET_JOB_MAX,
  TARGET_MAJOR_MAX,
  categoryOfJob,
} from './resumeJobCatalog'

interface DiagnosisDirectionFormProps {
  part: 'focus' | 'context'
  forceMore?: boolean
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
  onOpenIndustry: () => void
  onOpenOfficialChannels: () => void
}

const REPORT_ITEMS = [
  ...RESUME_SCORING_DIMENSIONS.map((item) => item.label),
  '风险表述提醒',
  '修改优先级建议',
]

export function DiagnosisDirectionForm({
  part,
  forceMore = false,
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
  onOpenIndustry,
  onOpenOfficialChannels,
}: DiagnosisDirectionFormProps) {
  const [jobCat, setJobCat] = useState(() => categoryOfJob(targetJob))
  const [sectorsOpen, setSectorsOpen] = useState(false)
  const [showMore, setShowMore] = useState(() => forceMore || Boolean(targetMajor || targetDegree))
  const [majorOther, setMajorOther] = useState(() => Boolean(targetMajor) && !MAJOR_OPTIONS.includes(targetMajor as typeof MAJOR_OPTIONS[number]))
  const activeCategory = JOB_CATEGORIES.find((item) => item.key === jobCat)
  const sectors = sectorsOpen
    ? EMPLOYMENT_INDUSTRY_SECTORS.map((item) => item.label)
    : COMMON_SECTOR_LABELS
  const majorInput = majorOther || (Boolean(targetMajor) && !MAJOR_OPTIONS.includes(targetMajor as typeof MAJOR_OPTIONS[number]))

  return (
    <section className="qx-rt-target" aria-labelledby="qx-rt-target-h">
      <header className="qx-rt-blk-h">
        <span className="qx-rt-blk-ic" aria-hidden="true"><TargetIcon size={26} /></span>
        <span>
          <h2 id="qx-rt-target-h">诊断方向设置</h2>
          <small>只影响建议关注顺序，报告仍固定输出 6 个维度</small>
        </span>
      </header>

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
        <span className="lb" id="qx-rt-dims-lb">重点维度 <small>默认 3 项，可增减</small></span>
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

      <section className="qx-card qx-rt-dims">
        <details>
          <summary>
            <ShieldCheckIcon size={22} aria-hidden="true" />
            <span>诊断报告包含以下内容</span>
            <small>{REPORT_ITEMS.length} 项 · 点击展开</small>
          </summary>
          <div className="qx-rt-dim-grid">
            {REPORT_ITEMS.map((item, index) => (
              <span key={item} className="qx-rt-dim" data-extra={index >= REPORT_ITEMS.length - 2 ? 'true' : undefined}>{item}</span>
            ))}
          </div>
        </details>
      </section>

      {part === 'context' ? (
        <>
          <div className="qx-rt-grp" role="group" aria-labelledby="qx-rt-industry-lb">
            <span className="lb" id="qx-rt-industry-lb">行业门类 <small>常见门类只是排列顺序，不是推荐</small></span>
            <div className="ops">
              <button type="button" className="qx-rt-chip" data-mute="true" disabled={genericDiagnosis} aria-pressed={targetIndustry === ''} onClick={() => onTargetIndustryChange('')}>暂不指定</button>
              {sectors.map((label) => (
                <button type="button" key={label} className="qx-rt-chip" disabled={genericDiagnosis} aria-pressed={targetIndustry === label} onClick={() => onTargetIndustryChange(label)}>{label}</button>
              ))}
            </div>
            <div className="qx-rt-inline-actions">
              <button type="button" className="qx-btn" data-variant="ghost" disabled={genericDiagnosis} onClick={() => setSectorsOpen((open) => !open)}>
                {sectorsOpen ? '收起全部门类' : '就地展开全部门类'}
              </button>
              <button type="button" className="qx-btn" data-variant="ghost" disabled={genericDiagnosis} onClick={onOpenIndustry}>整屏查看 20 个门类</button>
            </div>
          </div>

          <div className="qx-rt-grp" role="group" aria-labelledby="qx-rt-job-lb">
            <span className="lb" id="qx-rt-job-lb">目标岗位 <small>先点类别，再点具体职位。类别本身不会写入</small></span>
            <div className="qx-rt-jobcats">
              {JOB_CATEGORIES.map((item) => (
                <button type="button" key={item.key} className="qx-rt-chip" disabled={genericDiagnosis} aria-pressed={jobCat === item.key} onClick={() => setJobCat(item.key)}>{item.name}</button>
              ))}
              <button
                type="button"
                className="qx-rt-chip"
                disabled={genericDiagnosis}
                aria-pressed={jobCat === JOB_OTHER}
                onClick={() => {
                  setJobCat(JOB_OTHER)
                  if (categoryOfJob(targetJob) !== JOB_OTHER) onTargetJobChange('')
                }}
              >
                其他岗位
              </button>
            </div>
            {activeCategory ? (
              <div className="ops" role="group" aria-label={`${activeCategory.name}的职位`}>
                <button type="button" className="qx-rt-chip" data-mute="true" disabled={genericDiagnosis} aria-pressed={targetJob === activeCategory.name} onClick={() => onTargetJobChange(activeCategory.name)}>
                  整类：{activeCategory.name}
                </button>
                {activeCategory.jobs.map((job) => (
                  <button type="button" key={job} className="qx-rt-chip" disabled={genericDiagnosis} aria-pressed={targetJob === job} onClick={() => onTargetJobChange(job)}>{job}</button>
                ))}
              </div>
            ) : null}
            {jobCat === JOB_OTHER ? (
              <label className="qx-rt-field">
                <span className="lb">其他岗位</span>
                <input
                  aria-label="其他岗位"
                  value={categoryOfJob(targetJob) === JOB_OTHER ? targetJob : ''}
                  disabled={genericDiagnosis}
                  maxLength={TARGET_JOB_MAX}
                  placeholder="例如：甜品师、行车调度员"
                  onChange={(event) => onTargetJobChange(event.target.value.slice(0, TARGET_JOB_MAX))}
                />
              </label>
            ) : null}
          </div>

          <ChipGroup id="qx-rt-exp" label="经验" disabled={genericDiagnosis}
            options={[{ value: '', label: '暂不指定' }, ...RESUME_TARGET_EXPERIENCE_OPTIONS.map((item) => ({ value: item, label: item }))]}
            value={targetExperience ?? ''}
            onChange={(value) => onTargetExperienceChange(value ? value as ResumeTargetContext['experience'] : undefined)}
          />
          <ChipGroup id="qx-rt-scene" label="求职场景" disabled={genericDiagnosis}
            options={[{ value: '', label: '暂不指定' }, ...RESUME_TARGET_SCENE_OPTIONS.map((item) => ({ value: item, label: item }))]}
            value={targetScene ?? ''}
            onChange={(value) => onTargetSceneChange(value ? value as ResumeTargetContext['scene'] : undefined)}
          />

          <button type="button" className="qx-rt-drawer" aria-expanded={showMore || forceMore} aria-controls="qx-rt-more" onClick={() => setShowMore((open) => !open)}>
            <b>专业与学历</b>
            <small>选填 · 不填也能诊断</small>
            <span className="go">{showMore || forceMore ? '收起 ↑' : '展开填写 ↓'}</span>
          </button>
          {showMore || forceMore ? (
            <div id="qx-rt-more" className="qx-rt-more">
              <div className="qx-rt-grp" role="group" aria-labelledby="qx-rt-major-lb">
                <span className="lb" id="qx-rt-major-lb">专业（选填）</span>
                <div className="ops">
                  {MAJOR_OPTIONS.map((item) => (
                    <button type="button" key={item} className="qx-rt-chip" disabled={genericDiagnosis} aria-pressed={targetMajor === item} onClick={() => { setMajorOther(false); onTargetMajorChange(item) }}>{item}</button>
                  ))}
                  <button type="button" className="qx-rt-chip" disabled={genericDiagnosis} aria-pressed={majorInput} onClick={() => { setMajorOther(true); if (MAJOR_OPTIONS.includes(targetMajor as typeof MAJOR_OPTIONS[number])) onTargetMajorChange('') }}>其他专业</button>
                </div>
                {majorInput ? (
                  <label className="qx-rt-field">
                    <span className="lb">其他专业</span>
                    <input
                      aria-label="专业（选填）"
                      value={targetMajor}
                      disabled={genericDiagnosis}
                      maxLength={TARGET_MAJOR_MAX}
                      placeholder="例如：计算机科学与技术"
                      onChange={(event) => onTargetMajorChange(event.target.value.slice(0, TARGET_MAJOR_MAX))}
                    />
                  </label>
                ) : null}
              </div>
              <ChipGroup id="qx-rt-degree" label="学历（选填）" disabled={genericDiagnosis}
                options={[{ value: '', label: '不填写' }, ...EDUCATION_LEVEL_OPTIONS.map((item) => ({ value: item, label: item }))]}
                value={targetDegree}
                onChange={onTargetDegreeChange}
              />
            </div>
          ) : null}

          <button type="button" className="qx-rt-alt" onClick={onOpenOfficialChannels}>
            <span>
              <strong>机构官方渠道</strong>
              <small>那边是本机构的官方渠道，不会把岗位带回这里。</small>
            </span>
            <span className="go">去看看 →</span>
          </button>
          <p className="qx-rt-hint">专业与学历仅用于本人简历表达的诊断重点参考，不影响是否可以诊断。</p>
        </>
      ) : (
        <p className="qx-rt-hint">重点选好后，可以继续填写行业、岗位、经验和学历。</p>
      )}

    </section>
  )
}

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
