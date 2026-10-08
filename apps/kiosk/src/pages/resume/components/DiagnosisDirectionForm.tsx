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
import { CheckIcon } from 'lucide-react'
import {
  COMMON_SECTOR_LABELS,
  JOB_CATEGORIES,
  JOB_OTHER,
  MAJOR_OPTIONS,
  TARGET_JOB_MAX,
  TARGET_MAJOR_MAX,
  categoryOfJob,
} from './resumeJobCatalog'

export interface DiagnosisDirectionFormProps {
  part: 'focus' | 'context'
  forceMore?: boolean
  intent: 'diagnose' | 'optimize'
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

const REPORT_ROWS = [
  '报告固定输出 6 个维度：基础信息完整度、求职目标清晰度、经历表达清晰度、成果量化程度、岗位关键词覆盖、版式与可读性 —— 这里怎么选，这 6 项都会出。',
  '风险表述提醒：只针对简历文本里的表达风险，不评价你这个人。',
  '修改优先级建议：先改哪几处更划算。重点维度只影响建议关注顺序，不增减报告内容。',
  '系统不会编造「超过多少人」「排名超过多少份简历」这类无法验证的结论，也不承诺提分幅度、不做录用预测、不做企业匹配。',
]

export type DiagnosisDirectionFields = Omit<DiagnosisDirectionFormProps, 'part' | 'forceMore'>

export function DiagnosisDirectionForm(props: DiagnosisDirectionFormProps) {
  if (props.part === 'focus') return <FocusPanel {...props} />
  return <ContextPanel {...props} />
}

function FocusPanel({
  genericDiagnosis, selectedDimensions, targetIndustry, targetJob, targetExperience, targetScene, targetMajor, targetDegree,
  onGenericDiagnosisChange, onToggleDimension,
}: DiagnosisDirectionFormProps) {
  const focus = RESUME_SCORING_DIMENSIONS.filter((item) => selectedDimensions.includes(item.key)).map((item) => item.label).join('、')
  const background = backgroundText({ genericDiagnosis, targetIndustry, targetJob, targetExperience, targetScene, targetMajor, targetDegree })
  return (
    <div className="qx-rt-work">
      <section className="qx-rt-block" aria-labelledby="qx-rt-scope-h">
        <h2 className="qx-rt-sec-h" id="qx-rt-scope-h">诊断范围 <small>两选一，随时能切回</small></h2>
        <div className="qx-rt-seg" role="group" aria-label="诊断范围">
          <button type="button" aria-pressed={!genericDiagnosis} onClick={() => onGenericDiagnosisChange(false)}>
            <b>定向诊断</b>
            <small>按你选的重点维度和目标背景排建议顺序</small>
          </button>
          <button type="button" aria-pressed={genericDiagnosis} onClick={() => onGenericDiagnosisChange(true)}>
            <b>通用诊断</b>
            <small>不指定方向，按通用标准整体看一遍</small>
          </button>
        </div>
      </section>

      <section className="qx-rt-block" aria-labelledby="qx-rt-dims-h">
        <h2 className="qx-rt-sec-h" id="qx-rt-dims-h">重点关注维度 <small>{genericDiagnosis ? '通用诊断下不生效' : '可多选，默认 3 项'}</small></h2>
        <div className="qx-rt-dimchips">
          {RESUME_SCORING_DIMENSIONS.map((item) => {
            if (genericDiagnosis) {
              return <span key={item.key} className="qx-rt-dimchip" data-off="true"><span className="tx">{item.label}</span></span>
            }
            const checked = selectedDimensions.includes(item.key)
            return (
              <button type="button" key={item.key} className="qx-rt-dimchip" aria-pressed={checked} onClick={() => onToggleDimension(item.key)}>
                <span className="mk" aria-hidden="true">{checked ? <CheckIcon size={18} strokeWidth={3} /> : null}</span>
                <span className="tx">{item.label}</span>
              </button>
            )
          })}
        </div>
      </section>

      <section className="qx-rt-block" aria-labelledby="qx-rt-fixed-h">
        <h2 className="qx-rt-sec-h" id="qx-rt-fixed-h">报告固定包含这些内容 <small>6 个维度 + 2 项结论，和系统里的报告结构一致，不随这里的选择增减</small></h2>
        <div className="qx-rt-report">
          {REPORT_ROWS.map((row) => <p key={row}>{row}</p>)}
        </div>
      </section>

      <section className="qx-rt-block" aria-labelledby="qx-rt-now-h">
        <h2 className="qx-rt-sec-h" id="qx-rt-now-h">这次的设置 <small>上面点一下，这里跟着变</small></h2>
        <dl className="qx-rt-kv">
          <div>
            <dt>诊断范围</dt>
            <dd>{genericDiagnosis ? '通用诊断' : '定向诊断'}<em>{genericDiagnosis ? '　不指定方向，按通用标准整体看一遍' : '　按你选的重点维度排建议顺序'}</em></dd>
          </div>
          <div><dt>重点维度</dt><dd>{genericDiagnosis ? '通用诊断（不指定重点维度）' : focus || '暂不指定'}</dd></div>
          <div><dt>目标背景</dt><dd>{background}</dd></div>
        </dl>
      </section>
    </div>
  )
}

function ContextPanel(props: DiagnosisDirectionFormProps) {
  const {
    forceMore = false, intent, targetIndustry, targetJob, targetExperience, targetScene, targetMajor, targetDegree,
    onTargetIndustryChange, onTargetJobChange, onTargetExperienceChange, onTargetSceneChange,
    onTargetMajorChange, onTargetDegreeChange, onOpenIndustry, onOpenOfficialChannels,
  } = props
  const [jobCat, setJobCat] = useState(() => categoryOfJob(targetJob))
  const [sectorsOpen, setSectorsOpen] = useState(false)
  const [showMore, setShowMore] = useState(() => forceMore || Boolean(targetMajor || targetDegree))
  const [majorOther, setMajorOther] = useState(() => Boolean(targetMajor) && !MAJOR_OPTIONS.includes(targetMajor as typeof MAJOR_OPTIONS[number]))
  const activeCategory = JOB_CATEGORIES.find((item) => item.key === jobCat)
  const majorInput = majorOther || (Boolean(targetMajor) && !MAJOR_OPTIONS.includes(targetMajor as typeof MAJOR_OPTIONS[number]))
  const verb = intent === 'optimize' ? '优化' : '诊断'
  const jobHint = targetJob
    ? `已选：${targetJob}`
    : jobCat === JOB_OTHER ? '在下面自己写一个，或留空不填' : jobCat ? '这一类里点一个，或留空不填' : '未选 · 这一项可以不填'

  return (
    <div className="qx-rt-work">
      {forceMore ? (
        <p className="qx-rt-note" data-testid="resume-profile-compat">
          <b>「专业与学历」已并入这一页</b>，不再单开一屏。从旧入口进来照样打得开，落到的就是同一块目标设置工作台，已经为你展开这两项。
        </p>
      ) : null}

      <section className="qx-rt-block" aria-labelledby="qx-rt-job-h">
        <h2 className="qx-rt-sec-h" id="qx-rt-job-h">目标岗位 <small>{intent === 'optimize' ? '优化按这个岗位的常用说法重写 · ' : '先点类别，再点具体职位 · '}{jobHint}</small></h2>
        <div className="qx-rt-jobcats" data-testid="resume-job-cats">
          {JOB_CATEGORIES.map((item) => (
            <button type="button" key={item.key} className="qx-rt-jcat" aria-current={jobCat === item.key ? 'true' : undefined} aria-pressed={targetJob === item.name} onClick={() => setJobCat(item.key)}>
              {item.name}
            </button>
          ))}
          <button
            type="button"
            className="qx-rt-jcat"
            data-more="true"
            aria-current={jobCat === JOB_OTHER ? 'true' : undefined}
            aria-pressed={categoryOfJob(targetJob) === JOB_OTHER && Boolean(targetJob.trim())}
            onClick={() => {
              setJobCat(JOB_OTHER)
              if (categoryOfJob(targetJob) !== JOB_OTHER) onTargetJobChange('')
            }}
          >
            其他岗位
          </button>
        </div>
        <JobPanel
          verb={verb}
          jobCat={jobCat}
          activeCategory={activeCategory}
          targetJob={targetJob}
          onTargetJobChange={onTargetJobChange}
        />
        <p className="qx-rt-hint">点开类别后列出这一类常见的具体职位。也可以只用类别本身，或者点「其他岗位」自己写一个。这一项不填也能{verb}。</p>
        <button type="button" className="qx-rt-alt" onClick={onOpenOfficialChannels}>
          <span>
            <strong>机构官方渠道</strong>
            <small>扫码到机构官网，了解公开信息。不会把岗位带回这里。</small>
          </span>
          <span className="go">扫码前往 →</span>
        </button>
      </section>

      <section className="qx-rt-block" data-testid="resume-industry-block">
        <div className="qx-rt-mh">
          <span>
            <b>行业门类</b>
            <small>当前：{targetIndustry || '暂不指定'} · 国家标准 GB/T 4754-2017 · 可不填</small>
          </span>
          <button type="button" className="qx-btn" data-variant="ghost" aria-expanded={sectorsOpen} onClick={() => setSectorsOpen((open) => !open)}>
            {sectorsOpen ? '收起门类表 ↑' : '全部 20 个门类 ↓'}
          </button>
        </div>
        {sectorsOpen ? (
          <div className="qx-rt-indsheet" data-testid="resume-industry-inline">
            {EMPLOYMENT_INDUSTRY_SECTORS.map((item) => (
              <button type="button" key={item.code} aria-pressed={targetIndustry === item.label} onClick={() => { onTargetIndustryChange(item.label); setSectorsOpen(false) }}>
                <i>{item.code}</i>
                <b>{item.label}</b>
              </button>
            ))}
          </div>
        ) : null}
        <div className="qx-rt-indchips" role="group" aria-label="行业门类">
          {COMMON_SECTOR_LABELS.map((label) => (
            <button type="button" key={label} className="qx-rt-chip" aria-pressed={targetIndustry === label} onClick={() => onTargetIndustryChange(label)}>{label}</button>
          ))}
          <button type="button" className="qx-rt-chip" data-mute="true" aria-pressed={targetIndustry === ''} onClick={() => onTargetIndustryChange('')}>暂不指定</button>
          <button type="button" className="qx-rt-chip" onClick={onOpenIndustry}>整屏门类表 →</button>
        </div>
        <p className="qx-rt-hint">前面这 6 个只是把常见门类排在前面方便点，不是推荐、不是热度，也不代表这台机器有对应岗位。</p>
      </section>

      <section className="qx-rt-block">
        <h2 className="qx-rt-sec-h">经验与求职场景 <small>各一行，都可以不填</small></h2>
        <ChipGroup id="qx-rt-exp" label="经验"
          options={[{ value: '', label: '不填' }, ...RESUME_TARGET_EXPERIENCE_OPTIONS.map((item) => ({ value: item, label: item }))]}
          value={targetExperience ?? ''}
          onChange={(value) => onTargetExperienceChange(value ? value as ResumeTargetContext['experience'] : undefined)}
        />
        <ChipGroup id="qx-rt-scene" label="求职场景"
          options={[{ value: '', label: '不填' }, ...RESUME_TARGET_SCENE_OPTIONS.map((item) => ({ value: item, label: item }))]}
          value={targetScene ?? ''}
          onChange={(value) => onTargetSceneChange(value ? value as ResumeTargetContext['scene'] : undefined)}
        />
      </section>

      <section className="qx-rt-block" id="qx-rt-more" data-testid="resume-major-block">
        <button type="button" className="qx-rt-drawer" aria-expanded={showMore || forceMore} onClick={() => setShowMore((open) => !open)}>
          <b>专业与学历</b>
          <small>选填 · 不填也能{verb}</small>
          <span className="go">{showMore || forceMore ? '收起 ↑' : '展开填写 ↓'}</span>
        </button>
        {showMore || forceMore ? (
          <div className="qx-rt-more">
            <div className="qx-rt-grp" role="group" aria-labelledby="qx-rt-major-lb">
              <span className="lb" id="qx-rt-major-lb">专业</span>
              <div className="ops">
                <button type="button" className="qx-rt-chip" data-mute="true" aria-pressed={targetMajor === ''} onClick={() => { setMajorOther(false); onTargetMajorChange('') }}>不填</button>
                {MAJOR_OPTIONS.map((item) => (
                  <button type="button" key={item} className="qx-rt-chip" aria-pressed={targetMajor === item} onClick={() => { setMajorOther(false); onTargetMajorChange(item) }}>{item}</button>
                ))}
                <button type="button" className="qx-rt-chip" aria-pressed={majorInput} onClick={() => { setMajorOther(true); if (MAJOR_OPTIONS.includes(targetMajor as typeof MAJOR_OPTIONS[number])) onTargetMajorChange('') }}>其他专业</button>
              </div>
              {majorInput ? (
                <label className="qx-rt-field">
                  <span className="lb">其他专业</span>
                  <input aria-label="专业（选填）" value={targetMajor} maxLength={TARGET_MAJOR_MAX} placeholder="例如：计算机科学与技术" onChange={(event) => onTargetMajorChange(event.target.value.slice(0, TARGET_MAJOR_MAX))} />
                </label>
              ) : null}
            </div>
            <ChipGroup id="qx-rt-degree" label="学历"
              options={[{ value: '', label: '不填' }, ...EDUCATION_LEVEL_OPTIONS.map((item) => ({ value: item, label: item }))]}
              value={targetDegree}
              onChange={onTargetDegreeChange}
            />
            <p className="qx-rt-hint">学历用的是系统里的 {EDUCATION_LEVEL_OPTIONS.length} 个层次，另有「不填」。这两项不影响能不能{verb}，也不会被用来判断资格。</p>
          </div>
        ) : null}
      </section>
    </div>
  )
}

function JobPanel({ verb, jobCat, activeCategory, targetJob, onTargetJobChange }: {
  verb: string
  jobCat: string
  activeCategory: (typeof JOB_CATEGORIES)[number] | undefined
  targetJob: string
  onTargetJobChange: (value: string) => void
}) {
  if (jobCat === JOB_OTHER) {
    return (
      <div className="qx-rt-jpanel" data-testid="resume-job-other">
        <p><b>其他岗位 · 自己写一个</b>上面 19 类里都没有合适的才用这里</p>
        <label className="qx-rt-field">
          <span className="lb">其他岗位</span>
          <input
            aria-label="其他岗位"
            value={categoryOfJob(targetJob) === JOB_OTHER ? targetJob : ''}
            maxLength={TARGET_JOB_MAX}
            placeholder="例如：甜品师、行车调度员"
            onChange={(event) => onTargetJobChange(event.target.value.slice(0, TARGET_JOB_MAX))}
          />
        </label>
      </div>
    )
  }
  if (!activeCategory) {
    return (
      <div className="qx-rt-jpanel" data-testid="resume-job-empty">
        <p><b>先点上面任意一个岗位类别</b>点开之后这里会列出这一类常见的具体职位，点一个就选中；也可以只用类别本身，或者点「其他岗位」自己写一个。这一项不填也能{verb}。</p>
      </div>
    )
  }
  return (
    <div className="qx-rt-jpanel" data-testid="resume-job-panel" role="group" aria-label={`${activeCategory.name}的常见职位`}>
      <p><b>{activeCategory.name} · 常见职位</b>{activeCategory.jobs.length} 个常见取值 · 点一个就选中</p>
      <div className="ops">
        <button type="button" className="qx-rt-chip" aria-pressed={targetJob === activeCategory.name} onClick={() => onTargetJobChange(activeCategory.name)}>整类：{activeCategory.name}</button>
        {activeCategory.jobs.map((job) => (
          <button type="button" key={job} className="qx-rt-chip" aria-pressed={targetJob === job} onClick={() => onTargetJobChange(job)}>{job}</button>
        ))}
        <button type="button" className="qx-rt-chip" data-mute="true" aria-pressed={targetJob === ''} onClick={() => onTargetJobChange('')}>暂不指定</button>
      </div>
    </div>
  )
}

function backgroundText(input: {
  genericDiagnosis: boolean
  targetIndustry: string
  targetJob: string
  targetExperience: ResumeTargetContext['experience']
  targetScene: ResumeTargetContext['scene']
  targetMajor: string
  targetDegree: string
}): string {
  if (input.genericDiagnosis) return '通用诊断，未填目标背景'
  const parts = [
    input.targetIndustry && input.targetIndustry !== '暂不指定' ? `行业：${input.targetIndustry}` : '',
    input.targetJob.trim() ? `岗位：${input.targetJob.trim()}` : '',
    input.targetExperience ? `经验：${input.targetExperience}` : '',
    input.targetScene ? `场景：${input.targetScene}` : '',
    input.targetMajor.trim() ? `专业：${input.targetMajor.trim()}` : '',
    input.targetDegree.trim() ? `学历：${input.targetDegree.trim()}` : '',
  ].filter(Boolean)
  return parts.length ? parts.join('　') : '目标背景：暂不指定'
}

function ChipGroup({ id, label, options, value, onChange }: {
  id: string
  label: string
  options: Array<{ value: string; label: string }>
  value: string | undefined
  onChange: (value: string) => void
}) {
  return (
    <div className="qx-rt-grp" role="group" aria-labelledby={`${id}-lb`}>
      <span className="lb" id={`${id}-lb`}>{label}</span>
      <div className="ops">
        {options.map((item) => (
          <button type="button" key={item.value || 'none'} className="qx-rt-chip" data-mute={item.value === '' ? 'true' : undefined} aria-pressed={(value ?? '') === item.value} onClick={() => onChange(item.value)}>
            {item.label}
          </button>
        ))}
      </div>
    </div>
  )
}
