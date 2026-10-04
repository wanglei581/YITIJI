import type { CSSProperties } from 'react'
import { useState } from 'react'
import { createPortal } from 'react-dom'
import { PencilLineIcon, ShieldCheckIcon } from 'lucide-react'
import { Card } from '@ai-job-print/ui'
import type { GeneratedResume, ResumeLayoutSettings } from '@ai-job-print/shared'
import { MaskedContactLine } from '../../../components/MaskedContactLine'
import { resumeTitleIssues } from './resume-deliver/resumeEntryTitles'

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

function DeleteEntryButton(props: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="qx-btn mt-1.5" data-variant="ghost" aria-label={props.label} onClick={props.onClick}>
      删掉这一条
    </button>
  )
}

function EntryDeleteDialog(props: { onCancel: () => void; onConfirm: () => void }) {
  const dialog = (
    <div className="qx-rd-overlay" role="dialog" aria-modal="true" aria-labelledby="resume-entry-delete-title">
      <div className="qx-rd-dialog">
        <h2 id="resume-entry-delete-title">确定删掉这一条吗？</h2>
        <p>删了以后导出和打印都不会再带这一条。</p>
        <div className="qx-rd-dialog-actions">
          <button type="button" className="qx-btn" data-variant="ghost" onClick={props.onCancel}>取消</button>
          <button type="button" className="qx-btn" data-variant="primary" onClick={props.onConfirm}>确定</button>
        </div>
      </div>
    </div>
  )
  const host = typeof document !== 'undefined' ? document.querySelector('[data-kiosk-screen="resume-optimize"]') : null
  return host ? createPortal(dialog, host) : dialog
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
        >
          <div>
            <SectionTitle title="个人简介" />
            <textarea
              className={`${taCls} min-h-24 resize-y`}
              value={resume.summary}
              placeholder="(空)"
              onFocus={scrollFieldIntoView}
              onChange={(e) => onChange({ ...resume, summary: e.target.value.slice(0, 600) })}
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
                        value={e.description ?? ''}
                        placeholder="(无描述)"
                        onFocus={scrollFieldIntoView}
                        onChange={(ev) => onChange({
                          ...resume,
                          education: resume.education.map((row, idx) => idx === i ? { ...row, description: ev.target.value.slice(0, 1000) } : row),
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
                        value={e.description}
                        onFocus={scrollFieldIntoView}
                        onChange={(ev) => onChange({
                          ...resume,
                          experience: resume.experience.map((row, idx) => idx === i ? { ...row, description: ev.target.value.slice(0, 1000) } : row),
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
                    <p className="text-sm font-semibold text-gray-800">{p.role ? `${p.name} · ${p.role}` : p.name}</p>
                    <textarea
                      className={`${taCls} mt-1.5 min-h-24 resize-y`}
                      aria-label={`第 ${i + 1} 条项目的描述`}
                      value={p.description}
                      onFocus={scrollFieldIntoView}
                      onChange={(ev) => onChange({
                        ...resume,
                        projects: resume.projects.map((row, idx) => idx === i ? { ...row, description: ev.target.value.slice(0, 1000) } : row),
                      })}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {resume.skills.length > 0 && (
            <div>
              <SectionTitle title="技能" />
              <div className="flex flex-wrap gap-2">
                {resume.skills.map((s, i) => (
                  <span key={i} className="rounded-lg bg-primary-50 px-2.5 py-1 text-sm text-primary-700">{s}</span>
                ))}
              </div>
            </div>
          )}

          {resume.certificates.length > 0 && (
            <div>
              <SectionTitle title="证书 / 资质" />
              <p className="text-sm text-gray-700">{resume.certificates.join(' · ')}</p>
            </div>
          )}
        </div>
      </Card>

      <p className="flex items-center gap-1.5 text-xs text-gray-400">
        <ShieldCheckIcon className="h-3.5 w-3.5" aria-hidden="true" />
        优化版中的学校/公司/证书等事实信息均来自你的简历原文,AI 未做任何添加;原文没有的内容保持为空,由你自行补充。
      </p>
      {pendingDelete && (
        <EntryDeleteDialog onCancel={() => setPendingDelete(null)} onConfirm={confirmDelete} />
      )}
    </>
  )
}
