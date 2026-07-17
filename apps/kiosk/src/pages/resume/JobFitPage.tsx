// ============================================================
// 2D 目标岗位定向优化 + 岗位匹配参考。
//
// 入口：诊断报告页（携带 taskId/accessToken）。流程：选择系统内已发布岗位
// （搜索选择）或手填目标岗位 → 真实分析 → 参考等级 + 匹配点（含原文依据）+
// 差距建议 + 定向优化建议，并可查看系统内岗位详情。
// 合规：等级仅供参考（无百分比/录用承诺，服务端双层拦截）；不做平台内投递。
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button, Card, ComplianceBanner, PageHeader } from '@ai-job-print/ui'
import type { ExternalJobDTO, JobFitRequest, JobFitResponse } from '@ai-job-print/shared'
import { makePrintParams } from '@ai-job-print/shared'
import {
  AlertCircleIcon,
  ArrowRightIcon,
  BriefcaseIcon,
  CheckCircle2Icon,
  Loader2Icon,
  PencilLineIcon,
  PrinterIcon,
  SearchIcon,
  TargetIcon,
} from 'lucide-react'
import { getJobs } from '../../services/api'
import {
  analyzeJobFit,
  getJobFitConsentStatus,
  getLatestJobFit,
  grantJobFitConsent,
  JobFitApiError,
  printJobFit,
  revokeJobFitConsent,
} from '../../services/api/jobFit'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { readAiResumeSession } from './aiResumeSession'
import { DecisionSummaryBar } from './jobFit/DecisionSummaryBar'
import { FitSkillMap } from './jobFit/FitSkillMap'
import { GapActionCards } from './jobFit/GapActionCards'
import { ResumeRewriteCard } from './jobFit/ResumeRewriteCard'
import { AnonymousJobFitConsentCard } from './jobFit/AnonymousJobFitConsentCard'
import { AnonymousJobFitConsentDialog } from './jobFit/AnonymousJobFitConsentDialog'
import { MemberJobFitConsentCard } from './jobFit/MemberJobFitConsentCard'
import './jobFit-inkpaper.css'

