import type { CSSProperties } from 'react'
import { useState } from 'react'
import { PencilLineIcon, ShieldCheckIcon } from 'lucide-react'
import { Card } from '@ai-job-print/ui'
import type { GeneratedResume, ResumeLayoutSettings } from '@ai-job-print/shared'
import { MaskedContactLine } from '../../../components/MaskedContactLine'
import { ProjectTitleFields, ResumeTagList } from './resume-deliver/ResumeEntryFields'
import { DeleteEntryButton, EntryDeleteDialog } from './resume-deliver/ResumeFactConfirmDialog'
import { RESUME_EDIT_LIMITS, resumeTitleIssues } from './resume-deliver/resumeEntryTitles'

type OptimizedResumeEditorProps = {
  resume: GeneratedResume
  onChange: (next: GeneratedResume) => void
  layout: ResumeLayoutSettings
  previewClassName?: string
  previewStyle?: CSSProperties
}

type EntrySection = 'experience' | 'education'

const taCls =
  'w-full scroll-mt-32 rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm leading-relaxed text-gray-800 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100'

function SectionTitle({ title }: { title: string }) {
  return (
    <div className="mb-2 flex items-center gap-2">
      <span className="h-4 w-1 rounded-full bg-[var(--resume-accent,#2563eb)]" aria-hidden="true" />
      <p className="text-base font-semibold text-gray-900">{title}</p>
    </div>
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
  onChange: (value: string) => void
}) {
  const errorId = `${props.fieldId}-error`
  return (
    <div className="mt-1.5">
      <label className="block text-sm text-gray-500" htmlFor={props.fieldId}>{props.caption}</label>
      <input
        id={props.fieldId}
        className={`${taCls} mt-1 min-h-12`}
        aria-label={props.label}
        data-entry-field={props.fieldId}
        data-entry-invalid={props.message ? 'true' : undefined}
        aria-invalid={props.message ? true : undefined}
        aria-describedby={props.message ? errorId : undefined}
        value={props.value}
        onFocus={scrollFieldIntoView}
        onChange={(event) => props.onChange(event.target.value)}
      />
      {props.message ? <p className="qx-rd-error" id={errorId} role="alert">{props.message}</p> : null}
    </div>
  )
}

