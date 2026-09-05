import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { formatDateTime, type MemberDeletedDocumentItem } from '@ai-job-print/shared'
import { useAuth } from '../../../auth/useAuth'
import { getMyDeletedDocuments, MemberAssetsApiError } from '../../../services/api/memberAssets'

const ACTOR_LABEL: Record<MemberDeletedDocumentItem['deletedByKind'], string> = {
  system: '系统到期清理',
  self: '本人删除',
  admin: '管理员删除',
  unknown: '删除操作人未标明',
}

const STORAGE_LABEL: Record<MemberDeletedDocumentItem['storageObjectState'], string> = {
  removed: '云端对象已删除',
  pending: '删除已登记，云端对象仍待清理',
  unknown: '云端对象状态未知（历史记录未记账）',
}

export function PrintFileDeletionRecords() {
  const navigate = useNavigate()
  const { isLoggedIn, getToken } = useAuth()
  const [open, setOpen] = useState(false)
  const [state, setState] = useState<'idle' | 'loading' | 'error' | 'ready'>('idle')
  const [items, setItems] = useState<MemberDeletedDocumentItem[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !isLoggedIn) return
    const token = getToken()
    if (!token) return
    let cancelled = false
    setState('loading')
    setError(null)
    void getMyDeletedDocuments(token, { pageSize: 20 })
      .then((page) => {
        if (cancelled) return
        setItems(page.items)
        setState('ready')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setItems([])
        setState('error')
        setError(
          err instanceof MemberAssetsApiError
            ? err.message
            : '暂时无法读取删除记录，请稍后重试',
        )
      })
    return () => {
      cancelled = true
    }
  }, [open, isLoggedIn, getToken])

  return (
    <div className="print-done-card" data-print-file-deletions="true">
      <b className="print-done-card-hd">本人文件删除记录</b>
      {!isLoggedIn ? (
        <p className="print-done-card-sub">
          游客打印的文件不绑定账号，无法事后查阅删除记录。登录会员可在本页查看本人文件的删除记录。
        </p>
      ) : (
        <p className="print-done-card-sub">
          这里只显示已经删除的本人文件元数据，不含文件内容。删除记录来自服务端 tombstone，不是前台编造。
        </p>
      )}
      <div className="print-done-fb-group">
        {isLoggedIn ? (
          <button
            type="button"
            className="print-done-fb-btn"
            onClick={() => setOpen((value) => !value)}
          >
            {open ? '收起删除记录' : '查看删除记录'}
          </button>
        ) : (
          <button
            type="button"
            className="print-done-fb-btn"
            onClick={() => navigate('/login', { state: { from: '/print/done' } })}
          >
            登录后查看
          </button>
        )}
      </div>
      {open && isLoggedIn ? (
        <div className="print-file-deletion-list" role="status">
          {state === 'loading' ? <p className="print-done-card-sub">正在读取本人删除记录</p> : null}
          {state === 'error' ? <p className="print-done-card-sub">{error}</p> : null}
          {state === 'ready' && items.length === 0 ? (
            <p className="print-done-card-sub">暂无删除记录。文件到期清理或本人删除后才会出现在这里。</p>
          ) : null}
          {state === 'ready'
            ? items.map((item) => (
              <div key={item.id} className="print-file-deletion-item">
                <b>{item.filename}</b>
                <span>{formatDateTime(item.deletedAt, { style: 'zh-datetime', fallback: '删除时间未能解析' })}</span>
                <span>{ACTOR_LABEL[item.deletedByKind]}</span>
                <span>{STORAGE_LABEL[item.storageObjectState]}</span>
                {item.deleteReason ? <span>原因：{item.deleteReason}</span> : null}
              </div>
            ))
            : null}
        </div>
      ) : null}
    </div>
  )
}
