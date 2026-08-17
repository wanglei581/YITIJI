// ============================================================
// P21 政策申领条件录入面（合作机构后台）
//
// 解决的问题：后端 P21 已经能做结构化条件比对，但库里一条真实条件都没有 ——
// 没有录入面，能力等于零，所有政策都只会返回「尚未录入可机械比对的条件」。
//
// 四步（沿用本后台 Excel 导入的分步思路，不另造一套交互）：
//   1. 摘原文   把政策原文里的条款原样粘进来
//   2. 定方式   能机器比对 / 只能人工核对
//   3. 挑取值   看哪一项用户信息、哪些取值算相符或不符
//   4. 试算     填一组假想的用户情况，看这条政策会被判成什么
//
// 三条不可退让：
//   - 试算结果由**服务端**算（POST /partner/policies/:id/eligibility-preview），
//     与用户在一体机上拿到的判定是同一条路径。本文件不含任何比对逻辑。
//   - 保存失败如实展示，不显示假的「已保存」。
//   - 保存条件与改政策正文同口径：强制回「待审核 + 待发布」，不绕审核。
// ============================================================

import { useCallback, useEffect, useState } from 'react'
import { Drawer, EmptyState, LoadingState } from '@ai-job-print/ui'
import { ClipboardListIcon, PlayIcon, PlusIcon } from 'lucide-react'
import EligibilityRuleEditor from './EligibilityRuleEditor'
import {
  partnerPoliciesService,
  policyRuleDraftError,
  type PartnerPolicyRecord,
  type PolicyConditionResult,
  type PolicyEligibilityCheckResult,
  type PolicyEligibilityQuestionSet,
  type PolicyEligibilityRuleDraft,
} from '../../services/api/policies'

const RESULT_STYLE: Record<PolicyConditionResult, { cls: string; label: string }> = {
  matched: { cls: 'border-success bg-success-bg text-success-fg', label: '相符' },
  conflict: { cls: 'border-error bg-error-bg text-error-fg', label: '不符' },
  unknown: { cls: 'border-warning bg-warning-bg text-warning-fg', label: '无法判定 · 需人工核对' },
}

const inputCls =
  'w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm text-neutral-800 focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500'

function errMsg(e: unknown): string {
  if (e && typeof e === 'object' && 'message' in e && typeof (e as Error).message === 'string') {
    return (e as Error).message
  }
  return '操作失败,请重试'
}

let draftSeq = 0
const newDraft = (): PolicyEligibilityRuleDraft => ({
  draftKey: `draft-${++draftSeq}`,
  label: '',
  sourceText: '',
  matchMode: 'all',
  clauses: [],
})

interface Props {
  policy: PartnerPolicyRecord
  onClose: () => void
  /** 保存成功后回调：该政策已回到待审核，外层需要刷新列表状态 */
  onSaved: () => void
}

