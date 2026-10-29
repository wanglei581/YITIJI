import { useState, type ReactNode } from 'react'
import {
  EDUCATION_LEVEL_OPTIONS,
  EMPLOYMENT_INDUSTRY_SECTORS,
  RESUME_SCORING_DIMENSIONS,
  RESUME_TARGET_EXPERIENCE_OPTIONS,
  RESUME_TARGET_SCENE_OPTIONS,
  type ResumeScoringDimensionKey,
  type ResumeTargetContext,
} from '@ai-job-print/shared'
import { KioskFilterPickerModal } from '../../../components/KioskFilterPickerModal'
import { QxTouchIcon } from '../../../components/qingxu/touch/QxTouchIcon'
import { DIM_ABOUT } from '../resume-report-model'

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
  /** focus 是方向步（范围、重点、岗位与行业）；more 是可以不填的那四项（经历、场景、专业、学历）。 */
  pane: 'focus' | 'more'
  onOpenMore?: () => void
  /** 稿把「先诊断 / 直接给改法」放在范围切换和可改项之间，由来源页传入。 */
  afterModes?: ReactNode
  /** 「都不填」：清掉那四项并回到方向步。 */
  onSkipMore?: () => void
}

const MORE_USES = [
  ['经历', '就是经验级别。不选，这一项不参与。'],
  ['场景', '就是求职场景。「招聘会现场」只是诊断参考，不会打开招聘会。'],
  ['专业', '不是固定名单，最多 60 字。只作本人简历表达的诊断重点参考。'],
  ['学历', '选填。同样只影响建议关注顺序，不影响是否可以诊断。'],
] as const

