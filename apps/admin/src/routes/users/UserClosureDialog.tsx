import type { AdminUserClosureRequest, AdminUserClosureResult, AdminUserListItem } from '@ai-job-print/shared'
import { type KeyboardEvent, useEffect, useRef, useState } from 'react'
import { closeUserAccount, type ClosureBlockingOrder } from '../../services/api/adminUsers'
import { CLOSURE_CONSEQUENCES, closureFailure, closureOrderStatus, validateClosure, type ClosureFieldErrors } from './userClosurePresentation'
import { hasPendingClosure } from './userPresentation'

const inputCls = 'w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500'
const focusSelector = 'button:not([disabled]),input:not([disabled]),textarea:not([disabled]),a[href]'

function FieldError({ message }: { message?: string }) {
  return message ? (
    <p role="alert" className="mt-1 text-sm text-red-700">
      {message}
    </p>
  ) : null
}

export function UserClosureDialog({ user, onClose, onSuccess }: { user: AdminUserListItem; onClose: () => void; onSuccess: (result: AdminUserClosureResult) => void }) {
  // closing 的 handling 记录允许同来源重试；它不是一条新的本人申请。
  const memberSourceAvailable = hasPendingClosure(user) || (user.status === 'closing' && user.closureRequest?.source === 'member_request')
  const [input, setInput] = useState<AdminUserClosureRequest>({
    source: memberSourceAvailable ? 'member_request' : 'offline',
    reasonText: '',
    phoneLast4: '',
    offlineEvidenceNo: '',
  })
  const [step, setStep] = useState<'fill' | 'confirm'>('fill')
  const [acknowledged, setAcknowledged] = useState(false)
  const [busy, setBusy] = useState(false)
  const [fields, setFields] = useState<ClosureFieldErrors>({})
  const [error, setError] = useState<string | null>(null)
  const [orders, setOrders] = useState<ClosureBlockingOrder[]>([])
  const submitting = useRef(false)
  const dialogRef = useRef<HTMLDivElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    titleRef.current?.focus()
  }, [step])

  const close = () => {
    if (!submitting.current) onClose()
  }
  const change = <K extends keyof AdminUserClosureRequest>(key: K, value: AdminUserClosureRequest[K]) => {
    setInput((current) => ({ ...current, [key]: value }))
    setFields((current) => ({ ...current, [key]: undefined }))
  }
  const next = () => {
    const validation = validateClosure(input)
    setFields(validation)
    if (Object.keys(validation).length) return
    setAcknowledged(false)
    setStep('confirm')
  }
  const submit = async () => {
    if (submitting.current || step !== 'confirm' || !acknowledged) return
    const validation = validateClosure(input)
    if (Object.keys(validation).length) {
      setFields(validation)
      setStep('fill')
      return
    }
    submitting.current = true
    setBusy(true)
    setError(null)
    setOrders([])
    try {
      const result = await closeUserAccount(user.id, {
        source: input.source,
        reasonText: input.reasonText.trim(),
        phoneLast4: input.phoneLast4,
        ...(input.source === 'offline' ? { offlineEvidenceNo: input.offlineEvidenceNo?.trim() } : {}),
      })
      onSuccess(result)
    } catch (caught) {
      const failure = closureFailure(caught)
      setFields(failure.fields)
      setError(Object.keys(failure.fields).length ? null : failure.message)
      setOrders(failure.orders)
      // 包括 503 在内的失败均保留输入，回到填写步骤以便核对或原样重试。
      setAcknowledged(false)
      setStep('fill')
    } finally {
      submitting.current = false
      setBusy(false)
    }
  }
  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      close()
      return
    }
    if (event.key !== 'Tab') return
    const nodes = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(focusSelector) ?? [])
    const first = nodes[0],
      last = nodes[nodes.length - 1]
    const active = document.activeElement
    if (!first || !last) {
      event.preventDefault()
      titleRef.current?.focus()
      return
    }
    if (active === titleRef.current || (event.shiftKey && active === first) || (!event.shiftKey && active === last)) {
      event.preventDefault()
      ;(event.shiftKey ? last : first).focus()
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) close()
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="注销账号"
        onKeyDown={keyDown}
        className="flex max-h-[90dvh] w-full max-w-xl flex-col rounded-xl bg-white shadow-xl"
      >
        <h2 ref={titleRef} tabIndex={-1} className="border-b border-neutral-100 px-6 py-4 text-base font-semibold outline-none">
          注销账号 · {step === 'fill' ? '填写办理信息' : '再次确认'}
        </h2>
        <div className="space-y-4 overflow-y-auto px-6 py-5 text-sm">
          {error && (
            <div role="alert" className="rounded-lg bg-red-50 p-3 text-red-700">
              <p>{error}</p>
              {orders.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5">
                  {orders.map((order, index) => (
                    <li key={`${order.orderNo}-${index}`}>
                      <span className="font-mono">{order.orderNo}</span> · {closureOrderStatus(order.status)}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {step === 'fill' ? (
            <fieldset disabled={busy} className="space-y-4">
              <div>
                <p className="mb-2 font-medium">
                  办理来源 <span className="text-red-600">*</span>
                </p>
                <label className="mb-2 flex items-center gap-2">
                  <input
                    type="radio"
                    name="closure-source"
                    value="member_request"
                    checked={input.source === 'member_request'}
                    disabled={!memberSourceAvailable}
                    onChange={() => change('source', 'member_request')}
                  />
                  按本人申请执行
                </label>
                {!memberSourceAvailable && <p className="mb-2 text-xs text-neutral-500">该会员没有待处理的注销申请</p>}
                <label className="flex items-center gap-2">
                  <input type="radio" name="closure-source" value="offline" checked={input.source === 'offline'} onChange={() => change('source', 'offline')} />
                  凭线下申请办理
                </label>
                <FieldError message={fields.source} />
              </div>
              <div>
                <label className="block font-medium" htmlFor="closure-reason">
                  事由 *
                </label>
                <textarea
                  id="closure-reason"
                  required
                  minLength={1}
                  maxLength={200}
                  value={input.reasonText}
                  onChange={(event) => change('reasonText', event.target.value)}
                  className={`${inputCls} mt-1 h-20 resize-none`}
                />
                <p className="text-right text-xs text-neutral-500">{input.reasonText.length}/200</p>
                <FieldError message={fields.reasonText} />
              </div>
              <div>
                <label className="block font-medium" htmlFor="closure-phone">
                  手机尾号四位 *
                </label>
                <input
                  id="closure-phone"
                  required
                  type="text"
                  inputMode="numeric"
                  autoComplete="off"
                  pattern="[0-9]{4}"
                  maxLength={4}
                  value={input.phoneLast4}
                  onChange={(event) => change('phoneLast4', event.target.value.replace(/\D/g, '').slice(0, 4))}
                  className={`${inputCls} mt-1`}
                />
                <p className="mt-1 text-xs text-neutral-500">请会员说出手机后四位，用来确认是这位用户、防止点错（不作身份核验）</p>
                <FieldError message={fields.phoneLast4} />
              </div>
              {input.source === 'offline' && (
                <div>
                  <label className="block font-medium" htmlFor="closure-evidence">
                    线下凭据编号 *
                  </label>
                  <input
                    id="closure-evidence"
                    required
                    minLength={1}
                    maxLength={64}
                    autoComplete="off"
                    value={input.offlineEvidenceNo ?? ''}
                    onChange={(event) => change('offlineEvidenceNo', event.target.value)}
                    className={`${inputCls} mt-1`}
                  />
                  <p className="mt-1 text-xs text-neutral-500">纸质申请单或工单的编号。请先在凭据上核对是会员本人。</p>
                  <FieldError message={fields.offlineEvidenceNo} />
                </div>
              )}
            </fieldset>
          ) : (
            <>
              <p className="rounded-lg bg-neutral-50 p-3 text-neutral-700">
                将要注销的账号：<span className="font-medium text-neutral-900">{user.nickname || '未设置昵称'}</span> · {user.maskedPhone}
                <span className="ml-2 text-neutral-500">（{input.source === 'offline' ? '凭线下申请办理' : '按本人申请执行'}）</span>
              </p>
              <h3 className="font-semibold text-neutral-900">注销后会发生什么</h3>
              {CLOSURE_CONSEQUENCES.map(([title, text]) => (
                <section key={title} className="rounded-lg border border-neutral-200 p-3">
                  <h4 className="mb-1 font-semibold">{title}</h4>
                  <p className="leading-6 text-neutral-700">{text}</p>
                </section>
              ))}
              <label className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-amber-900">
                <input type="checkbox" checked={acknowledged} disabled={busy} onChange={(event) => setAcknowledged(event.target.checked)} className="mt-1" />
                我已确认是这位用户，知道注销后不能恢复
              </label>
            </>
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-neutral-100 px-6 py-4">
          <button type="button" disabled={busy} onClick={close} className="rounded-lg border border-neutral-200 px-4 py-2 disabled:opacity-50">
            取消
          </button>
          {step === 'confirm' && (
            <button type="button" disabled={busy} onClick={() => setStep('fill')} className="rounded-lg border border-neutral-200 px-4 py-2 disabled:opacity-50">
              返回填写
            </button>
          )}
          {step === 'fill' ? (
            <button type="button" disabled={busy} onClick={next} className="rounded-lg bg-primary-600 px-4 py-2 text-white disabled:opacity-50">
              下一步
            </button>
          ) : (
            <button
              type="button"
              disabled={busy || !acknowledged}
              onClick={() => void submit()}
              className="rounded-lg bg-red-600 px-4 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? '提交中…' : '确认注销'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
