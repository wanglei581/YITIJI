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
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { CareerPlanResponse } from '@ai-job-print/shared'
import { makePrintParams } from '@ai-job-print/shared'
import {
  ArrowRightIcon,
  BotIcon,
  CompassIcon,
  FileTextIcon,
  HelpCircleIcon,
  ListIcon,
  PencilLineIcon,
  PrinterIcon,
  RefreshCwIcon,
  RouteIcon,
  TargetIcon,
} from 'lucide-react'
import {
  AiConclusion,
  AI_OUTAGE_CODES,
  AiDisclaimerLine,
  AigcMark,
  AiTaskRegion,
  EvidenceLegend,
  useAiTask,
  type AiAvailability,
  type AiTaskFallback,
} from '../../ai'
import {
  CareerPlanApiError,
  generateCareerPlan,
  getLatestCareerPlan,
  printCareerPlan,
} from '../../services/api/careerPlan'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { QxAppNavbar } from '../../components/qingxu/QxAppNavbar'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { readAiResumeSession } from './aiResumeSession'
import { JobFitStage } from './JobFitPage'
import { CareerPlanExistingMaterials } from './components/career-plan/CareerPlanExistingMaterials'
import { CareerPlanColumns, CareerPlanSelfCheck } from './components/career-plan/CareerPlanSection'
import {
  CtaNote, Ghosts, Guardline, KitRows, ListRows, Nots, RouteCards, Sec, Slots, Steps, Verdict, Waiting,
} from './jobFit/jobFitQxKit'
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
  | 'missing-task' | 'rejected-task' | 'loading' | 'guide' | 'generating' | 'ai-down' | 'failed'
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

function errorMessageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
}

/** 置灰一律 aria-disabled + onClick 自己短路；原生 disabled 会让读屏跳过、触屏读不到原因。 */
function Action({ label, variant, onClick, busy, icon }: {
  label: ReactNode
  variant: 'ghost' | 'primary' | 'teal'
  onClick: () => void
  busy?: boolean
  icon?: ReactNode
}) {
  return (
    <button type="button" className="qx-btn rdq-aria-btn" data-variant={variant} aria-disabled={busy} onClick={onClick}>
      {icon}
      {label}
    </button>
  )
}

