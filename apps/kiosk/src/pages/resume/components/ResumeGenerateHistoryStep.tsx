import type { ReactNode } from 'react'
import { BriefcaseIcon } from 'lucide-react'
import { EDUCATION_LEVEL_OPTIONS } from '@ai-job-print/shared'
import type { ResumeGenEducation, ResumeGenExperience, ResumeGenProject } from '@ai-job-print/shared'
import { ChipRow, EntryList, Field, GenerateStepHeading } from './ResumeGenerateShell'
import {
  EMPTY_EDU,
  EMPTY_EXP,
  EMPTY_PROJ,
  LIMITS,
  toggleSingle,
  type HistorySeg,
} from './resumeGenerateModel'

function keptCount(kind: HistorySeg, education: ResumeGenEducation[], experience: ResumeGenExperience[], projects: ResumeGenProject[]): string {
  if (kind === 'edu') {
    const kept = education.filter((item) => item.school.trim()).length
    return `${kept}/${education.length}`
  }
  if (kind === 'exp') {
    const kept = experience.filter((item) => item.company.trim() && item.role.trim()).length
    return `${kept}/${experience.length}`
  }
  const kept = projects.filter((item) => item.name.trim()).length
  return `${kept}/${projects.length}`
}

function Status({ ok, need }: { ok: boolean; need: string }) {
  return <span className="qx-rg-ent-st" data-on={ok ? '1' : undefined}>{ok ? '会提交' : `不会提交 · ${need}`}</span>
}

export function ResumeGenerateHistoryStep(props: {
  seg: HistorySeg
  onSeg: (seg: HistorySeg) => void
  education: ResumeGenEducation[]
  experience: ResumeGenExperience[]
  projects: ResumeGenProject[]
  onEducation: (next: ResumeGenEducation[]) => void
  onExperience: (next: ResumeGenExperience[]) => void
  onProjects: (next: ResumeGenProject[]) => void
  educationVoice: (index: number) => ReactNode
  experienceVoice: (index: number) => ReactNode
  projectVoice: (index: number) => ReactNode
}) {
  const tabs: Array<{ id: HistorySeg; name: string }> = [
    { id: 'edu', name: '教育' },
    { id: 'exp', name: '经历' },
    { id: 'proj', name: '项目' },
  ]
  return (
    <>
      <GenerateStepHeading icon={<BriefcaseIcon size={26} />} title="经历" hint="半空的条目不会提交" />
      <div className="qx-rg-seg" role="tablist" aria-label="经历分类">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={props.seg === tab.id}
            data-testid={`resume-generate-seg-${tab.id}`}
            onClick={() => props.onSeg(tab.id)}
          >
            {tab.name}
            <em>{keptCount(tab.id, props.education, props.experience, props.projects)} 条会提交</em>
          </button>
        ))}
      </div>
      <p className="qx-rg-chiphead" data-testid="resume-generate-seg-note">
        描述这一栏可以说，不用打字 · <b>学校 / 公司 / 职务 / 时间只能你自己填</b>
      </p>
      {props.seg === 'edu' ? (
        <EntryList
          items={props.education}
          maxItems={LIMITS.education}
          addLabel={`添加一段教育（最多 ${LIMITS.education} 段）`}
          empty={<EmptySeg kind="edu" />}
          onAdd={() => props.onEducation([...props.education, { ...EMPTY_EDU }])}
          onRemove={(index) => props.onEducation(props.education.filter((_, i) => i !== index))}
          renderItem={(item, index) => (
            <EduCard
              item={item}
              index={index}
              voice={props.educationVoice(index)}
              onChange={(next) => props.onEducation(props.education.map((row, i) => i === index ? next : row))}
            />
          )}
        />
      ) : null}
      {props.seg === 'exp' ? (
        <EntryList
          items={props.experience}
          maxItems={LIMITS.experience}
          addLabel={`添加一段经历（最多 ${LIMITS.experience} 段）`}
          empty={<EmptySeg kind="exp" />}
          onAdd={() => props.onExperience([...props.experience, { ...EMPTY_EXP }])}
          onRemove={(index) => props.onExperience(props.experience.filter((_, i) => i !== index))}
          renderItem={(item, index) => (
            <ExpCard
              item={item}
              index={index}
              voice={props.experienceVoice(index)}
              onChange={(next) => props.onExperience(props.experience.map((row, i) => i === index ? next : row))}
            />
          )}
        />
      ) : null}
      {props.seg === 'proj' ? (
        <EntryList
          items={props.projects}
          maxItems={LIMITS.projects}
          addLabel={`添加一段项目（最多 ${LIMITS.projects} 段）`}
          empty={<EmptySeg kind="proj" />}
          onAdd={() => props.onProjects([...props.projects, { ...EMPTY_PROJ }])}
          onRemove={(index) => props.onProjects(props.projects.filter((_, i) => i !== index))}
          renderItem={(item, index) => (
            <ProjCard
              item={item}
              index={index}
              voice={props.projectVoice(index)}
              onChange={(next) => props.onProjects(props.projects.map((row, i) => i === index ? next : row))}
            />
          )}
        />
      ) : null}
    </>
  )
}

