import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  CheckIcon,
  ChevronRightIcon,
  FilesIcon,
  LandmarkIcon,
  Link2Icon,
  PrinterIcon,
  ScanLineIcon,
  SmartphoneIcon,
  TicketIcon,
  type LucideIcon,
} from 'lucide-react'
import { isSafeInternalPath } from '../../auth/returnPath'
import { useAuth } from '../../auth/useAuth'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { KioskStageFit } from '../../components/kiosk-shell/KioskStageFit'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { QxAiHelp, QxStepActions } from '../../components/qingxu/QxAiHelp'
import { accountDisplayMessage } from './accountUserMessage'
import { MemberAgreement } from './components/MemberAgreement'
import { LoginGatePhoneFields } from './components/LoginGatePhoneFields'
import {
  type LoginResult,
  useMemberPhoneLogin,
} from './hooks/useMemberPhoneLogin'
import { ScanQrLoginPanel } from './ScanQrLoginPanel'
import {
  derivePhoneGateState,
  isPhoneDailySmsCode,
  loginAnonEntries,
  LOGIN_GATE_COPY,
  LOGIN_GATE_PILL,
  loginReturnLabel,
  PHONE_DAILY_GATE_COPY,
  resolveLoginReturnTo,
  sendLimitedPrimaryLabel,
  shouldKeepPhoneKeypadOnNumber,
  smsUnavailableCopy,
  type LoginGateMode,
  type LoginQrState,
} from './loginGateModel'
import './styles/login-gate-qx.css'

type LoginTab = 'phone' | 'scan'

const ANON_ICONS: Record<string, LucideIcon> = {
  print: PrinterIcon,
  code: TicketIcon,
  policy: LandmarkIcon,
}

