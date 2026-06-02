import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import ReactDiffViewer from 'react-diff-viewer-continued'
import { Button, Card, PageHeader } from '@ai-job-print/ui'
import { AlertCircleIcon, InfoIcon, PrinterIcon, SparklesIcon, TargetIcon, TrendingUpIcon } from 'lucide-react'
import type { ResumeOptimizeModule, ResumeTargetContext } from '@ai-job-print/shared'
import { COMPLIANCE_COPY } from '@ai-job-print/shared'
import { getResumeOptimize } from '../../services/api'

// 目标方向摘要文本（无方向时返回 null）
function targetSummary(tc?: ResumeTargetContext): string | null {
  if (!tc) return null
  if (tc.skipped) return '通用诊断（未指定方向）'
  const parts = [tc.industry, tc.targetJob, tc.experience, tc.scene].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

/**
 * 由 before / after 估算"评分提升"。
 *
 * 真正的评分由 AI provider 算并返回(W2 K2d 升级版会把 reason/dimension/score
 * 写入 ResumeOptimizeModule)。Day 4 阶段:
 *   - 没有可靠的"分数提升",只能根据"字符差异比例"做粗略估算
 *   - UI 上必须配"估算,仅供参考"免责文案,合规上不暗示真实通过率
 */
function estimateUplift(modules: ResumeOptimizeModule[]): { before: number; after: number } {
  if (modules.length === 0) return { before: 70, after: 70 }
  let totalDelta = 0
  for (const m of modules) {
    const beforeLen = m.before.length || 1
    const afterLen = m.after.length || 1
    const ratio = Math.min(1, Math.abs(afterLen - beforeLen) / beforeLen + 0.15)
    totalDelta += ratio * 6
  }
  const before = 72
  const after = Math.min(95, Math.round(before + totalDelta))
  return { before, after }
}

export function ResumeOptimizePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as Record<string, unknown> | null

  const taskId = typeof state?.taskId === 'string' ? state.taskId : undefined
  const file   = state?.file as { name: string; size: string; format: string } | undefined
  const targetContext = state?.targetContext as ResumeTargetContext | undefined
  const summary = targetSummary(targetContext)

  const [modules,  setModules]  = useState<ResumeOptimizeModule[]>([])
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(false)

  useEffect(() => {
    if (!taskId) {
      setLoading(false)
      setError(true)
      return
    }
    let cancelled = false
    getResumeOptimize(taskId)
      .then((res) => {
        if (cancelled) return
        if (res.modules && res.modules.length > 0) setModules(res.modules)
        else setError(true)
      })
      .catch(() => { if (!cancelled) setError(true) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [taskId])

  const uplift = useMemo(() => estimateUplift(modules), [modules])

  const handleSaveAdvice = () => {
    const advice = modules.map((m) => ({ title: m.title, before: m.before, after: m.after }))
    navigate('/profile', {
      state: {
        savedResumeAdvice: { file, suggestions: advice, savedAt: new Date().toISOString() },
      },
    })
  }

  const handlePrintOriginal = () => {
    navigate('/print/confirm', {
      state: {
        file: { name: file?.name ?? '简历.pdf', size: file?.size ?? '200 KB', pages: 1 },
        copies: 1,
        duplex: 'single',
        color: 'bw',
      },
    })
  }

  const handleViewFile = () => navigate('/resume/export', { state })

  // 采纳建议生成优化版：进入导出页（输出类型=优化版）。
  // 优化版基于用户真实经历调整表达，不编造经历，不伪造后端成功。
  const handleGenerateOptimized = () =>
    navigate('/resume/export', { state: { ...state, optimizedGenerated: true } })

  if (loading) {
    return (
      <div className="flex h-full flex-col p-6">
        <PageHeader
          title="优化建议"
          subtitle="基于已有内容优化表达"
          actions={<Button size="sm" variant="secondary" onClick={() => navigate(-1)}>返回报告</Button>}
        />
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <div className="flex h-20 w-20 items-center justify-center rounded-full bg-primary-50">
            <SparklesIcon className="h-10 w-10 animate-pulse text-primary-600" />
          </div>
          <p className="text-base text-gray-500">正在生成优化建议…</p>
        </div>
      </div>
    )
  }

  if (error || modules.length === 0) {
    return (
      <div className="flex h-full flex-col p-6">
        <PageHeader
          title="优化建议"
          subtitle="基于已有内容优化表达"
          actions={<Button size="sm" variant="secondary" onClick={() => navigate(-1)}>返回报告</Button>}
        />
        <div className="flex flex-1 flex-col items-center justify-center gap-4">
          <AlertCircleIcon className="h-14 w-14 text-gray-300" />
          <p className="text-base text-gray-500">暂无优化建议，请返回重新解析</p>
          <Button variant="secondary" onClick={() => navigate('/resume/source')}>重新开始</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col p-6">
      <PageHeader
        title="优化建议"
        subtitle="基于已有内容优化表达(仅供参考)"
        actions={<Button size="sm" variant="secondary" onClick={() => navigate(-1)}>返回报告</Button>}
      />

      <div className="mt-4 flex items-center gap-2 rounded-lg bg-gray-50 px-4 py-2.5">
        <InfoIcon className="h-3.5 w-3.5 shrink-0 text-gray-400" />
        <p className="text-xs text-gray-400">
          {COMPLIANCE_COPY.KIOSK_RESUME_OPTIMIZE_DISCLAIMER}评分提升为估算值,不代表真实招聘结果。
        </p>
      </div>

      {summary && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-primary-100 bg-primary-50/60 px-4 py-2.5">
          <TargetIcon className="h-4 w-4 shrink-0 text-primary-600" aria-hidden="true" />
          <p className="text-sm text-gray-700">
            目标方向：<span className="font-medium text-primary-700">{summary}</span>
          </p>
        </div>
      )}

      <div className="mt-4 flex flex-1 flex-col gap-4 overflow-y-auto">
        {/* 评分提升卡(估算) */}
        <Card className="p-5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-700">综合评分提升(估算)</p>
              <div className="mt-1.5 flex items-baseline gap-3">
                <span className="text-2xl font-semibold text-gray-400 line-through">{uplift.before}</span>
                <span className="text-3xl">→</span>
                <span className="text-3xl font-bold text-primary-600">{uplift.after}</span>
                <span className="text-sm text-success-fg">
                  +{uplift.after - uplift.before} 分
                </span>
              </div>
              <p className="mt-1 text-xs text-gray-400">仅基于改动量估算,不代表真实招聘结果</p>
            </div>
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-success-bg/60">
              <TrendingUpIcon className="h-7 w-7 text-success-fg" />
            </div>
          </div>
        </Card>

        {/* 逐模块字符级 diff */}
        {modules.map((mod, idx) => (
          <Card key={`${mod.title}-${idx}`} className="overflow-hidden p-0">
            <div className="border-b border-gray-200 px-5 py-3">
              <p className="text-sm font-semibold text-gray-800">{mod.title}</p>
            </div>
            <div className="text-xs">
              <ReactDiffViewer
                oldValue={mod.before}
                newValue={mod.after}
                splitView={true}
                disableWordDiff={false}
                hideLineNumbers={true}
                leftTitle="优化前"
                rightTitle="建议参考"
                useDarkTheme={false}
              />
            </div>
          </Card>
        ))}
      </div>

      <div className="mt-6 flex flex-col gap-3">
        <Button size="lg" className="flex items-center justify-center gap-2" onClick={handleGenerateOptimized}>
          <SparklesIcon className="h-5 w-5" />
          采纳建议生成优化版
        </Button>
        <div className="grid grid-cols-2 gap-3">
          <Button size="lg" variant="secondary" onClick={handleSaveAdvice}>保存优化建议</Button>
          <Button size="lg" variant="secondary" onClick={handleViewFile}>查看简历文件</Button>
          <Button size="lg" variant="secondary" className="flex items-center gap-2" onClick={handlePrintOriginal}>
            <PrinterIcon className="h-4 w-4" />
            打印原简历
          </Button>
          <Button size="lg" variant="secondary" onClick={() => navigate('/resume')}>返回服务中心</Button>
        </div>
      </div>
    </div>
  )
}
