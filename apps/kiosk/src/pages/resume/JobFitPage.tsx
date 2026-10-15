// ============================================================
// 2D 目标岗位定向优化 + 岗位匹配参考。
//
// 入口：诊断报告页（携带 taskId/accessToken）。流程：选择系统内已发布岗位
// （搜索选择）或手填目标岗位 → 真实分析 → 参考等级 + 匹配点（含原文依据）+
// 差距建议 + 定向优化建议，并可查看系统内岗位详情。
// 合规：等级仅供参考（无百分比/录用承诺，服务端双层拦截）；不做平台内投递。
// ============================================================

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { ExternalJobDTO, JobFitRequest, JobFitResponse } from '@ai-job-print/shared'
import { makePrintParams } from '@ai-job-print/shared'
import {
  AlertCircleIcon,
  ArrowRightIcon,
  BriefcaseIcon,
  CheckCircle2Icon,
  InfoIcon,
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
import { ResumeDecisionFrame } from './decision/ResumeDecisionFrame'
import { readAiResumeSession } from './aiResumeSession'
import { DecisionSummaryBar } from './jobFit/DecisionSummaryBar'
import { FitSkillMap } from './jobFit/FitSkillMap'
import { AnonymousJobFitConsentCard } from './jobFit/AnonymousJobFitConsentCard'
import { AnonymousJobFitConsentDialog } from './jobFit/AnonymousJobFitConsentDialog'
import { MemberJobFitConsentCard } from './jobFit/MemberJobFitConsentCard'
import { JobAiConsentModal } from '../jobs/components/JobAiConsentModal'
import { grantJobAiConsent } from '../../services/api/jobAi'
import './jobFit-inkpaper.css'
import './jobFit-inkpaper-ext.css'
import { userMessageOf } from '../../services/api/userErrorMessage'

interface PageState {
  taskId?: string
  accessToken?: string
}

/**
 * 只判「有没有 taskId」不够：sessionStorage 里的 taskId 会比后端那行解析结果活得久。
 * 后端 AI_TASK_NOT_FOUND（不存在 / 已过期 / 不属于当前身份）必须挡在选岗表单之前，
 * 否则用户选完岗位再点分析，吃到的是同一条失败。JOB_FIT_NOT_FOUND 是另一回事：
 * 解析还在，只是还没做过匹配 —— 那种情况该放行选岗。
 */
type PreconditionGate = 'missing' | 'rejected'

/**
 * 合规披露条。
 *
 * 迁移前用的是 ui 包的 `ComplianceBanner`（暖褐主题），换到青序流光壳之后两套色系
 * 不能落在同一页上，所以这里按稿 46 的 guardline 自绘。
 * **语义一个不少**：`role="note"` 与可访问名称原样保留 —— 丢了它读屏用户就听不到
 * 这是一条合规声明而不是普通段落。
 */
function JobFitCompliance({ children }: { children: ReactNode }) {
  return (
    <p className="job-fit-compliance" role="note" aria-label="合规提示">
      <InfoIcon aria-hidden="true" />
      <span>{children}</span>
    </p>
  )
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
  /** 岗位列表**读取失败**；与「关键词没搜到」必须分开呈现。 */
  const [jobsError, setJobsError] = useState(false)
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
  /** 会员就地授权弹窗（scope `job_ai`，复用岗位域同一套文案）。 */
  const [showMemberConsent, setShowMemberConsent] = useState(false)
  const [memberConsentBusy, setMemberConsentBusy] = useState(false)
  /** 授权后要立刻重跑的那次分析入参，避免用户再点一遍。 */
  const [pendingMemberInput, setPendingMemberInput] = useState<JobFitRequest | null>(null)
  const [anonymousConsentActive, setAnonymousConsentActive] = useState(false)
  const [revokingConsent, setRevokingConsent] = useState(false)
  const [rejectedTask, setRejectedTask] = useState(false)
  const anonymousConsentRevisionRef = useRef(0)

  useBusyLock(analyzing || printing || revokingConsent)

  useEffect(() => {
    let cancelled = false
    setJobsLoading(true)
    getJobs({ keyword: keyword || undefined, page: 1, pageSize: 8 })
      .then((res) => {
        if (cancelled) return
        setJobsError(false)
        setJobs(res.data)
      })
      .catch(() => {
        if (cancelled) return
        // 「没搜到岗位」和「岗位列表没取回来」对用户是两件事，
        // 原实现一律渲染成空列表，等于把故障说成没有结果（章程门槛①）。
        setJobsError(true)
        setJobs([])
      })
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
    setRejectedTask(false)
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
      .catch((err: unknown) => {
        if (cancelled) return
        // AI_TASK_NOT_FOUND = 解析行本身不认；JOB_FIT_NOT_FOUND = 解析还在、只是没做过匹配。
        if (err instanceof JobFitApiError && err.code === 'AI_TASK_NOT_FOUND') {
          setRejectedTask(true)
          return
        }
        setResult(null)
      })
      .finally(() => {
        if (!cancelled) setLoadingLatest(false)
      })
    return () => { cancelled = true }
  }, [taskId, accessToken, currentToken, isAnonymous])

  const gate: PreconditionGate | null = !taskId ? 'missing' : rejectedTask ? 'rejected' : null

  if (gate) {
    return (
      <ResumeDecisionFrame
        title="岗位匹配参考"
        subtitle={gate === 'missing' ? '先补上简历任务，再谈岗位匹配' : '这份简历任务现在读不出来'}
      ><main data-kiosk-domain="resume" data-kiosk-screen="resume-job-fit" className="service-desk job-fit-inkpaper job-fit-inkpaper--gate" data-visual-theme="service-desk" data-ux-density="touch">
        <div className="job-fit-state-card" role="alert">
          <AlertCircleIcon aria-hidden="true" />
          <p>
            {gate === 'missing'
              ? '请先完成简历上传与诊断，再做岗位匹配参考'
              : '这台机器上读不到你那份简历解析结果了。解析有保存期限，也只对本人开放 —— 重新上传并跑完诊断后再来。'}
          </p>
          <button type="button" className="qx-btn job-fit-primary-action" onClick={() => navigate('/resume/source?intent=diagnose')}>
            {gate === 'missing' ? '去上传简历' : '重新上传简历'}
          </button>
        </div>
      </main></ResumeDecisionFrame>
    )
  }

  // `gate` 是中间变量，TS 不会从 `!taskId ? 'missing'` 反推 taskId。
  // 上面已经挡过缺简历；这里只是把类型收成 string，后面分析/授权/撤回才能过 typecheck。
  if (!taskId) return null

  if (loadingLatest) {
    return (
      <ResumeDecisionFrame title="岗位匹配参考" subtitle="正在读取，还没有结果"><main data-kiosk-domain="resume" data-kiosk-screen="resume-job-fit" className="service-desk job-fit-inkpaper job-fit-inkpaper--loading" data-visual-theme="service-desk" data-ux-density="touch">
        <div className="job-fit-state-card" role="status" aria-live="polite">
          <Loader2Icon className="animate-spin" aria-hidden="true" />
          <p>正在恢复岗位匹配报告…</p>
        </div>
      </main></ResumeDecisionFrame>
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
      if (err instanceof JobFitApiError && err.code === 'AI_TASK_NOT_FOUND') {
        setRejectedTask(true)
        return
      }
      if (err instanceof JobFitApiError && err.status === 403) {
        if (err.code === 'JOB_FIT_ANONYMOUS_CONSENT_REQUIRED' && !token && accessToken) {
          setPendingConsentInput(input)
          setConsentError(null)
          setShowAnonymousConsent(true)
          return
        }
        if (err.code === 'USER_AI_CONSENT_REQUIRED' && token) {
          // 就地授权：记下本次入参，授权成功后直接重跑，用户不用离开本页也不用再点一次。
          setMemberConsentRequired(true)
          setPendingMemberInput(input)
          setShowMemberConsent(true)
          setConsentError(null)
          return
        }
      }
      setError(userMessageOf(err, '分析失败，请稍后重试'))
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
      if (err instanceof JobFitApiError && err.code === 'AI_TASK_NOT_FOUND') {
        setShowAnonymousConsent(false)
        setRejectedTask(true)
        return
      }
      const message = userMessageOf(err, '授权失败，请稍后重试')
      if (granted) setError(message)
      else setConsentError(message)
    } finally {
      setAnalyzing(false)
    }
  }

  /**
   * 会员就地授权 → 立刻重跑分析。
   *
   * 与匿名路径的关键差别：匿名调 `POST /resume/job-fit/consent`（绑 taskId），
   * 会员调 `POST /me/ai-consents`（scope `job_ai`，全局）。
   * 那三个匿名端点对 Bearer 返回 400 是有意设计，不能拿会员 token 去调。
   */
  const handleConfirmMemberConsent = async () => {
    const token = getToken()
    const input = pendingMemberInput
    if (!token || !input) return
    setMemberConsentBusy(true)
    setConsentError(null)
    let granted = false
    try {
      await grantJobAiConsent(token)
      granted = true
      setShowMemberConsent(false)
      setMemberConsentRequired(false)
      setPendingMemberInput(null)
      setAnalyzing(true)
      const res = await analyzeJobFit(input, { token, accessToken })
      if (res.status === 'failed') {
        setError(res.failReason ?? '分析未完成，请稍后重试')
      } else {
        setResult(res)
      }
    } catch (err) {
      if (err instanceof JobFitApiError && err.code === 'AI_TASK_NOT_FOUND') {
        setShowMemberConsent(false)
        setRejectedTask(true)
        return
      }
      const message = userMessageOf(err, '授权失败，请稍后重试')
      // 已授权后失败的是分析本身，属页面级错误；授权本身失败才留在弹窗里。
      if (granted) setError(message)
      else setConsentError(message)
    } finally {
      setMemberConsentBusy(false)
      setAnalyzing(false)
    }
  }

  const handleCancelMemberConsent = () => {
    setShowMemberConsent(false)
    setPendingMemberInput(null)
    setConsentError(null)
    // 卡片继续留在页面上，用户随时可以再点一次授权 —— 不静默吞掉这件事。
    setError('岗位匹配参考需要先同意岗位 AI 辅助；你可以在下方卡片重新授权。')
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
      if (err instanceof JobFitApiError && err.code === 'AI_TASK_NOT_FOUND') {
        setRejectedTask(true)
        return
      }
      setError(userMessageOf(err, '撤回失败，请稍后重试'))
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
      setError(userMessageOf(err, '打印版生成失败，请稍后重试'))
    } finally {
      setPrinting(false)
    }
  }

  // ── 结果视图 ──────────────────────────────────────────────────────────────
  if (result) {
    /**
     * 行动页入口只在**真有内容**时出现。
     * 计数是确定性逻辑（数组长度相加），不是 AI 判断 —— 因此不标 E3。
     */
    const gapActionCount =
      (result.gapPoints ?? []).length + (result.targetedSuggestions ?? []).length
    return (
      <ResumeDecisionFrame
        title="岗位匹配参考"
        subtitle={`目标岗位：${result.job?.title ?? ''}${result.job?.company ? ` · ${result.job.company}` : ''}`}
      ><main data-kiosk-domain="resume" data-kiosk-screen="resume-job-fit" className="service-desk job-fit-inkpaper job-fit-inkpaper--result" data-visual-theme="service-desk" data-ux-density="touch">
        <div className="job-fit-content">
          <JobFitCompliance>
            以下内容仅为帮助你修改简历与准备投递的参考，不代表任何招聘结果；本平台不提供投递功能，投递请前往岗位来源平台。
          </JobFitCompliance>

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
          {/*
            「怎么办」已拆到 `/resume/job-fit/actions`（S2-2，矩阵 §3.5）：
            本页专心做「差在哪」（等级 + 逐条证据 + 关键词命中），
            行动页专心做「怎么补」（差距项 + 定向改写 + 打印/改简历/备材料）。
            原先两块同屏，27 寸竖屏上要一边读比对一边找按钮，两件事互相打断。
          */}
          {gapActionCount > 0 && (
            <div className="job-fit-card job-fit-gap-entry">
              <p className="job-fit-card-copy">
                这次一共列出 {gapActionCount} 条可以着手补的地方。补什么、怎么补、本机能不能补，
                单独放在一屏里。
              </p>
              <button
                type="button"
                className="qx-btn job-fit-primary-action job-fit-block-action"
                onClick={() =>
                  navigate('/resume/job-fit/actions', { state: { taskId, accessToken } })
                }
              >
                我要补这些差距
              </button>
            </div>
          )}

          {result.job?.sourceName && (
            <div className="job-fit-card job-fit-source">
              <p className="job-fit-card-meta">
                岗位来源：{result.job.sourceName}{result.job.externalId ? ` · 外部ID ${result.job.externalId}` : ''}
              </p>
              <p className="job-fit-card-copy">准备好之后，请前往来源平台完成投递。</p>
            </div>
          )}

          {isAnonymous && anonymousConsentActive && (
            <AnonymousJobFitConsentCard busy={revokingConsent} onRevoke={() => void handleRevokeConsent()} />
          )}
          {notice && <p className="job-fit-notice" aria-live="polite">{notice}</p>}
          {error && <p className="job-fit-alert" role="alert">{error}</p>}
        </div>

        <div className="job-fit-action-bar">
          <div className="job-fit-action-grid">
            <button
              type="button"
              className="qx-btn"
              disabled={printing}
              onClick={() => void handlePrint()}
            >
              {printing ? <Loader2Icon className="animate-spin" aria-hidden="true" /> : <PrinterIcon aria-hidden="true" />}
              {printing ? '生成中' : '打印报告'}
            </button>
            <button
              type="button"
              className="qx-btn"
              data-variant="teal"
              onClick={() => navigate('/resume/optimize', { state: { taskId, accessToken } })}
            >
              <PencilLineIcon aria-hidden="true" />
              优化简历
            </button>
            {result.job?.id ? (
              <button
                type="button"
                className="qx-btn"
                onClick={() => {
                  if (result.job?.id) navigate(`/jobs/${result.job.id}`)
                }}
              >
                <BriefcaseIcon aria-hidden="true" />
                查看岗位
              </button>
            ) : (
              <button type="button" className="qx-btn" onClick={() => setResult(null)}>
                换个岗位分析
              </button>
            )}
          </div>
        </div>
      </main></ResumeDecisionFrame>
    )
  }

  // ── 选择视图 ──────────────────────────────────────────────────────────────
  return (
    <ResumeDecisionFrame
      title="岗位匹配参考"
      subtitle="选择目标岗位，基于本人简历生成定向参考与优化建议"
    >
    <main data-kiosk-domain="resume" data-kiosk-screen="resume-job-fit" className="service-desk job-fit-inkpaper job-fit-inkpaper--form" data-visual-theme="service-desk" data-ux-density="touch">
      {showAnonymousConsent && (
        <AnonymousJobFitConsentDialog
          busy={analyzing}
          error={consentError}
          onCancel={handleCancelAnonymousConsent}
          onConfirm={() => void handleConfirmAnonymousConsent()}
        />
      )}
      {/*
        会员就地授权（S2-2 / 问题 F2）。复用岗位域的同一个弹窗与同一段法律文案 ——
        同一个 scope `job_ai` 不能有两份说法。
      */}
      <JobAiConsentModal
        open={showMemberConsent}
        loading={memberConsentBusy}
        error={consentError}
        onCancel={handleCancelMemberConsent}
        onConfirm={() => void handleConfirmMemberConsent()}
      />
      <div className="job-fit-content">
        <JobFitCompliance>
          分析结果仅供本人参考，不代表录用结果；本平台不提供投递功能，投递请前往岗位来源平台。
        </JobFitCompliance>

        <div className="job-fit-tabs">
          <button
            type="button"
            onClick={() => setTab('pick')}
            aria-pressed={tab === 'pick'}
            className="qx-btn job-fit-tab"
          >
            <BriefcaseIcon aria-hidden="true" />
            从岗位信息选择
          </button>
          <button
            type="button"
            onClick={() => setTab('manual')}
            aria-pressed={tab === 'manual'}
            className="qx-btn job-fit-tab"
          >
            <TargetIcon aria-hidden="true" />
            手填目标岗位
          </button>
        </div>

        {tab === 'pick' ? (
          <div className="job-fit-card job-fit-picker">
            <div className="job-fit-search">
              <SearchIcon aria-hidden="true" />
              <input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder="搜索岗位名称 / 公司"
                aria-label="搜索岗位名称或公司"
              />
            </div>
            <div className="job-fit-joblist" aria-busy={jobsLoading} aria-live="polite">
              {jobsLoading ? (
                <p className="job-fit-list-hint" role="status">
                  <Loader2Icon className="animate-spin" aria-hidden="true" />正在加载岗位…
                </p>
              ) : jobsError ? (
                <p className="job-fit-alert" role="alert">
                  岗位列表这次没取回来（不是没有岗位）。可以稍后重试，或直接切到「手填目标岗位」——
                  手填不依赖岗位库，照常能做匹配参考。
                </p>
              ) : jobs.length === 0 ? (
                <p className="job-fit-list-hint">没有找到岗位，可切换「手填目标岗位」</p>
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
                      className="job-fit-joblist-row"
                    >
                      <span className="job-fit-joblist-tx">
                        <span className="job-fit-joblist-t">{j.title}</span>
                        <span className="job-fit-joblist-d">{j.company} · 来源：{j.sourceName}</span>
                      </span>
                      {active && <CheckCircle2Icon aria-hidden="true" />}
                    </button>
                  )
                })
              )}
            </div>
          </div>
        ) : (
          <div className="job-fit-card job-fit-manual">
            <input
              value={manualTitle}
              onChange={(e) => setManualTitle(e.target.value)}
              maxLength={50}
              placeholder="目标岗位名称，如：行政专员"
              aria-label="目标岗位名称"
            />
            <textarea
              value={manualReq}
              onChange={(e) => setManualReq(e.target.value)}
              maxLength={2000}
              rows={5}
              placeholder="可粘贴岗位 JD / 任职要求（选填，提供后参考更有针对性）"
              aria-label="岗位 JD 或任职要求"
            />
          </div>
        )}

        {error && <p className="job-fit-alert" role="alert">{error}</p>}
        {notice && <p className="job-fit-notice" aria-live="polite">{notice}</p>}
        {memberConsentRequired && (
          <MemberJobFitConsentCard
            busy={memberConsentBusy}
            onAuthorize={() => setShowMemberConsent(true)}
          />
        )}
        {isAnonymous && anonymousConsentActive && (
          <AnonymousJobFitConsentCard busy={revokingConsent} onRevoke={() => void handleRevokeConsent()} />
        )}
      </div>

      <div className="job-fit-action-bar">
        <button type="button" className="qx-btn job-fit-primary-action job-fit-block-action" disabled={analyzing} aria-busy={analyzing} onClick={() => void handleAnalyze()}>
          {analyzing ? (
            <>
              <Loader2Icon className="animate-spin" aria-hidden="true" />
              正在分析（约 10-20 秒）…
            </>
          ) : (
            <>
              开始匹配参考分析
              <ArrowRightIcon aria-hidden="true" />
            </>
          )}
        </button>
      </div>
    </main>
    </ResumeDecisionFrame>
  )
}
