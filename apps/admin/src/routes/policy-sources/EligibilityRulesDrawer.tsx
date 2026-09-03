// ============================================================
// P21 政策申领条件 —— 管理员只读复核抽屉
//
// 解决的问题：机构能在合作机构后台给政策配申领条件（户籍、参保、失业登记…），
// 后端也有 GET /admin/policy-sources/:id/eligibility-rules 供管理员复核，
// 但审核页一直没接 —— 管理员在不知道申领门槛的情况下点「审核通过」，
// 可能把不该过的政策发到一体机上。
//
// 本文件**只读**：不改条件、不删条件、不做试算。条件的唯一录入口在
// 合作机构后台（PUT /partner/policies/:id/eligibility-rules），
// 改条件会把政策强制打回「待审核 + 待发布」，所以管理员这一侧动手改
// 既越权也会绕过那条重审约束。
//
// 措辞逐字沿用录入面（apps/partner/src/routes/policy/EligibilityRuleEditor.tsx）：
// 「能比对 / 只能人工核对」「算相符 / 算不符」「都要满足（原文里是「且」）」。
// 两端叫法一旦不同，机构说的和审核的人看的就对不上账。
//
// ── 本文件最关键的一条 ──────────────────────────────────────────────────────
// 「这条政策没有申领限制」和「条件没读到」必须在界面上截然可分。
// 混同的后果是具体的：管理员看到一个空白面板，默认这条政策无门槛就放行。
// 因此：请求成功 + 空数组 → 明确说「机构确实没录入」；
//       请求失败 → 红框明确说「没读到，不等于没有条件」，并给重试，
//       且**不显示**任何条件区，避免半张空白页被读成「无条件」。
// ============================================================

import { useCallback, useEffect, useState } from 'react'
import { Drawer, EmptyState, LoadingState } from '@ai-job-print/ui'
import { AlertTriangleIcon, ClipboardListIcon } from 'lucide-react'
import {
  policiesAdminService,
  type AdminPolicyRecord,
  type PolicyEligibilityClause,
  type PolicyEligibilityQuestion,
  type PolicyEligibilityQuestionSet,
  type PolicyEligibilityRuleRecord,
} from '../../services/api/policiesAdmin'

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e && typeof (e as Error).message === 'string') {
    return (e as Error).message
  }
  return '未知错误'
}

/** 取值 → 中文名称。问项字典没下发到、或取值已漂移时如实回退到服务端标识。 */
function optionLabel(question: PolicyEligibilityQuestion | undefined, value: string): string {
  const hit = question?.options.find((o) => o.value === value)
  return hit ? hit.label : value
}

function ValueChips({
  values,
  tone,
  question,
}: {
  values: string[]
  tone: 'satisfied' | 'conflict'
  question: PolicyEligibilityQuestion | undefined
}) {
  if (values.length === 0) return null
  const cls =
    tone === 'satisfied'
      ? 'border-success bg-success-bg text-success-fg'
      : 'border-error bg-error-bg text-error-fg'
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
      <span className="text-[11px] font-medium text-neutral-500">
        {tone === 'satisfied' ? '算相符：' : '算不符：'}
      </span>
      {values.map((v) => (
        <span key={v} className={`rounded-full border px-2 py-0.5 text-xs font-medium ${cls}`}>
          {optionLabel(question, v)}
        </span>
      ))}
    </div>
  )
}