export default function EligibilityRulesDrawer({ policy, onClose, onSaved }: Props) {
  const [questionSet, setQuestionSet] = useState<PolicyEligibilityQuestionSet | null>(null)
  const [rules, setRules] = useState<PolicyEligibilityRuleDraft[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [savedNotice, setSavedNotice] = useState<string | null>(null)

  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [preview, setPreview] = useState<PolicyEligibilityCheckResult | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      const [qs, saved] = await Promise.all([
        partnerPoliciesService.getEligibilityQuestions(),
        partnerPoliciesService.getEligibilityRules(policy.id),
      ])
      setQuestionSet(qs)
      setRules(saved.map((r) => ({ ...r, draftKey: r.id })))
    } catch (e) {
      setLoadError(errMsg(e))
    }
  }, [policy.id])

  useEffect(() => {
    void load()
  }, [load])

  const questions = questionSet?.questions ?? []
  const drafts = rules ?? []
  const firstError = drafts.map((r) => policyRuleDraftError(r, questions)).find(Boolean) ?? null
  const canSave = !saving && rules !== null && !firstError

  const save = async () => {
    if (!rules) return
    setSaving(true)
    setSaveError(null)
    setSavedNotice(null)
    try {
      const persisted = await partnerPoliciesService.replaceEligibilityRules(
        policy.id,
        rules.map((r) => ({
          label: r.label.trim(),
          sourceText: r.sourceText.trim(),
          matchMode: r.matchMode,
          clauses: r.matchMode === 'manual' ? [] : r.clauses,
        })),
      )
      setRules(persisted.map((r) => ({ ...r, draftKey: r.id })))
      // 条件变了，旧的试算结果就不再对应当前库里的条件，必须清掉
      setPreview(null)
      setSavedNotice(
        `已保存 ${persisted.length} 条条件。该政策已回到「待审核 + 待发布」,` +
          '管理员审核通过并重新发布后,一体机上的条件核对才会用上这组条件。',
      )
      onSaved()
    } catch (e) {
      setSaveError(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  const runPreview = async () => {
    setPreviewing(true)
    setPreviewError(null)
    try {
      // 判定完全由服务端做，本文件不做任何比对
      setPreview(await partnerPoliciesService.previewEligibility(policy.id, answers))
    } catch (e) {
      setPreview(null)
      setPreviewError(errMsg(e))
    } finally {
      setPreviewing(false)
    }
  }

  const item = preview?.items[0] ?? null

  return (
    <Drawer
      open
      onClose={onClose}
      title={`申领条件 — ${policy.title}`}
      size="lg"
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-neutral-400">
            {firstError ? `有条件尚未填完:${firstError}` : `共 ${drafts.length} 条条件`}
          </span>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              disabled={saving}
              className="rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
            >
              关闭
            </button>
            <button
              onClick={save}
              disabled={!canSave}
              className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? '保存中…' : '保存条件并重新提审'}
            </button>
          </div>
        </div>
      }
    >
      {loadError ? (
        <div className="space-y-3">
          <p className="rounded-lg bg-error-bg px-3 py-2 text-sm text-error-fg">加载失败:{loadError}</p>
          <button onClick={() => void load()} className="rounded-lg border border-neutral-200 px-3 py-1.5 text-sm text-neutral-600 hover:bg-neutral-50">
            重试
          </button>
        </div>
      ) : rules === null ? (
        <LoadingState text="加载问项与已录条件…" className="py-12" />
      ) : (
        <div className="space-y-4">
          <div className="rounded-lg border border-info/30 bg-info-bg px-3 py-2.5 text-xs leading-relaxed text-info-fg">
            这里录的是可机械比对的申领条件。用户在一体机上填几项自述信息后,系统逐条给出
            「相符 / 不符 / 无法判定」,每条都附上你粘贴的政策原文。系统不做资格认定,也不会替政策补写任何条款。
          </div>

          {drafts.length === 0 ? (
            <EmptyState
              icon={ClipboardListIcon}
              title="这条政策还没有录入申领条件"
              description="在录入之前,一体机上这条政策会如实显示「尚未录入可机械比对的条件,需人工核对」,不会给用户任何判定结论。"
              className="py-10"
            />
          ) : (
            <div className="space-y-3">
              {drafts.map((r, i) => (
                <EligibilityRuleEditor
                  key={r.draftKey}
                  rule={r}
                  index={i}
                  questions={questions}
                  onChange={(next) => setRules((prev) => (prev ?? []).map((x) => (x.draftKey === r.draftKey ? next : x)))}
                  onRemove={() => setRules((prev) => (prev ?? []).filter((x) => x.draftKey !== r.draftKey))}
                />
              ))}
            </div>
          )}

          <button
            onClick={() => setRules((prev) => [...(prev ?? []), newDraft()])}
            className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-neutral-300 py-2.5 text-sm font-medium text-neutral-600 hover:bg-neutral-50"
          >
            <PlusIcon className="h-4 w-4" />
            添加一条条件
          </button>

          {saveError && (
            <p className="rounded-lg bg-error-bg px-3 py-2 text-sm text-error-fg">保存失败:{saveError}</p>
          )}
          {savedNotice && (
            <p className="rounded-lg border border-success/30 bg-success-bg px-3 py-2 text-sm text-success-fg">{savedNotice}</p>
          )}

          {/* ── 第 4 步:试算 ─────────────────────────────────────────────── */}
          <div className="rounded-xl border border-neutral-200 bg-neutral-50/60 p-4">
            <p className="text-sm font-semibold text-neutral-800">4. 试算:填一组假想的用户情况看看</p>
            <p className="mb-3 mt-0.5 text-xs leading-relaxed text-neutral-500">
              试算的是已保存的条件,判定由服务端完成,与用户在一体机上拿到的结论走同一条路径。
              改动上面的条件后要先保存,试算才会反映改动。
            </p>

            <div className="grid gap-2 sm:grid-cols-2">
              {questions.map((q) => (
                <label key={q.key} className="block">
                  <span className="mb-1 block text-xs font-medium text-neutral-600">{q.label}</span>
                  <select
                    className={inputCls}
                    value={answers[q.key] ?? ''}
                    onChange={(e) =>
                      setAnswers((prev) => {
                        const next = { ...prev }
                        if (e.target.value) next[q.key] = e.target.value
                        else delete next[q.key]
                        return next
                      })
                    }
                  >
                    <option value="">（不填）</option>
                    {q.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>

            <button
              onClick={() => void runPreview()}
              disabled={previewing}
              className="mt-3 flex items-center gap-1.5 rounded-lg bg-neutral-800 px-3 py-2 text-sm font-medium text-white hover:bg-neutral-900 disabled:opacity-50"
            >
              <PlayIcon className="h-3.5 w-3.5" />
              {previewing ? '试算中…' : '试算这条政策'}
            </button>

            {previewError && (
              <p className="mt-3 rounded-lg bg-error-bg px-3 py-2 text-sm text-error-fg">试算失败:{previewError}</p>
            )}

            {item && (
              <div className="mt-3 space-y-2">
                <p className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700">
                  {item.overallLabel}
                </p>
                {item.conditions.map((c) => {
                  const style = RESULT_STYLE[c.result]
                  return (
                    <div key={c.ruleId} className={`rounded-lg border px-3 py-2 ${style.cls}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium">{c.label}</span>
                        <span className="shrink-0 text-xs font-semibold">{style.label}</span>
                      </div>
                      <p className="mt-1 text-xs leading-relaxed opacity-90">{c.reason}</p>
                      <p className="mt-1 border-t border-black/10 pt-1 text-[11px] leading-relaxed opacity-70">
                        依据原文:{c.sourceText}
                      </p>
                    </div>
                  )
                })}
                <p className="text-[11px] leading-relaxed text-neutral-400">{preview?.disclaimer}</p>
              </div>
            )}
          </div>

          {questionSet && (
            <p className="text-[11px] leading-relaxed text-neutral-400">
              问项字典版本 {questionSet.questionSetVersion}(由服务端下发)。
              {questionSet.privacyNotice}
            </p>
          )}
        </div>
      )}
    </Drawer>
  )
}
