// ============================================================
// 自我探索 · 倾向参考 —— 测评流程（v1）
//
// 合规（与 CLAUDE.md §11 / 18 / docs/compliance/compliance-boundary.md §4.5 同档）：
// - 工具性质说明：非临床 / 非诊断 / 本人自助参考；不沿用 MBTI / 大五 / DISC / 霍兰德标签
// - 答案原文不入库：仅存 SHA-256(answers JSON)
// - 不向企业 / 合作机构 / Partner / Admin 推送结果
// - 闲置 60 秒自动退出（公共一体机）
// - 同意 / 撤回 / 删除只在结果页主行动区显式操作
// - 闲置恢复：写 sessionStorage 让回到页面时能恢复进度
//
// ── S2-7 接线（接线矩阵 §四 S2-7 / §2.2 P28 行）─────────────────────────────
// 本页的分工在接线时必须一直成立，它是「AI 是加速器不是前置条件」的落点：
//   记分（strength + 依据题号）= 固定权重纯函数（服务端 `self-assessment-scoring.ts`
//     不读库、不写日志、不调 LLM）⇒ 标 E1/E2，**AI 挂了也照常出**；
//   解读（summary + 每维 note）= 唯一由 LLM 产出的东西 ⇒ 标 E3，AI 挂了如实缺。
// 所以只有「解读区」被 AiTaskRegion 包住，记分区永远在外面直接渲染。
// ============================================================

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Button, Card, ComplianceBanner, KioskPageFrame, KioskPageHeader } from '@ai-job-print/ui'
import type {
  SelfAssessmentDimensionKey,
  SelfAssessmentDimensionResult,
  SelfAssessmentSubmitResponse,
} from '@ai-job-print/shared'
import { SELF_ASSESSMENT_DIMENSIONS, makePrintParams } from '@ai-job-print/shared'
import {
  ArrowRightIcon,
  ChevronLeftIcon,
  DownloadIcon,
  FileWarningIcon,
  PrinterIcon,
  ShieldCheckIcon,
  Trash2Icon,
} from 'lucide-react'
import {
  AiCapabilityChip,
  AiConclusion,
  AiTaskRegion,
  AigcMark,
  EvidenceBadge,
  useAiTask,
  type AiAvailability,
  type AiTaskFallback,
} from '../../ai'
import {
  SelfAssessmentApiError,
  getLatestSelfAssessment,
  printSelfAssessment,
  submitSelfAssessment,
  withdrawSelfAssessment,
} from '../../services/api/selfAssessment'
import {
  CONSENT_ITEMS,
  IDLE_TIMEOUT_MS,
  SELF_ASSESSMENT_CONSENT_VERSION,
  SENSITIVE_QUESTIONS,
  clearSession,
  flattenAnswers,
  formatBytes,
  formatDateTime,
  hasCurrentConsent,
  loadSession,
  progress,
  questionsFor,
  saveSession,
  type SelfAssessmentSession,
} from './selfAssessmentSession'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { FilePreviewDialog } from '../../components/FilePreviewDialog'
import { KioskFullscreenShell } from '../../components/kiosk-shell/KioskFullscreenShell'
import './self-assessment-lightflow.css'

/**
 * 顶级路由的全屏壳 + PageFrame 组合，使 <main> 出现在 KioskFullscreenShell 内
 * （不在 KioskLayout 的 <main> 里嵌套），同时携带 kiosk-shell 主题属性。
 */
function SelfAssessmentFullscreenFrame({ children }: { children: ReactNode }) {
  return (
    <KioskFullscreenShell>
      <KioskPageFrame className="self-assessment-shell">{children}</KioskPageFrame>
    </KioskFullscreenShell>
  )
}

/**
 * 置灰但仍可读到原因的动作按钮。用 `aria-disabled` 而不是原生 `disabled` ——
 * 原生 disabled 会把按钮踢出 Tab 序列、读屏直接跳过，用户永远读不到「为什么灰」
 * （与 `ai/AiTaskRegion.tsx` 同一口径，`verify:ai-artifact-print-url-contract` 守着）。
 */
function GuardedButton({
  blockedReason,
  onClick,
  children,
  ...rest
}: {
  blockedReason: string | null
  onClick: () => void
  children: ReactNode
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline'
  size?: 'sm' | 'md' | 'lg'
}) {
  const blocked = Boolean(blockedReason)
  return (
    <span className="self-assessment-lightflow__guarded">
      <Button
        {...rest}
        aria-disabled={blocked || undefined}
        onClick={() => { if (!blocked) onClick() }}
      >
        {children}
      </Button>
      {blockedReason ? (
        <span className="self-assessment-lightflow__blocked-reason">{blockedReason}</span>
      ) : null}
    </span>
  )
}