function EmptySeg({ kind }: { kind: HistorySeg }) {
  const name = kind === 'edu' ? '教育' : kind === 'exp' ? '经历' : '项目'
  const extra = kind === 'proj'
    ? '项目和工作经历只要有一样就行。社团活动、校内比赛、帮家里看店，只要是你真做过的都能写。'
    : kind === 'edu'
      ? '没读完也可以写：写到哪一年就是哪一年，AI 不会替你补一个学位。'
      : '第一份工作、实习、寒暑假的兼职都算，写清楚做了什么比写头衔管用。'
  return (
    <div className="qx-card qx-rd-entry" data-testid={`resume-generate-${kind}-empty`}>
      <div className="qx-rg-ent-h"><b>还没有{name}</b><span className="qx-rg-ent-st">这一类可以空着</span></div>
      <p>空着也能生成，只是预览页会算出一条提示让你回来补。那是按规则算的，不是 AI 编的。</p>
      <p>{extra}</p>
    </div>
  )
}

function EduCard(props: { item: ResumeGenEducation; index: number; voice: ReactNode; onChange: (next: ResumeGenEducation) => void }) {
  const item = props.item
  const set = (patch: Partial<ResumeGenEducation>) => props.onChange({ ...item, ...patch })
  return (
    <div data-testid={`resume-generate-edu-${props.index}`}>
      <div className="qx-rg-ent-h">
        <b>教育 第 {props.index + 1} 条</b>
        <Status ok={Boolean(item.school.trim())} need="缺学校" />
      </div>
      <div className="qx-rg-grid">
        <Field label="学校" required>
          <input className="qx-rd-field" value={item.school} onChange={(event) => set({ school: event.target.value })} />
        </Field>
        <Field label="专业">
          <input className="qx-rd-field" value={item.major ?? ''} onChange={(event) => set({ major: event.target.value })} />
        </Field>
        <Field label="起止时间">
          <input className="qx-rd-field" placeholder="如 2023.09 - 2026.06" value={item.period ?? ''} onChange={(event) => set({ period: event.target.value })} />
        </Field>
        <Field label="学历">
          <input className="qx-rd-field" placeholder="点下面的选项，或自己写" value={item.degree ?? ''} onChange={(event) => set({ degree: event.target.value })} />
        </Field>
      </div>
      <ChipRow
        title="学历"
        options={EDUCATION_LEVEL_OPTIONS}
        current={item.degree ?? ''}
        testId={`resume-generate-chip-degree-${props.index}`}
        onToggle={(chip) => set({ degree: toggleSingle(item.degree ?? '', chip) })}
      />
      <Field label="在校情况（选填，AI 会润色）">
        <textarea className="qx-rd-field" placeholder="主修课程、获奖、社团都可以说" value={item.description ?? ''} onChange={(event) => set({ description: event.target.value })} />
        <div className="qx-rg-voice">{props.voice}</div>
      </Field>
    </div>
  )
}

function ExpCard(props: { item: ResumeGenExperience; index: number; voice: ReactNode; onChange: (next: ResumeGenExperience) => void }) {
  const item = props.item
  const set = (patch: Partial<ResumeGenExperience>) => props.onChange({ ...item, ...patch })
  return (
    <div data-testid={`resume-generate-exp-${props.index}`}>
      <div className="qx-rg-ent-h">
        <b>经历 第 {props.index + 1} 条</b>
        <Status ok={Boolean(item.company.trim() && item.role.trim())} need="缺公司或职务" />
      </div>
      <div className="qx-rg-grid">
        <Field label="公司 / 单位" required>
          <input className="qx-rd-field" value={item.company} onChange={(event) => set({ company: event.target.value })} />
        </Field>
        <Field label="职位" required>
          <input className="qx-rd-field" value={item.role} onChange={(event) => set({ role: event.target.value })} />
        </Field>
        <div className="qx-rg-span">
          <Field label="起止时间">
            <input className="qx-rd-field" placeholder="如 2025.07 - 2025.08" value={item.period ?? ''} onChange={(event) => set({ period: event.target.value })} />
          </Field>
        </div>
        <div className="qx-rg-span">
          <Field label="做了什么（AI 会润色，事实不改）">
            <textarea className="qx-rd-field" placeholder="负责什么、用什么工具、做出什么结果，有数字写数字" value={item.description} onChange={(event) => set({ description: event.target.value })} />
            <div className="qx-rg-voice">{props.voice}</div>
          </Field>
        </div>
      </div>
    </div>
  )
}

function ProjCard(props: { item: ResumeGenProject; index: number; voice: ReactNode; onChange: (next: ResumeGenProject) => void }) {
  const item = props.item
  const set = (patch: Partial<ResumeGenProject>) => props.onChange({ ...item, ...patch })
  return (
    <div data-testid={`resume-generate-proj-${props.index}`}>
      <div className="qx-rg-ent-h">
        <b>项目 第 {props.index + 1} 条</b>
        <Status ok={Boolean(item.name.trim())} need="缺项目名称" />
      </div>
      <div className="qx-rg-grid">
        <Field label="项目名称" required>
          <input className="qx-rd-field" value={item.name} onChange={(event) => set({ name: event.target.value })} />
        </Field>
        <Field label="担任角色">
          <input className="qx-rd-field" value={item.role ?? ''} onChange={(event) => set({ role: event.target.value })} />
        </Field>
        <div className="qx-rg-span">
          <Field label="项目内容（AI 会润色，事实不改）">
            <textarea className="qx-rd-field" value={item.description} onChange={(event) => set({ description: event.target.value })} />
            <div className="qx-rg-voice">{props.voice}</div>
          </Field>
        </div>
      </div>
    </div>
  )
}
