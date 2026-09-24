import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { ShieldCheckIcon } from 'lucide-react'
import { sendSmsCode } from '../../services/auth/memberAuthApi'
import { confirmQrLogin, fetchQrLoginStatus } from '../../services/auth/memberQrLoginApi'
import {
  type MobileQrFacts,
  type SendErrorKind,
  type SendLimitKind,
  QR_TICKET_TTL_SECONDS,
  RETRY_GATE_SECONDS,
  SMS_RESEND_SECONDS,
  canConfirm,
  classifyConfirmError,
  classifySendError,
  classifyStatusError,
  confirmReason,
  isFormState,
  sendBlockedBy,
} from './mobileQrLoginModel'
import {
  chromeCopy,
  formAlertCopy,
  formDeviceCopy,
  formFactsCopy,
  formNoticesCopy,
  takeoverCopy,
} from './mobileQrLoginCopy'
import { DeviceCard, Facts, QrForm, QrIcon, StateCard, Steps } from './components/MobileQrLoginParts'
import './mobile-qr-service-desk.css'

/* 手机确认登录（/member/qr-login）。视觉与口径真值：稿 51-phone-relay.html screen=qr-login。
 * 手机端从头到尾拿不到登录态：服务端只回 confirmed，一体机还要自己 claim。
 * 所以每一屏都把人送回一体机；页面上的每个结论都只来自 status / sms-code / confirm 三个接口的回执。 */

interface Session extends MobileQrFacts {
  deviceLabel: string | null
  /** status.expiresInSeconds：打开本页（或重新检查）时读到的「剩余」秒数，不自己走秒。 */
  remain: number | null
  limitKind: SendLimitKind
  sendError: SendErrorKind
  serverMessage: string
  /** 最近一次发码成功回执里的重发间隔，用于「X 秒后可重新获取」这句话。 */
  sentSeconds: number
}

function initialSession(ticketId: string): Session {
  return {
    state: ticketId ? 'checking' : 'missing-ticket',
    phone: '', code: '', locked: false, hasUsableCode: false,
    cooldown: 0, retryGate: 0, dailyLimitedPhone: null,
    deviceLabel: null, remain: null, limitKind: 'later', sendError: 'channel',
    serverMessage: '', sentSeconds: SMS_RESEND_SECONDS,
  }
}

function formEntryState(deviceLabel: string | null) {
  return deviceLabel ? 'ready' as const : 'device-missing' as const
}

/** 递减秒表：只在值大于 0 时挂一个 1 秒定时器，值由回执或本页规则写入。 */
function useTick(value: number, onTick: () => void) {
  useEffect(() => {
    if (value <= 0) return undefined
    const timer = window.setTimeout(onTick, 1000)
    return () => window.clearTimeout(timer)
  }, [value, onTick])
}

const RECOVERY_STATES = new Set(['missing-ticket', 'status-error', 'ticket-expired'])

