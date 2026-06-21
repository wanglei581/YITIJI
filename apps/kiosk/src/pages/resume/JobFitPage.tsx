// ============================================================
// 2D 目标岗位定向优化 + 岗位匹配度参考。
//
// 入口：诊断报告页（携带 taskId/accessToken）。流程：选择系统内已发布岗位
// （搜索选择）或手填目标岗位 → 真实分析 → 参考等级 + 匹配点（含原文依据）+
// 差距建议 + 定向优化建议 + 「去来源平台投递」引导（仅系统内岗位）。
// 合规：等级仅供参考（无百分比/录用承诺，服务端双层拦截）；不做平台内投递。
// ============================================================

import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button, Card, ComplianceBanner, PageHeader } from '@ai-job-print/ui'
import type { ExternalJobDTO, JobFitResponse } from '@ai-job-print/shared'
import {
  AlertCircleIcon,
  ArrowRightIcon,
  BriefcaseIcon,
  CheckCircle2Icon,
  ExternalLinkIcon,
  Loader2Icon,
  PencilLineIcon,
  SearchIcon,
  TargetIcon,
  TrendingUpIcon,
} from 'lucide-react'
import { getJobs } from '../../services/api'
import { analyzeJobFit, getLatestJobFit } from '../../services/api/jobFit'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { readAiResumeSession } from './aiResumeSession'

interface PageState {
  taskId?: string
  accessToken?: string
}

const FIT_META: Record<string, { label: string; cls: string }> = {
  reference_high: { label: '匹配参考：较高', cls: 'bg-green-50 text-green-700' },
  reference_medium: { label: '匹配参考：中等', cls: 'bg-blue-50 text-blue-700' },
  reference_low: { label: '匹配参考：偏低', cls: 'bg-orange-50 text-orange-700' },
}

