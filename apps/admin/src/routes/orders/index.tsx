import { useState } from 'react'
import { Button, Card, StatusBadge, EmptyState } from '@ai-job-print/ui'
import { Page } from '../Page'
import { DownloadIcon, PackageIcon } from 'lucide-react'
import { Pagination, useTableState } from '../components/DataTable'

// ─── Types & mock ─────────────────────────────────────────────────────────────

type OrderType = 'print' | 'scan' | 'photo' | 'ai'
type PayStatus = 'paid' | 'pending' | 'refunded' | 'failed'
type TaskStatus = 'done' | 'processing' | 'failed' | 'cancelled'

interface Order {
  id: string
  no: string
  type: OrderType
  user: string
  terminal: string
  amount: number
  payStatus: PayStatus
  taskStatus: TaskStatus
  createdAt: string
}

const MOCK_ORDERS: Order[] = [
  { id: 'o1',  no: 'ORD-20260525-0047', type: 'print',  user: '游客-A3F2',  terminal: 'KSK-001', amount: 2.50,  payStatus: 'paid',     taskStatus: 'done',       createdAt: '2026-05-25 09:12' },
  { id: 'o2',  no: 'ORD-20260525-0046', type: 'ai',     user: '游客-B7C1',  terminal: 'KSK-004', amount: 5.00,  payStatus: 'paid',     taskStatus: 'done',       createdAt: '2026-05-25 09:08' },
  { id: 'o3',  no: 'ORD-20260525-0045', type: 'scan',   user: '游客-D9E4',  terminal: 'KSK-002', amount: 1.00,  payStatus: 'paid',     taskStatus: 'done',       createdAt: '2026-05-25 08:55' },
  { id: 'o4',  no: 'ORD-20260525-0044', type: 'print',  user: '游客-F2G8',  terminal: 'KSK-006', amount: 3.00,  payStatus: 'paid',     taskStatus: 'failed',     createdAt: '2026-05-25 08:43' },
  { id: 'o5',  no: 'ORD-20260525-0043', type: 'photo',  user: '游客-H5I0',  terminal: 'KSK-003', amount: 8.00,  payStatus: 'paid',     taskStatus: 'done',       createdAt: '2026-05-25 08:31' },
  { id: 'o6',  no: 'ORD-20260525-0042', type: 'ai',     user: '游客-J1K3',  terminal: 'KSK-001', amount: 5.00,  payStatus: 'refunded', taskStatus: 'cancelled',  createdAt: '2026-05-25 08:20' },
  { id: 'o7',  no: 'ORD-20260524-0089', type: 'print',  user: '游客-L6M9',  terminal: 'KSK-005', amount: 1.50,  payStatus: 'paid',     taskStatus: 'done',       createdAt: '2026-05-24 17:45' },
  { id: 'o8',  no: 'ORD-20260524-0088', type: 'scan',   user: '游客-N4O7',  terminal: 'KSK-008', amount: 1.00,  payStatus: 'paid',     taskStatus: 'done',       createdAt: '2026-05-24 17:32' },
  { id: 'o9',  no: 'ORD-20260524-0087', type: 'print',  user: '游客-P2Q5',  terminal: 'KSK-004', amount: 4.00,  payStatus: 'pending',  taskStatus: 'processing', createdAt: '2026-05-24 17:18' },
  { id: 'o10', no: 'ORD-20260524-0086', type: 'ai',     user: '游客-R8S3',  terminal: 'KSK-006', amount: 5.00,  payStatus: 'paid',     taskStatus: 'done',       createdAt: '2026-05-24 16:59' },
]

const TYPE_LABELS: Record<OrderType, string> = { print: '打印', scan: '扫描', photo: '证件照', ai: 'AI简历' }
const TYPE_STYLES: Record<OrderType, string> = {
  print: 'bg-blue-50 text-blue-600',
  scan:  'bg-purple-50 text-purple-600',
  photo: 'bg-green-50 text-green-600',
  ai:    'bg-orange-50 text-orange-600',
}

const PAY_MAP: Record<PayStatus, { badge: 'success' | 'error' | 'warning' | 'default'; label: string }> = {
  paid:     { badge: 'success', label: '已支付' },
  pending:  { badge: 'warning', label: '待支付' },
  refunded: { badge: 'default', label: '已退款' },
  failed:   { badge: 'error',   label: '支付失败' },
}

