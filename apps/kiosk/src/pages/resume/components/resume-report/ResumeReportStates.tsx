import { useNavigate } from 'react-router-dom'
import { RESUME_SCORING_DIMENSIONS } from '@ai-job-print/shared'
import { QxTouchIcon, type QxTouchIconName } from '../../../../components/qingxu/touch/QxTouchIcon'
import type { ExportCaptureState, ReportViewState } from '../../resume-report-model'
import { ExitRow, ManualChecks } from './ResumeReportExits'

type StateView = Exclude<ReportViewState, 'report' | 'report-minimal' | 'diagnose-failed' | ExportCaptureState>

interface Exit {
  title: string
  desc: string
  take: string
  to: string
  testid: string
  icon: QxTouchIconName
}

const COPY: Record<StateView, { h: string; p: string; exits: Exit[] }> = {
  'report-empty': {
    h: '报告回来了，但里面是空的',
    p: '这次确实读到了报告，只是六个维度、建议、优先级和风险提醒都是空的。常见原因是这次提取到的简历文字太少，不足以给出有依据的结论。这不是读取失败，也不是能力未接通。本页不会为了把版面填满而生成任何结论，也不出总分。',
    exits: [
      { title: '换一份更完整的简历', desc: '内容多一些，解析才有东西可看', take: '去简历来源', to: '/resume/source', testid: 'resume-report-empty-source', icon: 'file' },
      { title: '手动逐项填写', desc: '自己写一份，再决定是否润色', take: '去填写', to: '/resume/generate', testid: 'resume-report-empty-manual', icon: 'pen' },
      { title: '去打印 / 扫描', desc: '不依赖报告的现成流程', take: '去打印扫描', to: '/print-scan', testid: 'resume-report-empty-print', icon: 'printer' },
    ],
  },
  'no-context': {
    h: '还没有诊断报告',
    p: '请先上传一份本人简历完成诊断，或从我的诊断记录继续查看。',
    exits: [
      { title: '返回简历来源', desc: '重新上传或扫描一份简历，交给解析', take: '去简历来源', to: '/resume/source', testid: 'resume-report-exit-source', icon: 'file' },
      { title: '打开我的诊断记录', desc: '从已保存的记录里挑一份继续', take: '去看记录', to: '/me/ai-records', testid: 'resume-report-exit-records', icon: 'folder' },
      { title: '去打印 / 扫描', desc: '不需要报告也能出纸', take: '去打印扫描', to: '/print-scan', testid: 'resume-report-exit-print', icon: 'printer' },
    ],
  },
  loading: {
    h: '正在读取诊断报告',
    p: '这是一次整体等待：结果要么回来，要么失败，中间没有可显示的阶段或百分比，所以这里不画进度条。',
    exits: [
      { title: '返回简历来源', desc: '换一份文件重新提交解析', take: '去简历来源', to: '/resume/source', testid: 'resume-report-exit-source', icon: 'file' },
      { title: '去打印 / 扫描', desc: '不用等报告，打印扫描照常可用', take: '去打印扫描', to: '/print-scan', testid: 'resume-report-exit-print', icon: 'printer' },
      { title: '打开我的诊断记录', desc: '看已经读回过的那几份', take: '去看记录', to: '/me/ai-records', testid: 'resume-report-exit-records', icon: 'folder' },
    ],
  },
  'read-error': {
    h: '这次没能取到报告',
    p: '常见原因：本次办理已经结束、结果已按留存期清理，或者读取中途断开。读取失败不会动到你上传的原件，也不会删掉任何已保存的简历。',
    exits: [
      { title: '返回简历来源', desc: '换一份文件重新提交解析', take: '去简历来源', to: '/resume/source', testid: 'resume-report-exit-source', icon: 'file' },
      { title: '打开我的诊断记录', desc: '看看有没有别的可用记录', take: '去看记录', to: '/me/ai-records', testid: 'resume-report-exit-records', icon: 'folder' },
      { title: '去打印 / 扫描', desc: '不用报告，也能办理打印扫描', take: '去打印扫描', to: '/print-scan', testid: 'resume-report-exit-print', icon: 'printer' },
    ],
  },
  unavailable: {
    h: '诊断报告能力当前不可用',
    p: '没有接通真实 AI 服务时，读取报告会被直接拒绝，不会返回任何「读过你简历」的结论 —— 这是有意为之，避免把演示分数当成真实评价。',
    exits: [
      { title: '打印简历或材料', desc: '选好文件、份数和单双面就能出纸', take: '去打印扫描', to: '/print-scan', testid: 'resume-report-exit-print', icon: 'printer' },
      { title: '扫描纸质简历', desc: '在打印机面板上扫描，存成 PDF', take: '去扫描', to: '/scan', testid: 'resume-report-exit-scan', icon: 'scan' },
      { title: '打开我的简历', desc: '查看和整理已保存的版本', take: '去看记录', to: '/me/ai-records', testid: 'resume-report-exit-records', icon: 'folder' },
      { title: '查政策', desc: '查看本机构发布的政策与办理说明', take: '去看政策', to: '/policy-service', testid: 'resume-report-exit-policies', icon: 'book' },
      { title: '本机构官方渠道', desc: '扫码查看官网或官方账号', take: '去扫码', to: '/official-channels', testid: 'resume-report-exit-channels', icon: 'qr' },
    ],
  },
  illegal: {
    h: '这个地址不能用来打开报告',
    p: '这个地址无法打开报告，请从简历来源或我的诊断记录重新进入。',
    exits: [
      { title: '返回简历来源', desc: '从上传或扫描重新开始', take: '去简历来源', to: '/resume/source', testid: 'resume-report-exit-source', icon: 'file' },
      { title: '打开我的诊断记录', desc: '从记录里选一条正常打开', take: '去看记录', to: '/me/ai-records', testid: 'resume-report-exit-records', icon: 'folder' },
      { title: '返回首页', desc: '换一个服务入口', take: '回首页', to: '/', testid: 'resume-report-exit-home', icon: 'home' },
    ],
  },
}

/** 报告拿不到 / 是空的 / 地址不对时的说明页：先说原因，再给不依赖本页报告的几条出路，最后是自查清单。 */
export function ResumeReportStates({ viewState }: { viewState: StateView }) {
  const navigate = useNavigate()
  const copy = COPY[viewState]
  return (
    <>
      <div className="qxt-howto qxt-rise" role="status" data-testid="resume-report-state-note">
        <QxTouchIcon name="alert" size={34} strokeWidth={2} />
        <span><b>{copy.h}</b>{copy.p}</span>
      </div>
      <div className="qxt-sec">接下来可以做的<small>这些都不依赖本页这份报告</small></div>
      <div className="qxt-exit-col rrp-exits" data-testid="resume-report-exits">
        {copy.exits.map((exit, i) => (
          <ExitRow key={exit.testid} icon={exit.icon} title={exit.title} desc={exit.desc} take={exit.take} testId={exit.testid} route={exit.to} index={i} onClick={() => navigate(exit.to)} />
        ))}
      </div>
      {viewState !== 'report-empty' ? (
        <section className="qxt-dimnames">
          <div className="qxt-sec">报告会给你这六项<small>固定角度 · 没有报告时这里不会有分数</small></div>
          <div className="qxt-dimchips">
            {RESUME_SCORING_DIMENSIONS.map((dim, i) => <span key={dim.key}><i>{i + 1}</i>{dim.label}</span>)}
          </div>
        </section>
      ) : null}
      <ManualChecks delay={copy.exits.length + 2} />
    </>
  )
}
