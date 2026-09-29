import { useEffect, useRef, useState } from 'react'
import { CheckCircle2Icon, ZapOffIcon } from 'lucide-react'
import type { RecruitmentCircuitBreakResult, RecruitmentCircuitBreakScope } from '@ai-job-print/shared'
import { recruitmentEmergencyService } from '../../../services/api/recruitmentEmergency'
import { userMessageOf } from '../../../services/api/userErrorMessage'
import { EmergencyReasonFields } from './EmergencyReasonFields'
import { EMPTY_EMERGENCY_REASON, emergencyReasonComplete, type EmergencyReasonValue } from './emergencyReason'

export interface CircuitBreakTarget {
  scope: RecruitmentCircuitBreakScope
  id: string
  name: string
  /** 来源熔断时显示它所属的机构，便于核对对象 */
  orgName?: string
}

const SCOPE_COPY: Record<RecruitmentCircuitBreakScope, { title: string; noun: string; effect: string }> = {
  org: {
    title: '按机构熔断',
    noun: '机构',
    effect: '该机构名下的岗位、招聘会、招聘会资料、企业资料、线下机构与政策会全部下架并锁定，今后也不能再发布或同步。',
  },
  source: {
    title: '按来源熔断',
    noun: '来源',
    effect: '该来源会被停用，它导入的岗位、招聘会与招聘会资料全部下架并锁定，今后不能再同步或发布。',
  },
}

/**
 * 按机构或按来源熔断（POST /admin/recruitment-emergency/circuit-break）。
 *
 * 这是应急处置，不是日常批量工具：一次只对一个机构或一个来源；必选事由并填写说明；
 * 另要显式勾选「不可撤销」。结果只按服务端响应展示。
 */
export function CircuitBreakDialog({
  target,
  onClose,
  onDone,
}: {
  target: CircuitBreakTarget | null
  onClose: () => void
  /** 服务端确认过的熔断，在操作者看完结果、关掉弹窗时调用（理由同紧急下架弹窗）。 */
  onDone?: (result: RecruitmentCircuitBreakResult) => void
}) {
  const [reason, setReason] = useState<EmergencyReasonValue>(EMPTY_EMERGENCY_REASON)
  const [acknowledged, setAcknowledged] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RecruitmentCircuitBreakResult | null>(null)

  const targetKey = target ? `${target.scope}:${target.id}` : null
  useEffect(() => {
    setReason(EMPTY_EMERGENCY_REASON)
    setAcknowledged(false)
    setSubmitting(false)
    setError(null)
    setResult(null)
  }, [targetKey])

  // 关弹窗的唯一出口：有已确认的结果时先交给页面刷新，再关。
  const close = () => {
    if (submitting) return
    if (result) onDone?.(result)
    onClose()
  }
  const closeRef = useRef(close)
  useEffect(() => { closeRef.current = close })

  // 捕获阶段挂在 window 上并截住 Escape：弹窗可能叠在抽屉上，抽屉自己也监听 Escape，
  // 不截住的话一次 Escape 会把下面的抽屉一起关掉。
  useEffect(() => {
    if (!target) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      closeRef.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [target])

  if (!target) return null

  const copy = SCOPE_COPY[target.scope]
  const ready = emergencyReasonComplete(reason) && acknowledged

  const submit = async () => {
    if (!emergencyReasonComplete(reason) || !acknowledged || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await recruitmentEmergencyService.circuitBreak({
        scope: target.scope,
        id: target.id,
        reasonCode: reason.reasonCode,
        reasonText: reason.reasonText.trim(),
      })
      setResult(res)
    } catch (e) {
      setError(userMessageOf(e, '熔断没有成功，状态未改变，请稍后重试'))
    } finally {
      setSubmitting(false)
    }
  }

  const mismatch = result && (result.id !== target.id || result.scope !== target.scope || result.irreversible !== true)

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) close() }}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-surface shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="circuit-break-title"
      >
        <div className="border-b border-neutral-100 px-6 py-4">
          <h2 id="circuit-break-title" className="flex items-center gap-2 text-base font-semibold text-neutral-900">
            <ZapOffIcon className="h-5 w-5 text-error-fg" aria-hidden="true" />
            {copy.title}
          </h2>
          <p className="mt-1 truncate text-sm text-neutral-600" title={target.name}>{copy.noun}：{target.name}</p>
          <p className="mt-0.5 text-xs text-neutral-400">
            {target.orgName ? `所属机构：${target.orgName} · ` : ''}编号：{target.id}
          </p>
        </div>

        {result ? (
          <div className="space-y-3 px-6 py-5" role="status">
            <p className="flex items-center gap-2 text-sm font-semibold text-success-fg">
              <CheckCircle2Icon className="h-4 w-4" aria-hidden="true" />
              服务端已确认熔断
            </p>
            <dl className="grid grid-cols-[7rem_1fr] gap-y-1.5 rounded-lg bg-neutral-50 px-4 py-3 text-sm">
              <dt className="text-neutral-500">熔断范围</dt>
              <dd className="text-neutral-800">{SCOPE_COPY[result.scope]?.noun ?? result.scope}（{result.id}）</dd>
              <dt className="text-neutral-500">本次下架并锁定</dt>
              <dd className="tabular-nums text-neutral-800">{result.unpublished} 条内容</dd>
              <dt className="text-neutral-500">能否撤销</dt>
              <dd className="text-neutral-800">{result.irreversible ? '不能撤销' : '服务端未标记为不可撤销'}</dd>
            </dl>
            {mismatch && (
              <p className="rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-xs text-warning-fg" role="alert">
                服务端返回的结果与本次提交不完全一致，请刷新页面核对熔断是否生效。
              </p>
            )}
            <p className="text-xs text-neutral-500">
              受影响的每一条内容都会给所属机构发一条处置通知；机构在工作台的「平台处置通知」里可以看到。
            </p>
          </div>
        ) : (
          <div className="space-y-4 px-6 py-5">
            <div className="rounded-lg border border-error/30 bg-error-bg px-4 py-3 text-sm text-error-fg">
              <p className="font-semibold">熔断不可撤销，平台没有恢复入口。</p>
              <p className="mt-1">{copy.effect}</p>
              <p className="mt-1">只用于违法内容、主管部门要求等紧急情况，不是日常批量工具；系统会自动通知受影响的机构。</p>
            </div>
            {error && (
              <p className="rounded-lg bg-error-bg px-3 py-2 text-sm text-error-fg" role="alert">{error}</p>
            )}
            <EmergencyReasonFields idPrefix="circuit-break" value={reason} onChange={setReason} disabled={submitting} />
            <label className="flex items-start gap-2 rounded-lg border border-neutral-200 px-3 py-2.5 text-sm text-neutral-700">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4"
                checked={acknowledged}
                disabled={submitting}
                onChange={(e) => setAcknowledged(e.target.checked)}
              />
              <span>我已确认：熔断「{target.name}」不可撤销，其内容会全部下架并永久锁定。</span>
            </label>
            {!ready && (
              <p className="text-xs text-neutral-500">请先选择事由、填写说明，并勾选不可撤销确认。</p>
            )}
          </div>
        )}

        <div className="flex justify-end gap-2 border-t border-neutral-100 px-6 py-4">
          {result ? (
            <button
              type="button"
              onClick={close}
              className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white hover:bg-primary-700"
            >
              完成
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={close}
                disabled={submitting}
                className="rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void submit()}
                disabled={!ready || submitting}
                className="rounded-lg bg-error px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? '提交中…' : '确认熔断（不可撤销）'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
