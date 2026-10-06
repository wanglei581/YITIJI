import { useEffect, useRef, useState } from 'react'
import { helpNeededLine } from '../../../../copy/unattendedCopy'
import { useSupportContact } from '../../../../hooks/useSupportContact'
import { QxPageFrame } from '../../../../components/qingxu/QxPageFrame'
import { QxAiHelp, QxStepActions } from '../../../../components/qingxu/QxAiHelp'
import { useBusyLock } from '../../../../contexts/KioskBusyContext'
import { useIdleTimer } from '../../../../hooks/useIdleTimer'
import { maskPhone } from '../../../../utils/maskPii'
import { MemberApiError, sendSmsCode, sendPhoneRebindStepUpCode, verifyPhoneRebindStepUp, submitPhoneRebind, type StepUpChallengeResult } from '../../../../services/auth/memberAuthApi'
import { accountErrorMessage, accountPhoneDisplay, phoneRebindRecovery } from '../../../auth/accountUserMessage'
import { isSendLimitedCode } from '../../../auth/loginGateModel'
import { SettingsConfirm } from './SettingsConfirm'

type RebindStep = 'send_old' | 'verify_old' | 'send_new' | 'verify_new' | 'done'
const STEPS: RebindStep[] = ['send_old', 'verify_old', 'send_new', 'verify_new']
const LABELS = ['发送旧号验证码', '验证旧手机号', '填写新手机号', '验证并换绑']
const STATE: Record<RebindStep, string> = { send_old: 'phone-old-code', verify_old: 'phone-old-verify', send_new: 'phone-new-code', verify_new: 'phone-new-verify', done: 'phone-clearing' }

