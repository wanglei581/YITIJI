import '../upload/phone-upload-service-desk.css'
import '../upload/kiosk-code-entry.css'
import './phone-invoice.css'
import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { BanIcon, CircleAlertIcon, CircleCheckIcon, HourglassIcon, type LucideIcon } from 'lucide-react'
import { PLATFORM_BRAND_NAME } from '../../copy/miniappLinkCopy'
import { useSupportContact } from '../../hooks/useSupportContact'
import { ApiHttpError } from '../../services/api/httpAdapter'
import {
  buildPhoneInvoiceUrl,
  isInvoiceEmail,
  isInvoiceSceneToken,
  readInvoicePhoneCreds,
  resolveInvoiceScene,
  submitInvoicePhone,
} from '../../services/api/invoiceSessions'
import {
  INVOICE_ALREADY,
  INVOICE_BLOCKED_NEXT,
  INVOICE_COLD,
  INVOICE_COMPANY_HINT,
  INVOICE_EMAIL_INVALID,
  INVOICE_EXPIRED,
  INVOICE_FIELD_EMAIL,
  INVOICE_FIELD_TAX,
  INVOICE_FIELD_TITLE,
  INVOICE_FINE,
  INVOICE_KIND,
  INVOICE_LIST_TITLE,
  INVOICE_NO_ID,
  INVOICE_OPENING,
  INVOICE_PAGE_TITLE,
  INVOICE_RETRY,
  INVOICE_RETRY_LABEL,
  INVOICE_STEPS,
  INVOICE_SUBMIT_LABEL,
  INVOICE_SUBMITTED,
  INVOICE_TITLE_TOO_LONG,
  invoiceSpecialLine,
} from './phoneInvoiceCopy'

type RelayState = 'resolving' | 'unusable' | 'retryable' | 'submitted'

function relayFailure(error: unknown): Exclude<RelayState, 'resolving'> {
  if (!(error instanceof ApiHttpError)) return 'unusable'
  const { status, code } = error
  if (status === 0 || status === 408 || status === 429 || status >= 500) return 'retryable'
  if (code === 'INVOICE_ALREADY_SUBMITTED') return 'submitted'
  return 'unusable'
}

function Shell({ screen, state, children }: { screen: string; state: string; children: ReactNode }) {
  return (
    <main
      className="fusion-w5 fusion-w5--auth k1-phone-upload service-desk"
      data-qx-page={screen}
      data-kiosk-screen={screen}
      data-visual-theme="service-desk"
      data-ux-density="touch"
      data-kiosk-presentation="fusion-youth"
      data-kiosk-viewport="mobile"
      data-phone-invoice-state={state}
    >
      <section className="k1-phone-upload-content">
        <header className="ph-up-relaybar">
          <span className="ph-up-seal" aria-hidden="true">{PLATFORM_BRAND_NAME.slice(0, 1)}</span>
          <div className="ph-up-brand">
            <strong>{PLATFORM_BRAND_NAME}</strong>
            <small>填写开票信息</small>
          </div>
        </header>
        <div className="ph-up-wave" aria-hidden="true" />
        <div className="ph-up-flow">{children}</div>
      </section>
    </main>
  )
}

function StateCard({ icon: Glyph, text, alert, children }: { icon: LucideIcon; text: string; alert?: boolean; children?: ReactNode }) {
  return (
    <section className="ph-up-statecard" role={alert ? 'alert' : 'status'}>
      <span className="ph-up-glyph"><Glyph aria-hidden="true" /></span>
      <h1>{text}</h1>
      {children}
    </section>
  )
}

