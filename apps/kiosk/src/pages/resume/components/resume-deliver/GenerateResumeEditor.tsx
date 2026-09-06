import type { GeneratedResume } from '@ai-job-print/shared'
import type { CSSProperties } from 'react'
import { MaskedContactLine } from '../../../../components/MaskedContactLine'

const taCls = 'qx-rd-ta'

function SectionTitle({ title }: { title: string }) {
  return (
    <div className="qx-rd-sec-title">
      <span aria-hidden="true" />
      <p>{title}</p>
    </div>
  )
}

export function GenerateResumeEditor(props: {
  resume: GeneratedResume
  onChange: (next: GeneratedResume) => void
  previewClassName?: string
  previewStyle?: CSSProperties
  onEditingChange?: (editing: boolean) => void
}) {
  const { resume, onChange } = props
  const mark = () => props.onEditingChange?.(true)
  return (
    <article className="qx-card qx-rd-paper" style={props.previewStyle}>
      <header>
        <p className="qx-rd-paper-name">{resume.basic.name}</p>
        {/* 包 G：公共终端纸面上电话 / 邮箱一律掩码展示，导出文件里仍是全量原文 */}
        <MaskedContactLine
          className="qx-rd-paper-meta"
          phone={resume.basic.phone}
          email={resume.basic.email}
          extra={[
            resume.intention.position ? `求职意向:${resume.intention.position}` : '',
            resume.intention.city ? `意向城市:${resume.intention.city}` : '',
          ]}
        />
      </header>
      <div className={`qx-rd-paper-body ${props.previewClassName ?? ''}`}>
        <div>
          <SectionTitle title="个人简介" />
          <textarea
            className={taCls}
            value={resume.summary}
            placeholder="(空)可手动填写"
            onFocus={mark}
            onChange={(e) => onChange({ ...resume, summary: e.target.value.slice(0, 600) })}
          />
        </div>
        {resume.education.length > 0 && (
          <div>
            <SectionTitle title="教育经历" />
            {resume.education.map((item, i) => (
              <div key={i}>
                <p>{[item.school, item.major, item.degree].filter(Boolean).join(' · ')} {item.period}</p>
                <textarea
                  className={taCls}
                  value={item.description ?? ''}
                  onFocus={mark}
                  onChange={(ev) => onChange({
                    ...resume,
                    education: resume.education.map((row, idx) => idx === i ? { ...row, description: ev.target.value.slice(0, 1000) } : row),
                  })}
                />
              </div>
            ))}
          </div>
        )}
        {resume.experience.length > 0 && (
          <div>
            <SectionTitle title="实习 / 工作经历" />
            {resume.experience.map((item, i) => (
              <div key={i}>
                <p>{item.company} · {item.role} {item.period}</p>
                <textarea
                  className={taCls}
                  value={item.description}
                  onFocus={mark}
                  onChange={(ev) => onChange({
                    ...resume,
                    experience: resume.experience.map((row, idx) => idx === i ? { ...row, description: ev.target.value.slice(0, 1000) } : row),
                  })}
                />
              </div>
            ))}
          </div>
        )}
        {resume.projects.length > 0 && (
          <div>
            <SectionTitle title="项目经历" />
            {resume.projects.map((item, i) => (
              <div key={i}>
                <p>{item.role ? `${item.name} · ${item.role}` : item.name}</p>
                <textarea
                  className={taCls}
                  value={item.description}
                  onFocus={mark}
                  onChange={(ev) => onChange({
                    ...resume,
                    projects: resume.projects.map((row, idx) => idx === i ? { ...row, description: ev.target.value.slice(0, 1000) } : row),
                  })}
                />
              </div>
            ))}
          </div>
        )}
        {resume.skills.length > 0 && (
          <div>
            <SectionTitle title="技能" />
            <p>{resume.skills.join(' · ')}</p>
          </div>
        )}
        {resume.certificates.length > 0 && (
          <div>
            <SectionTitle title="证书 / 资质" />
            <p>{resume.certificates.join(' · ')}</p>
          </div>
        )}
      </div>
    </article>
  )
}
