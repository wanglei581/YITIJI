import { useState } from 'react'
import { Card, StatusBadge, EmptyState } from '@ai-job-print/ui'
import { Page } from '../Page'
import { AlertTriangleIcon } from 'lucide-react'
import { Pagination, useTableState } from '../components/DataTable'

// ─── Types & mock ─────────────────────────────────────────────────────────────

type AlertLevel  = 'info' | 'warning' | 'critical'
type AlertStatus = 'pending' | 'handling' | 'resolved'
type AlertType   =
  | 'device-offline'
  | 'printer-fault'
  | 'paper-jam'
  | 'paper-empty'
  | 'toner-low'
  | 'ai-call-fail'
  | 'payment-anomaly'
  | 'file-clean-fail'
  | 'sync-fail'

interface Alert {
  id: string
  no: string
  type: AlertType
  level: AlertLevel
  terminal: string
  device: string
  message: string
  occurredAt: string
  handler: string | null
  status: AlertStatus
}

const MOCK_ALERTS: Alert[] = [
  { id: 'a1',  no: 'ALT-20260525-0012', type: 'printer-fault',   level: 'critical', terminal: 'KSK-008', device: 'Pantum-CM2820-008', message: '卡纸故障，打印任务队列阻塞，需人工处理',              occurredAt: '2026-05-25 09:45', handler: null,      status: 'pending'  },
  { id: 'a2',  no: 'ALT-20260525-0011', type: 'device-offline',  level: 'critical', terminal: 'KSK-007', device: 'KSK-007 主机',        message: '终端心跳超时，已离线超过 2 小时，影响正常服务',     occurredAt: '2026-05-25 07:30', handler: '张运维',   status: 'handling' },
  { id: 'a3',  no: 'ALT-20260525-0010', type: 'toner-low',       level: 'warning',  terminal: 'KSK-003', device: 'Pantum-CM2820-003', message: '碳粉余量低于 10%（当前 8%），建议尽快更换',         occurredAt: '2026-05-25 08:12', handler: null,      status: 'pending'  },
  { id: 'a4',  no: 'ALT-20260525-0009', type: 'paper-empty',     level: 'warning',  terminal: 'KSK-005', device: 'Pantum-CM2820-005', message: '纸盒已空，无法执行打印任务',                        occurredAt: '2026-05-25 08:05', handler: '李运维',   status: 'handling' },
  { id: 'a5',  no: 'ALT-20260525-0008', type: 'payment-anomaly', level: 'warning',  terminal: 'KSK-001', device: '支付终端',             message: '订单 ORD-20260525-0042 支付回调超时，状态异常',    occurredAt: '2026-05-25 08:20', handler: null,      status: 'pending'  },
  { id: 'a6',  no: 'ALT-20260525-0007', type: 'ai-call-fail',    level: 'warning',  terminal: 'KSK-004', device: 'AI服务',              message: 'AI简历解析接口响应超时（>30s），任务已进入重试队列', occurredAt: '2026-05-25 07:58', handler: null,      status: 'pending'  },
  { id: 'a7',  no: 'ALT-20260524-0031', type: 'device-offline',  level: 'critical', terminal: 'KSK-009', device: 'KSK-009 主机',        message: '终端离线超过 5 小时，网络断线，需现场检查',         occurredAt: '2026-05-24 04:20', handler: '张运维',   status: 'resolved' },
  { id: 'a8',  no: 'ALT-20260524-0028', type: 'sync-fail',       level: 'info',     terminal: '—',       device: '数据同步服务',         message: '市人才网岗位数据同步失败，接口返回 503，已重试 3 次', occurredAt: '2026-05-24 06:00', handler: '系统自动', status: 'resolved' },
  { id: 'a9',  no: 'ALT-20260524-0025', type: 'paper-jam',       level: 'warning',  terminal: 'KSK-002', device: 'Pantum-CM2820-002', message: '检测到卡纸，已自动暂停打印队列',                    occurredAt: '2026-05-24 14:33', handler: '李运维',   status: 'resolved' },
  { id: 'a10', no: 'ALT-20260524-0020', type: 'file-clean-fail', level: 'info',     terminal: '—',       device: '文件清理服务',         message: '定时清理任务执行失败，目标文件被占用，将在下次重试', occurredAt: '2026-05-24 03:00', handler: '系统自动', status: 'resolved' },
]

const ALERT_TYPE_LABELS: Record<AlertType, string> = {
  'device-offline':  '设备离线',
  'printer-fault':   '打印机故障',
  'paper-jam':       '卡纸',
  'paper-empty':     '缺纸',
  'toner-low':       '碳粉低余量',
  'ai-call-fail':    'AI调用失败',
  'payment-anomaly': '支付异常',
  'file-clean-fail': '文件清理失败',
  'sync-fail':       '数据同步失败',
}

const LEVEL_MAP: Record<AlertLevel, { badge: 'info' | 'warning' | 'error'; label: string; dot: string }> = {
  info:     { badge: 'info',    label: '提醒', dot: 'bg-blue-400'   },
  warning:  { badge: 'warning', label: '警告', dot: 'bg-orange-400' },
  critical: { badge: 'error',   label: '严重', dot: 'bg-red-500'    },
}

const STATUS_MAP: Record<AlertStatus, { badge: 'warning' | 'info' | 'success'; label: string }> = {
  pending:  { badge: 'warning', label: '待处理' },
  handling: { badge: 'info',    label: '处理中' },
  resolved: { badge: 'success', label: '已解决' },
}