/** /k/i/:scene —— 兑换场景码后 replace 到手机填写页。凭据只放 fragment。 */
export function InvoiceSceneEntry() {
  const { scene = '' } = useParams()
  const navigate = useNavigate()
  const wellFormed = isInvoiceSceneToken(scene)
  const [attempt, setAttempt] = useState(0)
  const [failure, setFailure] = useState<{ key: string; kind: Exclude<RelayState, 'resolving'> } | null>(null)
  const key = `${scene}\n${attempt}`

  useEffect(() => {
    if (!wellFormed) return undefined
    let live = true
    resolveInvoiceScene(scene).then(
      (resolved) => {
        if (!live) return
        if (!resolved.sessionId || !resolved.submitToken) {
          setFailure({ key, kind: 'unusable' })
          return
        }
        const target = new URL(buildPhoneInvoiceUrl(resolved.sessionId, resolved.submitToken))
        navigate(`${target.pathname}${target.hash}`, { replace: true })
      },
      (error: unknown) => {
        if (live) setFailure({ key, kind: relayFailure(error) })
      },
    )
    return () => { live = false }
  }, [key, navigate, scene, wellFormed])

  const state: RelayState = !wellFormed ? 'unusable' : failure?.key === key ? failure.kind : 'resolving'
  const text = state === 'submitted' ? INVOICE_ALREADY : state === 'retryable' ? INVOICE_RETRY : state === 'resolving' ? INVOICE_OPENING : INVOICE_EXPIRED
  return (
    <Shell screen="invoice-scene-entry" state={state}>
      <StateCard icon={state === 'retryable' ? CircleAlertIcon : state === 'resolving' ? HourglassIcon : BanIcon} text={text} alert={state !== 'resolving'}>
        {state === 'retryable' && (
          <button type="button" className="ph-entry-retry" onClick={() => setAttempt((value) => value + 1)}>{INVOICE_RETRY_LABEL}</button>
        )}
      </StateCard>
    </Shell>
  )
}

/** 专用发票这一句带上公开的服务电话。只在表单屏读号码，其它状态屏不发这条请求。 */
function SpecialInvoiceLine() {
  const contact = useSupportContact()
  return <p className="ph-inv-note" data-testid="invoice-special-line">{invoiceSpecialLine(contact)}</p>
}

type FillPhase = 'form' | 'submitted' | 'expired' | 'already' | 'blocked'
type TitleType = 'personal' | 'company'

function chineseMessage(error: ApiHttpError): string {
  const message = error.message.trim()
  if (!/[\u4e00-\u9fff]/.test(message)) return ''
  if (/[A-Za-z_]{8,}/.test(message)) return ''
  return message
}

