import { useEffect, useState } from 'react'
import { loadQueueTimeoutMinutes, saveQueueTimeoutMinutes } from '../../services/api/printQueueTimeout'

export function PrintQueueTimeoutCard() {
  const [minutes, setMinutes] = useState('')
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    loadQueueTimeoutMinutes()
      .then((value) => {
        if (cancelled) return
        setMinutes(String(value))
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
      const saved = await saveQueueTimeoutMinutes(minutes)
      setMinutes(String(saved))
      setNotice('已保存，并记入审计。')
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-xl border border-neutral-900/10 bg-surface p-4">
      <h3 className="text-[14px] font-bold text-neutral-800">打印排队等待上限</h3>
      <p className="mt-1 text-[12.5px] leading-relaxed text-neutral-500">
        已付款或免费的打印单，从可以在这台机器上领取起，超过这个时间还没被领走，就判为失败，没有出纸。范围 5 到 120 分钟，缺省 15 分钟。
      </p>
      {loading ? <p className="mt-3 text-sm text-neutral-500">正在读取…</p> : null}
      {error ? <p className="mt-3 text-sm text-error-fg" role="alert">{error}</p> : null}
      {notice ? <p className="mt-3 text-sm text-success-fg">{notice}</p> : null}
      {ready ? (
        <label className="mt-3 block max-w-xs text-sm text-neutral-800" htmlFor="print-queue-timeout-minutes">
          等待上限（分钟）
          <input
            id="print-queue-timeout-minutes"
            value={minutes}
            inputMode="numeric"
            disabled={saving}
            onChange={(event) => setMinutes(event.target.value)}
            className="mt-1 min-h-12 w-full rounded-lg border border-neutral-200 px-3 text-sm"
          />
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="mt-3 min-h-12 rounded-lg bg-primary-700 px-4 text-sm font-medium text-white disabled:opacity-60"
          >
            {saving ? '保存中…' : '保存排队等待上限'}
          </button>
        </label>
      ) : null}
    </section>
  )
}
