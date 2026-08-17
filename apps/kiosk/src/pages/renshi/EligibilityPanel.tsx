// ============================================================
// P21 政策条件核对 —— 一体机接线（两步：选你的情况 → 看逐条结果）
//
// ── 不使用 AI（与原型分歧处，按后端事实实现）────────────────────────────
// 判定在服务端由 policy-eligibility.engine.ts 做**确定性比对**，零 LLM。
// 因此本面板不引 ../../ai/*、不读任何 AI 可用性状态、不做 AI 降级分支：
// AI 挂掉时这一页照常可用。V6 原型 21-policy.html 有 16 处 data-when="ai-down"
// 把这项能力整个关掉（:466「未核对」、:478「AI 不可用 · 本次不核对条件」、
// :822「生成清单（未核对）」…），与它自己 :458-459 注释「零 LLM」互相矛盾。
// 本 PR 只改实现，不改原型。
//
// ── 先探数据、再要个人信息 ──────────────────────────────────────────────
// 进面板先用**空作答**调一次 /policies/eligibility-check 作探针。库里没有可比对
// 的政策时直接如实说明，不向用户要那九项个人信息 —— 否则等于白收一轮户籍 /
// 年龄段 / 参保信息，还要用一句容易被读成「你不符合」的话收场。
// 两种空的区分见 eligibilityOutcome.ts。
// ============================================================

import { useEffect, useMemo, useState } from 'react'
import { ErrorState, LoadingState } from '@ai-job-print/ui'
import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  ArrowRightIcon,
  InfoIcon,
  LockIcon,
  ScaleIcon,
} from 'lucide-react'
import {
  ELIGIBILITY_BACKEND_REQUIRED,
  checkEligibility,
  getEligibilityQuestions,
  type EligibilityCheckResult,
  type EligibilityQuestionSet,
} from '../../services/api/policy-eligibility'
import {
  COPY_NO_PUBLISHED_POLICIES,
  COPY_NO_RECORDED_CONDITIONS,
  countAnswered,
  deriveOutcome,
  isAskable,
} from './eligibilityOutcome'
import { EligibilityStepBar } from './components'
import { EligibilityResults } from './EligibilityResults'

type Phase =
  | { s: 'loading' }
  | { s: 'error' }
  /** 未连接后端（mock 模式）：问项与判定都只能来自服务端，本机不造 */
  | { s: 'backend-required' }
  /** 探针发现库里没有可比对内容 —— 不进入作答，直接如实说明 */
  | { s: 'unavailable'; notice: string }
  | { s: 'ask'; questions: EligibilityQuestionSet }
  | { s: 'result'; questions: EligibilityQuestionSet; result: EligibilityCheckResult }

