import { useEffect, useState } from 'react'
import { loadGlobalQuota, loadTerminalDailySides, saveTerminalDailySides } from '../../services/api/freePrintQuota'

export function TerminalDailyFreeSidesSection({ terminalId }: { terminalId: string }) {
  const [raw, setRaw] = useState('')
  const [globalDefault, setGlobalDefault] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [ready, setReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setReady(false)
    setError(null)
    setNotice(null)
    setGlobalDefault(null)
    loadTerminalDailySides(terminalId)
      .then(async (data) => {
        if (cancelled) return
        setRaw(data.dailyFreePrintSides === null ? '' : String(data.dailyFreePrintSides))
        setReady(true)
        try {
          const global = await loadGlobalQuota()
          if (!cancelled) setGlobalDefault(global.terminalDailySides)
        } catch {
          if (!cancelled) setGlobalDefault(null)
        }
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
  }, [terminalId])

  const onSave = async () => {
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const saved = await saveTerminalDailySides(terminalId, raw)
      setRaw(saved.dailyFreePrintSides === null ? '' : String(saved.dailyFreePrintSides))
      setNotice('已保存，并记入审计。')
    } catch (reason) {
      setError((reason as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="rounded-lg border border-neutral-900/[0.08] px-4 py-3">
      <h3 className="text-[13px] font-bold text-neutral-800">本机每天免费面数</h3>
      <p className="mt-1 text-xs leading-relaxed text-neutral-500">
        只限制实付为 0 的打印。留空则用全站默认。保存后记入审计「修改终端每日免费打印上限」。
        {globalDefault === null ? '' : ` 当前全站默认是 ${globalDefault} 面。`}
      </p>
      {loading ? <p className="mt-2 text-sm text-neutral-500">正在读取…</p> : null}
      {error ? <p className="mt-2 text-sm text-error-fg" role="alert">{error}</p> : null}
      {notice ? <p className="mt-2 text-sm text-success-fg">{notice}</p> : null}
      {ready ? (
        <div className="mt-2 space-y-2">
          <label className="block text-sm text-neutral-800" htmlFor={`terminal-daily-free-${terminalId}`}>
            本机每天
            <input
              id={`terminal-daily-free-${terminalId}`}
              value={raw}
              inputMode="numeric"
              disabled={saving}
              placeholder="留空则用全站默认"
              onChange={(event) => setRaw(event.target.value)}
              className="mt-1 min-h-12 w-full rounded-lg border border-neutral-200 px-3 text-sm"
            />
          </label>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="min-h-12 rounded-lg bg-primary-700 px-4 text-sm font-medium text-white disabled:opacity-60"
          >
            {saving ? '保存中…' : '保存本机额度'}
          </button>
        </div>
      ) : null}
    </section>
  )
}
