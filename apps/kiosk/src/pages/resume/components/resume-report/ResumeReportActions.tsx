/* 报告页底栏主按钮：按页面状态给标签与去向。 */
import { useNavigate } from 'react-router-dom'
import type { QxTouchPrimary } from '../../../../components/qingxu/touch/QxTouchDock'

interface Props {
  viewState: string
  canOptimize: boolean
  intent: 'diagnose' | 'optimize'
  onRetry: () => void
  onOptimize: () => void
  issueCount?: number
}

export function useReportDockPrimary({
  viewState, canOptimize, intent, onRetry, onOptimize, issueCount = 0,
}: Props): QxTouchPrimary {
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