/**
 * 诊断方向表单（稿 resume-direction / resume-direction-more）。
 * 默认通用诊断：六维只读，下面各项都不参与；改成定向后才可点选重点、填岗位与行业。
 * 经历、场景、专业、学历另成一步，全部可以不填。
 */
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
  pane,
  onOpenMore,
  afterModes,
  onSkipMore,
}: DiagnosisDirectionFormProps) {
  const [showIndustryPicker, setShowIndustryPicker] = useState(false)

  const dims = (
    <ul>
      {RESUME_SCORING_DIMENSIONS.map((item) => (
        <li key={item.key}><b>{item.label}</b><span>{DIM_ABOUT[item.key]}</span></li>
      ))}
    </ul>
  )

  if (pane === 'more') {
    const only = (value: string, label: string, pressed: boolean, onClick: () => void) => (
      // 「暂不指定 / 不填写」不是一个真实选择：data-mute 把它和本人选的选项分开，选中它不算替本人填了东西。
      <button key={value || 'none'} type="button" aria-pressed={pressed} data-mute={value === '' ? 'true' : undefined} disabled={genericDiagnosis} onClick={onClick}>{label}</button>
    )
    return (
      <section className="qxt-form qxt-form-more" aria-label="更多条件，都可以不填">
        <div className="qxt-block">
          <div className="qxt-lab">经历</div>
          <div className="qxt-chips" role="group" aria-label="经历">
            {only('', '暂不指定', !targetExperience, () => onTargetExperienceChange(undefined))}
            {RESUME_TARGET_EXPERIENCE_OPTIONS.map((item) => only(item, item, targetExperience === item, () => onTargetExperienceChange(item as ResumeTargetContext['experience'])))}
          </div>
        </div>
        <div className="qxt-block">
          <div className="qxt-lab">场景</div>
          <div className="qxt-chips" role="group" aria-label="场景">
            {only('', '暂不指定', !targetScene, () => onTargetSceneChange(undefined))}
            {RESUME_TARGET_SCENE_OPTIONS.map((item) => only(item, item, targetScene === item, () => onTargetSceneChange(item as ResumeTargetContext['scene'])))}
          </div>
        </div>
        <label className="qxt-field">
          <small>专业（选填）</small>
          <input
            value={targetMajor}
            disabled={genericDiagnosis}
            onChange={(e) => onTargetMajorChange(e.target.value.slice(0, 60))}
            placeholder="例如：计算机科学与技术"
          />
        </label>
        <div className="qxt-block">
          <div className="qxt-lab">学历<small>选填</small></div>
          <div className="qxt-chips" role="group" aria-label="学历（选填）">
            {only('', '不填写', !targetDegree, () => onTargetDegreeChange(''))}
            {EDUCATION_LEVEL_OPTIONS.map((item) => only(item, item, targetDegree === item, () => onTargetDegreeChange(item)))}
          </div>
        </div>
        <div className="qxt-hint"><p>专业与学历仅用于本人简历表达的诊断重点参考，不影响是否可以诊断。</p></div>
        <section className="qxt-see" aria-label="这四项怎么用">
          <b>这四项怎么用</b>
          <ul>
            {MORE_USES.map(([name, text]) => <li key={name}><b>{name}</b><span>{text}</span></li>)}
          </ul>
        </section>
        <button type="button" className="qxt-skip" onClick={onSkipMore}>都不填</button>
      </section>
    )
  }

  return (
    <section className="qxt-form qxt-form-focus" aria-label="诊断方向设置">
      <KioskFilterPickerModal
        open={showIndustryPicker}
        title="选择行业门类"
        description="选择与你目标方向接近的行业，也可以暂不指定。"
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
      <div className="qxt-modes" role="group" aria-label="诊断范围">
        <button type="button" aria-pressed={!genericDiagnosis} onClick={() => onGenericDiagnosisChange(false)}>
          <b>定向诊断</b>
          <small>按你选的重点排建议顺序</small>
        </button>
        <button type="button" aria-pressed={genericDiagnosis} onClick={() => onGenericDiagnosisChange(true)}>
          <b>通用诊断</b>
          <small>不设方向，下面各项都不参与</small>
        </button>
      </div>
      {afterModes}
      {genericDiagnosis ? (
        <>
          <section className="qxt-see" aria-label="通用诊断看什么">
            <b>通用诊断看什么</b>
            <p>不设方向。报告仍按这 6 个维度输出，只读，这里不能勾。</p>
            {dims}
          </section>
          <div className="qxt-hint"><p>只影响建议关注顺序，报告仍固定输出 6 个维度。</p></div>
        </>
      ) : (
        <>
          <div className="qxt-block">
            <div className="qxt-lab">重点看哪几维<small>默认 3 项，可增减</small></div>
            <div className="qxt-dimpick" role="group" aria-label="重点关注维度">
              {RESUME_SCORING_DIMENSIONS.map((item) => (
                <button type="button" key={item.key} aria-pressed={selectedDimensions.includes(item.key)} onClick={() => onToggleDimension(item.key)}>
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <div className="qxt-fields">
            <label className="qxt-field">
              <small>目标岗位</small>
              <input
                value={targetJob}
                onChange={(e) => onTargetJobChange(e.target.value.slice(0, 80))}
                placeholder="例如：前端工程师、财务助理"
              />
            </label>
            <button type="button" className="qxt-field" aria-haspopup="dialog" aria-label="选择行业方向" onClick={() => setShowIndustryPicker(true)}>
              <small>行业 · 全部 20 个门类</small>
              <b>{targetIndustry || '暂不指定'}</b>
            </button>
          </div>
          {onOpenMore ? (
            <button type="button" className="qxt-outlink" onClick={onOpenMore}>
              <span>更多条件（可不填）：经历、场景、专业、学历</span>
              <QxTouchIcon name="chevR" size={28} strokeWidth={2.2} />
            </button>
          ) : null}
          <section className="qxt-see" aria-label="报告仍会写出的维度">
            <b>报告仍固定写出这 6 维</b>
            <p>勾选只影响建议关注顺序。下面只读，不能在这里改勾选。</p>
            {dims}
          </section>
        </>
      )}
    </section>
  )
}