export function MobileQrLoginPage() {
  const [params] = useSearchParams()
  const ticketId = params.get('ticketId')?.trim() ?? ''
  const [s, setS] = useState<Session>(() => initialSession(ticketId))
  const aliveRef = useRef(true)
  const statusSeqRef = useRef(0)
  const phoneRef = useRef<HTMLInputElement>(null)
  const codeRef = useRef<HTMLInputElement>(null)
  const focusRef = useRef<'phone' | 'code' | null>(null)
  const flowRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    aliveRef.current = true
    return () => { aliveRef.current = false }
  }, [])

  // 换态即回到顶部：结论、原因与下一步必须先落在首屏，不能沿用上一屏的滚动位置。
  useEffect(() => {
    flowRef.current?.scrollTo({ top: 0 })
  }, [s.state])

  useEffect(() => {
    const target = focusRef.current === 'phone' ? phoneRef.current : focusRef.current === 'code' ? codeRef.current : null
    if (target && !target.disabled) {
      target.focus({ preventScroll: true })
      focusRef.current = null
    }
  })

  useTick(s.cooldown, useCallback(() => setS((prev) => ({ ...prev, cooldown: Math.max(0, prev.cooldown - 1) })), []))
  useTick(s.retryGate, useCallback(() => setS((prev) => ({ ...prev, retryGate: Math.max(0, prev.retryGate - 1) })), []))

  /** 读一次票据状态。「重新检查」也走这里：它就是再读一次 status，不会替用户再提交确认。 */
  const loadTicketStatus = useCallback(async () => {
    if (!ticketId) return
    const seq = ++statusSeqRef.current
    setS((prev) => ({ ...prev, state: 'checking', serverMessage: '' }))
    try {
      const status = await fetchQrLoginStatus(ticketId)
      if (!aliveRef.current || seq !== statusSeqRef.current) return
      const deviceLabel = status.deviceLabel?.trim() || null
      setS((prev) => status.status === 'confirmed'
        // 票据已被确认过：可能是刚才那次、也可能是别人，本页不替服务端说「成功了」。
        ? { ...prev, state: 'ticket-expired', deviceLabel, remain: null, code: '' }
        : { ...prev, state: formEntryState(deviceLabel), deviceLabel, remain: status.expiresInSeconds })
    } catch (err) {
      if (!aliveRef.current || seq !== statusSeqRef.current) return
      const failure = classifyStatusError(err)
      setS((prev) => failure.kind === 'ticket-dead'
        ? { ...prev, state: 'ticket-expired', remain: null, code: '' }
        : { ...prev, state: 'status-error', serverMessage: failure.message })
    }
  }, [ticketId])

  useEffect(() => {
    void loadTicketStatus()
  }, [loadTicketStatus])

  const handleSendCode = useCallback(async () => {
    if (sendBlockedBy(s) !== null) return
    const phone = s.phone
    setS((prev) => ({ ...prev, state: 'send-loading', serverMessage: '' }))
    try {
      const result = await sendSmsCode(phone)
      if (!aliveRef.current) return
      const seconds = result.cooldownSeconds > 0 ? result.cooldownSeconds : SMS_RESEND_SECONDS
      focusRef.current = 'code'
      // 只有成功回执才锁号、起倒计时、写「已发送」；本页那道最短等待由回执冷却接管。
      setS((prev) => ({ ...prev, state: 'code-sent', locked: true, hasUsableCode: true, cooldown: seconds, sentSeconds: seconds, retryGate: 0 }))
    } catch (err) {
      if (!aliveRef.current) return
      const failure = classifySendError(err)
      setS((prev) => {
        if (failure.kind === 'limited') {
          // 频控不改 locked / hasUsableCode：这次请求什么都没改变。明天口径绑号码，稍后口径起本页最短等待。
          return failure.limit === 'tomorrow'
            ? { ...prev, state: 'send-limited', limitKind: 'tomorrow', dailyLimitedPhone: phone, retryGate: 0 }
            : { ...prev, state: 'send-limited', limitKind: 'later', retryGate: RETRY_GATE_SECONDS }
        }
        if (failure.error === 'channel') {
          // 服务端把刚写入的验证码和冷却一起删了：退回「还没发过码」，并且可以马上重试。
          return { ...prev, state: 'send-error', sendError: 'channel', locked: false, hasUsableCode: false, code: '', cooldown: 0, retryGate: 0 }
        }
        if (failure.error === 'unknown') {
          // 可能已经生成了一条覆盖旧码的新码，也可能没有：不再开放任何一条码的输入。
          return { ...prev, state: 'send-error', sendError: 'unknown', hasUsableCode: false, code: '', retryGate: 0 }
        }
        return { ...prev, state: 'send-error', sendError: 'rejected', serverMessage: failure.message }
      })
    }
  }, [s])

  const handleConfirm = useCallback(async () => {
    if (!ticketId || !canConfirm(s)) return
    const { phone, code } = s
    setS((prev) => ({ ...prev, state: 'confirming', serverMessage: '' }))
    try {
      await confirmQrLogin(ticketId, phone, code)
      if (!aliveRef.current) return
      // 确认成功 = 服务端已消费那条码。手机号与验证码不再留在本页。
      setS((prev) => ({ ...prev, state: 'confirmed', phone: '', code: '', hasUsableCode: false, cooldown: 0, retryGate: 0 }))
    } catch (err) {
      if (!aliveRef.current) return
      const failure = classifyConfirmError(err)
      if (failure.kind === 'confirm-code-invalid') focusRef.current = 'code'
      setS((prev) => {
        switch (failure.kind) {
          case 'confirm-code-invalid':
            return { ...prev, state: failure.kind, code: '' }
          case 'confirm-code-expired':
          case 'confirm-code-locked':
            return { ...prev, state: failure.kind, code: '', hasUsableCode: false }
          case 'ticket-expired':
            return { ...prev, state: 'ticket-expired', remain: null, code: '' }
          case 'confirm-unknown':
            // 结果未知：不清验证码、不给盲重试，那次确认可能早就生效了。
            return { ...prev, state: 'confirm-unknown' }
          default:
            return { ...prev, state: 'confirm-rejected', serverMessage: failure.message }
        }
      })
    }
  }, [s, ticketId])

  const handleChangePhone = useCallback(() => {
    // 换号 = 之前那次发码对新号码毫无意义；最短等待与「今天不能再发的号码」是换号改变不了的事实，保留。
    focusRef.current = 'phone'
    setS((prev) => ({ ...prev, state: formEntryState(prev.deviceLabel), locked: false, hasUsableCode: false, code: '', cooldown: 0 }))
  }, [])

  const ready = isFormState(s.state)
  const takeover = takeoverCopy(s.state, s.deviceLabel)
  const alert = ready ? formAlertCopy(s) : null
  const compact = s.locked || alert !== null
  const device = formDeviceCopy(s.deviceLabel, compact)
  const chrome = chromeCopy(s.state)

  return (
    <main className="fusion-w5 fusion-w5--auth service-desk k1-mobile-qr-login" data-kiosk-screen="member-qr-login" data-visual-theme="service-desk" data-ux-density="touch" data-kiosk-presentation="fusion-youth" data-kiosk-viewport="mobile" data-mobile-qr-state={s.state}>
      <section className="k1-mobile-qr-content">
        <header className="k1-mobile-qr-relaybar">
          <span className="k1-mobile-qr-seal" aria-hidden="true">职</span>
          <div className="k1-mobile-qr-brand">
            <strong>职易达</strong>
            <small><span>手机确认登录</span><span> · {chrome.suffix}</span></small>
          </div>
          <span className="k1-mobile-qr-tag">{chrome.tag}</span>
        </header>
        <div className="k1-mobile-qr-wave" aria-hidden="true" />

        <div className="k1-mobile-qr-flow" ref={flowRef}>
          {!ready ? (
            <section className={RECOVERY_STATES.has(s.state) ? 'k1-mobile-qr-takeover k1-mobile-qr-invalid' : 'k1-mobile-qr-takeover'}>
              {takeover && (
                <>
                  <DeviceCard {...takeover.device} />
                  <StateCard copy={takeover.card}>
                    {s.state === 'status-error' && s.serverMessage && (
                      <p className="k1-mobile-qr-server-note">系统说明：<span>{s.serverMessage}</span></p>
                    )}
                    {s.state === 'status-error' && (
                      <button type="button" className="k1-mobile-qr-retry" onClick={() => void loadTicketStatus()}>
                        重新检查二维码
                      </button>
                    )}
                  </StateCard>
                  <div className="k1-mobile-qr-grow" />
                  <Facts rows={takeover.facts} />
                </>
              )}
            </section>
          ) : (
            <>
              <DeviceCard
                {...device}
                compact={compact}
                chip={s.remain === null ? null : <>打开本页时剩余 <b>{s.remain} 秒</b> · <span>自一体机生成起共 {QR_TICKET_TTL_SECONDS} 秒</span></>}
              />
              {alert && (
                <section className={alert.tone === 'error' ? 'k1-mobile-qr-alert k1-mobile-qr-error' : 'k1-mobile-qr-alert'} data-tone={alert.tone} role={alert.tone === 'error' ? 'alert' : 'status'}>
                  <QrIcon name={alert.icon} />
                  <div><b>{alert.head}</b><span>{alert.body}</span></div>
                </section>
              )}
              <Steps />
              <QrForm
                facts={s}
                notices={formNoticesCopy(s, s.sentSeconds)}
                phoneRef={phoneRef}
                codeRef={codeRef}
                onPhone={(phone) => setS((prev) => ({ ...prev, phone }))}
                onCode={(code) => setS((prev) => ({ ...prev, code }))}
                onSend={() => void handleSendCode()}
                onChangePhone={handleChangePhone}
              />
              <div className="k1-mobile-qr-grow" />
              <Facts rows={formFactsCopy(s)} />
            </>
          )}
        </div>

        {ready && (
          <div className="k1-mobile-qr-dock">
            {s.state === 'confirm-unknown' ? (
              <>
                <button type="button" className="k1-mobile-qr-confirm" aria-label="重新检查这张二维码的状态" onClick={() => void loadTicketStatus()}>
                  重新检查这张二维码
                </button>
                <p className="k1-mobile-qr-reason">本页不会替你再提交一次确认。先回一体机看屏幕最快。</p>
              </>
            ) : (
              <>
                <button type="button" className="k1-mobile-qr-confirm" aria-disabled={!canConfirm(s) || undefined} aria-label="确认本次一体机登录请求" onClick={() => void handleConfirm()}>
                  {s.state === 'confirming' ? '确认中…' : '确认本次登录请求'}
                </button>
                <p className="k1-mobile-qr-reason">{confirmReason(s)}</p>
              </>
            )}
          </div>
        )}

        <p className="k1-mobile-qr-footer">
          <ShieldCheckIcon aria-hidden="true" />
          <span>本页只做这一次登录确认，不读取手机里的其他信息；手机号在系统中加密存储，完整号码只在输入框内供本人核对，获取验证码后改为脱敏显示。</span>
        </p>
      </section>
    </main>
  )
}
