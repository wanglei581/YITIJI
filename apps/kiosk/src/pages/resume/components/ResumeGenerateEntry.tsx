import { useNavigate } from 'react-router-dom'
import { BookOpenIcon, BriefcaseIcon, FileTextIcon, SparklesIcon, UserRoundIcon } from 'lucide-react'

const ROWS = [
  { step: 0, icon: <UserRoundIcon size={26} />, title: '第 1 步 · 基本信息', detail: '姓名（必填）、所在城市、手机号、邮箱', testId: 'resume-generate-plan-1' },
  { step: 1, icon: <BriefcaseIcon size={26} />, title: '第 2 步 · 求职意向', detail: '目标岗位（必填）、意向城市、工作类型、期望薪资', testId: 'resume-generate-plan-2' },
  { step: 2, icon: <BriefcaseIcon size={26} />, title: '第 3 步 · 经历', detail: '教育最多 6 段、工作最多 8 段、项目最多 6 个；描述可以直接说', testId: 'resume-generate-plan-3' },
  { step: 3, icon: <SparklesIcon size={26} />, title: '第 4 步 · 技能与自评', detail: '技能最多 20 项、证书最多 15 项，再加一句自我评价', testId: 'resume-generate-plan-4' },
] as const

/** 第 0 屏：先看这四步会问什么。点一行直接进那一步。 */
export function ResumeGenerateEntry({ onOpen }: { onOpen: (step: number) => void }) {
  const navigate = useNavigate()
  return (
    <div className="qx-rg-entry" data-testid="resume-generate-entry">
      <div className="qx-card qx-rg-card">
        <div className="qx-rd-heading">
          <b>这四步我会问什么</b>
          <span className="qx-rg-hint">只有 2 项必填</span>
        </div>
        <div className="qx-rg-rows">
          {ROWS.map((row) => (
            <button key={row.step} type="button" className="qx-rg-row" data-testid={row.testId} onClick={() => onOpen(row.step)}>
              <span className="qx-rg-row-ic" aria-hidden="true">{row.icon}</span>
              <span className="qx-rg-row-tx">
                <b>{row.title}</b>
                <span>{row.detail}</span>
              </span>
              <span className="qx-rg-row-go" aria-hidden="true">›</span>
            </button>
          ))}
        </div>
      </div>
      <div className="qx-rd-notes">
        <div className="qx-card">
          <b>AI 只润色，不编造</b>
          <p>学校、公司、学位、证书、时间和你写的数字，系统从你的输入里逐字复制。AI 只把描述说顺，不会替你添一段没有的经历。</p>
        </div>
        <div className="qx-card">
          <b>不想用 AI 也能出纸</b>
          <p>随时可以把已填内容<b>原样排成 PDF</b> 打印带走。那条路不经过模型，但也没有润色和补充提示。</p>
        </div>
      </div>
      <div className="qx-rd-notes">
        <button type="button" className="qx-rg-row" data-testid="resume-generate-has-file" onClick={() => navigate('/resume/source')}>
          <span className="qx-rg-row-ic" aria-hidden="true"><FileTextIcon size={26} /></span>
          <span className="qx-rg-row-tx">
            <b>我已经有简历文件</b>
            <span>那边是上传与诊断，不是从零填</span>
          </span>
          <span className="qx-rg-row-go" aria-hidden="true">›</span>
        </button>
        <button type="button" className="qx-rg-row" data-testid="resume-generate-mine" onClick={() => navigate('/me/resumes')}>
          <span className="qx-rg-row-ic" aria-hidden="true"><BookOpenIcon size={26} /></span>
          <span className="qx-rg-row-tx">
            <b>我的简历</b>
            <span>之前生成过的版本在这里</span>
          </span>
          <span className="qx-rg-row-go" aria-hidden="true">›</span>
        </button>
      </div>
    </div>
  )
}
