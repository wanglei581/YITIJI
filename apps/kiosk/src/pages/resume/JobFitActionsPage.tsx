// ============================================================
// P11 岗位匹配 · 差距行动清单（S2-2 拆页）。
//
// 拆页依据（`ai-capability-wiring-matrix-2026-08-16.md` §3.5）：
//   职责 —— 只列「要补什么、怎么补、本机能不能补」，并直连打印 / 简历优化 / 材料工厂。
//   入口 —— 比对结果页的「我要补这些差距」。
//   返回 —— 回比对结果页。
//   判据 —— 比对页专心做「差在哪」，行动页专心做「怎么办」。
//
// 视觉真值（2026-09-23 迁入青序流光）：
//   docs/design/kiosk-redesign-2026-08/46-resume-decision-workspace.html?screen=actions
// 与 /resume/job-fit 同一宿主：舞台（JobFitStage）、呈现件（jobFitQxKit）与窄屏壳层样式
// （job-fit-qx.css 的 .jfq-root 段）共用，本页独有的分组清单样式在 resume-decision-qx.css。
//
// 合规（CLAUDE.md §2 / compliance-boundary §4）：
//   本页只做「改简历、备材料、打印」三件本机能做的事。
//   **不出现任何投递动作** —— 岗位只是第三方来源信息，投递一律回来源平台完成。
//   来源卡的 CTA 用白名单里的「查看岗位」，跳回岗位详情页，由那里承载来源平台入口；
//   本页不自建第二个外跳入口，也不复述投递类文案。
// ============================================================

import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { JobFitResponse } from '@ai-job-print/shared'
import {
  aiErrorMessageOf,
  deriveAiAvailability,
  isAiOutage,
  useAiTask,
} from '../../ai'
import { buildJobFitActionsView } from './jobFitActionsView'
import { getLatestJobFit, printJobFit } from '../../services/api/jobFit'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { QxAppNavbar } from '../../components/qingxu/QxAppNavbar'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { readAiResumeSession } from './aiResumeSession'
import { useRecruitmentHosting } from '../../hooks/useRecruitmentHosting'
import { JobFitStage } from './JobFitPage'
import { DecisionCta, DecisionHero } from './jobFit/DecisionWorkspaceChrome'
import { emphasizeTitle } from './jobFit/emphasizeTitle'
import { useRouteIdentityGuard } from './hooks/useRouteIdentityGuard'
import './job-fit-qx.css'
import './resume-decision-qx.css'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { useStartPrintHandoff } from '../print/usePrintHandoff'

const JOB_FIT_ROUTE = '/resume/job-fit'

type ActionsScreen =
  | 'session-ended'
  | 'missing-task'
  | 'loading'
  | 'unknown'
  | 'ai-down'
  | 'failed'
  | 'ready'
  | 'print-pending'
  | 'print-failed'

