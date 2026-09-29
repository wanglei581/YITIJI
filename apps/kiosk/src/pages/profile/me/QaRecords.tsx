import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { MemberQaRecordItem } from '@ai-job-print/shared'
import { deleteMyQaRecord } from '../../../services/api/memberAssets'
import { formatTime } from '../assets/format'

export function QaRecords({ items, token, onDeleted }: { items: MemberQaRecordItem[]; token: string | null; onDeleted: () => void }) {
  const navigate = useNavigate()
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!confirmId || busy) return
    const timer = setTimeout(() => setConfirmId(null), 15_000)
    return () => clearTimeout(timer)
  }, [confirmId, busy])
  const remove = async (id: string) => {
    if (!token || busy) return
    setBusy(true)
    setError(null)
    try { await deleteMyQaRecord(token, id); setConfirmId(null); onDeleted() }
    catch { setError('删除没有完成，请检查网络后重试。') }
    finally { setBusy(false) }
  }
  return <>
    {error ? <p role="alert">{error}</p> : null}
    {items.map((item) => {
      const expired = Date.parse(item.expiresAt) <= Date.now()
      return <div key={item.id} className="qx-me-row" data-record-kind="qa_pins">
        <span className="qx-me-row-main">
          <span className="qx-me-chip">小青作业</span>
          <span className="qx-me-row-title">{item.title}</span>
          <span className="qx-me-row-sub">{formatTime(item.createdAt)} · 保存至 {formatTime(item.expiresAt)}</span>
          {expired ? <span className="qx-me-reason">已超过保存期限，无法打开</span> : null}
          {confirmId === item.id ? <span className="qx-me-reason">删除这份作业摘要后不可恢复。已导出的文件仍在「我的文档」，可在那里单独删除。</span> : null}
        </span>
        <span className="qx-me-acts">
          <button type="button" className="qx-me-small" disabled={expired || busy} onClick={() => navigate(`/ai/plan?${new URLSearchParams({ sessionId: item.sessionId, artifactId: item.artifactId })}`)}>打开</button>
          {confirmId === item.id ? <>
            <button type="button" className="qx-me-small" disabled={busy} onClick={() => setConfirmId(null)}>取消</button>
            <button type="button" className="qx-me-small" disabled={busy} onClick={() => void remove(item.id)}>{busy ? '正在删除…' : '确认删除'}</button>
          </> : <button type="button" className="qx-me-small" disabled={busy} onClick={() => setConfirmId(item.id)}>删除</button>}
        </span>
      </div>
    })}
  </>
}
