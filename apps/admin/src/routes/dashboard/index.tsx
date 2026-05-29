import { Card, StatusBadge } from '@ai-job-print/ui'
import { Page } from '../Page'
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  BanknoteIcon,
  BotIcon,
  BriefcaseIcon,
  CalendarIcon,
  MonitorIcon,
  PrinterIcon,
  ScanIcon,
  TrendingUpIcon,
  WifiOffIcon,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface HealthCard {
  label: string
  value: string
  sub: string
  icon: React.ElementType
  colorBg: string
  colorIcon: string
  colorValue: string
}

interface SecondaryMetric {
  label: string
  value: string | number
  note: string
  icon: React.ElementType
  iconColor: string
}

interface RecentAlert {
  id: string
  level: 'error' | 'warning' | 'info'
  message: string
  terminal: string
  time: string
}

// ─── Mock data ────────────────────────────────────────────────────────────────

const HEALTH_CARDS: HealthCard[] = [
  {
    label: '在线终端',
    value: '8 / 10',
    sub: '2 台当前离线',
    icon: MonitorIcon,
    colorBg: 'bg-green-50 border-green-200',
    colorIcon: 'text-green-600',
    colorValue: 'text-green-700',
  },
  {
    label: '待处理告警',
    value: '3',
    sub: '最新告警 10 分钟前',
    icon: AlertTriangleIcon,
    colorBg: 'bg-red-50 border-red-200',
    colorIcon: 'text-red-500',
    colorValue: 'text-red-600',
  },
  {
    label: '今日打印订单',
    value: '47',
    sub: '较昨日 +12%',
    icon: PrinterIcon,
    colorBg: 'bg-blue-50 border-blue-200',
    colorIcon: 'text-blue-600',
    colorValue: 'text-blue-700',
  },
  {
    label: '今日收入',
    value: '¥82.50',
    sub: '打印 ¥72 / AI ¥10.50',
    icon: BanknoteIcon,
    colorBg: 'bg-emerald-50 border-emerald-200',
    colorIcon: 'text-emerald-600',
    colorValue: 'text-emerald-700',
  },
]

const SECONDARY_METRICS: SecondaryMetric[] = [
  { label: '今日扫描',   value: 23,  note: '含简历/证件/文档',  icon: ScanIcon,        iconColor: 'text-purple-500 bg-purple-50' },
  { label: 'AI 服务',    value: 18,  note: '诊断 12 优化 6',    icon: BotIcon,         iconColor: 'text-orange-500 bg-orange-50' },
  { label: '岗位同步',   value: 156, note: '今日新增 4 条',     icon: BriefcaseIcon,   iconColor: 'text-sky-600 bg-sky-50' },
  { label: '招聘会',     value: 8,   note: '进行中 2 场',       icon: CalendarIcon,    iconColor: 'text-indigo-500 bg-indigo-50' },
  { label: '离线终端',   value: 2,   note: 'KSK-007 / KSK-009', icon: WifiOffIcon,     iconColor: 'text-red-400 bg-red-50' },
  { label: '收入趋势',   value: '+8%', note: '近 7 天环比',     icon: TrendingUpIcon,  iconColor: 'text-teal-600 bg-teal-50' },
]

const RECENT_ALERTS: RecentAlert[] = [
  { id: 'a1', level: 'error',   message: '打印机离线，无法响应任务',  terminal: 'KSK-001（A区大厅）',     time: '10分钟前' },
  { id: 'a2', level: 'warning', message: '碳粉余量低于 10%',        terminal: 'KSK-003（B区服务台）',    time: '1小时前' },
  { id: 'a3', level: 'warning', message: '终端心跳超时（>5分钟）',   terminal: 'KSK-007（C区入口）',      time: '2小时前' },
]

const ALERT_CONFIG = {
  error:   { badge: 'error' as const,   dot: 'bg-red-500',    label: '严重' },
  warning: { badge: 'warning' as const, dot: 'bg-orange-400', label: '警告' },
  info:    { badge: 'info' as const,    dot: 'bg-blue-400',   label: '提示' },
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function HealthSection() {
  return (
    <section aria-label="系统健康状态">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">
        系统状态
      </h2>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {HEALTH_CARDS.map((card) => {
          const Icon = card.icon
          return (
            <div
              key={card.label}
              className={`rounded-xl border p-5 ${card.colorBg}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-gray-500">{card.label}</p>
                  <p className={`mt-1.5 text-2xl font-bold tabular-nums ${card.colorValue}`}>
                    {card.value}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">{card.sub}</p>
                </div>
                <div className={`shrink-0 rounded-lg p-2.5 ${card.colorBg}`}>
                  <Icon className={`h-5 w-5 ${card.colorIcon}`} aria-hidden="true" />
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function SecondaryMetricsSection() {
  return (
    <section aria-label="今日服务数据">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">
        今日数据
      </h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {SECONDARY_METRICS.map((m) => {
          const Icon = m.icon
          return (
            <Card key={m.label} className="p-4">
              <div className={`mb-3 flex h-9 w-9 items-center justify-center rounded-lg ${m.iconColor}`}>
                <Icon className="h-4 w-4" aria-hidden="true" />
              </div>
              <p className="text-xl font-bold tabular-nums text-gray-900">{m.value}</p>
              <p className="mt-0.5 text-xs font-medium text-gray-600">{m.label}</p>
              <p className="mt-0.5 text-[10px] text-gray-400">{m.note}</p>
            </Card>
          )
        })}
      </div>
    </section>
  )
}

function AlertsSection() {
  return (
    <section aria-label="最新告警">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400">
          最新告警
        </h2>
        <button
          type="button"
          className="flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700"
        >
          查看全部
          <ArrowRightIcon className="h-3 w-3" aria-hidden="true" />
        </button>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="divide-y divide-gray-100">
          {RECENT_ALERTS.map((alert) => {
            const cfg = ALERT_CONFIG[alert.level]
            return (
              <div
                key={alert.id}
                className="flex items-center gap-4 px-5 py-4 transition-colors hover:bg-gray-50"
              >
                {/* Level dot */}
                <span
                  aria-hidden="true"
                  className={`h-2 w-2 shrink-0 rounded-full ${cfg.dot}`}
                />

                {/* Message + terminal */}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-800">{alert.message}</p>
                  <p className="mt-0.5 text-xs text-gray-400">{alert.terminal}</p>
                </div>

                {/* Badge */}
                <StatusBadge status={cfg.badge} label={cfg.label} />

                {/* Time */}
                <span className="shrink-0 text-xs tabular-nums text-gray-400">{alert.time}</span>

                {/* Action */}
                <button
                  type="button"
                  className="shrink-0 rounded px-2.5 py-1 text-xs font-medium text-primary-600 hover:bg-primary-50"
                >
                  处理
                </button>
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-100 bg-gray-50 px-5 py-3">
          <p className="text-xs text-gray-400">
            共 3 条未处理告警 · 最后检查：2026-05-29 09:20
          </p>
        </div>
      </Card>
    </section>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  return (
    <Page title="工作台" subtitle="今日运营概览 · 2026-05-29">
      <div className="flex flex-col gap-7">
        <HealthSection />
        <SecondaryMetricsSection />
        <AlertsSection />
      </div>
    </Page>
  )
}
