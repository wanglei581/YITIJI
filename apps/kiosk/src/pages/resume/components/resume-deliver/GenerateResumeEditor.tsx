import type { GeneratedResume } from '@ai-job-print/shared'
import type { CSSProperties, ReactNode, Ref } from 'react'
import { MaskedContactLine } from '../../../../components/MaskedContactLine'

const taCls = 'qx-rg-ta'

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
  const intention = [
    resume.intention.position,
    resume.intention.city ? `意向城市 ${resume.intention.city}` : '',
    resume.intention.jobType,
    resume.intention.salary,
  ].filter(Boolean).join(' · ')

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
            {resume.education.map((item, i) => (
              <div key={i} className="qx-rg-entry">
                <p><b>{[item.school, item.major, item.degree].filter(Boolean).join(' · ') || '学校未填'}</b>{item.period ? ` · ${item.period}` : ''}</p>
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
              </div>
            ))}
          </Block>
        )}
        {resume.experience.length > 0 && (
          <Block title="实习 / 工作经历" tags={<><Tag kind="keep">事实原样</Tag><Tag kind="pol">描述润色</Tag></>}>
            {resume.experience.map((item, i) => (
              <div key={i} className="qx-rg-entry">
                <p><b>{[item.company, item.role].filter(Boolean).join(' · ') || '公司未填'}</b>{item.period ? ` · ${item.period}` : ''}</p>
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
              </div>
            ))}
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
    </article>
  )
}
