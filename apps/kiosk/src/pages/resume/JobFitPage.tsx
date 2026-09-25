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

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { ExternalJobDTO, JobFitRequest, JobFitResponse } from '@ai-job-print/shared'
import { makePrintParams } from '@ai-job-print/shared'
import { BriefcaseIcon, CheckCircle2Icon, HelpCircleIcon, ListIcon, PrinterIcon, SearchIcon } from 'lucide-react'
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
import { isAiOutage } from '../../ai/aiOutage'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { KioskStageFit } from '../../components/kiosk-shell/KioskStageFit'
import { useKioskStageFit } from '../../hooks/useKioskStageFit'
import { QxAppNavbar } from '../../components/qingxu/QxAppNavbar'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { readAiResumeSession } from './aiResumeSession'
import { DecisionSummaryBar } from './jobFit/DecisionSummaryBar'
import { FitSkillMap } from './jobFit/FitSkillMap'
import { AnonymousJobFitConsentCard } from './jobFit/AnonymousJobFitConsentCard'
import { AnonymousJobFitConsentDialog } from './jobFit/AnonymousJobFitConsentDialog'
import { MemberJobFitConsentCard } from './jobFit/MemberJobFitConsentCard'
import { buildJobFitStateView, type JobFitExits, type JobFitStaticState } from './jobFit/JobFitQxStates'
import { CtaNote, Guardline, KitRows, ManualTargetFields, NextSteps, PreflightChecklist, Sec } from './jobFit/jobFitQxKit'
import { JOB_FIT_NEXT_STEPS, type JobFitStepTarget } from './jobFit/jobFitResultSpec'
import { useRecruitmentHosting } from '../../hooks/useRecruitmentHosting'
import { JobAiConsentModal } from '../jobs/components/JobAiConsentModal'
import { grantJobAiConsent } from '../../services/api/jobAi'
import './job-fit-qx.css'
import { userMessageOf } from '../../services/api/userErrorMessage'

/**
 * 舞台缩放开关：与 `KioskRoot.tsx`（isCompactViewport / usesFluidViewport）用**同一套判据**。
 *
 * /resume/job-fit 是 KioskRoot 之外的整屏路由（fusion-w6 的 expectedFullScreen 钉着
 * depth=2），拿不到 KioskRoot 算好的结果，只能同口径再算一次。
 *
 * 为什么必须算：`KioskStageFit` 默认 enabled，会把整张 1080×1920 稿等比缩到可视区。
 * 一体机上 scale≈1 没问题，但 390×844 手机上 scale≈0.36 —— 返回键量出来只有 23px、
 * 主操作 35px，正文小到读不了，触控下限（48px）全线失守。手机与横屏电脑因此关掉缩放，
 * 改走真实流式布局（窄屏样式在 job-fit-qx.css 的 .jfq-root 段，随本页作用域）。
 *
 * 一体机竖屏（1080×1920）两个条件都不命中 → 仍然是原来的定高舞台，稿 46 不受影响。
 */
function useJobFitStage(): { enabled: boolean; layout: 'kiosk' | 'phone' | 'desktop' } {
  const { viewportW, viewportH } = useKioskStageFit()
  const isCompact = viewportW <= 760 || (viewportW <= 960 && viewportW > viewportH)
  const isFluid = isCompact || (viewportW > 960 && viewportW > viewportH)
  if (!isFluid) return { enabled: true, layout: 'kiosk' }
  return { enabled: false, layout: isCompact ? 'phone' : 'desktop' }
}

/**
 * 本页三个视图（静态屏 / 结果 / 选岗）共用的舞台外壳。
 * 保留 KioskStageFit 的 host/scaler/stage DOM，只切 enabled —— 与 KioskRoot 同样的做法，
 * 避免旋转屏幕时整个布局根被替换。
 *
 * 导出给宿主 46 的另外两条整屏 route（/resume/job-fit/actions、/resume/career-plan）：
 * 它们同样在 KioskRoot 之外，缩放判据必须是同一份，不能各抄一遍。
 */
