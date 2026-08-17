// ============================================================
// P21 条件核对 —— 空态语义与结论派生（纯函数，无 I/O、无 React）
//
// ── 本文件存在的唯一理由：把两种「空」彻底分开 ─────────────────────────────
//
// 生产政策表现在是 0 条。于是「核对完什么都没有」有两个完全不同的原因，
// 对求职者是两句不同的话：
//
//   A. 政策库里还没有录入政策        → 这是运营 / 录入进度，与用户填了什么无关
//   B. 按你填的条件，都对不上         → 这是核对结果
//
// 把 A 说成 B，等于告诉一个人「你不符合任何政策」，而事实是这台机器还没有
// 任何政策可比。二者的后续动作也相反：A 该去看政策原文 / 等录入，
// B 该去看差在哪一条、去窗口核实。
//
// ── 结构性保证（不靠文案自觉）────────────────────────────────────────────
//
// 服务端 /policies/eligibility-check **不做「只回匹配项」的过滤**：
// 它把当前可比对的政策全量回传，每条各带自己的三态结论。所以
//
//     items.length === 0  ⟺  库里没有可比对的政策条目（A）
//
// 是恒等式，不是约定 —— 「都对不上」（B）永远产出一个非空数组，
// 每项 overall === 'some_conditions_conflict'。下面的 deriveOutcome 把这条
// 恒等式写死成唯一的分支判据：'no_published_policies' 只可能来自空数组，
// 'all_conflict' 只可能来自非空数组。
// ============================================================

import type { EligibilityCheckItem } from '../../services/api/policy-eligibility'

/** A：库里没有可比对的政策条目。属于录入进度，**不是**核对结论。 */
export const COPY_NO_PUBLISHED_POLICIES =
  '政策库里还没有可核对的政策条目。这是本机的内容录入进度，不是你的核对结果 ——' +
  '它不代表你不符合任何政策。可以先看「就业政策」里的办事指引，或向经办窗口咨询。'

/** A′：有政策，但都还没录结构化条件 —— 同样是录入进度，不是结论。 */
export const COPY_NO_RECORDED_CONDITIONS =
  '本机已发布的政策条目还没有录入可逐条比对的申领条件，因此这次不做机械比对。' +
  '这同样是录入进度，不是你的核对结果；具体条件请看政策原文或向经办窗口核对。'

/** B：核对结论 —— 每条政策都至少有一项已录入条件对不上。 */
export const COPY_ALL_CONFLICT =
  '按你填写的信息，本次比对的政策每条都至少有 1 项已录入条件不一致。' +
  '下面可以逐条看差在哪一项；本结果不是资格认定，能不能办以经办窗口审核为准。'

export type EligibilityOutcome =
  /** A：空数组 —— 只可能是「库里没有」 */
  | { kind: 'no_published_policies' }
  /** A′：有政策但零条件 */
  | { kind: 'no_recorded_conditions'; policyCount: number }
  /** B：全部不符 —— 只可能来自非空数组 */
  | { kind: 'all_conflict'; comparableCount: number }
  /** 正常结论：有相符 / 待确认的条目 */
  | {
      kind: 'has_results'
      comparableCount: number
      matchedCount: number
      unknownCount: number
      conflictCount: number
    }

/**
 * 把服务端回传的条目集合折成页面要说的那一句话。
 *
 * 判据顺序是刻意的：先判「有没有东西可比」（A / A′），再判结论（B / 正常）。
 * 反过来写就会让 A 掉进 B 的文案里 —— 那正是本文件要防的错。
 */
export function deriveOutcome(items: readonly EligibilityCheckItem[]): EligibilityOutcome {
  // A —— 恒等式：空数组只能是「库里没有可比对的政策条目」
  if (items.length === 0) return { kind: 'no_published_policies' }

  const comparable = items.filter((item) => item.conditionsRecorded)
  // A′ —— 有政策，但一条结构化条件都没有
  if (comparable.length === 0) return { kind: 'no_recorded_conditions', policyCount: items.length }

  // 以下分支的 comparable.length 必然 > 0，B 不可能从空集合产生
  const conflictCount = comparable.filter((i) => i.overall === 'some_conditions_conflict').length
  if (conflictCount === comparable.length) {
    return { kind: 'all_conflict', comparableCount: comparable.length }
  }

  return {
    kind: 'has_results',
    comparableCount: comparable.length,
    matchedCount: comparable.filter((i) => i.overall === 'all_recorded_conditions_matched').length,
    unknownCount: comparable.filter((i) => i.overall === 'some_conditions_unknown').length,
    conflictCount,
  }
}

/**
 * 进入核对前的可用性探针结论。
 *
 * 用的是同一个 deriveOutcome：**先用空作答探一次**，确认库里确实有可比对的
 * 政策，再向用户要那九项个人信息。反过来（先问完再发现库是空的）等于
 * 白收一轮户籍 / 年龄 / 参保信息，还要用一句容易被读成「你不符合」的话收场。
 */
export function isAskable(outcome: EligibilityOutcome): boolean {
  return outcome.kind === 'all_conflict' || outcome.kind === 'has_results'
}

/** 已作答项数：与服务端 countAnswered 同口径 —— 选了「不确定」等于没答。 */
export const UNSURE_VALUE = 'unsure'
export function countAnswered(answers: Readonly<Record<string, string>>): number {
  return Object.values(answers).filter((v) => v !== UNSURE_VALUE).length
}

export const RESULT_TONE: Record<
  'matched' | 'conflict' | 'unknown',
  { label: string; className: string }
> = {
  matched: { label: '相符', className: 'k8-elig-cond--matched' },
  conflict: { label: '不符', className: 'k8-elig-cond--conflict' },
  unknown: { label: '无法判定', className: 'k8-elig-cond--unknown' },
}
