// ============================================================
// 岗位大师（岗位决策分析台）M1。
//
// 入口①首页「岗位大师」磁贴。流程：选择系统内已发布岗位或手填目标岗位 →
// 单次分析（适配度双栏 + 薪资参考 + 晋升路径三节点 + 风险）→ 竖屏四段结果卡 →
// 打印《岗位决策参考报告》(真实 PDF → 我的文档 → 打印链路)。
// 简历来源：诊断 taskId/accessToken（location.state / query / 会话）。
// 合规：适配度仅参考等级(无百分比/录用承诺);薪资只透传来源方文本;投递只引导
// 「去来源平台投递」;失败诚实提示,不产假结果。
// ============================================================

import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button, Card, ComplianceBanner, PageHeader } from '@ai-job-print/ui'
import type { ExternalJobDTO, JobMasterResponse } from '@ai-job-print/shared'
import { makePrintParams } from '@ai-job-print/shared'
import {
  AlertCircleIcon,
  ArrowRightIcon,
  BrainCircuitIcon,
  BriefcaseIcon,
  CheckCircle2Icon,
  CoinsIcon,
  ExternalLinkIcon,
  Loader2Icon,
  PencilLineIcon,
  PrinterIcon,
  SearchIcon,
  ShieldAlertIcon,
  TargetIcon,
  TrendingUpIcon,
} from 'lucide-react'
import { getJobs } from '../../services/api'
import { analyzeJobMaster, getLatestJobMaster, printJobMaster } from '../../services/api/jobMaster'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { readAiResumeSession } from '../resume/aiResumeSession'

interface PageState {
  taskId?: string
  accessToken?: string
}

const FIT_META: Record<string, { label: string; cls: string }> = {
  reference_high: { label: '参考匹配度：较高', cls: 'bg-green-50 text-green-700' },
  reference_medium: { label: '参考匹配度：中等', cls: 'bg-blue-50 text-blue-700' },
  reference_low: { label: '参考匹配度：偏低', cls: 'bg-orange-50 text-orange-700' },
}

const RISK_META: Record<string, { label: string; cls: string }> = {
  low: { label: '关注度：较低', cls: 'bg-green-50 text-green-700' },
  medium: { label: '关注度：需注意', cls: 'bg-amber-50 text-amber-700' },
  high: { label: '关注度：需谨慎', cls: 'bg-red-50 text-red-700' },
}

