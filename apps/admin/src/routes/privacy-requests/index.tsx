import { useState } from 'react'
import { Drawer, EmptyState, ErrorState, LoadingState, StatusBadge } from '@ai-job-print/ui'
import { ShieldIcon, RefreshCwIcon, RotateCcwIcon, XCircleIcon } from 'lucide-react'
import { Page } from '../Page'
import { FilterChip } from '../components/FilterChip'
import {
  adminPrivacyRequestsService,
  type AdminDataRequestItem,
  type DataRequestStatus,
  type DataRequestType,
} from '../../services/api/adminPrivacyRequests'

// ─── Display maps ──────────────────────────────────────────────────────────────

const STATUS_MAP: Record<DataRequestStatus, { badge: 'success' | 'error' | 'warning' | 'info' | 'default'; label: string }> = {
  pending:   { badge: 'warning', label: '待处理' },
  handling:  { badge: 'info',    label: '处理中' },
  ready:     { badge: 'info',    label: '已就绪' },
  completed: { badge: 'success', label: '已完成' },
  expired:   { badge: 'default', label: '已过期' },
  failed:    { badge: 'error',   label: '失败' },
  rejected:  { badge: 'default', label: '已拒绝' },
  cancelled: { badge: 'default', label: '已取消' },
}

const TYPE_MAP: Record<DataRequestType, string> = {
  export:         '数据导出',
  delete:         '注销申请',
  revoke_consent: '撤回授权',
}

const STATUS_FILTERS: { label: string; value: DataRequestStatus | '' }[] = [
  { label: '全部', value: '' },
  { label: '待处理', value: 'pending' },
  { label: '处理中', value: 'handling' },
  { label: '已就绪', value: 'ready' },
  { label: '已完成', value: 'completed' },
  { label: '失败', value: 'failed' },
  { label: '已拒绝', value: 'rejected' },
]

const TYPE_FILTERS: { label: string; value: DataRequestType | '' }[] = [
  { label: '全部类型', value: '' },
  { label: '数据导出', value: 'export' },
  { label: '撤回授权', value: 'revoke_consent' },
]

const TH_CLS = 'whitespace-nowrap border-b border-neutral-900/10 px-2.5 py-2 text-left text-[11.5px] font-bold tracking-[0.04em] text-neutral-500'
const TD_CLS = 'whitespace-nowrap border-b border-neutral-900/[0.06] px-2.5 py-[11px]'

function fmt(iso: string | null): string {
  return iso ? iso.slice(0, 16).replace('T', ' ') : '—'
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11.5px] font-bold tracking-[0.03em] text-neutral-500">{label}</p>
      <p className="mt-1 text-[13.5px] font-semibold text-neutral-900">{value}</p>
    </div>
  )
}

// ─── Reject dialog ─────────────────────────────────────────────────────────────

