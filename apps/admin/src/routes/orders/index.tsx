import { useCallback, useEffect, useState } from 'react'
import { Card, EmptyState, ErrorState, LoadingState, StatusBadge } from '@ai-job-print/ui'
import { Page } from '../Page'
import { PackageIcon, RefreshCwIcon } from 'lucide-react'
import { adminOpsService, type AdminPrintTaskItem } from '../../services/api/adminOps'

// ─── Display maps ─────────────────────────────────────────────────────────────

const STATUS_MAP: Record<string, { badge: 'success' | 'error' | 'warning' | 'info' | 'default'; label: string }> = {
  pending:   { badge: 'warning', label: '待领取' },
  claimed:   { badge: 'info',    label: '已领取' },
  printing:  { badge: 'info',    label: '打印中' },
  completed: { badge: 'success', label: '已完成' },
  failed:    { badge: 'error',   label: '失败' },
}

const STATUS_FILTERS = [
  { label: '全部', value: '' },
  { label: '待领取', value: 'pending' },
  { label: '已领取', value: 'claimed' },
  { label: '打印中', value: 'printing' },
  { label: '已完成', value: 'completed' },
  { label: '失败', value: 'failed' },
] as const

const COLOR_LABELS: Record<string, string> = { black_white: '黑白', color: '彩色' }
const OWNER_LABELS: Record<string, string> = { member: '会员', anonymous: '匿名' }

function fmt(iso: string | null): string {
  return iso ? iso.slice(0, 16).replace('T', ' ') : '—'
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function OrdersPage() {
  const [items, setItems] = useState<AdminPrintTaskItem[]>([])
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [totalPages, setTotalPages] = useState(1)
  const pageSize = 20

  const load = useCallback(async () => {
    setState('loading')
    try {
      const res = await adminOpsService.listPrintTasks({ status: statusFilter || undefined, page, pageSize })
      setItems(res.data)
      setTotal(res.pagination.total)
      setTotalPages(res.pagination.totalPages)
      setState('ready')
    } catch {
      setState('error')
    }
  }, [statusFilter, page])

  useEffect(() => { void load() }, [load])

  return (
    <Page
      title="订单管理"
      subtitle={`打印任务流水 — 共 ${total} 条`}
      actions={
        <button
          onClick={() => void load()}
          className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
        >
          <RefreshCwIcon className="h-4 w-4" />
          刷新
        </button>
      }
    >
      {/* 诚实说明:支付域未上线 */}
      <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-2.5 text-sm text-blue-700">
        当前展示真实打印任务流水(安全元数据)。支付 / 退款 / 对账域(Phase C-5 订单支付域)尚未上线,故不展示金额与支付状态,不编造演示数据。
      </div>

      {/* 状态筛选 */}
      <div className="mb-4 flex gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.label}
            onClick={() => { setStatusFilter(f.value); setPage(1) }}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              statusFilter === f.value ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {state === 'loading' && <LoadingState className="py-24" />}
      {state === 'error' && <ErrorState className="py-24" onRetry={() => void load()} />}

      {state === 'ready' && (
        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-100 bg-gray-50">
                <tr>
                  {['任务号', '文件名', '终端', '参数', '归属', '状态', '错误码', '创建时间', '完成时间'].map((h) => (
                    <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.length === 0 ? (
                  <tr>
                    <td colSpan={9}>
                      <EmptyState title="暂无打印任务" description="一体机发起打印后,任务会出现在这里" icon={PackageIcon} className="py-12" />
                    </td>
                  </tr>
                ) : (
                  items.map((t) => {
                    const status = STATUS_MAP[t.status] ?? { badge: 'default' as const, label: t.status }
                    return (
                      <tr key={t.id} className="hover:bg-gray-50">
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-400">{t.id.slice(0, 12)}…</td>
                        <td className="max-w-56 truncate px-4 py-3 font-medium text-gray-800">{t.fileName ?? '未记录'}</td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-500">{t.terminalCode ?? '—'}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-600">
                          {[
                            t.copies !== null ? `${t.copies} 份` : null,
                            t.colorMode ? COLOR_LABELS[t.colorMode] : null,
                            t.paperSize,
                          ].filter(Boolean).join(' · ') || '—'}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">{OWNER_LABELS[t.ownerType]}</td>
                        <td className="px-4 py-3"><StatusBadge status={status.badge} label={status.label} /></td>
                        <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-red-400">{t.errorCode ?? '—'}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-400">{fmt(t.createdAt)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-400">{fmt(t.completedAt)}</td>
                      </tr>
                    )
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* 服务端分页 */}
          <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3">
            <p className="text-xs text-gray-400">第 {page} / {totalPages} 页 · 共 {total} 条</p>
            <div className="flex gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              >
                上一页
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-40"
              >
                下一页
              </button>
            </div>
          </div>
        </Card>
      )}

      <p className="mt-3 text-xs text-gray-400">
        仅展示安全元数据:不含文件链接、文件指纹与个人身份信息;归属仅区分 会员/匿名。文件内容访问走文件管理并记录审计。
      </p>
    </Page>
  )
}
