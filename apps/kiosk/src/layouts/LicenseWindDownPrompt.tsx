import { useEffect, useState } from 'react'
import { QxTouchOverlay } from '../components/qingxu/touch/QxTouchOverlay'
import { licenseWindDownLine } from '../copy/unattendedCopy'
import { useKioskLicense } from './KioskLicenseContext'

const dismissed = new Set<string>()
const storageKey = 'kiosk-wind-down-dismissed'
try {
  const saved: unknown = JSON.parse(sessionStorage.getItem(storageKey) ?? '[]')
  if (Array.isArray(saved)) saved.forEach((value: unknown) => { if (typeof value === 'string') dismissed.add(value) })
} catch { /* 会话存储不可用时仍在当前页面生命周期内记住。 */ }

export function LicenseWindDownPrompt() {
  const { mode, endsAt } = useKioskLicense()
  const [now, setNow] = useState(() => Date.now())
  const [, refresh] = useState(0)
  useEffect(() => {
    setNow(Date.now())
    if (mode !== 'winding-down' || !endsAt) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [mode, endsAt])
  const remaining = endsAt ? Date.parse(endsAt) - now : NaN
  if (mode !== 'winding-down' || !endsAt || !Number.isFinite(remaining) || remaining <= 0 || remaining >= 300_000 || dismissed.has(endsAt)) return null
  const close = () => {
    dismissed.add(endsAt)
    try { sessionStorage.setItem(storageKey, JSON.stringify([...dismissed])) } catch { /* 内存兜底 */ }
    refresh((value) => value + 1)
  }
  return (
    <QxTouchOverlay kind="dialog" title="请尽快办完" onClose={close} actions={
      <button type="button" className="qxt-btn qxt-btn-pri qxt-fill" onClick={close}>知道了</button>
    }>
      <p className="qxp-note cg-lead">{licenseWindDownLine(Math.max(1, Math.ceil(remaining / 60_000)))}</p>
    </QxTouchOverlay>
  )
}
