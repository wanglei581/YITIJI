import type { CSSProperties } from 'react'
import { PencilLineIcon, ShieldCheckIcon } from 'lucide-react'
import { Card } from '@ai-job-print/ui'
import type { GeneratedResume, ResumeLayoutSettings } from '@ai-job-print/shared'

type OptimizedResumeEditorProps = {
  resume: GeneratedResume
  onChange: (next: GeneratedResume) => void
  layout: ResumeLayoutSettings
  previewClassName?: string
  previewStyle?: CSSProperties
}

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

export function OptimizedResumeEditor({
  resume,
  onChange,
  layout,
  previewClassName = '',
  previewStyle,
}: OptimizedResumeEditorProps) {
  const update = (next: GeneratedResume) => onChange(next)

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
          <p className="mt-1 text-sm text-gray-500">
            {[
              resume.intention.position ? `求职意向:${resume.intention.position}` : '',
              resume.basic.phone ? `电话:${resume.basic.phone}` : '',
              resume.basic.email ? `邮箱:${resume.basic.email}` : '',
            ].filter(Boolean).join(' · ')}
          </p>
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
              onFocus={(e) => e.currentTarget.scrollIntoView({ block: 'center', behavior: 'smooth' })}
              onChange={(e) => update({ ...resume, summary: e.target.value.slice(0, 600) })}
            />
          </div>

          {resume.education.length > 0 && (
            <div>
              <SectionTitle title="教育经历" />
              <div className="space-y-3">
                {resume.education.map((e, i) => (
                  <div key={i} className="break-inside-avoid">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-sm font-semibold text-gray-800">
                        {[e.school, e.major, e.degree].filter(Boolean).join(' · ')}
                      </p>
                      {e.period && <p className="shrink-0 text-xs text-gray-400">{e.period}</p>}
                    </div>
                    <textarea
                      className={`${taCls} mt-1.5 min-h-20 resize-y`}
                      value={e.description ?? ''}
                      placeholder="(无描述)"
                      onFocus={(ev) => ev.currentTarget.scrollIntoView({ block: 'center', behavior: 'smooth' })}
                      onChange={(ev) => update({
                        ...resume,
                        education: resume.education.map((x, idx) => idx === i ? { ...x, description: ev.target.value.slice(0, 1000) } : x),
                      })}
                    />
                  </div>
                ))}
              </div>
            </div>
          )}

          {resume.experience.length > 0 && (
            <div>
              <SectionTitle title="实习 / 工作经历" />
              <div className="space-y-3">
                {resume.experience.map((e, i) => (
                  <div key={i} className="break-inside-avoid">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-sm font-semibold text-gray-800">{e.company} · {e.role}</p>
                      {e.period && <p className="shrink-0 text-xs text-gray-400">{e.period}</p>}
                    </div>
                    <textarea
                      className={`${taCls} mt-1.5 min-h-24 resize-y`}
                      value={e.description}
                      onFocus={(ev) => ev.currentTarget.scrollIntoView({ block: 'center', behavior: 'smooth' })}
                      onChange={(ev) => update({
                        ...resume,
                        experience: resume.experience.map((x, idx) => idx === i ? { ...x, description: ev.target.value.slice(0, 1000) } : x),
                      })}
                    />
                  </div>
                ))}
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
                      value={p.description}
                      onFocus={(ev) => ev.currentTarget.scrollIntoView({ block: 'center', behavior: 'smooth' })}
                      onChange={(ev) => update({
                        ...resume,
                        projects: resume.projects.map((x, idx) => idx === i ? { ...x, description: ev.target.value.slice(0, 1000) } : x),
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
    </>
  )
}
