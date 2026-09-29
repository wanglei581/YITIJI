// ============================================================
// P21 条件核对 —— 第 2 步：逐条结果
//
// ── 结论文案一律来自服务端 ──────────────────────────────────────────────
// overallLabel / reason / sourceText 都由 policy-eligibility.engine.ts 给定，
// 前端不自己拼「你符合 / 不符合」。政策口径不得由前端或 AI 补全。
//
// ── 打印这一步（V6 原型第 3 步「打印清单」）的结论 ────────────────────────
// 后端**没有**任何能把本页结果印成纸的通路：policies 模块不引 FilesModule、
// 没有 pdf service、没有 print 路由；而 POST /print/jobs 只收系统签名的 fileUrl，
// 不收结构化内容。更关键的是本能力对作答**零持久化**（不写库、不进审计、
// 不进日志），要打印就得把户籍 / 参保 / 离职原因这些敏感项落成一个文件对象 ——
// 那是一个需要明确做的留存与告知取舍，不该在接线 PR 里顺手做掉。
//
// 所以这里给一个**可解释的置灰按钮**，而不是一个跳到通用上传页的假打印按钮
// （岗位详情「打印岗位信息」实际跳通用上传页，就是本项目已经犯过的那种错）。
// 置灰用 aria-disabled + 点击短路 + 常显原因 + aria-describedby，不用原生
// disabled：27 寸触摸屏没有 hover，title 永不显示；原生 disabled 还让按钮掉出
// tab 序、被读屏跳过（口径见 #620）。
// ============================================================

import { type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle2Icon, CircleHelpIcon, PrinterIcon, RotateCcwIcon, XCircleIcon } from 'lucide-react'
import type {
  ConditionCheck,
  EligibilityCheckItem,
  EligibilityCheckResult,
  EligibilityQuestionSet,
} from '../../services/api/policy-eligibility'
import {
  COPY_ALL_CONFLICT,
  COPY_NO_PUBLISHED_POLICIES,
  COPY_NO_RECORDED_CONDITIONS,
  deriveOutcome,
  RESULT_TONE,
} from './eligibilityOutcome'
import { EligibilityStepBar } from './components'

const RESULT_ICON = {
  matched: CheckCircle2Icon,
  conflict: XCircleIcon,
  unknown: CircleHelpIcon,
} as const

/** 置灰打印按钮的原因 —— 一句话讲清「为什么现在印不了」（稿 48 最终版的原句），不留想象空间。 */
const PRINT_BLOCKED_WHY = '作答不做保存，暂时无法印成纸质清单。'

export function EligibilityResults({
  result,
  questions,
  onRestart,
  ctaHost,
}: {
  result: EligibilityCheckResult
  questions: EligibilityQuestionSet
  onRestart: () => void
  ctaHost: HTMLElement | null
}) {
  const outcome = deriveOutcome(result.items)
  const comparable = result.items.filter((item) => item.conditionsRecorded)

  // 两种「空」用两句不同的话，且分支互斥：
  //   items 为空  → 库里没有可比对条目（录入进度，不是结论）
  //   items 非空但全不符 → 这是核对结论
  const headline =
    outcome.kind === 'no_published_policies'
      ? COPY_NO_PUBLISHED_POLICIES
      : outcome.kind === 'no_recorded_conditions'
        ? COPY_NO_RECORDED_CONDITIONS
        : outcome.kind === 'all_conflict'
          ? COPY_ALL_CONFLICT
          : `本次比对了 ${outcome.comparableCount} 条已录入条件的政策：` +
            `${outcome.matchedCount} 条已录入条件全部相符、${outcome.conflictCount} 条存在不一致、` +
            `${outcome.unknownCount} 条还有无法判定的条件。结果不是资格认定，能不能办以经办窗口审核为准。`

  return (
    <div className="k8-elig">
      <EligibilityStepBar step={2} />

      <div className="k8-elig-headline">
        <p className="k8-elig-headline-label"><b>本次比对说明</b>按返回内容原样显示</p>
        <p className="k8-elig-headline-text">{headline}</p>
        <p className="k8-elig-headline-meta">
          {/* 证据分级：确定性比对，不标 E3，也不出现「AI 判断」字样 */}
          <span className="k8-elig-e2">E2 · 按政策原文逐条比对</span>
          <span className="k8-elig-chip">共发布 <b>{result.items.length}</b> 条 · 其中 <b>{comparable.length}</b> 条录入了可比对条件</span>
          <span className="k8-elig-chip">你填了 <b>{result.answeredCount} / {questions.questions.length}</b> 项</span>
        </p>
        <p className="k8-elig-noai">不使用 AI：本核对是机械比对，AI 服务是否可用都不影响这一页。</p>
      </div>

      {comparable.length > 0 && (
        <section className="k8-elig-results" aria-label="逐条结果">
          <header className="rq-grp rq-grp-plain">
            <b>逐条结果</b>
            <span>每条都能对回政策原文</span>
          </header>
          <div className="k8-elig-cards">
            {comparable.map((item) => (
              <PolicyResultCard key={item.policyId} item={item} />
            ))}
          </div>
        </section>
      )}

      <ResultActions host={ctaHost} onRestart={onRestart} />

      <p className="k8-elig-disclaimer">{result.disclaimer}</p>
    </div>
  )
}

