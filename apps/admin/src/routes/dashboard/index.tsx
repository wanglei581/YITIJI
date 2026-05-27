import { Card, StatusBadge } from '@ai-job-print/ui'
import { Page } from '../Page'
import {
  AlertTriangleIcon,
  BotIcon,
  BriefcaseIcon,
  CalendarIcon,
  PrinterIcon,
  ScanIcon,
  WifiOffIcon,
  WifiIcon,
  BanknoteIcon,
} from 'lucide-react'

// ─── Types & mock ─────────────────────────────────────────────────────────────

interface MetricCard {
  label: string
  value: string | number
  icon: React.ElementType
  status?: 'success' | 'warning' | 'error' | 'info' | 'default'
  note?: string
}

interface RecentAlert {
  id: string
  level: 'error' | 'warning' | 'info'
  message: string
  terminal: string
  time: string
}

const METRICS: MetricCard[] = [
  { label: '在线终端',     value: 8,       icon: WifiIcon,       status: 'success', note: '共 10 台' },
  { label: '离线终端',     value: 2,       icon: WifiOffIcon,    status: 'error',   note: '需检查' },
  { label: '今日打印订单', value: 47,      icon: PrinterIcon,    status: 'info',    note: '较昨日 +12%' },
  { label: '今日扫描次数', value: 23,      icon: ScanIcon,       status: 'default', note: '含简历/证件/文档' },
  { label: '今日 AI 服务', value: 18,      icon: BotIcon,        status: 'default', note: '诊断 12 优化 6' },
  { label: '待处理告警',   value: 3,       icon: AlertTriangleIcon, status: 'warning', note: '需及时处理' },
  { label: '岗位同步',     value: 156,     icon: BriefcaseIcon,  status: 'default', note: '今日新增 4' },
  { label: '招聘会同步',   value: 8,       icon: CalendarIcon,   status: 'default', note: '进行中 2' },
  { label: '今日收入',     value: '¥82.50',icon: BanknoteIcon,   status: 'success', note: '打印 ¥72 / 其他 ¥10' },
]

const RECENT_ALERTS: RecentAlert[] = [
  { id: 'a1', level: 'error',   message: '打印机离线，无法响应任务',   terminal: 'KSK-001（A区大厅）', time: '10分钟前' },
  { id: 'a2', level: 'warning', message: '碳粉余量低于 10%',         terminal: 'KSK-003（B区服务台）', time: '1小时前' },
  { id: 'a3', level: 'warning', message: '终端心跳超时（>5分钟）',    terminal: 'KSK-007（C区入口）',  time: '2小时前' },
]

const ALERT_STYLES = {
  error:   { badge: 'error' as const,   dot: 'bg-red-500' },
  warning: { badge: 'warning' as const, dot: 'bg-orange-400' },
  info:    { badge: 'info' as const,    dot: 'bg-blue-400' },
}

const STATUS_ICON_COLORS: Record<string, string> = {
  success: 'text-green-600 bg-green-50',
  warning: 'text-orange-500 bg-orange-50',
  error:   'text-red-500 bg-red-50',
  info:    'text-blue-600 bg-blue-50',
  default: 'text-gray-500 bg-gray-100',
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  return (
    <Page title="工作台" subtitle="运营数据概览">
      {/* 指标卡片 */}
      <div className="grid grid-cols-3 gap-4 lg:grid-cols-3 xl:grid-cols-3">
        {METRICS.map((m) => {
          const Icon = m.icon
          const colorClass = STATUS_ICON_COLORS[m.status ?? 'default']
          return (
            <Card key={m.label} className="p-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-gray-500">{m.label}</p>
                  <p className="mt-1 text-2xl font-bold text-gray-900">{m.value}</p>
                  {m.note && <p className="mt-1 text-xs text-gray-400">{m.note}</p>}
                </div>
                <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${colorClass}`}>
                  <Icon className="h-5 w-5" />
                </div>
              </div>
            </Card>
          )
        })}
      </div>

      {/* 最新告警 */}
      <div className="mt-6">
        <h2 className="mb-3 text-sm font-medium text-gray-700">最新告警</h2>
        <Card className="overflow-hidden p-0">
          <div className="divide-y divide-gray-100">
            {RECENT_ALERTS.map((a) => {
              const s = ALERT_STYLES[a.level]
              return (
                <div key={a.id} className="flex items-center gap-4 px-5 py-3.5">
                  <span className={`h-2 w-2 shrink-0 rounded-full ${s.dot}`} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-800">{a.message}</p>
                    <p className="text-xs text-gray-400">{a.terminal}</p>
                  </div>
                  <StatusBadge status={s.badge} label={a.level === 'error' ? '严重' : '警告'} />
                  <span className="shrink-0 text-xs text-gray-400">{a.time}</span>
                </div>
              )
            })}
          </div>
        </Card>
      </div>
    </Page>
  )
}
