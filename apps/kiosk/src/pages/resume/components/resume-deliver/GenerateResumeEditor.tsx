import type { GeneratedResume } from '@ai-job-print/shared'
import type { CSSProperties, ReactNode, Ref } from 'react'
import { useState } from 'react'
import { MaskedContactLine } from '../../../../components/MaskedContactLine'
import { DeleteEntryButton, EntryDeleteDialog } from './ResumeFactConfirmDialog'
import { resumeTitleIssues } from './resumeEntryTitles'

const taCls = 'qx-rg-ta'
type EntrySection = 'experience' | 'education'

function Tag({ kind, children }: { kind: 'keep' | 'pol'; children: string }) {
  return <span className="qx-rg-tag" data-kind={kind}>{children}</span>
}

function Block({ title, tags, children }: { title: string; tags: ReactNode; children: ReactNode }) {
  return (
    <section className="qx-rg-block">
      <h3>{title}{tags}</h3>
      {children}
    </section>
  )
}

function scrollFieldIntoView(event: { currentTarget: HTMLElement }) {
  event.currentTarget.scrollIntoView({ block: 'center', behavior: 'smooth' })
}

function TitleField(props: {
  caption: string
  label: string
  fieldId: string
  value: string
  message?: string
  onFocus: () => void
  onChange: (value: string) => void
}) {
  const errorId = `${props.fieldId}-error`
  return (
    <div>
      <label className="qx-rg-cap" htmlFor={props.fieldId}>{props.caption}</label>
      <input
        id={props.fieldId}
        className={`${taCls} qx-rg-title`}
        aria-label={props.label}
        data-entry-field={props.fieldId}
        data-entry-invalid={props.message ? 'true' : undefined}
        aria-invalid={props.message ? true : undefined}
        aria-describedby={props.message ? errorId : undefined}
        value={props.value}
        onFocus={(event) => { props.onFocus(); scrollFieldIntoView(event) }}
        onChange={(event) => props.onChange(event.target.value)}
      />
      {props.message ? <p className="qx-rd-error" id={errorId} role="alert">{props.message}</p> : null}
    </div>
  )
}

