import type {
  AdminUserListItem,
  AdminUserListResult,
  AdminUserListQuery,
  AdminUserStatusChangeResult,
} from '@ai-job-print/shared'
import { Card, EmptyState, ErrorState } from '@ai-job-print/ui'
import { RefreshCwIcon, SearchIcon } from 'lucide-react'
import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { list as listAdminUsers } from '../../services/api/adminUsers'
import { ApiHttpError } from '../../services/api/client'
import { Page } from '../Page'
import { Pagination, useTableState } from '../components/DataTable'
import { UserDetailDrawer } from './UserDetailDrawer'
import { UserStatusDialog, type UserStatusDialogTarget, type UserStatusIntent } from './UserStatusDialog'
import {
  buildAdminUserQuery,
  canDisableUser,
  canRestoreUser,
  EMPTY_USER_FILTERS,
  formatUserDateTime,
  hasUserFilters,
  USER_STATUS_LABELS,
  userDisplayName,
  type UserFilterState,
} from './userPresentation'

type ListState = 'loading' | 'ready' | 'error'

const EMPTY_RESULT: AdminUserListResult = { items: [], total: 0, page: 1, pageSize: 20 }

function asPageSize(value: number): AdminUserListQuery['pageSize'] {
  return value === 10 || value === 50 || value === 100 ? value : 20
}

function TableSkeleton() {
  return (
    <div className="animate-pulse p-4" aria-label="正在加载用户列表">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="grid grid-cols-6 gap-4 border-b border-neutral-100 py-4">
          {Array.from({ length: 6 }, (__, cell) => <div key={cell} className="h-4 rounded bg-neutral-100" />)}
        </div>
      ))}
    </div>
  )
}

