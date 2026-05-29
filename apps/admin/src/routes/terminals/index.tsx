import { useState } from 'react'
import { Card, StatusBadge, EmptyState } from '@ai-job-print/ui'
import { MonitorIcon } from 'lucide-react'
import { Pagination, useTableState } from '../components/DataTable'

// ─── Types & mock ─────────────────────────────────────────────────────────────

type OnlineStatus = 'online' | 'offline' | 'maintenance'

interface Terminal {
  id: string
  sn: string
  location: string
  org: string
  status: OnlineStatus
  network: '正常' | '弱' | '断线'
  screen: '正常' | '异常' | '休眠'
  version: string
  lastHeartbeat: string
  printer: string
}

const MOCK_TERMINALS: Terminal[] = [
  { id: 't1', sn: 'KSK-001', location: 'A区大厅服务台',     org: '市就业服务中心',     status: 'online',       network: '正常', screen: '正常', version: 'v1.2.3', lastHeartbeat: '刚刚',      printer: 'Pantum-CM2820-001' },
  { id: 't2', sn: 'KSK-002', location: 'B区一楼入口',       org: '市人才交流中心',     status: 'online',       network: '正常', screen: '休眠', version: 'v1.2.3', lastHeartbeat: '2分钟前',   printer: 'Pantum-CM2820-002' },
  { id: 't3', sn: 'KSK-003', location: 'B区服务台旁',       org: '市人才交流中心',     status: 'online',       network: '弱',   screen: '正常', version: 'v1.2.1', lastHeartbeat: '1分钟前',   printer: 'Pantum-CM2820-003' },
  { id: 't4', sn: 'KSK-004', location: 'C区高校就业中心',   org: '某大学就业指导中心', status: 'online',       network: '正常', screen: '正常', version: 'v1.2.3', lastHeartbeat: '刚刚',      printer: 'Pantum-CM2820-004' },
  { id: 't5', sn: 'KSK-005', location: 'D区社区服务站',     org: '某社区服务中心',     status: 'online',       network: '正常', screen: '正常', version: 'v1.2.2', lastHeartbeat: '3分钟前',   printer: 'Pantum-CM2820-005' },
  { id: 't6', sn: 'KSK-006', location: 'E区政务大厅',       org: '市行政服务中心',     status: 'online',       network: '正常', screen: '正常', version: 'v1.2.3', lastHeartbeat: '刚刚',      printer: 'Pantum-CM2820-006' },
  { id: 't7', sn: 'KSK-007', location: 'C区入口处',         org: '某大学就业指导中心', status: 'offline',      network: '断线', screen: '异常', version: 'v1.2.0', lastHeartbeat: '2小时前',   printer: 'Pantum-CM2820-007' },
  { id: 't8', sn: 'KSK-008', location: 'F区科技园服务站',   org: '市就业服务中心',     status: 'online',       network: '正常', screen: '正常', version: 'v1.2.3', lastHeartbeat: '刚刚',      printer: 'Pantum-CM2820-008' },
  { id: 't9', sn: 'KSK-009', location: 'G区创业孵化基地',   org: '市创业服务中心',     status: 'offline',      network: '断线', screen: '异常', version: 'v1.1.9', lastHeartbeat: '5小时前',   printer: 'Pantum-CM2820-009' },
  { id: 't10',sn: 'KSK-010', location: 'H区人社局一楼大厅', org: '市人力资源和社会保障局', status: 'maintenance', network: '正常', screen: '正常', version: 'v1.2.3', lastHeartbeat: '10分钟前', printer: 'Pantum-CM2820-010' },
]

const STATUS_MAP: Record<OnlineStatus, { badge: 'success' | 'error' | 'warning'; label: string }> = {
  online:      { badge: 'success', label: '在线' },
  offline:     { badge: 'error',   label: '离线' },
  maintenance: { badge: 'warning', label: '维护中' },
}

