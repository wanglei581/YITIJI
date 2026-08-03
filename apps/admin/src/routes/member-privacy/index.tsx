import { useCallback, useEffect, useState } from 'react'
import { Button, Card, EmptyState, ErrorState, LoadingState } from '@ai-job-print/ui'
import {
  ADMIN_DATA_REQUEST_EXPORT_COMPLETE_HINT,
  ADMIN_DATA_REQUEST_REJECT_HINT,
  MEMBER_DATA_REQUEST_SCOPE,
  MEMBER_DATA_REQUEST_STATUS_LABEL,
  MEMBER_DATA_REQUEST_TYPE_LABEL,
  type AdminMemberDataRequestItem,
  type MemberDataRequestStatus,
} from '@ai-job-print/shared'
import { RefreshCwIcon } from 'lucide-react'
import { Page } from '../Page'
import { memberPrivacyAdminApi } from '../../services/api/memberPrivacyAdmin'

const STATUSES: { value: MemberDataRequestStatus | 'all'; label: string }[] = [
  { value: 'all', label: '全部状态' },
  { value: 'pending', label: '待处理' },
  { value: 'handling', label: '处理中' },
  { value: 'ready', label: '可下载' },
  { value: 'completed', label: '已完成' },
  { value: 'expired', label: '已过期' },
  { value: 'failed', label: '处理失败' },
  { value: 'rejected', label: '已驳回' },
  { value: 'cancelled', label: '已取消' },
]

const STATUS_CLASS: Record<MemberDataRequestStatus, string> = {
  pending: 'bg-warning-bg text-warning-fg',
  handling: 'bg-info-bg text-info-fg',
  ready: 'bg-success-bg text-success-fg',
  completed: 'bg-success-bg text-success-fg',
  expired: 'bg-neutral-100 text-neutral-500',
  failed: 'bg-error-bg text-error-fg',
  rejected: 'bg-neutral-100 text-neutral-500',
  cancelled: 'bg-neutral-100 text-neutral-500',
}

function fmt(iso: string): string {
  return iso.slice(0, 16).replace('T', ' ')
}

function shortId(id: string): string {
  return id.length > 12 ? `${id.slice(0, 8)}…` : id
}