const TASK_MAP: Record<TaskStatus, { badge: 'success' | 'error' | 'warning' | 'default' | 'info'; label: string }> = {
  done:       { badge: 'success', label: '已完成' },
  processing: { badge: 'info',    label: '处理中' },
  failed:     { badge: 'error',   label: '失败' },
  cancelled:  { badge: 'default', label: '已取消' },
}

const TYPE_FILTERS = ['全部', '打印', '扫描', '证件照', 'AI简历'] as const
const TYPE_FILTER_MAP: Record<string, OrderType | null> = { 全部: null, 打印: 'print', 扫描: 'scan', 证件照: 'photo', 'AI简历': 'ai' }

// ─── Component ────────────────────────────────────────────────────────────────

export default function OrdersPage() {
  const [orders, setOrders] = useState(MOCK_ORDERS)
  const [typeFilter, setTypeFilter] = useState('全部')
  const { page, pageSize, search, setPage, setPageSize, setSearch } = useTableState(20)

  const filtered = typeFilter === '全部'
    ? orders
    : orders.filter((o) => o.type === TYPE_FILTER_MAP[typeFilter])

  const searched = search.trim()
    ? filtered.filter((o) =>
        o.no.toLowerCase().includes(search.toLowerCase()) ||
        o.user.includes(search)
      )
    : filtered

  const total = searched.length
  const paginated = searched.slice((page - 1) * pageSize, page * pageSize)

  const handleRefund = (id: string) => {
    setOrders((prev) => prev.map((o) =>
      o.id === id ? { ...o, payStatus: 'refunded' as const, taskStatus: 'cancelled' as const } : o
    ))
  }

  return (
    <Page
      title="订单管理"
      subtitle="打印/扫描/证件照/AI简历订单"
      actions={
        <Button size="sm" variant="outline" className="flex items-center gap-1.5">
          <DownloadIcon className="h-4 w-4" />
          导出
        </Button>
      }
    >
      {/* 筛选 + 汇总 */}
      <div className="mb-4 flex items-center justify-between gap-4">
        <div className="flex gap-2">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => { setTypeFilter(f); setPage(1) }}
              className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                typeFilter === f ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索订单号、用户..." className="h-8 w-56 rounded-lg border border-gray-200 bg-white pl-8 pr-3 text-xs text-gray-700 placeholder-gray-400 focus:border-primary-300 focus:outline-none focus:ring-1 focus:ring-primary-200" />
          <span className="text-sm text-gray-500">
            已付款合计：<span className="font-semibold text-gray-900">¥{paginated.filter((o) => o.payStatus === 'paid').reduce((s, o) => s + o.amount, 0).toFixed(2)}</span>
          </span>
        </div>
      </div>

      {/* 表格 */}
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50">
              <tr>
                {['订单号', '类型', '用户', '终端', '金额', '支付状态', '任务状态', '创建时间', '操作'].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={9}>
                    <EmptyState title={search ? '未找到匹配的订单' : '暂无订单数据'} description={search ? '请尝试其他关键词' : undefined} icon={PackageIcon} className="py-12" />
                  </td>
                </tr>
              ) : (
                paginated.map((o) => {
                const pay = PAY_MAP[o.payStatus]
                const task = TASK_MAP[o.taskStatus]
                return (
                  <tr key={o.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-600">{o.no}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded px-2 py-0.5 text-xs font-medium ${TYPE_STYLES[o.type]}`}>
                        {TYPE_LABELS[o.type]}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-gray-700">{o.user}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-500">{o.terminal}</td>
                    <td className="px-4 py-3 font-medium text-gray-900">¥{o.amount.toFixed(2)}</td>
                    <td className="px-4 py-3"><StatusBadge status={pay.badge} label={pay.label} /></td>
                    <td className="px-4 py-3"><StatusBadge status={task.badge} label={task.label} /></td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">{o.createdAt}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex gap-2">
                        <button className="rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50">查看详情</button>
                        {o.payStatus === 'paid' && o.taskStatus !== 'processing' && (
                          <button
                            className="rounded px-2 py-1 text-xs font-medium text-orange-500 hover:bg-orange-50"
                            onClick={() => handleRefund(o.id)}
                          >
                            退款
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
        <Pagination total={total} page={page} pageSize={pageSize} onPageChange={setPage} onPageSizeChange={(s) => { setPageSize(s); setPage(1) }} />
      </Card>
      <p className="mt-3 text-xs text-gray-400">当前为 mock 数据，接入后端后实时显示</p>
    </Page>
  )
}
