import {
  formatMemberPhone,
  MEMBER_CODE_LENGTH,
  MEMBER_PHONE_LENGTH,
  type MemberPhoneLoginPaneProps,
} from '../hooks/useMemberPhoneLogin'
import type { LoginPhoneState } from '../loginGateModel'

const CODE_OPEN_STATES: ReadonlySet<LoginPhoneState> = new Set([
  'phone-code-sent',
  'phone-code-invalid',
])

export function LoginGatePhoneFields({
  state,
  phone,
  code,
  agreed,
  loading,
  countdown,
  onActiveInputChange,
  onDigit,
  onDelete,
  onClear,
  onSendCode,
  notice,
  error,
}: MemberPhoneLoginPaneProps & { state: LoginPhoneState }) {
  const canSend = agreed && phone.length === MEMBER_PHONE_LENGTH && countdown === 0 && !loading
  const codeOpen = CODE_OPEN_STATES.has(state)
  const sendLabel = loading && countdown === 0
    ? '发送中'
    : countdown > 0
      ? `${countdown}s 后重发`
      : state === 'phone-idle'
        ? '获取验证码'
        : '重新获取'
  const masked = phone.length === MEMBER_PHONE_LENGTH
    ? `${phone.slice(0, 3)}****${phone.slice(7)}`
    : ''

  return (
    <section className="qx-card" style={{ padding: 0, border: 0, background: 'transparent' }}>
      <div className="qx-sec-h"><span className="t">用手机号登录</span></div>
      <div className="lg-field">
        <label htmlFor="login-gate-phone">手机号</label>
        <div className="lg-row">
          <button
            type="button"
            id="login-gate-phone"
            className="lg-input"
            onClick={() => onActiveInputChange('phone')}
            aria-label="手机号（11 位本人号码）"
          >
            {phone ? <span>{formatMemberPhone(phone)}</span> : <span className="ph">请输入本人手机号</span>}
          </button>
          <button
            type="button"
            className="lg-side k-send"
            data-testid="login-gate-send"
            aria-disabled={!canSend}
            disabled={!canSend}
            onClick={onSendCode}
          >
            {sendLabel}
          </button>
        </div>
        {phone ? <div className="lg-echo">本次输入：<b>{masked || '未获取到完整手机号'}</b></div> : null}
      </div>
      <div className="lg-field">
        <label htmlFor="login-gate-code">短信验证码</label>
        <div className="lg-row">
          <button
            type="button"
            id="login-gate-code"
            className="lg-input"
            onClick={() => { if (codeOpen) onActiveInputChange('code') }}
            aria-label="短信验证码"
            aria-disabled={!codeOpen}
            disabled={!codeOpen}
          >
            {code
              ? <span>{code.padEnd(MEMBER_CODE_LENGTH, '·')}</span>
              : <span className="ph">{codeOpen ? '输入短信里的 6 位验证码' : '还没有可填的验证码'}</span>}
          </button>
        </div>
        <div className="lg-reason">
          {codeOpen
            ? '验证码有效期以服务端为准；填错、过期、试太多次是三种不同结果。'
            : '还没有可填的验证码。先获取验证码，收到后这里会打开。'}
        </div>
      </div>
      {notice ? <p className="lg-echo" role="status">{notice}</p> : null}
      {error ? <p className="lg-reason" role="alert">{error}</p> : null}
      <div className="lg-keypad" role="group" aria-label="数字键盘" data-testid="login-gate-keypad">
        {[['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9']].map((row) => (
          <div key={row[0]} className="lg-kb-row">
            {row.map((digit) => (
              <button
                key={digit}
                type="button"
                className="lg-kb"
                aria-label={digit}
                onPointerDown={(event) => { event.preventDefault(); onDigit(digit) }}
              >
                {digit}
              </button>
            ))}
          </div>
        ))}
        <div className="lg-kb-row">
          <button
            type="button"
            className="lg-kb fn"
            aria-label="清空"
            onPointerDown={(event) => { event.preventDefault(); onClear() }}
          >
            清空
          </button>
          <button
            type="button"
            className="lg-kb"
            aria-label="0"
            onPointerDown={(event) => { event.preventDefault(); onDigit('0') }}
          >
            0
          </button>
          <button
            type="button"
            className="lg-kb fn del"
            aria-label="删除"
            onPointerDown={(event) => { event.preventDefault(); onDelete() }}
          >
            删除
          </button>
        </div>
      </div>
    </section>
  )
}