export function JobFitActionsPage() {
  const navigate = useNavigate()
  const startPrint = useStartPrintHandoff()
  const location = useLocation()
  const { user, getToken } = useAuth()
  const state = location.state as Record<string, unknown> | null

  const session = useMemo(() => readAiResumeSession(), [])
  const { ended: identityEnded, begin, settle, isLive } = useRouteIdentityGuard({ user, getToken })
  const queryTaskId = useMemo(
    () => new URLSearchParams(location.search).get('taskId') ?? undefined,
    [location.search],
  )
  const currentToken = getToken()
  const stateTaskId = typeof state?.taskId === 'string' ? state.taskId : undefined
  const taskId = stateTaskId ?? queryTaskId ?? session?.taskId
  const usingSessionTask = !stateTaskId && !queryTaskId && Boolean(session?.taskId)
  const accessToken =
    (typeof state?.accessToken === 'string' ? state.accessToken : undefined) ??
    (usingSessionTask ? session?.accessToken : undefined)
  /** 与 JobFitPage 同一判据：无会员 token 但持匿名一次性令牌 = 匿名会话。 */
  const isAnonymous = !currentToken && Boolean(accessToken)

  const [storedResult, setResult] = useState<JobFitResponse | null>(null)
  /** 渲染闸：会话一结束，同一次渲染里就不再读存着的结果（存值随后在 layout effect 里清掉）。 */
  const result = identityEnded ? null : storedResult
  const [loading, setLoading] = useState(Boolean(taskId))
  const [aiOutage, setAiOutage] = useState<string | null>(null)
  const [probed, setProbed] = useState(false)
  const [failReason, setFailReason] = useState<string | null>(null)
  const [printing, setPrinting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useBusyLock(printing)
  // 招聘内容托管（3.13）关闭时没有岗位信息可看：「看来源岗位要求」「查看岗位」换成本机照常能走的去处。
  const hostingOpen = useRecruitmentHosting().enabled

  // 会话结束的那一次提交：丢掉结果、放下忙态（忙锁不许按住隐私计时）。
  // 离开本页（打印等待屏的两个出口都会离开）则由身份闸的卸载代次作废晚到的打印返回。
  useLayoutEffect(() => {
    if (!identityEnded) return
    setResult(null)
    setError(null)
    setPrinting(false)
    setLoading(false)
  }, [identityEnded])

  useEffect(() => {
    if (identityEnded) return
    if (!taskId) {
      setLoading(false)
      return
    }
    const run = begin()
    if (!run) return
    let cancelled = false
    setLoading(true)
    getLatestJobFit(taskId, { token: getToken(), accessToken })
      .then((res) => {
        if (cancelled || !isLive(run)) return
        setProbed(true)
        if (res.status === 'completed') {
          setResult(res)
          if ((res.gapPoints ?? []).length === 0 && (res.targetedSuggestions ?? []).length === 0) {
            setFailReason('这次没有生成差距与准备建议。')
          }
        } else {
          setFailReason(res.failReason || '这次没有生成差距与准备建议。')
        }
      })
      .catch((err: unknown) => {
        if (cancelled || !isLive(run)) return
        if (isAiOutage(err)) {
          setAiOutage(aiErrorMessageOf(err, 'AI 服务当前不可用'))
          return
        }
        setProbed(true)
        setFailReason(aiErrorMessageOf(err, '对照结果读取失败'))
      })
      .finally(() => {
        if (!cancelled && isLive(run)) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [identityEnded, taskId, accessToken, getToken, begin, isLive])

  const availability = deriveAiAvailability({ outage: aiOutage, probed })

  const gapPoints = result?.gapPoints ?? []
  const rewrites = result?.targetedSuggestions ?? []
  const hasActions = gapPoints.length > 0 || rewrites.length > 0

  const task = useAiTask({
    availability,
    pending: loading,
    failed: Boolean(failReason),
    hasResult: hasActions,
  })

  const backToCompare = () =>
    navigate(JOB_FIT_ROUTE, { state: taskId ? { taskId, accessToken } : undefined })
  const goResumeHub = () => navigate('/resume-service')
  const goTriage = () => navigate('/resume/source?intent=diagnose')
  const goJobs = () => navigate('/jobs')
  const goPrintHub = () => navigate('/print-scan')
  const goMaterials = () => navigate('/resume/materials')
  const goResumeOptimize = () =>
    navigate('/resume/optimize', { state: taskId ? { taskId, accessToken } : undefined })

  /**
   * 打印差距清单走既有 `POST /resume/job-fit/:taskId/print`，
   * 与比对页同一个端点、同一份 PDF —— 不为本页另造一种产物。
   * `printFileUrl` 缺失时诚实报错，不静默跳转到一个打不出东西的确认页。
   */
  const handlePrint = async () => {
    if (!taskId || printing) return
    const run = begin('print')
    if (!run) return
    setPrinting(true)
    setError(null)
    try {
      const file = await printJobFit(taskId, { token: getToken(), accessToken })
      if (!isLive(run)) return
      if (!file.printFileUrl) throw new Error('打印链接未就绪，请稍后重试')
      startPrint({
        origin: 'job_fit',
        returnPath: window.location.pathname,
        file: {
          name: file.filename,
          size:
            file.sizeBytes >= 1024 * 1024
              ? `${(file.sizeBytes / 1024 / 1024).toFixed(1)} MB`
              : `${Math.max(1, Math.round(file.sizeBytes / 1024))} KB`,
          pages: file.pageCount,
          fileId: file.fileId,
          fileUrl: file.printFileUrl,
          mimeType: 'application/pdf',
        },
      })
    } catch (err) {
      if (!isLive(run)) return
      setError(userMessageOf(err, '打印版生成失败，请稍后重试'))
    } finally {
      setPrinting(false)
      settle(run)
    }
  }

  /**
   * 两类降级（原 AiTaskRegion 的 blocked / result-unavailable，文案原样保留）：
   *  ai-down  差距清单由 AI 生成，这次读不到 → 常显原因，列出仍然可用的非 AI 去处。
   *  failed   服务通了但这次没出清单（含「完成但两组都为空」）→ 说清这次没有，保留返回入口。
   *
   * 两类都保证「AI 挂了仍拿得到东西」：岗位原文照常可看，简历原文照常可打印，
   * 简历优化编辑区照常能改。这不是安慰话 —— 那三条都不经过本页这条 AI 链路。
   */
  const screen: ActionsScreen = identityEnded ? 'session-ended' : !taskId
    ? 'missing-task'
    : loading
      ? 'loading'
      : task.isFailed
        ? (aiOutage ? 'ai-down' : 'failed')
        : !task.isDone
          ? 'unknown'
          : printing
            ? 'print-pending'
            : error
              ? 'print-failed'
              : 'ready'

  const jobLabel = result?.job?.title
    ? `${result.job.title}${result.job.company ? ` · ${result.job.company}` : ''}`
    : '这次对照的目标岗位'

  const view = buildJobFitActionsView({
    screen, result, error, failReason, jobLabel, hostingOpen, isAnonymous, aiOutage,
    gapPoints, rewrites, navigate, backToCompare, goJobs, goMaterials, goPrintHub,
    goResumeHub, goResumeOptimize, goTriage, handlePrint, setError,
  })

  return (
    <JobFitStage>
      <QxPageFrame
        title={view.title}
        status={view.pill}
        back={taskId && !identityEnded
          ? { label: '返回对照结果', onBack: backToCompare }
          : { label: '返回简历服务', onBack: goResumeHub }}
        ctabar={<DecisionCta>{view.cta}</DecisionCta>}
        navbar={(
          <QxAppNavbar
            onHome={() => navigate('/')}
            onAdvisor={() => navigate('/assistant')}
            onProfile={() => navigate('/profile')}
          />
        )}
      >
        <DecisionHero eyebrow="行动清单" title={emphasizeTitle(view.title)} copy={view.subtitle} />
        <main
          className="qx-scroll"
          data-kiosk-domain="resume"
          data-kiosk-screen="resume-job-fit-actions"
          data-state={screen}
          data-testid={`resume-job-fit-actions-state-${screen}`}
          {...task.containerProps}
        >
          {view.body}
        </main>
      </QxPageFrame>
    </JobFitStage>
  )
}