export function JobFitStage({ children }: { children: ReactNode }) {
  const { enabled, layout } = useJobFitStage()
  return (
    <KioskStageFit enabled={enabled}>
      <div className="jfq-root" data-jfq-layout={layout}>{children}</div>
    </KioskStageFit>
  )
}

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
  // 招聘内容托管（3.13）关闭时没有系统内岗位可选：只留手填这一条路，也不请求岗位列表。
  const hosting = useRecruitmentHosting()
  const mode = hosting.enabled ? tab : 'manual'
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
  const anonymousConsentRevisionRef = useRef(0)
  /**
   * 「取消分析，返回目标选择」（稿 analyzing 屏的主操作）。
   * 请求本身没有取消端点，所以这里不谎称已取消服务端动作 —— 递增本 ref 只表示
   * **这一屏不再采信那次返回**，晚到的结果不会把用户从选岗屏踢回结果屏。
   */
  const analysisRunRef = useRef(0)

  useBusyLock(analyzing || printing || revokingConsent)

  useEffect(() => {
    if (!hosting.enabled) return
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
  }, [keyword, hosting.enabled])

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
      setAnalyzing(false)
      setAnalysisFail(null)
      setResult(null)
    },
    retryAnalyze: () => { setAnalysisFail(null); void handleAnalyze() },
  }

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
    const view = buildJobFitStateView(screenState, exits, failMessage)
    return (
      <JobFitStage>
        <QxPageFrame
          title={view.title}
          subtitle={view.subtitle}
          status={view.pill}
          back={{ label: '返回简历服务', onBack: exits.resumeHub }}
          ctabar={view.cta}
          navbar={navbar}
        >
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
  if (loadingLatest || hosting.status === 'loading') return staticScreen('loading')

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

  // 等待屏与失败屏都是整屏形态（稿 analyzing / ai-down / failed）。
  // 授权弹窗开着时不切走：弹窗正压在选岗屏上，切屏会把它连同上下文一起抽掉。
  if (analyzing && !showAnonymousConsent && !showMemberConsent) return staticScreen('analyzing')
  if (analysisFail) return staticScreen(analysisFail.kind, analysisFail.message)

  // ── 结果视图 ──────────────────────────────────────────────────────────────
  if (result) {
    /**
     * 行动页入口只在**真有内容**时出现。
     * 计数是确定性逻辑（数组长度相加），不是 AI 判断 —— 因此不标 E3。
     */
    const gapActionCount =
      (result.gapPoints ?? []).length + (result.targetedSuggestions ?? []).length
    // 系统内岗位的来源与「查看岗位」只在招聘内容托管打开时出现；关着时岗位页本来就进不去。
    const showSource = hosting.enabled && Boolean(result.job?.sourceName)
    const goStep = (target: JobFitStepTarget) => {
      if (target === 'actions') { navigate('/resume/job-fit/actions', { state: { taskId, accessToken } }); return }
      if (target === 'optimize') { exits.optimize(); return }
      navigate('/resume/materials')
    }
    return (
      <JobFitStage>
        <QxPageFrame
          title="简历对照"
          subtitle="按你给的岗位要求，逐条列出简历里已经写到的和还没体现的；不分档、不打分，也不判断能否录用。"
          status={{ tone: 'ok', label: '对照结果已返回' }}
          back={{ label: '返回简历服务', onBack: exits.resumeHub }}
          navbar={navbar}
          ctabar={
            <>
              <CtaNote>对照只说明简历里写到了什么，不代表企业的真实评价。</CtaNote>
              <button type="button" className="qx-btn" data-variant="ghost" disabled={printing} onClick={() => void handlePrint()}>
                <PrinterIcon size={22} aria-hidden="true" />
                {printing ? '生成中' : '打印报告'}
              </button>
              {hosting.enabled && result.job?.id ? (
                <button type="button" className="qx-btn" data-variant="teal" onClick={() => { if (result.job?.id) navigate(`/jobs/${result.job.id}`) }}>
                  <BriefcaseIcon size={22} aria-hidden="true" />
                  查看岗位
                </button>
              ) : (
                <button type="button" className="qx-btn" data-variant="teal" onClick={exits.backToPick}>
                  换个岗位分析
                </button>
              )}
              <button type="button" className="qx-btn" data-variant="primary" onClick={exits.optimize}>
                优化简历
              </button>
            </>
          }
        >
          <main
            className="qx-scroll"
            data-kiosk-domain="resume"
            data-kiosk-screen="resume-job-fit"
            data-state="result"
            data-testid="resume-job-fit-state-result"
          >
            <Sec title="对照概要" hint="仅供本人准备使用">
              <DecisionSummaryBar
                jobTitle={result.job?.title ?? '目标岗位'}
                company={result.job?.company}
                summary={result.summary}
              />
              <Guardline
                head="只对照，不打分"
                body="不分档、不给分数或通过率，也不等于录用结论；结果只供本人准备，不提供给企业。"
              />
            </Sec>

            <FitSkillMap
              matchPoints={result.matchPoints ?? []}
              gapPoints={result.gapPoints ?? []}
              keywordCoverage={result.decisionSupport?.keywordCoverage}
            />

            {/*
              「怎么办」已拆到 `/resume/job-fit/actions`（S2-2，矩阵 §3.5）：
              本页专心做「差在哪」（已写到 / 还没体现两栏 + 关键词命中），
              行动页专心做「怎么补」（差距项 + 定向改写 + 打印/改简历/备材料）。
              原先两块同屏，27 寸竖屏上要一边读比对一边找按钮，两件事互相打断。
            */}
            {gapActionCount > 0 && (
              <Sec title="下一步建议" hint="都是本机既有流程">
                <p className="jfq-sec-copy">
                  这次一共列出 {gapActionCount} 条可以着手补的地方。补什么、怎么补、本机能不能补，单独放在一屏里。
                </p>
                <NextSteps items={JOB_FIT_NEXT_STEPS.map((step) => ({
                  title: step.title,
                  desc: step.desc,
                  onClick: () => goStep(step.target),
                }))} />
              </Sec>
            )}

            {showSource && (
              <Sec title="岗位来源" hint="以来源平台公示为准">
                <div className="qx-card jfq-consent-card">
                  <p>
                    岗位来源：{result.job?.sourceName}{result.job?.externalId ? ` · 外部ID ${result.job.externalId}` : ''}
                  </p>
                  <p>准备好之后，请前往来源平台完成投递。</p>
                  {error && <p className="jfq-alert" role="alert">{error}</p>}
                </div>
              </Sec>
            )}

            {isAnonymous && anonymousConsentActive && (
              <AnonymousJobFitConsentCard busy={revokingConsent} onRevoke={() => void handleRevokeConsent()} />
            )}
            {notice && <p className="jfq-notice" aria-live="polite">{notice}</p>}
            {error && !showSource && <p className="jfq-alert" role="alert">{error}</p>}
          </main>
        </QxPageFrame>
      </JobFitStage>
    )
  }

  // ── 选择视图 ──────────────────────────────────────────────────────────────
  // 托管关闭时手填是唯一的路：之前在岗位列表里点过的岗位不再算进「目标岗位」。
  const pickedJob = hosting.enabled ? selectedJob : null
  return (
    <JobFitStage>
      <QxPageFrame
        title="先把目标说清，再决定下一步"
        subtitle="对照结果只给本人看，不分档、不打分；岗位要求、授权与结果全部以服务端返回为准。"
        status={{ tone: 'unknown', label: '匹配前需要真实任务与本人授权' }}
        back={{ label: '返回简历服务', onBack: exits.resumeHub }}
        navbar={navbar}
        ctabar={
          <>
            <CtaNote>匹配结果不代表录用判断，也不会提供给企业；本平台不提供投递功能。</CtaNote>
            <button type="button" className="qx-btn" data-variant="ghost" onClick={exits.resumeHub}>
              返回简历服务
            </button>
            <button type="button" className="qx-btn" data-variant="primary" disabled={analyzing} aria-busy={analyzing} onClick={() => void handleAnalyze()}>
              继续并确认授权
            </button>
          </>
        }
      >
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
        <main
          className="qx-scroll"
          data-kiosk-domain="resume"
          data-kiosk-screen="resume-job-fit"
          data-state="pick"
          data-testid="resume-job-fit-state-pick"
        >
          <Sec no="01" title={hosting.enabled ? '选择目标岗位' : '填一份岗位要求'} hint={hosting.enabled ? '系统岗位或手填目标，二选一' : 'AI 对照你的简历，只供本人分析'}>
            {hosting.enabled ? (<div className="jfq-choices">
              <button
                type="button"
                className="jfq-choice"
                onClick={() => setTab('pick')}
                aria-pressed={tab === 'pick'}
              >
                <h3>从已发布岗位中选择</h3>
                <p>只有服务端返回已发布岗位后，才会显示标题、来源与详情。</p>
                <span>按来源数据选择</span>
              </button>
              <button
                type="button"
                className="jfq-choice"
                onClick={() => setTab('manual')}
                aria-pressed={tab === 'manual'}
              >
                <h3>手填目标岗位</h3>
                <p>只填写目标名称与要求，不会把内容提供给企业，也不替你操作。</p>
                <span>只供本人分析</span>
              </button>
            </div>) : null}

            {mode === 'pick' ? (
              <div className="jfq-field">
                <small>目标岗位</small>
                <div style={{ position: 'relative' }}>
                  <SearchIcon size={22} aria-hidden="true" style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: 'var(--qx-ink-3)' }} />
                  <input
                    value={keyword}
                    onChange={(e) => setKeyword(e.target.value)}
                    placeholder="搜索岗位名称 / 公司"
                    aria-label="搜索岗位名称或公司"
                    className="jfq-input"
                    style={{ paddingLeft: 52 }}
                  />
                </div>
                <div className="jfq-joblist" aria-busy={jobsLoading} aria-live="polite">
                  {jobsLoading ? (
                    <p className="jfq-sec-copy" role="status">正在加载岗位…</p>
                  ) : jobsError ? (
                    <p className="jfq-alert" role="alert">
                      岗位列表这次没取回来（不是没有岗位）。可以稍后重试，或直接切到「手填目标岗位」——
                      手填不依赖岗位库，照常能做简历对照。
                    </p>
                  ) : jobs.length === 0 ? (
                    <p className="jfq-sec-copy">没有找到岗位，可切换「手填目标岗位」</p>
                  ) : (
                    jobs.map((j) => {
                      const active = selectedJob?.id === j.id
                      return (
                        <button
                          key={j.id}
                          type="button"
                          className="jfq-job"
                          onClick={() => setSelectedJob(j)}
                          aria-pressed={active}
                          aria-label={`${j.title}，${j.company}，${active ? '已选择' : '未选择'}`}
                        >
                          <span className="jfq-job-tx">
                            <b>{j.title}</b>
                            <small>{j.company} · 来源：{j.sourceName}</small>
                          </span>
                          {active && <CheckCircle2Icon size={24} aria-hidden="true" />}
                        </button>
                      )
                    })
                  )}
                </div>
              </div>
            ) : (
              <ManualTargetFields
                title={manualTitle}
                requirement={manualReq}
                onTitleChange={setManualTitle}
                onRequirementChange={setManualReq}
              />
            )}
          </Sec>

          <Sec no="02" title="分析前检查" hint="三项齐备才启动" grow>
            <PreflightChecklist
              targetLabel={pickedJob ? pickedJob.title : manualTitle.trim() || '尚未选择'}
              hasTarget={Boolean(pickedJob || manualTitle.trim())}
              consentConfirmed={isAnonymous && anonymousConsentActive}
              manualOnly={!hosting.enabled}
            />
            {error && <p className="jfq-alert" role="alert">{error}</p>}
            {notice && <p className="jfq-notice" aria-live="polite">{notice}</p>}
            {memberConsentRequired && (
              <MemberJobFitConsentCard
                busy={memberConsentBusy}
                onAuthorize={() => setShowMemberConsent(true)}
              />
            )}
            {isAnonymous && anonymousConsentActive && (
              <AnonymousJobFitConsentCard busy={revokingConsent} onRevoke={() => void handleRevokeConsent()} />
            )}
          </Sec>

          <Sec no="03" title="不做 AI 分析，也能先推进" hint="都是既有流程">
            <KitRows items={[
              { icon: <PrinterIcon size={22} />, title: '打印现有简历', desc: '已有电子稿或纸质件，直接走打印流程', onClick: exits.printHub },
              ...(exits.jobs ? [{ icon: <ListIcon size={22} />, title: '看来源岗位要求', desc: '直接浏览来源平台的岗位信息，自己比对', onClick: exits.jobs }] : []),
              { icon: <HelpCircleIcon size={22} />, title: '问 AI 顾问怎么定目标', desc: '还没想清楚方向时，先把想法说出来', onClick: exits.assistant },
            ]} />
          </Sec>
        </main>
      </QxPageFrame>
    </JobFitStage>
  )
}
