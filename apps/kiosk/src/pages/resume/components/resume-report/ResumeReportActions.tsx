/* 底栏主按钮和页内次按钮共用同一份分支，钩子必须和组件放在一起。 */
/* eslint-disable react-refresh/only-export-components */
import { useNavigate } from 'react-router-dom'
import type { QxTouchPrimary } from '../../../../components/qingxu/touch/QxTouchDock'

interface Props {
  viewState: string
  canOptimize: boolean
  intent: 'diagnose' | 'optimize'
  why: string
  onRetry: () => void
  onOptimize: () => void
  onJobFit: () => void
  /** 主按钮改由触屏底栏渲染时，这里只留说明和次按钮。默认仍在本组件里画主按钮。 */
  hidePrimary?: boolean
}

export function useReportDockPrimary({
  viewState, canOptimize, intent, onRetry, onOptimize, issueCount = 0,
}: Omit<Props, 'onJobFit' | 'why' | 'hidePrimary'> & { issueCount?: number }): QxTouchPrimary {
  const navigate = useNavigate()
  const qx = (label: string, onClick: () => void, extra?: Partial<QxTouchPrimary>): QxTouchPrimary => ({
    label, onClick, className: 'qx-btn', noArrow: true, ...extra,
  })
  if (viewState === 'loading') return qx('正在读取结果', () => {}, { disabled: true })
  if (viewState === 'unavailable') return qx('去打印 / 扫描', () => navigate('/print-scan'))
  if (viewState === 'read-error') return qx('再读一次', onRetry)
  if (viewState === 'illegal' || viewState === 'no-context' || viewState === 'report-empty') {
    return qx(viewState === 'report-empty' ? '重新诊断' : '去上传简历', () => navigate('/resume/source'), { testId: 'resume-report-primary' })
  }
  if (canOptimize) {
    return qx(intent === 'optimize' ? '继续生成优化版简历' : `查看优化建议（${issueCount} 条）`, onOptimize, { testId: 'resume-report-primary' })
  }
  return qx('继续优化这份简历', () => {}, { disabled: true, testId: 'resume-report-primary' })
}

export function ResumeReportCta({ viewState, canOptimize, intent, why, onRetry, onOptimize, hidePrimary = false }: Omit<Props, 'onJobFit'>) {
  const navigate = useNavigate()
  const primary = hidePrimary ? null : true
  if (viewState === 'loading') {
    return (
      <>
        <p className="why" id="resume-report-why">{why}</p>
        <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/resume/source')} data-route="/resume/source">返回简历来源</button>
        {primary ? <button type="button" className="qx-btn" data-variant="primary" aria-disabled="true" aria-describedby="resume-report-why">正在读取结果</button> : null}
      </>
    )
  }
  if (viewState === 'unavailable') {
    return (
      <>
        <p className="why" id="resume-report-why">{why}</p>
        <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/resume/source')} data-route="/resume/source">返回简历来源</button>
        {primary ? <button type="button" className="qx-btn" data-variant="primary" onClick={() => navigate('/print-scan')} data-route="/print-scan">去打印 / 扫描</button> : null}
      </>
    )
  }
  if (viewState === 'read-error') {
    return (
      <>
        <p className="why" id="resume-report-why">{why}</p>
        <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/resume/source')} data-route="/resume/source">返回简历来源</button>
        {primary ? <button type="button" className="qx-btn" data-variant="primary" onClick={onRetry}>再读一次</button> : null}
      </>
    )
  }
  if (viewState === 'illegal' || viewState === 'no-context' || viewState === 'report-empty') {
    return (
      <>
        <p className="why" id="resume-report-why">{why}</p>
        <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/')} data-route="/">返回首页</button>
        {primary ? (
          <button type="button" className="qx-btn" data-variant="primary" onClick={() => navigate('/resume/source')} data-route="/resume/source" data-testid="resume-report-primary">
            {viewState === 'report-empty' ? '重新诊断' : '去上传简历'}
          </button>
        ) : null}
      </>
    )
  }
  return (
    <>
      <p className="why" id="resume-report-why">{why}</p>
      <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate(`/resume/source?intent=${intent}`)} data-route="/resume/source">
        {intent === 'optimize' ? '重新上传' : '重新诊断'}
      </button>
      {primary ? (canOptimize ? (
        <button type="button" className="qx-btn" data-variant="primary" onClick={onOptimize} data-route="/resume/optimize" data-testid="resume-report-primary">
          {intent === 'optimize' ? '继续生成优化版简历' : '查看优化建议'}
        </button>
      ) : (
        <button type="button" className="qx-btn" data-variant="primary" aria-disabled="true" aria-describedby="resume-report-why" data-testid="resume-report-primary">
          继续优化这份简历
        </button>
      )) : null}
    </>
  )
}
