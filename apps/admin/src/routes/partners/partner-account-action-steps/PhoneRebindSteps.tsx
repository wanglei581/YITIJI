import { useEffect, useRef, useState } from 'react'
import type { UsePartnerAccountActionResult } from '../usePartnerAccountAction'

const inputCls = 'w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500'
const primaryCls = 'rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50'

function secondsLeft(deadline: number, nowMs: number): number {
  return deadline > 0 ? Math.max(0, Math.ceil((deadline - nowMs) / 1_000)) : 0
}

export function PhoneRebindSteps({ flow }: { flow: UsePartnerAccountActionResult }) {
  const [newPhone, setNewPhone] = useState('')
  const [code, setCode] = useState('')
  const lastAutoSubmittedCodeRef = useRef('')

  useEffect(() => {
    setNewPhone('')
    setCode('')
  }, [flow.state.step])

  useEffect(() => {
    if (code.length !== 6) {
      lastAutoSubmittedCodeRef.current = ''
      return
    }
    if (
      (flow.state.step !== 'new_phone_sms_verify' && flow.state.step !== 'rebind_committing')
      || flow.state.busy
      || lastAutoSubmittedCodeRef.current === code
    ) return
    lastAutoSubmittedCodeRef.current = code
    const submittedCode = code
    void flow.verifyNewPhone(submittedCode).finally(() => setCode(''))
  }, [code, flow])

  if (flow.state.step === 'new_phone_input') {
    const ticketRemaining = secondsLeft(flow.actionTicketDeadline, flow.nowMs)
    return (
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          const phone = newPhone
          void flow.startRebind(phone).finally(() => setNewPhone(''))
        }}
      >
        <p className="text-sm text-neutral-600">旧因子已验证，操作授权剩余 {ticketRemaining} 秒。</p>
        <label className="block text-sm font-medium text-neutral-700" htmlFor="partner-action-new-phone">新手机号</label>
        <input
          id="partner-action-new-phone"
          name="partner-new-phone"
          inputMode="numeric"
          autoComplete="tel"
          data-autofocus
          className={inputCls}
          value={newPhone}
          onChange={(event) => setNewPhone(event.target.value.replace(/\D/g, '').slice(0, 11))}
        />
        <div className="flex justify-end">
          <button className={primaryCls} disabled={flow.state.busy || !/^1[3-9]\d{9}$/.test(newPhone)}>发送新手机号验证码</button>
        </div>
      </form>
    )
  }

  if (flow.state.step === 'new_phone_sms_verify' || flow.state.step === 'rebind_committing') {
    const ticketRemaining = secondsLeft(flow.rebindTicketDeadline, flow.nowMs)
    const resendRemaining = secondsLeft(flow.resendAvailableAt, flow.nowMs)
    return (
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          const submittedCode = code
          if (flow.state.busy || lastAutoSubmittedCodeRef.current === submittedCode) return
          lastAutoSubmittedCodeRef.current = submittedCode
          void flow.verifyNewPhone(submittedCode).finally(() => setCode(''))
        }}
      >
        <p className="text-sm text-neutral-600">
          验证码已发送至 {flow.phoneMasked ?? '新手机号'}，换绑票据剩余 {ticketRemaining} 秒。
        </p>
        <label className="block text-sm font-medium text-neutral-700" htmlFor="partner-action-new-phone-code">新手机号验证码</label>
        <input
          id="partner-action-new-phone-code"
          name="partner-new-phone-code"
          autoComplete="one-time-code"
          inputMode="numeric"
          data-autofocus
          className={inputCls}
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
        />
        <div className="flex flex-wrap justify-between gap-2">
          <button
            type="button"
            className="rounded-lg border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-700 disabled:opacity-50"
            disabled={flow.state.busy || resendRemaining > 0}
            onClick={() => void flow.resendNewPhoneCode()}
          >
            {resendRemaining > 0 ? `${resendRemaining} 秒后重新发送` : '重新发送验证码'}
          </button>
          <button className={primaryCls} disabled={flow.state.busy || code.length !== 6}>
            {flow.state.busy ? '换绑中…' : '验证并完成换绑'}
          </button>
        </div>
      </form>
    )
  }

  return null
}
