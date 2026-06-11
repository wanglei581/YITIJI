import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Button, Card, ComplianceBanner, PageHeader, ResumeRadarChart } from '@ai-job-print/ui'
import type { ResumeRadarDimension } from '@ai-job-print/ui'
import { AlertCircleIcon, ArrowUpRightIcon, CheckCircleIcon, FileSearchIcon, SparklesIcon, TargetIcon } from 'lucide-react'
import type { ResumeReport, ResumeTargetContext } from '@ai-job-print/shared'
import { COMPLIANCE_COPY } from '@ai-job-print/shared'
import { useAuth } from '../../auth/useAuth'
import { getResumeRecord } from '../../services/api'
import { API_MODE } from '../../services/api/client'
import { readAiResumeSession } from './aiResumeSession'

interface ReportState {
  /** intent 分流(diagnose/optimize):由上传页随 state 透传 */
  intent?: string
  source?: string
  file?: { name: string; size: string; format: string }
  taskId?: string
  /** 匿名结果一次性令牌（Phase C-2A）；登录会员无此值 */
  accessToken?: string
  providerName?: string
  success?: boolean
  reason?: string
  report?: ResumeReport
  /** Stage 3:OCR 来源的置信度与复核提示(解析页随 state 透传) */
  extractionNotice?: { textSource: string; confidence: 'high' | 'medium' | 'low'; warnings: string[] }
  targetContext?: ResumeTargetContext
}

