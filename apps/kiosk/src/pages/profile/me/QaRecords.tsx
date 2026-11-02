import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { MemberQaRecordItem } from '@ai-job-print/shared'
import { deleteMyQaRecord } from '../../../services/api/memberAssets'
import { formatTime } from '../assets/format'
import { MeActs, MeBtn, MeP, MeRow } from '../touch/MeKit'

/** 小青作业：只能打开或删除。删除两步，确认 15 秒内不点就退回。 */
export function QaRecords({
  items,
  token,
  onDeleted,
  openKey,
  onToggle,
}: {
  items: MemberQaRecordItem[]
  token: string | null
  onDeleted: () => void
  openKey: string | null
  onToggle: (key: string) => void
}) {
  const navigate = useNavigate()
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!confirmId || busy) return
    const timer = setTimeout(() => setConfirmId(null), 15_000)
    return () => clearTimeout(timer)
  }, [confirmId, busy])
  useEffect(() => {
    if (confirmId && openKey !== `qa-${confirmId}`) setConfirmId(null)
  }, [openKey, confirmId])
  const remove = async (id: string) => {
    if (!token || busy) return
    setBusy(true)
    setError(null)
    try { await deleteMyQaRecord(token, id); setConfirmId(null); onDeleted() }
    catch { setError('删除没有完成，请检查网络后重试。') }
    finally { setBusy(false) }
  }
  return <>
    {error ? <p role="alert" className="me-reason">{error}</p> : null}
    {items.map((item) => {
      const expired = Date.parse(item.expiresAt) <= Date.now()
      const key = `qa-${item.id}`
      return (
        <MeRow
          key={item.id}
          data-record-kind="qa_pins"
          open={openKey === key}
          onToggle={() => onToggle(key)}
          title="小青作业"
          lines={[item.title, `${formatTime(item.createdAt)} · 保存至 ${formatTime(item.expiresAt)}`]}
          foot={expired ? <p className="me-reason">已超过保存期限，无法打开</p> : undefined}
          actions={(
            <MeActs>
              <MeBtn v="pri" disabled={expired || busy} onClick={() => navigate(`/ai/plan?${new URLSearchParams({ sessionId: item.sessionId, artifactId: item.artifactId })}`)}>打开</MeBtn>
              {confirmId === item.id ? <>
                <MeBtn v="danger" disabled={busy} onClick={() => void remove(item.id)}>{busy ? '正在删除…' : '确认删除'}</MeBtn>
                <MeBtn v="sec" disabled={busy} onClick={() => setConfirmId(null)}>取消</MeBtn>
              </> : <MeBtn v="sec" disabled={busy} onClick={() => setConfirmId(item.id)}>删除</MeBtn>}
            </MeActs>
          )}
          extra={confirmId === item.id ? <MeP tone="reason">删除这份作业摘要后不可恢复。已导出的文件仍在「我的文档」，可在那里单独删除。</MeP> : undefined}
        />
      )
    })}
  </>
}
