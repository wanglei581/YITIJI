import { useState } from 'react'
import { Card, StatusBadge } from '@ai-job-print/ui'
import { PrinterIcon } from 'lucide-react'

// ─── Types & mock ─────────────────────────────────────────────────────────────

type PrinterStatus = 'online' | 'offline' | 'error'
type TonerLevel = 'normal' | 'low' | 'critical'
type PaperStatus = 'normal' | 'low' | 'empty' | 'jam'

interface Printer {
  id: string
  name: string
  model: string
  sn: string
  terminal: string
  location: string
  status: PrinterStatus
  currentTask: string | null
  toner: { level: number; status: TonerLevel }
  paper: { tray1: number; status: PaperStatus }
  fault: string | null
  lastSync: string
}

const MOCK_PRINTERS: Printer[] = [
  {
    id: 'p1', name: 'KSK-001 打印机', model: 'Pantum CM2800ADN Series', sn: 'PT-CM2820-001',
    terminal: 'KSK-001', location: 'A区大厅服务台',
    status: 'online', currentTask: '任务 #2847（打印中）',
    toner: { level: 78, status: 'normal' }, paper: { tray1: 350, status: 'normal' },
    fault: null, lastSync: '刚刚',
  },
  {
    id: 'p2', name: 'KSK-002 打印机', model: 'Pantum CM2800ADN Series', sn: 'PT-CM2820-002',
    terminal: 'KSK-002', location: 'B区一楼入口',
    status: 'online', currentTask: null,
    toner: { level: 45, status: 'normal' }, paper: { tray1: 120, status: 'low' },
    fault: null, lastSync: '2分钟前',
  },
  {
    id: 'p3', name: 'KSK-003 打印机', model: 'Pantum CM2800ADN Series', sn: 'PT-CM2820-003',
    terminal: 'KSK-003', location: 'B区服务台旁',
    status: 'online', currentTask: null,
    toner: { level: 8, status: 'critical' }, paper: { tray1: 200, status: 'normal' },
    fault: '碳粉余量严重不足，请及时更换', lastSync: '1分钟前',
  },
  {
    id: 'p4', name: 'KSK-004 打印机', model: 'Pantum CM2800ADN Series', sn: 'PT-CM2820-004',
    terminal: 'KSK-004', location: 'C区高校就业中心',
    status: 'online', currentTask: null,
    toner: { level: 92, status: 'normal' }, paper: { tray1: 500, status: 'normal' },
    fault: null, lastSync: '刚刚',
  },
  {
    id: 'p5', name: 'KSK-005 打印机', model: 'Pantum CM2800ADN Series', sn: 'PT-CM2820-005',
    terminal: 'KSK-005', location: 'D区社区服务站',
    status: 'online', currentTask: null,
    toner: { level: 61, status: 'normal' }, paper: { tray1: 0, status: 'empty' },
    fault: '纸盒已空，请补充 A4 纸张', lastSync: '3分钟前',
  },
  {
    id: 'p6', name: 'KSK-006 打印机', model: 'Pantum CM2800ADN Series', sn: 'PT-CM2820-006',
    terminal: 'KSK-006', location: 'E区政务大厅',
    status: 'online', currentTask: null,
    toner: { level: 33, status: 'normal' }, paper: { tray1: 280, status: 'normal' },
    fault: null, lastSync: '刚刚',
  },
  {
    id: 'p7', name: 'KSK-007 打印机', model: 'Pantum CM2800ADN Series', sn: 'PT-CM2820-007',
    terminal: 'KSK-007', location: 'C区入口处',
    status: 'offline', currentTask: null,
    toner: { level: 55, status: 'normal' }, paper: { tray1: 300, status: 'normal' },
    fault: '终端离线，打印机状态未知', lastSync: '2小时前',
  },
  {
    id: 'p8', name: 'KSK-008 打印机', model: 'Pantum CM2800ADN Series', sn: 'PT-CM2820-008',
    terminal: 'KSK-008', location: 'F区科技园服务站',
    status: 'error', currentTask: null,
    toner: { level: 70, status: 'normal' }, paper: { tray1: 150, status: 'normal' },
    fault: '卡纸故障，需人工处理', lastSync: '15分钟前',
  },
]