export function CareerPlanPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { getToken } = useAuth()
  const state = (location.state ?? {}) as PageState
  const session = useMemo(() => readAiResumeSession(), [])
  const taskId = state.taskId ?? session?.taskId
  const accessToken = state.accessToken ?? session?.accessToken
  const [plan, setPlan] = useState<CareerPlanResponse | null>(null)
  const [loading, setLoading] = useState(!!taskId)
  const [generating, setGenerating] = useState(false)
  const [printing, setPrinting] = useState(false)
  /**
   * 后端实际给了降级版、而本页据当前状态预期的是 AI 版时，暂存待确认的打印件。
   * 出现这种分歧的真实原因：规划在「读回」和「点打印」之间按 TTL 过期了。
   * 这时候直接把用户送去打印，他会以为拿到的是刚才屏幕上那份 AI 规划 —— 那是拿
   * 模板输出冒充 AI 结果。所以停一步，如实说清楚再让他自己决定。
   */
  const [degradedPrint, setDegradedPrint] = useState<{ filename: string; pageCount: number; go: () => void } | null>(null)
  /** 生成这一跳的非能力级失败（留在当前屏）。 */
  const [error, setError] = useState<string | null>(null)
  /** 打印件生成失败，落成 print-failed 屏；与生成失败分开，免得互相覆盖。 */
  const [printError, setPrintError] = useState<string | null>(null)
  /** 后端明确不认这份简历解析结果（AI_TASK_NOT_FOUND：不存在 / 已过期 / 不属于当前身份）。 */
  const [rejectedTask, setRejectedTask] = useState(false)
  /** AI 能力级不可用的**真实原因**（原样透出后端 message），null 表示未观测到不可用。 */
  const [aiOutage, setAiOutage] = useState<string | null>(null)
  /** 是否已经完成过一次真实往返 —— 没探到之前一律 fail-closed，不假设服务正常。 */
  const [probed, setProbed] = useState(false)
  /** 模型跑了但没给出可用规划（status:'failed'），与「AI 连不上」不是一回事。 */
  const [taskFailReason, setTaskFailReason] = useState<string | null>(null)
  /** 打印这一跳的代次：离开本页后晚到的返回不许再把用户拽去打印确认页。 */
  const printRunRef = useRef(0)

  useBusyLock(generating || printing)

  useEffect(() => () => { printRunRef.current += 1 }, [])

  useEffect(() => {
    if (!taskId) { setLoading(false); return }
    let cancelled = false
    getLatestCareerPlan(taskId, { token: getToken(), accessToken })
      .then((result) => {
        if (cancelled) return
        if (result.status === 'completed') setPlan(result)
        setProbed(true)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        const code = errorCodeOf(err)
        // 没有规划记录是正常态：说明还没生成过，但这一趟证明了后端可达。
        if (code === 'CAREER_PLAN_NOT_FOUND') { setProbed(true); return }
        // 前置校验的落点：后端不认这个 taskId，继续留在本页只会让用户白点一次生成。
        if (code === 'AI_TASK_NOT_FOUND') { setRejectedTask(true); return }
        if (AI_OUTAGE_CODES.has(code)) {
          setAiOutage(errorMessageOf(err, '后端服务当前不可达'))
          return
        }
        // 其余错误不足以判定能力不可用，标记已探测，让用户能真的点一次生成看结果。
        setProbed(true)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [taskId, accessToken, getToken])

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

  const runningBlock = (
    <Waiting
      icon={<BotIcon size={34} />}
      title="生成请求已提交给服务端"
      desc="正在读你的简历，整理方向与缺口。进度由后端任务状态决定，本页不会自己把它走完。"
      tag="整体等待中，没有百分比"
    />
  )

  const handleGenerate = async () => {
    // 这里刻意**不看** aiTask.canStart：首屏读取只要撞上一次能力级错误，`aiOutage` 就被
    // 写死、canStart 恒 false，生成钮一旦被它包住就再也回不来（AI 恢复了也只能退出重进）。
    // 用户主动点一次就清掉上次的能力判定，再发一次真实请求，由结果重新决定。
    // 不加轮询、不自动重探：只有用户按下去才会再打一次。
    if (!taskId || generating) return
    setGenerating(true)
    setAiOutage(null)
    setError(null)
    setTaskFailReason(null)
    try {
      const result = await generateCareerPlan(taskId, { token: getToken(), accessToken })
      if (result.status === 'failed') {
        setTaskFailReason(result.failReason ?? '模型这次没有返回可用的规划内容')
      } else {
        setPlan(result)
        setProbed(true)
      }
    } catch (err) {
      const code = errorCodeOf(err)
      if (code === 'AI_TASK_NOT_FOUND') setRejectedTask(true)
      else if (AI_OUTAGE_CODES.has(code)) setAiOutage(errorMessageOf(err, 'AI 服务当前不可用'))
      else setError(errorMessageOf(err, '生成失败，请稍后重试'))
    } finally {
      setGenerating(false)
    }
  }

  const handlePrint = async () => {
    if (!taskId || printing) return
    const run = ++printRunRef.current
    setPrinting(true)
    setPrintError(null)
    try {
      const file = await printCareerPlan(taskId, { token: getToken(), accessToken })
      if (run !== printRunRef.current) return
      if (!file.printFileUrl) throw new Error('打印链接未就绪，请稍后重试')
      const goPrint = () => navigate('/print/confirm', {
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
      // 后端在没有已落库 AI 规划时改发**降级版式**（career-plan.service.ts printPlan 的
      // variant:'degraded'）。判 `=== 'degraded'`，不写 `?? 'ai'`：字段缺失时按未知处理。
      // 本页已经有 plan 却拿回降级版 = 规划在这两步之间过期了，必须先说明再打印；
      // 本来就没有 plan 的那条路径按钮文案已经写明「未含 AI 规划」，不再多一次确认。
      if (file.variant === 'degraded' && plan) {
        setDegradedPrint({ filename: file.filename, pageCount: file.pageCount, go: goPrint })
        return
      }
      goPrint()
    } catch (err) {
      if (run !== printRunRef.current) return
      setPrintError(userMessageOf(err, '打印版生成失败，请稍后重试'))
    } finally {
      setPrinting(false)
    }
  }

  // ── 前置门控 ──────────────────────────────────────────────────────────
  // 只判「有没有 taskId」不够：sessionStorage 里的 taskId 会比后端那行解析结果活得久
  // （匿名结果有 expiresAt，会员结果按 endUserId 归属）。后端 AI_TASK_NOT_FOUND
  // 明确否认之后必须挡在这里，否则用户会在下一屏点一次生成再吃一次同样的失败。
  const gate: PreconditionGate | null = !taskId ? 'missing' : rejectedTask ? 'rejected' : null

  const screen: CareerScreen = gate === 'missing' ? 'missing-task'
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
    <Action
      variant="primary"
      busy={generating}
      onClick={() => void handleGenerate()}
      label={generating ? '正在生成…' : aiOutage ? (plan ? '重试生成' : '重试生成求职方案') : plan ? '重新生成' : '生成求职方案'}
      icon={generating ? null : <ArrowRightIcon size={22} aria-hidden="true" />}
    />
  )
  const generateError = error ? <p className="jfq-alert" role="alert">{error}</p> : null

  function buildView(): { title: string; subtitle: string; pill: { tone: 'ok' | 'warn' | 'bad' | 'unknown'; label: string }; body: ReactNode; cta: ReactNode } {
    if (screen === 'missing-task') return {
      title: '规划要基于真实材料',
      subtitle: '求职方案会基于已完成的简历诊断整理已有材料、目标与方向、尚需准备和执行计划；没有可读取的本人简历任务时，不生成任何个人规划内容。',
      pill: { tone: 'warn', label: '缺少可读取的本人简历任务' },
      body: (
        <>
          <Sec title="当前状态" hint="只写已确认的事实">
            <Verdict items={[
              { tone: 'bad', label: '本人简历任务', value: '尚未可用' },
              { tone: 'warn', label: '求职方案', value: '尚未生成' },
              { tone: 'ok', label: '材料与打印', value: '不受影响' },
            ]} />
          </Sec>
          <Sec title="规划会用到、也只会用到这些" hint="输入范围写在前面" grow>
            <ListRows items={[
              '当前本人简历任务里的经历、技能与教育信息',
              '本人此前的岗位匹配参考或模拟面试摘要（服务端有记录时才会用到）',
              '不使用他人材料，不引入企业侧数据，不做录用或收入承诺',
            ]} />
          </Sec>
          <Sec title="现在能做的两件事" hint="按你手上有什么来选">
            <RouteCards items={[
              { title: '上传或扫描简历', desc: '有了可读取的简历任务，才能开始做规划。', action: '去简历上传', onClick: goUpload },
              { title: '先和 AI 顾问聊目标', desc: '还没想清楚方向时，可以先把想法说出来。', action: '去 AI 顾问', onClick: () => navigate('/assistant') },
            ]} />
          </Sec>
        </>
      ),
      cta: (
        <>
          <CtaNote>没有可读取的简历任务时，不生成任何个人规划内容。</CtaNote>
          <Action label="返回简历服务" variant="ghost" onClick={goResumeHub} />
          <Action label="去上传简历" variant="primary" onClick={goUpload} icon={<ArrowRightIcon size={22} aria-hidden="true" />} />
        </>
      ),
    }

    if (screen === 'rejected-task') return {
      title: '这台机器上读不到你那份简历解析结果了',
      subtitle: '解析结果有保存期限，也只对本人开放。这次读不到它，所以本页拿不到任何依据 —— 重新上传一次简历、跑完诊断，就能回到这里生成。',
      pill: { tone: 'bad', label: '简历任务不可读取' },
      body: (
        <>
          <Sec title="让它重新可用的三步" hint="每一步都在既有流程里" grow>
            <Steps items={[
              { title: '重新上传或扫描一份简历', desc: '进入简历材料入口，选择文件上传、纸质扫描或手机传输。' },
              { title: '等待解析完成', desc: '解析成功后才会出现可用任务；失败会直接显示失败原因。' },
              { title: '回到求职方案生成', desc: '任务可用后，再由你确认开始生成。' },
            ]} />
          </Sec>
          <Sec title="这次没有发生的事" hint="明确否定，避免误解">
            <Nots items={['没有读取到本人简历原文', '没有生成任何方向或计划', '没有把简历内容提供给企业或第三方']} />
          </Sec>
        </>
      ),
      cta: (
        <>
          <CtaNote>不会用其他人的任务或历史结果顶替这份不可读取的任务。</CtaNote>
          <Action label="返回简历服务" variant="ghost" onClick={goResumeHub} />
          <Action label="重新上传简历" variant="primary" onClick={goUpload} icon={<ArrowRightIcon size={22} aria-hidden="true" />} />
        </>
      ),
    }

    if (screen === 'loading') return {
      title: '正在读取你的求职方案',
      subtitle: '读取的是本人此前保存的规划。读到才显示；没有或读取失败会直接说明。',
      pill: { tone: 'unknown', label: '正在读取已有求职方案' },
      body: (
        <>
          <Sec title="正在确认是否存在可继续查看的真实规划结果" hint="无进度条 · 无预计时间">
            <Waiting icon={<RouteIcon size={34} />} title="读取请求已提交，等待服务端返回" desc="读取成功才显示方向、技能计划和行动清单；没有已有规划时会转到生成入口，不显示空壳内容。" tag="整体等待中，没有百分比" />
          </Sec>
          <Sec title="读取之后会怎么走" hint="三种结果都写清楚" grow>
            <Steps items={[
              { title: '读到已有规划', desc: '直接显示上一次生成的内容，全部由服务端提供。' },
              { title: '没有已有规划', desc: '转到生成入口，由你确认后再开始，不会自动替你生成。' },
              { title: '读取失败', desc: '直接显示失败状态，不用模板内容或他人内容顶替。' },
            ]} />
          </Sec>
          <Sec title="还没有返回的内容" hint="返回前一律留空">
            <Ghosts items={[
              { title: '目标与方向', desc: '方向、原因与第一步由结果给出。', tag: '等待返回' },
              { title: '尚需准备', desc: '技能缺口按阶段返回后才显示。', tag: '等待返回' },
              { title: '执行计划', desc: '近期清单返回后才显示。', tag: '等待返回' },
            ]} />
          </Sec>
        </>
      ),
      cta: (
        <>
          <CtaNote>读取期间不生成、不保存、不打印任何内容。</CtaNote>
          <Action label="返回简历服务" variant="ghost" onClick={goResumeHub} />
          <Action label="取消读取，先看岗位匹配" variant="primary" onClick={goJobFit} />
        </>
      ),
    }

    if (screen === 'print-pending') return {
      title: '打印件还在等生成',
      subtitle: '文件真实生成后才进入既有打印确认流程；本页不代表已经打印。',
      pill: { tone: 'unknown', label: '等待服务端生成打印文件' },
      body: (
        <>
          <Sec title="已提交生成打印件" hint="生成 ≠ 打印">
            <Waiting icon={<PrinterIcon size={34} />} title="请求已提交，等待文件生成" desc="生成成功后进入打印确认页，由你确认份数、单双面和费用。" tag="等待生成，没有进度和预计时间" />
          </Sec>
          <Sec title="打印这件事的真实状态" hint="逐条对照，不含糊" grow>
            <ListRows items={[
              '打印文件还没有返回，没有可预览的版本',
              '打印机没有收到任务，也没有开始出纸',
              '没有取件码，也没有订单号',
              '本页没有发起支付',
              '生成成功后会进入打印确认页，由你逐项确认后再打印',
            ]} />
          </Sec>
        </>
      ),
      cta: (
        <>
          <CtaNote>离开本页后，这次生成的结果不会再把你带去打印确认页。</CtaNote>
          <Action label="返回简历服务" variant="ghost" onClick={goResumeHub} />
          <Action label="改用现有文件打印" variant="primary" onClick={goPrintHub} />
        </>
      ),
    }

    if (screen === 'print-failed') return {
      title: '打印件没有生成',
      subtitle: '文件生成失败。系统不会把失败写成已发送到打印机，也不产生取件码。',
      pill: { tone: 'bad', label: '打印文件生成失败' },
      body: (
        <>
          <Sec title="这次的结果" hint="只写已确认的事实">
            <Verdict items={[
              { tone: 'bad', label: '打印文件', value: '未生成' },
              { tone: 'ok', label: plan ? '规划内容' : '生成入口', value: plan ? '仍可查看' : '仍可使用' },
              { tone: 'ok', label: '打印机', value: '未收到任务' },
            ]} />
            {printError && <p className="jfq-alert" role="alert">{printError}</p>}
          </Sec>
          <Sec title="三个既有入口" hint="按需要选一个" grow>
            <KitRows items={[
              { icon: <RefreshCwIcon size={22} />, title: '重新生成打印件', desc: '沿用当前内容再试一次', onClick: () => void handlePrint() },
              { icon: <PrinterIcon size={22} />, title: '打印现有文件', desc: '走既有打印流程，不依赖生成', onClick: goPrintHub },
              { icon: <HelpCircleIcon size={22} />, title: '查看帮助', desc: '现场操作说明与联系方式', onClick: () => navigate('/help') },
            ]} />
          </Sec>
        </>
      ),
      cta: (
        <>
          <CtaNote>失败不写成已发送打印，也不产生取件码。</CtaNote>
          <Action label="返回求职方案" variant="ghost" onClick={() => setPrintError(null)} />
          <Action label="重新生成打印件" variant="primary" onClick={() => void handlePrint()} />
        </>
      ),
    }

    if (screen === 'print-degraded' && degradedPrint) return {
      title: '这次拿到的不是上面那份',
      subtitle: `生成出来的是「${degradedPrint.filename}」。要拿到按你简历原文逐条对应的完整版本，需要重新生成一次。`,
      pill: { tone: 'warn', label: '打印件未含 AI 规划正文' },
      body: (
        <>
          <Sec title="打印前先说清楚" hint="由你自己决定">
            <div className="qx-card jfq-consent-card" role="alert">
              <p>
                你屏幕上这份 AI 规划已经按留存期限到期清理了，所以本次打印件里<strong>没有</strong> AI 规划正文，
                只有你自己填的自我探索记分、通用求职自检清单和岗位要求计数（共 {degradedPrint.pageCount} 页）。
              </p>
            </div>
            <Verdict items={[
              { tone: 'warn', label: '本次打印件', value: '未含 AI 规划' },
              { tone: 'warn', label: '屏幕上的规划', value: '服务端已清理' },
              { tone: 'ok', label: '打印机', value: '未收到任务' },
            ]} />
          </Sec>
          <Sec title="两条路，由你选" hint="都进入既有流程" grow>
            <RouteCards items={[
              { title: '重新生成完整版', desc: '按你的简历原文再生成一次规划，之后再打印。', action: '重新生成', onClick: () => { setDegradedPrint(null); void handleGenerate() } },
              { title: '仍然打印这份参考单', desc: '只含自我探索记分、通用自检清单和岗位要求计数。', action: '去打印确认', onClick: degradedPrint.go },
            ]} />
          </Sec>
        </>
      ),
      cta: (
        <>
          <CtaNote>确认之前不会进入打印确认页。</CtaNote>
          <Action label="先不打印" variant="ghost" onClick={() => setDegradedPrint(null)} />
          <Action label="仍然打印这份参考单" variant="primary" onClick={degradedPrint.go} />
        </>
      ),
    }

    if (screen === 'ready' && plan) return {
      title: '求职方案',
      subtitle: `依据：本人简历${plan.basedOn?.jobFit ? ` + 岗位匹配参考（${plan.basedOn.jobFit}）` : ''}${plan.basedOn?.interview ? ` + 模拟面试表现（${plan.basedOn.interview}）` : ''}。依据说明这份规划根据什么生成，不是你手上的文件清单。`,
      pill: { tone: 'ok', label: '规划已返回 · 只供本人参考' },
      body: (
        <>
          <Sec title="先看结论，再安排下一步" hint="四栏：已有材料、目标与方向、尚需准备、执行计划">
            <div className="rdq-ai">
              {/* 全页恰好一次的 AIGC 可见标识（interface-handoff.md §3）。 */}
              <div className="rdq-chips">
                <AigcMark />
                {/*
                  按真实登录态区分：匿名结果那行 endUserId 为 null，「我的 AI 记录」按 endUserId
                  过滤 —— 匿名场景下写「已存入 AI服务记录」为假（CLAUDE.md §9 不伪造能力）。
                */}
                <span className="rdq-chip">{getToken() ? '已存入 AI服务记录' : '未登录 · 本次结果不进入「我的」记录，可先打印带走'}</span>
              </div>
              {plan.summary ? <AiConclusion text={plan.summary} /> : null}
            </div>
            <Guardline
              head="只供本人参考"
              body="本机不预测前景、不预测薪资、不说「三年后你能到什么岗」—— 那些本机没有依据。本机不代收简历、不代为投递；是否转方向、是否考证，由你自己决定。"
            />
          </Sec>

          <CareerPlanExistingMaterials />

          <CareerPlanColumns plan={plan} />

          {/*
            已生成的规划是**已落库的成品**，不是正在跑的 AI 任务：AI 现在挂了也不该
            让它从屏幕上消失（否则打印这条非 AI 能力跟着一起没了）。所以本区域只治理
            「再生成一次」这个 AI 任务面，规划正文渲染在它之外。
          */}
          <div className="rdq-ai">
            <AiTaskRegion task={aiTask} label="重新生成求职方案" running={runningBlock} fallback={fallback}>
              <p className="rdq-muted">这份规划已经生成并存好，打印不依赖 AI；简历更新之后可以回来重新生成一次。</p>
            </AiTaskRegion>
            {generateError}
          </div>

          <Sec title="继续下一步" hint="都是既有流程">
            <KitRows items={[
              { icon: <PencilLineIcon size={22} />, title: '优化简历', desc: '按规划里的方向调整内容重点', onClick: goOptimize },
              { icon: <TargetIcon size={22} />, title: '岗位匹配', desc: '对照一个具体岗位看差距', onClick: goJobFit },
              { icon: <BotIcon size={22} />, title: '模拟面试', desc: '把准备的内容练一遍', onClick: () => navigate('/interview/setup') },
              { icon: <CompassIcon size={22} />, title: '做一次自我探索', desc: '25 道选择题，记分不经过 AI', onClick: goSelfAssessment },
            ]} />
            <div className="rdq-ai"><EvidenceLegend /></div>
          </Sec>
        </>
      ),
      cta: (
        <>
          <CtaNote>规划只供本人参考，不构成录用或收入承诺。</CtaNote>
          {printButton}
          {generateButton}
        </>
      ),
    }

    // 以下四屏都没有已生成的 plan：guide（idle）/ generating（running）/ ai-down / failed。
    // 同一个 AiTaskRegion 按 data-aitask 四态渲染，屏与屏之间只换外围的说明与出口。
    const generationRegion = (
      <div className="rdq-ai">
        <AiTaskRegion
          task={aiTask}
          label="AI 生成求职方案"
          running={runningBlock}
          fallback={fallback}
          idle={(
            <>
              <ul className="rdq-guide-list">
                <li>已有材料：来自你已保存的简历与文档，不经过模型。</li>
                <li>目标与方向：提供 1–3 个建议及可开始的第一步。</li>
                <li>尚需准备：按阶段整理技能缺口。</li>
                <li>执行计划：近期可动手的清单。</li>
              </ul>
              <AiDisclaimerLine>方向、缺口和行动清单都由 AI 判断，仅供参考；硬门槛（证书等）与「简历漏写」会分开写，不混成一句「你不行」。</AiDisclaimerLine>
              <p className="rdq-muted">岗位匹配或模拟面试已完成时，会在真实数据可用的范围内帮助建议更具体；没有也能直接生成。</p>
            </>
          )}
        />
        {generateError}
      </div>
    )

    if (screen === 'generating') return {
      title: '已提交生成，等待返回',
      subtitle: '生成请求已提交。服务端返回之前，不显示方向、技能计划或行动清单。',
      pill: { tone: 'unknown', label: '规划生成中，等待服务端返回' },
      body: (
        <>
          <Sec title="正在等待求职方案结果" hint="无阶段名 · 无百分比">{generationRegion}</Sec>
          <Sec title="本次生成提交的输入" hint="只用你本人的材料">
            <Slots items={[
              { label: '本人简历任务', value: '已随请求提交' },
              { label: '可选上下文', value: '以服务端已有记录为准' },
              { label: '结果归属', value: '仅本人可见', fixed: true },
            ]} />
          </Sec>
          <Sec title="生成期间不会发生的事" hint="边界不随状态放宽" grow>
            <Nots items={[
              '不显示生成进度百分比或阶段名称',
              '不承诺薪资、录用或跳槽结果',
              '不把简历或规划内容提供给企业',
              '不生成打印文件、不发起支付',
            ]} />
          </Sec>
        </>
      ),
      cta: (
        <>
          <CtaNote>离开本页不会撤回已提交的请求；回到本页时会重新读取结果。</CtaNote>
          <Action label="先看岗位匹配" variant="ghost" onClick={goJobFit} />
          <Action label="返回简历服务" variant="primary" onClick={goResumeHub} />
        </>
      ),
    }

    if (screen === 'ai-down') return {
      title: '规划生成当前不可用',
      subtitle: '这项 AI 能力暂时调不通。系统不显示方向、技能计划或行动清单，也不用模板内容顶替。',
      pill: { tone: 'bad', label: '职业规划生成当前不可用' },
      body: (
        <>
          <Sec title="当前判定" hint="只写已确认的事实">
            <Verdict items={[
              { tone: 'bad', label: 'AI 规划生成', value: '当前不可用' },
              { tone: 'ok', label: '简历与打印', value: '仍可正常使用' },
              { tone: 'warn', label: '其他 AI 能力', value: '需各自打开确认' },
            ]} />
            {generationRegion}
          </Sec>
          <CareerPlanSelfCheck />
          <Sec title="现在能用的非 AI 入口" hint="都是既有流程" grow>
            <KitRows items={[
              { icon: <FileTextIcon size={22} />, title: '手动整理求职材料', desc: '按自己的判断准备材料清单', onClick: () => navigate('/resume/materials') },
              { icon: <ListIcon size={22} />, title: '看来源岗位与要求', desc: '直接浏览来源平台的岗位信息', onClick: () => navigate('/jobs') },
              { icon: <PrinterIcon size={22} />, title: '打印现有材料', desc: '走既有打印流程，不依赖 AI', onClick: goPrintHub },
            ]} />
          </Sec>
        </>
      ),
      cta: (
        <>
          <CtaNote>服务不可用时不显示任何规划内容，也不承诺恢复时间。</CtaNote>
          {printButton}
          {generateButton}
        </>
      ),
    }

    if (screen === 'failed') return {
      title: '这次规划没有生成成功',
      subtitle: '没有可确认的规划结果。系统不保留半截内容，也不把上一次的结果当成这次的。',
      pill: { tone: 'bad', label: '本次职业规划生成未完成' },
      body: (
        <>
          <Sec title="这次请求的结果" hint="只写事实，不猜原因">
            <Verdict items={[
              { tone: 'bad', label: '本次生成', value: '未完成' },
              { tone: 'warn', label: '可用规划', value: '没有返回' },
            ]} />
            {generationRegion}
          </Sec>
          <Sec title="接下来三选一" hint="都进入既有流程" grow>
            <RouteCards items={[
              { title: '重新生成规划', desc: '沿用当前材料再试一次，不需要重新上传。', action: '重新生成', onClick: () => void handleGenerate() },
              { title: '先做岗位匹配', desc: '先看清目标岗位的差距，再谈长期规划。', action: '去岗位匹配', onClick: goJobFit },
              { title: '先改简历', desc: '按自己的判断调整材料重点，不依赖规划结果。', action: '去简历优化', onClick: goOptimize },
            ]} />
          </Sec>
        </>
      ),
      cta: (
        <>
          <CtaNote>未完成不会写成已生成，也不会自动保存。</CtaNote>
          {printButton}
          {generateButton}
        </>
      ),
    }

    return {
      title: '求职方案',
      subtitle: '四栏：已有材料、目标与方向、尚需准备、执行计划',
      pill: availability === 'available'
        ? { tone: 'ok', label: '尚未生成 · 由你确认后开始' }
        : { tone: 'unknown', label: '服务状态未确认' },
      body: (
        <>
          <Sec title="生成前说明" hint="把简历经历变成可执行的下一步" grow>
            {generationRegion}
            <Guardline
              head="只供本人参考"
              body="本机不预测前景、不预测薪资、不说「三年后你能到什么岗」—— 那些本机没有依据。本建议仅供本人职业发展参考，不构成任何就业、薪资或录用承诺。"
            />
          </Sec>
          <Sec title="生成之后能做的" hint="都是既有流程">
            <KitRows items={[
              { icon: <PencilLineIcon size={22} />, title: '按方向改简历', desc: '去简历优化调整内容重点', onClick: goOptimize },
              { icon: <TargetIcon size={22} />, title: '对照一个岗位', desc: '去岗位匹配看具体差距', onClick: goJobFit },
            ]} />
          </Sec>
        </>
      ),
      cta: (
        <>
          <CtaNote>由你确认后才开始生成，本页不会自动替你生成。</CtaNote>
          {printButton}
          {generateButton}
        </>
      ),
    }
  }

  const view = buildView()

  return (
    <JobFitStage>
      <QxPageFrame
        title={view.title}
        subtitle={view.subtitle}
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
