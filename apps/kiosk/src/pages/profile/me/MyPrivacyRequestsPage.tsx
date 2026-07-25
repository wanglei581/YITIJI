// ============================================================
// 岗位 AI 隐私请求 — /me/privacy-requests
//
// 与 main 后端对齐：仅开放撤回授权；导出需 step-up；账号注销暂未开放。
// ============================================================

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button, EmptyState, ErrorState, LoadingState, PageHeader } from '@ai-job-print/ui'
import {
  MEMBER_DATA_REQUEST_SCOPE,
  MEMBER_DATA_REQUEST_STATUS_LABEL,
  MEMBER_DATA_REQUEST_TYPE_HINT,
  MEMBER_DATA_REQUEST_TYPE_LABEL,
  type MemberDataRequestItem,
} from '@ai-job-print/shared'
import { FileDownIcon, ShieldOffIcon, Trash2Icon } from 'lucide-react'
import { useAuth } from '../../../auth/useAuth'
import { useInkRipple } from '../../../hooks/useInkRipple'
import { createMyDataRequest, listMyDataRequests } from '../../../services/api/memberPrivacy'
import './me-detail-inkpaper.css'

function fmt(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ')
}

export function MyPrivacyRequestsPage() {
  const navigate = useNavigate()
  const { isLoggedIn, getToken } = useAuth()
  const [items, setItems] = useState<MemberDataRequestItem[]>([])
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [message, setMessage] = useState<string | null>(null)
  const [confirmRevoke, setConfirmRevoke] = useState(false)
  const [busy, setBusy] = useState(false)
  useInkRipple('.me-inkdetail .me-ripple')

  const load = async () => {
    const token = getToken()
    if (!token) {
      setState('ready')
      setItems([])
      return
    }
    setState('loading')
    setMessage(null)
    try {
      setItems(await listMyDataRequests(token))
      setState('ready')
    } catch (error) {
      setState('error')
      setMessage(error instanceof Error ? error.message : '加载失败')
    }
  }

  useEffect(() => {
    if (!isLoggedIn) {
      setState('ready')
      setItems([])
      return
    }
    void load()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 登录态变化时拉列表
  }, [isLoggedIn, getToken])

  const submitRevoke = async () => {
    const token = getToken()
    if (!token) return
    setBusy(true)
    try {
      const created = await createMyDataRequest(token, 'revoke_consent')
      setItems((prev) => [created, ...prev])
      setConfirmRevoke(false)
      setMessage('已撤回岗位 AI 授权，请求已记录')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '提交失败，请稍后重试')
    } finally {
      setBusy(false)
    }
  }

  if (!isLoggedIn) {
    return (
      <div className="me-inkdetail flex h-full flex-col p-6">
        <PageHeader
          className="me-page-header"
          title="岗位 AI 隐私请求"
          subtitle="仅限岗位 AI 咨询会话与授权"
          actions={
            <Button size="sm" variant="secondary" className="me-ripple" onClick={() => navigate('/me/settings')}>
              返回设置
            </Button>
          }
        />
        <EmptyState
          className="mt-10"
          title="请先登录"
          description="登录后可提交或查看本人的岗位 AI 会话与授权相关请求。"
          action={
            <Button size="lg" onClick={() => navigate('/login', { state: { from: '/me/privacy-requests' } })}>
              手机号登录
            </Button>
          }
        />
      </div>
    )
  }

  return (
    <div className="me-inkdetail flex h-full flex-col">
      {message && (
        <div role="status" className="me-toast fixed left-1/2 top-4 z-50 -translate-x-1/2 px-5 py-2.5">
          {message}
        </div>
      )}

      <PageHeader
        className="me-page-header"
        title="岗位 AI 隐私请求"
        subtitle="仅限岗位 AI 咨询会话与授权"
        actions={
          <Button size="sm" variant="secondary" className="me-ripple me-back-button" onClick={() => navigate('/me/settings')}>
            返回设置
          </Button>
        }
      />

      <div className="me-detail-scroll mt-4 flex-1 overflow-y-auto pb-8">
        <div className="me-note mx-0 mb-4 px-5 py-4 text-xs leading-relaxed text-neutral-600">
          {MEMBER_DATA_REQUEST_SCOPE}
        </div>

        <section aria-label="可操作与说明" className="me-card mb-4 space-y-3 px-5 py-4">
          <button
            type="button"
            className="me-link-row me-ripple w-full text-left"
            onClick={() => setConfirmRevoke(true)}
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50">
              <ShieldOffIcon className="h-5 w-5 text-primary-600" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-neutral-800">
                {MEMBER_DATA_REQUEST_TYPE_LABEL.revoke_consent}
              </span>
              <span className="mt-0.5 block text-xs text-neutral-400">
                {MEMBER_DATA_REQUEST_TYPE_HINT.revoke_consent}
              </span>
            </span>
          </button>

          <div className="me-link-row opacity-70">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-neutral-100">
              <FileDownIcon className="h-5 w-5 text-neutral-500" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-neutral-700">
                {MEMBER_DATA_REQUEST_TYPE_LABEL.export}
              </span>
              <span className="mt-0.5 block text-xs text-neutral-400">
                {MEMBER_DATA_REQUEST_TYPE_HINT.export}
              </span>
            </span>
          </div>

          <div className="me-link-row opacity-70">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-neutral-100">
              <Trash2Icon className="h-5 w-5 text-neutral-500" aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-neutral-700">
                {MEMBER_DATA_REQUEST_TYPE_LABEL.delete}
              </span>
              <span className="mt-0.5 block text-xs text-neutral-400">
                {MEMBER_DATA_REQUEST_TYPE_HINT.delete}
              </span>
            </span>
          </div>
        </section>

        <section aria-label="我的请求记录">
          <p className="mb-2 px-1 text-sm font-semibold text-neutral-900">我的请求记录</p>
          {state === 'loading' && <LoadingState text="加载请求记录…" className="py-16" />}
          {state === 'error' && (
            <ErrorState title="加载失败" message={message ?? '请稍后重试'} onRetry={() => void load()} className="py-16" />
          )}
          {state === 'ready' && items.length === 0 && (
            <EmptyState title="暂无请求记录" description="提交撤回授权后，记录会出现在这里。" className="py-16" />
          )}
          {state === 'ready' && items.length > 0 && (
            <ul className="space-y-2">
              {items.map((item) => (
                <li key={item.id} className="me-card px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-neutral-800">
                        {MEMBER_DATA_REQUEST_TYPE_LABEL[item.requestType]}
                      </p>
                      <p className="mt-1 text-xs text-neutral-400">{fmt(item.requestedAt)}</p>
                    </div>
                    <span className="text-xs text-neutral-500">
                      {MEMBER_DATA_REQUEST_STATUS_LABEL[item.status]}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {confirmRevoke && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setConfirmRevoke(false)}>
          <div
            role="dialog"
            aria-modal="true"
            className="me-dialog w-[22rem] max-w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-base font-semibold text-neutral-900">确认撤回岗位 AI 授权</p>
            <p className="mt-2 text-sm leading-relaxed text-neutral-500">
              {MEMBER_DATA_REQUEST_TYPE_HINT.revoke_consent}
            </p>
            <div className="mt-5 flex gap-3">
              <Button variant="secondary" className="flex-1" disabled={busy} onClick={() => setConfirmRevoke(false)}>
                取消
              </Button>
              <Button className="flex-1" disabled={busy} onClick={() => void submitRevoke()}>
                {busy ? '提交中…' : '确认撤回'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
