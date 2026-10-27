import type { ReactNode } from 'react'
import { helpNeededLine } from '../../copy/unattendedCopy'
import type { GeneratePreviewViewState } from './components/resume-deliver/constants'
import { ResumeTouchActs, type ResumeTouchActItem } from './touch/ResumeTouchActs'

type Go = (to: string) => void

/**
 * 空态正文出口：一屏只出两张大行动卡，不再叠第二套小行。
 * 与底部 CTA 不同目的地，避免同义双按钮；去向与改版前的出口行逐条一致。
 */
export function GeneratePreviewEmptyExits(props: { view: GeneratePreviewViewState; onNavigate: Go }) {
  const go = props.onNavigate
  const view = props.view
  const items: ResumeTouchActItem[] = []
  if (view === 'session-lost' || view === 'preview-no-result') {
    items.push({ title: '打开我的简历', desc: '登录之后，保存期限内的版本可以直接打开', take: '打开', art: 'resume', onClick: () => go('/me/resumes') })
  }
  if (view === 'session-lost' || view === 'illegal') {
    items.push({ title: '返回简历服务', desc: '上传、诊断、优化都在那一页', take: '返回', art: 'checklist', onClick: () => go('/resume/source') })
  }
  if (view === 'preview-no-result') {
    items.push({ title: '我已经有简历文件', desc: '那边做上传与诊断，不是从零填', take: '去上传', art: 'report', onClick: () => go('/resume/source') })
  }
  if (view === 'preview-failed' || view === 'preview-loading') {
    items.push({
      title: view === 'preview-loading' ? '返回我的简历' : '回我的简历看看别的',
      desc: '记录列表在那边',
      take: '打开',
      art: 'resume',
      onClick: () => go('/me/resumes'),
    })
  }
  if (view === 'preview-loading' || view === 'illegal') {
    items.push({
      title: '帮助中心',
      desc: `${helpNeededLine()}。也可以先回首页，再从简历服务重新进入`,
      take: '去看看',
      icon: 'call',
      onClick: () => go('/help'),
    })
  }
  if (items.length === 0) return null
  return <ResumeTouchActs items={items} />
}

export function GeneratePreviewCta(props: {
  view: GeneratePreviewViewState
  /** 选格式屏。核对屏走原来的「回去改资料 / 内容没问题，去导出」。 */
  phase: 'preview' | 'export'
  showWorkspace: boolean
  exportBlocked: boolean
  /** 公司、职务、学校、专业不合法时，导出和打印入口不可用，点了把焦点带回出错那一格。 */
  titleBlocked: boolean
  onTitleBlocked: () => void
  exporting: boolean
  canPrint: boolean
  printNavigating: boolean
  formatName: string
  canRetry: boolean
  onHome: () => void
  onSource: () => void
  onRefill: () => void
  onRetry: () => void
  onOpenExport: () => void
  onBackToPreview: () => void
  onConfirmExport: () => void
  onPrint: () => void
}): ReactNode {
  if (props.showWorkspace && props.phase === 'export') {
    return (
      <ExportPhaseCta
        view={props.view}
        exportBlocked={props.exportBlocked}
        titleBlocked={props.titleBlocked}
        onTitleBlocked={props.onTitleBlocked}
        exporting={props.exporting}
        canPrint={props.canPrint}
        printNavigating={props.printNavigating}
        formatName={props.formatName}
        onBackToPreview={props.onBackToPreview}
        onConfirmExport={props.onConfirmExport}
        onPrint={props.onPrint}
      />
    )
  }
  if (props.showWorkspace) {
    return (
      <>
        <button type="button" className="qx-btn" data-variant="ghost" data-route="/resume/generate" data-testid="resume-generate-preview-cta-refill" onClick={props.onRefill}>回去改资料</button>
        <button
          type="button"
          className="qx-btn"
          data-variant="primary"
          data-testid="resume-generate-preview-cta-export"
          aria-disabled={props.titleBlocked || undefined}
          onClick={() => { if (props.titleBlocked) { props.onTitleBlocked(); return } props.onOpenExport() }}
        >
          内容没问题，去导出
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

function ExportPhaseCta(props: {
  view: GeneratePreviewViewState
  exportBlocked: boolean
  titleBlocked: boolean
  onTitleBlocked: () => void
  exporting: boolean
  canPrint: boolean
  printNavigating: boolean
  formatName: string
  onBackToPreview: () => void
  onConfirmExport: () => void
  onPrint: () => void
}): ReactNode {
  const back = (
    <button type="button" className="qx-btn" data-variant="ghost" data-testid="resume-generate-preview-cta-back-preview" onClick={props.onBackToPreview}>
      回预览再看看
    </button>
  )
  const printClick = () => {
    if (props.titleBlocked) { props.onTitleBlocked(); return }
    if (!props.printNavigating) props.onPrint()
  }
  const confirmClick = () => {
    if (props.titleBlocked) { props.onTitleBlocked(); return }
    if (!props.exportBlocked) props.onConfirmExport()
  }
  if (props.view === 'export-ready' && props.canPrint) {
    return (
      <>
        {back}
        <button type="button" className="qx-btn" data-variant="primary" data-testid="resume-generate-preview-cta-print" aria-disabled={props.printNavigating || props.titleBlocked || undefined} onClick={printClick}>
          {props.printNavigating ? '正在进入打印确认…' : '去打印确认'}
        </button>
      </>
    )
  }
  if (props.view === 'export-ready' && !props.canPrint) {
    return (
      <>
        {back}
        <button type="button" className="qx-btn" data-variant="primary" aria-disabled="true" data-testid="resume-generate-preview-cta-print">
          {`${props.formatName} 暂不开放打印`}
        </button>
      </>
    )
  }
  if (props.view === 'export-url-expired' && props.canPrint) {
    return (
      <>
        <button type="button" className="qx-btn" data-variant="ghost" data-testid="resume-generate-preview-cta-confirm-export" aria-disabled={props.exportBlocked || props.titleBlocked || undefined} onClick={confirmClick}>
          重新导出拿新链接
        </button>
        <button type="button" className="qx-btn" data-variant="primary" data-testid="resume-generate-preview-cta-print" aria-disabled={props.printNavigating || props.titleBlocked || undefined} onClick={printClick}>
          {props.printNavigating ? '正在进入打印确认…' : '去打印确认'}
        </button>
      </>
    )
  }
  const label = props.exporting || props.view === 'export-exporting'
    ? '正在生成文件…'
    : props.view === 'export-failed' || props.view === 'export-url-expired' || props.view === 'export-print-unavailable'
      ? '重新导出'
      : '导出这一份'
  const blocked = props.exportBlocked || props.titleBlocked || props.exporting || props.view === 'export-exporting'
  return (
    <>
      {back}
      <button
        type="button"
        className="qx-btn"
        data-variant="primary"
        data-testid="resume-generate-preview-cta-confirm-export"
        aria-disabled={blocked || undefined}
        onClick={() => { if (props.titleBlocked) { props.onTitleBlocked(); return } if (!blocked) props.onConfirmExport() }}
      >
        {label}
      </button>
    </>
  )
}
