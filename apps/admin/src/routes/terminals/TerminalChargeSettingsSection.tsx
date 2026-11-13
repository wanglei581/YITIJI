import { useEffect, useRef, useState } from 'react'
import {
  TERMINAL_CHARGE_MAX_UNIT_CENTS,
  TERMINAL_CHARGE_SERVICE_KEYS,
  TERMINAL_CHARGE_SERVICE_LABELS,
  TERMINAL_USER_CHARGE_MODE_LABELS,
  type EffectivePriceReason,
  type TerminalChargeServiceKey,
  type TerminalUserChargeMode,
} from '@ai-job-print/shared'
import {
  loadTerminalChargeSettings,
  saveTerminalChargeSettings,
  type TerminalChargeSettingsView,
} from '../../services/api/terminalCharge'

const REASON_TEXT: Record<EffectivePriceReason, string> = {
  public_site: '公共就业点位，永远免费',
  personal_charge_off: '总开关关着',
  org_pays: '机构或我方承担',
  user_pays: '按上面的价收',
  no_terminal: '没有这台终端',
}

const ORG_PAYS_WARNING = '这台机器绑定了机构。机构买的机器由机构承担；只有我方自己投放的机器才向用户收费，不用我方收款账户替机构收钱。'

function yuanText(cents: number): string {
  return (cents / 100).toFixed(2)
}

function parseYuan(raw: string): number | null {
  const text = raw.trim()
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null
  const cents = Math.round(Number(text) * 100)
  if (!Number.isInteger(cents) || cents < 0 || cents > TERMINAL_CHARGE_MAX_UNIT_CENTS) return null
  return cents
}

function yuanFields(view: TerminalChargeSettingsView): Record<TerminalChargeServiceKey, string> {
  const fields = {} as Record<TerminalChargeServiceKey, string>
  for (const key of TERMINAL_CHARGE_SERVICE_KEYS) fields[key] = yuanText(view.prices[key].configuredCents)
  return fields
}

function effectiveLine(view: TerminalChargeSettingsView): string {
  const parts = TERMINAL_CHARGE_SERVICE_KEYS.map((key) => {
    const row = view.prices[key]
    return `${TERMINAL_CHARGE_SERVICE_LABELS[key]} ¥${yuanText(row.effectiveCents)}（${REASON_TEXT[row.reason]}）`
  })
  return `现在实际向用户收：${parts.join('；')}`
}

