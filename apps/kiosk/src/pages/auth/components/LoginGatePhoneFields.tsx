import { useState } from 'react'
import { maskPhone } from '../../../utils/maskPii'
import {
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
  activeInput,
  expiresInSeconds,
}: MemberPhoneLoginPaneProps & { state: LoginPhoneState }) {
  const [keyboardOpen, setKeyboardOpen] = useState(false)
  const canSend = agreed && phone.length === MEMBER_PHONE_LENGTH && countdown === 0 && !loading
  const codeOpen = CODE_OPEN_STATES.has(state)
  const sendLabel = loading && countdown === 0
    ? '发送中'
    : countdown > 0
      ? `${countdown} 秒后重发`
      : state === 'phone-idle'
        ? '获取验证码'
        : '重新获取'


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
            disabled={loading || codeOpen}
            onClick={() => { onActiveInputChange('phone'); setKeyboardOpen(true) }}
            aria-label="手机号（11 位本人号码）"
          >
            {phone ? <span>{maskPhone(phone)}</span> : <span className="ph">请输入本人手机号</span>}
          </button>
          <button
            type="button"
            className="lg-side k-send"
            data-testid="login-gate-send"
            aria-disabled={!canSend}
            disabled={!canSend}
            onClick={() => { setKeyboardOpen(false); onSendCode() }}
          >
            {sendLabel}
          </button>
        </div>
      </div>
      <div className="lg-field">
        <label htmlFor="login-gate-code">短信验证码</label>
        <div className="lg-row">
          <button
            type="button"
            id="login-gate-code"
            className="lg-input"
            onClick={() => { if (codeOpen) { onActiveInputChange('code'); setKeyboardOpen(true) } }}
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
            ? '填写最新短信里的 6 位数字，确认后即可继续。'
            : '先获取验证码，收到后这里会打开。'}
        </div>
      </div>
      {notice && state !== 'phone-code-sent' ? <p className="lg-echo" role="status">{notice}{expiresInSeconds !== null ? `，有效期 ${expiresInSeconds} 秒。` : null}</p> : null}
      {error ? <p className="lg-reason" role="alert">{error}</p> : null}
      {keyboardOpen && !loading ? <div className="lg-keyboard-cover">
      <button type="button" className="lg-keyboard-mask" aria-label="关闭数字键盘" onClick={() => setKeyboardOpen(false)} />
      <div className="lg-keypad" role="group" aria-label="数字键盘" data-testid="login-gate-keypad">
        <div className="lg-keyboard-head"><span>正在输入：{activeInput === 'phone' ? '手机号' : '短信验证码'}</span><button type="button" className="lg-side" onClick={() => setKeyboardOpen(false)}>收起键盘</button></div>
        {[['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9']].map((row) => (
          <div key={row[0]} className="lg-kb-row">
            {row.map((digit) => (
              <button
                key={digit}
                type="button"
                className="lg-kb"
                aria-label={digit}
                onClick={() => onDigit(digit)}
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
            onClick={onClear}
          >
            清空
          </button>
          <button
            type="button"
            className="lg-kb"
            aria-label="0"
            onClick={() => onDigit('0')}
          >
            0
          </button>
          <button
            type="button"
            className="lg-kb fn del"
            aria-label="删除"
            onClick={onDelete}
          >
            删除
          </button>
        </div>
      </div>
      </div> : null}
    </section>
  )
}