function ResultActions({ host, onRestart }: { host: HTMLElement | null; onRestart: () => void }) {
  const actions: ReactNode = (
    <>
      <button type="button" className="k8-elig-restart" onClick={onRestart}>
        <RotateCcwIcon className="h-6 w-6" aria-hidden="true" />
        重新填写并再比对一次
      </button>
      <button
        type="button"
        className="k8-elig-print-blocked"
        aria-disabled="true"
        aria-describedby="k8-elig-print-why"
        onClick={(event) => event.preventDefault()}
      >
        <PrinterIcon className="h-6 w-6" aria-hidden="true" />
        打印核对清单（暂不可用）
      </button>
      <p id="k8-elig-print-why" className="why">{PRINT_BLOCKED_WHY}</p>
    </>
  )
  if (!host) return <div className="k8-elig-actionbar">{actions}</div>
  return createPortal(actions, host)
}

function PolicyResultCard({ item }: { item: EligibilityCheckItem }) {
  return (
    <article className="k8-elig-card">
      <h3>{item.title}</h3>
      {/* 来源标识：来源机构与同步时间照原样露出。发布方的外部编号是系统之间对账用的，用户用不上，
          不上屏（kiosk-runtime-engineering-words-2026-09-28）；它仍在返回数据里，不影响追溯。 */}
      <p className="k8-elig-card-src">
        <span className="k8-elig-chip k8-elig-chip-slate">来源机构 <b>{item.source.sourceName}</b></span>
        <span className="k8-elig-chip">同步时间 <b>{item.source.syncTime.slice(0, 10)}</b></span>
      </p>
      {/* 结论文案由服务端给定，前端不改写 */}
      <p className="k8-elig-card-overall">{item.overallLabel}</p>
      <ul className="k8-elig-conds">
        {item.conditions.map((cond) => (
          <ConditionRow key={cond.ruleId} cond={cond} />
        ))}
      </ul>
    </article>
  )
}

function ConditionRow({ cond }: { cond: ConditionCheck }) {
  const tone = RESULT_TONE[cond.result]
  const Icon = RESULT_ICON[cond.result]
  return (
    <li className={`k8-elig-cond ${tone.className}`}>
      <Icon className="k8-elig-cond-ic" aria-hidden="true" />
      {/* 稿 48：条件名在左、判定在这一行右端；判定说明与政策原文左右并排，依据你填的在下面一行。 */}
      <div className="k8-elig-cond-main">
        <p className="k8-elig-cond-head">
          <b>{cond.label}</b>
          <span className="k8-elig-cond-tag">{tone.label}</span>
        </p>
        <p className="k8-elig-cond-reason"><span className="k8-elig-cond-k">判定说明</span>{cond.reason}</p>
        {/* 政策原文摘录：判定唯一可追溯的依据，一字不改地展示 */}
        <blockquote className="k8-elig-cond-src"><span className="k8-elig-cond-k">政策原文</span>{cond.sourceText}</blockquote>
        {cond.basis.length > 0 && (
          <p className="k8-elig-cond-basis">
            <span className="k8-elig-cond-k">依据你填的</span>
            {cond.basis
              .map((b) => `${b.questionLabel} = ${b.answerLabel ?? '未填写'}`)
              .join('；')}
          </p>
        )}
      </div>
    </li>
  )
}