export function JobFitPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { getToken } = useAuth()
  const state = (location.state ?? {}) as PageState
  const session = useMemo(() => readAiResumeSession(), [])
  const queryTaskId = useMemo(() => new URLSearchParams(location.search).get('taskId') ?? undefined, [location.search])
  const stateTaskId = typeof state.taskId === 'string' ? state.taskId : undefined
  const taskId = stateTaskId ?? queryTaskId ?? session?.taskId
  const usingSessionTask = !stateTaskId && !queryTaskId && Boolean(session?.taskId)
  const accessToken = state.accessToken ?? (usingSessionTask ? session?.accessToken : undefined)

  const [tab, setTab] = useState<'pick' | 'manual'>('pick')
  const [keyword, setKeyword] = useState('')
  const [jobs, setJobs] = useState<ExternalJobDTO[]>([])
  const [jobsLoading, setJobsLoading] = useState(true)
  const [selectedJob, setSelectedJob] = useState<ExternalJobDTO | null>(null)
  const [manualTitle, setManualTitle] = useState('')
  const [manualReq, setManualReq] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [loadingLatest, setLoadingLatest] = useState(Boolean(taskId))
  const [result, setResult] = useState<JobFitResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useBusyLock(analyzing)

  useEffect(() => {
    let cancelled = false
    setJobsLoading(true)
    getJobs({ keyword: keyword || undefined, page: 1, pageSize: 8 })
      .then((res) => { if (!cancelled) setJobs(res.data) })
      .catch(() => { if (!cancelled) setJobs([]) })
      .finally(() => { if (!cancelled) setJobsLoading(false) })
    return () => { cancelled = true }
  }, [keyword])

  useEffect(() => {
    setResult(null)
    setSelectedJob(null)
    setError(null)
    if (!taskId) {
      setLoadingLatest(false)
      return
    }
    let cancelled = false
    setLoadingLatest(true)
    getLatestJobFit(taskId, { token: getToken(), accessToken })
      .then((res) => {
        if (!cancelled) setResult(res.status === 'completed' ? res : null)
      })
      .catch(() => {
        // 没有历史匹配、已过期或非本人时，保持现有选岗/手填入口。
        if (!cancelled) setResult(null)
      })
      .finally(() => {
        if (!cancelled) setLoadingLatest(false)
      })
    return () => { cancelled = true }
  }, [taskId, accessToken, getToken])

  if (!taskId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6">
        <AlertCircleIcon className="h-10 w-10 text-gray-300" aria-hidden="true" />
        <p className="text-base text-gray-500">请先完成简历上传与诊断，再做岗位匹配参考</p>
        <Button size="lg" onClick={() => navigate('/resume/source?intent=diagnose')}>去上传简历</Button>
      </div>
    )
  }

  if (loadingLatest) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6">
        <Loader2Icon className="h-10 w-10 animate-spin text-primary-600" aria-hidden="true" />
        <p className="text-base text-gray-500">正在恢复岗位匹配报告…</p>
      </div>
    )
  }

  const handleAnalyze = async () => {
    setError(null)
    const input =
      tab === 'pick' && selectedJob
        ? { taskId, jobId: selectedJob.id }
        : tab === 'manual' && manualTitle.trim()
          ? { taskId, manualJob: { title: manualTitle.trim(), ...(manualReq.trim() ? { requirements: manualReq.trim() } : {}) } }
          : null
    if (!input) {
      setError(tab === 'pick' ? '请先选择一个岗位' : '请填写目标岗位名称')
      return
    }
    setAnalyzing(true)
    try {
      const res = await analyzeJobFit(input, { token: getToken(), accessToken })
      if (res.status === 'failed') {
        setError(res.failReason ?? '分析未完成，请稍后重试')
      } else {
        setResult(res)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '分析失败，请稍后重试')
    } finally {
      setAnalyzing(false)
    }
  }

  // ── 结果视图 ──────────────────────────────────────────────────────────────
  if (result) {
    const fit = FIT_META[result.fitLevel ?? ''] ?? FIT_META['reference_medium']
    return (
      <div className="flex h-full flex-col px-6 pt-6">
        <PageHeader
          title="岗位匹配度参考"
          subtitle={`目标岗位：${result.job?.title ?? ''}${result.job?.company ? ` · ${result.job.company}` : ''}`}
          actions={<Button size="sm" variant="secondary" onClick={() => navigate('/')}>返回首页</Button>}
        />
        <div className="mt-4 flex flex-1 flex-col gap-4 overflow-y-auto pb-28">
          <ComplianceBanner tone="info">
            以下内容仅为帮助你修改简历与准备投递的参考，不代表任何招聘结果；本平台不提供投递功能，投递请前往岗位来源平台。
          </ComplianceBanner>

          <Card className="p-5">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900">综合参考</h2>
              <span className={['rounded-full px-3 py-1 text-sm font-semibold', fit.cls].join(' ')}>{fit.label}</span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-gray-700">{result.summary}</p>
          </Card>

          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2">
              <CheckCircle2Icon className="h-4 w-4 text-green-600" aria-hidden="true" />
              <h2 className="text-base font-semibold text-gray-900">匹配点（含简历原文依据）</h2>
            </div>
            <div className="flex flex-col gap-2.5">
              {(result.matchPoints ?? []).map((m) => (
                <div key={m.point.slice(0, 24)} className="rounded-xl bg-green-50/60 px-4 py-3">
                  <p className="text-sm font-medium text-gray-900">{m.point}</p>
                  <p className="mt-1 text-xs text-gray-500">原文依据：“{m.evidence}”</p>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2">
              <TrendingUpIcon className="h-4 w-4 text-orange-500" aria-hidden="true" />
              <h2 className="text-base font-semibold text-gray-900">差距与准备建议</h2>
            </div>
            <div className="flex flex-col gap-2.5">
              {(result.gapPoints ?? []).map((g) => (
                <div key={g.gap.slice(0, 24)} className="rounded-xl bg-orange-50/60 px-4 py-3">
                  <p className="text-sm font-medium text-gray-900">{g.gap}</p>
                  <p className="mt-1 text-xs leading-relaxed text-gray-600">{g.suggestion}</p>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2">
              <PencilLineIcon className="h-4 w-4 text-primary-600" aria-hidden="true" />
              <h2 className="text-base font-semibold text-gray-900">简历定向优化建议</h2>
            </div>
            <ul className="flex flex-col gap-2">
              {(result.targetedSuggestions ?? []).map((s) => (
                <li key={s.slice(0, 24)} className="flex items-start gap-2 text-sm leading-relaxed text-gray-700">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary-400" aria-hidden="true" />
                  {s}
                </li>
              ))}
            </ul>
          </Card>

          {result.job?.sourceName && (
            <Card className="p-5">
              <p className="text-xs text-gray-400">
                岗位来源：{result.job.sourceName}{result.job.externalId ? ` · 外部ID ${result.job.externalId}` : ''}
              </p>
              <p className="mt-1 text-sm text-gray-600">准备好之后，请前往来源平台完成投递。</p>
            </Card>
          )}
        </div>

        <div className="absolute inset-x-0 bottom-0 border-t border-gray-100 bg-white/95 px-6 py-4 backdrop-blur">
          <div className="flex gap-3">
            <Button
              size="lg"
              className="h-14 flex-1 text-base"
              onClick={() => navigate('/resume/optimize', { state: { taskId, accessToken } })}
            >
              <PencilLineIcon className="mr-1.5 h-5 w-5" aria-hidden="true" />
              生成优化版简历
            </Button>
            {result.job?.sourceUrl && selectedJob?.id ? (
              <Button
                size="lg"
                variant="secondary"
                className="h-14 flex-1 text-base"
                onClick={() => navigate(`/jobs/${selectedJob.id}`)}
              >
                <ExternalLinkIcon className="mr-1.5 h-5 w-5" aria-hidden="true" />
                去来源平台投递
              </Button>
            ) : (
              <Button size="lg" variant="secondary" className="h-14 flex-1 text-base" onClick={() => setResult(null)}>
                换个岗位分析
              </Button>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ── 选择视图 ──────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col px-6 pt-6">
      <PageHeader
        title="岗位匹配度参考"
        subtitle="选择目标岗位，基于你的简历生成定向参考与优化建议"
        actions={<Button size="sm" variant="secondary" onClick={() => navigate(-1)}>返回</Button>}
      />
      <div className="mt-4 flex flex-1 flex-col gap-4 overflow-y-auto pb-28">
        <ComplianceBanner tone="info">
          分析结果仅供本人参考，不代表录用结果；本平台不提供投递功能，投递请前往岗位来源平台。
        </ComplianceBanner>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setTab('pick')}
            className={['min-h-[52px] rounded-xl border text-sm font-semibold', tab === 'pick' ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 bg-white text-gray-600'].join(' ')}
          >
            <BriefcaseIcon className="mr-1.5 inline h-4 w-4" aria-hidden="true" />
            从岗位信息选择
          </button>
          <button
            type="button"
            onClick={() => setTab('manual')}
            className={['min-h-[52px] rounded-xl border text-sm font-semibold', tab === 'manual' ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-gray-200 bg-white text-gray-600'].join(' ')}
          >
            <TargetIcon className="mr-1.5 inline h-4 w-4" aria-hidden="true" />
            手填目标岗位
          </button>
        </div>

        {tab === 'pick' ? (
          <Card className="p-4">
            <div className="relative">
              <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-300" aria-hidden="true" />
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索岗位名称 / 公司"
                className="min-h-[48px] w-full rounded-xl border border-gray-200 pl-9 pr-3 text-sm focus:border-primary-500 focus:outline-none"
              />
            </div>
            <div className="mt-3 flex flex-col gap-2">
              {jobsLoading ? (
                <p className="flex items-center gap-2 py-6 text-sm text-gray-400">
                  <Loader2Icon className="h-4 w-4 animate-spin" aria-hidden="true" />正在加载岗位…
                </p>
              ) : jobs.length === 0 ? (
                <p className="py-6 text-center text-sm text-gray-400">没有找到岗位，可切换「手填目标岗位」</p>
              ) : (
                jobs.map((j) => {
                  const active = selectedJob?.id === j.id
                  return (
                    <button
                      key={j.id}
                      type="button"
                      onClick={() => setSelectedJob(j)}
                      className={['flex min-h-[56px] items-center justify-between rounded-xl border px-4 py-3 text-left', active ? 'border-primary-500 bg-primary-50' : 'border-gray-100 bg-white hover:border-gray-200'].join(' ')}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-gray-900">{j.title}</span>
                        <span className="mt-0.5 block truncate text-xs text-gray-500">{j.company} · 来源：{j.sourceName}</span>
                      </span>
                      {active && <CheckCircle2Icon className="h-5 w-5 shrink-0 text-primary-600" aria-hidden="true" />}
                    </button>
                  )
                })
              )}
            </div>
          </Card>
        ) : (
          <Card className="p-4">
            <input
              value={manualTitle}
              onChange={(e) => setManualTitle(e.target.value)}
              maxLength={50}
              placeholder="目标岗位名称，如：行政专员"
              className="min-h-[52px] w-full rounded-xl border border-gray-200 px-4 text-base focus:border-primary-500 focus:outline-none"
            />
            <textarea
              value={manualReq}
              onChange={(e) => setManualReq(e.target.value)}
              maxLength={2000}
              rows={5}
              placeholder="可粘贴岗位 JD / 任职要求（选填，提供后参考更有针对性）"
              className="mt-2 w-full resize-none rounded-xl border border-gray-200 px-4 py-3 text-sm leading-relaxed focus:border-primary-500 focus:outline-none"
            />
          </Card>
        )}

        {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>}
      </div>

      <div className="absolute inset-x-0 bottom-0 border-t border-gray-100 bg-white/95 px-6 py-4 backdrop-blur">
        <Button size="lg" className="h-14 w-full text-base" disabled={analyzing} onClick={() => void handleAnalyze()}>
          {analyzing ? (
            <>
              <Loader2Icon className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />
              正在分析（约 10-20 秒）…
            </>
          ) : (
            <>
              开始匹配参考分析
              <ArrowRightIcon className="ml-1.5 h-5 w-5" aria-hidden="true" />
            </>
          )}
        </Button>
      </div>
    </div>
  )
}