export function EligibilityPanel() {
  const [phase, setPhase] = useState<Phase>({ s: 'loading' })
  /** 作答只放 React state：不写 localStorage / sessionStorage / URL query。 */
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [submitting, setSubmitting] = useState(false)

  const probe = () => {
    setPhase({ s: 'loading' })
    // 探针用空作答：不发送任何个人信息，只问「现在有没有东西可比」
    Promise.all([getEligibilityQuestions(), checkEligibility({})])
      .then(([questions, probeResult]) => {
        const outcome = deriveOutcome(probeResult.items)
        if (!isAskable(outcome)) {
          setPhase({
            s: 'unavailable',
            notice:
              outcome.kind === 'no_published_policies'
                ? COPY_NO_PUBLISHED_POLICIES
                : COPY_NO_RECORDED_CONDITIONS,
          })
          return
        }
        setPhase({ s: 'ask', questions })
      })
      .catch((err: unknown) => {
        const backendRequired =
          err instanceof Error && err.message === ELIGIBILITY_BACKEND_REQUIRED
        setPhase({ s: backendRequired ? 'backend-required' : 'error' })
      })
  }

  useEffect(probe, [])

  const answeredCount = useMemo(() => countAnswered(answers), [answers])

  const submit = (questions: EligibilityQuestionSet) => {
    setSubmitting(true)
    checkEligibility(answers)
      .then((result) => setPhase({ s: 'result', questions, result }))
      .catch(() => setPhase({ s: 'error' }))
      .finally(() => setSubmitting(false))
  }

  if (phase.s === 'loading') return <LoadingState className="py-16" />
  if (phase.s === 'error') return <ErrorState className="py-16" onRetry={probe} />

  if (phase.s === 'backend-required') {
    return (
      <NoticeBlock
        tone="amber"
        title="本机现在做不了条件核对"
        body="当前未连接政策服务后端。问项与判定口径必须由服务端下发，本机不会自己编一套问项或结论。请联系运营人员确认服务连接后重试。"
        onRetry={probe}
      />
    )
  }

  if (phase.s === 'unavailable') {
    return <NoticeBlock tone="slate" title="暂时没有可核对的政策条目" body={phase.notice} onRetry={probe} />
  }

  if (phase.s === 'result') {
    return (
      <EligibilityResults
        result={phase.result}
        questions={phase.questions}
        onRestart={() => {
          setAnswers({})
          setPhase({ s: 'ask', questions: phase.questions })
        }}
      />
    )
  }

  const { questions } = phase
  const enough = answeredCount > 0

  return (
    <div className="k8-elig">
      <EligibilityStepBar step={1} />

      <p className="k8-elig-privacy">
        <LockIcon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
        {questions.privacyNotice}
      </p>

      <div className="k8-elig-questions">
        {questions.questions.map((q) => (
          <fieldset key={q.key} className="k8-elig-q">
            <legend className="k8-elig-q-title">
              {q.label}
              {q.sensitive && <small>这项可以不填</small>}
            </legend>
            <div className="k8-elig-opts">
              {q.options.map((opt) => {
                const active = answers[q.key] === opt.value
                return (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={active}
                    className="k8-elig-opt"
                    onClick={() =>
                      setAnswers((prev) => {
                        const next = { ...prev }
                        if (prev[q.key] === opt.value) delete next[q.key]
                        else next[q.key] = opt.value
                        return next
                      })
                    }
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </fieldset>
        ))}
      </div>

      <div className="k8-elig-actionbar">
        <span className="k8-elig-count">
          已填 {answeredCount} / {questions.questions.length} 项
          <small>选「不确定」等于没填，对应条件会标为「无法判定」，不会算成不符合。</small>
        </span>
        {/*
          置灰用 aria-disabled + 点击短路 + 常显原因 + aria-describedby，
          **不用原生 disabled**：27 寸触摸屏没有 hover，title 永不显示；
          原生 disabled 还让按钮掉出 tab 序、被读屏跳过（口径见 #620）。
        */}
        <button
          type="button"
          className="k8-elig-submit"
          aria-disabled={!enough || submitting || undefined}
          aria-describedby={enough ? undefined : 'k8-elig-submit-why'}
          onClick={(event) => {
            if (!enough || submitting) {
              event.preventDefault()
              return
            }
            submit(questions)
          }}
        >
          <ScaleIcon className="h-6 w-6" aria-hidden="true" />
          {submitting ? '正在比对…' : '按政策原文逐条比对'}
          <ArrowRightIcon className="h-6 w-6" aria-hidden="true" />
        </button>
      </div>
      {!enough && (
        <p id="k8-elig-submit-why" className="k8-elig-why">
          <InfoIcon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
          还没有填写任何一项：一项都不填时每条条件都会判成「无法判定」，比对结果没有参考价值。
          请至少选 1 项（不含「不确定」）后再比对。
        </p>
      )}

      <p className="k8-elig-disclaimer">{questions.disclaimer}</p>
    </div>
  )
}

function NoticeBlock({
  tone,
  title,
  body,
  onRetry,
}: {
  tone: 'amber' | 'slate'
  title: string
  body: string
  onRetry: () => void
}) {
  return (
    <div className={`k8-elig-notice k8-elig-notice--${tone}`}>
      <AlertTriangleIcon className="h-7 w-7 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <b>{title}</b>
        <p>{body}</p>
      </div>
      <button type="button" className="k8-elig-notice-retry" onClick={onRetry}>
        <ArrowLeftIcon className="h-5 w-5" aria-hidden="true" />
        重新检查
      </button>
    </div>
  )
}
