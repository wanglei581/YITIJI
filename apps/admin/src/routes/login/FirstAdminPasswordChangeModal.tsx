import { useState, type FormEvent } from 'react'
import { CircleAlertIcon, LockKeyholeIcon, ShieldCheckIcon, XIcon } from 'lucide-react'
import { completeFirstAdminPasswordChange } from '../../services/auth'

interface FirstAdminPasswordChangeModalProps {
  changeTicket: string
  validatePassword: (password: string) => string | null
  onComplete: () => void
  onReturnToLogin: () => void
}

export function FirstAdminPasswordChangeModal({
  changeTicket,
  validatePassword,
  onComplete,
  onReturnToLogin,
}: FirstAdminPasswordChangeModalProps) {
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setError(null)
    const validationError = validatePassword(newPassword)
    if (validationError) {
      setError(validationError)
      return
    }
    if (newPassword !== confirmPassword) {
      setError('两次输入的新密码不一致')
      return
    }

    setBusy(true)
    const result = await completeFirstAdminPasswordChange(changeTicket, newPassword)
    setBusy(false)
    if (!result.ok) {
      setError(result.message || '首次改密失败，请返回登录后重试')
      return
    }
    setNewPassword('')
    setConfirmPassword('')
    onComplete()
  }

  function returnToLogin() {
    setNewPassword('')
    setConfirmPassword('')
    setError(null)
    onReturnToLogin()
  }

  return (
    <div className="c-modal" role="dialog" aria-modal="true" aria-label="首次登录修改密码">
      <form className="c-modal-card" onSubmit={submit}>
        <div className="c-modal-head">
          <div>
            <h3>设置管理员正式密码</h3>
            <p>初始凭据只能用于本次改密，完成后请使用新密码重新登录</p>
          </div>
          <button type="button" className="close-btn" onClick={returnToLogin} aria-label="返回登录">
            <XIcon size={18} aria-hidden="true" />
          </button>
        </div>
        <div className="c-field">
          <label htmlFor="first-admin-new-password"><b className="fno">01</b>新密码</label>
          <div className="c-inputwrap">
            <LockKeyholeIcon className="lead" size={18} aria-hidden="true" />
            <input
              id="first-admin-new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={12}
              maxLength={72}
              required
            />
          </div>
        </div>
        <div className="c-field">
          <label htmlFor="first-admin-confirm-password"><b className="fno">02</b>确认新密码</label>
          <div className="c-inputwrap">
            <LockKeyholeIcon className="lead" size={18} aria-hidden="true" />
            <input
              id="first-admin-confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              minLength={12}
              maxLength={72}
              required
            />
          </div>
          <div className="c-hint">
            <ShieldCheckIcon size={14} aria-hidden="true" />
            至少 12 位并包含 3 类字符；UTF-8 最多 72 字节
          </div>
        </div>
        {error && (
          <div className="c-error" role="alert">
            <CircleAlertIcon size={16} aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}
        <button type="submit" className={`c-cta ripple-host${busy ? ' loading' : ''}`} disabled={busy}>
          <span className="label">确认并设置正式密码</span>
          <span className="load" aria-hidden="true"><i /><i /><i /></span>
        </button>
      </form>
    </div>
  )
}
