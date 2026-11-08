import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getPublishedPolicies, getPublishedPolicy, type PolicyPostView } from '../../services/api/policies'
import { recordBrowse, recordExternalJump } from '../../services/api/activity'
import { useAuth } from '../../auth/useAuth'
import { NoticePanel } from './NoticePanel'
import { OfficialEntryQrOverlay, type SourceQrTarget } from './components'
import { PolicyReadState, PolicyTouchLayout } from './PolicyTouchLayout'
import { policyRead, policySourceLink } from './policyModel'
import './renshi-policy-fusion.css'
import './renshi-touch.css'

export function PolicyNotices() {
  const navigate = useNavigate()
  const { getToken } = useAuth()
  const [notices, setNotices] = useState<PolicyPostView[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [qr, setQr] = useState<SourceQrTarget | null>(null)
  const [message, setMessage] = useState('')
  const [withdrawn, setWithdrawn] = useState(false)
  const activeId = useRef<string | null>(null)
  const mounted = useRef(false)
  const setActiveId = useCallback((id: string | null) => { activeId.current = id }, [])
  useEffect(() => {
    let active = true
    mounted.current = true
    setNotices(null)
    setFailed(false)
    setWithdrawn(false)
    setQr(null)
    policyRead(getPublishedPolicies({ kind: 'notice', page, pageSize: 4 }))
      .then((result) => { if (active) { setNotices(result.items); setTotalPages(Math.max(1, result.totalPages)) } })
      .catch(() => { if (active) setFailed(true) })
    return () => { active = false; mounted.current = false }
  }, [attempt, page])
  const confirm = useCallback(async (id: string) => {
    const result = await policyRead(getPublishedPolicy(id)).catch(() => ({ status: 'failed' as const }))
    if (!mounted.current) return null
    if (result.status === 'missing') {
      setNotices((items) => items?.filter((item) => item.id !== id) ?? null)
      setQr(null)
      setWithdrawn(true)
      setMessage('这条政策已下架')
      return null
    }
    if (result.status === 'failed') { setMessage('这次没读到，请重新读取后再试'); return null }
    return result.policy
  }, [])
  useEffect(() => {
    const timer = window.setInterval(() => { if (activeId.current) void confirm(activeId.current) }, 30_000)
    return () => window.clearInterval(timer)
  }, [confirm])

  return <PolicyTouchLayout eyebrow="查政策 · 机构公告" title="机构公告" state={failed ? 'failed' : notices ? 'notice' : 'loading'}
    sub="公告由发布机构自己审核并发布，正文与来源链接原样呈现。">
    {qr && <OfficialEntryQrOverlay target={qr} onClose={() => setQr(null)} />}
    {message && <p role="status">{message}</p>}
    {!notices ? <PolicyReadState failed={failed} retry={() => setAttempt((value) => value + 1)} /> : <>
      <NoticePanel notices={notices} suppressAutoOpen={withdrawn} onActiveId={setActiveId}
        onOpened={(notice) => recordBrowse(getToken(), 'policy', notice.id)}
        onTab={() => navigate('/policy-service')}
        onUpload={(id) => { void confirm(id).then((policy) => { if (policy) navigate('/print/upload') }) }}
        onOfficialEntry={(notice, target) => { void confirm(notice.id).then((policy) => {
          if (!policy) return
          const source = policySourceLink(policy)
          if (source.kind !== 'verified') { setMessage(source.message); return }
          recordExternalJump(getToken(), 'policy', policy.id, 'external_open')
          setQr({ ...target, title: policy.title, url: source.url, sourceDetail: policy.sourceName })
        }) }} />
      <div className="policy-min-pagination">
        {page > 1 && <button type="button" className="policy-min-button" onClick={() => setPage((value) => value - 1)}>上一页</button>}
        <span>第 {page} / {totalPages} 页</span>
        {page < totalPages && <button type="button" className="policy-min-button" onClick={() => setPage((value) => value + 1)}>再看 4 条</button>}
      </div>
    </>}
  </PolicyTouchLayout>
}
