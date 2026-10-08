import type {
  ResumeGenEducation,
  ResumeGenExperience,
  ResumeGenProject,
} from '@ai-job-print/shared'
import { PenLineIcon } from 'lucide-react'
import { maskEmail, maskPhone } from '../../../utils/maskPii'
import { isSubmittableExperience } from '../resumeGenerateSubmit'
import type { HistorySeg } from './resumeGenerateModel'

/** 与 ResumeGeneratePage.buildInput 同一条提交规则：半空条目不送出。 */
function splitList(text: string, cap: number): string[] {
  return text.split(/[,，、\n]/).map((item) => item.trim()).filter(Boolean).slice(0, cap)
}

function joined(parts: Array<string | undefined>): string {
  const text = parts.map((part) => part?.trim()).filter(Boolean).join(' · ')
  return text || '—'
}

function Row(props: { title: string; detail: string; testId: string; onEdit: () => void }) {
  return (
    <button type="button" className="qx-rg-row" data-testid={props.testId} onClick={props.onEdit}>
      <span className="qx-rg-row-ic" aria-hidden="true"><PenLineIcon size={26} /></span>
      <span className="qx-rg-row-tx">
        <b>{props.title}</b>
        <span>{props.detail}</span>
      </span>
      <span className="qx-rg-row-go" aria-hidden="true">›</span>
    </button>
  )
}

export function ResumeGenerateReview(props: {
  basic: { name: string; phone: string; email: string; city: string }
  intention: { position: string; city: string; jobType: string; salary: string }
  education: ResumeGenEducation[]
  experience: ResumeGenExperience[]
  projects: ResumeGenProject[]
  skillsText: string
  certsText: string
  selfIntro: string
  onEdit: (step: number, seg?: HistorySeg) => void
}) {
  const eduKept = props.education.filter((item) => item.school.trim()).length
  const expKept = props.experience.filter(isSubmittableExperience).length
  const projKept = props.projects.filter((item) => item.name.trim()).length
  const eduSkip = props.education.length - eduKept
  const expSkip = props.experience.length - expKept
  const projSkip = props.projects.length - projKept
  const skipped = eduSkip + expSkip + projSkip
  const skills = splitList(props.skillsText, 20)
  const certs = splitList(props.certsText, 15)
  const hints = [
    !props.basic.phone.trim() && !props.basic.email.trim(),
    eduKept === 0,
    expKept === 0 && projKept === 0,
    skills.length === 0,
  ].filter(Boolean).length
  const countLine = (kept: number, skip: number, unit: string, empty: string) => (
    kept
      ? `${kept} ${unit}会提交${skip ? `，${skip} ${unit}半空会跳过` : ''}`
      : empty
  )
  const tiles: Array<[string, number, string]> = [
    ['教育', eduKept, '段'],
    ['经历', expKept, '段'],
    ['项目', projKept, '个'],
    ['技能', skills.length, '项'],
    ['证书', certs.length, '项'],
  ]

  return (
    <div className="qx-rg-review" data-testid="resume-generate-review">
      <div className="qx-card qx-rg-card">
        <div className="qx-rd-heading">
          <b>生成前核对</b>
          <span className="qx-rg-hint">点一行修改资料</span>
        </div>
        <div className="qx-rg-rows">
          <Row title="基本信息" testId="resume-generate-rv-basic" detail={joined([props.basic.name, props.basic.city, maskPhone(props.basic.phone), maskEmail(props.basic.email)])} onEdit={() => props.onEdit(0)} />
          <Row title="求职意向" testId="resume-generate-rv-intent" detail={joined([props.intention.position, props.intention.city, props.intention.jobType, props.intention.salary])} onEdit={() => props.onEdit(1)} />
          <Row title="教育经历" testId="resume-generate-rv-edu" detail={countLine(eduKept, eduSkip, '段', '空着（预览页会提示你补）')} onEdit={() => props.onEdit(2, 'edu')} />
          <Row title="工作 / 实习经历" testId="resume-generate-rv-exp" detail={countLine(expKept, expSkip, '段', '空着（预览页会提示你补）')} onEdit={() => props.onEdit(2, 'exp')} />
          <Row title="项目经历" testId="resume-generate-rv-proj" detail={countLine(projKept, projSkip, '个', '空着（选填）')} onEdit={() => props.onEdit(2, 'proj')} />
          <Row title="技能 / 证书" testId="resume-generate-rv-skill" detail={`${skills.length} 项技能 · ${certs.length} 项证书`} onEdit={() => props.onEdit(3)} />
          <Row title="自我评价" testId="resume-generate-rv-intro" detail={props.selfIntro.trim() || '空着（AI 不会替你写一段没有的评价）'} onEdit={() => props.onEdit(3)} />
        </div>
      </div>
      <p className="qx-rg-submit">
        这次会提交
        <span>{skipped ? `另有 ${skipped} 条半空条目会被跳过` : '没有半空条目'}</span>
      </p>
      <div className="qx-rg-tiles" data-testid="resume-generate-review-tiles">
        {tiles.map(([label, count, unit]) => (
          <div key={label} data-zero={count === 0 ? '1' : undefined}>
            <b>{count}</b>
            <span>{label}（{unit}）</span>
          </div>
        ))}
      </div>
      <p className="qx-rg-note">
        <span>
          确认后，小青会整理描述，生成一份<b>可核对、可导出的新简历</b>。
          {hints > 0 ? <>还有 <b>{hints} 处</b>可补充，生成后可逐条核对。</> : '按当前内容算，没有缺失提示。'}
        </span>
      </p>
    </div>
  )
}
