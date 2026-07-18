import { useEffect, useRef, useState } from 'react'
import type { UsePartnerAccountActionResult } from '../usePartnerAccountAction'

const inputCls = 'w-full rounded-lg border border-neutral-200 px-3 py-2 text-sm focus:border-primary-500 focus:outline-none focus:ring-1 focus:ring-primary-500'
const primaryCls = 'rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50'
const secondaryCls = 'rounded-lg border border-neutral-200 px-3 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50'

function secondsLeft(deadline: number, nowMs: number): number {
  return deadline > 0 ? Math.max(0, Math.ceil((deadline - nowMs) / 1_000)) : 0
}

export function ActionCredentialSteps({ flow }: { flow: UsePartnerAccountActionResult }) {
  const [adminPassword, setAdminPassword] = useState('')
  const [accountPassword, setAccountPassword] = useState('')
  const [code, setCode] = useState('')
  const lastAutoSubmittedCodeRef = useRef('')
  const { state, account } = flow

  useEffect(() => {
    setAdminPassword('')
    setAccountPassword('')
    setCode('')
  }, [state.step, state.verifyMethod])

  useEffect(() => {
    if (code.length !== 6) {
      lastAutoSubmittedCodeRef.current = ''
      return
    }
    if (state.step !== 'sms_verify' || state.busy || lastAutoSubmittedCodeRef.current === code) return
    lastAutoSubmittedCodeRef.current = code
    const submittedCode = code
    void flow.verifyCredential(submittedCode).finally(() => setCode(''))
  }, [code, flow, state.busy, state.step])

  if (!account) return null

  if (state.step === 'confirm' || state.step === 'confirm_rebind') {
    const deleting = state.step === 'confirm'
    return (
      <div className="space-y-4">
        <p className="text-sm leading-6 text-neutral-600">
          {deleting
            ? `准备移除「${account.name}（${account.username}）」的登录访问。继续后需要账号持有人参与验证。`
            : `准备为「${account.name}（${account.username}）」换绑手机号。旧因子验证通过后，还需验证新手机号。`}
        </p>
        <div className="rounded-lg bg-warning-bg px-3 py-2 text-xs leading-5 text-warning-fg">
          管理员不得索取、转述或记录账号持有人的密码；如选择密码验证，请由持有人自行输入。
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {deleting && (
            <button type="button" className={secondaryCls} disabled={state.busy} onClick={() => void flow.switchAction('rebind_phone')}>
              改为换绑手机号
            </button>
          )}
          <button type="button" data-autofocus className={primaryCls} disabled={state.busy} onClick={flow.confirm}>
            继续安全验证
          </button>
        </div>
      </div>
    )
  }

  if (state.step === 'choose_method') {
    const methods = account.availableActionVerificationMethods ?? []
    return (
      <div className="space-y-4">
        <p className="text-sm text-neutral-600">请选择账号持有人验证方式。切换方式会废弃当前挑战和票据。</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            data-autofocus
            className={primaryCls}
            disabled={state.busy || !methods.includes('sms')}
            onClick={() => void flow.chooseMethod('sms')}
          >
            向原手机号发送验证码
          </button>
          <button
            type="button"
            className={secondaryCls}
            disabled={state.busy || !methods.includes('password')}
            onClick={() => void flow.chooseMethod('password')}
          >
            手机号无法接收？使用账号密码
          </button>
        </div>
      </div>
    )
  }

  if (state.step === 'admin_reauth') {
    return (
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          const password = adminPassword
          void flow.submitAdminPassword(password).finally(() => setAdminPassword(''))
        }}
      >
        <label className="block text-sm font-medium text-neutral-700" htmlFor="partner-action-admin-password">
          管理员本人密码
        </label>
        <input
          id="partner-action-admin-password"
          name="admin-current-password"
          type="password"
          autoComplete="current-password"
          data-autofocus
          className={inputCls}
          value={adminPassword}
          onChange={(event) => setAdminPassword(event.target.value)}
        />
        <p className="text-xs leading-5 text-neutral-500">这是当前管理员账号的密码，仅用于确认本次高风险操作。</p>
        <div className="flex justify-end">
          <button className={primaryCls} disabled={state.busy || adminPassword.length === 0}>确认管理员身份</button>
        </div>
      </form>
    )
  }

  if (state.step === 'sms_verify') {
    const remaining = secondsLeft(flow.challengeDeadline, flow.nowMs)
    const resendRemaining = secondsLeft(flow.resendAvailableAt, flow.nowMs)
    return (
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          const submittedCode = code
          if (state.busy || lastAutoSubmittedCodeRef.current === submittedCode) return
          lastAutoSubmittedCodeRef.current = submittedCode
          void flow.verifyCredential(submittedCode).finally(() => setCode(''))
        }}
      >
        <p className="text-sm text-neutral-600">验证码已发送至 {flow.phoneMasked ?? '账号已验证手机号'}，剩余 {remaining} 秒。</p>
        <label className="block text-sm font-medium text-neutral-700" htmlFor="partner-action-old-phone-code">原手机号验证码</label>
        <input
          id="partner-action-old-phone-code"
          name="partner-account-old-phone-code"
          autoComplete="one-time-code"
          inputMode="numeric"
          data-autofocus
          className={inputCls}
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
        />
        <div className="flex flex-wrap justify-between gap-2">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={secondaryCls}
              disabled={state.busy || resendRemaining > 0}
              onClick={() => void flow.chooseMethod('sms')}
            >
              {resendRemaining > 0 ? `${resendRemaining} 秒后重新发送` : '重新发送验证码'}
            </button>
            {account.availableActionVerificationMethods.includes('password') && (
              <button type="button" className={secondaryCls} disabled={state.busy} onClick={() => void flow.chooseMethod('password')}>
                手机号无法接收？使用账号密码
              </button>
            )}
          </div>
          <button className={primaryCls} disabled={state.busy || code.length !== 6}>验证</button>
        </div>
      </form>
    )
  }

  if (state.step === 'password_verify') {
    return (
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault()
          const password = accountPassword
          void flow.verifyCredential(password).finally(() => setAccountPassword(''))
        }}
      >
        <label className="block text-sm font-medium text-neutral-700" htmlFor="partner-action-account-password">
          目标机构账号当前密码
        </label>
        <input
          id="partner-action-account-password"
          name={`partner-current-password-${account.username}`}
          type="password"
          autoComplete="current-password"
          data-autofocus
          className={inputCls}
          value={accountPassword}
          onChange={(event) => setAccountPassword(event.target.value)}
        />
        <p className="rounded-lg bg-warning-bg px-3 py-2 text-xs leading-5 text-warning-fg">
          请由目标账号持有人自行输入。管理员不得索取、转述或记录他人密码。
        </p>
        <div className="flex flex-wrap justify-between gap-2">
          {account.availableActionVerificationMethods.includes('sms') && (
            <button type="button" className={secondaryCls} disabled={state.busy} onClick={() => void flow.chooseMethod('sms')}>改用短信验证</button>
          )}
          <button className={primaryCls} disabled={state.busy || accountPassword.length < 8}>验证目标账号</button>
        </div>
      </form>
    )
  }

  return null
}
