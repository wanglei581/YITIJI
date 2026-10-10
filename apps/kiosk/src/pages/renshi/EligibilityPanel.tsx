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
import { type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { helpNeededLine } from '../../copy/unattendedCopy'
import { useIdleTimer } from '../../hooks/useIdleTimer'
import { useSupportContact } from '../../hooks/useSupportContact'
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  FileTextIcon,
  ListChecksIcon,
  LockIcon,
  RotateCcwIcon,
  ScaleIcon,
  ShieldCheckIcon,
  type LucideIcon,
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
import { EligibilityStepBar, RqDeadEnd } from './components'
import { EligibilityResults } from './EligibilityResults'
import type { TabKey } from './shared'

type Phase =
  | { s: 'loading' }
  | { s: 'error' }
  /** 未连接政策服务：问项与判定都只能从政策服务取得，本机不造 */
  | { s: 'backend-required' }
  /** 探针发现库里没有可比对内容 —— 不进入作答，直接如实说明 */
  | { s: 'unavailable'; notice: string }
  | { s: 'ask'; questions: EligibilityQuestionSet }
  | { s: 'result'; questions: EligibilityQuestionSet; result: EligibilityCheckResult }

export type EligibilityChrome = {
  tone: 'ok' | 'warn' | 'bad' | 'unknown'
  label: string
  subtitle: string
}

function CtaSlot({ host, children }: { host: HTMLElement | null; children: ReactNode }) {
  if (!host) return null
  return createPortal(children, host)
}

const SUBMIT_WHY = '一项都不填时每条条件都会判成「无法判定」，结果没有参考价值。请至少选 1 项（不含「不确定」）。'
const PARTIAL_WHY = '选「不确定」等于没填，对应条件会标为「无法判定」，不会算成不符合。'
const PROBE_WHY = '还没确认有可比对的政策，此时不该向你要户籍、年龄段或参保信息。'
const RETRY_WHY = '重新检查只是再问一次现在有没有可比对的政策，不收集任何个人信息。'

export function EligibilityPanel({
  onChrome,
  ctaHost,
  onTab,
}: {
  onChrome?: (chrome: EligibilityChrome) => void
  ctaHost: HTMLElement | null
  onTab: (tab: TabKey) => void
}) {
  const contact = useSupportContact()
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

  useEffect(() => {
    if (!onChrome) return
    if (phase.s === 'loading') {
      onChrome({ tone: 'unknown', label: '正在检查可比对政策', subtitle: '先确认有可比对的政策，再决定是否请你填写。' })
    } else if (phase.s === 'backend-required') {
      onChrome({ tone: 'warn', label: '暂时无法核对', subtitle: '本机连不上政策服务；不自造问项，也不给任何结论。' })
    } else if (phase.s === 'unavailable') {
      onChrome(phase.notice === COPY_NO_RECORDED_CONDITIONS
        ? { tone: 'warn', label: '未录入比对条件', subtitle: '有政策但没录可比对条件，本次不做逐条比对。' }
        : { tone: 'warn', label: '无可比对条目', subtitle: '库里没有可比对的条目；这是录入进度，不是你的核对结果。' })
    } else if (phase.s === 'error') {
      onChrome({ tone: 'bad', label: '核对未成功', subtitle: '这次没有拿到结果，本页不显示任何结论。' })
    } else if (phase.s === 'result') {
      onChrome({ tone: 'ok', label: '逐条结果已返回', subtitle: '总体说明与逐条判定都按返回内容原样显示。' })
    } else if (submitting) {
      onChrome({ tone: 'unknown', label: '正在等待比对结果', subtitle: '等结果返回；本机不猜结论。' })
    } else if (answeredCount > 0) {
      onChrome({ tone: 'ok', label: '可以开始比对', subtitle: '已经可以比对了；没填的项会标为「无法判定」，不算不符合。' })
    } else {
      onChrome({ tone: 'unknown', label: '等待你填写', subtitle: '先选你的情况再比对；作答只留在本页，不写进网址或浏览器存储。' })
    }
  }, [answeredCount, onChrome, phase, submitting])

  // 公共屏：作答只在内存，离开即没；但人走了还停在结果页时，下一位仍能读到户籍 / 参保。
  // 60 秒无操作把作答和结论清掉，页面还在（不删 UI），只是回到空白表单。
  useIdleTimer({
    timeoutMs: 60_000,
    enabled: (phase.s === 'ask' || phase.s === 'result') && !submitting,
    onIdle: () => {
      setAnswers({})
      setPhase((prev) => (prev.s === 'result' ? { s: 'ask', questions: prev.questions } : prev))
    },
  })

  const submit = (questions: EligibilityQuestionSet) => {
    setSubmitting(true)
    checkEligibility(answers)
      .then((result) => setPhase({ s: 'result', questions, result }))
      .catch(() => setPhase({ s: 'error' }))
      .finally(() => setSubmitting(false))
  }

  if (phase.s === 'loading') {
    return (
      <div className="k8-elig">
        <CtaSlot host={ctaHost}>
          <button
            type="button"
            className="k8-elig-submit"
            aria-disabled="true"
            aria-describedby="k8-elig-probe-why"
            onClick={(event) => event.preventDefault()}
          >
            <ScaleIcon className="h-6 w-6" aria-hidden="true" />
            按政策原文逐条比对
          </button>
          <span id="k8-elig-probe-why" className="why">{PROBE_WHY}</span>
        </CtaSlot>
        <EligibilityStepBar step={1} />
        {/* 稿 48 eligibility-probing 的状态卡与两句说明；检查的这一会儿，和本页读取中一样给三条不用等的出口
            （稿 48 loading 的做法），余高分在各段之间，不放大字。 */}
        <RqDeadEnd
          tone="info"
          icon={ScaleIcon}
          title="正在检查现在有没有可比对的政策"
          exitsHint="这三条都不等这次检查"
          exits={[
            { key: 'policy', icon: FileTextIcon, title: '去看就业政策', desc: '政策条目与办事指引', onClick: () => onTab('policy') },
            { key: 'social', icon: ShieldCheckIcon, title: '看社保指南', desc: '查询、证明与备案', onClick: () => onTab('social') },
          ]}
          uploadDesc="只处理你带来的文件"
          note="条件核对按政策原文逐条比对，不使用 AI；小青能不能用都不影响它。如果没有可比对的条目，本机会直接说明，不会先问完九项再用一句像「你不符合」的话收场。"
        >
          先确认有没有录了条件的政策，再决定要不要请你填写。这一步不发送任何个人信息。
        </RqDeadEnd>
      </div>
    )
  }
  if (phase.s === 'error') {
    return (
      <NoticeBlock
        host={ctaHost}
        onRetry={probe}
        onTab={onTab}
        kind="error"
        title="这次核对没有成功"
        body="这次没有拿到结果，所以本页不显示任何结论。失败不等于「你不符合」，也不代表库里没有政策。你选过的内容只留在这一页，离开或重来都不会被保存。"
      />
    )
  }

  if (phase.s === 'backend-required') {
    return (
      <NoticeBlock
        host={ctaHost}
        onRetry={probe}
        onTab={onTab}
        kind="backend-required"
        title="本机现在做不了条件核对"
        body={`本机暂时连不上政策服务。要问什么、怎么判定，都要由政策服务提供，本机不会自己编一套问项或结论。${helpNeededLine(contact)}`}
      />
    )
  }

  if (phase.s === 'unavailable') {
    return (
      <NoticeBlock
        host={ctaHost}
        onRetry={probe}
        onTab={onTab}
        kind={phase.notice === COPY_NO_RECORDED_CONDITIONS ? 'no-rules' : 'no-policies'}
        title={phase.notice === COPY_NO_RECORDED_CONDITIONS ? '已发布政策还没录入可比对条件' : '暂时没有可核对的政策条目'}
        body={phase.notice}
      />
    )
  }

  if (phase.s === 'result') {
    return (
      <EligibilityResults
        ctaHost={ctaHost}
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

  const total = questions.questions.length

  return (
    <div className="k8-elig">
      <CtaSlot host={ctaHost}>
        <span className="rq-cta-count">已填 <b>{answeredCount} / {total}</b> 项</span>
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
        {enough ? (
          <span className="why">{PARTIAL_WHY}</span>
        ) : (
          <span id="k8-elig-submit-why" className="why">{SUBMIT_WHY}</span>
        )}
      </CtaSlot>
      <EligibilityStepBar step={1} />

      <p className="k8-elig-privacy">
        <LockIcon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
        {questions.privacyNotice}
      </p>

      <div className="k8-elig-questions">
        {questions.questions.map((q) => (
          <fieldset key={q.key} className="k8-elig-q">
            <div className="k8-elig-q-head">
              <legend className="k8-elig-q-title">
                {q.label}
                {q.sensitive && <small>这项可以不填</small>}
              </legend>
            </div>
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

      <p className="k8-elig-disclaimer">{questions.disclaimer}</p>
    </div>
  )
}

/** 做不了 / 没东西可比 / 这次失败：稿 48 的死路屏，状态卡 → 三条不依赖条件核对的出口 → 一句就地说明。 */
const NOTICE_LOOK: Record<NoticeKind, { tone: 'info' | 'error' | 'empty' | 'warn'; icon: LucideIcon; note: string; noteTone: 'info' | 'warn' }> = {
  'backend-required': { tone: 'warn', icon: AlertTriangleIcon, note: '本机没有向你收集任何信息，也没有给出任何结论。', noteTone: 'warn' },
  'no-policies': { tone: 'empty', icon: FileTextIcon, note: '本机没有向你收集任何信息，这一屏也不是核对结论。', noteTone: 'info' },
  'no-rules': { tone: 'empty', icon: ListChecksIcon, note: '有政策但没有可比对的条件时，本机不拿正文猜条件：请看政策原文或向经办窗口核对。', noteTone: 'info' },
  error: { tone: 'error', icon: AlertTriangleIcon, note: '你的作答不保存、不进日志，本机也不把它写进网址或浏览器存储。', noteTone: 'warn' },
}

type NoticeKind = 'backend-required' | 'no-policies' | 'no-rules' | 'error'

function NoticeBlock({
  host,
  title,
  body,
  kind,
  onRetry,
  onTab,
}: {
  host: HTMLElement | null
  title: string
  body: string
  kind: NoticeKind
  onRetry: () => void
  onTab: (tab: TabKey) => void
}) {
  const look = NOTICE_LOOK[kind]
  return (
    <div className="k8-elig">
      <CtaSlot host={host}>
        <button type="button" className="k8-elig-notice-retry" onClick={onRetry}>
          <RotateCcwIcon className="h-6 w-6" aria-hidden="true" />
          重新检查
        </button>
        <span className="why">{RETRY_WHY}</span>
      </CtaSlot>
      <EligibilityStepBar step={1} />
      <RqDeadEnd
        tone={look.tone}
        icon={look.icon}
        title={title}
        exitsHint="这三条都不依赖条件核对"
        exits={[
          { key: 'policy', icon: FileTextIcon, title: '去看就业政策', desc: '政策条目与办事指引', onClick: () => onTab('policy') },
          { key: 'social', icon: ShieldCheckIcon, title: '看社保指南', desc: '查询、证明与备案', onClick: () => onTab('social') },
        ]}
        uploadDesc="只处理你带来的文件"
        note={look.note}
        noteTone={look.noteTone}
      >
        {body}
      </RqDeadEnd>
    </div>
  )
}
