// 职业规划（P22）AI 接线 —— 接线矩阵 §3.7 / S2-6。
//
// 本页做三件事，都不改后端：
//  1. 复用 S1 前端 AI 原语（apps/kiosk/src/ai）：data-aitask 四态 + 证据分级 + 三类降级；
//  2. 把 resumeTaskId 前置从「有没有字符串」升级成「后端认不认这份解析结果」；
//  3. ai-down 支线诚实降级（22-career-plan.html 的口径，照抄，不重新发明）。
//
// 视觉真值（2026-09-23 迁入青序流光）：
//   docs/design/kiosk-redesign-2026-08/46-resume-decision-workspace.html?screen=career-plan
// 与 /resume/job-fit 同一宿主：舞台（JobFitStage）、呈现件（jobFitQxKit）与窄屏壳层样式共用；
// 四栏与条目样式在 resume-decision-qx.css。真实规划读回、生成与打印逻辑仍在本页。
import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { CareerPlanResponse } from '@ai-job-print/shared'
import { ArrowRightIcon, PrinterIcon } from 'lucide-react'
import {
  AI_OUTAGE_CODES,
  useAiTask,
  type AiAvailability,
  type AiTaskFallback,
} from '../../ai'
import { AiDeclarationNote } from '../../ai/AiDeclarationNote'
import {
  CareerPlanApiError,
  generateCareerPlan,
  getLatestCareerPlan,
  printCareerPlan,
} from '../../services/api/careerPlan'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { useAuth } from '../../auth/useAuth'
import { useRecruitmentHosting } from '../../hooks/useRecruitmentHosting'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { QxAppNavbar } from '../../components/qingxu/QxAppNavbar'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { readAiResumeSession } from './aiResumeSession'
import { JobFitStage } from './JobFitPage'
import { DecisionCta, DecisionHero } from './jobFit/DecisionWorkspaceChrome'
import { emphasizeTitle } from './jobFit/emphasizeTitle'
import { Action } from './careerPlanAction'
import { buildCareerPlanView } from './careerPlanView'
import { useRouteIdentityGuard } from './hooks/useRouteIdentityGuard'
import { useStartPrintHandoff } from '../print/usePrintHandoff'
import './job-fit-qx.css'
import './resume-decision-qx.css'

interface PageState {
  taskId?: string
  accessToken?: string
}

/**
 * 前置缺失的两种真实情形，文案必须分开 —— 「没传 taskId」和「后端不认这个 taskId」
 * 对用户是两件事，合并成一句「请先上传简历」会让第二种情形显得像是自己没做过。
 */
type PreconditionGate = 'missing' | 'rejected'

type CareerScreen =
  | 'session-ended' | 'missing-task' | 'rejected-task' | 'loading' | 'guide' | 'generating' | 'ai-down' | 'failed'
  | 'ready' | 'print-pending' | 'print-failed' | 'print-degraded'

// 能力级错误码只有一份真值：`../../ai` 的 AI_OUTAGE_CODES。
//
// 这里曾经自己 new Set([...]) 抄了一份。抄本的危害不是重复，而是**假绿**：
// 共享表加一个码，本页不会跟着变，而门禁只检查「本页出现过 AI_OUTAGE_CODES
// 这个标识符」，照样通过 —— 于是「已修好」和「本页仍不认」可以同时成立。

const SELF_ASSESSMENT_ROUTE = '/resume/self-assessment/intro'

/**
 * AI 挂掉时仍然拿得到的东西。
 * 「自我探索照常能答」不是安慰话：`self-assessment.service.ts:130` 的 `scoreSelfAssessment`
 * 是纯函数评分，LLM 解读在其后的 try/catch 里单独降级 —— 记分不经过模型。
 */
const STILL_AVAILABLE_WITHOUT_PLAN =
  '你上传的简历原文照常可看；自我探索 25 道选择题的记分是固定权重累加、不经过 AI，现在照常能答（只是这次不会有陈述解读）。'
const STILL_AVAILABLE_WITH_PLAN =
  '已经生成过的这份规划照常可看，也照常能打印带走 —— 出纸不依赖 AI。'

function errorCodeOf(error: unknown): string {
  return error instanceof CareerPlanApiError ? error.code : 'UNKNOWN_ERROR'
}

const CAREER_PLAN_OUTAGE_COPY = 'AI 暂时不可用，你可以先打印求职参考单（未含 AI 规划）'

