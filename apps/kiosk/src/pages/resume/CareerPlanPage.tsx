// 职业规划（P22）AI 接线 —— 接线矩阵 §3.7 / S2-6。
//
// 本轮做三件事，都不改后端：
//  1. 复用 S1 前端 AI 原语（apps/kiosk/src/ai）：data-aitask 四态 + 证据分级 + 三类降级；
//  2. 把 resumeTaskId 前置从「有没有字符串」升级成「后端认不认这份解析结果」；
//  3. 按 22-career-plan.html 的 ai-down 支线补齐诚实降级文案（照抄，不重新发明）。
//
// 视觉真值：docs/design/kiosk-ai-os-v3-2026-08/22-career-plan.html
// 真实规划读回、生成与打印逻辑保持在本页；LightFlow 仅重组视觉与状态层级。
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Button, Card, ComplianceBanner, KioskActionBar, KioskPageFrame, KioskPageHeader } from '@ai-job-print/ui'
import type { CareerPlanResponse } from '@ai-job-print/shared'
import { makePrintParams } from '@ai-job-print/shared'
import {
  ArrowRightIcon,
  CompassIcon,
  Loader2Icon,
  MicIcon,
  PencilLineIcon,
  PrinterIcon,
  TargetIcon,
} from 'lucide-react'
import {
  AiConclusion,
  AiDisclaimerLine,
  AigcMark,
  AiTaskRegion,
  EvidenceBadge,
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
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { KioskFullscreenShell } from '../../components/kiosk-shell/KioskFullscreenShell'
import { readAiResumeSession } from './aiResumeSession'
import './careerPlan-lightflow.css'
import './resume-fusion-youth.css'

interface PageState {
  taskId?: string
  accessToken?: string
}

/**
 * 前置缺失的两种真实情形，文案必须分开 —— 「没传 taskId」和「后端不认这个 taskId」
 * 对用户是两件事，合并成一句「请先上传简历」会让第二种情形显得像是自己没做过。
 */
type PreconditionGate = 'missing' | 'rejected'

/**
 * 会把整条 AI 能力判成不可用的错误码。
 * 其余错误（限流 429、参数错误等）是**本次调用**失败，不是能力不可用 ——
 * 那些保留重试入口，不许拿去把按钮永久置灰。
 */
const AI_OUTAGE_CODES = new Set(['AI_NOT_CONFIGURED', 'AI_UNAVAILABLE', 'MOCK_MODE', 'NETWORK_ERROR'])

const SELF_ASSESSMENT_ROUTE = '/resume/self-assessment/intro?from=career-plan'

/**
 * AI 挂掉时仍然拿得到的东西。
 * 「自我探索照常能答」不是安慰话：`self-assessment.service.ts:130` 的 `scoreSelfAssessment`
 * 是纯函数评分，LLM 解读在其后的 try/catch 里单独降级 —— 记分不经过模型。
 * 口径与 22-career-plan.html:427 的 ai-down 文案一致。
 */
const STILL_AVAILABLE_WITHOUT_PLAN =
  '你上传的简历原文照常可看；自我探索 25 道选择题的记分是固定权重累加、不经过 AI，现在照常能答（只是这次不会有陈述解读）。'
const STILL_AVAILABLE_WITH_PLAN =
  '已经生成过的这份规划照常可看，也照常能打印带走 —— 出纸不依赖 AI。'

function CareerPlanFullscreenFrame({ children }: { children: ReactNode }) {
  return (
    <KioskFullscreenShell>
      <KioskPageFrame className="fusion-w3 fusion-w3--resume">{children}</KioskPageFrame>
    </KioskFullscreenShell>
  )
}

function Section({ title, Icon, children }: {
  title: string
  Icon: React.ElementType
  children: React.ReactNode
}) {
  return (
    <Card className="career-plan-lightflow__section">
      <div className="career-plan-lightflow__section-heading">
        <span className="career-plan-lightflow__section-icon" aria-hidden="true"><Icon /></span>
        <h2>{title}</h2>
      </div>
      {children}
    </Card>
  )
}

function errorCodeOf(error: unknown): string {
  return error instanceof CareerPlanApiError ? error.code : 'UNKNOWN_ERROR'
}

function errorMessageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback
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
  const [error, setError] = useState<string | null>(null)
  /** 后端明确不认这份简历解析结果（AI_TASK_NOT_FOUND：不存在 / 已过期 / 不属于当前身份）。 */
  const [rejectedTask, setRejectedTask] = useState(false)
  /** AI 能力级不可用的**真实原因**（原样透出后端 message），null 表示未观测到不可用。 */
  const [aiOutage, setAiOutage] = useState<string | null>(null)
  /** 是否已经完成过一次真实往返 —— 没探到之前一律 fail-closed，不假设服务正常。 */
  const [probed, setProbed] = useState(false)
  /** 模型跑了但没给出可用规划（status:'failed'），与「AI 连不上」不是一回事。 */
  const [taskFailReason, setTaskFailReason] = useState<string | null>(null)

  useBusyLock(generating || printing)

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

  /**
   * 三类降级里本页只用得上两类，且是刻意的：
   *
   *  blocked            AI 是这份规划的唯一产出源，页面又有生成入口 → 按钮置灰 + 写清原因。
   *  result-unavailable 模型跑了但没出可用结果 → 结果区诚实说这次办不到，入口保留可重试。
   *  manual             **不用**。职业规划没有「用户自己一步步做也能拿到同一份结果」的路径：
   *                     22-career-plan.html:445 自己就写着 ai-down 下的三条自查是
   *                     「通用建议，不是针对你这份简历的」。套 manual 等于伪造一条
   *                     等价手动路径（CLAUDE.md §9 不伪造能力）。那三条改为页面内
   *                     单独一节如实呈现，不冒充降级替代品。
   */
  const fallback: AiTaskFallback = taskFailReason && !aiOutage
    ? {
        mode: 'result-unavailable',
        reason: `本次没能生成职业规划：${taskFailReason}`,
        retryHint: '这不是你的操作问题。可以过一会儿再点一次生成；若连续几次都这样，说明这份简历解析结果暂时给不出可用依据，可以回简历工作台补充经历后再来。',
        action: { label: '先做一次自我探索', onClick: goSelfAssessment },
      }
    : {
        mode: 'blocked',
        reason: aiOutage ?? '本机还没有确认 AI 服务状态，这次不发起生成 —— 状态不明时不假装能算。',
        blockedActionLabel: plan ? '重新生成职业规划' : '生成职业规划建议',
        stillAvailable: plan ? STILL_AVAILABLE_WITH_PLAN : STILL_AVAILABLE_WITHOUT_PLAN,
        action: { label: '先做一次自我探索', onClick: goSelfAssessment },
      }

  const runningBlock = (
    <section className="career-plan-lightflow__state-card" role="status" aria-live="polite">
      <p className="career-plan-lightflow__eyebrow">正在生成</p>
      <h2>正在读你的简历，整理方向与缺口</h2>
      <p>约 15–30 秒。进度由后端任务状态决定，本页不会自己把它走完。</p>
      <span className="career-plan-lightflow__progress"><i data-ai-progress /></span>
    </section>
  )

  const handleGenerate = async () => {
    if (!taskId || !aiTask.canStart) return
    setGenerating(true)
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
    setPrinting(true)
    setError(null)
    try {
      const file = await printCareerPlan(taskId, { token: getToken(), accessToken })
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
      setError(errorMessageOf(err, '打印版生成失败，请稍后重试'))
    } finally {
      setPrinting(false)
    }
  }

  // ── 前置门控 ──────────────────────────────────────────────────────────
  // 只判「有没有 taskId」不够：sessionStorage 里的 taskId 会比后端那行解析结果活得久
  // （匿名结果有 expiresAt，会员结果按 endUserId 归属）。后端 AI_TASK_NOT_FOUND
  // 明确否认之后必须挡在这里，否则用户会在下一屏点一次生成再吃一次同样的失败。
  const gate: PreconditionGate | null = !taskId ? 'missing' : rejectedTask ? 'rejected' : null

  if (gate) {
    return (
      <CareerPlanFullscreenFrame><main data-kiosk-domain="resume" data-kiosk-screen="resume-career-plan" className="service-desk career-plan-lightflow career-plan-lightflow--gate" data-visual-theme="service-desk" data-ux-density="touch">
        <section className="career-plan-lightflow__state-card" aria-labelledby="career-plan-gate-title">
          <span className="career-plan-lightflow__state-icon" aria-hidden="true"><CompassIcon /></span>
          <p className="career-plan-lightflow__eyebrow">职业方向服务</p>
          <h1 id="career-plan-gate-title">
            {gate === 'missing' ? '先准备简历，再规划方向' : '这台机器上读不到你那份简历解析结果了'}
          </h1>
          <p>
            {gate === 'missing'
              ? '职业规划会基于已完成的简历诊断整理发展方向与行动建议，不会替代真实的简历上传与诊断流程。'
              : '解析结果有保存期限，也只对本人开放。这次读不到它，所以本页拿不到任何依据 —— 重新上传一次简历、跑完诊断，就能回到这里生成。'}
          </p>
          <Button size="lg" className="career-plan-lightflow__primary-action" onClick={() => navigate('/resume/source?intent=diagnose')}>
            {gate === 'missing' ? '去上传简历' : '重新上传简历'}<ArrowRightIcon aria-hidden="true" />
          </Button>
        </section>
      </main></CareerPlanFullscreenFrame>
    )
  }

  if (loading) {
    return (
      <CareerPlanFullscreenFrame><main data-kiosk-domain="resume" data-kiosk-screen="resume-career-plan" className="service-desk career-plan-lightflow career-plan-lightflow--loading" data-visual-theme="service-desk" data-ux-density="touch">
        <section className="career-plan-lightflow__state-card" role="status" aria-live="polite" aria-label="正在恢复职业规划">
          <Loader2Icon className="career-plan-lightflow__spinner" aria-hidden="true" />
          <p className="career-plan-lightflow__eyebrow">职业方向服务</p>
          <h1>正在读取你的职业规划</h1>
          <p>正在确认是否存在可继续查看的真实规划结果。</p>
        </section>
      </main></CareerPlanFullscreenFrame>
    )
  }

  if (plan) {
    return (
      <CareerPlanFullscreenFrame><main data-kiosk-domain="resume" data-kiosk-screen="resume-career-plan" className="service-desk career-plan-lightflow career-plan-lightflow--result" data-visual-theme="service-desk" data-ux-density="touch">
        <header className="career-plan-lightflow__header">
          <KioskPageHeader
            title="职业规划建议"
            description={`依据：本人简历${plan.basedOn?.jobFit ? ` + 岗位匹配参考（${plan.basedOn.jobFit}）` : ''}${plan.basedOn?.interview ? ` + 模拟面试表现（${plan.basedOn.interview}）` : ''}`}
            onBack={() => navigate('/')}
            backLabel="返回首页"
          />
        </header>

        <div className="career-plan-lightflow__content" aria-label="职业规划结果">
          <section className="career-plan-lightflow__summary-card" aria-labelledby="career-plan-summary-title">
            <p className="career-plan-lightflow__eyebrow">已生成的规划</p>
            <h2 id="career-plan-summary-title">先看结论，再安排下一步</h2>
            {/* 全页恰好一次的 AIGC 可见标识（interface-handoff.md §3）。 */}
            <div className="career-plan-lightflow__meta-chips">
              <AigcMark />
              {/*
                原为硬编码「已存入 AI服务记录」，不校验任何返回字段。
                后端确实 upsert 了 AiResumeResult(kind='career_plan')，但匿名用户那行
                endUserId 为 null，而「我的 AI 记录」按 endUserId 过滤 —— 匿名场景下
                该文案为假（CLAUDE.md §9 不伪造能力）。改为按真实登录态区分。
              */}
              {getToken() ? (
                <span className="career-plan-lightflow__chip">已存入 AI服务记录</span>
              ) : (
                <span className="career-plan-lightflow__chip">未登录 · 本次结果不进入「我的」记录，可先打印带走</span>
              )}
            </div>
            <AiConclusion text={plan.summary ?? ''} />
          </section>
          <ComplianceBanner tone="info">
            本机不预测前景、不预测薪资、不说「三年后你能到什么岗」—— 那些本机没有依据。
            本机不代收简历、不代为投递；是否转方向、是否考证，由你自己决定。
          </ComplianceBanner>

          <Section title="现状画像" Icon={CompassIcon}>
            <AiDisclaimerLine>下面每条结论都是 AI 从你的简历正文读出来的，右侧原文是你自己写的那句话。</AiDisclaimerLine>
            <div className="career-plan-lightflow__stack">
              {(plan.currentSnapshot ?? []).map((item) => (
                <div key={item.point} className="career-plan-lightflow__evidence">
                  <p><EvidenceBadge level="E3" />{item.point}</p>
                  <span><EvidenceBadge level="E1" compact />简历原文：{item.evidence}</span>
                </div>
              ))}
            </div>
          </Section>

          <Section title="发展方向" Icon={TargetIcon}>
            <div className="career-plan-lightflow__stack">
              {(plan.directions ?? []).map((direction, index) => (
                <div key={direction.title} className="career-plan-lightflow__direction">
                  <span aria-hidden="true">{index + 1}</span>
                  <div>
                    <h3><EvidenceBadge level="E3" />{direction.title}</h3>
                    <p>为什么适合：{direction.why}</p>
                    <p><strong>第一步：</strong>{direction.firstStep}</p>
                  </div>
                </div>
              ))}
            </div>
            <p className="career-plan-lightflow__muted">不是建议你转，是列出来供你自己判断。</p>
          </Section>

          <Section title="技能提升计划" Icon={PencilLineIcon}>
            <div className="career-plan-lightflow__stack">
              {(plan.skillPlan ?? []).map((item) => (
                <div key={item.skill} className="career-plan-lightflow__skill">
                  <span>{item.timeframe}</span>
                  <div><h3><EvidenceBadge level="E3" />{item.skill}</h3><p>{item.action}</p></div>
                </div>
              ))}
            </div>
          </Section>

          <Section title="近期行动清单" Icon={ArrowRightIcon}>
            <ol className="career-plan-lightflow__checklist">
              {(plan.actionChecklist ?? []).map((item) => <li key={item}>{item}</li>)}
            </ol>
          </Section>

          {/*
            已生成的规划是**已落库的成品**，不是正在跑的 AI 任务：AI 现在挂了也不该
            让它从屏幕上消失（否则打印这条非 AI 能力跟着一起没了）。所以本区域只治理
            「再生成一次」这个 AI 任务面，规划正文渲染在它之外。
          */}
          <AiTaskRegion task={aiTask} label="重新生成职业规划" running={runningBlock} fallback={fallback}>
            <p className="career-plan-lightflow__muted">这份规划已经生成并存好，打印不依赖 AI；简历更新之后可以回来重新生成一次。</p>
          </AiTaskRegion>

          <Section title="继续下一步" Icon={CompassIcon}>
            <div className="career-plan-lightflow__next-actions">
              <Button variant="secondary" onClick={() => navigate('/resume/optimize', { state: { taskId, accessToken } })}><PencilLineIcon aria-hidden="true" />优化简历</Button>
              <Button variant="secondary" onClick={() => navigate('/resume/job-fit', { state: { taskId, accessToken } })}><TargetIcon aria-hidden="true" />岗位匹配</Button>
              <Button variant="secondary" onClick={() => navigate('/interview/setup')}><MicIcon aria-hidden="true" />模拟面试</Button>
              <Button variant="secondary" onClick={goSelfAssessment}>做一次自我探索</Button>
            </div>
          </Section>

          <EvidenceLegend />

          {error && <p className="career-plan-lightflow__alert" role="alert">{error}</p>}
        </div>

        <KioskActionBar className="career-plan-lightflow__action-bar">
          {/*
            打印不依赖 AI，AI 挂了也保持可用（interface-handoff §5 待裁决第 1 条的建议裁定）。
            置灰一律 aria-disabled：原生 disabled 会退出 Tab 序列、读屏跳过，
            触屏没有 hover，用户读不到为什么点不动。
          */}
          <Button size="lg" className="career-plan-lightflow__print-action" aria-disabled={printing} onClick={() => void handlePrint()}>
            {printing ? <Loader2Icon className="career-plan-lightflow__button-spinner" aria-hidden="true" /> : <PrinterIcon aria-hidden="true" />}
            {printing ? '正在生成建议单…' : '打印建议单'}
          </Button>
          {aiTask.canStart || aiTask.isRunning ? (
            <Button size="lg" variant="secondary" className="career-plan-lightflow__secondary-action" aria-disabled={generating} onClick={() => void handleGenerate()}>
              {generating ? <Loader2Icon className="career-plan-lightflow__button-spinner" aria-hidden="true" /> : null}
              {generating ? '正在重新生成…' : '重新生成'}
            </Button>
          ) : null}
        </KioskActionBar>
      </main></CareerPlanFullscreenFrame>
    )
  }

  return (
    <CareerPlanFullscreenFrame>
    <main data-kiosk-domain="resume" data-kiosk-screen="resume-career-plan" className="service-desk career-plan-lightflow career-plan-lightflow--guide" data-visual-theme="service-desk" data-ux-density="touch">
      <header className="career-plan-lightflow__header">
        <KioskPageHeader
          title="职业规划建议"
          description="基于你的真实简历，生成发展方向与行动计划"
          onBack={() => navigate('/')}
          backLabel="返回首页"
        />
      </header>

      <div className="career-plan-lightflow__content">
        <ComplianceBanner tone="info">
          本机不预测前景、不预测薪资、不说「三年后你能到什么岗」—— 那些本机没有依据。
          本建议仅供本人职业发展参考，不构成任何就业、薪资或录用承诺。
        </ComplianceBanner>

        <AiTaskRegion
          task={aiTask}
          label="AI 生成职业规划"
          running={runningBlock}
          fallback={fallback}
          idle={(
            <section className="career-plan-lightflow__summary-card" aria-labelledby="career-plan-guide-title">
              <span className="career-plan-lightflow__state-icon" aria-hidden="true"><CompassIcon /></span>
              <p className="career-plan-lightflow__eyebrow">生成前说明</p>
              <h1 id="career-plan-guide-title">把简历经历变成可执行的下一步</h1>
              <ul className="career-plan-lightflow__guide-list">
                <li>现状画像：每条结论附简历原文依据，不编造经历。</li>
                <li>发展方向：提供 1–3 个建议及可开始的第一步。</li>
                <li>提升计划：按阶段整理技能和近期行动清单。</li>
              </ul>
              <AiDisclaimerLine>方向、缺口和行动清单都由 AI 判断，仅供参考；硬门槛（证书等）与「简历漏写」会分开写，不混成一句「你不行」。</AiDisclaimerLine>
              <p className="career-plan-lightflow__muted">岗位匹配或模拟面试已完成时，会在真实数据可用的范围内帮助建议更具体；没有也能直接生成。</p>
            </section>
          )}
        />

        {/*
          22-career-plan.html:437-455 的 ai-down 支线：AI 挂了也有三件事是用户自己能做的。
          它**不是**职业规划的等价替代（原型自己写着「通用建议，不是针对你这份简历的」），
          所以放在降级卡之外单独成节，不冒充 manual 降级路径。
        */}
        {aiTask.isFailed && (
          <Section title="不靠 AI 也能自己看的三件事" Icon={PencilLineIcon}>
            <ol className="career-plan-lightflow__checklist">
              <li>技能栏里没有事例撑着的词，先删掉 ——「团队协作」「项目管理」这类，正文里找不到对应的事就是虚的。这个判断不用 AI，你自己对着简历看一遍就知道。</li>
              <li>每段经历问自己一句「结果是什么」—— 写了做什么、没写做成什么，是最常见的一处。有数字写数字，没数字写变化。</li>
              <li>会做但简历里没写的，去简历工作台补上 —— 本机读不到的能力不是你不会，是简历没写。</li>
            </ol>
            <p className="career-plan-lightflow__muted">这三条是通用建议，不是针对你这份简历的 —— 本机现在读不到它。AI 恢复后再来，能给出按你原文逐条对应的版本。</p>
          </Section>
        )}

        {error && <p className="career-plan-lightflow__alert" role="alert">{error}</p>}
      </div>

      {(aiTask.canStart || aiTask.isRunning) && (
        <KioskActionBar className="career-plan-lightflow__action-bar">
          <Button size="lg" className="career-plan-lightflow__primary-action" aria-disabled={generating} onClick={() => void handleGenerate()} aria-live="polite">
            {generating ? <><Loader2Icon className="career-plan-lightflow__button-spinner" aria-hidden="true" />正在生成（约 15–30 秒）…</> : <>生成职业规划建议<ArrowRightIcon aria-hidden="true" /></>}
          </Button>
        </KioskActionBar>
      )}
    </main>
    </CareerPlanFullscreenFrame>
  )
}