// ============================================================
// 1) 同意页
// ============================================================
export function SelfAssessmentIntroPage() {
  const navigate = useNavigate()
  const session = useMemo(() => loadSession(), [])
  const [consent, setConsent] = useState(
    session.consentVersion === SELF_ASSESSMENT_CONSENT_VERSION
      ? session.consent
      : { nonSensitive: false, sensitive: false },
  )
  const start = useCallback(() => {
    if (!consent.nonSensitive) return
    const next: SelfAssessmentSession = {
      ...session,
      consent,
      consentVersion: SELF_ASSESSMENT_CONSENT_VERSION,
      consentedAt: new Date().toISOString(),
      answers: {},
    }
    saveSession(next)
    navigate('/resume/self-assessment/questions')
  }, [consent, navigate, session])
  return (
    <SelfAssessmentFullscreenFrame>
      <main data-kiosk-screen="resume-self-assessment-intro" data-kiosk-domain="resume" className="self-assessment-lightflow self-assessment-lightflow--intro flex h-full flex-col">
      <KioskPageHeader title="自我探索 · 倾向参考" description="非临床 · 本人自助参考" />
      <div className="self-assessment-lightflow__content">
        <ComplianceBanner tone="info" title="工具性质说明">
          <ol>
            {CONSENT_ITEMS.map((item) => <li key={item}>{item}</li>)}
          </ol>
        </ComplianceBanner>
        <Card className="self-assessment-lightflow__ai-note">
          <p className="self-assessment-lightflow__ai-note-head">
            <AiCapabilityChip tone="ai" />
            <span>这一页里，哪部分是 AI</span>
          </p>
          <ul>
            <li>
              <EvidenceBadge level="E2" compact /> 5 个维度的<b>强度</b>与<b>依据题号</b>由固定权重算出，
              全程不经过 AI —— AI 不可用时照样出。
            </li>
            <li>
              <EvidenceBadge level="E3" /> 5 段<b>陈述式解读</b>由 AI 写。它不打分、不排名，
              也不说你适合或不适合哪类岗位；AI 不可用时这几段会如实缺，不会拿别的东西顶上。
            </li>
          </ul>
        </Card>
        <Card className="self-assessment-lightflow__consent">
          <p className="self-assessment-lightflow__consent-version">
            你现在勾选的是<b>上面这 {CONSENT_ITEMS.length} 条</b>，同意版本 {SELF_ASSESSMENT_CONSENT_VERSION}。
            说明改动会提高版本号，届时会请你重新确认一次。
          </p>
          <label>
            <input
              type="checkbox"
              checked={consent.nonSensitive}
              onChange={(e) => setConsent({ ...consent, nonSensitive: e.target.checked })}
            />
            <span>我已了解上述说明，并同意开始作答（必勾选）</span>
          </label>
          <label>
            <input
              type="checkbox"
              checked={consent.sensitive}
              onChange={(e) => setConsent({ ...consent, sensitive: e.target.checked })}
            />
            <span>
              同意作答涉及偏好 / 风格的敏感题（可选）
              <small>
                {SENSITIVE_QUESTIONS.length > 0
                  ? `不勾会跳过其中 ${SENSITIVE_QUESTIONS.length} 题，进度总数相应减少。`
                  : '当前题库（v1）没有标记为敏感的题目，勾不勾都不会改变题目；此项只记录你的意愿。'}
              </small>
            </span>
          </label>
        </Card>
        <div className="self-assessment-lightflow__actions">
          <Button onClick={() => navigate(-1)} variant="ghost">返回</Button>
          <GuardedButton
            blockedReason={consent.nonSensitive ? null : '需先勾选第一项同意才能开始作答'}
            onClick={start}
          >
            开始作答 <ArrowRightIcon />
          </GuardedButton>
        </div>
      </div>
      </main>
    </SelfAssessmentFullscreenFrame>
  )
}