const LEVEL_FILTERS  = ['全部', '严重', '警告', '提醒'] as const
const STATUS_FILTERS = ['全部', '待处理', '处理中', '已解决'] as const
const LEVEL_FILTER_MAP:  Record<string, AlertLevel  | null> = { 全部: null, 严重: 'critical', 警告: 'warning', 提醒: 'info' }
const STATUS_FILTER_MAP: Record<string, AlertStatus | null> = { 全部: null, 待处理: 'pending', 处理中: 'handling', 已解决: 'resolved' }

// ─── Component ────────────────────────────────────────────────────────────────

export default function AlertsPage() {
  const [alerts, setAlerts] = useState(MOCK_ALERTS)
  const [levelFilter,  setLevelFilter]  = useState('全部')
  const [statusFilter, setStatusFilter] = useState('全部')
  const { page, pageSize, search, setPage, setPageSize, setSearch } = useTableState(20)

  const filtered = alerts.filter((a) => {
    const matchLevel  = levelFilter  === '全部' || a.level  === LEVEL_FILTER_MAP[levelFilter]
    const matchStatus = statusFilter === '全部' || a.status === STATUS_FILTER_MAP[statusFilter]
    return matchLevel && matchStatus
  })

  const searched = search.trim()
    ? filtered.filter((a) =>
        a.no.includes(search) ||
        a.message.includes(search) ||
        a.device.includes(search)
      )
    : filtered

  const total = searched.length
  const paginated = searched.slice((page - 1) * pageSize, page * pageSize)

  const levelCounts = {
    全部: alerts.length,
    严重: alerts.filter((a) => a.level === 'critical').length,
    警告: alerts.filter((a) => a.level === 'warning').length,
    提醒: alerts.filter((a) => a.level === 'info').length,
  }

  const statusCounts = {
    全部:   alerts.length,
    待处理: alerts.filter((a) => a.status === 'pending').length,
    处理中: alerts.filter((a) => a.status === 'handling').length,
    已解决: alerts.filter((a) => a.status === 'resolved').length,
  }

  const markHandling = (id: string) => {
    setAlerts((prev) => prev.map((a) =>
      a.id === id ? { ...a, status: 'handling' as const, handler: '当前管理员' } : a
    ))
  }

  const markResolved = (id: string) => {
    setAlerts((prev) => prev.map((a) =>
      a.id === id ? { ...a, status: 'resolved' as const, handler: a.handler ?? '当前管理员' } : a
    ))
  }

  const pendingCount = alerts.filter((a) => a.status === 'pending').length

  return (
    <Page
      title="告警中心"
      subtitle={pendingCount > 0 ? `${pendingCount} 条待处理告警` : '全部告警已处理'}
    >
      {/* 双行筛选 */}
      <div className="mb-4 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400 w-10">级别</span>
          <div className="flex gap-2">
            {LEVEL_FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => { setLevelFilter(f); setPage(1) }}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                  levelFilter === f ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {f}
                <span className="ml-1.5 text-xs opacity-70">{levelCounts[f]}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-gray-400 w-10">状态</span>
          <div className="flex gap-2">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => { setStatusFilter(f); setPage(1) }}
                className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
                  statusFilter === f ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {f}
                {f !== '全部' && <span className="ml-1.5 text-xs opacity-70">{statusCounts[f]}</span>}
              </button>
            ))}
          </div>
        </div>
        <div className="relative">
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索告警编号..." className="h-8 w-48 rounded-lg border border-gray-200 bg-white pl-8 pr-3 text-xs text-gray-700 placeholder-gray-400 focus:border-primary-300 focus:outline-none focus:ring-1 focus:ring-primary-200" />
          <svg className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" /></svg>
        </div>
      </div>

      {/* 表格 */}
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50">
              <tr>
                {['', '告警编号', '类型', '级别', '关联终端', '关联设备', '告警内容', '发生时间', '处理人', '状态', '操作'].map((h, i) => (
                  <th key={i} className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={11}>
                    <EmptyState title={search ? '未找到匹配的告警' : '当前筛选条件下无告警'} description={search ? '请尝试其他关键词' : undefined} icon={AlertTriangleIcon} className="py-12" />
                  </td>
                </tr>
              ) : (
                paginated.map((a) => {
                  const lv = LEVEL_MAP[a.level]
                  const st = STATUS_MAP[a.status]
                  return (
                    <tr key={a.id} className="hover:bg-gray-50">
                      <td className="pl-4 py-3">
                        <span className={`inline-block h-2 w-2 rounded-full ${lv.dot}`} />
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-500">{a.no}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-700">{ALERT_TYPE_LABELS[a.type]}</td>
                      <td className="px-4 py-3"><StatusBadge status={lv.badge} label={lv.label} /></td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-600">{a.terminal}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-600">{a.device}</td>
                      <td className="px-4 py-3 text-xs text-gray-700 max-w-xs">
                        <span className="line-clamp-2">{a.message}</span>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">{a.occurredAt}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">
                        {a.handler ?? <span className="text-gray-300">未分配</span>}
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={st.badge} label={st.label} /></td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex gap-2">
                          <button className="rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50">查看详情</button>
                          {a.status === 'pending' && (
                            <button
                              className="rounded px-2 py-1 text-xs font-medium text-blue-500 hover:bg-blue-50"
                              onClick={() => markHandling(a.id)}
                            >
                              标记处理中
                            </button>
                          )}
                          {(a.status === 'pending' || a.status === 'handling') && (
                            <button
                              className="rounded px-2 py-1 text-xs font-medium text-green-600 hover:bg-green-50"
                              onClick={() => markResolved(a.id)}
                            >
                              标记已解决
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

      <p className="mt-3 text-xs text-gray-400">当前为 mock 数据，接入 Terminal Agent 后实时推送告警</p>
    </Page>
  )
}
