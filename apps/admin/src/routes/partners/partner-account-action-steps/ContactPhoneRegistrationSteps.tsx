import { useEffect, useState, type FormEvent } from 'react'
import { contactPhoneRegistrationFieldError } from '../../../services/api/registerPartnerContactPhone'
import type { UsePartnerAccountActionResult } from '../usePartnerAccountAction'

const NOTICE = '请先核对机构盖章确认函上的联系人手机与编号。登记后系统会给这个号码发一条知会短信；机构本人需在机构后台登录页点『忘记密码』，用这个手机号收验证码并设置新密码，完成后账号变为本人自管、手机号标记为已验证。管理员不能代收验证码。'

const inputCls = 'min-h-12 w-full rounded-lg border border-neutral-200 px-3 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500'
const primaryCls = 'inline-flex min-h-12 min-w-12 items-center justify-center rounded-lg bg-primary-600 px-4 text-sm font-medium text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50'

function formatRegisteredAt(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).format(date)
}

export function ContactPhoneRegistrationSteps({ flow }: { flow: UsePartnerAccountActionResult }) {
  const [phone, setPhone] = useState('')
  const [confirmationLetterNo, setConfirmationLetterNo] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [fieldError, setFieldError] = useState<string | null>(null)
  const step = flow.state.step
  const registering = flow.state.action === 'register_contact_phone'

  useEffect(() => {
    if (step !== 'success') return
    setPhone('')
    setConfirmationLetterNo('')
    setCurrentPassword('')
    setFieldError(null)
  }, [step])

  if (!registering) return null

  if (step === 'success' && flow.contactPhoneResult) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium text-success-fg">联系人手机号已登记，机构详情已刷新。</p>
        <p className="text-sm text-neutral-800">脱敏手机号：{flow.contactPhoneResult.phoneMasked}</p>
        <p className="text-sm text-neutral-800">登记时间：{formatRegisteredAt(flow.contactPhoneResult.registeredAt)}</p>
        <p className="text-sm leading-6 text-neutral-700">{NOTICE}</p>
        <div className="flex justify-end">
          <button type="button" data-autofocus className={primaryCls} onClick={() => void flow.close()}>完成</button>
        </div>
      </div>
    )
  }

  if (step !== 'contact_phone_form') return null

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (flow.state.busy) return
    const error = contactPhoneRegistrationFieldError({ phone, confirmationLetterNo, currentPassword })
    if (error) {
      setFieldError(error)
      flow.clearContactPhoneError()
      return
    }
    setFieldError(null)
    void flow.submitContactPhone({ phone, confirmationLetterNo, currentPassword })
  }

  return (
    <form className="space-y-4" onSubmit={submit}>
      <p className="text-sm leading-6 text-neutral-700">{NOTICE}</p>
      {fieldError && <p role="alert" className="rounded-lg bg-error-bg px-3 py-2 text-sm text-error-fg">{fieldError}</p>}
      <div className="space-y-1">
        <label className="block text-sm font-medium text-neutral-700" htmlFor="partner-contact-phone">联系人手机号</label>
        <input
          id="partner-contact-phone"
          name="partner-contact-phone"
          inputMode="numeric"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          data-autofocus
          disabled={flow.state.busy}
          aria-invalid={fieldError !== null}
          className={inputCls}
          value={phone}
          onChange={(event) => setPhone(event.target.value.replace(/\D/g, '').slice(0, 11))}
        />
      </div>
      <div className="space-y-1">
        <label className="block text-sm font-medium text-neutral-700" htmlFor="partner-contact-letter-no">确认函编号</label>
        <input
          id="partner-contact-letter-no"
          name="partner-contact-letter-no"
          autoComplete="off"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          disabled={flow.state.busy}
          aria-invalid={fieldError !== null}
          className={inputCls}
          value={confirmationLetterNo}
          onChange={(event) => setConfirmationLetterNo(event.target.value.slice(0, 64))}
        />
      </div>
      <div className="space-y-1">
        <label className="block text-sm font-medium text-neutral-700" htmlFor="partner-contact-current-password">本人当前密码</label>
        <input
          id="partner-contact-current-password"
          name="partner-contact-current-password"
          type="password"
          autoComplete="current-password"
          disabled={flow.state.busy}
          aria-invalid={fieldError !== null}
          className={inputCls}
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
        />
      </div>
      <div className="flex justify-end">
        <button type="submit" className={primaryCls} disabled={flow.state.busy}>
          {flow.state.busy ? '登记中…' : '确认登记'}
        </button>
      </div>
    </form>
  )
}
