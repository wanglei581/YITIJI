import { useNavigate, useLocation } from 'react-router-dom'
import { Button, Card, PageHeader } from '@ai-job-print/ui'
import { AlertCircleIcon, CheckCircleIcon, PrinterIcon, SparklesIcon } from 'lucide-react'

interface ResumeSection {
  key: string
  label: string
  score: number
  maxScore: number
}

interface ResumeReport {
  sections: ResumeSection[]
  suggestions: string[]
}

interface ReportState {
  source?: string
  file?: { name: string; size: string; format: string }
  success?: boolean
  reason?: string
  report?: ResumeReport
}

const CONTROL_FIELDS = new Set(['success', 'reason', 'simulateFailure', 'failReason', 'report'])

export function ResumeReportPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const state = (location.state ?? {}) as ReportState

  const { success = true, reason, report } = state

  const handleRetry = () => {
    const retryState = Object.fromEntries(
      Object.entries(state).filter(([k]) => !CONTROL_FIELDS.has(k)),
    )
    navigate('/resume/parse', { state: retryState })
  }

  const handlePrintReport = () => {
    const file = state.file
    navigate('/print/confirm', {
      state: {
        file: {
          name: `诊断报告_${file?.name ?? '简历'}.pdf`,
          size: '128 KB',
          pages: 2,
        },
        copies: 1,
        duplex: 'single',
        color: 'bw',
      },
    })
  }

  if (!success) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8">
        <div className="mb-8 flex h-24 w-24 items-center justify-center rounded-full bg-red-50">
          <AlertCircleIcon className="h-14 w-14 text-red-500" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900">诊断失败</h1>
        <p className="mt-2 text-base text-gray-500">
          {reason ?? '简历解析未能完成，请重试'}
        </p>
        <div className="mt-8 flex w-full max-w-sm gap-3">
          <Button variant="secondary" size="lg" className="flex-1" onClick={() => navigate('/')}>
            返回首页
          </Button>
          <Button size="lg" className="flex-1" onClick={handleRetry}>
            重新解析
          </Button>
        </div>
      </div>
    )
  }

  if (!report) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8">
        <AlertCircleIcon className="h-14 w-14 text-red-400" />
        <h1 className="mt-6 text-xl font-semibold text-gray-900">页面数据丢失</h1>
        <p className="mt-2 text-sm text-gray-500">请重新从 AI 简历服务进入此页面</p>
        <Button className="mt-8" onClick={() => navigate('/resume/source')}>
          重新开始
        </Button>
      </div>
    )
  }

  const totalScore = report.sections.reduce((sum, s) => sum + s.score, 0)
  const totalMax = report.sections.reduce((sum, s) => sum + s.maxScore, 0)

  return (
    <div className="flex h-full flex-col p-6">
      <PageHeader
        title="诊断报告"
        subtitle="基于已有内容的 AI 分析结果"
        actions={
          <Button size="sm" variant="secondary" onClick={() => navigate('/')}>
            返回首页
          </Button>
        }
      />

      <div className="mt-6 flex flex-1 flex-col gap-4 overflow-y-auto">
        {/* 总分卡片 */}
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-bold text-gray-900">{totalScore}</span>
                <span className="text-xl text-gray-400">/{totalMax}</span>
              </div>
              <p className="mt-1 text-xs text-gray-400">参考评分，不代表真实招聘结果</p>
            </div>
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary-50">
              <CheckCircleIcon className="h-8 w-8 text-primary-600" />
            </div>
          </div>
        </Card>

        {/* 分项得分 */}
        <Card className="p-5">
          <p className="mb-4 text-sm font-medium text-gray-700">分项评估</p>
          <div className="space-y-3">
            {report.sections.map((section) => {
              const pct = Math.round((section.score / section.maxScore) * 100)
              return (
                <div key={section.key}>
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span className="text-gray-700">{section.label}</span>
                    <span className="font-medium text-gray-900">
                      {section.score}/{section.maxScore}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                    <div
                      className="h-full rounded-full bg-primary-500 transition-all"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </Card>

        {/* 优化建议 */}
        <Card className="p-5">
          <p className="mb-4 text-sm font-medium text-gray-700">可执行建议</p>
          <ol className="space-y-3">
            {report.suggestions.map((tip, i) => (
              <li key={i} className="flex gap-3 text-sm text-gray-600">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-100 text-xs font-medium text-primary-700">
                  {i + 1}
                </span>
                <span>{tip}</span>
              </li>
            ))}
          </ol>
        </Card>
      </div>

      {/* 操作按钮 */}
      <div className="mt-6 flex gap-3">
        <Button
          size="lg"
          variant="secondary"
          className="flex flex-1 items-center gap-2"
          onClick={handlePrintReport}
        >
          <PrinterIcon className="h-4 w-4" />
          打印报告
        </Button>
        <Button
          size="lg"
          className="flex flex-1 items-center gap-2"
          onClick={() => navigate('/resume/optimize', { state })}
        >
          <SparklesIcon className="h-4 w-4" />
          查看优化建议
        </Button>
      </div>
    </div>
  )
}