export function LoginPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { login, isLoggedIn } = useAuth()

  const fromState = (location.state as { from?: unknown } | null)?.from
  const hintState = (location.state as { hint?: unknown } | null)?.hint
  const hint = typeof hintState === 'string' && hintState.trim() !== '' ? accountDisplayMessage(hintState, '请重新登录后继续。') : null
  const queryFrom = new URLSearchParams(location.search).get('from')
  const { returnTo, fromRejected } = resolveLoginReturnTo(fromState, queryFrom, isSafeInternalPath)

  const [tab, setTab] = useState<LoginTab>('phone')
  const [agreed, setAgreed] = useState(false)
  const [qrPhase, setQrPhase] = useState<LoginQrState>('qr-loading')
  const qrRefreshRef = useRef<() => void>(() => undefined)
  const limitedPhoneRef = useRef<string | null>(null)

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
    errorCode: phoneLogin.errorCode,
  })
  // 本机安全校验没过、换票也没换回来时，服务端原话带工程词会被过滤成「请稍后重试」——
  // 这一态恰恰不该叫人重试，按错误码说清走得通的那条路（其余三种发不了码的原因服务端给了人话，照旧显示）。
  const phoneDaily = isPhoneDailySmsCode(phoneLogin.errorCode)
  const codeEntryOpen = phoneState === 'phone-code-sent' || phoneState === 'phone-code-invalid'
  // 发码钩子在号码满 11 位时会把焦点拨到验证码。验证码还没发出，这里拨回手机号，
  // 钩子在本组件里先注册，这一条写在它后面，同一轮里以这里为准。
  useEffect(() => {
    if (shouldKeepPhoneKeypadOnNumber({
      codeOpen: codeEntryOpen,
      phoneComplete: phoneLogin.phone.length === 11,
      activeInput: phoneLogin.activeInput,
    })) setPhoneLoginActiveInput('phone')
  }, [codeEntryOpen, phoneLogin.activeInput, phoneLogin.phone.length, setPhoneLoginActiveInput])
  useEffect(() => {
    if (phoneDaily && phoneLogin.phone.length === 11) {
      limitedPhoneRef.current = phoneLogin.phone
      return
    }
    if (limitedPhoneRef.current && phoneLogin.phone !== limitedPhoneRef.current) {
      limitedPhoneRef.current = null
      clearPhoneLoginFeedback()
    }
  }, [clearPhoneLoginFeedback, phoneDaily, phoneLogin.phone])
  const phoneFieldsError = phoneState === 'phone-sms-unavailable' && phoneLogin.errorCode === 'TERMINAL_SESSION_INVALID'
    ? '这台机器现在发不了验证码，请改用扫码登录。'
    : phoneLogin.error
  const mode: LoginGateMode = tab === 'scan' ? 'qr' : 'phone'
  const state = mode === 'qr' ? qrPhase : phoneState
  const copy = phoneDaily && mode === 'phone'
    ? PHONE_DAILY_GATE_COPY
    : mode === 'phone' && phoneState === 'phone-sms-unavailable'
      ? smsUnavailableCopy(phoneLogin.errorCode)
      : LOGIN_GATE_COPY[state]
  const pill = phoneDaily && mode === 'phone'
    ? { tone: 'warn' as const, label: '这个号码今天已用完' }
    : LOGIN_GATE_PILL[state]
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
      data-takeaway="本人服务记录与继续办理"
    >
      <KioskStageFit>
        <QxPageFrame
          title={copy.title}
          subtitle={<>{copy.sub} 回来后会到 <b>{loginReturnLabel(returnTo)}</b>。</>}
          status={pill}
          back={{ label: '返回首页', onBack: goHome }}
          ctabar={
            <>
              {mode === 'phone' && (state === 'phone-idle' || state === 'phone-sending' || state === 'phone-verifying' || state === 'phone-legal-unpublished' || state === 'phone-sms-unavailable' || phoneDaily) ? (
                <button type="button" className="qx-btn" data-variant="ghost" data-testid="login-gate-anonymous" onClick={goHome}>
                  {state === 'phone-idle' || state === 'phone-legal-unpublished' || state === 'phone-sms-unavailable' || phoneDaily ? '不登录，继续使用' : '返回首页'}
                </button>
              ) : (
                <button type="button" className="qx-btn" data-variant="ghost" onClick={() => switchTab(mode === 'phone' ? 'scan' : 'phone')}>
                  {mode === 'phone' ? '改用扫码登录' : '改用手机号登录'}
                </button>
              )}
              {mode === 'phone' && (state === 'phone-code-sent' || state === 'phone-code-invalid') ? (
                <button
                  type="button"
                  className="qx-btn"
                  data-variant="primary"
                  data-testid="login-gate-primary"
                  aria-disabled={!canConfirm}
                  disabled={!canConfirm}
                  onClick={phoneLogin.onLogin}
                >
                  确认登录
                </button>
              ) : null}
              {mode === 'phone' && !phoneDaily && (state === 'phone-send-limited' || state === 'phone-send-failed' || state === 'phone-code-expired' || state === 'phone-code-locked') ? (
                <button
                  type="button"
                  className="qx-btn"
                  data-variant="primary"
                  data-testid="login-gate-primary"
                  aria-disabled={!agreed || phoneLogin.countdown > 0 || phoneLogin.loading}
                  disabled={!agreed || phoneLogin.countdown > 0 || phoneLogin.loading}
                  onClick={phoneLogin.onSendCode}
                >
                  {state === 'phone-send-failed' ? '立刻重新获取' : sendLimitedPrimaryLabel(phoneLogin.countdown)}
                </button>
              ) : null}
              {/* 这台机器 / 全站今天发不了码，或这个号码今天已用完：再点「重新获取」没用，主按钮直接换到扫码登录。 */}
              {mode === 'phone' && (state === 'phone-sms-unavailable' || phoneDaily) ? (
                <button
                  type="button"
                  className="qx-btn"
                  data-variant="primary"
                  data-testid="login-gate-primary"
                  onClick={() => switchTab('scan')}
                >
                  改用扫码登录
                </button>
              ) : null}
              {mode === 'qr' && (state === 'qr-ready' || state === 'qr-expired' || state === 'qr-error') ? (
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
              {mode === 'phone' && (state === 'phone-sending' || state === 'phone-verifying' || state === 'phone-legal-unpublished') ? (
                <span className="qx-btn" role="button" data-variant="primary" aria-disabled="true" data-testid="login-gate-primary">
                  {state === 'phone-sending' ? '正在等待结果' : state === 'phone-legal-unpublished' ? '暂时无法登录' : '等待核验结果'}
                </span>
              ) : null}
              {mode === 'qr' && (state === 'qr-loading' || state === 'qr-confirmed') ? (
                <span className="qx-btn" role="button" data-variant="primary" aria-disabled="true" data-testid="login-gate-primary">
                  {state === 'qr-confirmed' ? '正在完成登录' : agreed ? '正在取二维码' : '请先勾选协议'}
                </span>
              ) : null}
              {state === 'phone-send-failed' || state === 'qr-error' ? (
                <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/help')}>
                  问小青
                </button>
              ) : null}
            </>
          }
        >
          <p className="lg-identity-note">验证码由短信发到你的手机。这台机器不生成、也不代填。这一步不用 AI 核对是不是你。</p>
          <ol className="lg-rail" aria-label="登录步骤"><li><b>01</b>选择登录方式</li><li><b>02</b>核对本人身份</li><li><b>03</b>回到刚才的办理</li></ol>
          <div className="qx-scroll qx-grow" data-screen="login-gate" data-mode={mode} data-state={state} data-testid={`login-gate-state-${state}`}>
            {fromRejected ? (
              <div className="lg-from" data-testid="login-gate-from-note">
                登录后将返回首页，你可以重新选择服务。
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
                <span><span className="tn">扫码</span><span className="td">手机验证后确认</span></span>
              </button>
            </div>

            <MemberAgreement agreed={agreed} onAgreedChange={setAgreed} />
            {mode === 'phone' && state === 'phone-code-sent' ? (
              <div className="lg-sent" role="status" data-testid="login-gate-sent">
                <div className="lg-sent-h"><CheckIcon size={28} aria-hidden />验证码已发出，请在下面填验证码</div>
                <p>
                  短信已按这个号码发出。重新获取要等 <b>{phoneLogin.countdownTotal} 秒</b>
                  {phoneLogin.expiresInSeconds !== null ? <>，有效期 <b>{phoneLogin.expiresInSeconds} 秒</b></> : null}
                  。短信何时到达由运营商决定，这台机器看不到。
                </p>
              </div>
            ) : null}
            {mode === 'phone' ? (
              <LoginGatePhoneFields {...phoneLogin.paneProps} error={phoneFieldsError} state={phoneState} />
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

            {state === 'phone-idle' ? (
              <section className="lg-benefits">
                <div className="qx-sec-h"><span className="t">登录之后多出什么</span></div>
                <div className="lg-grid2">
                  <div className="qx-card lg-benefit">
                    <h3><span className="lg-benefit-ic" data-tone="teal"><FilesIcon size={26} aria-hidden /></span>本人资产按账号归集</h3>
                    <p>我的文档、打印订单、AI 服务记录归到你名下，<b>只有本人可见</b>。要删、要留，按各自的保存期限。</p>
                  </div>
                  <div className="qx-card lg-benefit">
                    <h3><span className="lg-benefit-ic" data-tone="slate"><Link2Icon size={26} aria-hidden /></span>手机与这台机器接得上</h3>
                    <p>手机上下单拿到的到机码、手机传上来的文件，能和这台机器对上号，不用重新传一遍。</p>
                  </div>
                </div>
              </section>
            ) : null}

            <section className="lg-anon">
              <div className="qx-sec-h"><span className="t">不登录也能办</span></div>
              <div className="lg-entries">
                {loginAnonEntries().map((entry, index) => {
                  const Icon = ANON_ICONS[entry.id] ?? PrinterIcon
                  return (
                    <button
                      key={entry.id}
                      type="button"
                      className="lg-entry"
                      data-testid={`login-gate-anon-${index}`}
                      onClick={() => navigate(entry.route)}
                    >
                      <span className="ei" data-tone={entry.id} aria-hidden="true"><Icon size={26} /></span>
                      <span className="eb">
                        <span className="en">{entry.title}</span>
                        <span className="ed">{entry.desc}</span>
                      </span>
                      <span className="ego" aria-hidden="true"><ChevronRightIcon size={22} /></span>
                    </button>
                  )
                })}
              </div>
            </section>
          </div>
          <p className="lg-truth" data-disclaimer="true">登录只用于本人服务记录，身份与验证码由登录服务核验。</p>
          <QxStepActions onPrev={goHome} prevLabel="返回首页">
            <QxAiHelp label="问小青：登录后能办什么？" draft="登录后可以办理哪些服务？不登录还能做什么？" />
          </QxStepActions>
        </QxPageFrame>
      </KioskStageFit>
    </div>
  )
}
