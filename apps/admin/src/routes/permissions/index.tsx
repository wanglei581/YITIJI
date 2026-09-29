// 权限管理页 = 内部账号名册（3.9）。对接 services/api admin-internal-accounts 模块。
// 只在既有 /permissions 路由上替换内容：不新建页、不新增路由。
// mock 模式（VITE_API_MODE=mock）下不造假名册，显示诚实空态。

import { Card, EmptyState, ErrorState } from '@ai-job-print/ui'
import { PlusIcon, RefreshCwIcon, SearchIcon, ShieldIcon } from 'lucide-react'
import { type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getUser } from '../../services/auth'
import { API_MODE, ApiHttpError } from '../../services/api/client'
import { userMessageOf } from '../../services/api/userErrorMessage'
import type {
  InternalAccountItem,
  InternalAccountListResult,
  InternalAccountStatusResult,
} from '../../services/api/internalAccounts'
import { listInternalAccounts, toAllowedPageSize } from '../../services/api/internalAccounts'
import { Page } from '../Page'
import { Pagination } from '../components/DataTable'
import { AccountStatusDialog, type AccountStatusDialogTarget } from './AccountStatusDialog'
import { AccountsTable } from './AccountsTable'
import { BackupAdminDrawer } from './BackupAdminDrawer'
import {
  EMPTY_ROSTER_FILTERS,
  ENABLED_FILTER_OPTIONS,
  ROLE_FILTER_OPTIONS,
  backupAdminExistsIn,
  buildRosterQuery,
  hasRosterFilters,
  type RosterFilterState,
} from './presentation'

type ListState = 'loading' | 'ready' | 'error'

const EMPTY_RESULT: InternalAccountListResult = { items: [], total: 0, page: 1, pageSize: 20 }