export function JobMasterPage() {
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
  const [printing, setPrinting] = useState(false)
  const [loadingLatest, setLoadingLatest] = useState(Boolean(taskId))
  const [result, setResult] = useState<JobMasterResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useBusyLock(analyzing || printing)

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
    getLatestJobMaster(taskId, { token: getToken(), accessToken })
      .then((res) => { if (!cancelled) setResult(res.status === 'completed' ? res : null) })
      .catch(() => { if (!cancelled) setResult(null) })
      .finally(() => { if (!cancelled) setLoadingLatest(false) })
    return () => { cancelled = true }
  }, [taskId, accessToken, getToken])

  if (!taskId) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6">
        <AlertCircleIcon className="h-10 w-10 text-gray-300" aria-hidden="true" />
        <p className="text-base text-gray-500">请先完成简历上传与诊断，再做岗位决策分析</p>
        <Button size="lg" onClick={() => navigate('/resume/source?intent=diagnose')}>去上传简历</Button>
      </div>
    )
  }

  if (loadingLatest) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-6">
        <Loader2Icon className="h-10 w-10 animate-spin text-primary-600" aria-hidden="true" />
        <p className="text-base text-gray-500">正在恢复岗位决策报告…</p>
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
      const res = await analyzeJobMaster(input, { token: getToken(), accessToken })
      if (res.status === 'failed') setError(res.failReason ?? '分析未完成，请稍后重试')
      else setResult(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : '分析失败，请稍后重试')
    } finally {
      setAnalyzing(false)
    }
  }

  const handlePrint = async () => {
    setError(null)
    setPrinting(true)
    try {
      const file = await printJobMaster(taskId, { token: getToken(), accessToken })
      navigate('/print/confirm', {
        state: {
          file: {
            name: file.filename,
            size: file.sizeBytes >= 1024 * 1024 ? `${(file.sizeBytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(file.sizeBytes / 1024))} KB`,
            pages: file.pageCount,
            fileId: file.fileId,
            fileUrl: file.signedUrl || undefined,
            mimeType: 'application/pdf',
          },
          params: makePrintParams({ copies: 1, duplex: 'single', color: 'bw' }),
        },
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '决策报告生成失败，请稍后重试')
    } finally {
      setPrinting(false)
    }
  }

  // ── 结果视图（竖屏四段卡）──────────────────────────────────────────────────
  if (result) {
    const fit = FIT_META[result.fit?.level ?? ''] ?? FIT_META['reference_medium']
    const cp = result.careerPath
    return (
      <div className="flex h-full flex-col px-6 pt-6">
        <PageHeader
          title="岗位决策参考报告"
          subtitle={`目标岗位：${result.job?.title ?? ''}${result.job?.company ? ` · ${result.job.company}` : ''}`}
          actions={<Button size="sm" variant="secondary" onClick={() => navigate('/')}>返回首页</Button>}
        />
        <div className="mt-4 flex flex-1 flex-col gap-4 overflow-y-auto pb-28">
          <ComplianceBanner tone="info">
            以下内容仅为帮助你决策与准备投递的参考，不代表任何招聘结果或薪酬承诺；本平台不提供投递功能，投递请前往岗位来源平台。
          </ComplianceBanner>

          {/* 一、适配度 + 概要 */}
          <Card className="p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BrainCircuitIcon className="h-4 w-4 text-primary-600" aria-hidden="true" />
                <h2 className="text-base font-semibold text-gray-900">岗位适配度</h2>
              </div>
              <span className={['rounded-full px-3 py-1 text-sm font-semibold', fit.cls].join(' ')}>{fit.label}</span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-gray-700">{result.fit?.summary}</p>
            <div className="mt-4 grid grid-cols-1 gap-3">
              <div>
                <div className="mb-2 flex items-center gap-1.5">
                  <CheckCircle2Icon className="h-4 w-4 text-green-600" aria-hidden="true" />
                  <span className="text-sm font-semibold text-gray-800">已具备</span>
                </div>
                <div className="flex flex-col gap-2">
                  {(result.fit?.matchedSkills ?? []).map((m) => (
                    <div key={m.skill.slice(0, 24)} className="rounded-xl bg-green-50/60 px-4 py-3">
                      <p className="text-sm font-medium text-gray-900">{m.skill}</p>
                      <p className="mt-1 text-xs text-gray-500">原文依据：“{m.evidence}”</p>
                    </div>
                  ))}
                </div>
              </div>
              {(result.fit?.gapSkills ?? []).length > 0 && (
                <div>
                  <div className="mb-2 flex items-center gap-1.5">
                    <TrendingUpIcon className="h-4 w-4 text-orange-500" aria-hidden="true" />
                    <span className="text-sm font-semibold text-gray-800">建议补足</span>
                  </div>
                  <div className="flex flex-col gap-2">
                    {(result.fit?.gapSkills ?? []).map((g) => (
                      <div key={g.skill.slice(0, 24)} className="rounded-xl bg-orange-50/60 px-4 py-3">
                        <p className="text-sm font-medium text-gray-900">{g.skill}</p>
                        <p className="mt-1 text-xs leading-relaxed text-gray-600">{g.suggestion}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </Card>

          {/* 二、薪资参考（只透传来源方文本） */}
          <Card className="p-5">
            <div className="mb-2 flex items-center gap-2">
              <CoinsIcon className="h-4 w-4 text-amber-500" aria-hidden="true" />
              <h2 className="text-base font-semibold text-gray-900">薪资参考</h2>
            </div>
            <p className="text-sm font-medium text-gray-900">
              {result.salary?.sourceText ? `来源方提供：${result.salary.sourceText}` : '来源平台未提供薪资信息'}
            </p>
            {result.salary?.note && <p className="mt-1 text-xs text-gray-500">{result.salary.note}</p>}
          </Card>

          {/* 三、晋升路径三节点 */}
          {cp && (
            <Card className="p-5">
              <div className="mb-3 flex items-center gap-2">
                <TargetIcon className="h-4 w-4 text-primary-600" aria-hidden="true" />
                <h2 className="text-base font-semibold text-gray-900">晋升路径参考</h2>
              </div>
              <ol className="flex flex-col gap-3">
                <li className="rounded-xl bg-gray-50 px-4 py-3">
                  <p className="text-xs font-semibold text-gray-400">当前</p>
                  <p className="text-sm font-medium text-gray-900">{cp.current.title}</p>
                  <p className="mt-1 text-xs text-gray-500">依据：{cp.current.evidence}</p>
                </li>
                <li className="rounded-xl bg-primary-50/60 px-4 py-3">
                  <p className="text-xs font-semibold text-primary-500">1-3 年</p>
                  <p className="text-sm font-medium text-gray-900">{cp.next.title}</p>
                  {cp.next.skillsToBuild.length > 0 && <p className="mt-1 text-xs text-gray-600">待补技能：{cp.next.skillsToBuild.join('、')}</p>}
                  <p className="mt-1 text-xs text-gray-600">第一步：{cp.next.firstStep}</p>
                </li>
                <li className="rounded-xl bg-primary-50/60 px-4 py-3">
                  <p className="text-xs font-semibold text-primary-500">3-5 年</p>
                  <p className="text-sm font-medium text-gray-900">{cp.target.title}</p>
                  {cp.target.skillsToBuild.length > 0 && <p className="mt-1 text-xs text-gray-600">待补技能：{cp.target.skillsToBuild.join('、')}</p>}
                </li>
              </ol>
            </Card>
          )}

          {/* 四、风险与建议 */}
          <Card className="p-5">
            <div className="mb-3 flex items-center gap-2">
              <ShieldAlertIcon className="h-4 w-4 text-red-500" aria-hidden="true" />
              <h2 className="text-base font-semibold text-gray-900">风险与建议</h2>
            </div>
            {(result.risks ?? []).length === 0 ? (
              <p className="text-sm text-gray-500">未发现明显硬性门槛风险；仍建议到来源平台核实岗位完整信息。</p>
            ) : (
              <div className="flex flex-col gap-2.5">
                {(result.risks ?? []).map((r) => {
                  const rm = RISK_META[r.level] ?? RISK_META['medium']
                  return (
                    <div key={r.title.slice(0, 24)} className="rounded-xl bg-gray-50 px-4 py-3">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-gray-900">{r.title}</p>
                        <span className={['rounded-full px-2.5 py-0.5 text-xs font-semibold', rm.cls].join(' ')}>{rm.label}</span>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed text-gray-600">{r.reason}</p>
                      <p className="mt-1 text-xs text-gray-400">依据：{r.basis}</p>
                    </div>
                  )
                })}
              </div>
            )}
          </Card>

          {result.job?.sourceName && (
            <Card className="p-5">
              <p className="text-xs text-gray-400">
                岗位来源：{result.job.sourceName}{result.job.externalId ? ` · 外部ID ${result.job.externalId}` : ''}
              </p>
              <p className="mt-1 text-sm text-gray-600">准备好之后，请前往来源平台完成投递。</p>
            </Card>
          )}

          {error && <p className="rounded-xl bg-red-50 px-4 py-3 text-sm text-red-600">{error}</p>}
        </div>

        <div className="absolute inset-x-0 bottom-0 border-t border-gray-100 bg-white/95 px-6 py-4 backdrop-blur">
          <div className="flex gap-3">
            <Button size="lg" className="h-14 flex-1 text-base" disabled={printing} onClick={() => void handlePrint()}>
              {printing ? (
                <><Loader2Icon className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />正在生成报告…</>
              ) : (
                <><PrinterIcon className="mr-1.5 h-5 w-5" aria-hidden="true" />打印决策报告</>
              )}
            </Button>
            {result.job?.sourceUrl && selectedJob?.id ? (
              <Button size="lg" variant="secondary" className="h-14 flex-1 text-base" onClick={() => navigate(`/jobs/${selectedJob.id}`)}>
                <ExternalLinkIcon className="mr-1.5 h-5 w-5" aria-hidden="true" />去来源平台投递
              </Button>
            ) : (
              <Button size="lg" variant="secondary" className="h-14 flex-1 text-base" onClick={() => navigate('/resume/optimize', { state: { taskId, accessToken } })}>
                <PencilLineIcon className="mr-1.5 h-5 w-5" aria-hidden="true" />去优化简历
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
        title="岗位大师"
        subtitle="选择目标岗位，基于你的简历生成可打印的岗位决策参考报告"
        actions={<Button size="sm" variant="secondary" onClick={() => navigate(-1)}>返回</Button>}
      />
      <div className="mt-4 flex flex-1 flex-col gap-4 overflow-y-auto pb-28">
        <ComplianceBanner tone="info">
          分析结果仅供本人决策参考，不代表录用结果或薪酬承诺；本平台不提供投递功能，投递请前往岗位来源平台。
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
            <><Loader2Icon className="mr-2 h-5 w-5 animate-spin" aria-hidden="true" />正在分析（约 10-20 秒）…</>
          ) : (
            <>开始岗位决策分析<ArrowRightIcon className="ml-1.5 h-5 w-5" aria-hidden="true" /></>
          )}
        </Button>
      </div>
    </div>
  )
}
