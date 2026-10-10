// ============================================================
// 2D 目标岗位定向优化 + 简历对照（原「岗位匹配参考」）。
//
// 入口：诊断报告页（携带 taskId/accessToken）。流程：手填岗位要求，或（招聘内容托管
// 打开时）选择系统内已发布岗位 → 真实分析 → 已写到的要求（含原文依据）+ 差距建议 +
// 定向优化建议。托管关闭（我们云上默认，next-tasks 3.13/3.14）时只有手填这一条路。
// 合规：2026-09-26 起不再分档（服务端不返回 fitLevel），无百分比/录用承诺；不做平台内投递。
//
// 视觉真值（2026-09-22 迁入青序流光）：
//   docs/design/kiosk-redesign-2026-08/46-resume-decision-workspace.html?screen=job-fit
// 本页是宿主 46 承接的第一条 route；其余三条（actions / career-plan / templates）
// 仍在旧壳，因此**不要**把共用样式塞回 styles/resume-fusion-job-fit.css ——
// 那份还被 /resume/job-fit/actions 用着，两套色系不能在同一页相遇。
// ============================================================

import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { ExternalJobDTO, JobFitRequest, JobFitResponse } from '@ai-job-print/shared'
import {
  analyzeJobFit,
  getJobFitConsentStatus,
  getLatestJobFit,
  grantJobFitConsent,
  JobFitApiError,
  printJobFit,
  revokeJobFitConsent,
} from '../../services/api/jobFit'
import { isAiOutage } from '../../ai/aiOutage'
import { aiDeclarationDeclineMessage } from '../../ai/aiDeclarationErrors'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { QxAppNavbar } from '../../components/qingxu/QxAppNavbar'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { readAiResumeSession } from './aiResumeSession'
import { buildJobFitStateView, type JobFitExits, type JobFitStaticState } from './jobFit/JobFitQxStates'
import { DecisionCta, DecisionHero } from './jobFit/DecisionWorkspaceChrome'
import { emphasizeTitle } from './jobFit/emphasizeTitle'
import { ManualTargetFields } from './jobFit/jobFitQxKit'
import { renderJobFitInteractive } from './jobFit/JobFitInteractiveViews'
import { JobFitStage } from './jobFit/JobFitStage'
import { usePublishedJobs } from './jobFit/usePublishedJobs'
import { useRecruitmentHosting } from '../../hooks/useRecruitmentHosting'
import { grantJobAiConsent } from '../../services/api/jobAi'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { useStartPrintHandoff } from '../print/usePrintHandoff'
import './job-fit-qx.css'

export { JobFitStage }

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

/** 分析这一跳失败后落到哪一屏：能力级故障 → ai-down；其余 → failed。 */
interface AnalysisFailure { kind: 'ai-down' | 'failed'; message: string }

