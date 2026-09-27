import { useEffect, useRef, useState } from 'react'
import { AlertOctagonIcon, CheckCircle2Icon } from 'lucide-react'
import {
  RECRUITMENT_EMERGENCY_TARGET_LABELS,
  type RecruitmentEmergencyTakedownResult,
} from '@ai-job-print/shared'
import { recruitmentEmergencyService } from '../../../services/api/recruitmentEmergency'
import { userMessageOf } from '../../../services/api/userErrorMessage'
import { EmergencyReasonFields } from './EmergencyReasonFields'
import {
  EMPTY_EMERGENCY_REASON,
  emergencyReasonComplete,
  type EmergencyReasonValue,
  type EmergencyTakedownTarget,
} from './emergencyReason'

const PUBLISH_LABEL: Record<string, string> = {
  unpublished: '已下架',
  published: '已发布',
  draft: '待发布',
  expired: '已过期',
}

/**
 * 单条紧急下架（POST /admin/recruitment-emergency/takedown）。
 *
 * 单向：没有恢复接口；必选事由并填写说明；服务端首次下架时给所属机构写一条通知。
 * 成功与否只按服务端响应展示，响应里的状态不对就如实提示去核对，不自行假定成功。
 */
export function EmergencyTakedownDialog({
  target,
  onClose,
  onDone,
}: {
  target: EmergencyTakedownTarget | null
  onClose: () => void
  /**
   * 服务端确认过的处置，在操作者看完结果、关掉弹窗时调用（页面据此刷新列表）。
   * 不在请求返回时立刻调：有的页面刷新会整页切到加载态，把还没看的结果一起卸掉。
   */
  onDone?: (result: RecruitmentEmergencyTakedownResult) => void
}) {
  const [reason, setReason] = useState<EmergencyReasonValue>(EMPTY_EMERGENCY_REASON)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<RecruitmentEmergencyTakedownResult | null>(null)

  const targetKey = target ? `${target.targetType}:${target.targetId}` : null
  useEffect(() => {
    setReason(EMPTY_EMERGENCY_REASON)
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

  const label = RECRUITMENT_EMERGENCY_TARGET_LABELS[target.targetType]
  const complete = emergencyReasonComplete(reason)

  const submit = async () => {
    if (!emergencyReasonComplete(reason) || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await recruitmentEmergencyService.takedown({
        targetType: target.targetType,
        targetId: target.targetId,
        reasonCode: reason.reasonCode,
        reasonText: reason.reasonText.trim(),
      })
      setResult(res)
    } catch (e) {
      setError(userMessageOf(e, '紧急下架没有成功，内容状态未改变，请稍后重试'))
    } finally {
      setSubmitting(false)
    }
  }

  const statusMismatch = result && result.publishStatus !== 'unpublished'
  const notIrreversible = result && result.irreversible !== true
  const idMismatch = result && (result.targetId !== target.targetId || result.targetType !== target.targetType)

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) close() }}
    >
      <div
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl bg-surface shadow-xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="emergency-takedown-title"
      >
        <div className="border-b border-neutral-100 px-6 py-4">
          <h2 id="emergency-takedown-title" className="flex items-center gap-2 text-base font-semibold text-neutral-900">
            <AlertOctagonIcon className="h-5 w-5 text-error-fg" aria-hidden="true" />
            紧急下架{label}
          </h2>
          <p className="mt-1 truncate text-sm text-neutral-600" title={target.title}>「{target.title}」</p>
          <p className="mt-0.5 text-xs text-neutral-400">
            {target.orgName ? `所属机构：${target.orgName} · ` : ''}编号：{target.targetId}
          </p>
        </div>

        {result ? (
          <div className="space-y-3 px-6 py-5" role="status">
            <p className="flex items-center gap-2 text-sm font-semibold text-success-fg">
              <CheckCircle2Icon className="h-4 w-4" aria-hidden="true" />
              服务端已确认处置
            </p>
            <dl className="grid grid-cols-[6rem_1fr] gap-y-1.5 rounded-lg bg-neutral-50 px-4 py-3 text-sm">
              <dt className="text-neutral-500">内容</dt>
              <dd className="text-neutral-800">{RECRUITMENT_EMERGENCY_TARGET_LABELS[result.targetType] ?? result.targetType}（{result.targetId}）</dd>
              <dt className="text-neutral-500">发布状态</dt>
              <dd className="text-neutral-800">{PUBLISH_LABEL[result.publishStatus] ?? result.publishStatus}</dd>
              <dt className="text-neutral-500">能否恢复</dt>
              <dd className="text-neutral-800">{result.irreversible ? '不能恢复（单向下架）' : '服务端未标记为单向'}</dd>
            </dl>
            {(statusMismatch || notIrreversible || idMismatch) && (
              <p className="rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-xs text-warning-fg" role="alert">
                服务端返回的结果与本次提交不完全一致，请刷新列表核对这条内容的实际状态。
              </p>
            )}
            <p className="text-xs text-neutral-500">
              所属机构会在机构后台工作台的「平台处置通知」里看到这条记录（同一条内容重复下架不会重复通知）。
            </p>
          </div>
        ) : (
          <div className="space-y-4 px-6 py-5">
            <div className="rounded-lg border border-error/30 bg-error-bg px-4 py-3 text-sm text-error-fg">
              <p className="font-semibold">这是单向操作，提交后不能撤销。</p>
              <p className="mt-1">
                内容会立即从一体机与小程序下架并锁定，这一条以后不能再发布；平台没有恢复入口。
              </p>
              <p className="mt-1">系统会自动通知所属机构，事由与说明会一并写入审计。</p>
            </div>
            {error && (
              <p className="rounded-lg bg-error-bg px-3 py-2 text-sm text-error-fg" role="alert">{error}</p>
            )}
            <EmergencyReasonFields idPrefix="emergency-takedown" value={reason} onChange={setReason} disabled={submitting} />
            {!complete && (
              <p className="text-xs text-neutral-500">请先选择事由并填写说明，才能提交。</p>
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
                disabled={!complete || submitting}
                className="rounded-lg bg-error px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? '提交中…' : '确认紧急下架（不可恢复）'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