const STATUS_MAP: Record<PrinterStatus, { badge: 'success' | 'error' | 'warning'; label: string }> = {
  online:  { badge: 'success', label: '在线' },
  offline: { badge: 'error',   label: '离线' },
  error:   { badge: 'error',   label: '故障' },
}

const TONER_COLOR: Record<TonerLevel, string> = {
  normal:   'bg-green-500',
  low:      'bg-orange-400',
  critical: 'bg-red-500',
}

const PAPER_MAP: Record<PaperStatus, { text: string; color: string }> = {
  normal: { text: '正常', color: 'text-green-600' },
  low:    { text: '偏少', color: 'text-orange-500' },
  empty:  { text: '已空', color: 'text-red-500' },
  jam:    { text: '卡纸', color: 'text-red-500' },
}

const FILTERS = ['全部', '在线', '离线', '故障'] as const
const FILTER_STATUS: Record<string, PrinterStatus | null> = { 全部: null, 在线: 'online', 离线: 'offline', 故障: 'error' }

// ─── Component ────────────────────────────────────────────────────────────────

export default function PrintersPage() {
  const [filter, setFilter] = useState<string>('全部')

  const filtered = filter === '全部'
    ? MOCK_PRINTERS
    : MOCK_PRINTERS.filter((p) => {
        if (filter === '故障') return p.status === 'error' || p.fault !== null
        return p.status === FILTER_STATUS[filter]
      })

  const counts = {
    全部: MOCK_PRINTERS.length,
    在线: MOCK_PRINTERS.filter((p) => p.status === 'online').length,
    离线: MOCK_PRINTERS.filter((p) => p.status === 'offline').length,
    故障: MOCK_PRINTERS.filter((p) => p.status === 'error' || p.fault !== null).length,
  }

  return (
    <>
      <p className="mb-4 text-sm text-gray-500">奔图 CM2800ADN/CM2820ADN 系列 — 状态监控</p>

      {/* 筛选标签 */}
      <div className="mb-4 flex gap-2">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
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
                {['设备名称', '型号', 'SN', '绑定终端', '状态', '当前任务', '碳粉余量', '纸张状态', '故障信息', '最近同步', '操作'].map((h) => (
                  <th key={h} className="whitespace-nowrap px-4 py-3 text-left text-xs font-medium text-gray-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map((p) => {
                const s = STATUS_MAP[p.status]
                const paper = PAPER_MAP[p.paper.status]
                return (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="whitespace-nowrap px-4 py-3 font-medium text-gray-800">
                      <div className="flex items-center gap-2">
                        <PrinterIcon className="h-4 w-4 text-gray-400" />
                        {p.name}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">{p.model}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-500">{p.sn}</td>
                    <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-gray-600">{p.terminal}</td>
                    <td className="px-4 py-3"><StatusBadge status={s.badge} label={s.label} /></td>
                    <td className="px-4 py-3 text-xs text-gray-600">
                      {p.currentTask ?? <span className="text-gray-300">空闲</span>}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-20 overflow-hidden rounded-full bg-gray-100">
                          <div
                            className={`h-full rounded-full ${TONER_COLOR[p.toner.status]}`}
                            style={{ width: `${p.toner.level}%` }}
                          />
                        </div>
                        <span className={`text-xs font-medium ${p.toner.status === 'normal' ? 'text-gray-600' : p.toner.status === 'low' ? 'text-orange-500' : 'text-red-500'}`}>
                          {p.toner.level}%
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium ${paper.color}`}>{paper.text}</span>
                      {p.paper.status !== 'empty' && (
                        <span className="ml-1 text-xs text-gray-400">({p.paper.tray1}张)</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {p.fault
                        ? <span className="text-red-500">{p.fault}</span>
                        : <span className="text-gray-300">—</span>
                      }
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-500">{p.lastSync}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex gap-2">
                        <button className="rounded px-2 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50">查看详情</button>
                        <button className="rounded px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100">查看任务</button>
                        <button className="rounded px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-100">参数配置</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </Card>

      <p className="mt-3 text-xs text-gray-400">打印机状态由 Windows Terminal Agent 实时上报，当前为 mock 数据</p>
    </>
  )
}