/** 置灰一律 aria-disabled + onClick 自己短路；原生 disabled 会让读屏跳过、触屏读不到原因。 */
export function CareerPlanPage() {
  const navigate = useNavigate()
  const startPrint = useStartPrintHandoff()
  const location = useLocation()
  const { user, getToken } = useAuth()
  const hostingOpen = useRecruitmentHosting().enabled // 招聘内容托管（3.13）关闭时不摆「看来源岗位」
  const state = (location.state ?? {}) as PageState
  const session = useMemo(() => readAiResumeSession(), [])
  // 登出 / 过期 / 换人 / 清场之后本路由会话永久结束（判据见 useRouteIdentityGuard）。
  const { ended: identityEnded, begin, settle, isLive } = useRouteIdentityGuard({ user, getToken })
  const queryTaskId = new URLSearchParams(location.search).get('taskId') ?? undefined
  const taskId = queryTaskId ?? state.taskId ?? session?.taskId
  const accessToken = state.accessToken ?? (!queryTaskId && !state.taskId ? session?.accessToken : undefined)
  const [storedPlan, setPlan] = useState<CareerPlanResponse | null>(null)
  /** 渲染闸：会话一结束，同一次渲染里就不再读存着的规划（存值随后在 layout effect 里清掉）。 */
  const plan = identityEnded ? null : storedPlan
  const [loading, setLoading] = useState(!!taskId)
  const [generating, setGenerating] = useState(false)
  const [printing, setPrinting] = useState(false)
  /**
   * 后端实际给了降级版、而本页据当前状态预期的是 AI 版时，暂存待确认的打印件。
   * 出现这种分歧的真实原因：规划在「读回」和「点打印」之间按 TTL 过期了。
   * 这时候直接把用户送去打印，他会以为拿到的是刚才屏幕上那份 AI 规划 —— 那是拿
   * 模板输出冒充 AI 结果。所以停一步，如实说清楚再让他自己决定。
   */
  const [storedDegradedPrint, setDegradedPrint] = useState<{ filename: string; pageCount: number; go: () => void } | null>(null)
  const degradedPrint = identityEnded ? null : storedDegradedPrint
  /** 生成这一跳的非能力级失败（留在当前屏）。 */
  const [error, setError] = useState<string | null>(null)
  /** 打印件生成失败，落成 print-failed 屏；与生成失败分开，免得互相覆盖。 */
  const [printError, setPrintError] = useState<string | null>(null)
  /** 后端明确不认这份简历解析结果（AI_TASK_NOT_FOUND：不存在 / 已过期 / 不属于当前身份）。 */
  const [rejectedTask, setRejectedTask] = useState(false)
  /** AI 能力级不可用时的人话（固定句，不透出服务端原文），null 表示未观测到不可用。 */
  const [aiOutage, setAiOutage] = useState<string | null>(null)
  /** 是否已经完成过一次真实往返 —— 没探到之前一律 fail-closed，不假设服务正常。 */
  const [probed, setProbed] = useState(false)
  /** 模型跑了但没给出可用规划（status:'failed'），与「AI 连不上」不是一回事。 */
  const [taskFailReason, setTaskFailReason] = useState<string | null>(null)

  useBusyLock(generating || printing)

  // 会话结束的那一次提交：丢掉规划与待确认打印件，放下忙态（忙锁不许按住隐私计时）。
  // 离开本页后晚到的打印返回，由身份闸的卸载代次作废，不再把用户拽去打印确认页。
  useLayoutEffect(() => {
    if (!identityEnded) return
    setPlan(null)
    setDegradedPrint(null)
    setError(null)
    setPrintError(null)
    setGenerating(false)
    setPrinting(false)
    setLoading(false)
  }, [identityEnded])

  useEffect(() => {
    if (identityEnded) return
    setPlan(null)
    setRejectedTask(false)
    setError(null)
    setLoading(Boolean(taskId))
    if (!taskId) { setLoading(false); return }
    const run = begin()
    if (!run) return
    let cancelled = false
    getLatestCareerPlan(taskId, { token: getToken(), accessToken })
      .then((result) => {
        if (cancelled || !isLive(run)) return
        if (result.status === 'completed') setPlan(result)
        setProbed(true)
      })
      .catch((err: unknown) => {
        if (cancelled || !isLive(run)) return
        const code = errorCodeOf(err)
        // 没有规划记录是正常态：说明还没生成过，但这一趟证明了后端可达。
        if (code === 'CAREER_PLAN_NOT_FOUND') { setProbed(true); setError('这份简历还没有可查看的职业规划，原结果可能已过期或删除；可重新生成。'); return }
        // 前置校验的落点：后端不认这个 taskId，继续留在本页只会让用户白点一次生成。
        if (code === 'AI_TASK_NOT_FOUND') { setRejectedTask(true); return }
        if (AI_OUTAGE_CODES.has(code)) {
          setAiOutage(CAREER_PLAN_OUTAGE_COPY)
          return
        }
        // 其余错误不足以判定能力不可用，标记已探测，让用户能真的点一次生成看结果。
        setProbed(true)
      })
      .finally(() => { if (!cancelled && isLive(run)) setLoading(false) })
    return () => { cancelled = true }
  }, [identityEnded, taskId, accessToken, getToken, begin, isLive])

  /**
   * availability 必须来自真实信号，不得写死 'available'：
   *   unavailable ← 真实观测到的能力级故障（未配置 / 连不上 / 演示模式 / 网络断）
   *   unknown     ← 还没做过任何真实往返（fail-closed，此时页面停在读取态）
   *   available   ← 至少一次真实往返成功返回了结构化响应
   */
  const availability: AiAvailability = aiOutage ? 'unavailable' : probed ? 'available' : 'unknown'

  const aiTask = useAiTask({
    availability,
    pending: generating,
    failed: Boolean(taskFailReason),
    hasResult: Boolean(plan),
  })

  const goSelfAssessment = () => navigate(SELF_ASSESSMENT_ROUTE)
  const goResumeHub = () => navigate('/resume-service')
  const goUpload = () => navigate('/resume/source?intent=diagnose')
  const goJobFit = () => navigate('/resume/job-fit', { state: { taskId, accessToken } })
  const goOptimize = () => navigate('/resume/optimize', { state: { taskId, accessToken } })
  const goPrintHub = () => navigate('/print-scan')

  /**
   * 三类降级里本页只用得上两类，且是刻意的：
   *
   *  blocked            AI 是这份规划的唯一产出源，页面又有生成入口 → 按钮置灰 + 写清原因。
   *  result-unavailable 模型跑了但没出可用结果 → 结果区诚实说这次办不到，入口保留可重试。
   *  manual             **不用**。职业规划没有「用户自己一步步做也能拿到同一份结果」的路径：
   *                     原型自己就写着 ai-down 下的三条自查是「通用建议，不是针对你这份简历的」。
   *                     套 manual 等于伪造一条等价手动路径（CLAUDE.md §9 不伪造能力）。
   */
  const fallback: AiTaskFallback = taskFailReason && !aiOutage
    ? {
        mode: 'result-unavailable',
        reason: `本次没能生成求职方案：${taskFailReason}`,
        retryHint: '这不是你的操作问题。可以过一会儿再点一次生成；若连续几次都这样，说明这份简历解析结果暂时给不出可用依据，可以回简历工作台补充经历后再来。',
        action: { label: '先做一次自我探索', onClick: goSelfAssessment },
      }
    : {
        mode: 'blocked',
        reason: aiOutage ?? '本机还没有确认 AI 服务状态，这次不发起生成 —— 状态不明时不假装能算。',
        blockedActionLabel: plan ? '重新生成求职方案' : '生成求职方案',
        stillAvailable: plan ? STILL_AVAILABLE_WITH_PLAN : STILL_AVAILABLE_WITHOUT_PLAN,
        action: { label: '先做一次自我探索', onClick: goSelfAssessment },
      }

  const handleGenerate = async () => {
    // 这里刻意**不看** aiTask.canStart：首屏读取只要撞上一次能力级错误，`aiOutage` 就被
    // 写死、canStart 恒 false，生成钮一旦被它包住就再也回不来（AI 恢复了也只能退出重进）。
    // 用户主动点一次就清掉上次的能力判定，再发一次真实请求，由结果重新决定。
    // 不加轮询、不自动重探：只有用户按下去才会再打一次。
    if (!taskId || generating) return
    const run = begin('generate')
    if (!run) return
    setGenerating(true)
    setAiOutage(null)
    setError(null)
    setTaskFailReason(null)
    try {
      const result = await generateCareerPlan(taskId, { token: getToken(), accessToken })
      if (!isLive(run)) return
      if (result.status === 'failed') {
        setTaskFailReason(result.failReason ?? '模型这次没有返回可用的规划内容')
      } else {
        setPlan(result)
        setProbed(true)
      }
    } catch (err) {
      if (!isLive(run)) return
      const code = errorCodeOf(err)
      if (code === 'AI_TASK_NOT_FOUND') setRejectedTask(true)
      else if (AI_OUTAGE_CODES.has(code)) setAiOutage(CAREER_PLAN_OUTAGE_COPY)
      else setError(userMessageOf(err, '生成失败，请稍后重试'))
    } finally {
      setGenerating(false)
      settle(run)
    }
  }

  const handlePrint = async () => {
    if (!taskId || printing) return
    const run = begin('print')
    if (!run) return
    setPrinting(true)
    setPrintError(null)
    try {
      const file = await printCareerPlan(taskId, { token: getToken(), accessToken })
      if (!isLive(run)) return
      if (!file.printFileUrl) throw new Error('打印链接未就绪，请稍后重试')
      const goPrint = () => startPrint({
        origin: 'career_plan',
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
      // 后端在没有已落库 AI 规划时改发**降级版式**（career-plan.service.ts printPlan 的
      // variant:'degraded'）。判 `=== 'degraded'`，不写 `?? 'ai'`：字段缺失时按未知处理。
      // 本页已经有 plan 却拿回降级版 = 规划在这两步之间过期了，必须先说明再打印；
      // 本来就没有 plan 的那条路径按钮文案已经写明「未含 AI 规划」，不再多一次确认。
      if (file.variant === 'degraded' && plan) {
        // 存起来的 go 也要再核一次身份：会话结束后它既不渲染，也不许被任何路径调起来。
        setDegradedPrint({ filename: file.filename, pageCount: file.pageCount, go: () => { if (isLive(run)) goPrint() } })
        return
      }
      goPrint()
    } catch (err) {
      if (!isLive(run)) return
      setPrintError(userMessageOf(err, '打印版生成失败，请稍后重试'))
    } finally {
      setPrinting(false)
      settle(run)
    }
  }

  // ── 前置门控 ──────────────────────────────────────────────────────────
  // 只判「有没有 taskId」不够：sessionStorage 里的 taskId 会比后端那行解析结果活得久
  // （匿名结果有 expiresAt，会员结果按 endUserId 归属）。后端 AI_TASK_NOT_FOUND
  // 明确否认之后必须挡在这里，否则用户会在下一屏点一次生成再吃一次同样的失败。
  const gate: PreconditionGate | null = !taskId ? 'missing' : rejectedTask ? 'rejected' : null

  const screen: CareerScreen = identityEnded ? 'session-ended' : gate === 'missing' ? 'missing-task'
    : gate === 'rejected' ? 'rejected-task'
      : loading ? 'loading'
        : printing ? 'print-pending'
          : degradedPrint ? 'print-degraded'
            : printError ? 'print-failed'
              : plan ? 'ready'
                : aiTask.isRunning ? 'generating'
                  : aiTask.isFailed ? (aiOutage ? 'ai-down' : 'failed')
                    : 'guide'

  const printButton = (
    <button
      type="button"
      className="qx-btn rdq-aria-btn"
      data-variant="ghost"
      data-career-plan-print="true" aria-disabled={printing}
      onClick={() => void handlePrint()}
    >
      <PrinterIcon size={22} aria-hidden="true" />
      {/* 没有已生成的 plan 时后端必定发降级版式，文案就得先说清楚。 */}
      {plan ? '打印建议单' : '打印求职参考单（未含 AI 规划）'}
    </button>
  )
  // 生成钮**无条件**渲染，不被 aiTask.canStart 包住（见 handleGenerate 顶部注释）。
  const generateButton = (
    <span className="qx-ai-declaration-slot">
      <Action
        variant="primary"
        busy={generating}
        onClick={() => void handleGenerate()}
        label={generating ? '正在生成…' : aiOutage ? (plan ? '重试生成' : '重试生成求职方案') : plan ? '重新生成' : '生成求职方案'}
        icon={generating ? null : <ArrowRightIcon size={22} aria-hidden="true" />}
      />
      <AiDeclarationNote />
    </span>
  )

  const view = buildCareerPlanView({
    screen, plan, availability, degradedPrint, printError,
    goUpload, goResumeHub, goJobFit, goOptimize, goPrintHub, goSelfAssessment,
    navigate, handleGenerate, handlePrint, setDegradedPrint, setPrintError,
    hostingOpen, getToken, aiTask, fallback, error, printButton, generateButton,
  })
  view.cta = <DecisionCta>{view.cta}</DecisionCta>

  return (
    <JobFitStage>
      <QxPageFrame
        title={view.title}
        status={view.pill}
        back={{ label: '返回简历服务', onBack: goResumeHub }}
        ctabar={view.cta}
        navbar={(
          <QxAppNavbar
            onHome={() => navigate('/')}
            onAdvisor={() => navigate('/assistant')}
            onProfile={() => navigate('/profile')}
          />
        )}
      >
        <DecisionHero eyebrow="职业规划" title={emphasizeTitle(view.title)} copy={view.subtitle} echoesPageHead />
        <main
          className="qx-scroll"
          data-kiosk-domain="resume"
          data-kiosk-screen="resume-career-plan"
          data-state={screen}
          data-testid={`resume-career-plan-state-${screen}`}
        >
          {view.body}
        </main>
      </QxPageFrame>
    </JobFitStage>
  )
}