/** /invoice/phone —— 手机上填抬头、税号、邮箱。没有 fragment 凭据时只说明链接不成立。 */
export function PhoneInvoicePage() {
  const creds = readInvoicePhoneCreds(window.location.hash)
  const [phase, setPhase] = useState<FillPhase>(creds ? 'form' : 'form')
  const [titleType, setTitleType] = useState<TitleType>('personal')
  const [title, setTitle] = useState('')
  const [taxId, setTaxId] = useState('')
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  if (!creds) {
    return (
      <Shell screen="phone-invoice" state="cold">
        <StateCard icon={BanIcon} text={INVOICE_COLD} alert />
      </Shell>
    )
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault()
    if (!creds || busy) return
    const nextTitle = title.trim()
    if (!nextTitle) {
      setNote(INVOICE_FIELD_TITLE)
      return
    }
    if (nextTitle.length > 80) {
      setNote(INVOICE_TITLE_TOO_LONG)
      return
    }
    if (titleType === 'company' && !taxId.trim()) {
      setNote(INVOICE_COMPANY_HINT)
      return
    }
    if (!isInvoiceEmail(email.trim())) {
      setNote(INVOICE_EMAIL_INVALID)
      return
    }
    setBusy(true)
    setNote('')
    try {
      await submitInvoicePhone({
        sessionId: creds.sessionId,
        submitToken: creds.submitToken,
        titleType,
        title: nextTitle,
        email: email.trim(),
        ...(titleType === 'company' ? { taxId: taxId.trim() } : {}),
      })
      setPhase('submitted')
    } catch (error) {
      if (!(error instanceof ApiHttpError)) {
        setNote(INVOICE_RETRY)
        return
      }
      if (error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500) {
        setNote(INVOICE_RETRY)
        return
      }
      if (error.code === 'INVOICE_ALREADY_SUBMITTED') {
        setPhase('already')
        return
      }
      if (error.code === 'INVOICE_SCENE_UNUSABLE') {
        setPhase('expired')
        return
      }
      if (error.code === 'INVOICE_NOT_ALLOWED' || error.code === 'INVOICE_ALREADY_REQUESTED') {
        setReason(chineseMessage(error))
        setPhase('blocked')
        return
      }
      setNote(chineseMessage(error) || INVOICE_EMAIL_INVALID)
    } finally {
      setBusy(false)
    }
  }

  if (phase === 'submitted') {
    return (
      <Shell screen="phone-invoice" state="submitted">
        <StateCard icon={CircleCheckIcon} text={INVOICE_SUBMITTED} />
      </Shell>
    )
  }
  if (phase === 'expired') {
    return (
      <Shell screen="phone-invoice" state="expired">
        <StateCard icon={BanIcon} text={INVOICE_EXPIRED} alert />
      </Shell>
    )
  }
  if (phase === 'already') {
    return (
      <Shell screen="phone-invoice" state="already">
        <StateCard icon={BanIcon} text={INVOICE_ALREADY} alert />
      </Shell>
    )
  }
  if (phase === 'blocked') {
    return (
      <Shell screen="phone-invoice" state="blocked">
        <StateCard icon={BanIcon} text={INVOICE_BLOCKED_NEXT} alert>
          {reason ? <p>{reason}</p> : null}
        </StateCard>
      </Shell>
    )
  }

  return (
    <Shell screen="phone-invoice" state="form">
      <form className="ph-inv" onSubmit={onSubmit}>
        <h1>{INVOICE_PAGE_TITLE}</h1>
        <ol className="ph-up-steps" aria-label="三步">
          {INVOICE_STEPS.map((step, index) => (
            <li key={step}><span className="ph-up-step-no" aria-hidden="true">{index + 1}</span><span>{step}</span></li>
          ))}
        </ol>
        <h2>{INVOICE_LIST_TITLE}</h2>
        <div className="ph-inv-choice" role="group" aria-label="抬头类型">
          <button type="button" aria-pressed={titleType === 'personal'} onClick={() => { setTitleType('personal'); setTaxId('') }}>个人</button>
          <button type="button" aria-pressed={titleType === 'company'} onClick={() => setTitleType('company')}>单位</button>
        </div>
        <label className="ph-inv-field">
          {INVOICE_FIELD_TITLE}
          <input name="title" value={title} maxLength={80} autoComplete="name" onChange={(event) => setTitle(event.target.value)} />
        </label>
        <p className="ph-inv-note" id="invoice-tax-hint">{INVOICE_FIELD_TAX}</p>
        {titleType === 'company' && (
          <label className="ph-inv-field">
            {INVOICE_COMPANY_HINT}
            <input name="taxId" aria-describedby="invoice-tax-hint" value={taxId} maxLength={18} autoComplete="off" onChange={(event) => setTaxId(event.target.value)} />
          </label>
        )}
        <label className="ph-inv-field">
          {INVOICE_FIELD_EMAIL}
          <input name="email" type="email" inputMode="email" autoComplete="email" value={email} maxLength={120} onChange={(event) => setEmail(event.target.value)} />
        </label>
        <p className="ph-inv-note">{INVOICE_KIND}</p>
        <p className="ph-inv-note">{INVOICE_NO_ID}</p>
        <SpecialInvoiceLine />
        <p className="ph-inv-note">{INVOICE_FINE}</p>
        {note ? <p className="ph-inv-alert" role="alert">{note}</p> : null}
        <button type="submit" className="ph-entry-retry" disabled={busy}>{INVOICE_SUBMIT_LABEL}</button>
      </form>
    </Shell>
  )
}