export function GenerateResumeEditor(props: {
  resume: GeneratedResume
  onChange: (next: GeneratedResume) => void
  previewClassName?: string
  previewStyle?: CSSProperties
  onEditingChange?: (editing: boolean) => void
  summaryRef?: Ref<HTMLTextAreaElement>
}) {
  const { resume, onChange } = props
  const mark = () => props.onEditingChange?.(true)
  const [pendingDelete, setPendingDelete] = useState<{ section: EntrySection; index: number } | null>(null)
  const issues = new Map(resumeTitleIssues(resume).map((issue) => [issue.id, issue.message]))
  const intention = [
    resume.intention.position,
    resume.intention.city ? `意向城市 ${resume.intention.city}` : '',
    resume.intention.jobType,
    resume.intention.salary,
  ].filter(Boolean).join(' · ')
  const confirmDelete = () => {
    if (!pendingDelete) return
    const { section, index } = pendingDelete
    mark()
    if (section === 'experience') {
      onChange({ ...resume, experience: resume.experience.filter((_, i) => i !== index) })
    } else {
      onChange({ ...resume, education: resume.education.filter((_, i) => i !== index) })
    }
    setPendingDelete(null)
  }

  return (
    <article className="qx-rg-sheet" data-testid="resume-generate-preview-sheet" style={props.previewStyle}>
      <header className="qx-rg-sheet-top">
        <b>{resume.basic.name || '未填写姓名'}</b>
        <span>{[resume.intention.position, resume.basic.city || resume.intention.city].filter(Boolean).join(' · ') || '意向还没写'}</span>
        <MaskedContactLine className="qx-rg-contact" phone={resume.basic.phone} email={resume.basic.email} />
      </header>
      <div className={`qx-rg-sheet-body ${props.previewClassName ?? ''}`}>
        <Block title="个人简介" tags={<Tag kind="pol">AI 润色</Tag>}>
          <textarea
            ref={props.summaryRef}
            className={taCls}
            aria-label="个人简介"
            value={resume.summary}
            placeholder="你没填自我评价，这里不会编一段"
            onFocus={mark}
            onChange={(e) => onChange({ ...resume, summary: e.target.value.slice(0, 600) })}
          />
        </Block>
        <Block title="求职意向" tags={<Tag kind="keep">原样保留</Tag>}>
          <p>{intention || '这一项还空着，要改得回填写页。'}</p>
        </Block>
        {resume.education.length > 0 && (
          <Block title="教育经历" tags={<><Tag kind="keep">事实原样</Tag><Tag kind="pol">描述润色</Tag></>}>
            {resume.education.map((item, i) => {
              const schoolId = `education-${i}-school`
              const majorId = `education-${i}-major`
              return (
                <div key={schoolId} className="qx-rg-entry">
                  <TitleField
                    caption="学校"
                    label={`第 ${i + 1} 条教育的学校`}
                    fieldId={schoolId}
                    value={item.school}
                    message={issues.get(schoolId)}
                    onFocus={mark}
                    onChange={(school) => onChange({
                      ...resume,
                      education: resume.education.map((row, idx) => idx === i ? { ...row, school } : row),
                    })}
                  />
                  <TitleField
                    caption="专业"
                    label={`第 ${i + 1} 条教育的专业`}
                    fieldId={majorId}
                    value={item.major ?? ''}
                    message={issues.get(majorId)}
                    onFocus={mark}
                    onChange={(major) => onChange({
                      ...resume,
                      education: resume.education.map((row, idx) => idx === i ? { ...row, major } : row),
                    })}
                  />
                  {(item.degree || item.period) && (
                    <p>{[item.degree, item.period].filter(Boolean).join(' · ')}</p>
                  )}
                  <textarea
                    className={taCls}
                    aria-label={`教育经历描述 ${i + 1}`}
                    value={item.description ?? ''}
                    placeholder="这一段没有描述"
                    onFocus={mark}
                    onChange={(ev) => onChange({
                      ...resume,
                      education: resume.education.map((row, idx) => idx === i ? { ...row, description: ev.target.value.slice(0, 1000) } : row),
                    })}
                  />
                  <DeleteEntryButton label={`删掉这一条，第 ${i + 1} 条教育`} onClick={() => setPendingDelete({ section: 'education', index: i })} />
                </div>
              )
            })}
          </Block>
        )}
        {resume.experience.length > 0 && (
          <Block title="实习 / 工作经历" tags={<><Tag kind="keep">事实原样</Tag><Tag kind="pol">描述润色</Tag></>}>
            {resume.experience.map((item, i) => {
              const companyId = `experience-${i}-company`
              const roleId = `experience-${i}-role`
              return (
                <div key={companyId} className="qx-rg-entry">
                  <TitleField
                    caption="公司"
                    label={`第 ${i + 1} 条经历的公司`}
                    fieldId={companyId}
                    value={item.company}
                    message={issues.get(companyId)}
                    onFocus={mark}
                    onChange={(company) => onChange({
                      ...resume,
                      experience: resume.experience.map((row, idx) => idx === i ? { ...row, company } : row),
                    })}
                  />
                  <TitleField
                    caption="职务"
                    label={`第 ${i + 1} 条经历的职务`}
                    fieldId={roleId}
                    value={item.role}
                    message={issues.get(roleId)}
                    onFocus={mark}
                    onChange={(role) => onChange({
                      ...resume,
                      experience: resume.experience.map((row, idx) => idx === i ? { ...row, role } : row),
                    })}
                  />
                  {item.period ? <p>{item.period}</p> : null}
                  <textarea
                    className={taCls}
                    aria-label={`工作经历描述 ${i + 1}`}
                    value={item.description}
                    placeholder="这一段没有描述"
                    onFocus={mark}
                    onChange={(ev) => onChange({
                      ...resume,
                      experience: resume.experience.map((row, idx) => idx === i ? { ...row, description: ev.target.value.slice(0, 1000) } : row),
                    })}
                  />
                  <DeleteEntryButton label={`删掉这一条，第 ${i + 1} 条经历`} onClick={() => setPendingDelete({ section: 'experience', index: i })} />
                </div>
              )
            })}
          </Block>
        )}
        {resume.projects.length > 0 && (
          <Block title="项目经历" tags={<><Tag kind="keep">事实原样</Tag><Tag kind="pol">描述润色</Tag></>}>
            {resume.projects.map((item, i) => (
              <div key={i} className="qx-rg-entry">
                <p><b>{item.role ? `${item.name} · ${item.role}` : item.name}</b></p>
                <textarea
                  className={taCls}
                  aria-label={`项目经历描述 ${i + 1}`}
                  value={item.description}
                  placeholder="这一段没有描述"
                  onFocus={mark}
                  onChange={(ev) => onChange({
                    ...resume,
                    projects: resume.projects.map((row, idx) => idx === i ? { ...row, description: ev.target.value.slice(0, 1000) } : row),
                  })}
                />
              </div>
            ))}
          </Block>
        )}
        {resume.skills.length > 0 && (
          <Block title="技能" tags={<Tag kind="pol">表达整理</Tag>}>
            <p>{resume.skills.join(' · ')}</p>
          </Block>
        )}
        {resume.certificates.length > 0 && (
          <Block title="证书 / 资质" tags={<Tag kind="keep">原样保留</Tag>}>
            <p>{resume.certificates.join(' · ')}</p>
          </Block>
        )}
      </div>
      {pendingDelete && (
        <EntryDeleteDialog
          hostSelector='[data-kiosk-screen="resume-generate-preview"]'
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmDelete}
        />
      )}
    </article>
  )
}
