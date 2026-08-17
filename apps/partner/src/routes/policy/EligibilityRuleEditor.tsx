// ============================================================
// P21 单条申领条件编辑器（合作机构后台）
//
// 面向不懂技术的运营，把「录条件」拆成三问：
//   ① 政策原文这一条怎么写的？（原样粘贴，不许改写）
//   ② 这一条机器能不能按用户填写的信息比对？
//   ③ 能比对的话，看哪一项、哪些取值算相符 / 算不符？
//
// 三条硬口径，UI 必须如实表达，不得为了「看起来完整」而含糊：
//   - 原文摘录必填且不改写：判定的唯一依据，机器不猜、不补、不润色。
//   - 「只能人工核对」是一等公民：机器判不了的条款照录不误，
//     结论恒为「无法判定 · 需人工核对」，不逼运营硬塞一个假规则。
//   - 没被点到的取值 ＝ 政策没表达过它 → 判「无法判定」，绝不算「不符合」。
// ============================================================

import { CheckIcon, XIcon } from 'lucide-react'
import { policyRuleDraftError } from '../../services/api/policies'
import type {
  PolicyEligibilityClause,
  PolicyEligibilityQuestion,
  PolicyEligibilityRuleDraft,
  PolicyRuleMatchMode,
} from '../../services/api/policies'

const inputCls =
  'w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-800 placeholder:text-neutral-400 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500'

/** 服务端「不确定」取值：永远不得进相符/不符集合，故不在此处展示为可选。 */
const UNSURE_VALUE = 'unsure'

function Step({ n, title, hint }: { n: number; title: string; hint?: string }) {
  return (
    <div className="mb-2 flex items-start gap-2">
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary-600 text-[11px] font-bold text-white">
        {n}
      </span>
      <div>
        <p className="text-sm font-semibold text-neutral-800">{title}</p>
        {hint && <p className="mt-0.5 text-xs leading-relaxed text-neutral-500">{hint}</p>}
      </div>
    </div>
  )
}

interface Props {
  rule: PolicyEligibilityRuleDraft
  index: number
  questions: PolicyEligibilityQuestion[]
  onChange: (next: PolicyEligibilityRuleDraft) => void
  onRemove: () => void
}

