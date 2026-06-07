import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Button, Card, ComplianceBanner, PageHeader, ResumeRadarChart } from '@ai-job-print/ui'
import type { ResumeRadarDimension } from '@ai-job-print/ui'
import { AlertCircleIcon, ArrowUpRightIcon, CheckCircleIcon, FileSearchIcon, PrinterIcon, SparklesIcon, TargetIcon } from 'lucide-react'
import type { ResumeReport, ResumeTargetContext } from '@ai-job-print/shared'
import { COMPLIANCE_COPY, makePrintParams } from '@ai-job-print/shared'
import { useAuth } from '../../auth/useAuth'
import { getResumeRecord } from '../../services/api'
import { API_MODE } from '../../services/api/client'

interface ReportState {
  source?: string
  file?: { name: string; size: string; format: string }
  taskId?: string
  success?: boolean
  reason?: string
  report?: ResumeReport
  targetContext?: ResumeTargetContext
}

const CONTROL_FIELDS = new Set(['success', 'reason', 'simulateFailure', 'failReason', 'report', 'taskId'])

// 目标方向摘要文本（无方向时返回 null）
function targetSummary(tc?: ResumeTargetContext): string | null {
  if (!tc) return null
  if (tc.skipped) return '通用诊断（未指定方向）'
  const parts = [tc.industry, tc.targetJob, tc.experience, tc.scene].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

export function ResumeReportPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { getToken } = useAuth()
  const state = (location.state ?? {}) as ReportState

  const { success = true, reason, taskId } = state
  const [report, setReport] = useState<ResumeReport | undefined>(state.report)
  const [loading, setLoading] = useState(!state.report && !!taskId && success)
  const [loadError, setLoadError] = useState(false)

  // http 模式：页面刷新后 state.report 为空，但 taskId 可用，从服务端恢复
  useEffect(() => {
    if (state.report || !taskId || !success) return
    let cancelled = false
    // 归属收口（Phase C-1）：登录会员须带 token 才能读回本人解析结果。
    getResumeRecord(taskId, getToken())
      .then((res) => {
        if (cancelled) return
        if (res.report) setReport(res.report)
        else setLoadError(true)
      })
      .catch(() => { if (!cancelled) setLoadError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [taskId, success, state.report, getToken])

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
        params: makePrintParams({ copies: 1, duplex: 'single', color: 'bw' }),
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

  if (loading) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8">
        <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-full bg-primary-50">
          <SparklesIcon className="h-10 w-10 animate-pulse text-primary-600" />
        </div>
        <p className="text-base text-gray-500">正在恢复诊断报告…</p>
      </div>
    )
  }

  if (!report || loadError) {
    return (
      <div className="flex h-full flex-col items-center justify-center p-8">
        <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary-50">
          <FileSearchIcon className="h-10 w-10 text-primary-600" />
        </div>
        <h1 className="mt-6 text-xl font-semibold text-gray-900">还没有诊断报告</h1>
        <p className="mt-2 max-w-xs text-center text-sm text-gray-500">
          请先上传或选择简历，生成 AI 诊断报告后再查看。
        </p>
        <div className="mt-8 flex w-full max-w-sm gap-3">
          <Button variant="secondary" size="lg" className="flex-1" onClick={() => navigate('/resume')}>
            返回 AI 简历服务
          </Button>
          <Button size="lg" className="flex-1" onClick={() => navigate('/resume/source')}>
            开始简历诊断
          </Button>
        </div>
      </div>
    )
  }

  const totalScore = report.sections.reduce((sum, s) => sum + s.score, 0)
  const totalMax   = report.sections.reduce((sum, s) => sum + s.maxScore, 0)
  const radarDimensions: ResumeRadarDimension[] = report.sections.map((s) => ({
    name: s.label,
    score: s.maxScore > 0 ? Math.round((s.score / s.maxScore) * 100) : 0,
  }))

  // 优先修改项：得分率最低的 2-3 个分项（由真实报告派生，不编造）
  const priorityItems = [...report.sections]
    .filter((s) => s.maxScore > 0)
    .map((s) => ({ ...s, pct: Math.round((s.score / s.maxScore) * 100) }))
    .sort((a, b) => a.pct - b.pct)
    .slice(0, 3)
    .filter((s) => s.pct < 100)

  const summary = targetSummary(state.targetContext)

  return (
    <div className="flex h-full flex-col p-6">
      <PageHeader
        title="诊断报告"
        subtitle="基于已有内容的 AI 分析结果（仅供参考）"
        actions={
          <Button size="sm" variant="secondary" onClick={() => navigate('/')}>
            返回首页
          </Button>
        }
      />

      <div className="mt-6 flex flex-1 flex-col gap-4 overflow-y-auto">
        {/* 演示数据提示：mock 模式下分数由演示 AI 生成，接真后端自动隐藏 */}
        {API_MODE !== 'http' && (
          <ComplianceBanner tone="info">
            {COMPLIANCE_COPY.KIOSK_RESUME_DEMO_NOTICE}
          </ComplianceBanner>
        )}

        {/* 目标方向摘要 */}
        {summary && (
          <div className="flex items-center gap-2 rounded-lg border border-primary-100 bg-primary-50/60 px-4 py-2.5">
            <TargetIcon className="h-4 w-4 shrink-0 text-primary-600" aria-hidden="true" />
            <p className="text-sm text-gray-700">
              目标方向：<span className="font-medium text-primary-700">{summary}</span>
            </p>
          </div>
        )}

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

        {/* 能力雷达图 */}
        <Card className="p-5">
          <p className="mb-2 text-sm font-medium text-gray-700">能力雷达图</p>
          <ResumeRadarChart dimensions={radarDimensions} height={280} />
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

        {/* 优先修改项 */}
        {priorityItems.length > 0 && (
          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2">
              <ArrowUpRightIcon className="h-4 w-4 text-amber-500" aria-hidden="true" />
              <p className="text-sm font-medium text-gray-700">优先修改项</p>
            </div>
            <p className="mb-3 text-xs text-gray-400">得分率偏低的分项，建议优先调整表达与内容结构</p>
            <div className="space-y-2.5">
              {priorityItems.map((item, i) => (
                <div key={item.key} className="flex items-center gap-3 rounded-lg bg-amber-50/60 px-3 py-2.5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xs font-semibold text-amber-700">
                    {i + 1}
                  </span>
                  <span className="flex-1 text-sm font-medium text-gray-800">{item.label}</span>
                  <span className="text-sm font-semibold text-amber-600">{item.pct}%</span>
                </div>
              ))}
            </div>
          </Card>
        )}

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

        {/* 合规声明 */}
        <p className="px-1 pb-1 text-center text-xs leading-relaxed text-gray-400">
          {COMPLIANCE_COPY.KIOSK_RESUME_REPORT_DISCLAIMER}
          {COMPLIANCE_COPY.KIOSK_RESUME_NO_SEND_ENTERPRISE}
        </p>
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
