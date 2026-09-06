import { useNavigate } from 'react-router-dom'
import { EXPORT_UNAVAILABLE_REASON } from '../../resume-report-model'

interface Props {
  viewState: string
  canOptimize: boolean
  intent: 'diagnose' | 'optimize'
  why: string
  onRetry: () => void
  onOptimize: () => void
  onJobFit: () => void
}

export function ResumeReportCta({ viewState, canOptimize, intent, why, onRetry, onOptimize }: Omit<Props, 'onJobFit'>) {
  const navigate = useNavigate()
  if (viewState === 'loading') {
    return (
      <>
        <p className="why" id="resume-report-why">{why}</p>
        <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/resume/source')} data-route="/resume/source">返回简历来源</button>
        <button type="button" className="qx-btn" data-variant="primary" aria-disabled="true" aria-describedby="resume-report-why">正在读取结果</button>
      </>
    )
  }
  if (viewState === 'unavailable') {
    return (
      <>
        <p className="why" id="resume-report-why">{why}</p>
        <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/resume/source')} data-route="/resume/source">返回简历来源</button>
        <button type="button" className="qx-btn" data-variant="primary" onClick={() => navigate('/print-scan')} data-route="/print-scan">去打印 / 扫描</button>
      </>
    )
  }
  if (viewState === 'read-error') {
    return (
      <>
        <p className="why" id="resume-report-why">{why}</p>
        <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/resume/source')} data-route="/resume/source">返回简历来源</button>
        <button type="button" className="qx-btn" data-variant="primary" onClick={onRetry}>再读一次</button>
      </>
    )
  }
  if (viewState === 'illegal' || viewState === 'no-context' || viewState === 'report-empty') {
    return (
      <>
        <p className="why" id="resume-report-why">{why}</p>
        <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/')} data-route="/">返回首页</button>
        <button type="button" className="qx-btn" data-variant="primary" onClick={() => navigate('/resume/source')} data-route="/resume/source" data-testid="resume-report-primary">
          {viewState === 'report-empty' ? '重新诊断' : '去上传简历'}
        </button>
      </>
    )
  }
  return (
    <>
      <p className="why" id="resume-report-why">{why}</p>
      <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate(`/resume/source?intent=${intent}`)} data-route="/resume/source">
        {intent === 'optimize' ? '重新上传' : '重新诊断'}
      </button>
      {canOptimize ? (
        <button type="button" className="qx-btn" data-variant="primary" onClick={onOptimize} data-route="/resume/optimize" data-testid="resume-report-primary">
          {intent === 'optimize' ? '继续生成优化版简历' : '查看优化建议'}
        </button>
      ) : (
        <button type="button" className="qx-btn" data-variant="primary" aria-disabled="true" aria-describedby="resume-report-why" data-testid="resume-report-primary">
          继续优化这份简历
        </button>
      )}
    </>
  )
}

export function ResumeReportTakeaway({ show, onJobFit }: { show: boolean; onJobFit: () => void }) {
  const navigate = useNavigate()
  if (!show) return null
  return (
    <>
      <div className="rrp-export" data-testid="resume-report-export-actions">
        {['打印这份报告', '导出 PDF', '生成二维码带走'].map((label) => (
          <button
            key={label}
            type="button"
            className="rrp-dead"
            aria-disabled="true"
            aria-describedby="resume-report-export-reason"
          >
            {label}
            <small>暂未开放</small>
          </button>
        ))}
      </div>
      <p className="rrp-export-reason" id="resume-report-export-reason">{EXPORT_UNAVAILABLE_REASON}</p>
      <button type="button" className="rrp-jobfit" onClick={onJobFit} data-route="/resume/job-fit">
        目标岗位匹配参考（仅供参考）
      </button>
      <p className="rrp-self">
        想了解自己的倾向？
        <button type="button" className="rrp-self" onClick={() => navigate('/resume/self-assessment/intro')}>
          做一次自我探索
        </button>
      </p>
    </>
  )
}
