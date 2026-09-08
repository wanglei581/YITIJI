import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ScanLineIcon, SmartphoneIcon } from 'lucide-react'
import { isSafeInternalPath } from '../../auth/returnPath'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { KioskStageFit } from '../../components/kiosk-shell/KioskStageFit'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { MemberAgreement } from './components/MemberAgreement'
import { LoginGatePhoneFields } from './components/LoginGatePhoneFields'
import {
  type LoginResult,
  useMemberPhoneLogin,
} from './hooks/useMemberPhoneLogin'
import { ScanQrLoginPanel } from './ScanQrLoginPanel'
import {
  derivePhoneGateState,
  LOGIN_ANON_ENTRIES,
  LOGIN_GATE_COPY,
  LOGIN_GATE_PILL,
  loginReturnLabel,
  resolveLoginReturnTo,
  type LoginGateMode,
  type LoginQrState,
} from './loginGateModel'
import './styles/login-gate-qx.css'

type LoginTab = 'phone' | 'scan'

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { login, isLoggedIn } = useAuth()

  const fromState = (location.state as { from?: unknown } | null)?.from
  const hintState = (location.state as { hint?: unknown } | null)?.hint
  const hint = typeof hintState === 'string' && hintState.trim() !== '' ? hintState.trim() : null
  const queryFrom = new URLSearchParams(location.search).get('from')
  const { returnTo, fromRejected } = resolveLoginReturnTo(fromState, queryFrom, isSafeInternalPath)

  const [tab, setTab] = useState<LoginTab>('phone')
  const [agreed, setAgreed] = useState(false)
  const [qrPhase, setQrPhase] = useState<LoginQrState>('qr-loading')
  const qrRefreshRef = useRef<() => void>(() => undefined)

  const goHome = useCallback(() => navigate('/'), [navigate])

  useEffect(() => {
    if (isLoggedIn) navigate(returnTo, { replace: true })
  }, [isLoggedIn, navigate, returnTo])

  const finishWithSuccess = useCallback((res: LoginResult) => {
    login({
      id: res.user.id,
      phoneMasked: res.user.phoneMasked,
      nickname: res.user.nickname,
      token: res.token,
      method: 'phone',
    })
  }, [login])

  const handleAgreementRequired = useCallback(() => setAgreed(false), [])
  const phoneLogin = useMemberPhoneLogin({
    agreed,
    onAgreementRequired: handleAgreementRequired,
    onAuthenticated: finishWithSuccess,
  })
  const {
    clearFeedback: clearPhoneLoginFeedback,
    onActiveInputChange: setPhoneLoginActiveInput,
    requireAgreement: requireMemberAgreement,
  } = phoneLogin

  useBusyLock(phoneLogin.loading)

  const switchTab = useCallback((next: LoginTab) => {
    setTab(next)
    clearPhoneLoginFeedback()
    if (next === 'phone') setPhoneLoginActiveInput('phone')
  }, [clearPhoneLoginFeedback, setPhoneLoginActiveInput])

  const handleQrLoginSuccess = useCallback(
    (res: LoginResult) => {
      if (!agreed) {
        requireMemberAgreement()
        return
      }
      clearPhoneLoginFeedback()
      finishWithSuccess(res)
    },
    [agreed, clearPhoneLoginFeedback, finishWithSuccess, requireMemberAgreement],
  )

  const phoneState = derivePhoneGateState({
    sendingCode: phoneLogin.sendingCode,
    submitting: phoneLogin.submitting,
    countdown: phoneLogin.countdown,
    notice: phoneLogin.notice,
    error: phoneLogin.error,
  })
  const mode: LoginGateMode = tab === 'scan' ? 'qr' : 'phone'
  const state = mode === 'qr' ? qrPhase : phoneState
  const copy = LOGIN_GATE_COPY[state]
  const pill = LOGIN_GATE_PILL[state]
  const canConfirm = agreed
    && phoneLogin.phone.length === 11
    && phoneLogin.code.length === 6
    && !phoneLogin.loading

  return (
    <div
      className="fusion-w5 fusion-w5--auth service-desk k1-login"
      data-kiosk-screen="login"
      data-kiosk-presentation="fusion-youth"
      data-visual-theme="service-desk"
      data-ux-density="touch"
    >
      <KioskStageFit>
        <QxPageFrame
          title={copy.title}
          subtitle={<>{copy.sub} 回来后会到 <b>{loginReturnLabel(returnTo)}</b>。</>}
          status={pill}
          back={{ label: '返回首页', onBack: goHome }}
          ctabar={
            <>
              {mode === 'phone' && (state === 'phone-idle' || state === 'phone-sending' || state === 'phone-verifying') ? (
                <button type="button" className="qx-btn" data-variant="ghost" data-testid="login-gate-anonymous" onClick={goHome}>
                  {state === 'phone-idle' ? '不登录，继续使用' : '返回首页'}
                </button>
              ) : (
                <button type="button" className="qx-btn" data-variant="ghost" onClick={() => switchTab(mode === 'phone' ? 'scan' : 'phone')}>
                  {mode === 'phone' ? '改用扫码登录' : '改用手机号登录'}
                </button>
              )}
              {mode === 'phone' && (state === 'phone-idle' || state === 'phone-code-sent' || state === 'phone-code-invalid') ? (
                <button
                  type="button"
                  className="qx-btn"
                  data-variant="primary"
                  data-testid="login-gate-primary"
                  aria-disabled={!canConfirm}
                  disabled={!canConfirm}
                  onClick={phoneLogin.onLogin}
                >
                  验证并登录
                </button>
              ) : null}
              {mode === 'phone' && (state === 'phone-send-limited' || state === 'phone-send-failed' || state === 'phone-code-expired') ? (
                <button
                  type="button"
                  className="qx-btn"
                  data-variant="primary"
                  data-testid="login-gate-primary"
                  aria-disabled={!agreed}
                  disabled={!agreed}
                  onClick={phoneLogin.onSendCode}
                >
                  {state === 'phone-send-failed' ? '立刻重新获取' : '重新获取验证码'}
                </button>
              ) : null}
              {mode === 'qr' && (state === 'qr-ready' || state === 'qr-expired') ? (
                <button
                  type="button"
                  className="qx-btn"
                  data-variant="primary"
                  data-testid="login-gate-primary"
                  aria-disabled={!agreed}
                  disabled={!agreed}
                  onClick={() => qrRefreshRef.current()}
                >
                  重新生成二维码
                </button>
              ) : null}
              {mode === 'phone' && (state === 'phone-sending' || state === 'phone-verifying') ? (
                <span className="qx-btn" data-variant="primary" aria-disabled="true" data-testid="login-gate-primary">
                  {state === 'phone-sending' ? '等待服务端返回' : '等待核验结果'}
                </span>
              ) : null}
              {mode === 'qr' && (state === 'qr-loading' || state === 'qr-confirmed') ? (
                <span className="qx-btn" data-variant="primary" aria-disabled="true" data-testid="login-gate-primary">
                  {state === 'qr-confirmed' ? '正在换取登录态' : '等待服务端返回票据'}
                </span>
              ) : null}
              {mode === 'qr' && state === 'qr-error' ? (
                <button type="button" className="qx-btn" data-variant="primary" data-testid="login-gate-primary" onClick={() => switchTab('phone')}>
                  改用手机号登录
                </button>
              ) : null}
              {state === 'phone-send-failed' || state === 'qr-error' ? (
                <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/help')}>
                  联系工作人员
                </button>
              ) : null}
            </>
          }
        >
          <div className="qx-scroll qx-grow" data-screen="login-gate" data-mode={mode} data-state={state} data-testid={`login-gate-state-${state}`}>
            {fromRejected ? (
              <div className="lg-from" data-testid="login-gate-from-note">
                来源参数不合法，已按回首页处理：只接受本站内部路径。这里不回显你传进来的原值。
              </div>
            ) : null}
            {hint ? <p className="lg-hint" role="status">{hint}</p> : null}

            <div className="lg-tabs">
              <button type="button" className="lg-tab" data-testid="login-gate-tab-phone" aria-label="手机号登录" aria-current={mode === 'phone' ? 'page' : undefined} onClick={() => switchTab('phone')}>
                <span className="ti"><SmartphoneIcon size={26} aria-hidden /></span>
                <span><span className="tn">手机号</span><span className="td">短信验证码</span></span>
              </button>
              <button type="button" className="lg-tab" data-testid="login-gate-tab-qr" aria-label="手机扫码登录" aria-current={mode === 'qr' ? 'page' : undefined} onClick={() => switchTab('scan')}>
                <span className="ti"><ScanLineIcon size={26} aria-hidden /></span>
                <span><span className="tn">扫码</span><span className="td">手机确认后换登录态</span></span>
              </button>
            </div>

            {mode === 'phone' ? (
              <LoginGatePhoneFields {...phoneLogin.paneProps} state={phoneState} />
            ) : (
              <ScanQrLoginPanel
                returnTo={returnTo}
                agreed={agreed}
                onAgreementRequired={requireMemberAgreement}
                onUsePhoneLogin={() => switchTab('phone')}
                onLoginSuccess={handleQrLoginSuccess}
                onPhaseChange={setQrPhase}
                onRegisterRefresh={(fn) => { qrRefreshRef.current = fn }}
              />
            )}

            <section className="qx-card" style={{ marginTop: 18 }}>
              <h3>登录之后多出什么</h3>
              <p>我的文档、打印订单、AI 服务记录归到你名下，只有本人可见。手机上下单拿到的到机码能和这台机器对上号。</p>
            </section>

            <section style={{ marginTop: 18 }}>
              <div className="qx-sec-h"><span className="t">不登录也能办</span></div>
              <div className="lg-entries">
                {LOGIN_ANON_ENTRIES.map((entry, index) => (
                  <button
                    key={entry.id}
                    type="button"
                    className="lg-entry"
                    data-testid={`login-gate-anon-${index}`}
                    onClick={() => navigate(entry.route)}
                  >
                    <span className="eb">
                      <span className="en">{entry.title}</span>
                      <span className="ed">{entry.desc}</span>
                    </span>
                  </button>
                ))}
              </div>
            </section>

            <MemberAgreement agreed={agreed} onAgreedChange={setAgreed} />
            {!agreed ? <p className="lg-gate">请先勾选用户服务协议和隐私政策，发码、创建二维码和换登录态才会开始。</p> : null}

            <div className="lg-truth" data-disclaimer="true">
              <div><b>登录结果</b>以服务端返回为准，本页不显示「已登录」。</div>
              <div><b>手机确认</b>只等于 confirmed，一体机还要 claim 成功才登录。</div>
              <div><b>不登录</b>仍可使用打印扫描、到机码和岗位招聘会信息入口。</div>
            </div>
          </div>
        </QxPageFrame>
      </KioskStageFit>
    </div>
  )
}
