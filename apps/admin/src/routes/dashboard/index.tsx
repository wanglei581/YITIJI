import { Card, StatusBadge } from '@ai-job-print/ui'
import { Page } from '../Page'
import {
  AlertTriangleIcon,
  ArrowRightIcon,
  BanknoteIcon,
  BriefcaseIcon,
  FolderIcon,
  MonitorIcon,
  PrinterIcon,
} from 'lucide-react'

// ─── Types ────────────────────────────────────────────────────────────────────

interface KpiCard {
  label: string
  value: string
  sub: string
  icon: React.ElementType
  /** Show a 2px left accent when value is in alert state. */
  alert?: boolean
}

interface ActionItem {
  label: string
  count: number
  hint: string
  href?: string
}

interface ActionPanel {
  title: string
  icon: React.ElementType
  items: ActionItem[]
  href: string
}

interface RecentAlert {
  id: string
  level: 'error' | 'warning' | 'info'
  message: string
  terminal: string
  time: string
}

// ─── Mock data ────────────────────────────────────────────────────────────────

const KPI_CARDS: KpiCard[] = [
  { label: '在线终端',     value: '8 / 10',  sub: '2 台当前离线',     icon: MonitorIcon },
  { label: '待处理告警',   value: '3',       sub: '最新 10 分钟前',   icon: AlertTriangleIcon, alert: true },
  { label: '今日打印订单', value: '47',      sub: '较昨日 +12%',      icon: PrinterIcon },
  { label: '今日收入',     value: '¥82.50',  sub: '打印 ¥72 / AI ¥10.50', icon: BanknoteIcon },
]

const ACTION_PANELS: ActionPanel[] = [
  {
    title: '待审核外部数据',
    icon: BriefcaseIcon,
    href: '/job-sources',
    items: [
      { label: '岗位信息源',   count: 5, hint: '5 条待审核', href: '/job-sources' },
      { label: '招聘会信息源', count: 2, hint: '2 条待审核', href: '/fair-sources' },
    ],
  },
  {
    title: '待处理告警',
    icon: AlertTriangleIcon,
    href: '/alerts',
    items: [
      { label: '严重', count: 1, hint: '打印机离线' },
      { label: '警告', count: 2, hint: '碳粉低 / 心跳超时' },
    ],
  },
  {
    title: '文件清理',
    icon: FolderIcon,
    href: '/files',
    items: [
      { label: '清理失败', count: 1, hint: '需手动处理' },
      { label: '即将到期', count: 4, hint: '24 小时内' },
    ],
  },
]

const RECENT_ALERTS: RecentAlert[] = [
  { id: 'a1', level: 'error',   message: '打印机离线,无法响应任务', terminal: 'KSK-001(A区大厅)',   time: '10分钟前' },
  { id: 'a2', level: 'warning', message: '碳粉余量低于 10%',         terminal: 'KSK-003(B区服务台)', time: '1小时前' },
  { id: 'a3', level: 'warning', message: '终端心跳超时(>5分钟)',    terminal: 'KSK-007(C区入口)',   time: '2小时前' },
]

const ALERT_CONFIG = {
  error:   { badge: 'error' as const,   dot: 'bg-red-500',    label: '严重' },
  warning: { badge: 'warning' as const, dot: 'bg-orange-400', label: '警告' },
  info:    { badge: 'info' as const,    dot: 'bg-blue-400',   label: '提示' },
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function KpiSection() {
  return (
    <section aria-label="核心指标">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">
        核心指标
      </h2>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {KPI_CARDS.map((card) => {
          const Icon = card.icon
          return (
            <div
              key={card.label}
              className="relative overflow-hidden rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
            >
              {card.alert && (
                <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[2px] bg-red-500" />
              )}
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-gray-500">{card.label}</p>
                  <p className="mt-1.5 text-2xl font-bold tabular-nums text-gray-900">
                    {card.value}
                  </p>
                  <p className="mt-1 text-xs text-gray-500">{card.sub}</p>
                </div>
                <div className="shrink-0 rounded-lg bg-gray-50 p-2.5">
                  <Icon className="h-5 w-5 text-gray-500" aria-hidden="true" />
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function ActionPanelsSection() {
  return (
    <section aria-label="待办事项">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">
        待办事项
      </h2>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {ACTION_PANELS.map((panel) => {
          const Icon = panel.icon
          const total = panel.items.reduce((sum, it) => sum + it.count, 0)
          return (
            <Card key={panel.title} className="flex flex-col p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-gray-50">
                    <Icon className="h-5 w-5 text-gray-500" aria-hidden="true" />
                  </div>
                  <h3 className="text-sm font-semibold text-gray-800">{panel.title}</h3>
                </div>
                <span className="text-xl font-bold tabular-nums text-gray-900">{total}</span>
              </div>
              <ul className="mt-4 space-y-2">
                {panel.items.map((it) => (
                  <li key={it.label} className="flex items-center justify-between text-sm">
                    <span className="text-gray-600">{it.label}</span>
                    <span className="text-gray-400">
                      <span className="tabular-nums font-medium text-gray-700">{it.count}</span>
                      <span className="ml-1.5 text-xs">· {it.hint}</span>
                    </span>
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex-1" />
              <a
                href={panel.href}
                className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700"
              >
                查看全部
                <ArrowRightIcon className="h-3 w-3" aria-hidden="true" />
              </a>
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
        <a
          href="/alerts"
          className="flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700"
        >
          查看全部
          <ArrowRightIcon className="h-3 w-3" aria-hidden="true" />
        </a>
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
                <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${cfg.dot}`} />

                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-800">{alert.message}</p>
                  <p className="mt-0.5 text-xs text-gray-400">{alert.terminal}</p>
                </div>

                <StatusBadge status={cfg.badge} label={cfg.label} />

                <span className="shrink-0 text-xs tabular-nums text-gray-400">{alert.time}</span>

                <button
                  type="button"
                  disabled
                  title="告警处理写入端点未接入，已禁用"
                  className="shrink-0 cursor-not-allowed rounded px-2.5 py-1 text-xs font-medium text-gray-300"
                >
                  处理
                </button>
              </div>
            )
          })}
        </div>

        <div className="border-t border-gray-100 bg-gray-50 px-5 py-3">
          <p className="text-xs text-gray-400">
            共 3 条未处理告警 · 最后检查:2026-05-29 09:20
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
        <KpiSection />
        <ActionPanelsSection />
        <AlertsSection />
      </div>
    </Page>
  )
}

// 设计说明:工作台只做"看 4 个核心数 + 立刻处理 3 件事"。
// 6 张"今日指标"已下放各自模块页头,工作台不再重复。