// ============================================================
// 2) 答题页
// ============================================================
export function SelfAssessmentQuizPage() {
  const navigate = useNavigate()
  const session = useMemo(() => loadSession(), [])
  const consentOk = hasCurrentConsent(session)
  const questions = useMemo(() => questionsFor(session.consent.sensitive === true), [session.consent.sensitive])
  const [answers, setAnswers] = useState<Partial<Record<SelfAssessmentDimensionKey, Record<number, string>>>>(session.answers)
  const [cursor, setCursor] = useState<{ dim: SelfAssessmentDimensionKey; idx: number }>(() => {
    const d = questions.dimensions[0]
    return { dim: d.key, idx: d.questions[0].idx }
  })
  const idleTimer = useRef<number | null>(null)

  useEffect(() => { if (consentOk) saveSession({ ...session, answers }) }, [answers, consentOk, session])

  // 闲置 60 秒自动退出
  const resetIdle = useCallback(() => {
    if (idleTimer.current) window.clearTimeout(idleTimer.current)
    idleTimer.current = window.setTimeout(() => {
      clearSession()
      navigate('/')
    }, IDLE_TIMEOUT_MS)
  }, [navigate])
  useEffect(() => {
    resetIdle()
    const onTick = () => resetIdle()
    window.addEventListener('pointerdown', onTick)
    window.addEventListener('keydown', onTick)
    return () => {
      if (idleTimer.current) window.clearTimeout(idleTimer.current)
      window.removeEventListener('pointerdown', onTick)
      window.removeEventListener('keydown', onTick)
    }
  }, [resetIdle])

  const { done, total } = progress(questions, answers)
  const dim = SELF_ASSESSMENT_DIMENSIONS.find((d) => d.key === cursor.dim)
  const dimDef = questions.dimensions.find((d) => d.key === cursor.dim)
  const q = dimDef?.questions.find((qq) => qq.idx === cursor.idx)

  const pick = (choiceKey: string) => {
    setAnswers((prev) => ({
      ...prev,
      [cursor.dim]: { ...(prev[cursor.dim] ?? {}), [cursor.idx]: choiceKey },
    }))
    // 自动前进
    if (!dimDef) return
    const positions = dimDef.questions.map((qq) => qq.idx)
    const here = positions.indexOf(cursor.idx)
    if (here >= 0 && here < positions.length - 1) {
      setCursor({ dim: cursor.dim, idx: positions[here + 1] })
      return
    }
    const dimIndex = questions.dimensions.findIndex((d) => d.key === cursor.dim)
    if (dimIndex >= 0 && dimIndex < questions.dimensions.length - 1) {
      const nextDim = questions.dimensions[dimIndex + 1]
      setCursor({ dim: nextDim.key, idx: nextDim.questions[0].idx })
    }
  }

  /**
   * 交卷 = 存盘 + 换页。**提交请求本身不在这一页发**：`POST` 里同步跑着 LLM 解读，
   * 那段等待是本流程唯一真实的「AI 在算」窗口，必须发生在能把 `data-aitask=running`
   * 画出来的地方（结果页的 AiTaskRegion），而不是一个写死「提交中…」的按钮。
   */
  const handOff = () => {
    // 同意门禁：没有当前版本的显式同意就不往下走 —— 下一步会把作答送去调模型。
    if (!consentOk || done < total) return
    saveSession({ ...session, answers })
    navigate('/resume/self-assessment/result')
  }

  // 同意门禁不通过（深链直达 / 说明已改版）：不渲染题目，也不给提交口。
  if (!consentOk || !dim || !dimDef || !q) {
    return (
      <SelfAssessmentFullscreenFrame>
        <main data-kiosk-screen="resume-self-assessment-quiz" data-kiosk-domain="resume" className="self-assessment-lightflow self-assessment-lightflow--quiz flex h-full flex-col">
        <KioskPageHeader title="自我探索 · 倾向参考" description="需要先确认同意说明" />
        <div className="self-assessment-lightflow__content">
          <ComplianceBanner tone="warning" title="请先确认同意说明">
            {consentOk
              ? '当前题目集为空，请回到同意页重新开始。'
              : `这台机器上还没有记录到你对当前版本（${SELF_ASSESSMENT_CONSENT_VERSION}）说明的同意，或说明已更新。作答会被送去生成 AI 解读，所以必须先看过说明再开始。`}
          </ComplianceBanner>
          <div className="self-assessment-lightflow__actions">
            <Button variant="ghost" onClick={() => navigate(-1)}>返回</Button>
            <Button onClick={() => navigate('/resume/self-assessment/intro')}>去看说明并同意 <ArrowRightIcon /></Button>
          </div>
        </div>
        </main>
      </SelfAssessmentFullscreenFrame>
    )
  }

  return (
    <SelfAssessmentFullscreenFrame>
      <main data-kiosk-screen="resume-self-assessment-quiz" data-kiosk-domain="resume" className="self-assessment-lightflow self-assessment-lightflow--quiz flex h-full flex-col">
      <KioskPageHeader title="自我探索 · 倾向参考" description={`进度 ${done}/${total}`} />
      <div className="self-assessment-lightflow__content">
        <div className="self-assessment-lightflow__progress" aria-hidden="true">
          <span style={{ width: `${Math.round((done / Math.max(1, total)) * 100)}%` }} />
        </div>
        <Card className="self-assessment-lightflow__question">
          <header>
            <span className="self-assessment-lightflow__dim">{dim.label}</span>
            <span className="self-assessment-lightflow__counter">{done + 1}/{total}</span>
          </header>
          <p>{q.prompt}</p>
          <div className="self-assessment-lightflow__choices">
            {q.choices.map((c) => {
              const selected = answers[cursor.dim]?.[cursor.idx] === c.key
              return (
                <button
                  key={c.key}
                  type="button"
                  className={selected ? 'is-selected' : ''}
                  onClick={() => pick(c.key)}
                >
                  {c.label}
                </button>
              )
            })}
          </div>
          <p className="self-assessment-lightflow__quiz-note">
            题目问的都是「你更愿意哪个」，没有对错，也没有陷阱题；这一页不打分、不排名。
          </p>
        </Card>
        <p className="self-assessment-lightflow__ai-hint">
          <AiCapabilityChip tone="ai" />
          <span>
            提交后，维度强度由固定权重当场算出；5 段解读由 AI 写。
            AI 不可用时记分照常，只是这次不会有解读 —— 不会用别的东西顶上。
          </span>
        </p>
        <div className="self-assessment-lightflow__actions">
          <Button
            variant="ghost"
            onClick={() => {
              const positions = dimDef.questions.map((qq) => qq.idx)
              const here = positions.indexOf(cursor.idx)
              if (here > 0) { setCursor({ dim: cursor.dim, idx: positions[here - 1] }); return }
              const dimIndex = questions.dimensions.findIndex((d) => d.key === cursor.dim)
              if (dimIndex > 0) {
                const prevDim = questions.dimensions[dimIndex - 1]
                setCursor({ dim: prevDim.key, idx: prevDim.questions[prevDim.questions.length - 1].idx })
              }
            }}
          ><ChevronLeftIcon /> 上一题</Button>
          <GuardedButton
            blockedReason={done < total ? `还有 ${total - done} 题没答，答完才能提交` : null}
            onClick={handOff}
          >
            提交作答 <ArrowRightIcon />
          </GuardedButton>
        </div>
      </div>
      </main>
    </SelfAssessmentFullscreenFrame>
  )
}

