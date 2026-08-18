// ============================================================
// P09B 简历逐条优化 · 原文与候选改写对照（S2-1 拆页）。
//
// 拆页依据（`ai-capability-wiring-matrix-2026-08-16.md` §3.3）：
//   职责 —— 只做一件事：逐条看原句 vs 候选，决定这条改不改。
//   入口 —— `/resume/optimize` 的「逐条看完整对照」。
//   返回 —— 回 `/resume/optimize`（本次选择随页面卸载失效，见下）。
//   判据 —— 一屏只做一个决定，而不是同屏既看评分又比原文又点采纳。
// 设计基线：`docs/design/kiosk-ai-os-v3-2026-08/09b-resume-optimize.html`。
//
// ⚠️ 本页与原型的三处**有意收窄**，全部因为后端没有对应数据／端点，
//    照原型做就是伪造能力（CLAUDE.md §9）：
//
//   1. 原型有「理由」列。`ResumeOptimizeModule` 只有 `{title, before, after}`，
//      **没有 reason 字段** → 不做该列，也不自己编一句理由。
//   2. 原型有「换一版」（同一句再出一个候选）。**没有单条重生成端点** → 不做该按钮。
//      留一个点不动的按钮比没有这个按钮更糟。
//   3. 原型给出「采纳 N 处」的计数并生成 `个人简历_v2.pdf`。**没有采纳落库端点** →
//      本页的采用/保留是**纯客户端选择**，必须显式写明未保存，
//      且不得出现任何暗示已落库的完成态计数或产物名。
//
// 真正的改写落地路径仍在 `/resume/optimize` 的 `OptimizedResumeEditor`（那里改的是
// 会被导出的 `optimizedResume`），本页只帮用户「读懂并决定」，不冒充保存。
// ============================================================

import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import ReactDiffViewer from 'react-diff-viewer-continued'
import { Button, Card, KioskPageFrame, KioskPageHeader } from '@ai-job-print/ui'
import { AlertCircleIcon, FlaskConicalIcon, InfoIcon, Loader2Icon } from 'lucide-react'
import { COMPLIANCE_COPY, type ResumeOptimizeModule } from '@ai-job-print/shared'
import {
  AiDisclaimerLine,
  AigcMark,
  AiTaskRegion,
  EvidenceBadge,
  EvidenceLegend,
  aiErrorMessageOf,
  deriveAiAvailability,
  isAiOutage,
  useAiTask,
  type AiTaskFallback,
} from '../../ai'
import { getResumeOptimize } from '../../services/api'
import { useAuth } from '../../auth/useAuth'
import { readAiResumeSession } from './aiResumeSession'
import './resume-authoring-lightflow.css'
import './resume-fusion-youth.css'
import './resume-optimize-compare.css'

/** 用户对某一条的处置。只活在本页内存里，刷新或离开即回到 `undecided`。 */
type ModuleDecision = 'undecided' | 'adopt' | 'keep'

const OPTIMIZE_ROUTE = '/resume/optimize'

/**
 * 本页最重要的一句话：选择不落库。
 *
 * 产品负责人 2026-08-17 明确要求 —— 不许出现暗示已保存的完成态计数文案，
 * 也不许造 `个人简历_v2.pdf` 这种不存在的产物。所以这句提示是**常驻**的，
 * 不是点了才弹，用户在做第一个决定之前就该读到。
 */
const UNSAVED_NOTICE =
  '本次选择只用于帮你逐条读懂建议，未保存 —— 离开本页即失效，也不会生成新的简历文件。真正要改进简历，回上一页在「优化版简历」编辑区改，那里的内容才会进入导出。'