const CONTROL_FIELDS = new Set(['success', 'reason', 'simulateFailure', 'failReason', 'report', 'taskId', 'accessToken', 'providerName'])

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
  // intent 决定底部主引导语义(optimize 入口进来时诊断只是必经步骤)
  const intent = state.intent === 'optimize' ? 'optimize' : 'diagnose'

  const { success = true, reason } = state
  // 刷新后 location.state 丢失：taskId / accessToken 回退到最小会话（Phase C-2A）。
  const session = useMemo(() => readAiResumeSession(), [])
  const taskId = state.taskId ?? session?.taskId
  const accessToken = state.accessToken ?? session?.accessToken
  const [report, setReport] = useState<ResumeReport | undefined>(state.report)
  const [providerName, setProviderName] = useState<string | undefined>(state.providerName)
  // Stage 3:OCR 来源(图片/扫描件)的置信度与复核提示,必须如实展示
  const [extractionNotice, setExtractionNotice] = useState<
    { textSource: string; confidence: 'high' | 'medium' | 'low'; warnings: string[] } | undefined
  >(state.extractionNotice)
  const [loading, setLoading] = useState(!state.report && !!taskId && success)
  const [loadError, setLoadError] = useState(false)

  // http 模式：页面刷新后 state.report 为空，但 taskId 可用，从服务端恢复
  useEffect(() => {
    if (state.report || !taskId || !success) return
    let cancelled = false
    // 归属 / 令牌门禁（Phase C-1 + C-2A）：登录会员传 token，匿名用户传 accessToken，
    // 才能读回本人解析结果；无凭证后端返回 AI_TASK_NOT_FOUND。
    getResumeRecord(taskId, { token: getToken(), accessToken })
      .then((res) => {
        if (cancelled) return
        if (res.providerName) setProviderName(res.providerName)
        if (res.extractionNotice) setExtractionNotice(res.extractionNotice)
        if (res.report) setReport(res.report)
        else setLoadError(true)
      })
      .catch(() => { if (!cancelled) setLoadError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [taskId, success, state.report, accessToken, getToken])

  const handleRetry = () => {
    const retryState = Object.fromEntries(
      Object.entries(state).filter(([k]) => !CONTROL_FIELDS.has(k)),
    )
    navigate('/resume/parse', { state: retryState })
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
          <Button variant="secondary" size="lg" className="flex-1" onClick={() => navigate('/')}>
            返回首页
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

  // Phase 1.1：风险表述提醒 / 修改优先级建议为可选；旧报告（5 sections、无此字段）优雅降级。
  const llmPriorities = report.priorities ?? []
  const riskNotes = report.riskNotes ?? []

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
        {/* 演示数据提示：mock 模式或后端 provider=mock 时明确标记，避免把样例报告当真实报告 */}
        {(API_MODE !== 'http' || providerName === 'mock') && (
          <ComplianceBanner tone="info">
            {COMPLIANCE_COPY.KIOSK_RESUME_DEMO_NOTICE}
          </ComplianceBanner>
        )}

        <ComplianceBanner tone="success" title="报告边界">
          本报告仅基于上传文件中可解析出的内容生成，供本人修改简历时参考；不会发送给企业，也不代表录用、面试或投递结果。
        </ComplianceBanner>

        {/* Stage 3:扫描件/图片经 OCR 识别 → 如实标注来源与置信度;低置信度提示人工核对 */}
        {extractionNotice && (
          <ComplianceBanner tone="info" title={extractionNotice.textSource === 'pdf_ocr' ? '扫描件识别说明' : '图片识别说明'}>
            本简历经文字识别（OCR）提取，识别置信度
            {extractionNotice.confidence === 'high' ? '较高' : extractionNotice.confidence === 'medium' ? '中等' : '较低'}。
            {extractionNotice.warnings.length > 0 ? ` ${extractionNotice.warnings.join('；')}。` : ''}
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
              <p className="mt-1 text-xs text-gray-400">参考评分，由当前 AI 报告分项汇总，不代表真实招聘结果</p>
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

        {/* 修改优先级建议：优先用真实报告 priorities；缺失（含旧 5-section 报告）回退按低分分项派生 */}
        {llmPriorities.length > 0 ? (
          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2">
              <ArrowUpRightIcon className="h-4 w-4 text-amber-500" aria-hidden="true" />
              <p className="text-sm font-medium text-gray-700">修改优先级建议</p>
            </div>
            <p className="mb-3 text-xs text-gray-400">按重要性排序，供本人修改简历参考</p>
            <div className="space-y-2.5">
              {llmPriorities.map((item, i) => (
                <div key={i} className="flex gap-3 rounded-lg bg-amber-50/60 px-3 py-2.5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-100 text-xs font-semibold text-amber-700">
                    {i + 1}
                  </span>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-800">{item.focus}</p>
                    {item.reason && <p className="mt-0.5 text-xs text-gray-500">{item.reason}</p>}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        ) : priorityItems.length > 0 ? (
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
        ) : null}

        {/* 风险表述提醒：仅针对简历文本表达；旧报告无此字段时不渲染 */}
        {riskNotes.length > 0 && (
          <Card className="p-5">
            <div className="mb-2 flex items-center gap-2">
              <AlertCircleIcon className="h-4 w-4 text-amber-500" aria-hidden="true" />
              <p className="text-sm font-medium text-gray-700">风险表述提醒</p>
            </div>
            <p className="mb-3 text-xs text-gray-400">仅针对简历文本表达，不涉及身份信息判断；供本人修改参考</p>
            <ul className="space-y-2">
              {riskNotes.map((note, i) => (
                <li key={i} className="flex gap-2 text-sm text-gray-600">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-400" aria-hidden="true" />
                  <span>{note}</span>
                </li>
              ))}
            </ul>
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

      {/* 优化路径引导:用户从「AI简历优化」入口进入时,诊断只是必经步骤,主引导是继续优化 */}
      {intent === 'optimize' && (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-primary-100 bg-primary-50/70 px-4 py-3">
          <SparklesIcon className="h-4 w-4 shrink-0 text-primary-600" aria-hidden="true" />
          <p className="text-sm text-primary-800">诊断已完成。点击下方「继续生成优化版简历」，系统将基于原文重组优化（不补充虚构信息）。</p>
        </div>
      )}

      {/* 操作按钮 */}
      <div className="mt-6 flex gap-3">
        <Button
          size="lg"
          variant="secondary"
          className="flex flex-1 items-center gap-2"
          onClick={() => navigate(`/resume/source?intent=${intent}`)}
        >
          {intent === 'optimize' ? '重新上传' : '重新诊断'}
        </Button>
        <Button
          size="lg"
          className="flex flex-1 items-center gap-2"
          onClick={() => navigate('/resume/optimize', { state: { ...state, taskId, accessToken } })}
        >
          <SparklesIcon className="h-4 w-4" />
          {intent === 'optimize' ? '继续生成优化版简历' : '查看优化建议'}
        </Button>
      </div>
    </div>
  )
}