// ============================================================
// 3) 结果页
// ============================================================
export function SelfAssessmentResultPage() {
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const [searchParams] = useSearchParams()
  const [session, setSession] = useState<SelfAssessmentSession>(() => loadSession())
  const linkedTaskId = searchParams.get('taskId')
  /** 请求在飞：`running` 的唯一来源，永远等于「后端已受理且这次调用还没回来」。 */
  const [inflight, setInflight] = useState<'submit' | 'fetch' | null>(null)
  const [taskError, setTaskError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const startedRef = useRef<string | null>(null)
  const mountedRef = useRef(true)
  const [printing, setPrinting] = useState(false)
  const [withdrawing, setWithdrawing] = useState(false)
  const [printed, setPrinted] = useState<{ fileId: string; signedUrl: string; printFileUrl?: string; filename: string; pageCount: number; sizeBytes: number } | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const result = session.result ?? null
  const taskId = session.taskId ?? result?.taskId ?? linkedTaskId
  const consentOk = hasCurrentConsent(session)
  // 依赖必须是稳定引用，否则下面那个 effect 会被反复触发。
  const pendingAnswers = useMemo(() => flattenAnswers(session.answers), [session.answers])
  const pendingComplete = useMemo(() => {
    const { done, total } = progress(questionsFor(session.consent.sensitive === true), session.answers)
    return total > 0 && done >= total
  }, [session.answers, session.consent.sensitive])
  useBusyLock(printing || withdrawing || inflight !== null)

  // StrictMode 会把 effect 演一遍再重来。挂载守卫必须在 effect 体里**重新置真**，
  // 否则演练的那次卸载会把它永久钉死在 false，请求回来时不敢再 setState
  // （与 `pages/resume/components/ResumeUsbImportPanel.tsx` 同一处置）。
  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  /**
   * 本页两件网络事，互斥，都由真实生命周期驱动，没有任何计时器：
   *   submit —— 交卷（服务端在这一次调用里同步跑 LLM 解读）；
   *   fetch  —— 带 `?taskId=` 深链回看时按编号读回（GET /:taskId 的唯一消费点）。
   * 同意门禁在这里再拦一次：`consentOk` 为假一律不发 submit，深链绕不过去。
   * 去重靠 `startedRef`，**不靠 cleanup 里的 active 标志** —— effect 一旦重演，
   * cleanup 作废上一发、去重又拦下第二发，结果是永远停在「正在生成」。
   */
  useEffect(() => {
    if (result) return
    const mode: 'submit' | 'fetch' | null =
      consentOk && pendingComplete ? 'submit' : linkedTaskId ? 'fetch' : null
    if (!mode) return
    const runKey = `${mode}:${linkedTaskId ?? 'session'}:${attempt}`
    if (startedRef.current === runKey) return
    startedRef.current = runKey

    setInflight(mode)
    setTaskError(null)
    const request = mode === 'submit'
      ? submitSelfAssessment(
          { answers: pendingAnswers, consent: { nonSensitive: session.consent.nonSensitive, sensitive: session.consent.sensitive } },
          { token: getToken(), accessToken: session.accessToken },
        )
      : getLatestSelfAssessment(linkedTaskId as string, { token: getToken(), accessToken: session.accessToken })

    void request
      .then((data) => {
        if (!mountedRef.current) return
        setSession((prev) => {
          const next: SelfAssessmentSession = {
            ...prev,
            taskId: data.taskId,
            accessToken: data.accessToken ?? prev.accessToken,
            result: data,
          }
          saveSession(next)
          return next
        })
      })
      .catch((err: unknown) => {
        // 失败必须看得见：不把「没生成出来 / 读不回来」渲染成「生成完了但内容为空」。
        if (mountedRef.current) setTaskError(err instanceof SelfAssessmentApiError ? err.message : mode === 'submit' ? '提交失败，请稍后重试' : '这次结果读取失败，请稍后重试')
      })
      .finally(() => { if (mountedRef.current) setInflight(null) })
  }, [attempt, consentOk, getToken, linkedTaskId, pendingAnswers, pendingComplete, result, session.accessToken, session.consent.nonSensitive, session.consent.sensitive])

  // ── AI 任务四态（S1-1）。取的全是后端真值，前端没有可以自行推进的地方。 ──
  //   unavailable —— 后端明说 LLM 调不通（`llm-self-assessment.service.ts:113-118`）；
  //   available   —— 已拿到本次响应，或本次调用正在飞（尚无不可用的反证）；
  //   unknown     —— 既没发调用也没有响应，fail-closed 停 idle，不画进度。
  // 本项目没有 AI 专用健康探针，`useApiReadiness` 只证明 API 可达，拿它当 AI 可用性
  // 是过度宣称 —— 这里只认「这次调用自己的返回」。
  // failed 还含「解读全空」：不把「没生成出来」画成「生成完了但内容为空」。
  const hasInterpretation = (result?.dimensions.some((d) => Boolean(d.note)) ?? false) || Boolean(result?.summary)
  const aiUnavailable = result?.providerName === 'llm_unavailable'
  const availability: AiAvailability = aiUnavailable ? 'unavailable' : result || inflight ? 'available' : 'unknown'
  const task = useAiTask({
    availability,
    pending: inflight !== null,
    failed: Boolean(taskError) || (Boolean(result) && (result?.status === 'rejected' || !hasInterpretation)),
    hasResult: hasInterpretation,
  })

  if (!result || !taskId) {
    return (
      <SelfAssessmentFullscreenFrame>
        <main data-kiosk-screen="resume-self-assessment-result" data-kiosk-domain="resume" className="self-assessment-lightflow self-assessment-lightflow--result flex h-full flex-col">
        <KioskPageHeader title="自我探索 · 倾向参考" description={inflight ? '正在处理' : '无最近结果'} />
        <div className="self-assessment-lightflow__content">
          <AiTaskRegion
            task={task}
            label="AI 陈述式解读"
            className="self-assessment-lightflow__ai-region"
            fallback={{
              mode: 'result-unavailable',
              reason: taskError ?? '这次没能拿到结果，页面不会用别的东西顶上。',
              retryHint: `${linkedTaskId ? `记录编号 ${linkedTaskId}。` : ''}作答还留在这台机器上，可以直接重试；离开或闲置 60 秒会清空。`,
              action: { label: '重试这一次', onClick: () => { startedRef.current = null; setAttempt((n) => n + 1) } },
            }}
            running={
              <ComplianceBanner tone="info" title={inflight === 'submit' ? '正在生成本次解读' : '正在读取这次结果'}>
                <span data-ai-progress="true">
                  {inflight === 'submit'
                    ? '维度强度由固定权重当场算出，5 段解读由 AI 写 —— 这一步在等服务端的真实返回，页面不设倒计时，也不会自己变成「完成」。'
                    : '正在按记录编号向服务端读回本次结果。'}
                </span>
              </ComplianceBanner>
            }
            idle={
              <ComplianceBanner tone="info" title="暂无最近结果">
                请先完成作答；结果只在本机保留 24 小时，过期会自动清理。
              </ComplianceBanner>
            }
          />
          <div className="self-assessment-lightflow__actions">
            <Button onClick={() => navigate('/resume/self-assessment/intro')}>重新作答</Button>
          </div>
        </div>
        </main>
      </SelfAssessmentFullscreenFrame>
    )
  }

  const handlePrint = async () => {
    setPrinting(true)
    setError(null)
    try {
      const file = await printSelfAssessment(taskId, { token: getToken(), accessToken: session.accessToken })
      setPrinted({
        fileId: file.fileId,
        signedUrl: file.signedUrl,
        printFileUrl: file.printFileUrl,
        filename: file.filename,
        pageCount: file.pageCount,
        sizeBytes: file.sizeBytes,
      })
      setPreviewOpen(true)
    } catch (err) {
      setError(err instanceof SelfAssessmentApiError ? err.message : '打印文件生成失败')
    } finally {
      setPrinting(false)
    }
  }

  /**
   * 交接到打印工作台核价（`interface-handoff.md` §2A：先落地资产、拿到真实文件再开出口）。
   * 只有服务端签出的 `printFileUrl` 能被打印链路认；缺它就置灰并写清原因，不假装能打。
   */
  const handoffToPrint = () => {
    if (!printed?.printFileUrl) return
    navigate('/print/confirm', {
      state: {
        file: {
          name: printed.filename,
          size: formatBytes(printed.sizeBytes),
          pages: printed.pageCount,
          fileId: printed.fileId,
          fileUrl: printed.printFileUrl,
          mimeType: 'application/pdf',
        },
        params: makePrintParams({ copies: 1, duplex: 'single', color: 'bw' }),
      },
    })
  }

  const handleWithdraw = async () => {
    if (!confirm('本次自我探索将被物理删除，结果不可恢复。是否继续？')) return
    setWithdrawing(true)
    setError(null)
    try {
      await withdrawSelfAssessment(taskId, { token: getToken(), accessToken: session.accessToken })
      clearSession()
      navigate('/')
    } catch (err) {
      setError(err instanceof SelfAssessmentApiError ? err.message : '撤回失败')
    } finally {
      setWithdrawing(false)
    }
  }

  // 匿名 + 整体拒答时服务端不签发 accessToken（`self-assessment.service.ts:240-247`），
  // 后续 print / withdraw 必然 403 —— 与其让用户点了才报错，不如当面说清。
  const hasAccess = Boolean(getToken() || session.accessToken)
  const accessReason = hasAccess ? null : '本次未拿到访问凭证（AI 解读整体失败时服务端不签发），无法生成打印件或撤回；记录会在到期后自动清理。'

  const fallback: AiTaskFallback = {
    // AI 是这几段解读的唯一产出源，且没有「点一下重试」的入口 —— 结果区直接说办不到，
    // 不编一条假的手动路径（三种降级里只有 result-unavailable 对得上本页）。
    mode: 'result-unavailable',
    reason: aiUnavailable
      ? 'AI 解读服务当前不可用，这 5 段陈述这次没有生成。前面三步（作答、记分、依据题号）都已完成。'
      : result.failReason
        ?? '本次解读未能生成合规结果，已整体丢弃，不做任何替换或补写。',
    retryHint: '答案原文不留存，服务恢复后也补不回这一次；要拿到解读需要重新作答（约 5 分钟）。下面的维度强度与依据题号不依赖 AI，现在就能看、能打印。',
    action: { label: '重新作答（约 5 分钟）', onClick: () => { clearSession(); navigate('/resume/self-assessment/intro') } },
  }

  const completedAt = formatDateTime(session.consentedAt)
  const expiresAt = formatDateTime(result.expiresAt)

  return (
    <SelfAssessmentFullscreenFrame>
      <main data-kiosk-screen="resume-self-assessment-result" data-kiosk-domain="resume" className="self-assessment-lightflow self-assessment-lightflow--result flex h-full flex-col">
      <KioskPageHeader title="自我探索 · 倾向参考" description="仅供本人参考" />
      <div className="self-assessment-lightflow__content">
        <ComplianceBanner tone="info" title="合规说明">
          本结果基于本人作答的 {result.dimensions.length} 维度倾向，不含临床 / 心理 / 人格诊断；
          不代任何招聘结果、能力证明或心理评估；仅本人可见。
        </ComplianceBanner>

        <Card className="self-assessment-lightflow__meta">
          <dl>
            <div><dt>记录编号</dt><dd className="self-assessment-lightflow__mono">{taskId}</dd></div>
            {completedAt && <div><dt>同意时间</dt><dd>{completedAt}</dd></div>}
            <div><dt>同意版本</dt><dd>{session.consentVersion ?? '本机会话未记录（本次结果由记录编号读回）'}</dd></div>
            <div><dt>保留至</dt><dd>{expiresAt ?? '未返回到期时间（撤回后或整体拒答时无到期）'}</dd></div>
          </dl>
        </Card>

        {/* AI 只负责这一块，它挂了不影响下面的维度强度与依据题号。走到这里 result
            一定在手，四态只可能是 done / failed，running / idle 由上一支负责。 */}
        <AiTaskRegion
          task={task}
          label="AI 陈述式解读"
          className="self-assessment-lightflow__ai-region"
          fallback={fallback}
        >
          <Card className="self-assessment-lightflow__summary">
            <header>
              <ShieldCheckIcon aria-hidden="true" />
              <h2>整体解读</h2>
              <AigcMark />
            </header>
            {result.summary
              ? <AiConclusion text={result.summary} />
              : <p className="self-assessment-lightflow__muted">本次整体解读未生成（受合规要求被拒或未启用）。</p>}
            <footer>
              这几段只描述<b>本次作答</b>，不打分、不排名、不说适合或不适合哪类岗位。隔一段时间再做，答不一样话就不一样。
            </footer>
          </Card>
        </AiTaskRegion>

        <DimensionsGrid result={result} aiFailed={task.isFailed} />

        {error && <ComplianceBanner tone="warning" title="操作失败">{error}</ComplianceBanner>}

        <div className="self-assessment-lightflow__actions">
          <Button variant="ghost" onClick={() => navigate('/resume/self-assessment/history')}>查看记录</Button>
          <GuardedButton
            blockedReason={printing ? '正在生成 PDF，请稍候' : accessReason}
            onClick={() => void handlePrint()}
          >
            {printing ? '生成 PDF 中…' : '生成 PDF 预览'} <DownloadIcon />
          </GuardedButton>
          <GuardedButton
            blockedReason={withdrawing ? '正在撤回，请稍候' : accessReason}
            onClick={() => void handleWithdraw()}
            variant="danger"
          >
            {withdrawing ? '撤回中…' : '撤回本次探索'} <Trash2Icon />
          </GuardedButton>
        </div>

        {printed && (
          <Card className="self-assessment-lightflow__print-card">
            <FileWarningIcon aria-hidden="true" />
            <div>
              <p>PDF 已生成：{printed.filename} · {printed.pageCount} 页 · {formatBytes(printed.sizeBytes)}</p>
              <div className="self-assessment-lightflow__print-actions">
                <Button variant="secondary" onClick={() => setPreviewOpen(true)}>页内预览 PDF</Button>
                <GuardedButton
                  blockedReason={printed.printFileUrl ? null : '打印链接未就绪，这份文件暂时送不到打印工作台；页内预览与扫码带走不受影响。'}
                  onClick={handoffToPrint}
                >
                  去打印工作台核价 <PrinterIcon />
                </GuardedButton>
              </div>
            </div>
          </Card>
        )}
        {previewOpen && printed && (
          <FilePreviewDialog
            fileUrl={printed.signedUrl}
            fileName={printed.filename}
            mimeType="application/pdf"
            phoneDownloadUrl={printed.signedUrl}
            onClose={() => setPreviewOpen(false)}
          />
        )}
      </div>
      </main>
    </SelfAssessmentFullscreenFrame>
  )
}

function DimensionsGrid({ result, aiFailed }: { result: SelfAssessmentSubmitResponse; aiFailed: boolean }) {
  return (
    <section className="self-assessment-lightflow__dims" aria-label="维度强度与依据">
      <p className="self-assessment-lightflow__dims-head">
        <EvidenceBadge level="E2" />
        <span>
          下面每一项的强度都是<b>固定权重累加</b>算出来的，依据只有你自己的选择
          <EvidenceBadge level="E1" compact />
          。这部分不经过 AI{aiFailed ? '，所以这次 AI 没成也照常有' : ''}。
        </span>
      </p>
      <div className="self-assessment-lightflow__grid">
        {result.dimensions.map((d) => <DimensionCard key={d.key} d={d} aiFailed={aiFailed} />)}
      </div>
    </section>
  )
}

function DimensionCard({ d, aiFailed }: { d: SelfAssessmentDimensionResult; aiFailed: boolean }) {
  return (
    <Card className="self-assessment-lightflow__dim-card">
      <header>
        <h3>{d.label}</h3>
        <span className="self-assessment-lightflow__strength">强度 {d.strength}/5</span>
      </header>
      {d.note ? <AiConclusion text={d.note} /> : (
        <p className="self-assessment-lightflow__muted">
          {aiFailed ? '本次解读未生成 —— 缺的只是这段文字，强度与依据题号已经算出来了。' : '本维度解读未生成。'}
        </p>
      )}
      <footer>
        <small>
          依据：本组第 {d.evidenceQuestionIdx.length > 0 ? d.evidenceQuestionIdx.map((i) => i + 1).join('、') : '—'} 题的选择（只记题号，不含选项内容）。
          本解读仅描述本次作答的倾向，不构成能力评价或职业推荐。
        </small>
      </footer>
    </Card>
  )
}

// ============================================================
// 4) 记录页（生产口径：独立路由，不是结果页里的一个阶段）
//
// 切分差异（缺页规划 #619 G-11）：原型把「往期记录」做成同一页的 s4 阶段，生产是
// 独立路由且被 verify-fusion-w5 / w6 的路由清单锁定 —— **以生产的独立路由为准**：
// 结果页只回答「这次是什么」，本页只回答「我做过没有、去哪看明细」，一屏一件事。
// 诚实边界：服务端没有「按人列出历次」的端点（只有 GET /:taskId 按编号读回），
// 所以本页不编列表 —— 只显示当前会话这一次，跨次明细指向「我的 → AI 服务记录」。
// ============================================================
export function SelfAssessmentHistoryPage() {
  const navigate = useNavigate()
  const session = useMemo(() => loadSession(), [])
  const current = session.taskId ?? session.result?.taskId ?? null
  const consentedAt = formatDateTime(session.consentedAt)
  const expiresAt = formatDateTime(session.result?.expiresAt)
  const answered = session.result?.dimensions.length ?? 0

  return (
    <SelfAssessmentFullscreenFrame>
      <main data-kiosk-screen="resume-self-assessment-history" data-kiosk-domain="resume" className="self-assessment-lightflow self-assessment-lightflow--history flex h-full flex-col">
      <KioskPageHeader title="自我探索 · 倾向参考" description="本机记录" />
      <div className="self-assessment-lightflow__content">
        <ComplianceBanner tone="info" title="记录与权限">
          匿名会话不留库，会话退出后本机记录自动清理；会员本人历史可在「我的 → AI 服务记录 → 自我探索」查看与管理。
          本页不做跨次对比 —— 要能比就得留着两次的作答原文，本机选了不留，这是取舍不是漏做。
        </ComplianceBanner>

        {current ? (
          <Card className="self-assessment-lightflow__meta">
            <h3>这台机器上的本次记录</h3>
            <dl>
              <div><dt>记录编号</dt><dd className="self-assessment-lightflow__mono">{current}</dd></div>
              <div><dt>同意时间</dt><dd>{consentedAt ?? '未记录'}</dd></div>
              <div><dt>维度</dt><dd>{answered > 0 ? `${answered} 个维度已出结果` : '未拿到结果'}</dd></div>
              <div><dt>保留至</dt><dd>{expiresAt ?? '未返回到期时间'}</dd></div>
            </dl>
            <Button variant="secondary" onClick={() => navigate(`/resume/self-assessment/result?taskId=${encodeURIComponent(current)}`)}>
              回看这次结果 <ArrowRightIcon />
            </Button>
          </Card>
        ) : (
          <p className="self-assessment-lightflow__muted">当前会话暂无记录。</p>
        )}

        <Card className="self-assessment-lightflow__meta">
          <h3>这里没有什么</h3>
          <dl>
            <div><dt>答案原文</dt><dd>从未入库</dd></div>
            <div><dt>过期的解读</dt><dd>到期自动清理</dd></div>
            <div><dt>撤回的那次</dt><dd>已物理删除，不可恢复</dd></div>
            <div><dt>企业 / 合作机构 / 管理后台</dt><dd>都看不到，也不参与岗位排序</dd></div>
          </dl>
          <p className="self-assessment-lightflow__muted">不是没加载出来，是本来就不存。</p>
        </Card>

        <div className="self-assessment-lightflow__actions">
          <Button variant="ghost" onClick={() => navigate(-1)}>返回</Button>
          <Button onClick={() => navigate('/me/ai-records')}>前往 AI 服务记录</Button>
        </div>
      </div>
      </main>
    </SelfAssessmentFullscreenFrame>
  )
}