export function ResumeOptimizeComparePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { getToken } = useAuth()
  const state = location.state as Record<string, unknown> | null

  const session = useMemo(() => readAiResumeSession(), [])
  const queryTaskId = useMemo(
    () => new URLSearchParams(location.search).get('taskId') ?? undefined,
    [location.search],
  )
  const stateTaskId = typeof state?.taskId === 'string' ? state.taskId : undefined
  const taskId = stateTaskId ?? queryTaskId ?? session?.taskId
  const usingSessionTask = !stateTaskId && !queryTaskId && Boolean(session?.taskId)
  const accessToken =
    (typeof state?.accessToken === 'string' ? state.accessToken : undefined) ??
    (usingSessionTask ? session?.accessToken : undefined)

  const [modules, setModules] = useState<ResumeOptimizeModule[]>([])
  const [loading, setLoading] = useState(Boolean(taskId))
  const [aiOutage, setAiOutage] = useState<string | null>(null)
  const [probed, setProbed] = useState(false)
  const [failReason, setFailReason] = useState<string | null>(null)
  const [decisions, setDecisions] = useState<Record<number, ModuleDecision>>({})
  /**
   * 本次结果是不是演示 provider 出的。
   *
   * 走查结论：本页是整条链上**唯一没有演示提示的页面** —— 报告页有横幅、
   * 优化页有横幅，偏偏这个把话塞进用户嘴里的页面没有。演示模式下 mock 适配器
   * 现在已改为抛 MOCK_MODE（本页会走降级态，根本走不到这里），但服务端仍可能
   * 以 `AI_PROVIDER=mock` 返回 `providerName:'mock'`。那条路径必须同样兜住。
   */
  const [providerName, setProviderName] = useState<string | null>(null)
  const isDemoResult = providerName === 'mock'

  useEffect(() => {
    if (!taskId) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    getResumeOptimize(taskId, { token: getToken(), accessToken })
      .then((res) => {
        if (cancelled) return
        // 拿到结构化响应即证明这条能力是通的，无论本次有没有内容。
        setProbed(true)
        setProviderName(res.providerName ?? null)
        if (res.status === 'completed') {
          setModules(res.modules ?? [])
          if ((res.modules ?? []).length === 0) {
            setFailReason('这次没有生成逐条改写候选。')
          }
        } else {
          setFailReason(res.failReason || '这次没有生成逐条改写候选。')
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return
        if (isAiOutage(err)) {
          setAiOutage(aiErrorMessageOf(err, 'AI 服务当前不可用'))
          return
        }
        // 其余错误只是本次读取失败，不足以判定能力不可用 —— 保留重试入口。
        setProbed(true)
        setFailReason(aiErrorMessageOf(err, '优化结果读取失败'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [taskId, accessToken, getToken])

  const availability = deriveAiAvailability({ outage: aiOutage, probed })

  const task = useAiTask({
    availability,
    pending: loading,
    failed: Boolean(failReason),
    hasResult: modules.length > 0,
  })

  const backToOptimize = () =>
    navigate(OPTIMIZE_ROUTE, { state: taskId ? { taskId, accessToken } : undefined })

  /**
   * 本页只用得上两类降级，且是刻意的：
   *
   *  blocked            AI 是逐条候选的唯一产出源，且本页存在「重新读取」入口 → 置灰 + 写清原因。
   *  result-unavailable 服务通了但这次没出候选 → 结果区诚实说这次没有，入口保留。
   *  manual             **不用**。没有「用户自己一步步也能得到同一份 AI 候选改写」的路径；
   *                     套 manual 等于伪造一条等价手动路径。用户自己写简历当然可以，
   *                     但那是「回编辑器自己改」，已经写在下方常驻提示里，不冒充降级替代品。
   */
  const fallback: AiTaskFallback = aiOutage
    ? {
        mode: 'blocked',
        reason: `${aiOutage} —— 逐条改写候选由 AI 生成，这次生成不了。`,
        blockedActionLabel: '重新读取改写候选',
        stillAvailable:
          '你上传的简历原文照常可看、可打印；上一页的「优化版简历」编辑区也照常能改，改完照常能导出。AI 挂掉不影响你自己动手改。',
        action: { label: '回优化页自己改', onClick: backToOptimize },
      }
    : {
        mode: 'result-unavailable',
        reason: failReason
          ? `本次没有可对照的改写候选：${failReason}`
          : '本次没有可对照的改写候选。',
        retryHint:
          '这不是你的操作问题。可以回上一页重新读取一次；若连续几次都这样，通常是这份简历的原文片段不足以给出有依据的改写建议，可以先补充经历再来。',
        action: { label: '返回优化页', onClick: backToOptimize },
      }

  /**
   * 左栏的归属说法与证据级别（R2 的正题）。
   *
   * `E1 你的材料` + 「你写的（原件不会被改）」是一句**关于用户的事实断言**：
   * 它宣称左栏那段文字出自用户上传的原件。演示 provider 给的是写死的样例句
   * （走查里那句「热爱工作，积极向上……」用户根本没写过），此时这个断言是假的，
   * 而且是全链最伤的一处 —— 前面所有诚实的免责声明，在这一句面前一起失效。
   *
   * 所以演示态下把证据级别降到 E3（AI 判断 / 仅供参考），归属改成不作归属的说法。
   * 真实结果照旧 E1「你写的」，不削弱正常路径的证据表达。
   */
  const leftEvidenceLevel = isDemoResult ? 'E3' : 'E1'
  const leftColumnLabel = isDemoResult
    ? '示例原句（演示内容，不是你的简历原文）'
    : '你写的（原件不会被改）'

  const setDecision = (idx: number, decision: ModuleDecision) =>
    setDecisions((prev) => ({
      ...prev,
      [idx]: prev[idx] === decision ? 'undecided' : decision,
    }))

  const adoptCount = Object.values(decisions).filter((d) => d === 'adopt').length
  const keepCount = Object.values(decisions).filter((d) => d === 'keep').length
  const undecidedCount = modules.length - adoptCount - keepCount

  if (!taskId) {
    return (
      <KioskPageFrame className="fusion-w3 fusion-w3--resume">
        <section
          data-kiosk-domain="resume"
          data-kiosk-screen="resume-optimize-compare"
          className="resume-lightflow resume-compare-lightflow flex h-full flex-col items-center justify-center gap-4 p-6"
        >
          <div className="resume-compare__state-card" role="alert">
            <AlertCircleIcon className="h-10 w-10 text-primary-600" aria-hidden="true" />
            <p className="text-base text-neutral-500">
              请先完成简历上传与解析，再看逐条改写对照
            </p>
            <Button
              size="lg"
              className="resume-compare__primary-action"
              onClick={() => navigate('/resume/source?intent=optimize')}
            >
              去上传简历
            </Button>
          </div>
        </section>
      </KioskPageFrame>
    )
  }

  return (
    <KioskPageFrame className="fusion-w3 fusion-w3--resume">
      <section
        data-kiosk-domain="resume"
        data-kiosk-screen="resume-optimize-compare"
        className="resume-lightflow resume-compare-lightflow flex h-full flex-col p-6"
      >
        <div className="resume-lightflow__header">
          <KioskPageHeader
            title="逐条改写对照"
            /* 标题描述同样是一句归属断言：演示态下左栏不是用户写的，不能这么说。 */
            description={
              isDemoResult
                ? '左边是演示用的示例原句（不是你的简历原文），右边是 AI 给的候选表达。'
                : '左边是你自己写的那句，右边是 AI 给的候选表达。一条一条看，决定这条改不改。'
            }
            onBack={backToOptimize}
            backLabel="返回优化页"
          />
        </div>

        {/* 常驻、不可关闭：用户做第一个决定之前就必须读到「这不保存」。 */}
        <div className="resume-compare__unsaved" role="note">
          <InfoIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
          <p>{UNSAVED_NOTICE}</p>
        </div>

        {/*
          演示提示横幅（R2）。本页此前是全链唯一没有它的页面 ——
          而它恰恰是唯一一个把左栏内容标成「你写的」的页面。
          报告页 / 优化页都有同一句 COMPLIANCE_COPY.KIOSK_RESUME_DEMO_NOTICE。
        */}
        {isDemoResult && (
          <div className="resume-compare__demo-notice" role="note">
            <FlaskConicalIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <p>{COMPLIANCE_COPY.KIOSK_RESUME_DEMO_NOTICE}</p>
          </div>
        )}

        <AiTaskRegion
          task={task}
          label="AI 逐条改写候选"
          className="resume-compare__region mt-4 flex-1 overflow-y-auto"
          running={
            <div className="resume-compare__state-card" role="status" aria-live="polite">
              <Loader2Icon
                className="h-10 w-10 animate-spin text-primary-600"
                aria-hidden="true"
                data-ai-progress="spinner"
              />
              <p className="text-base text-neutral-500">正在读取逐条改写候选…</p>
            </div>
          }
          /*
            为什么 idle 槽要分两种写法：
            `deriveAiTaskState` 对 `availability: 'unknown'` 一律返回 idle（fail-closed，
            服务状态没探到就不许渲染成「在算」），而首次往返完成前 availability 恒为 unknown。
            于是「正在读取」和「探测无结论」会落进同一个槽。两句话必须分开 ——
            读取中却写「还没有确认 AI 服务状态」，等于把一次正常加载说成故障。
          */
          idle={
            loading ? (
              <div className="resume-compare__state-card" role="status" aria-live="polite">
                <Loader2Icon
                  className="h-10 w-10 animate-spin text-primary-600"
                  aria-hidden="true"
                />
                <p className="text-base text-neutral-500">正在读取逐条改写候选…</p>
              </div>
            ) : (
              <div className="resume-compare__state-card" role="status">
                <p className="text-base text-neutral-500">
                  还没有确认 AI 服务状态，本页暂不展示改写候选 —— 状态不明时不假装能算。
                </p>
                <Button size="lg" className="resume-compare__primary-action" onClick={backToOptimize}>
                  返回优化页
                </Button>
              </div>
            )
          }
          fallback={fallback}
        >
          <AiDisclaimerLine>
            以下候选改写由 AI 生成，只重组你原文里已有的事实，不补充你没写过的经历、学历或成果。
          </AiDisclaimerLine>

          <Card className="resume-compare__summary p-5">
            <p className="resume-compare__summary-count">{modules.length} 组可对照修改项</p>
            <p className="resume-compare__summary-hint">
              本次已选「采用候选」{adoptCount} 处、「保留原文」{keepCount} 处、待你决定{' '}
              {undecidedCount} 处。以上仅是本页的阅读标记，未保存。
            </p>
          </Card>

          <ol className="resume-compare__list">
            {modules.map((mod, idx) => {
              const decision = decisions[idx] ?? 'undecided'
              return (
                <li key={`${mod.title}-${idx}`}>
                  <Card
                    className="resume-compare__item"
                    data-decision={decision}
                  >
                    <div className="resume-compare__item-head">
                      <span className="resume-compare__item-no">第 {idx + 1} 条</span>
                      <p className="resume-compare__item-title">{mod.title}</p>
                    </div>

                    <div className="resume-compare__cols">
                      <div className="resume-compare__col">
                        <p className="resume-compare__col-head">
                          <EvidenceBadge level={leftEvidenceLevel} />
                          {leftColumnLabel}
                        </p>
                        <p className="resume-compare__col-body">{mod.before}</p>
                      </div>
                      <div className="resume-compare__col">
                        <p className="resume-compare__col-head">
                          <EvidenceBadge level="E3" />
                          候选改写
                        </p>
                        <p className="resume-compare__col-body">{mod.after}</p>
                      </div>
                    </div>

                    <details className="resume-compare__diff">
                      <summary>逐字看差异</summary>
                      <div className="resume-compare__diff-body text-xs [overflow-wrap:anywhere] [&_pre]:whitespace-pre-wrap">
                        <ReactDiffViewer
                          oldValue={mod.before}
                          newValue={mod.after}
                          splitView={false}
                          disableWordDiff={false}
                          hideLineNumbers
                          leftTitle="优化前(摘自原文)"
                          rightTitle="建议参考"
                          useDarkTheme={false}
                        />
                      </div>
                    </details>

                    <div className="resume-compare__actions">
                      <button
                        type="button"
                        className="resume-compare__decision"
                        aria-pressed={decision === 'adopt'}
                        onClick={() => setDecision(idx, 'adopt')}
                      >
                        采用候选
                      </button>
                      <button
                        type="button"
                        className="resume-compare__decision"
                        aria-pressed={decision === 'keep'}
                        onClick={() => setDecision(idx, 'keep')}
                      >
                        保留原文
                      </button>
                    </div>
                  </Card>
                </li>
              )
            })}
          </ol>

          <EvidenceLegend className="resume-compare__legend" />
          <AigcMark className="resume-compare__aigc" />
        </AiTaskRegion>

        <div className="resume-compare__footer">
          <Button size="lg" className="resume-compare__primary-action" onClick={backToOptimize}>
            回优化页改简历
          </Button>
        </div>
      </section>
    </KioskPageFrame>
  )
}
