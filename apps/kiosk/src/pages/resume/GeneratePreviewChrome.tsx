import type { ReactNode } from 'react'
import { BookOpenIcon, FileTextIcon, HelpCircleIcon, HomeIcon, SparklesIcon, UserIcon } from 'lucide-react'
import type { GeneratePreviewViewState } from './components/resume-deliver/constants'

type Go = (to: string) => void

export function GeneratePreviewNavbar({ onNavigate }: { onNavigate: Go }) {
  return (
    <>
      <button type="button" className="qx-nav-item" onClick={() => onNavigate('/')} data-route="/" data-testid="resume-generate-preview-nav-home">
        <HomeIcon size={32} aria-hidden />首页
      </button>
      <button type="button" className="qx-nav-item" onClick={() => onNavigate('/assistant')} data-route="/assistant" data-testid="resume-generate-preview-nav-advisor">
        <SparklesIcon size={32} aria-hidden />AI 顾问
      </button>
      <button type="button" className="qx-nav-item" onClick={() => onNavigate('/profile')} data-route="/profile" data-testid="resume-generate-preview-nav-profile">
        <UserIcon size={32} aria-hidden />我的
      </button>
    </>
  )
}

function ExitRow(props: { icon: ReactNode; title: string; desc: string; to: string; testid: string; onNavigate: Go }) {
  return (
    <button type="button" className="qx-row" data-route={props.to} data-testid={props.testid} onClick={() => props.onNavigate(props.to)}>
      <span className="qx-row-ic" aria-hidden="true">{props.icon}</span>
      <span className="qx-row-tx">
        <span className="qx-row-t">{props.title}</span>
        <span className="qx-row-d">{props.desc}</span>
      </span>
      <span className="qx-row-go" aria-hidden="true">›</span>
    </button>
  )
}

const I = {
  book: <BookOpenIcon size={26} />,
  file: <FileTextIcon size={26} />,
  help: <HelpCircleIcon size={26} />,
}

/** 空态正文出口。与底部 CTA 不同目的地，避免同义双按钮。 */
export function GeneratePreviewEmptyExits(props: { view: GeneratePreviewViewState; onNavigate: Go }) {
  const go = props.onNavigate
  const rows: ReactNode[] = []
  if (props.view === 'session-lost' || props.view === 'preview-no-result') {
    rows.push(
      <ExitRow key="mine" icon={I.book} title="打开我的简历" desc="登录之后，服务端留存期内的版本可以直接打开" to="/me/resumes" testid="resume-generate-preview-exit-mine" onNavigate={go} />,
    )
  }
  if (props.view === 'session-lost' || props.view === 'illegal') {
    rows.push(
      <ExitRow key="source" icon={I.file} title="返回简历服务" desc="上传、诊断、优化都在那一页" to="/resume/source" testid="resume-generate-preview-exit-source" onNavigate={go} />,
    )
  }
  if (props.view === 'preview-no-result') {
    rows.push(
      <ExitRow key="file" icon={I.file} title="我已经有简历文件" desc="那边做上传与诊断，不是从零填" to="/resume/source" testid="resume-generate-preview-exit-file" onNavigate={go} />,
    )
  }
  if (props.view === 'preview-failed' || props.view === 'preview-loading') {
    rows.push(
      <ExitRow key="records" icon={I.book} title={props.view === 'preview-loading' ? '返回我的简历' : '回我的简历看看别的'} desc="记录列表在那边" to="/me/resumes" testid="resume-generate-preview-exit-records" onNavigate={go} />,
    )
  }
  if (props.view === 'preview-loading' || props.view === 'illegal') {
    rows.push(
      <ExitRow key="help" icon={I.help} title="找工作人员" desc="现场有人能帮你看一眼" to="/help" testid="resume-generate-preview-exit-help" onNavigate={go} />,
    )
  }
  if (rows.length === 0) return null
  return <div className="qx-rows qx-rd-exits">{rows}</div>
}

export function GeneratePreviewCta(props: {
  view: GeneratePreviewViewState
  showWorkspace: boolean
  exportBlocked: boolean
  exporting: boolean
  canRetry: boolean
  onHome: () => void
  onSource: () => void
  onRefill: () => void
  onRetry: () => void
  onExport: () => void
}): ReactNode {
  if (props.showWorkspace) {
    return (
      <>
        <button type="button" className="qx-btn" data-variant="ghost" data-route="/resume/generate" data-testid="resume-generate-preview-cta-refill" onClick={props.onRefill}>回去改资料</button>
        <button type="button" className="qx-btn" data-variant="primary" data-testid="resume-generate-preview-cta-export" aria-disabled={props.exportBlocked || undefined} onClick={() => { if (!props.exportBlocked) props.onExport() }}>
          {props.exporting ? '正在生成文件…' : '内容没问题，去导出'}
        </button>
      </>
    )
  }
  if (props.view === 'preview-loading') return null
  if (props.view === 'preview-no-result') {
    return (
      <>
        <button type="button" className="qx-btn" data-variant="ghost" data-route="/resume/source" data-testid="resume-generate-preview-cta-source" onClick={props.onSource}>返回简历服务</button>
        <button type="button" className="qx-btn" data-variant="primary" data-route="/resume/generate" data-testid="resume-generate-preview-cta-refill" onClick={props.onRefill}>去填资料</button>
      </>
    )
  }
  if (props.view === 'preview-failed') {
    return (
      <>
        <button type="button" className="qx-btn" data-variant="ghost" data-route="/resume/generate" data-testid="resume-generate-preview-cta-refill" onClick={props.onRefill}>重新填一份</button>
        <button
          type="button"
          className="qx-btn"
          data-variant="primary"
          data-testid="resume-generate-preview-cta-retry"
          aria-disabled={!props.canRetry || undefined}
          aria-describedby={!props.canRetry ? 'resume-generate-preview-retry-why' : undefined}
          onClick={() => { if (props.canRetry) props.onRetry() }}
        >
          再读一次
        </button>
      </>
    )
  }
  if (props.view === 'illegal') {
    return (
      <>
        <button type="button" className="qx-btn" data-variant="ghost" data-route="/" data-testid="resume-generate-preview-cta-home" onClick={props.onHome}>回首页</button>
        <button type="button" className="qx-btn" data-variant="primary" data-route="/resume/generate" data-testid="resume-generate-preview-cta-refill" onClick={props.onRefill}>从第 1 步开始</button>
      </>
    )
  }
  return (
    <>
      <button type="button" className="qx-btn" data-variant="ghost" data-route="/" data-testid="resume-generate-preview-cta-home" onClick={props.onHome}>返回服务大厅</button>
      <button type="button" className="qx-btn" data-variant="primary" data-route="/resume/generate" data-testid="resume-generate-preview-cta-refill" onClick={props.onRefill}>重新填一份</button>
    </>
  )
}
