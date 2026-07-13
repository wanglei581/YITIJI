import { CircleAlertIcon, CircleCheckIcon, SmartphoneIcon } from 'lucide-react'
import {
  formatMemberPhone,
  MEMBER_CODE_LENGTH,
  MEMBER_PHONE_LENGTH,
  type MemberPhoneLoginPaneProps,
} from '../hooks/useMemberPhoneLogin'

const RING_CIRCUMFERENCE = 59.7

export function MemberPhoneLoginPane({
  phone,
  code,
  agreed,
  loading,
  countdown,
  countdownTotal,
  activeInput,
  onActiveInputChange,
  onDigit,
  onDelete,
  onClear,
  onSendCode,
  onLogin,
  notice,
  error,
}: MemberPhoneLoginPaneProps) {
  const canSend = agreed && phone.length === MEMBER_PHONE_LENGTH && countdown === 0 && !loading
  const canLogin = (
    agreed &&
    phone.length === MEMBER_PHONE_LENGTH &&
    code.length === MEMBER_CODE_LENGTH &&
    !loading
  )
  const ringOffset = countdownTotal > 0
    ? RING_CIRCUMFERENCE * (1 - countdown / countdownTotal)
    : 0
  const activeValue = activeInput === 'code' ? code : phone

  return (
    <div className="k-pane">
      <div className="field-label">
        <b className="fno">01</b>手机号 <i>未注册的手机号验证后将自动创建账号</i>
      </div>
      <div className={`k-input${activeInput === 'phone' ? ' focus' : ''}`}>
        <button
          type="button"
          className="k-input-target"
          onClick={() => onActiveInputChange('phone')}
          aria-label="手机号"
        >
          <SmartphoneIcon size={22} aria-hidden="true" />
          {phone
            ? <span>{formatMemberPhone(phone)}</span>
            : <span className="ph">使用下方键盘输入 11 位手机号</span>}
          {activeInput === 'phone' && phone.length < MEMBER_PHONE_LENGTH && <span className="caret" />}
        </button>
        <button
          type="button"
          disabled={!canSend}
          className="k-send ripple-host"
          onClick={onSendCode}
        >
          {countdown > 0 && (
            <svg className="ring" viewBox="0 0 24 24" aria-hidden="true">
              <circle className="bg" cx="12" cy="12" r="9.5" />
              <circle
                cx="12"
                cy="12"
                r="9.5"
                strokeDasharray={RING_CIRCUMFERENCE}
                strokeDashoffset={ringOffset}
              />
            </svg>
          )}
          <span>{loading && countdown === 0 ? '发送中' : countdown > 0 ? `${countdown}s 后重发` : '获取验证码'}</span>
        </button>
      </div>

      <div className="field-label">
        <b className="fno">02</b>短信验证码 <i>输入 6 位数字，5 分钟内有效</i>
      </div>
      <div
        className="k-cells"
        onClick={() => onActiveInputChange('code')}
        role="button"
        tabIndex={0}
        aria-label="短信验证码"
        onKeyDown={(event) => {
          if (event.key === 'Enter') onActiveInputChange('code')
        }}
      >
        {Array.from({ length: MEMBER_CODE_LENGTH }, (_, index) => {
          const filled = index < code.length
          const next = activeInput === 'code' && index === code.length
          return (
            <div key={index} className={`k-cell${filled ? ' filled' : ''}${next ? ' next' : ''}`}>
              {filled && <span>{code[index]}</span>}
            </div>
          )
        })}
      </div>

      {notice && (
        <div className="k-notice" role="status" aria-live="polite">
          <CircleCheckIcon size={20} aria-hidden="true" />
          <span>{notice}</span>
        </div>
      )}
      {error && (
        <div className="k-error" role="alert" aria-live="polite">
          <CircleAlertIcon size={20} aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      <button
        type="button"
        className={`k-cta ripple-host${loading ? ' loading' : ''}`}
        disabled={!canLogin}
        onClick={onLogin}
      >
        <span className="label">登 录</span>
        <span className="load">
          <i />
          <i />
          <i />
        </span>
      </button>

      <div className="k-numpad">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
          <button
            key={digit}
            type="button"
            className="k-key ripple-host"
            onPointerDown={(event) => {
              event.preventDefault()
              onDigit(digit)
            }}
            aria-label={digit}
          >
            {digit}
          </button>
        ))}
        <button
          type="button"
          className="k-key fn ripple-host"
          disabled={activeValue.length === 0}
          onPointerDown={(event) => {
            event.preventDefault()
            onClear()
          }}
          aria-label="清空"
        >
          清空
        </button>
        <button
          type="button"
          className="k-key ripple-host"
          onPointerDown={(event) => {
            event.preventDefault()
            onDigit('0')
          }}
          aria-label="0"
        >
          0
        </button>
        <button
          type="button"
          className="k-key fn ripple-host"
          onPointerDown={(event) => {
            event.preventDefault()
            onDelete()
          }}
          aria-label="删除"
        >
          删除
        </button>
      </div>
    </div>
  )
}