export default function PermissionsPage() {
  const currentUser = getUser()
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(20)
  const [draft, setDraft] = useState<RosterFilterState>(EMPTY_ROSTER_FILTERS)
  const [applied, setApplied] = useState<RosterFilterState>(EMPTY_ROSTER_FILTERS)
  const [result, setResult] = useState<InternalAccountListResult>(EMPTY_RESULT)
  const [state, setState] = useState<ListState>('loading')
  const [listError, setListError] = useState<ApiHttpError | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [notice, setNotice] = useState<string | null>(null)
  const [statusTarget, setStatusTarget] = useState<AccountStatusDialogTarget | null>(null)
  const [backupOpen, setBackupOpen] = useState(false)
  // 见过备用管理员就保持禁用，避免它不在当前筛选页时按钮又亮起来。
  const [backupKnown, setBackupKnown] = useState(false)
  // 启用管理员总数：行级「最后一个启用管理员」判定用；null = 尚未取到。
  const [enabledAdminTotal, setEnabledAdminTotal] = useState<number | null>(null)
  const requestSequence = useRef(0)
  const statusTriggerRef = useRef<HTMLButtonElement | null>(null)

  const refresh = useCallback(() => setRefreshKey((value) => value + 1), [])

  const query = useMemo(
    () => buildRosterQuery(applied, page, toAllowedPageSize(pageSize)),
    [applied, page, pageSize],
  )

  useEffect(() => {
    let cancelled = false
    const requestId = ++requestSequence.current
    setState('loading')
    setListError(null)
    void listInternalAccounts(query)
      .then((data) => {
        if (cancelled || requestId !== requestSequence.current) return
        if (data.items.some((item) => item.isBackupAdmin)) setBackupKnown(true)
        const lastPage = Math.max(1, Math.ceil(data.total / data.pageSize))
        if (page > lastPage) {
          setPage(lastPage)
          return
        }
        setResult(data)
        setState('ready')
      })
      .catch((error: unknown) => {
        if (cancelled || requestId !== requestSequence.current) return
        setListError(error instanceof ApiHttpError ? error : new ApiHttpError('NETWORK_ERROR', '网络连接失败', 0))
        setState('error')
      })
    // 启用管理员总数只做行级按钮判定，独立于名册筛选。
    void listInternalAccounts({ role: 'admin', enabled: true, page: 1, pageSize: 10 })
      .then((data) => {
        if (!cancelled) setEnabledAdminTotal(data.total)
      })
      .catch(() => {
        if (!cancelled) setEnabledAdminTotal(null)
      })
    return () => {
      cancelled = true
    }
  }, [query, refreshKey, page])

  // 不带筛选扫一页，备用管理员不在当前筛选结果里时也能禁用新建按钮。
  useEffect(() => {
    let cancelled = false
    void listInternalAccounts({ page: 1, pageSize: 100 })
      .then((data) => {
        if (!cancelled && data.items.some((item) => item.isBackupAdmin)) setBackupKnown(true)
      })
      .catch(() => {
        // 探测失败不阻断名册；重复创建仍由服务端 BACKUP_ADMIN_EXISTS 拒绝。
      })
    return () => {
      cancelled = true
    }
  }, [refreshKey])

  const applyFilters = (event: FormEvent) => {
    event.preventDefault()
    setApplied({ ...draft })
    setPage(1)
  }

  const resetFilters = () => {
    setDraft(EMPTY_ROSTER_FILTERS)
    setApplied(EMPTY_ROSTER_FILTERS)
    setPage(1)
  }

  const openStatusDialog = (account: InternalAccountItem, intent: 'enable' | 'disable', trigger: HTMLButtonElement) => {
    statusTriggerRef.current = trigger
    setStatusTarget({ account, intent })
  }

  const closeStatusDialog = () => {
    setStatusTarget(null)
    requestAnimationFrame(() => statusTriggerRef.current?.focus())
  }

  // 启停成功：用响应体就地刷新该行；sessionInvalidation 语义如实提示。
  const applyStatusChange = (change: InternalAccountStatusResult, intent: 'enable' | 'disable') => {
    setResult((current) => ({
      ...current,
      items: current.items.map((item) => (item.id === change.id ? change : item)),
    }))
    setEnabledAdminTotal((total) => (total === null ? total : intent === 'disable' ? Math.max(0, total - 1) : total + 1))
    setNotice(
      change.sessionInvalidation === 'failed'
        ? `「${change.username}」状态已更新，但未能立即让该账号已登录的会话失效，请稍后复查`
        : `已${intent === 'disable' ? '停用' : '启用'}「${change.username}」，操作已记入审计日志`,
    )
  }

  const handleBackupCreated = (account: InternalAccountItem) => {
    setBackupKnown(true)
    setResult((current) => ({ ...current, total: current.total + 1 }))
    setNotice(
      `备用管理员「${account.username}」已创建（停用、随机临时密码、手机号已验证）；启用后本人用绑定手机号走登录页「找回密码」设新密码`,
    )
    refresh()
  }

  const filtered = hasRosterFilters(applied)
  const retryable = listError === null || listError.status === 0 || listError.status >= 500
  const backupDisabled = backupKnown || backupAdminExistsIn(result.items)

  return (
    <Page
      title="权限管理"
      subtitle="内部账号名册（管理员、合作机构账号、终端账号）"
      actions={
        <button
          type="button"
          onClick={() => setBackupOpen(true)}
          disabled={backupDisabled}
          title={backupDisabled ? '已存在备用管理员账号；如需更换请先处理现有备用管理员' : undefined}
          className="flex min-h-12 items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-sm font-medium text-white hover:bg-primary-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <PlusIcon className="h-4 w-4" aria-hidden />
          新建备用管理员
        </button>
      }
    >
      <p className="mb-4 text-sm text-neutral-500">
        本页管理平台内部账号：管理员（含备用管理员）、合作机构账号、终端账号。
        合作机构账号的启用停用在「合作机构管理」里做，本页提供跳转；终端账号只读。
      </p>
      {backupDisabled && (
        <p className="mb-4 text-sm text-amber-800">
          已存在备用管理员账号，不能再建第二个。如需更换，请先处理现有备用管理员。
        </p>
      )}

      {notice && (
        <div
          role="status"
          className="mb-4 flex items-center justify-between gap-4 rounded-lg bg-success-bg px-4 py-3 text-sm text-success-fg"
        >
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="min-h-12 shrink-0 rounded px-3 text-xs font-medium underline-offset-2 hover:underline"
          >
            知道了
          </button>
        </div>
      )}

      <Card className="mb-4 min-w-0 p-4">
        <form onSubmit={applyFilters} className="grid gap-3 lg:grid-cols-[1fr_160px_160px_auto]">
          <label className="relative">
            <span className="sr-only">关键词</span>
            <SearchIcon className="pointer-events-none absolute left-3 top-4 h-4 w-4 text-neutral-400" aria-hidden />
            <input
              value={draft.keyword}
              maxLength={50}
              onChange={(event) => setDraft((value) => ({ ...value, keyword: event.target.value }))}
              placeholder="搜索账号、姓名或完整手机号"
              className="h-12 w-full rounded-lg border border-neutral-200 pl-9 pr-3 text-sm outline-none focus:border-primary-400"
            />
          </label>
          <label>
            <span className="sr-only">角色</span>
            <select
              value={draft.role}
              onChange={(event) => setDraft((value) => ({ ...value, role: event.target.value as RosterFilterState['role'] }))}
              className="h-12 w-full rounded-lg border border-neutral-200 bg-surface px-3 text-sm outline-none focus:border-primary-400"
            >
              {ROLE_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label>
            <span className="sr-only">状态</span>
            <select
              value={draft.enabled}
              onChange={(event) => setDraft((value) => ({ ...value, enabled: event.target.value as RosterFilterState['enabled'] }))}
              className="h-12 w-full rounded-lg border border-neutral-200 bg-surface px-3 text-sm outline-none focus:border-primary-400"
            >
              {ENABLED_FILTER_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-2">
            <button type="submit" className="min-h-12 rounded-lg bg-primary-600 px-4 text-sm font-semibold text-white hover:bg-primary-700">查询</button>
            <button type="button" onClick={resetFilters} className="min-h-12 rounded-lg border border-neutral-200 px-4 text-sm font-medium text-neutral-600 hover:bg-neutral-50">重置</button>
            <button
              type="button"
              onClick={refresh}
              aria-label="刷新内部账号名册"
              className="flex min-h-12 items-center gap-1.5 rounded-lg border border-neutral-200 px-3 text-sm font-medium text-neutral-600 hover:bg-neutral-50"
            >
              <RefreshCwIcon className="h-4 w-4" aria-hidden />刷新
            </button>
          </div>
        </form>
      </Card>

      <Card className="min-w-0 overflow-hidden">
        {state === 'loading' && <TableSkeleton />}
        {state === 'error' && (
          <ErrorState
            title={listError?.status === 403 ? '无权查看内部账号名册' : '名册加载失败'}
            message={
              listError?.status === 403
                ? userMessageOf(listError, '当前账号没有权限管理内部账号。')
                : userMessageOf(listError, '服务暂时不可用，请稍后重试。')
            }
            onRetry={retryable ? refresh : undefined}
            className="py-24"
          />
        )}
        {state === 'ready' && result.items.length === 0 && (
          <EmptyState
            icon={ShieldIcon}
            title={filtered ? '未找到符合条件的内部账号' : '暂无内部账号'}
            description={
              filtered
                ? '请调整筛选条件后重新查询'
                : API_MODE === 'http'
                  ? '当前没有可显示的内部账号。'
                  : '当前演示模式不连接真实账号数据；连接真实后端后此处显示管理员、合作机构与终端账号名册。'
            }
            action={filtered ? (
              <button type="button" onClick={resetFilters} className="rounded-lg border border-neutral-200 px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50">
                重置筛选
              </button>
            ) : undefined}
            className="py-24"
          />
        )}
        {state === 'ready' && result.items.length > 0 && (
          <>
            <AccountsTable
              items={result.items}
              currentUserId={currentUser?.id ?? null}
              enabledAdminTotal={enabledAdminTotal}
              onSetStatus={openStatusDialog}
            />
            <Pagination
              total={result.total}
              page={page}
              pageSize={pageSize}
              onPageChange={setPage}
              onPageSizeChange={(size) => {
                setPageSize(size)
                setPage(1)
              }}
            />
          </>
        )}
      </Card>

      <p className="mt-3 text-xs text-neutral-400">
        时间均按北京时间显示；「最后登录」为空的账号从未登录过。启停管理员需填写事由并验证本人密码，
        全部操作记录审计日志。备用管理员应急启用仅在服务器端按运维手册执行，本页不提供。
      </p>

      <AccountStatusDialog
        target={statusTarget}
        onClose={closeStatusDialog}
        onStatusApplied={applyStatusChange}
        onRosterChanged={refresh}
      />
      <BackupAdminDrawer
        open={backupOpen}
        onClose={() => setBackupOpen(false)}
        onCreated={handleBackupCreated}
      />
    </Page>
  )
}

function TableSkeleton() {
  return (
    <div className="animate-pulse p-4" aria-label="正在加载内部账号名册">
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="grid grid-cols-6 gap-4 border-b border-neutral-100 py-4">
          {Array.from({ length: 6 }, (__, cell) => <div key={cell} className="h-4 rounded bg-neutral-100" />)}
        </div>
      ))}
    </div>
  )
}
