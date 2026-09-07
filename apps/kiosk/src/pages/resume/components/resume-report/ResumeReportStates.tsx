import { useNavigate } from 'react-router-dom'
import { RESUME_SCORING_DIMENSIONS } from '@ai-job-print/shared'
import { MANUAL_CHECKS, type ExportCaptureState, type ReportViewState } from '../../resume-report-model'

type StateView = Exclude<ReportViewState, 'report' | 'report-minimal' | 'report-empty' | 'diagnose-failed' | ExportCaptureState>

interface Exit {
  title: string
  desc: string
  to: string
  testid: string
}

const COPY: Record<StateView, { h: string; p: string; exits: Exit[] }> = {
  'no-context': {
    h: '还没有诊断报告',
    p: '诊断结果按简历任务编号读取，并且要凭本人凭证才读得到 —— 地址栏里带一个编号不等于有权限。没有编号就读不到，本页也不会拿通用结论顶替。',
    exits: [
      { title: '返回简历来源', desc: '重新上传或扫描一份简历，交给解析', to: '/resume/source', testid: 'resume-report-exit-source' },
      { title: '打开我的诊断记录', desc: '从已保存的记录里挑一份继续', to: '/me/ai-records', testid: 'resume-report-exit-records' },
      { title: '去打印 / 扫描', desc: '不需要报告也能出纸', to: '/print-scan', testid: 'resume-report-exit-print' },
    ],
  },
  loading: {
    h: '正在读取诊断报告',
    p: '这是一次整体等待：结果要么回来，要么失败，中间没有可显示的阶段或百分比，所以这里不画进度条。',
    exits: [
      { title: '返回简历来源', desc: '换一份文件重新提交解析', to: '/resume/source', testid: 'resume-report-exit-source' },
      { title: '去打印 / 扫描', desc: '不用等报告，打印扫描照常可用', to: '/print-scan', testid: 'resume-report-exit-print' },
      { title: '打开我的诊断记录', desc: '看已经读回过的那几份', to: '/me/ai-records', testid: 'resume-report-exit-records' },
    ],
  },
  'read-error': {
    h: '这次没能取到报告',
    p: '常见原因：本次办理会话已经结束、结果已按留存期清理，或者读取中途断开。读取失败不会动到你上传的原件，也不会删掉任何已保存的简历。',
    exits: [
      { title: '返回简历来源', desc: '换一份文件重新提交解析', to: '/resume/source', testid: 'resume-report-exit-source' },
      { title: '打开我的诊断记录', desc: '看看有没有别的可用记录', to: '/me/ai-records', testid: 'resume-report-exit-records' },
      { title: '去打印 / 扫描', desc: '不依赖报告的现成链路', to: '/print-scan', testid: 'resume-report-exit-print' },
    ],
  },
  unavailable: {
    h: '诊断报告能力当前不可用',
    p: '没有接通真实 AI 服务时，读取报告会被直接拒绝，不会返回任何「读过你简历」的结论 —— 这是有意为之，避免把演示分数当成真实评价。',
    exits: [
      { title: '打印简历或材料', desc: '选好份数和单双面就能出纸', to: '/print-scan', testid: 'resume-report-exit-print' },
      { title: '扫描纸质简历', desc: '在奔图面板扫描，回传成 PDF', to: '/scan/start', testid: 'resume-report-exit-scan' },
      { title: '打开我的简历', desc: '查看和整理已保存的版本', to: '/me/ai-records', testid: 'resume-report-exit-records' },
    ],
  },
  illegal: {
    h: '这个地址不能用来打开报告',
    p: '本页只认登记过的状态与编号格式。收到没登记的值时一律按不可用处理，也不会把地址里的原文显示出来。',
    exits: [
      { title: '返回简历来源', desc: '从上传或扫描重新开始', to: '/resume/source', testid: 'resume-report-exit-source' },
      { title: '打开我的诊断记录', desc: '从记录里选一条正常打开', to: '/me/ai-records', testid: 'resume-report-exit-records' },
      { title: '返回首页', desc: '换一个服务入口', to: '/', testid: 'resume-report-exit-home' },
    ],
  },
}

export function ResumeReportStates({ viewState }: { viewState: StateView }) {
  const navigate = useNavigate()
  const copy = COPY[viewState]
  return (
    <>
      <section className="rrp-state">
        <h2>{copy.h}</h2>
        <p>{copy.p}</p>
      </section>
      <section className="rrp-exits">
        <div className="rrp-zh">接下来可以做的<span>这些都不依赖本页这份报告</span></div>
        <div className="rows" style={{ display: 'grid', gap: 10 }}>
          {copy.exits.map((exit) => (
            <button key={exit.testid} type="button" className="rrp-row" data-route={exit.to} data-testid={exit.testid} onClick={() => navigate(exit.to)}>
              <span className="tx"><b>{exit.title}</b><span>{exit.desc}</span></span>
            </button>
          ))}
        </div>
      </section>
      <section className="rrp-state" style={{ paddingBottom: 18 }}>
        <div className="rrp-zh">报告会给你这六项<span>固定角度 · 没有报告时这里不会有分数</span></div>
        <div className="rrp-dnames">
          {RESUME_SCORING_DIMENSIONS.map((dim, i) => (
            <span key={dim.key} className="rrp-dn"><i>{i + 1}</i>{dim.label}</span>
          ))}
        </div>
      </section>
      <section className="rrp-checks" data-testid="resume-report-fallback">
        <div className="rrp-zh">不等 AI，先自己核一遍<span>6 项 · 纸质简历同样适用</span></div>
        <div className="list" data-testid="resume-report-list">
          {MANUAL_CHECKS.map((item, i) => (
            <div key={item}><i>{i + 1}</i><span>{item}</span></div>
          ))}
        </div>
      </section>
    </>
  )
}
