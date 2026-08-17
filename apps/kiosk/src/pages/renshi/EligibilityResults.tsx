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

import { CheckCircle2Icon, CircleHelpIcon, InfoIcon, PrinterIcon, RotateCcwIcon, XCircleIcon } from 'lucide-react'
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

/** 置灰打印按钮的原因 —— 一句话讲清「为什么现在印不了」，不留想象空间。 */
const PRINT_BLOCKED_WHY =
  '本机暂时无法把这份核对结果印成纸：服务端还没有生成核对清单文件的通路，' +
  '而且你填的条件按隐私口径不做任何保存，要打印就得先把这些信息存成文件 —— ' +
  '这个取舍还没有做。需要留存请自行拍照或抄录；如需打印你自己带来的材料，' +
  '请回到「就业政策」页使用上传入口。'

export function EligibilityResults({
  result,
  questions,
  onRestart,
}: {
  result: EligibilityCheckResult
  questions: EligibilityQuestionSet
  onRestart: () => void
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
        <p className="k8-elig-headline-text">{headline}</p>
        <p className="k8-elig-headline-meta">
          {/* 证据分级：确定性比对，不标 E3，也不出现「AI 判断」字样 */}
          <span className="k8-elig-e2">E2 · 按政策原文逐条比对</span>
          <span>不使用 AI：本核对是机械比对，AI 服务是否可用都不影响这一页。</span>
          <span>
            共发布 {result.items.length} 条 · 其中 {comparable.length} 条录入了可比对条件 · 你填了{' '}
            {result.answeredCount} / {questions.questions.length} 项
          </span>
        </p>
      </div>

      {comparable.length > 0 && (
        <div className="k8-elig-cards">
          {comparable.map((item) => (
            <PolicyResultCard key={item.policyId} item={item} />
          ))}
        </div>
      )}

      <div className="k8-elig-actionbar">
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
      </div>
      <p id="k8-elig-print-why" className="k8-elig-why">
        <InfoIcon className="h-[18px] w-[18px] shrink-0" aria-hidden="true" />
        {PRINT_BLOCKED_WHY}
      </p>

      <p className="k8-elig-disclaimer">{result.disclaimer}</p>
    </div>
  )
}

function PolicyResultCard({ item }: { item: EligibilityCheckItem }) {
  return (
    <article className="k8-elig-card">
      <h3>{item.title}</h3>
      {/* 来源标识按 CLAUDE.md §10：来源机构 / 同步时间 / 外部ID 都要露出，缺失如实写「来源未提供」 */}
      <p className="k8-elig-card-src">
        来源 <b>{item.source.sourceName}</b> · 同步于 {item.source.syncTime.slice(0, 10)} · 外部ID{' '}
        {item.source.externalId ?? '来源未提供'}
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
      <Icon className="mt-0.5 h-6 w-6 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <b>
          {cond.label}
          <span className="k8-elig-cond-tag">{tone.label}</span>
        </b>
        <p className="k8-elig-cond-reason">{cond.reason}</p>
        {/* 政策原文摘录：判定唯一可追溯的依据，一字不改地展示 */}
        <blockquote className="k8-elig-cond-src">政策原文：{cond.sourceText}</blockquote>
        {cond.basis.length > 0 && (
          <p className="k8-elig-cond-basis">
            依据你填的：
            {cond.basis
              .map((b) => `${b.questionLabel} = ${b.answerLabel ?? '未填写'}`)
              .join('；')}
          </p>
        )}
      </div>
    </li>
  )
}
