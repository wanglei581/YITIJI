import { useRef, useState } from 'react'
import { saveTerminalHomeFreeBadge } from '../../services/api/homeFreeBadge'

export function TerminalHomeFreeBadgeSection({
  terminalId,
  enabled,
  listIssuedAt = 0,
  onSaved,
}: {
  terminalId: string
  enabled: boolean
  /** 这份终端列表是何时发出的。序号变了，开关改跟这一份（已按空值当关归一）。 */
  listIssuedAt?: number
  onSaved: (terminalId: string, enabled: boolean) => void
}) {
  const [on, setOn] = useState(enabled)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [seenTerminalId, setSeenTerminalId] = useState(terminalId)
  const [seenListIssuedAt, setSeenListIssuedAt] = useState(listIssuedAt)
  const requestSeq = useRef(0)
  const terminalIdRef = useRef(terminalId)
  terminalIdRef.current = terminalId

  // 换终端时整组回到这台的初始状态，并作废还在飞的请求号。
  // 只比终端号认不出「回到刚才那台」：旧请求的成功不能改现在屏幕上的开关。
  if (seenTerminalId !== terminalId) {
    setSeenTerminalId(terminalId)
    setSaving(false)
    setError(null)
    setNotice(null)
    setOn(enabled)
    requestSeq.current += 1
  }

  // 列表请求序号变了，说明父级已经换上新的一份。开关跟这份，不跟更早的补丁。
  if (seenListIssuedAt !== listIssuedAt) {
    setSeenListIssuedAt(listIssuedAt)
    setOn(enabled)
    if (enabled !== on) {
      setNotice(null)
      setError(null)
    }
  }

  const onToggle = async () => {
    const requestTerminalId = terminalId
    const requestId = ++requestSeq.current
    const next = !on
    setSaving(true)
    setError(null)
    setNotice(null)
    try {
      const saved = await saveTerminalHomeFreeBadge(requestTerminalId, next)
      // 先写回那台自己的列表补丁。当前屏幕只接受「还是这台，且仍是最新一次」的结果。
      onSaved(requestTerminalId, saved.enabled)
      if (terminalIdRef.current !== requestTerminalId || requestId !== requestSeq.current) return
      setOn(saved.enabled)
      setNotice('已保存，并记入审计。')
    } catch (reason) {
      if (terminalIdRef.current !== requestTerminalId || requestId !== requestSeq.current) return
      setError(reason instanceof Error ? reason.message : '首页「免费使用」开关保存失败')
    } finally {
      if (terminalIdRef.current === requestTerminalId && requestId === requestSeq.current) setSaving(false)
    }
  }

  return (
    <section className="rounded-lg border border-neutral-900/[0.08] px-4 py-3">
      <h3 className="text-[13px] font-bold text-neutral-800">首页显示『免费使用』</h3>
      <p className="mt-1 text-xs leading-relaxed text-neutral-500">
        开着时，一体机首页只在五个生效价全是 0 元时显示『免费使用』；这台机器以后要收费，先关掉。
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