function ClauseCard({
  clause,
  question,
  dictLoaded,
}: {
  clause: PolicyEligibilityClause
  question: PolicyEligibilityQuestion | undefined
  /**
   * 问项字典是否成功下发。
   * 「字典没读到」和「字典里确实没有这一项（取值漂移）」是两回事:
   * 前者由顶部整块警示说明,不该在每一条子句上重复标成「漂移」——
   * 那会把一次网络失败误报成数据不一致,审核的人会去追一个不存在的问题。
   */
  dictLoaded: boolean
}) {
  return (
    <div className="rounded-lg border border-neutral-200 p-2.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-sm font-medium text-neutral-800">{question ? question.label : clause.questionKey}</span>
        {question?.sensitive && (
          <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] text-neutral-500">
            敏感信息 · 用户可不填
          </span>
        )}
        {dictLoaded && !question && (
          <span className="rounded bg-warning-bg px-1.5 py-0.5 text-[10px] text-warning-fg">
            问项字典里没有这一项
          </span>
        )}
      </div>
      <ValueChips values={clause.satisfiedValues} tone="satisfied" question={question} />
      <ValueChips values={clause.conflictValues} tone="conflict" question={question} />
    </div>
  )
}

function RuleCard({
  rule,
  index,
  questions,
}: {
  rule: PolicyEligibilityRuleRecord
  index: number
  questions: PolicyEligibilityQuestion[] | null
}) {
  const isManual = rule.matchMode === 'manual'
  return (
    <div className="rounded-xl border border-neutral-200 bg-surface p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs font-bold tracking-[0.04em] text-neutral-400">第 {index + 1} 条条件</span>
        <span
          className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
            isManual ? 'border-warning bg-warning-bg text-warning-fg' : 'border-neutral-200 bg-neutral-50 text-neutral-600'
          }`}
        >
          {isManual ? '只能人工核对' : '能比对'}
        </span>
      </div>

      <p className="text-sm font-semibold text-neutral-800">{rule.label}</p>

      <p className="mt-2 text-[11px] font-medium tracking-[0.04em] text-neutral-400">
        政策原文摘录（判定的唯一依据，由机构原样粘贴）
      </p>
      <p className="mt-1 whitespace-pre-wrap rounded-lg bg-neutral-50 px-3 py-2 text-xs leading-relaxed text-neutral-700">
        {rule.sourceText}
      </p>

      {isManual ? (
        <p className="mt-3 rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-xs leading-relaxed text-warning-fg">
          本条照原文录入，一体机上恒显示「无法判定 · 需人工核对」，不会给用户任何相符 / 不符的结论。
        </p>
      ) : (
        <>
          <p className="mt-3 text-[11px] font-medium tracking-[0.04em] text-neutral-400">
            看用户填写的哪几项
          </p>
          {rule.clauses.length === 0 ? (
            <p className="mt-1 rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-xs leading-relaxed text-warning-fg">
              本条标为「能比对」却没有任何比对项，一体机上不会产出任何相符 / 不符结论。
              请退回机构补齐比对项，或让机构改标为「只能人工核对」。
            </p>
          ) : (
            <div className="mt-1 space-y-2">
              {rule.clauses.map((c) => (
                <ClauseCard
                  key={c.questionKey}
                  clause={c}
                  question={questions?.find((q) => q.key === c.questionKey)}
                  dictLoaded={questions !== null}
                />
              ))}
            </div>
          )}
          {rule.clauses.length > 1 && (
            <p className="mt-2 text-xs text-neutral-500">
              多项之间：
              {rule.matchMode === 'any' ? '满足任意一项即可（原文里是「或」）' : '都要满足（原文里是「且」）'}
            </p>
          )}
        </>
      )}
    </div>
  )
}

interface Props {
  policy: AdminPolicyRecord
  onClose: () => void
}

export default function EligibilityRulesDrawer({ policy, onClose }: Props) {
  const [loading, setLoading] = useState(true)
  // rules 与 rulesError 严格互斥：null + 无错 只可能出现在加载中。
  const [rules, setRules] = useState<PolicyEligibilityRuleRecord[] | null>(null)
  const [rulesError, setRulesError] = useState<string | null>(null)
  // 问项字典独立失败：条件读到了但翻不出中文，仍然展示条件（回退成服务端标识），
  // 不因为「名称不好看」而把已读到的条件藏起来。
  const [questionSet, setQuestionSet] = useState<PolicyEligibilityQuestionSet | null>(null)
  const [questionsError, setQuestionsError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setRulesError(null)
    setQuestionsError(null)
    const [rulesRes, questionsRes] = await Promise.allSettled([
      policiesAdminService.getEligibilityRules(policy.id),
      policiesAdminService.getEligibilityQuestions(),
    ])
    if (rulesRes.status === 'fulfilled') {
      setRules(rulesRes.value)
    } else {
      setRules(null)
      setRulesError(errMsg(rulesRes.reason))
    }
    if (questionsRes.status === 'fulfilled') {
      setQuestionSet(questionsRes.value)
    } else {
      setQuestionSet(null)
      setQuestionsError(errMsg(questionsRes.reason))
    }
    setLoading(false)
  }, [policy.id])

  useEffect(() => {
    void load()
  }, [load])

  const questions = questionSet?.questions ?? null

  const footerNote = loading
    ? '读取中…'
    : rulesError !== null
      ? '条件未读到'
      : `共 ${rules?.length ?? 0} 条条件`

  return (
    <Drawer
      open
      onClose={onClose}
      title={`申领条件 — ${policy.title}`}
      size="lg"
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-neutral-400">{footerNote}</span>
          <button
            onClick={onClose}
            className="rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50"
          >
            关闭
          </button>
        </div>
      }
    >
      {loading ? (
        <LoadingState text="读取已录入的申领条件…" className="py-12" />
      ) : rulesError !== null ? (
        // ① 接口失败：绝不留一片空白让人读成「没有条件」
        <div className="space-y-3">
          <div className="rounded-lg border border-error/40 bg-error-bg px-3 py-3">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-error-fg">
              <AlertTriangleIcon className="h-4 w-4 shrink-0" />
              申领条件没有读取到
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-error-fg">失败原因：{rulesError}</p>
            <p className="mt-2 border-t border-error/20 pt-2 text-xs leading-relaxed text-error-fg">
              这<span className="font-semibold">不等于</span>「这条政策没有申领限制」——
              只是本次没读到。请先重试；仍失败请联系技术排查，不要据此认定这条政策无门槛就放行。
            </p>
          </div>
          <button
            onClick={() => void load()}
            className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50"
          >
            重试
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg border border-info/30 bg-info-bg px-3 py-2.5 text-xs leading-relaxed text-info-fg">
            本页只读。申领条件由来源机构在合作机构后台录入；机构改条件后，这条政策会自动回到「待审核 + 待发布」重审。
            审核前请对照政策原文核对：条件是否与原文一致、有没有漏录。
          </div>

          {questionsError !== null && (
            <p className="rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-xs leading-relaxed text-warning-fg">
              问项字典没读到（{questionsError}）。下面的比对项与取值只能显示服务端标识，不是中文名称；
              条件本身已如实读到，可继续核对原文。
            </p>
          )}

          {(rules?.length ?? 0) === 0 ? (
            // ② 读取成功但空：明确是「机构没录」，不是「没读到」
            <EmptyState
              icon={ClipboardListIcon}
              title="这条政策没有录入申领条件"
              description={
                '已成功读取，机构确实一条都没录（不是加载失败）。一体机上这条政策会如实显示' +
                '「该政策尚未录入可机械比对的条件，本次未做条件核对，需人工核对」。' +
                '审核前请对照政策原文确认：是确实没有申领门槛，还是机构漏录了。'
              }
              className="py-10"
            />
          ) : (
            // ③ 有条件
            <div className="space-y-3">
              {rules!.map((r, i) => (
                <RuleCard key={r.id} rule={r} index={i} questions={questions} />
              ))}
            </div>
          )}

          <p className="text-[11px] leading-relaxed text-neutral-400">
            条件核对是参考不是裁定：一体机只给出「已录入条件的比对结果」，不做资格认定、不代办、不收费。
            {questionSet && `问项字典版本 ${questionSet.questionSetVersion}（由服务端下发）。`}
          </p>
        </div>
      )}
    </Drawer>
  )
}