function StatusPill({ status }: { status: AdminUserListItem['status'] }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${status === 'active' ? 'bg-success-bg text-success-fg' : 'bg-neutral-100 text-neutral-500'}`}>
      {USER_STATUS_LABELS[status]}
    </span>
  )
}

export default function UsersPage() {
  const { page, pageSize, setPage, setPageSize } = useTableState(20)
  const safePage = Number.isSafeInteger(page) && page >= 1 ? page : 1
  const [draft, setDraft] = useState<UserFilterState>(EMPTY_USER_FILTERS)
  const [applied, setApplied] = useState<UserFilterState>(EMPTY_USER_FILTERS)
  const [result, setResult] = useState<AdminUserListResult>(EMPTY_RESULT)
  const [state, setState] = useState<ListState>('loading')
  const [listError, setListError] = useState<ApiHttpError | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [statusTarget, setStatusTarget] = useState<UserStatusDialogTarget | null>(null)
  const [statusNotice, setStatusNotice] = useState<string | null>(null)
  const requestSequence = useRef(0)
  const statusTriggerRef = useRef<HTMLButtonElement | null>(null)
  const setPageRef = useRef(setPage)
  const pageSizeChangePendingRef = useRef(false)
  const detailTriggerRef = useRef<HTMLButtonElement | null>(null)
  setPageRef.current = setPage

  const query = useMemo(
    () => buildAdminUserQuery(applied, safePage, asPageSize(pageSize)),
    [applied, safePage, pageSize],
  )

  useEffect(() => {
    let cancelled = false
    const requestId = ++requestSequence.current
    setState('loading')
    setListError(null)
    void listAdminUsers(query)
      .then((data) => {
        if (cancelled || requestId !== requestSequence.current) return
        const lastPage = Math.max(1, Math.ceil(data.total / query.pageSize))
        if (safePage > lastPage) {
          setPageRef.current(lastPage)
          return
        }
        setResult(data)
        setState('ready')
      })
      .catch((error: unknown) => {
        if (cancelled || requestId !== requestSequence.current) return
        setListError(error instanceof ApiHttpError
          ? error
          : new ApiHttpError('NETWORK_ERROR', '网络连接失败', 0))
        setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [query, refreshKey, safePage])

  const applyFilters = (event: FormEvent) => {
    event.preventDefault()
    setApplied({ ...draft })
    setPage(1)
  }

  const resetFilters = () => {
    setDraft(EMPTY_USER_FILTERS)
    setApplied(EMPTY_USER_FILTERS)
    setPage(1)
  }

  const handlePageSizeChange = (nextPageSize: number) => {
    pageSizeChangePendingRef.current = true
    setPageSize(nextPageSize)
    queueMicrotask(() => {
      pageSizeChangePendingRef.current = false
    })
  }

  const handlePageChange = (nextPage: number) => {
    if (pageSizeChangePendingRef.current && nextPage === 1) {
      pageSizeChangePendingRef.current = false
      return
    }
    setPage(nextPage)
  }

  const openDetail = (user: AdminUserListItem, trigger: HTMLButtonElement) => {
    detailTriggerRef.current = trigger
    setSelectedId(user.id)
  }

  const closeDetail = () => {
    setSelectedId(null)
    requestAnimationFrame(() => detailTriggerRef.current?.focus())
  }

  const openStatusDialog = (user: AdminUserListItem, intent: UserStatusIntent, trigger: HTMLButtonElement) => {
    statusTriggerRef.current = trigger
    setStatusNotice(null)
    setStatusTarget({ user, intent })
  }

  const closeStatusDialog = () => {
    setStatusTarget(null)
    requestAnimationFrame(() => statusTriggerRef.current?.focus())
  }

  // 就地替换该行而不是整表重拉：状态变更的权威结果就在响应体里，
  // 重拉一次反而会在筛选了「正常」时让刚停用的行凭空消失，看起来像操作失败。
  const applyStatusChange = (result: AdminUserStatusChangeResult, intent: UserStatusIntent) => {
    setResult((current) => ({
      ...current,
      items: current.items.map((item) => (item.id === result.user.id ? result.user : item)),
    }))
    const name = userDisplayName(result.user)
    setStatusNotice(
      result.changed
        ? `已${intent === 'disable' ? '停用' : '恢复'}「${name}」，操作已记入审计日志。`
        : `「${name}」已处于${intent === 'disable' ? '停用' : '正常'}状态，本次未做改动。`,
    )
  }

  const filtered = hasUserFilters(applied)
  const retryable = listError === null || listError.status === 0 || listError.status >= 500
  const listErrorTitle = listError?.status === 403 ? '无权查看用户列表' : '用户列表加载失败'
  const listErrorMessage = listError?.status === 403
    ? '当前账号没有用户管理权限，请联系管理员确认权限。'
    : listError !== null && listError.status >= 400 && listError.status < 500
      ? '当前筛选条件无法处理，请调整筛选条件后重新查询。'
      : listError?.status === 0
        ? '请检查网络连接后重试。'
        : '服务暂时不可用，请稍后重试。'

  return (
    <Page title="用户管理" subtitle="查看终端注册用户与服务使用概况">
      <Card className="mb-4 p-4">
        <form onSubmit={applyFilters} className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_160px_170px_170px_auto]">
          <label className="relative">
            <span className="sr-only">统一搜索</span>
            <SearchIcon className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-neutral-400" aria-hidden />
            <input
              value={draft.search}
              maxLength={50}
              onChange={(event) => setDraft((value) => ({ ...value, search: event.target.value }))}
              placeholder="搜索昵称、关键词或完整手机号"
              className="h-10 w-full rounded-lg border border-neutral-200 pl-9 pr-3 text-sm outline-none focus:border-primary-400"
            />
          </label>
          <label>
            <span className="sr-only">账号状态</span>
            <select value={draft.enabled} onChange={(event) => setDraft((value) => ({ ...value, enabled: event.target.value as UserFilterState['enabled'] }))} className="h-10 w-full rounded-lg border border-neutral-200 bg-surface px-3 text-sm outline-none focus:border-primary-400">
              <option value="all">全部状态</option>
              <option value="enabled">正常</option>
              <option value="disabled">已停用</option>
            </select>
          </label>
          <label>
            <span className="sr-only">注册开始日期 registeredFrom</span>
            <input type="date" value={draft.registeredFrom} max={draft.registeredTo || undefined} onChange={(event) => setDraft((value) => ({ ...value, registeredFrom: event.target.value }))} className="h-10 w-full rounded-lg border border-neutral-200 px-3 text-sm outline-none focus:border-primary-400" />
          </label>
          <label>
            <span className="sr-only">注册结束日期 registeredTo</span>
            <input type="date" value={draft.registeredTo} min={draft.registeredFrom || undefined} onChange={(event) => setDraft((value) => ({ ...value, registeredTo: event.target.value }))} className="h-10 w-full rounded-lg border border-neutral-200 px-3 text-sm outline-none focus:border-primary-400" />
          </label>
          <div className="flex items-center gap-2">
            <button type="submit" className="h-10 rounded-lg bg-primary-600 px-4 text-sm font-semibold text-white hover:bg-primary-700">查询</button>
            <button type="button" onClick={resetFilters} className="h-10 rounded-lg border border-neutral-200 px-4 text-sm font-medium text-neutral-600 hover:bg-neutral-50">重置</button>
            <button type="button" onClick={() => setRefreshKey((value) => value + 1)} aria-label="刷新用户列表" className="flex h-10 items-center gap-1.5 rounded-lg border border-neutral-200 px-3 text-sm font-medium text-neutral-600 hover:bg-neutral-50">
              <RefreshCwIcon className="h-4 w-4" aria-hidden />刷新
            </button>
          </div>
        </form>
      </Card>

      {statusNotice && (
        <div
          role="status"
          className="mb-4 flex items-center justify-between gap-4 rounded-lg bg-success-bg px-4 py-3 text-sm text-success-fg"
        >
          <span>{statusNotice}</span>
          <button
            type="button"
            onClick={() => setStatusNotice(null)}
            className="shrink-0 rounded px-2 py-1 text-xs font-medium underline-offset-2 hover:underline"
          >
            知道了
          </button>
        </div>
      )}

      <Card className="overflow-hidden">
        {state === 'loading' && <TableSkeleton />}
        {state === 'error' && (
          <ErrorState
            title={listErrorTitle}
            message={listErrorMessage}
            onRetry={retryable ? () => setRefreshKey((value) => value + 1) : undefined}
            className="py-24"
          />
        )}
        {state === 'ready' && result.items.length === 0 && (
          <EmptyState
            title={filtered ? '未找到符合条件的用户' : '暂无注册用户'}
            description={filtered ? '请调整筛选条件后重新查询' : undefined}
            action={filtered ? <button type="button" onClick={resetFilters} className="rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50">重置筛选</button> : undefined}
            className="py-24"
          />
        )}
        {state === 'ready' && result.items.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-neutral-100 bg-neutral-50/70 text-left text-xs font-medium text-neutral-500">
                <tr>
                  <th className="px-4 py-3">用户</th>
                  <th className="px-4 py-3">手机号</th>
                  <th className="px-4 py-3">账号状态</th>
                  <th className="px-4 py-3">最近登录</th>
                  <th className="px-4 py-3">注册时间</th>
                  <th className="px-4 py-3 text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-100">
                {result.items.map((user) => (
                  <tr key={user.id} className="text-neutral-700 hover:bg-neutral-50/70">
                    <td className="px-4 py-3 font-medium text-neutral-900">{userDisplayName(user)}</td>
                    <td className="px-4 py-3 font-mono text-xs">{user.maskedPhone}</td>
                    <td className="px-4 py-3"><StatusPill status={user.status} /></td>
                    <td className="px-4 py-3">{user.lastLoginAt ? formatUserDateTime(user.lastLoginAt) : '暂无登录记录'}</td>
                    <td className="px-4 py-3">{formatUserDateTime(user.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={(event) => openDetail(user, event.currentTarget)}
                          aria-label={`查看用户 ${userDisplayName(user)} 的详情`}
                          className="rounded-lg px-3 py-1.5 text-sm font-medium text-primary-700 hover:bg-primary-50"
                        >
                          查看详情
                        </button>
                        {canDisableUser(user) && (
                          <button
                            type="button"
                            onClick={(event) => openStatusDialog(user, 'disable', event.currentTarget)}
                            aria-label={`停用用户 ${userDisplayName(user)}`}
                            className="rounded-lg px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
                          >
                            停用
                          </button>
                        )}
                        {canRestoreUser(user) && (
                          <button
                            type="button"
                            onClick={(event) => openStatusDialog(user, 'restore', event.currentTarget)}
                            aria-label={`恢复用户 ${userDisplayName(user)}`}
                            className="rounded-lg px-3 py-1.5 text-sm font-medium text-primary-700 hover:bg-primary-50"
                          >
                            恢复
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {state === 'ready' && (
          <Pagination
            total={result.total}
            page={safePage}
            pageSize={pageSize}
            onPageChange={handlePageChange}
            onPageSizeChange={handlePageSizeChange}
          />
        )}
      </Card>

      <UserDetailDrawer
        endUserId={selectedId}
        onClose={closeDetail}
        onMissing={() => setRefreshKey((value) => value + 1)}
      />

      <UserStatusDialog
        target={statusTarget}
        onClose={closeStatusDialog}
        onSuccess={applyStatusChange}
      />
    </Page>
  )
}