function RejectDialog({
  open,
  onClose,
  onConfirm,
  busy,
}: {
  open: boolean
  onClose: () => void
  onConfirm: (reason: string) => void
  busy: boolean
}) {
  const [reason, setReason] = useState('')
  if (!open) return null
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]">
      <div className="w-full max-w-sm rounded-xl bg-white px-6 py-5 shadow-xl">
        <h2 className="mb-1 text-[15px] font-extrabold text-neutral-900">拒绝数据请求</h2>
        <p className="mb-4 text-[12.5px] text-neutral-500">请填写拒绝原因（最多 200 字，不可包含手机号）</p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={200}
          rows={3}
          className="w-full rounded-lg border border-neutral-200 px-3 py-2 text-[13px] text-neutral-900 outline-none focus:border-primary-500 resize-none"
          placeholder="请输入拒绝原因…"
        />
        <p className="mt-1 text-right text-[11px] text-neutral-400">{reason.length}/200</p>
        <div className="mt-4 flex justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="h-8 rounded-lg border border-neutral-200 px-4 text-[13px] font-semibold text-neutral-600 hover:bg-neutral-50 disabled:opacity-50"
          >
            取消
          </button>
          <button
            type="button"
            onClick={() => onConfirm(reason.trim())}
            disabled={busy || reason.trim().length === 0}
            className="h-8 rounded-lg bg-error px-4 text-[13px] font-bold text-white hover:opacity-90 disabled:opacity-50"
          >
            {busy ? '处理中…' : '确认拒绝'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main page ─────────────────────────────────────────────────────────────────

export default function PrivacyRequestsPage() {
  const [statusFilter, setStatusFilter] = useState<DataRequestStatus | ''>('')
  const [typeFilter, setTypeFilter] = useState<DataRequestType | ''>('')
  const [cursor, setCursor] = useState<string | undefined>(undefined)
  const [cursorStack, setCursorStack] = useState<string[]>([])

  const [items, setItems] = useState<AdminDataRequestItem[] | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loadState, setLoadState] = useState<'loading' | 'error' | 'ready'>('loading')

  const [detail, setDetail] = useState<AdminDataRequestItem | null>(null)
  const [rejectTarget, setRejectTarget] = useState<AdminDataRequestItem | null>(null)
  const [actionBusy, setActionBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const load = async (opts: { status?: DataRequestStatus | ''; type?: DataRequestType | ''; cur?: string } = {}) => {
    setLoadState('loading')
    setActionError(null)
    try {
      const page = await adminPrivacyRequestsService.list({
        status: opts.status ?? statusFilter,
        requestType: opts.type ?? typeFilter,
        cursor: opts.cur,
        limit: 20,
      })
      setItems(page.items)
      setNextCursor(page.nextCursor)
      setLoadState('ready')
    } catch {
      setLoadState('error')
    }
  }

  // Initial load
  useState(() => { void load() })

  const applyStatusFilter = (v: DataRequestStatus | '') => {
    setStatusFilter(v)
    setCursor(undefined)
    setCursorStack([])
    void load({ status: v, cur: undefined })
  }

  const applyTypeFilter = (v: DataRequestType | '') => {
    setTypeFilter(v)
    setCursor(undefined)
    setCursorStack([])
    void load({ type: v, cur: undefined })
  }

  const goNext = () => {
    if (!nextCursor) return
    setCursorStack((s) => [...s, cursor ?? ''])
    setCursor(nextCursor)
    void load({ cur: nextCursor })
  }

  const goPrev = () => {
    const stack = [...cursorStack]
    const prev = stack.pop()
    setCursorStack(stack)
    const cur = prev === '' ? undefined : prev
    setCursor(cur)
    void load({ cur })
  }

  const handleRetry = async (item: AdminDataRequestItem) => {
    setActionBusy(true)
    setActionError(null)
    try {
      const updated = await adminPrivacyRequestsService.retry(item.id)
      setItems((prev) => prev?.map((i) => (i.id === updated.id ? updated : i)) ?? null)
      if (detail?.id === updated.id) setDetail(updated)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '操作失败，请重试')
    } finally {
      setActionBusy(false)
    }
  }

  const handleRejectConfirm = async (reason: string) => {
    if (!rejectTarget) return
    setActionBusy(true)
    setActionError(null)
    try {
      const updated = await adminPrivacyRequestsService.reject(rejectTarget.id, reason)
      setItems((prev) => prev?.map((i) => (i.id === updated.id ? updated : i)) ?? null)
      if (detail?.id === updated.id) setDetail(updated)
      setRejectTarget(null)
    } catch (err) {
      setActionError(err instanceof Error ? err.message : '操作失败，请重试')
    } finally {
      setActionBusy(false)
    }
  }

  const canRetry = (item: AdminDataRequestItem) =>
    item.requestType === 'export' && (item.status === 'pending' || item.status === 'failed') && item.canRetry

  const canReject = (item: AdminDataRequestItem) =>
    item.requestType === 'export' && (item.status === 'pending' || item.status === 'failed')

  return (
    <Page
      title="数据权利工单"
      subtitle="会员数据导出 / 撤回授权请求 · 管理员只做状态标记，不直接执行导出或删除"
      actions={
        <button
          type="button"
          onClick={() => void load()}
          className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-neutral-200 bg-surface px-4 text-[13px] font-bold text-neutral-700 transition-colors hover:bg-neutral-50"
        >
          <RefreshCwIcon className="h-3.5 w-3.5" aria-hidden="true" />
          刷新
        </button>
      }
    >
      {/* 说明横幅 */}
      <div className="mb-4 rounded-[9px] border border-info/20 bg-info-bg px-4 py-2.5 text-[13px] text-info-fg">
        此页仅供管理员处理数据导出请求（标记重试或拒绝）。账号注销（delete）请求因法务矩阵未签字，暂不开放操作按钮。撤回授权（revoke_consent）由系统同步完成，无需人工干预。
      </div>

      {actionError && (
        <div className="mb-4 rounded-[9px] border border-error/30 bg-error-bg px-4 py-2.5 text-[13px] text-error-fg">
          {actionError}
        </div>
      )}

      <section className="overflow-hidden rounded-lg border border-neutral-900/[0.06] bg-surface shadow-sm">
        <div className="px-5 pt-[18px]">
          {/* 状态筛选 */}
          <div className="mb-2.5 flex flex-wrap items-center gap-2.5">
            {STATUS_FILTERS.map((f) => (
              <FilterChip
                key={f.label}
                active={statusFilter === f.value}
                label={f.label}
                onClick={() => applyStatusFilter(f.value)}
              />
            ))}
          </div>
          {/* 类型筛选 */}
          <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
            {TYPE_FILTERS.map((f) => (
              <FilterChip
                key={f.label}
                active={typeFilter === f.value}
                label={f.label}
                onClick={() => applyTypeFilter(f.value)}
              />
            ))}
          </div>
        </div>

        {loadState === 'loading' && <LoadingState className="py-24" />}
        {loadState === 'error' && <ErrorState className="py-24" onRetry={() => void load()} />}

        {loadState === 'ready' && (
          <>
            <div className="overflow-x-auto px-5">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr>
                    {['工单ID', '类型', '状态', '会员(掩码)', '昵称', '重试次数', '请求时间', '处理时间', '操作'].map((h) => (
                      <th key={h} className={TH_CLS}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(items ?? []).length === 0 ? (
                    <tr>
                      <td colSpan={9}>
                        <EmptyState
                          icon={ShieldIcon}
                          title="暂无数据权利工单"
                          description="会员提交数据导出或撤回授权请求后会出现在这里"
                          className="py-12"
                        />
                      </td>
                    </tr>
                  ) : (
                    (items ?? []).map((item) => {
                      const s = STATUS_MAP[item.status] ?? { badge: 'default' as const, label: item.status }
                      return (
                        <tr
                          key={item.id}
                          className="cursor-pointer transition-colors hover:bg-neutral-50"
                          onClick={() => setDetail(item)}
                        >
                          <td className={`${TD_CLS} font-mono text-xs text-primary-700`}>{item.id.slice(0, 12)}…</td>
                          <td className={`${TD_CLS} font-semibold text-neutral-800`}>{TYPE_MAP[item.requestType] ?? item.requestType}</td>
                          <td className={TD_CLS}><StatusBadge dot status={s.badge} label={s.label} /></td>
                          <td className={`${TD_CLS} font-mono text-xs text-neutral-600`}>{item.phoneMasked}</td>
                          <td className={`${TD_CLS} text-neutral-600`}>{item.nickname ?? '—'}</td>
                          <td className={`${TD_CLS} tabular-nums text-neutral-500`}>{item.retryCount}</td>
                          <td className={`${TD_CLS} tabular-nums text-xs text-neutral-500`}>{fmt(item.requestedAt)}</td>
                          <td className={`${TD_CLS} tabular-nums text-xs text-neutral-500`}>{fmt(item.handledAt)}</td>
                          <td className={`${TD_CLS}`} onClick={(e) => e.stopPropagation()}>
                            <div className="flex items-center gap-1.5">
                              {canRetry(item) && (
                                <button
                                  type="button"
                                  disabled={actionBusy}
                                  onClick={() => void handleRetry(item)}
                                  className="inline-flex h-7 items-center gap-1 rounded-lg border border-primary-600/30 px-2.5 text-[12px] font-bold text-primary-700 hover:bg-primary-50 disabled:opacity-50"
                                  title="重新排队导出"
                                >
                                  <RotateCcwIcon className="h-3 w-3" aria-hidden="true" />
                                  重试
                                </button>
                              )}
                              {canReject(item) && (
                                <button
                                  type="button"
                                  disabled={actionBusy}
                                  onClick={() => setRejectTarget(item)}
                                  className="inline-flex h-7 items-center gap-1 rounded-lg border border-error/30 px-2.5 text-[12px] font-bold text-error-fg hover:bg-error-bg disabled:opacity-50"
                                  title="拒绝此工单"
                                >
                                  <XCircleIcon className="h-3 w-3" aria-hidden="true" />
                                  拒绝
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* 游标分页 */}
            <div className="flex items-center justify-between px-5 pb-4 pt-3.5 text-[12.5px] text-neutral-500">
              <span>当前页 {(items ?? []).length} 条</span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  disabled={cursorStack.length === 0}
                  onClick={goPrev}
                  className="grid h-7 min-w-7 place-items-center rounded-lg border border-neutral-900/10 bg-surface px-2 text-[12.5px] font-bold text-neutral-700 transition-colors hover:border-primary-600/40 disabled:opacity-40"
                >
                  ‹
                </button>
                <button
                  type="button"
                  disabled={!nextCursor}
                  onClick={goNext}
                  className="grid h-7 min-w-7 place-items-center rounded-lg border border-neutral-900/10 bg-surface px-2 text-[12.5px] font-bold text-neutral-700 transition-colors hover:border-primary-600/40 disabled:opacity-40"
                >
                  ›
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      {/* 详情抽屉 */}
      <Drawer
        open={detail !== null}
        onClose={() => setDetail(null)}
        title={detail ? `工单详情 · ${detail.id.slice(0, 12)}…` : '工单详情'}
        size="md"
      >
        {detail && (
          <>
            <div className="grid grid-cols-2 gap-x-4 gap-y-3">
              <Info label="工单 ID" value={detail.id} />
              <Info label="请求类型" value={TYPE_MAP[detail.requestType] ?? detail.requestType} />
              <Info label="当前状态" value={STATUS_MAP[detail.status]?.label ?? detail.status} />
              <Info label="失败码" value={detail.failureCode ?? '—'} />
              <Info label="会员手机（掩码）" value={detail.phoneMasked} />
              <Info label="会员昵称" value={detail.nickname ?? '—'} />
              <Info label="重试次数" value={String(detail.retryCount)} />
              <Info label="执行步骤" value={detail.executionStep ?? '—'} />
              <Info label="请求时间" value={fmt(detail.requestedAt)} />
              <Info label="最后尝试" value={fmt(detail.lastAttemptAt)} />
              <Info label="处理时间" value={fmt(detail.handledAt)} />
              <Info label="处理人" value={detail.handledBy ?? '—'} />
              <Info label="审计引用" value={detail.auditRef ?? '—'} />
              <Info label="导出过期时间" value={fmt(detail.exportExpiresAt)} />
            </div>

            {/* 操作区 */}
            {(canRetry(detail) || canReject(detail)) && (
              <div className="mt-5 border-t border-neutral-900/[0.06] pt-4">
                <p className="mb-3 text-[12.5px] font-bold text-neutral-600">管理员操作</p>
                <div className="flex gap-2.5">
                  {canRetry(detail) && (
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() => { void handleRetry(detail) }}
                      className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-primary-600/30 bg-primary-50 px-4 text-[13px] font-bold text-primary-700 hover:bg-primary-100 disabled:opacity-50"
                    >
                      <RotateCcwIcon className="h-3.5 w-3.5" aria-hidden="true" />
                      {actionBusy ? '处理中…' : '重新排队'}
                    </button>
                  )}
                  {canReject(detail) && (
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() => { setRejectTarget(detail); setDetail(null) }}
                      className="inline-flex h-9 items-center gap-1.5 rounded-[9px] border border-error/30 bg-error-bg px-4 text-[13px] font-bold text-error-fg hover:opacity-90 disabled:opacity-50"
                    >
                      <XCircleIcon className="h-3.5 w-3.5" aria-hidden="true" />
                      拒绝工单
                    </button>
                  )}
                </div>
              </div>
            )}

            {detail.requestType === 'delete' && (
              <div className="mt-4 rounded-[9px] border border-warning/30 bg-warning-bg px-4 py-2.5 text-[12.5px] text-warning-fg">
                账号注销请求暂不开放操作（法务矩阵尚未签字）。如需处理，请联系法务团队后在后台手动操作。
              </div>
            )}
          </>
        )}
      </Drawer>

      {/* 拒绝对话框 */}
      <RejectDialog
        open={rejectTarget !== null}
        onClose={() => setRejectTarget(null)}
        onConfirm={(reason) => void handleRejectConfirm(reason)}
        busy={actionBusy}
      />

      <p className="mt-3 text-xs text-neutral-500">
        管理员操作（重试 / 拒绝）均写入 AuditLog，可在日志审计页查看。
        手机号以掩码形式展示，完整号码不在此页回显。
      </p>
    </Page>
  )
}