export default function EligibilityRuleEditor({ rule, index, questions, onChange, onRemove }: Props) {
  const err = policyRuleDraftError(rule, questions)
  const isManual = rule.matchMode === 'manual'

  const setMode = (mode: PolicyRuleMatchMode) => {
    // 切到「只能人工核对」时清空比对项：既然承认机器判不了，
    // 就不许再留一个「顺便也比一下」的子句（服务端也会拒）。
    onChange({ ...rule, matchMode: mode, clauses: mode === 'manual' ? [] : rule.clauses })
  }

  const toggleQuestion = (key: string) => {
    const hit = rule.clauses.find((c) => c.questionKey === key)
    const clauses: PolicyEligibilityClause[] = hit
      ? rule.clauses.filter((c) => c.questionKey !== key)
      : [...rule.clauses, { questionKey: key, satisfiedValues: [], conflictValues: [] }]
    onChange({ ...rule, clauses })
  }

  /** 取值三态轮转：未表达 → 算相符 → 算不符 → 未表达 */
  const cycleValue = (key: string, value: string) => {
    const clauses = rule.clauses.map((c) => {
      if (c.questionKey !== key) return c
      const inSat = c.satisfiedValues.includes(value)
      const inCon = c.conflictValues.includes(value)
      if (inSat) {
        return {
          ...c,
          satisfiedValues: c.satisfiedValues.filter((v) => v !== value),
          conflictValues: [...c.conflictValues, value],
        }
      }
      if (inCon) return { ...c, conflictValues: c.conflictValues.filter((v) => v !== value) }
      return { ...c, satisfiedValues: [...c.satisfiedValues, value] }
    })
    onChange({ ...rule, clauses })
  }

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-bold tracking-[0.04em] text-neutral-400">第 {index + 1} 条条件</span>
        <button
          onClick={onRemove}
          className="rounded px-2 py-1 text-xs font-medium text-error-fg hover:bg-error-bg"
        >
          删除本条
        </button>
      </div>

      {/* ① 原文 */}
      <Step
        n={1}
        title="把政策原文里的这一条，原样粘进来"
        hint="一字不改。这段原文是判定的唯一依据，会连同结果一起展示给用户；系统不会替你改写、补全或概括政策口径。"
      />
      <textarea
        className={`${inputCls} mb-3 h-20 resize-none`}
        maxLength={2000}
        placeholder="例：申领对象为本市户籍，或在本市连续缴纳社会保险满 3 个月的人员。"
        value={rule.sourceText}
        onChange={(e) => onChange({ ...rule, sourceText: e.target.value })}
      />
      <input
        className={`${inputCls} mb-4`}
        maxLength={120}
        placeholder="给这一条起个短标题，例：户籍或社保要求"
        value={rule.label}
        onChange={(e) => onChange({ ...rule, label: e.target.value })}
      />

      {/* ② 判定方式 */}
      <Step n={2} title="这一条，机器能按用户填写的信息比对吗？" />
      <div className="mb-4 grid gap-2 sm:grid-cols-2">
        <button
          onClick={() => setMode(rule.matchMode === 'any' ? 'any' : 'all')}
          className={`rounded-lg border p-3 text-left transition-colors ${
            !isManual ? 'border-primary-500 bg-primary-50' : 'border-neutral-200 hover:bg-neutral-50'
          }`}
        >
          <p className="text-sm font-medium text-neutral-800">能比对</p>
          <p className="mt-0.5 text-xs leading-relaxed text-neutral-500">
            条件说的是户籍、毕业年份、参保这类用户自己能填的信息。
          </p>
        </button>
        <button
          onClick={() => setMode('manual')}
          className={`rounded-lg border p-3 text-left transition-colors ${
            isManual ? 'border-warning bg-warning-bg' : 'border-neutral-200 hover:bg-neutral-50'
          }`}
        >
          <p className="text-sm font-medium text-neutral-800">只能人工核对</p>
          <p className="mt-0.5 text-xs leading-relaxed text-neutral-500">
            例：「经街道办核实的困难家庭」「经认定的就业困难人员」。事实在窗口和外部系统里，用户填不出来。
          </p>
        </button>
      </div>

      {isManual ? (
        <p className="rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-xs leading-relaxed text-warning-fg">
          本条会照原文录入，但一体机上恒显示「无法判定 · 需人工核对」，不会给用户任何相符 / 不符的结论。
          这是刻意的：机器判不了的条款，硬凑一个能比对的规则就等于替政策编了一套口径。
        </p>
      ) : (
        <>
          {/* ③ 挑取值 */}
          <Step
            n={3}
            title="这一条看用户填写的哪几项？每项里哪些取值算相符、哪些算不符？"
            hint="点一下取值 = 算相符，再点一下 = 算不符，第三下取消。没点到的取值表示政策没表达过它，会判「无法判定」,不会被算成不符合。"
          />
          <div className="space-y-2">
            {questions.map((q) => {
              const clause = rule.clauses.find((c) => c.questionKey === q.key)
              const picked = Boolean(clause)
              return (
                <div
                  key={q.key}
                  className={`rounded-lg border p-3 ${picked ? 'border-primary-200 bg-primary-50/40' : 'border-neutral-200'}`}
                >
                  <label className="flex cursor-pointer items-center gap-2">
                    <input type="checkbox" checked={picked} onChange={() => toggleQuestion(q.key)} className="h-4 w-4" />
                    <span className="text-sm font-medium text-neutral-800">{q.label}</span>
                    {q.sensitive && (
                      <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500">
                        敏感信息 · 用户可不填
                      </span>
                    )}
                  </label>
                  {picked && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {q.options
                        // 「不确定」不得进任何一侧：用户选它必须落「无法判定」。
                        .filter((o) => o.value !== UNSURE_VALUE)
                        .map((o) => {
                          const sat = clause!.satisfiedValues.includes(o.value)
                          const con = clause!.conflictValues.includes(o.value)
                          return (
                            <button
                              key={o.value}
                              onClick={() => cycleValue(q.key, o.value)}
                              className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition-colors ${
                                sat
                                  ? 'border-success bg-success-bg font-medium text-success-fg'
                                  : con
                                    ? 'border-error bg-error-bg font-medium text-error-fg'
                                    : 'border-neutral-200 text-neutral-500 hover:bg-neutral-50'
                              }`}
                            >
                              {sat && <CheckIcon className="h-3 w-3" />}
                              {con && <XIcon className="h-3 w-3" />}
                              {o.label}
                            </button>
                          )
                        })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>

          {rule.clauses.length > 1 && (
            <div className="mt-3 rounded-lg border border-neutral-200 p-3">
              <p className="mb-1.5 text-xs font-medium text-neutral-600">选了多项，它们之间是什么关系？</p>
              <div className="flex gap-4">
                {(
                  [
                    { v: 'all' as const, t: '都要满足（原文里是「且」）' },
                    { v: 'any' as const, t: '满足任意一项即可（原文里是「或」）' },
                  ]
                ).map((opt) => (
                  <label key={opt.v} className="flex cursor-pointer items-center gap-1.5 text-xs text-neutral-700">
                    <input
                      type="radio"
                      checked={rule.matchMode === opt.v}
                      onChange={() => setMode(opt.v)}
                      className="h-3.5 w-3.5"
                    />
                    {opt.t}
                  </label>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {err && <p className="mt-3 rounded-lg bg-error-bg px-3 py-2 text-xs text-error-fg">还差一步:{err}</p>}
    </div>
  )
}
