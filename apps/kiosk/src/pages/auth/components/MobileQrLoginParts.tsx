/* 手机确认登录（稿 51 screen=qr-login）的展示件。只负责落版，事实与文案来自
 * ../mobileQrLoginModel.ts 与 ../mobileQrLoginCopy.ts；请求与状态推进在 MobileQrLoginPage。 */
import type { ReactNode, Ref } from 'react'
import {
  BanIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleHelpIcon,
  ClockIcon,
  HourglassIcon,
  InfoIcon,
  LoaderCircleIcon,
  LockIcon,
  MonitorIcon,
  QrCodeIcon,
  ShieldCheckIcon,
  type LucideIcon,
} from 'lucide-react'
import type { FactRow, QrIconKey, QrNoticeCopy, QrStateCardCopy } from '../mobileQrLoginCopy'
import {
  type MobileQrFacts,
  CODE_LENGTH,
  PHONE_LENGTH,
  codeInputEnabled,
  normalizeDigits,
  sendBlockedBy,
  sendLabel,
  sendLabelAria,
} from '../mobileQrLoginModel'
import { maskPhone } from '../../../utils/maskPii'

const ICONS: Record<QrIconKey, LucideIcon> = {
  alert: CircleAlertIcon,
  ban: BanIcon,
  check: CircleCheckIcon,
  clock: ClockIcon,
  help: CircleHelpIcon,
  info: InfoIcon,
  loader: LoaderCircleIcon,
  lock: LockIcon,
  qr: QrCodeIcon,
  wait: HourglassIcon,
}

export function QrIcon({ name, className }: { name: QrIconKey; className?: string }) {
  const Icon = ICONS[name]
  return <Icon aria-hidden="true" className={className} />
}

export function DeviceCard({ name, unknown, desc, chip, note, compact }: {
  name: string
  unknown: boolean
  desc: string
  chip?: ReactNode
  note?: string
  compact?: boolean
}) {
  return (
    <section className="k1-mobile-qr-device" data-compact={compact ? '1' : undefined} data-device={unknown ? 'unknown' : 'named'}>
      <span className="k1-mobile-qr-device-glyph"><MonitorIcon aria-hidden="true" /></span>
      <div className="k1-mobile-qr-device-copy">
        <h1>{name}</h1>
        <p>{desc}</p>
        {chip ? <span className="k1-mobile-qr-device-chip">{chip}</span> : null}
      </div>
      {note ? (
        <p className="k1-mobile-qr-device-note">
          <QrIcon name={unknown ? 'help' : 'info'} />
          <span>{note}</span>
        </p>
      ) : null}
    </section>
  )
}

export function StateCard({ copy, children }: { copy: QrStateCardCopy; children?: ReactNode }) {
  return (
    <section className="k1-mobile-qr-statecard" data-kind={copy.kind} role={copy.kind === 'error' ? 'alert' : 'status'}>
      <span className="k1-mobile-qr-glyph" data-spin={copy.icon === 'loader' ? '1' : undefined}>
        <QrIcon name={copy.icon} />
      </span>
      <h2>{copy.head}</h2>
      <p>{copy.body}</p>
      {children}
    </section>
  )
}

export function Notice({ copy }: { copy: QrNoticeCopy }) {
  return (
    <p className="k1-mobile-qr-notice" data-tone={copy.tone} data-notice={copy.id} role={copy.tone === 'error' ? 'alert' : 'status'}>
      <QrIcon name={copy.icon} />
      <span>{copy.text}</span>
    </p>
  )
}

export function Facts({ rows }: { rows: readonly FactRow[] }) {
  if (rows.length === 0) return null
  return (
    <dl className="k1-mobile-qr-facts">
      {rows.map(([key, value]) => (
        <div key={key}>
          <dt>{key}</dt>
          <dd>{value}</dd>
        </div>
      ))}
    </dl>
  )
}

const STEPS = ['核对这台机器', '手机号验证', '回一体机继续'] as const

/** 三步条只写「接下来怎么做」，不是进度，不表达已完成。 */
export function Steps() {
  return (
    <ol className="k1-mobile-qr-steps" aria-label="手机确认登录的三步">
      {STEPS.map((step, index) => (
        <li key={step}>
          <span className="k1-mobile-qr-step-no" aria-hidden="true">{index + 1}</span>
          <span>{step}</span>
        </li>
      ))}
    </ol>
  )
}

export function QrForm({ facts, notices, phoneRef, codeRef, onPhone, onCode, onSend, onChangePhone }: {
  facts: MobileQrFacts
  notices: readonly QrNoticeCopy[]
  phoneRef: Ref<HTMLInputElement>
  codeRef: Ref<HTMLInputElement>
  onPhone: (value: string) => void
  onCode: (value: string) => void
  onSend: () => void
  onChangePhone: () => void
}) {
  const { state, phone, code, locked, hasUsableCode } = facts
  const busy = state === 'confirming' || state === 'send-loading'
  const frozen = busy || state === 'confirm-unknown'
  const codeOff = !codeInputEnabled(facts)
  const sendOff = sendBlockedBy(facts) !== null
  const codeHolder = hasUsableCode ? '6 位验证码' : locked ? '请先重新获取' : '先获取验证码'

  return (
    <section className="k1-mobile-qr-card" aria-label="手机号验证">
      {locked ? (
        <>
          <span className="k1-mobile-qr-label" id="k1-mobile-qr-phone-lock-label">手机号</span>
          <div className="k1-mobile-qr-lockrow" role="group" aria-labelledby="k1-mobile-qr-phone-lock-label">
            <LockIcon aria-hidden="true" />
            <span className="k1-mobile-qr-masked">+86 {maskPhone(phone)}</span>
            <button type="button" className="k1-mobile-qr-change" aria-disabled={frozen || undefined} aria-label="更换手机号并重新获取验证码" onClick={() => { if (!frozen) onChangePhone() }}>
              更换
            </button>
          </div>
        </>
      ) : (
        <>
          <label className="k1-mobile-qr-label" htmlFor="k1-mobile-qr-phone">手机号</label>
          <div className="k1-mobile-qr-field">
            <span className="k1-mobile-qr-prefix" aria-hidden="true">+86</span>
            <input
              ref={phoneRef}
              id="k1-mobile-qr-phone"
              className="k1-mobile-qr-input"
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              placeholder="请输入本人手机号"
              aria-label="手机号，11 位数字"
              value={phone}
              disabled={busy}
              onChange={(event) => onPhone(normalizeDigits(event.target.value, PHONE_LENGTH))}
            />
          </div>
        </>
      )}

      <label className="k1-mobile-qr-label" htmlFor="k1-mobile-qr-code">验证码</label>
      <div className="k1-mobile-qr-code-row">
        <div className="k1-mobile-qr-field">
          <ShieldCheckIcon aria-hidden="true" className="k1-mobile-qr-field-icon" />
          <input
            ref={codeRef}
            id="k1-mobile-qr-code"
            className="k1-mobile-qr-input"
            type="tel"
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder={codeHolder}
            aria-label="短信验证码，6 位数字"
            value={code}
            disabled={codeOff}
            onChange={(event) => onCode(normalizeDigits(event.target.value, CODE_LENGTH))}
          />
        </div>
        <button type="button" className="k1-mobile-qr-send" aria-disabled={sendOff || undefined} aria-label={sendLabelAria(facts)} onClick={() => { if (!sendOff) onSend() }}>
          {sendLabel(facts)}
        </button>
      </div>

      {notices.map((notice) => <Notice key={notice.id} copy={notice} />)}
    </section>
  )
}
