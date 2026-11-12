import { useEffect, useRef, useState } from 'react'
import { saveTerminalHomeFreeBadge } from '../../services/api/homeFreeBadge'

export function TerminalHomeFreeBadgeSection({
  terminalId,
  enabled,
  onSaved,
}: {
  terminalId: string
  enabled: boolean
  onSaved: (enabled: boolean) => void
}) {
  const [on, setOn] = useState(enabled)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const terminalIdRef = useRef(terminalId)
  terminalIdRef.current = terminalId

  useEffect(() => {
    setOn(enabled)
  }, [terminalId, enabled])

  useEffect(() => {
    setError(null)
    setNotice(null)
  }, [terminalId])

  const onToggle = async () => {
    const requestTerminalId = terminalId
    const next = !on
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const saved = await saveTerminalHomeFreeBadge(requestTerminalId, next)
      // 先写回列表，再决定要不要改当前这台的开关。换了终端也不能把结果写到新的那台上。
      onSaved(saved.enabled)
      if (terminalIdRef.current !== requestTerminalId) return
      setOn(saved.enabled)
      setNotice('已保存，并记入审计。')
    } catch (reason) {
      if (terminalIdRef.current !== requestTerminalId) return
      setError((reason as Error).message)
    } finally {
      if (terminalIdRef.current === requestTerminalId) setSaving(false)
    }
  }

  return (
    <section className="rounded-lg border border-neutral-900/[0.08] px-4 py-3">
      <h3 className="text-[13px] font-bold text-neutral-800">首页显示『免费使用』</h3>
      <p className="mt-1 text-xs leading-relaxed text-neutral-500">
        开着时，一体机首页只在打印价目全是 0 元时显示『免费使用』；这台机器以后要收费，先关掉。
      </p>
      {error ? <p className="mt-2 text-sm text-error-fg" role="alert">{error}</p> : null}
      {notice ? <p className="mt-2 text-sm text-success-fg">{notice}</p> : null}
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label="首页显示『免费使用』"
        disabled={saving}
        onClick={() => void onToggle()}
        className="mt-2 min-h-12 rounded-lg border border-neutral-200 px-4 text-sm font-medium text-neutral-800 disabled:opacity-60"
      >
        {saving ? '保存中…' : on ? '开' : '关'}
      </button>
    </section>
  )
}