export function PhoneRebindPanel({ phoneMasked, token, onDone, onRecheck, onCancel }: {
  phoneMasked: string
  token: string
  onDone: () => void
  onRecheck: () => void
  onCancel: () => void
}) {
  const contact = useSupportContact()
  const [step, setStep] = useState<RebindStep>('send_old')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [errorCode, setErrorCode] = useState<string | null>(null)
  const [recovery, setRecovery] = useState<'restart' | 'relogin' | null>(null)
  const [challenge, setChallenge] = useState<StepUpChallengeResult | null>(null)
  const [oldOtp, setOldOtp] = useState('')
  const [stepUpToken, setStepUpToken] = useState('')
  const [newPhone, setNewPhone] = useState('')
  const [newOtp, setNewOtp] = useState('')
  const [cooldownUntil, setCooldownUntil] = useState(0)
  const [expiresAt, setExpiresAt] = useState(0)
  const [now, setNow] = useState(Date.now)
  const [leaveConfirm, setLeaveConfirm] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const generation = useRef(0)
  const inFlight = useRef(false)
  const pendingAi = useRef<HTMLButtonElement | null>(null)
  const allowAi = useRef(false)
  const cooldown = Math.max(0, Math.ceil((cooldownUntil - now) / 1000))
  const remaining = Math.max(0, Math.ceil((expiresAt - now) / 1000))
  const expired = (step === 'verify_old' || step === 'verify_new') && expiresAt > 0 && remaining === 0
  const unusable = expired || ['STEP_UP_CHALLENGE_INVALID', 'SMS_CODE_EXPIRED', 'SMS_CODE_LOCKED'].includes(errorCode ?? '')
  const restartRequired = recovery === 'restart' || errorCode === 'STEP_UP_TOKEN_INVALID'
  const stepIndex = step === 'done' ? 4 : STEPS.indexOf(step)
  useBusyLock(busy || step === 'done')

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => { window.clearInterval(timer); generation.current += 1 }
  }, [])
  useEffect(() => { inputRef.current?.focus() }, [step])
  // 保留 45 秒隐私期限；正在提交时由全局忙碌锁接管，禁止中途放行。
  useIdleTimer({ timeoutMs: 45_000, enabled: step !== 'done' && !busy, onIdle: onCancel })

  const handle = async (fn: (current: () => boolean) => Promise<void>) => {
    if (inFlight.current) return
    const request = ++generation.current
    const current = () => request === generation.current
    inFlight.current = true
    setErr(null); setErrorCode(null); setBusy(true)
    try { await fn(current) } catch (error) {
      if (!current()) return
      setErrorCode(error instanceof MemberApiError ? error.code : null)
      setErr(accountErrorMessage(error, `这一步没有完成，请重试。${helpNeededLine(contact)}`))
      if (step === 'verify_old') setOldOtp('')
      if (step === 'verify_new') setNewOtp('')
      if (error instanceof MemberApiError && error.code === 'SMS_SEND_FAILED') {
        setCooldownUntil(0); setExpiresAt(0)
        if (step === 'verify_old') { setChallenge(null); setStep('send_old') }
        if (step === 'verify_new') setStep('send_new')
      }
    } finally {
      if (current()) { inFlight.current = false; setBusy(false) }
    }
  }
  const setTiming = (result: { cooldownSeconds: number; expiresInSeconds: number }) => {
    const time = Date.now()
    setNow(time)
    setCooldownUntil(time + Math.max(0, result.cooldownSeconds) * 1000)
    setExpiresAt(time + Math.max(0, result.expiresInSeconds) * 1000)
  }
  const step1 = () => handle(async (current) => {
    const c = await sendPhoneRebindStepUpCode(token)
    if (!current()) return
    setChallenge(c); setTiming(c); setOldOtp(''); setStep('verify_old')
  })
  const step2 = () => handle(async (current) => {
    if (!challenge || oldOtp.length !== 6 || unusable) return
    const g = await verifyPhoneRebindStepUp(token, challenge.challengeId, oldOtp)
    if (!current()) return
    setStepUpToken(g.stepUpToken); setOldOtp(''); setCooldownUntil(0); setExpiresAt(0); setStep('send_new')
  })
  const step3 = () => handle(async (current) => {
    if (!/^1[3-9]\d{9}$/.test(newPhone)) { setErr('请输入有效的大陆手机号'); inputRef.current?.focus(); return }
    const result = await sendSmsCode(newPhone)
    if (!current()) return
    setTiming(result); setNewOtp(''); setStep('verify_new')
  })
  const step4 = () => handle(async (current) => {
    if (newOtp.length !== 6 || unusable || recovery) return
    try { await submitPhoneRebind(token, stepUpToken, newPhone, newOtp) } catch (error) {
      if (current()) { setStepUpToken(''); setRecovery(phoneRebindRecovery(error)) }
      throw error
    }
    if (!current()) return
    setNewOtp(''); setOldOtp(''); setStepUpToken(''); setNewPhone(''); setStep('done')
    onDone()
  })
  const restart = () => {
    setChallenge(null); setStepUpToken(''); setOldOtp(''); setNewOtp(''); setNewPhone('')
    setCooldownUntil(0); setExpiresAt(0); setErr(null); setErrorCode(null); setRecovery(null); setStep('send_old')
  }
  const value = step === 'verify_old' ? oldOtp : step === 'send_new' ? newPhone : newOtp
  const setValue = step === 'verify_old' ? setOldOtp : step === 'send_new' ? setNewPhone : setNewOtp
  const maxLength = step === 'send_new' ? 11 : 6
  const hasInput = step !== 'send_old' && step !== 'done'
  const limited = isSendLimitedCode(errorCode) || errorCode === 'STEP_UP_SEND_TOO_FREQUENT' || errorCode === 'STEP_UP_RATE_LIMITED'
  const state = step === 'done' ? (err ? 'phone-relogin-failed' : 'phone-clearing')
    : recovery ? (errorCode?.startsWith('REBIND_CODE_') ? 'phone-new-verify-failed' : 'phone-rebind-failed')
      : limited ? 'phone-rate-limited' : unusable ? 'phone-code-expired'
      : err ? (step === 'send_old' ? 'phone-old-send-failed' : step === 'verify_old' ? 'phone-old-verify-failed' : step === 'send_new' ? 'phone-new-send-failed' : restartRequired ? 'phone-rebind-failed' : 'phone-new-verify-failed')
        : busy && step === 'send_old' ? 'phone-old-sending' : STATE[step]
  const action = step === 'send_old' ? step1 : step === 'verify_old' ? step2 : step === 'send_new' ? step3 : step4
  const primaryDisabled = busy || (hasInput && (value.length !== maxLength || unusable))
  const cancel = () => { if (!busy && step !== 'done') setLeaveConfirm(true) }

  return (
    <div className="settings-page settings-rebind fusion-w5" data-kiosk-screen="member-settings" data-state={state} data-step={step} data-testid={`settings-state-${state}`} data-takeaway="更新本人绑定手机号">
      <QxPageFrame title="换绑手机号" subtitle="先验证旧手机号，再验证新手机号；完成后重新登录。"
        back={{ label: '返回账号设置', onBack: cancel }}
        status={{ tone: err ? 'warn' : 'unknown', label: step === 'done' ? '正在结束本次使用' : `第 ${stepIndex + 1} 步 / 共 4 步` }}
        ctabar={<><button type="button" className="qx-btn" data-variant="ghost" disabled={busy || step === 'done'} onClick={cancel}>取消换绑</button>
          {step === 'done' ? <button type="button" className="qx-btn" data-variant="primary" disabled={!err} onClick={onDone}>{err ? '重新前往登录' : '正在清除本机登录'}</button>
            : recovery === 'relogin' ? <button type="button" className="qx-btn" data-variant="primary" disabled={busy} onClick={() => handle(async () => onRecheck())}>重新登录核对</button>
              : restartRequired ? <button type="button" className="qx-btn" data-variant="primary" disabled={busy} onClick={restart}>重新验证旧手机号</button>
              : <button type="button" className="qx-btn" data-variant="primary" data-testid="settings-rebind-primary" disabled={primaryDisabled} onClick={action}>{busy ? (step === 'send_old' || step === 'send_new' ? '发送中…' : '验证中…') : step === 'send_old' || step === 'send_new' ? '发送验证码' : step === 'verify_old' ? '下一步' : '确认换绑'}</button>}</>}
      >
        <ol className="settings-rail" aria-label="换绑进度">{LABELS.map((label, i) => <li key={label} data-on={i < stepIndex ? 'done' : i === stepIndex ? 'cur' : 'todo'}><small>第 {i + 1} 步</small><b>{label}</b></li>)}</ol>
        <div className="qx-scroll qx-grow settings-body">
          <section className="settings-identity"><span>本人账号</span><b>{accountPhoneDisplay(phoneMasked)}</b></section>
          <section className="qx-card settings-form" aria-busy={busy}>
            <h2>{step === 'done' ? '手机号已换绑，正在退出本机登录' : LABELS[stepIndex]}</h2>
            {err ? <p role="alert" className="settings-error">{err}</p> : null}
            {restartRequired ? <p>请从旧手机号验证重新开始，再获取新号验证码完成换绑。</p> : recovery === 'relogin' ? <p>换绑结果还不能确认。请先结束本次使用，再用新手机号登录核对。{helpNeededLine(contact)}</p> : null}
            {step === 'send_old' ? <><p>将向当前手机号发送验证码，确认是本人操作后才能换绑。</p><div className="settings-facts"><div><span>当前手机号</span><b>{accountPhoneDisplay(phoneMasked)}</b></div><div><span>本步会做</span><b>发送短信，核对本人操作</b></div><div><span>发送次数</span><b>按系统限制执行</b></div><div><span>本步不会</span><b>改变手机号的绑定关系</b></div></div></> : null}
            {step === 'verify_old' ? <><p>已发送至 {accountPhoneDisplay(challenge?.phoneMasked ?? phoneMasked)}，输入 6 位验证码继续。</p><input ref={inputRef} type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={oldOtp} onChange={(e) => setOldOtp(e.target.value.replace(/\D/g, ''))} aria-label="当前手机号验证码，已隐藏显示" className="settings-input me-otp-mask" disabled={busy || unusable} /></> : null}
            {step === 'send_new' ? <><p>请输入新手机号，我们将发送验证码。</p><input ref={inputRef} type="password" inputMode="numeric" autoComplete="off" maxLength={11} value={newPhone} onChange={(e) => setNewPhone(e.target.value.replace(/\D/g, ''))} aria-label="新手机号" className="settings-input" disabled={busy} /><p>本次输入：{newPhone ? maskPhone(newPhone) : '尚未填写'} · {newPhone.length} / 11 位</p></> : null}
            {step === 'verify_new' ? <><p>已发送至 {maskPhone(newPhone)}{recovery ? '，请按上方说明继续。' : '，输入 6 位验证码确认换绑。'}</p><input ref={inputRef} type="password" inputMode="numeric" autoComplete="off" maxLength={6} value={newOtp} onChange={(e) => setNewOtp(e.target.value.replace(/\D/g, ''))} aria-label="新手机号验证码，已隐藏显示" className="settings-input me-otp-mask" disabled={busy || unusable || Boolean(recovery)} /></> : null}
            {hasInput && !restartRequired && !recovery ? <div className="settings-pad" role="group" aria-label="触屏数字键盘">{['1','2','3','4','5','6','7','8','9','清空','0','退格'].map((key) => <button type="button" key={key} disabled={busy || unusable} onClick={() => setValue(key === '清空' ? '' : key === '退格' ? value.slice(0, -1) : (value + key).slice(0, maxLength))}>{key}</button>)}</div> : null}
            {(step === 'verify_old' || step === 'verify_new') && !restartRequired && !recovery ? <div className="settings-resend"><button type="button" disabled={busy || cooldown > 0} onClick={step === 'verify_old' ? step1 : step3}>重新发送验证码</button><span>{cooldown > 0 ? `${cooldown} 秒后可重发` : '可以重新获取'} · {unusable ? '旧码已不能使用' : `验证码剩余 ${remaining} 秒`}</span></div> : null}
            {step === 'done' ? <p>请等待本机完成清理，然后用新手机号重新登录。</p> : null}
          </section>
          {!hasInput || unusable || restartRequired || recovery ? <section className="settings-facts"><h2>已完成 / 未完成</h2>{LABELS.map((label, i) => <div key={label}><span>{label}</span><b>{i < stepIndex ? '已完成' : i === stepIndex ? '当前步骤' : '未开始'}</b></div>)}<div><span>整体规则</span><b>四步全部通过才生效，没有一半成功的中间状态</b></div><div><span>中途离开</span><b>已填内容不保留，下次从旧手机号重新开始</b></div></section> : null}
          <section className="settings-note"><h2>换绑之前先确认</h2><p>换绑成功后，原有登录会失效，需要用新手机号重新登录。中途取消后，需要重新验证旧手机号。</p></section>
          <section className="settings-note"><h2>换绑安全规则</h2><p>验证码由系统发出，只用于本人换绑。本机不会显示完整手机号；任何一步失败都停在当前步骤，不会跳过验证。</p></section>
        </div>
        <fieldset className="settings-help" disabled={busy || step === 'done'} onClickCapture={(event) => {
          const button = (event.target as HTMLElement).closest<HTMLButtonElement>('.qx-ai-help')
          if (!button || allowAi.current) return
          event.preventDefault(); event.stopPropagation(); pendingAi.current = button; setLeaveConfirm(true)
        }}><QxStepActions onPrev={cancel} prevLabel="返回账号设置"><QxAiHelp label="问小青：换绑手机号要做什么？" draft="换绑手机号需要哪些步骤？换绑后如何重新登录？" /></QxStepActions></fieldset>
      </QxPageFrame>
      {leaveConfirm ? <SettingsConfirm title="取消这次换绑？" description="已填写的内容会清除，再次换绑需要从旧手机号验证开始。" confirmLabel="取消换绑" onCancel={() => { pendingAi.current = null; setLeaveConfirm(false) }} onConfirm={() => {
        if (pendingAi.current) { allowAi.current = true; pendingAi.current.click() } else onCancel()
      }} /> : null}
    </div>
  )
}