interface PageState {
  taskId?: string
  accessToken?: string
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
  const currentToken = getToken()
  const isAnonymous = !currentToken && Boolean(accessToken)

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
  const [result, setResult] = useState<JobFitResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pendingConsentInput, setPendingConsentInput] = useState<JobFitRequest | null>(null)
  const [showAnonymousConsent, setShowAnonymousConsent] = useState(false)
  const [consentError, setConsentError] = useState<string | null>(null)
  const [memberConsentRequired, setMemberConsentRequired] = useState(false)
  const [anonymousConsentActive, setAnonymousConsentActive] = useState(false)
  const [revokingConsent, setRevokingConsent] = useState(false)
  const anonymousConsentRevisionRef = useRef(0)

  useBusyLock(analyzing || printing || revokingConsent)

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
    setNotice(null)
    setPendingConsentInput(null)
    setShowAnonymousConsent(false)
    setConsentError(null)
    setMemberConsentRequired(false)
    setAnonymousConsentActive(false)
    const consentStatusRevision = ++anonymousConsentRevisionRef.current
    if (!taskId) {
      setLoadingLatest(false)
      return
    }
    let cancelled = false
    setLoadingLatest(true)
    if (isAnonymous && accessToken) {
      void getJobFitConsentStatus(taskId, { accessToken })
        .then((status) => {
          if (!cancelled && consentStatusRevision === anonymousConsentRevisionRef.current) {
            setAnonymousConsentActive(status.active)
          }
        })
        .catch(() => {
          if (!cancelled && consentStatusRevision === anonymousConsentRevisionRef.current) {
            setAnonymousConsentActive(false)
          }
        })
    }
    getLatestJobFit(taskId, { token: currentToken, accessToken })
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
  }, [taskId, accessToken, currentToken, isAnonymous])

  if (!taskId) {
    return (
      <div className="service-desk job-fit-inkpaper job-fit-inkpaper--gate flex h-full flex-col items-center justify-center gap-4 px-6" data-visual-theme="service-desk" data-ux-density="touch">
        <div className="job-fit-state-card" role="alert">
          <AlertCircleIcon className="h-10 w-10 text-primary-600" aria-hidden="true" />
          <p className="text-base text-neutral-500">请先完成简历上传与诊断，再做岗位匹配参考</p>
          <Button size="lg" className="job-fit-primary-action" onClick={() => navigate('/resume/source?intent=diagnose')}>去上传简历</Button>
        </div>
      </div>
    )
  }

  if (loadingLatest) {
    return (
      <div className="service-desk job-fit-inkpaper job-fit-inkpaper--loading flex h-full flex-col items-center justify-center gap-4 px-6" data-visual-theme="service-desk" data-ux-density="touch">
        <div className="job-fit-state-card" role="status" aria-live="polite">
          <Loader2Icon className="h-10 w-10 animate-spin text-primary-600" aria-hidden="true" />
          <p className="text-base text-neutral-500">正在恢复岗位匹配报告…</p>
        </div>
      </div>
    )
  }

  const handleAnalyze = async () => {
    setError(null)
    setNotice(null)
    setMemberConsentRequired(false)
    const input: JobFitRequest | null =
      tab === 'pick' && selectedJob
        ? { taskId, jobId: selectedJob.id }
        : tab === 'manual' && manualTitle.trim()
          ? { taskId, manualJob: { title: manualTitle.trim(), ...(manualReq.trim() ? { requirements: manualReq.trim() } : {}) } }
          : null
    if (!input) {
      setError(tab === 'pick' ? '请先选择一个岗位' : '请填写目标岗位名称')
      return
    }
    const token = getToken()
    setAnalyzing(true)
    try {
      const res = await analyzeJobFit(input, { token, accessToken })
      if (res.status === 'failed') {
        setError(res.failReason ?? '分析未完成，请稍后重试')
      } else {
        setResult(res)
      }
    } catch (err) {
      if (err instanceof JobFitApiError && err.status === 403) {
        if (err.code === 'JOB_FIT_ANONYMOUS_CONSENT_REQUIRED' && !token && accessToken) {
          setPendingConsentInput(input)
          setConsentError(null)
          setShowAnonymousConsent(true)
          return
        }
        if (err.code === 'USER_AI_CONSENT_REQUIRED' && token) {
          setMemberConsentRequired(true)
          setError('请先确认岗位 AI 辅助授权，再返回进行岗位匹配参考分析。')
          return
        }
      }
      setError(err instanceof Error ? err.message : '分析失败，请稍后重试')
    } finally {
      setAnalyzing(false)
    }
  }

  const handleConfirmAnonymousConsent = async () => {
    const input = pendingConsentInput
    if (!input || !accessToken) return
    setAnalyzing(true)
    setConsentError(null)
    let granted = false
    try {
      await grantJobFitConsent(taskId, { accessToken })
      granted = true
      anonymousConsentRevisionRef.current += 1
      setAnonymousConsentActive(true)
      setShowAnonymousConsent(false)
      setPendingConsentInput(null)
      const res = await analyzeJobFit(input, { accessToken })
      if (res.status === 'failed') {
        setError(res.failReason ?? '分析未完成，请稍后重试')
      } else {
        setResult(res)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : '授权失败，请稍后重试'
      if (granted) setError(message)
      else setConsentError(message)
    } finally {
      setAnalyzing(false)
    }
  }

  const handleCancelAnonymousConsent = () => {
    setShowAnonymousConsent(false)
    setPendingConsentInput(null)
    setConsentError(null)
  }

  const handleRevokeConsent = async () => {
    if (!accessToken) return
    setRevokingConsent(true)
    setError(null)
    setNotice(null)
    try {
      await revokeJobFitConsent(taskId, { accessToken })
      anonymousConsentRevisionRef.current += 1
      setAnonymousConsentActive(false)
      setNotice('已撤回，重新分析需再次授权')
    } catch (err) {
      setError(err instanceof Error ? err.message : '撤回失败，请稍后重试')
    } finally {
      setRevokingConsent(false)
    }
  }

  const handlePrint = async () => {
    if (!taskId) return
    setPrinting(true)
    setError(null)
    try {
      const file = await printJobFit(taskId, { token: getToken(), accessToken })
      if (!file.printFileUrl) throw new Error('打印链接未就绪，请稍后重试')
      navigate('/print/confirm', {
        state: {
          file: {
            name: file.filename,
            size: file.sizeBytes >= 1024 * 1024 ? `${(file.sizeBytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(file.sizeBytes / 1024))} KB`,
            pages: file.pageCount,
            fileId: file.fileId,
            fileUrl: file.printFileUrl,
            mimeType: 'application/pdf',
          },
          params: makePrintParams({ copies: 1, duplex: 'single', color: 'bw' }),
        },
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : '打印版生成失败，请稍后重试')
    } finally {
      setPrinting(false)
    }
  }

  // ── 结果视图 ──────────────────────────────────────────────────────────────
  if (result) {
    return (
      <div className="service-desk job-fit-inkpaper job-fit-inkpaper--result flex h-full flex-col px-6 pt-6" data-visual-theme="service-desk" data-ux-density="touch">
        <div className="job-fit-header">
          <PageHeader
            title="岗位匹配参考"
            subtitle={`目标岗位：${result.job?.title ?? ''}${result.job?.company ? ` · ${result.job.company}` : ''}`}
            actions={<Button size="sm" variant="secondary" onClick={() => navigate('/')}>返回首页</Button>}
          />
        </div>
        <div className="job-fit-content mt-4 flex flex-1 flex-col gap-4 overflow-y-auto pb-28">
          <ComplianceBanner tone="info">
            以下内容仅为帮助你修改简历与准备投递的参考，不代表任何招聘结果；本平台不提供投递功能，投递请前往岗位来源平台。
          </ComplianceBanner>

          <DecisionSummaryBar
            jobTitle={result.job?.title ?? '目标岗位'}
            company={result.job?.company}
            fitLevel={result.fitLevel}
            summary={result.summary}
          />
          <FitSkillMap
            matchPoints={result.matchPoints ?? []}
            keywordCoverage={result.decisionSupport?.keywordCoverage}
          />
          <GapActionCards gapPoints={result.gapPoints ?? []} />
          <ResumeRewriteCard items={result.targetedSuggestions ?? []} />

          {result.job?.sourceName && (
            <Card className="job-fit-card job-fit-source p-5">
              <p className="text-xs text-neutral-400">
                岗位来源：{result.job.sourceName}{result.job.externalId ? ` · 外部ID ${result.job.externalId}` : ''}
              </p>
              <p className="mt-1 text-sm text-neutral-600">准备好之后，请前往来源平台完成投递。</p>
            </Card>
          )}

          {isAnonymous && anonymousConsentActive && (
            <AnonymousJobFitConsentCard busy={revokingConsent} onRevoke={() => void handleRevokeConsent()} />
          )}
          {notice && <p className="job-fit-notice rounded-xl bg-primary-50 px-4 py-3 text-sm text-primary-700" aria-live="polite">{notice}</p>}
          {error && <p className="job-fit-alert rounded-xl bg-error-bg px-4 py-3 text-sm text-error-fg" role="alert">{error}</p>}
        </div>

        <div className="job-fit-action-bar absolute inset-x-0 bottom-0 border-t border-neutral-100 bg-white/95 px-6 py-4 backdrop-blur">
          <div className="job-fit-action-grid grid grid-cols-3 gap-2">
            <Button
              size="lg"
              variant="secondary"
              className="h-14 text-sm"
              disabled={printing}
              onClick={() => void handlePrint()}
            >
              {printing ? <Loader2Icon className="h-5 w-5 animate-spin" aria-hidden="true" /> : <PrinterIcon className="mr-1 h-5 w-5" aria-hidden="true" />}
              {printing ? '生成中' : '打印报告'}
            </Button>
            <Button
              size="lg"
              className="h-14 text-sm"
              onClick={() => navigate('/resume/optimize', { state: { taskId, accessToken } })}
            >
              <PencilLineIcon className="mr-1 h-5 w-5" aria-hidden="true" />
              优化简历
            </Button>
            {result.job?.id ? (
              <Button
                size="lg"
                variant="secondary"
                className="h-14 text-sm"
                onClick={() => {
                  if (result.job?.id) navigate(`/jobs/${result.job.id}`)
                }}
              >
                <BriefcaseIcon className="mr-1 h-5 w-5" aria-hidden="true" />
                查看岗位
              </Button>
            ) : (
              <Button size="lg" variant="secondary" className="h-14 text-sm" onClick={() => setResult(null)}>
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
    <div className="service-desk job-fit-inkpaper job-fit-inkpaper--form flex h-full flex-col px-6 pt-6" data-visual-theme="service-desk" data-ux-density="touch">
      {showAnonymousConsent && (
        <AnonymousJobFitConsentDialog
          busy={analyzing}
          error={consentError}
          onCancel={handleCancelAnonymousConsent}
          onConfirm={() => void handleConfirmAnonymousConsent()}
        />
      )}
      <div className="job-fit-header">
        <PageHeader
          title="岗位匹配参考"
          subtitle="选择目标岗位，基于本人简历生成定向参考与优化建议"
          actions={<Button size="sm" variant="secondary" onClick={() => navigate(-1)}>返回</Button>}
        />
      </div>
      <div className="job-fit-content mt-4 flex flex-1 flex-col gap-4 overflow-y-auto pb-28">
        <ComplianceBanner tone="info">
          分析结果仅供本人参考，不代表录用结果；本平台不提供投递功能，投递请前往岗位来源平台。
        </ComplianceBanner>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setTab('pick')}
            aria-pressed={tab === 'pick'}
            className={['min-h-[52px] rounded-xl border text-sm font-semibold', tab === 'pick' ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-neutral-200 bg-white text-neutral-600'].join(' ')}
          >
            <BriefcaseIcon className="mr-1.5 inline h-4 w-4" aria-hidden="true" />
            从岗位信息选择
          </button>
          <button
            type="button"
            onClick={() => setTab('manual')}
            aria-pressed={tab === 'manual'}
            className={['min-h-[52px] rounded-xl border text-sm font-semibold', tab === 'manual' ? 'border-primary-500 bg-primary-50 text-primary-700' : 'border-neutral-200 bg-white text-neutral-600'].join(' ')}
          >
            <TargetIcon className="mr-1.5 inline h-4 w-4" aria-hidden="true" />
            手填目标岗位
          </button>
        </div>

        {tab === 'pick' ? (
          <Card className="job-fit-card p-4">
            <div className="relative">
              <SearchIcon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-300" aria-hidden="true" />
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索岗位名称 / 公司"
                aria-label="搜索岗位名称或公司"
                className="min-h-[48px] w-full rounded-xl border border-neutral-200 pl-9 pr-3 text-sm focus:border-primary-500 focus:outline-none"
              />
            </div>
            <div className="mt-3 flex flex-col gap-2" aria-busy={jobsLoading} aria-live="polite">
              {jobsLoading ? (
                <p className="flex items-center gap-2 py-6 text-sm text-neutral-400" role="status">
                  <Loader2Icon className="h-4 w-4 animate-spin" aria-hidden="true" />正在加载岗位…
                </p>
              ) : jobs.length === 0 ? (
                <p className="py-6 text-center text-sm text-neutral-400">没有找到岗位，可切换「手填目标岗位」</p>
              ) : (
                jobs.map((j) => {
                  const active = selectedJob?.id === j.id
                  return (
                    <button
                      key={j.id}
                      type="button"
                      onClick={() => setSelectedJob(j)}
                      aria-pressed={active}
                      aria-label={`${j.title}，${j.company}，${active ? '已选择' : '未选择'}`}
                      className={['flex min-h-[56px] items-center justify-between rounded-xl border px-4 py-3 text-left', active ? 'border-primary-500 bg-primary-50' : 'border-neutral-100 bg-white hover:border-neutral-200'].join(' ')}
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-neutral-900">{j.title}</span>
                        <span className="mt-0.5 block truncate text-xs text-neutral-500">{j.company} · 来源：{j.sourceName}</span>
                      </span>
                      {active && <CheckCircle2Icon className="h-5 w-5 shrink-0 text-primary-600" aria-hidden="true" />}
                    </button>
                  )
                })
              )}
            </div>
          </Card>
        ) : (
          <Card className="job-fit-card p-4">
            <input
              value={manualTitle}
              onChange={(e) => setManualTitle(e.target.value)}
              maxLength={50}
              placeholder="目标岗位名称，如：行政专员"
              aria-label="目标岗位名称"
              className="min-h-[52px] w-full rounded-xl border border-neutral-200 px-4 text-base focus:border-primary-500 focus:outline-none"
            />
            <textarea
              value={manualReq}
              onChange={(e) => setManualReq(e.target.value)}
              maxLength={2000}
              rows={5}
              placeholder="可粘贴岗位 JD / 任职要求（选填，提供后参考更有针对性）"
              aria-label="岗位 JD 或任职要求"
              className="mt-2 w-full resize-none rounded-xl border border-neutral-200 px-4 py-3 text-sm leading-relaxed focus:border-primary-500 focus:outline-none"
            />
          </Card>
        )}

        {error && <p className="job-fit-alert rounded-xl bg-error-bg px-4 py-3 text-sm text-error-fg" role="alert">{error}</p>}
        {notice && <p className="job-fit-notice rounded-xl bg-primary-50 px-4 py-3 text-sm text-primary-700" aria-live="polite">{notice}</p>}
        {memberConsentRequired && (
          <MemberJobFitConsentCard onNavigate={() => navigate('/jobs')} />
        )}
        {isAnonymous && anonymousConsentActive && (
          <AnonymousJobFitConsentCard busy={revokingConsent} onRevoke={() => void handleRevokeConsent()} />
        )}
      </div>

      <div className="job-fit-action-bar absolute inset-x-0 bottom-0 border-t border-neutral-100 bg-white/95 px-6 py-4 backdrop-blur">
        <Button size="lg" className="job-fit-primary-action h-14 w-full text-base" disabled={analyzing} aria-busy={analyzing} onClick={() => void handleAnalyze()}>
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