export function JobFitPage() {
  const navigate = useNavigate()
  const startPrint = useStartPrintHandoff()
  const location = useLocation()
  const { getToken } = useAuth()
  const state = (location.state ?? {}) as PageState
  const session = useMemo(() => readAiResumeSession(), [])
  const queryTaskId = useMemo(() => new URLSearchParams(location.search).get('taskId') ?? undefined, [location.search])
  const stateTaskId = typeof state.taskId === 'string' ? state.taskId : undefined
  const taskId = queryTaskId ?? stateTaskId ?? session?.taskId
  const resumeName = new URLSearchParams(location.search).get('resumeName') || `上传诊断简历 · ${taskId?.slice(-8) ?? ''}`
  const usingSessionTask = !stateTaskId && !queryTaskId && Boolean(session?.taskId)
  const accessToken = state.accessToken ?? (usingSessionTask ? session?.accessToken : undefined)
  const currentToken = getToken()
  const isAnonymous = !currentToken && Boolean(accessToken)

  const [tab, setTab] = useState<'pick' | 'manual'>('pick')
  // 招聘内容托管（3.13）关闭时没有系统内岗位可选：只留手填这一条路，也不请求岗位列表。
  const hosting = useRecruitmentHosting()
  const mode = hosting.enabled ? tab : 'manual'
  const [keyword, setKeyword] = useState('')
  const { jobs, jobsLoading, jobsError } = usePublishedJobs(hosting.enabled, keyword)
  const [selectedJob, setSelectedJob] = useState<ExternalJobDTO | null>(null)
  const [manualTitle, setManualTitle] = useState('')
  const [manualReq, setManualReq] = useState('')
  const [analyzing, setAnalyzing] = useState(false)
  const [printing, setPrinting] = useState(false)
  const [loadingLatest, setLoadingLatest] = useState(Boolean(taskId))
  const [readDismissed, setReadDismissed] = useState(false)
  const [result, setResult] = useState<JobFitResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** 分析本身失败，落成整屏 ai-down / failed；打印、撤回等失败仍留在当前屏。 */
  const [analysisFail, setAnalysisFail] = useState<AnalysisFailure | null>(null)
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
  const [ownWriteOpen, setOwnWriteOpen] = useState(false)
  const [ownTitle, setOwnTitle] = useState('')
  const [ownReq, setOwnReq] = useState('')
  const anonymousConsentRevisionRef = useRef(0)
  /**
   * 「取消分析，返回目标选择」（稿 analyzing 屏的主操作）。
   * 请求本身没有取消端点，所以这里不谎称已取消服务端动作 —— 递增本 ref 只表示
   * **这一屏不再采信那次返回**，晚到的结果不会把用户从选岗屏踢回结果屏。
   */
  const analysisRunRef = useRef(0)
  const dismissLatestReadRef = useRef(false)

  useBusyLock(analyzing || printing || revokingConsent)

  useEffect(() => {
    setResult(null)
    setSelectedJob(null)
    setError(null)
    setAnalysisFail(null)
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
    dismissLatestReadRef.current = false
    setReadDismissed(false)
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
        if (!cancelled && !dismissLatestReadRef.current) setResult(res.status === 'completed' ? res : null)
      })
      .catch((err: unknown) => {
        if (cancelled || dismissLatestReadRef.current) return
        // AI_TASK_NOT_FOUND = 解析行本身不认；JOB_FIT_NOT_FOUND = 解析还在、只是没做过匹配。
        if (err instanceof JobFitApiError && err.code === 'AI_TASK_NOT_FOUND') {
          setRejectedTask(true)
          return
        }
        setResult(null)
        setNotice(err instanceof JobFitApiError && err.code === 'JOB_FIT_NOT_FOUND' ? '这份简历还没有可查看的对照结果，原结果可能已过期或删除；可填写要求重新对照。' : '对照结果这次没有读到，请检查网络后重试。')
      })
      .finally(() => {
        if (!cancelled && !dismissLatestReadRef.current) setLoadingLatest(false)
      })
    return () => { cancelled = true }
  }, [taskId, accessToken, currentToken, isAnonymous])

  const gate: PreconditionGate | null = !taskId ? 'missing' : rejectedTask ? 'rejected' : null

  const exits: JobFitExits = {
    resumeHub: () => navigate('/resume-service'),
    triage: () => navigate('/resume/source?intent=diagnose'),
    printHub: () => navigate('/print-scan'),
    scan: () => navigate('/scan/start'),
    jobs: hosting.enabled ? () => navigate('/jobs') : undefined,
    optimize: () => navigate('/resume/optimize', { state: { taskId, accessToken } }),
    assistant: () => navigate('/assistant'),
    backToPick: () => {
      analysisRunRef.current += 1
      dismissLatestReadRef.current = true
      setReadDismissed(true)
      setLoadingLatest(false)
      setAnalyzing(false)
      setAnalysisFail(null)
      setResult(null)
    },
    retryAnalyze: () => { setAnalysisFail(null); void handleAnalyze() },
    writeRequirements: () => setOwnWriteOpen(true),
  }

  const writePanel = ownWriteOpen ? (
    <div id="job-fit-own-requirements">
      <p className="jfq-sec-copy">先把你看到的要求记在这里。没有可读取的简历任务时，这里不开始分析，也不写成已完成。</p>
      <ManualTargetFields
        title={ownTitle}
        requirement={ownReq}
        onTitleChange={setOwnTitle}
        onRequirementChange={setOwnReq}
      />
    </div>
  ) : null

  const navbar = (
    <QxAppNavbar
      onHome={() => navigate('/')}
      onAdvisor={() => navigate('/assistant')}
      onProfile={() => navigate('/profile')}
    />
  )

  /**
   * 六个静态屏共用一层壳。写成函数而不是嵌套组件：嵌套组件每次渲染都是新的
   * 组件类型，React 会整棵卸载重建，输入焦点与滚动位置都会丢。
   */
  function staticScreen(screenState: JobFitStaticState, failMessage?: string | null) {
    const view = buildJobFitStateView(screenState, exits, failMessage, writePanel)
    return (
      <JobFitStage>
        <QxPageFrame
          title={view.title}
          status={view.pill}
          back={{ label: '返回简历服务', onBack: exits.resumeHub }}
          ctabar={<DecisionCta>{view.cta}</DecisionCta>}
          navbar={navbar}
        >
          <DecisionHero eyebrow="简历对照" title={emphasizeTitle(view.title)} copy={view.subtitle} echoesPageHead />
          <main
            className="qx-scroll"
            data-kiosk-domain="resume"
            data-kiosk-screen="resume-job-fit"
            data-state={screenState}
            data-testid={`resume-job-fit-state-${screenState}`}
          >
            {view.body}
          </main>
        </QxPageFrame>
      </JobFitStage>
    )
  }

  if (gate) return staticScreen(gate === 'missing' ? 'missing-task' : 'rejected-task')

  // `gate` 是中间变量，TS 不会从 `!taskId ? 'missing'` 反推 taskId。
  // 上面已经挡过缺简历；这里只是把类型收成 string，后面分析/授权/撤回才能过 typecheck。
  if (!taskId) return null

  // 托管状态没读到之前同样停在读取屏：否则打开托管的终端会先闪一下「只能手填」再变回来。
  if ((loadingLatest || hosting.status === 'loading') && !readDismissed) return staticScreen('loading')

  async function handleAnalyze() {
    if (!taskId) return
    setError(null)
    setAnalysisFail(null)
    setNotice(null)
    setMemberConsentRequired(false)
    const input: JobFitRequest | null =
      mode === 'pick' && selectedJob
        ? { taskId, jobId: selectedJob.id }
        : mode === 'manual' && manualTitle.trim()
          ? { taskId, manualJob: { title: manualTitle.trim(), ...(manualReq.trim() ? { requirements: manualReq.trim() } : {}) } }
          : null
    if (!input) {
      setError(mode === 'pick' ? '请先选择一个岗位' : '请填写目标岗位名称')
      return
    }
    const token = getToken()
    const run = ++analysisRunRef.current
    setAnalyzing(true)
    try {
      const res = await analyzeJobFit(input, { token, accessToken })
      if (analysisRunRef.current !== run) return
      if (res.status === 'failed') {
        setAnalysisFail({ kind: 'failed', message: res.failReason ?? '请求中断，没有可确认的结果。系统不展示对照要点或建议，也不保留半截结论。' })
      } else {
        setResult(res)
      }
    } catch (err) {
      if (analysisRunRef.current !== run) return
      if (err instanceof JobFitApiError && err.code === 'AI_TASK_NOT_FOUND') {
        setRejectedTask(true)
        return
      }
      const declined = aiDeclarationDeclineMessage(err)
      if (declined) {
        setError(declined)
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
      setAnalysisFail({ kind: isAiOutage(err) ? 'ai-down' : 'failed', message: userMessageOf(err, '分析失败，请稍后重试') })
    } finally {
      setAnalyzing(false)
    }
  }

  const handleConfirmAnonymousConsent = async () => {
    const input = pendingConsentInput
    if (!input || !accessToken) return
    const run = ++analysisRunRef.current
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
      if (analysisRunRef.current !== run) return
      if (res.status === 'failed') {
        setAnalysisFail({ kind: 'failed', message: res.failReason ?? '请求中断，没有可确认的结果。' })
      } else {
        setResult(res)
      }
    } catch (err) {
      const declined = aiDeclarationDeclineMessage(err)
      if (declined) {
        setShowAnonymousConsent(false)
        setError(declined)
        return
      }
      if (err instanceof JobFitApiError && err.code === 'AI_TASK_NOT_FOUND') {
        setShowAnonymousConsent(false)
        setRejectedTask(true)
        return
      }
      const message = userMessageOf(err, '授权失败，请稍后重试')
      if (granted) setAnalysisFail({ kind: isAiOutage(err) ? 'ai-down' : 'failed', message })
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
    const run = ++analysisRunRef.current
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
      if (analysisRunRef.current !== run) return
      if (res.status === 'failed') {
        setAnalysisFail({ kind: 'failed', message: res.failReason ?? '请求中断，没有可确认的结果。' })
      } else {
        setResult(res)
      }
    } catch (err) {
      const declined = aiDeclarationDeclineMessage(err)
      if (declined) {
        setShowMemberConsent(false)
        setError(declined)
        return
      }
      if (err instanceof JobFitApiError && err.code === 'AI_TASK_NOT_FOUND') {
        setShowMemberConsent(false)
        setRejectedTask(true)
        return
      }
      const message = userMessageOf(err, '授权失败，请稍后重试')
      // 已授权后失败的是分析本身，属页面级错误；授权本身失败才留在弹窗里。
      if (granted) setAnalysisFail({ kind: isAiOutage(err) ? 'ai-down' : 'failed', message })
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
    setError('简历对照需要先同意岗位 AI 辅助；你可以在下方卡片重新授权。')
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
      startPrint({
        origin: 'job_fit',
        returnPath: window.location.pathname,
        file: {
          name: file.filename,
          size: file.sizeBytes >= 1024 * 1024 ? `${(file.sizeBytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(file.sizeBytes / 1024))} KB`,
          pages: file.pageCount,
          fileId: file.fileId,
          fileUrl: file.printFileUrl,
          mimeType: 'application/pdf',
        },
      })
    } catch (err) {
      setError(userMessageOf(err, '打印版生成失败，请稍后重试'))
    } finally {
      setPrinting(false)
    }
  }

  // 等待屏与失败屏都是整屏形态（稿 analyzing / ai-down / failed）。
  // 授权弹窗开着时不切走：弹窗正压在选岗屏上，切屏会把它连同上下文一起抽掉。
  if (analyzing && !showAnonymousConsent && !showMemberConsent) return staticScreen('analyzing')
  if (analysisFail) return staticScreen(analysisFail.kind, analysisFail.message)

  return renderJobFitInteractive({
    result, hosting, navigate, taskId, accessToken, exits, printing, handlePrint, handleAnalyze, navbar,
    resumeName, isAnonymous, anonymousConsentActive, revokingConsent, handleRevokeConsent,
    notice, error, showAnonymousConsent, analyzing, consentError,
    handleCancelAnonymousConsent, handleConfirmAnonymousConsent,
    showMemberConsent, memberConsentBusy, handleCancelMemberConsent, handleConfirmMemberConsent,
    setTab, tab, mode, keyword, setKeyword, jobsLoading, jobsError, jobs,
    selectedJob, setSelectedJob, manualTitle, manualReq, setManualTitle, setManualReq,
    memberConsentRequired, setShowMemberConsent,
  })

}
