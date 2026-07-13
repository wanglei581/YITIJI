import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type SyntheticEvent,
} from 'react'
import { ShieldCheckIcon, XIcon } from 'lucide-react'
import { useAuth } from '../../../auth/useAuth'
import { MemberAgreement } from './MemberAgreement'
import { MemberPhoneLoginPane } from './MemberPhoneLoginPane'
import {
  type LoginResult,
  type MemberPhoneLoginController,
  useMemberPhoneLogin,
} from '../hooks/useMemberPhoneLogin'
import '../login.css'

export interface MemberLoginDialogProps {
  open: boolean
  onClose: () => void
  onContinueAsGuest: () => void
  onAuthenticated?: () => void
}

export function MemberLoginDialog({
  open,
  onClose,
  onContinueAsGuest,
  onAuthenticated,
}: MemberLoginDialogProps) {
  const { login } = useAuth()
  const dialogRef = useRef<HTMLDialogElement>(null)
  const triggerElementRef = useRef<HTMLElement | null>(null)
  const phoneLoginRef = useRef<
    Pick<MemberPhoneLoginController, 'cancelPending' | 'resetSensitiveInput'> | null
  >(null)
  const closingRef = useRef(false)
  const [agreed, setAgreed] = useState(false)

  const closeDialog = useCallback(() => {
    if (closingRef.current) return
    closingRef.current = true

    phoneLoginRef.current?.cancelPending()
    phoneLoginRef.current?.resetSensitiveInput()
    setAgreed(false)
    const dialog = dialogRef.current
    if (dialog?.open) dialog.close()
    try {
      onClose()
    } finally {
      const triggerElement = triggerElementRef.current
      if (triggerElement?.isConnected) triggerElement.focus()
    }
  }, [onClose])

  const handleAuthenticated = (result: LoginResult) => {
    login({
      id: result.user.id,
      phoneMasked: result.user.phoneMasked,
      nickname: result.user.nickname,
      token: result.token,
      method: 'phone',
    })
    try {
      onAuthenticated?.()
    } finally {
      closeDialog()
    }
  }

  const phoneLogin = useMemberPhoneLogin({
    agreed,
    onAgreementRequired: () => setAgreed(false),
    onAuthenticated: handleAuthenticated,
  })
  phoneLoginRef.current = phoneLogin

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (!open) {
      if (dialog.open) closeDialog()
      return
    }
    if (dialog.open) return

    closingRef.current = false
    triggerElementRef.current = document.activeElement as HTMLElement | null
    dialog.showModal()
    const phoneEntry = dialog.querySelector<HTMLElement>('[aria-label="手机号"]')
    phoneEntry?.focus()
  }, [closeDialog, open])

  useEffect(() => {
    const dialog = dialogRef.current
    return () => {
      closingRef.current = true
      if (dialog?.open) dialog.close()
    }
  }, [])

  const handleCancel = (event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault()
    closeDialog()
  }

  const handleNativeClose = () => {
    if (!closingRef.current) closeDialog()
  }

  const handleBackdropClick = (event: ReactMouseEvent<HTMLDialogElement>) => {
    if (event.target !== event.currentTarget || phoneLogin.loading) return
    closeDialog()
  }

  const handleContinueAsGuest = () => {
    try {
      onContinueAsGuest()
    } finally {
      closeDialog()
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="member-login-dialog"
      aria-labelledby="member-login-dialog-title"
      data-visual-theme="service-desk"
      data-ux-density="touch"
      onCancel={handleCancel}
      onClose={handleNativeClose}
      onClick={handleBackdropClick}
    >
      <section
        className={`member-dialog-surface service-desk k1-login${phoneLogin.shaking ? ' shake' : ''}`}
      >
        <header className="member-dialog-header">
          <div className="member-dialog-heading">
            <span className="member-dialog-eyebrow">
              <ShieldCheckIcon size={18} aria-hidden="true" />
              会员服务
            </span>
            <h2 id="member-login-dialog-title">手机号登录</h2>
            <p>登录后查看本人简历、文档、AI记录、打印订单和收藏</p>
          </div>
          <button
            type="button"
            className="member-dialog-close"
            aria-label="关闭登录窗口"
            onClick={closeDialog}
          >
            <XIcon size={20} aria-hidden="true" />
            <span>关闭</span>
          </button>
        </header>

        <div className="member-dialog-body">
          <MemberAgreement agreed={agreed} onAgreedChange={setAgreed} />
          <MemberPhoneLoginPane {...phoneLogin.paneProps} />

          <div className="member-dialog-separator" aria-hidden="true">
            <span>暂不登录</span>
          </div>
          <button
            type="button"
            className="member-dialog-guest"
            onClick={handleContinueAsGuest}
          >
            继续游客体验
          </button>
          <p className="member-dialog-idle-note">
            <ShieldCheckIcon size={17} aria-hidden="true" />
            公共设备长时间无操作将自动退出并清理本次会话。
          </p>
        </div>
      </section>
    </dialog>
  )
}