export function TerminalChargeSettingsSection({
  terminalId,
  onSaved,
}: {
  terminalId: string
  onSaved: (terminalId: string, view: TerminalChargeSettingsView) => void
}) {
  const [view, setView] = useState<TerminalChargeSettingsView | null>(null)
  const [mode, setMode] = useState<TerminalUserChargeMode>('org_pays')
  const [yuan, setYuan] = useState<Record<TerminalChargeServiceKey, string> | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const requestSeq = useRef(0)
  const terminalIdRef = useRef(terminalId)
  terminalIdRef.current = terminalId

  useEffect(() => {
    const requestTerminalId = terminalId
    const requestId = ++requestSeq.current
    setLoading(true)
    setError(null)
    setNotice(null)
    setView(null)
    setYuan(null)
    loadTerminalChargeSettings(requestTerminalId)
      .then((loaded) => {
        if (terminalIdRef.current !== requestTerminalId || requestId !== requestSeq.current) return
        setView(loaded)
        setMode(loaded.userChargeMode)
        setYuan(yuanFields(loaded))
      })
      .catch((reason: Error) => {
        if (terminalIdRef.current !== requestTerminalId || requestId !== requestSeq.current) return
        setError(reason.message)
      })
      .finally(() => {
        if (terminalIdRef.current === requestTerminalId && requestId === requestSeq.current) setLoading(false)
      })
  }, [terminalId])

  const onSave = async () => {
    if (!view || !yuan || view.isPublicSite) return
    const requestTerminalId = terminalId
    const requestId = ++requestSeq.current
    const prices = {} as Record<TerminalChargeServiceKey, number>
    for (const key of TERMINAL_CHARGE_SERVICE_KEYS) {
      const cents = parseYuan(yuan[key])
      if (cents === null) {
        setError('价格按元填写，最多两位小数，换算后须在 0 到 1000 元之间')
        setMode(view.userChargeMode)
        setYuan(yuanFields(view))
        return
      }
      prices[key] = cents
    }
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const saved = await saveTerminalChargeSettings(requestTerminalId, { userChargeMode: mode, prices })
      onSaved(requestTerminalId, saved)
      if (terminalIdRef.current !== requestTerminalId || requestId !== requestSeq.current) return
      setView(saved)
      setMode(saved.userChargeMode)
      setYuan(yuanFields(saved))
      setNotice('已保存，并记入审计。')
    } catch (reason) {
      if (terminalIdRef.current !== requestTerminalId || requestId !== requestSeq.current) return
      setMode(view.userChargeMode)
      setYuan(yuanFields(view))
      setError(reason instanceof Error ? reason.message : '收费设置保存失败')
    } finally {
      if (terminalIdRef.current === requestTerminalId && requestId === requestSeq.current) setSaving(false)
    }
  }

  const locked = view?.isPublicSite === true
  const showOrgWarning = view?.orgBound === true && mode === 'user_pays' && !locked

  return (
    <section className="rounded-lg border border-neutral-900/[0.08] px-4 py-3">
      <h3 className="text-[13px] font-bold text-neutral-800">收费设置</h3>
      <p className="mt-2 text-sm text-neutral-700">改绑机构，收费设置已复位</p>
      {loading ? <p className="mt-2 text-sm text-neutral-500">正在读取…</p> : null}
      {error ? <p className="mt-2 text-sm text-error-fg" role="alert">{error}</p> : null}
      {notice ? <p className="mt-2 text-sm text-success-fg">{notice}</p> : null}
      {view && yuan ? (
        <div className="mt-2 space-y-3">
          {locked ? <p className="text-sm text-neutral-700">公共就业点位永远不向求职者收费</p> : null}
          {showOrgWarning ? <p className="text-sm text-warning-fg">{ORG_PAYS_WARNING}</p> : null}
          <fieldset className="space-y-2" disabled={locked || saving}>
            <legend className="text-sm text-neutral-800">谁付钱</legend>
            {(['org_pays', 'user_pays'] as const).map((item) => (
              <label key={item} className="flex min-h-12 items-center gap-2 text-sm text-neutral-800">
                <input
                  type="radio"
                  name={`charge-mode-${terminalId}`}
                  checked={mode === item}
                  disabled={locked || saving}
                  onChange={() => setMode(item)}
                />
                {TERMINAL_USER_CHARGE_MODE_LABELS[item]}
              </label>
            ))}
          </fieldset>
          <div className="space-y-2">
            {TERMINAL_CHARGE_SERVICE_KEYS.map((key) => (
              <label key={key} className="block text-sm text-neutral-800">
                {TERMINAL_CHARGE_SERVICE_LABELS[key]}
                <input
                  value={yuan[key]}
                  inputMode="decimal"
                  disabled={locked || saving}
                  onChange={(event) => setYuan((current) => current ? { ...current, [key]: event.target.value } : current)}
                  className="mt-1 min-h-12 w-full rounded-lg border border-neutral-200 px-3 text-sm disabled:bg-neutral-50"
                />
              </label>
            ))}
          </div>
          <p className="text-xs leading-relaxed text-neutral-600">{effectiveLine(view)}</p>
          {locked ? null : (
            <button
              type="button"
              disabled={saving}
              onClick={() => void onSave()}
              className="min-h-12 rounded-lg bg-primary-600 px-4 text-sm font-medium text-white disabled:opacity-60"
            >
              {saving ? '保存中…' : '保存收费设置'}
            </button>
          )}
        </div>
      ) : null}
    </section>
  )
}