export default function MemberPrivacyPage() {
  const [status, setStatus] = useState<MemberDataRequestStatus | 'all'>('pending')
  const [items, setItems] = useState<AdminMemberDataRequestItem[]>([])
  const [listState, setListState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [message, setMessage] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [rejectDraft, setRejectDraft] = useState<{ id: string; reason: string } | null>(null)

  const loadList = useCallback(async () => {
    setListState('loading')
    setMessage(null)
    try {
      setItems(await memberPrivacyAdminApi.list(status))
      setListState('ready')
    } catch (error) {
      setListState('error')
      setMessage(error instanceof Error ? error.message : '列表加载失败')
    }
  }, [status])

  useEffect(() => {
    void loadList()
  }, [loadList])

  const runRetry = async (id: string) => {
    setBusyId(id)
    setMessage(null)
    try {
      const updated = await memberPrivacyAdminApi.retry(id)
      setItems((prev) => prev.map((row) => (row.id === updated.id ? updated : row)))
      setMessage('已重新排队导出任务')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '重试失败')
    } finally {
      setBusyId(null)
    }
  }

  const runReject = async () => {
    if (!rejectDraft || !rejectDraft.reason.trim()) return
    setBusyId(rejectDraft.id)
    setMessage(null)
    try {
      const updated = await memberPrivacyAdminApi.reject(rejectDraft.id, rejectDraft.reason.trim())
      setItems((prev) => prev.map((row) => (row.id === updated.id ? updated : row)))
      setRejectDraft(null)
      setMessage(`已驳回「${MEMBER_DATA_REQUEST_TYPE_LABEL[updated.requestType]}」`)
      if (status !== 'all' && updated.status !== status) {
        setItems((prev) => prev.filter((row) => row.id !== updated.id))
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '驳回失败')
    } finally {
      setBusyId(null)
    }
  }

  return (
    <Page
      title="会员隐私请求"
      subtitle="撤回授权可即时完成；导出为后台元数据包；账号注销未开放"
      actions={
        <Button size="sm" variant="secondary" onClick={() => void loadList()} disabled={listState === 'loading'}>
          <RefreshCwIcon className="mr-1.5 h-4 w-4" aria-hidden="true" />
          刷新
        </Button>
      }
    >
      <p className="mb-4 rounded-lg border border-info/20 bg-info-bg px-4 py-3 text-sm text-info-fg">
        {MEMBER_DATA_REQUEST_SCOPE}
      </p>
      <p className="mb-4 text-xs text-neutral-500">{ADMIN_DATA_REQUEST_EXPORT_COMPLETE_HINT}</p>

      <div className="mb-4 flex flex-wrap gap-2">
        {STATUSES.map((item) => (
          <button
            key={item.value}
            type="button"
            onClick={() => setStatus(item.value)}
            className={`rounded-full px-3 py-1.5 text-xs font-medium ${
              status === item.value ? 'bg-primary-600 text-white' : 'bg-neutral-100 text-neutral-600 hover:bg-neutral-200'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {message && (
        <p className="mb-3 text-sm text-neutral-600" role="status">
          {message}
        </p>
      )}

      {listState === 'loading' && <LoadingState text="加载隐私请求…" className="py-24" />}
      {listState === 'error' && (
        <ErrorState title="列表加载失败" message={message ?? '请稍后重试'} onRetry={() => void loadList()} className="py-24" />
      )}
      {listState === 'ready' && items.length === 0 && (
        <EmptyState title="暂无匹配请求" description="切换状态筛选，或等待会员提交导出 / 撤回授权请求。" className="py-24" />
      )}
      {listState === 'ready' && items.length > 0 && (
        <div className="space-y-3">
          {items.map((item) => (
            <Card key={item.id} className="p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-neutral-900">
                    {MEMBER_DATA_REQUEST_TYPE_LABEL[item.requestType]}
                  </p>
                  <p className="mt-1 text-xs text-neutral-500">
                    {item.phoneMasked} · {item.nickname?.trim() || '未设置昵称'} · {shortId(item.id)}
                  </p>
                  <p className="mt-1 text-xs text-neutral-400">提交 {fmt(item.requestedAt)}</p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_CLASS[item.status]}`}>
                  {MEMBER_DATA_REQUEST_STATUS_LABEL[item.status]}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {item.canRetry && (
                  <Button size="sm" variant="secondary" disabled={busyId === item.id} onClick={() => void runRetry(item.id)}>
                    重试导出
                  </Button>
                )}
                {item.requestType === 'export' && (item.status === 'pending' || item.status === 'failed') && (
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busyId === item.id}
                    onClick={() => setRejectDraft({ id: item.id, reason: '' })}
                  >
                    驳回
                  </Button>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}

      {rejectDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <Card className="w-full max-w-md p-5">
            <p className="text-base font-semibold text-neutral-900">确认驳回</p>
            <p className="mt-2 text-sm text-neutral-600">{ADMIN_DATA_REQUEST_REJECT_HINT}</p>
            <textarea
              className="mt-3 h-24 w-full rounded-lg border border-neutral-200 p-3 text-sm"
              value={rejectDraft.reason}
              maxLength={200}
              placeholder="请填写驳回原因（必填）"
              onChange={(event) => setRejectDraft({ ...rejectDraft, reason: event.target.value })}
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={() => setRejectDraft(null)}>
                取消
              </Button>
              <Button size="sm" disabled={!rejectDraft.reason.trim() || busyId === rejectDraft.id} onClick={() => void runReject()}>
                确认驳回
              </Button>
            </div>
          </Card>
        </div>
      )}
    </Page>
  )
}