export function OptimizedResumeEditor({
  resume,
  onChange,
  layout,
  previewClassName = '',
  previewStyle,
}: OptimizedResumeEditorProps) {
  const [pendingDelete, setPendingDelete] = useState<{ section: EntrySection; index: number } | null>(null)
  const issues = new Map(resumeTitleIssues(resume).map((issue) => [issue.id, issue.message]))
  const confirmDelete = () => {
    if (!pendingDelete) return
    const { section, index } = pendingDelete
    if (section === 'experience') {
      onChange({ ...resume, experience: resume.experience.filter((_, i) => i !== index) })
    } else {
      onChange({ ...resume, education: resume.education.filter((_, i) => i !== index) })
    }
    setPendingDelete(null)
  }

  return (
    <>
      <Card className="p-6" style={previewStyle}>
        <div className="mb-4 flex items-center justify-between">
          <p className="text-lg font-bold text-gray-900">优化版简历</p>
          <p className="flex items-center gap-1 text-xs text-gray-400">
            <PencilLineIcon className="h-3.5 w-3.5" aria-hidden="true" />
            可直接点击修改
          </p>
        </div>
        <div className="border-b-2 border-[var(--resume-accent,#2563eb)] pb-3">
          <p className="text-2xl font-bold text-gray-900">{resume.basic.name || '(原文未识别到姓名)'}</p>
          <MaskedContactLine
            className="mt-1 text-sm text-gray-500"
            phone={resume.basic.phone}
            email={resume.basic.email}
            extra={[resume.intention.position ? `求职意向:${resume.intention.position}` : '']}
          />
        </div>

        <div
          className={`mt-4 space-y-5 text-[calc(1rem*var(--resume-font-scale,1))] leading-[var(--resume-line-height,1.62)] ${previewClassName}`}
          data-layout-columns={layout.columns ?? 1}
          data-resume-editor=""
        >
          <div>
            <SectionTitle title="个人简介" />
            <textarea
              className={`${taCls} min-h-24 resize-y`}
              aria-label="个人简介"
              data-entry-field="summary"
              maxLength={RESUME_EDIT_LIMITS.summary}
              value={resume.summary}
              placeholder="(空)"
              onFocus={scrollFieldIntoView}
              onChange={(e) => onChange({ ...resume, summary: e.target.value })}
            />
          </div>

          {resume.education.length > 0 && (
            <div>
              <SectionTitle title="教育经历" />
              <div className="space-y-3">
                {resume.education.map((e, i) => {
                  const schoolId = `education-${i}-school`
                  const majorId = `education-${i}-major`
                  return (
                    <div key={schoolId} className="break-inside-avoid">
                      {(e.degree || e.period) && (
                        <p className="text-xs text-gray-400">{[e.degree, e.period].filter(Boolean).join(' · ')}</p>
                      )}
                      <TitleField
                        caption="学校"
                        label={`第 ${i + 1} 条教育的学校`}
                        fieldId={schoolId}
                        value={e.school}
                        message={issues.get(schoolId)}
                        onChange={(school) => onChange({
                          ...resume,
                          education: resume.education.map((row, idx) => idx === i ? { ...row, school } : row),
                        })}
                      />
                      <TitleField
                        caption="专业"
                        label={`第 ${i + 1} 条教育的专业`}
                        fieldId={majorId}
                        value={e.major ?? ''}
                        message={issues.get(majorId)}
                        onChange={(major) => onChange({
                          ...resume,
                          education: resume.education.map((row, idx) => idx === i ? { ...row, major } : row),
                        })}
                      />
                      <textarea
                        className={`${taCls} mt-1.5 min-h-20 resize-y`}
                        aria-label={`第 ${i + 1} 条教育的描述`}
                        data-entry-field={`education-${i}-description`}
                        maxLength={RESUME_EDIT_LIMITS.description}
                        value={e.description ?? ''}
                        placeholder="(无描述)"
                        onFocus={scrollFieldIntoView}
                        onChange={(ev) => onChange({
                          ...resume,
                          education: resume.education.map((row, idx) => idx === i ? { ...row, description: ev.target.value } : row),
                        })}
                      />
                      <DeleteEntryButton label={`删掉这一条，第 ${i + 1} 条教育`} onClick={() => setPendingDelete({ section: 'education', index: i })} />
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {resume.experience.length > 0 && (
            <div>
              <SectionTitle title="实习 / 工作经历" />
              <div className="space-y-3">
                {resume.experience.map((e, i) => {
                  const companyId = `experience-${i}-company`
                  const roleId = `experience-${i}-role`
                  return (
                    <div key={companyId} className="break-inside-avoid">
                      {e.period ? <p className="text-xs text-gray-400">{e.period}</p> : null}
                      <TitleField
                        caption="公司"
                        label={`第 ${i + 1} 条经历的公司`}
                        fieldId={companyId}
                        value={e.company}
                        message={issues.get(companyId)}
                        onChange={(company) => onChange({
                          ...resume,
                          experience: resume.experience.map((row, idx) => idx === i ? { ...row, company } : row),
                        })}
                      />
                      <TitleField
                        caption="职务"
                        label={`第 ${i + 1} 条经历的职务`}
                        fieldId={roleId}
                        value={e.role}
                        message={issues.get(roleId)}
                        onChange={(role) => onChange({
                          ...resume,
                          experience: resume.experience.map((row, idx) => idx === i ? { ...row, role } : row),
                        })}
                      />
                      <textarea
                        className={`${taCls} mt-1.5 min-h-24 resize-y`}
                        aria-label={`第 ${i + 1} 条经历的描述`}
                        data-entry-field={`experience-${i}-description`}
                        maxLength={RESUME_EDIT_LIMITS.description}
                        value={e.description}
                        onFocus={scrollFieldIntoView}
                        onChange={(ev) => onChange({
                          ...resume,
                          experience: resume.experience.map((row, idx) => idx === i ? { ...row, description: ev.target.value } : row),
                        })}
                      />
                      <DeleteEntryButton label={`删掉这一条，第 ${i + 1} 条经历`} onClick={() => setPendingDelete({ section: 'experience', index: i })} />
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {resume.projects.length > 0 && (
            <div>
              <SectionTitle title="项目经历" />
              <div className="space-y-3">
                {resume.projects.map((p, i) => (
                  <div key={i} className="break-inside-avoid">
                    <ProjectTitleFields
                      index={i}
                      name={p.name}
                      role={p.role ?? ''}
                      className={`${taCls} mt-1 min-h-12`}
                      onName={(name) => onChange({
                        ...resume,
                        projects: resume.projects.map((row, idx) => idx === i ? { ...row, name } : row),
                      })}
                      onRole={(role) => onChange({
                        ...resume,
                        projects: resume.projects.map((row, idx) => idx === i ? { ...row, role } : row),
                      })}
                    />
                    <textarea
                      className={`${taCls} mt-1.5 min-h-24 resize-y`}
                      aria-label={`第 ${i + 1} 条项目的描述`}
                      data-entry-field={`projects-${i}-description`}
                      maxLength={RESUME_EDIT_LIMITS.description}
                      value={p.description}
                      onFocus={scrollFieldIntoView}
                      onChange={(ev) => onChange({
                        ...resume,
                        projects: resume.projects.map((row, idx) => idx === i ? { ...row, description: ev.target.value } : row),
                      })}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          <div>
            <SectionTitle title="技能" />
            <ResumeTagList
              items={resume.skills}
              field="skill"
              appearance="chip"
              onChange={(skills) => onChange({ ...resume, skills })}
            />
          </div>

          <div>
            <SectionTitle title="证书 / 资质" />
            <ResumeTagList
              items={resume.certificates}
              field="certificate"
              appearance="chip"
              onChange={(certificates) => onChange({ ...resume, certificates })}
            />
          </div>
        </div>
      </Card>

      <p className="flex items-center gap-1.5 text-xs text-gray-400">
        <ShieldCheckIcon className="h-3.5 w-3.5" aria-hidden="true" />
        优化版中的学校/公司/证书等事实信息均来自你的简历原文,AI 未做任何添加;原文没有的内容保持为空,由你自行补充。
      </p>
      {pendingDelete && (
        <EntryDeleteDialog hostSelector='[data-kiosk-screen="resume-optimize"]' onCancel={() => setPendingDelete(null)} onConfirm={confirmDelete} />
      )}
    </>
  )
}
