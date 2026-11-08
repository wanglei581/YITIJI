import { useEffect, useState } from 'react'
import {
  loadGlobalQuota,
  saveGlobalQuota,
  type FreePrintQuotaConfig,
} from '../../services/api/freePrintQuota'

const FIELDS = [
  { key: 'terminalDailySides', label: '每台每天免费面数', hint: '1 到 10000 的整数' },
  { key: 'memberDailySides', label: '每个会员每天免费面数', hint: '1 到 10000 的整数' },
  { key: 'guestPerOrderSides', label: '免登录每单免费面数', hint: '1 到 10000 的整数' },
  { key: 'alertPercent', label: '告警阈值（百分比）', hint: '50 到 100 的整数' },
] as const

type FieldKey = (typeof FIELDS)[number]['key']

function toDraft(data: FreePrintQuotaConfig): Record<FieldKey, string> {
  return {
    terminalDailySides: String(data.terminalDailySides),
    memberDailySides: String(data.memberDailySides),
    guestPerOrderSides: String(data.guestPerOrderSides),
    alertPercent: String(data.alertPercent),
  }
}

export function FreePrintQuotaCard() {
  const [draft, setDraft] = useState<Record<FieldKey, string>>({
    terminalDailySides: '',
    memberDailySides: '',
    guestPerOrderSides: '',
    alertPercent: '',
  })
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadGlobalQuota()
      .then((data) => {
        if (cancelled) return
        setDraft(toDraft(data))
        setReady(true)
      })
      .catch((reason: Error) => {
        if (!cancelled) setError(reason.message)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const onSave = async () => {
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const saved = await saveGlobalQuota(draft)
      setDraft(toDraft(saved))
      setNotice('已保存，并记入审计。')
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-xl border border-neutral-900/10 bg-surface p-4">
      <h3 className="text-[14px] font-bold text-neutral-800">全站免费打印额度</h3>
      <p className="mt-1 text-[12.5px] leading-relaxed text-neutral-500">
        只限制实付为 0 的打印。保存后记入审计「修改免费打印额度」。
      </p>
      {loading ? <p className="mt-3 text-sm text-neutral-500">正在读取…</p> : null}
      {error ? <p className="mt-3 text-sm text-error-fg" role="alert">{error}</p> : null}
      {notice ? <p className="mt-3 text-sm text-success-fg">{notice}</p> : null}
      {ready ? (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {FIELDS.map((field) => (
            <label key={field.key} className="block text-sm text-neutral-800" htmlFor={`free-quota-${field.key}`}>
              {field.label}
              <input
                id={`free-quota-${field.key}`}
                value={draft[field.key]}
                inputMode="numeric"
                disabled={saving}
                onChange={(event) => setDraft((current) => ({ ...current, [field.key]: event.target.value }))}
                className="mt-1 min-h-12 w-full rounded-lg border border-neutral-200 px-3 text-sm"
              />
              <span className="mt-1 block text-[12px] text-neutral-500">{field.hint}</span>
            </label>
          ))}
          <div className="md:col-span-2">
            <button
              type="button"
              onClick={onSave}
              disabled={saving}
              className="min-h-12 rounded-lg bg-primary-700 px-4 text-sm font-medium text-white disabled:opacity-60"
            >
              {saving ? '保存中…' : '保存全站额度'}
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}