const FILTERS = ['全部', '在线', '离线', '维护中'] as const
const FILTER_STATUS: Record<string, OnlineStatus | null> = { 全部: null, 在线: 'online', 离线: 'offline', '维护中': 'maintenance' }

// ─── Component ────────────────────────────────────────────────────────────────

export default function TerminalsPage() {
  const [terminals, setTerminals] = useState(MOCK_TERMINALS)
  const [filter, setFilter] = useState<string>('全部')
  const { page, pageSize, search, setPage, setPageSize, setSearch } = useTableState(20)

  const filtered = filter === '全部'
    ? terminals
    : terminals.filter((t) => t.status === FILTER_STATUS[filter])

  const searched = search.trim()
    ? filtered.filter((t) =>
        t.sn.toLowerCase().includes(search.toLowerCase()) ||
        t.location.includes(search) ||
        t.org.includes(search)
      )
    : filtered

  const total = searched.length
  const paginated = searched.slice((page - 1) * pageSize, page * pageSize)

  const counts = {
    全部: terminals.length,
    在线: terminals.filter((t) => t.status === 'online').length,
    离线: terminals.filter((t) => t.status === 'offline').length,
    '维护中': terminals.filter((t) => t.status === 'maintenance').length,
  }

  const markMaintenance = (id: string) => {
    setTerminals((prev) => prev.map((t) => t.id === id ? { ...t, status: 'maintenance' as const } : t))
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-gray-500">共 {total} 台终端</p>
        <div className="relative">
          <input type="text" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索终端编号、地点、机构..." className="h-8 w-72 rounded-lg border border-gray-200 bg-white pl-8 pr-3 text-xs text-gray-700 placeholder-gray-400 focus:border-primary-300 focus:outline-none focus:ring-1 focus:ring-primary-200" />
          <svg className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 19a8 8 0 100-16 8 8 0 000 16z" /></svg>
        </div>
      </div>

      {/* 筛选标签 */}
      <div className="mb-4 flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => { setFilter(f); setPage(1) }}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition-colors ${
              filter === f ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {f}
            <span className="ml-1.5 text-xs opacity-70">{counts[f]}</span>
          </button>
        ))}
      </div>

      {/* 表格 */}
      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50">
              <tr>
                {['终端编号', '安装地点', '所属机构', '状态', '网络', '屏幕', '系统版本', '最近心跳', '绑定打印机', '操作'].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {paginated.length === 0 ? (
                <tr>
                  <td colSpan={10}>
                    <EmptyState title={search ? '未找到匹配的终端' : '该分类暂无终端'} description={search ? '请尝试其他关键词' : undefined} icon={MonitorIcon} className="py-12" />
                  </td>
                </tr>
              ) : (
                paginated.map((t) => {
                  const s = STATUS_MAP[t.status]
                  return (
                    <tr key={t.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-700">{t.sn}</td>
                      <td className="px-4 py-3 text-gray-800">{t.location}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-gray-600">{t.org}</td>
                      <td className="px-4 py-3">
                        <StatusBadge status={s.badge} label={s.label} />
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium ${t.network === '断线' ? 'text-red-500' : t.network === '弱' ? 'text-orange-500' : 'text-green-600'}`}>
                          {t.network}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs ${t.screen === '异常' ? 'text-red-500' : 'text-gray-600'}`}>
                          {t.screen}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">{t.version}</td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">{t.lastHeartbeat}</td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-500">{t.printer}</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex gap-2">
                          <button className="rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50">查看详情</button>
                          {t.status !== 'maintenance' && (
                            <button
                              className="rounded px-2 py-1 text-xs font-medium text-orange-500 hover:bg-orange-50"
                              onClick={() => markMaintenance(t.id)}
                            >
                              标记维护
                            </button>
                          )}
                          <button className="rounded px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100">查看日志</button>
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

      <p className="mt-3 text-xs text-gray-400">
        终端数据由 Windows Terminal Agent 实时上报，当前为 mock 数据
      </p>
    </>
  )
}
