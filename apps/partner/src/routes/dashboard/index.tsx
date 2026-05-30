import type { ElementType } from 'react'
import { Button, Card, StatusBadge } from '@ai-job-print/ui'
import { Page } from '../Page'
import {
  AlertCircleIcon,
  ArrowRightIcon,
  BarChart2Icon,
  BriefcaseIcon,
  CalendarIcon,
  CheckCircleIcon,
  ClockIcon,
  ExternalLinkIcon,
  MonitorIcon,
  PrinterIcon,
  QrCodeIcon,
  RefreshCwIcon,
  SettingsIcon,
  SparklesIcon,
  UploadIcon,
  UsersIcon,
  WrenchIcon,
} from 'lucide-react'

interface MetricCard {
  label: string
  value: string | number
  note: string
  icon: ElementType
  iconClass: string
}

interface TodoItem {
  label: string
  value: string
  note: string
  tone: 'orange' | 'red' | 'blue' | 'purple' | 'amber' | 'slate'
}

interface TrendPoint {
  label: string
  primary: number
  secondary: number
}

interface RankingItem {
  name: string
  meta: string
  views: number
  jumps: number
}

interface SyncRecord {
  source: string
  type: '岗位' | '招聘会' | '政策'
  result: '成功' | '失败' | '部分失败'
  count: number
  time: string
  action: '详情' | '重试'
}

const METRICS: MetricCard[] = [
  { label: '岗位发布量', value: 128, note: '已上架 116 条 / 待审核 4 条', icon: BriefcaseIcon, iconClass: 'bg-blue-50 text-blue-600' },
  { label: '外部跳转数', value: '3,218', note: '近 7 日增长 12.4%', icon: ExternalLinkIcon, iconClass: 'bg-cyan-50 text-cyan-600' },
  { label: '招聘会浏览', value: '8,642', note: '进行中 3 场 / 近 7 日', icon: CalendarIcon, iconClass: 'bg-purple-50 text-purple-600' },
  { label: '预约跳转', value: 936, note: '去来源平台预约 / 今日 82 次', icon: QrCodeIcon, iconClass: 'bg-pink-50 text-pink-600' },
  { label: '终端使用次数', value: '12,480', note: '近 7 日 / 绑定终端 45 台', icon: MonitorIcon, iconClass: 'bg-indigo-50 text-indigo-600' },
  { label: '打印服务次数', value: '4,276', note: '今日 1,240 次', icon: PrinterIcon, iconClass: 'bg-teal-50 text-teal-600' },
  { label: 'AI 服务次数', value: '9,850', note: '诊断 / 优化 / 咨询调用', icon: SparklesIcon, iconClass: 'bg-violet-50 text-violet-600' },
  { label: '同步成功率', value: '98.6%', note: '最近同步成功 / 异常 2 批次', icon: CheckCircleIcon, iconClass: 'bg-green-50 text-green-600' },
]

const TODAY_TODOS: TodoItem[] = [
  { label: '待审核岗位', value: '4 条', note: '优先处理校招岗位', tone: 'orange' },
  { label: '同步失败', value: '2 批次', note: '高校就业 Excel 字段需复核', tone: 'red' },
  { label: '即将过期岗位', value: '8 条', note: '3 日内到期', tone: 'amber' },
  { label: '失效外部链接', value: '3 个', note: '建议重新校验来源地址', tone: 'blue' },
  { label: '待更新招聘会', value: '1 场', note: '场地信息待确认', tone: 'purple' },
  { label: '设备告警', value: '3 台', note: '含耗材与离线提醒', tone: 'slate' },
]

const VISIT_TRENDS: TrendPoint[] = [
  { label: '05/24', primary: 820, secondary: 260 },
  { label: '05/25', primary: 960, secondary: 310 },
  { label: '05/26', primary: 1040, secondary: 366 },
  { label: '05/27', primary: 1180, secondary: 422 },
  { label: '05/28', primary: 1320, secondary: 480 },
  { label: '05/29', primary: 1260, secondary: 456 },
  { label: '05/30', primary: 1480, secondary: 536 },
]

const SERVICE_TRENDS: TrendPoint[] = [
  { label: '05/24', primary: 380, secondary: 940 },
  { label: '05/25', primary: 420, secondary: 1080 },
  { label: '05/26', primary: 460, secondary: 1160 },
  { label: '05/27', primary: 520, secondary: 1240 },
  { label: '05/28', primary: 610, secondary: 1320 },
  { label: '05/29', primary: 590, secondary: 1410 },
  { label: '05/30', primary: 680, secondary: 1530 },
]

const HOT_JOBS: RankingItem[] = [
  { name: 'AI 产品运营专员', meta: '青岛市人才网', views: 1280, jumps: 386 },
  { name: '前端开发工程师', meta: '高校就业联盟', views: 1164, jumps: 342 },
  { name: '智能制造项目助理', meta: '新区就业平台', views: 980, jumps: 274 },
  { name: '数据分析实习生', meta: '市人才网 API', views: 876, jumps: 229 },
  { name: '校园服务运营', meta: '高校就业 Excel', views: 742, jumps: 188 },
]

const HOT_FAIRS: RankingItem[] = [
  { name: '青岛高校 AI 产业专场', meta: '05/31 · 崂山区会展中心', views: 2210, jumps: 642 },
  { name: '软件园春季双选会', meta: '06/02 · 市北区', views: 1840, jumps: 516 },
  { name: '智能制造人才对接会', meta: '06/05 · 西海岸新区', views: 1426, jumps: 384 },
  { name: '毕业季就业服务周', meta: '06/08 · 高校联合', views: 1198, jumps: 316 },
  { name: '现代服务业招聘会', meta: '06/12 · 市南区', views: 982, jumps: 244 },
]

const QUICK_ACTIONS = [
  { label: '导入岗位', note: '导入外部岗位信息', icon: UploadIcon },
  { label: '管理岗位', note: '维护展示与外部链接', icon: BriefcaseIcon },
  { label: '发布招聘会', note: '维护外部招聘会信息', icon: CalendarIcon },
  { label: '管理招聘会', note: '更新时间地点与链接', icon: SettingsIcon },
  { label: '管理二维码', note: '配置外部链接二维码', icon: QrCodeIcon },
  { label: '查看同步日志', note: '排查同步批次状态', icon: RefreshCwIcon },
  { label: '查看数据报表', note: '浏览与服务统计', icon: BarChart2Icon },
  { label: '账号权限管理', note: '角色与成员配置', icon: UsersIcon },
]

const TERMINAL_STATS = [
  { label: '终端总数', value: '45', tone: 'text-gray-900' },
  { label: '在线', value: '42', tone: 'text-green-600' },
  { label: '离线', value: '1', tone: 'text-orange-500' },
  { label: '故障', value: '1', tone: 'text-red-500' },
]

const RECENT_SYNCS: SyncRecord[] = [
  { source: '市人才网 API', type: '岗位', result: '成功', count: 128, time: '2026-05-30 08:00', action: '详情' },
  { source: '市人才网 API', type: '招聘会', result: '成功', count: 12, time: '2026-05-30 08:00', action: '详情' },
  { source: '高校就业 Excel', type: '岗位', result: '部分失败', count: 86, time: '2026-05-29 18:30', action: '重试' },
  { source: '市人社局 Webhook', type: '政策', result: '成功', count: 6, time: '2026-05-29 12:00', action: '详情' },
  { source: '新区就业平台', type: '招聘会', result: '失败', count: 0, time: '2026-05-29 09:10', action: '重试' },
]

const RESULT_CONFIG: Record<SyncRecord['result'], { badge: 'success' | 'error' | 'warning' }> = {
  成功: { badge: 'success' },
  失败: { badge: 'error' },
  部分失败: { badge: 'warning' },
}

const TODO_TONE_CLASS: Record<TodoItem['tone'], string> = {
  orange: 'border-orange-100 bg-orange-50 text-orange-700',
  red: 'border-red-100 bg-red-50 text-red-600',
  blue: 'border-blue-100 bg-blue-50 text-blue-600',
  purple: 'border-purple-100 bg-purple-50 text-purple-600',
  amber: 'border-amber-100 bg-amber-50 text-amber-700',
  slate: 'border-slate-100 bg-slate-50 text-slate-600',
}

function buildPolyline(points: number[], width = 320, height = 120, padding = 16) {
  const max = Math.max(...points)
  const min = Math.min(...points)
  const range = max - min || 1

  return points
    .map((value, index) => {
      const x = padding + (index * (width - padding * 2)) / (points.length - 1)
      const y = height - padding - ((value - min) / range) * (height - padding * 2)
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
}

function ComplianceNotice() {
  return (
    <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-5 py-4 text-amber-900 shadow-sm shadow-amber-100/50">
      <AlertCircleIcon className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" aria-hidden="true" />
      <div>
        <p className="text-sm font-semibold">合规提示</p>
        <p className="mt-1 text-sm leading-6 text-amber-800">
          本后台用于合作数据维护与运营统计，不承接平台内简历投递、候选人筛选和面试邀约。
        </p>
      </div>
    </div>
  )
}

function PendingReviewCallout({ count }: { count: number }) {
  if (count === 0) return null
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-orange-200 bg-orange-50 px-5 py-4">
      <div className="flex items-center gap-3">
        <ClockIcon className="h-5 w-5 shrink-0 text-orange-500" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold text-orange-800">有 {count} 条岗位信息待管理员审核</p>
          <p className="mt-0.5 text-xs text-orange-600">数据提交后需经管理员审核，通过后才会在终端展示</p>
        </div>
      </div>
      <Button variant="outline" size="sm" className="shrink-0 whitespace-nowrap border-orange-300 text-orange-700 hover:bg-orange-100">
        查看详情
        <ArrowRightIcon className="ml-1 h-3.5 w-3.5" aria-hidden="true" />
      </Button>
    </div>
  )
}

function MetricsGrid() {
  return (
    <section aria-label="数据概览">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">数据概览</h2>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {METRICS.map((metric) => {
          const Icon = metric.icon
          return (
            <Card key={metric.label} className="p-5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-gray-500">{metric.label}</p>
                  <p className="mt-1.5 text-2xl font-bold tabular-nums text-gray-900">{metric.value}</p>
                  <p className="mt-1 text-[10px] leading-4 text-gray-400">{metric.note}</p>
                </div>
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${metric.iconClass}`}>
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </div>
              </div>
            </Card>
          )
        })}
      </div>
    </section>
  )
}

function MiniTrendChart({
  title,
  primaryLabel,
  secondaryLabel,
  data,
}: {
  title: string
  primaryLabel: string
  secondaryLabel: string
  data: TrendPoint[]
}) {
  const primaryPoints = buildPolyline(data.map((item) => item.primary))
  const secondaryPoints = buildPolyline(data.map((item) => item.secondary))
  const gradientId = `trend-${title.replace(/\s+/g, '-')}-fill`

  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          <p className="mt-1 text-xs text-gray-400">近 7 日趋势</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-3 text-xs text-gray-500">
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-primary-500" />{primaryLabel}</span>
          <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-cyan-400" />{secondaryLabel}</span>
        </div>
      </div>

      <svg viewBox="0 0 320 120" className="h-36 w-full" role="img" aria-label={`${primaryLabel}与${secondaryLabel}趋势`}>
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[20, 50, 80, 110].map((y) => (
          <line key={y} x1="12" x2="308" y1={y} y2={y} stroke="#eef2f7" strokeWidth="1" />
        ))}
        <polyline points={`16,104 ${primaryPoints} 304,104`} fill={`url(#${gradientId})`} stroke="none" />
        <polyline points={primaryPoints} fill="none" stroke="#0ea5e9" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
        <polyline points={secondaryPoints} fill="none" stroke="#22d3ee" strokeDasharray="5 5" strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" />
        {data.map((item, index) => {
          const x = 16 + (index * (320 - 32)) / (data.length - 1)
          return (
            <text key={item.label} x={x} y="118" textAnchor="middle" className="fill-gray-400 text-[9px]">
              {item.label.slice(3)}
            </text>
          )
        })}
      </svg>
    </div>
  )
}

function TrendSection() {
  return (
    <section aria-label="趋势折线" className="xl:col-span-2">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">趋势折线</h2>
      <Card className="p-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <MiniTrendChart title="浏览与外部跳转" primaryLabel="浏览" secondaryLabel="外部跳转" data={VISIT_TRENDS} />
          <MiniTrendChart title="打印与 AI 服务" primaryLabel="打印" secondaryLabel="AI 服务" data={SERVICE_TRENDS} />
        </div>
      </Card>
    </section>
  )
}

function TodayTodoSection() {
  return (
    <section aria-label="今日待办">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">今日待办</h2>
      <Card className="p-5">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          {TODAY_TODOS.map((item) => (
            <div key={item.label} className={`rounded-xl border px-4 py-3 ${TODO_TONE_CLASS[item.tone]}`}>
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold">{item.label}</span>
                <span className="text-sm font-bold tabular-nums">{item.value}</span>
              </div>
              <p className="mt-1 text-xs opacity-80">{item.note}</p>
            </div>
          ))}
        </div>
      </Card>
    </section>
  )
}

function TerminalStatusSection() {
  return (
    <section aria-label="绑定终端状态" className="xl:col-span-2">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">绑定终端状态</h2>
      <Card className="p-6">
        <div className="grid gap-6 lg:grid-cols-[1fr_1.35fr]">
          <div className="rounded-2xl bg-gradient-to-br from-sky-50 to-cyan-50 p-6">
            <div className="flex items-center gap-3 text-primary-600">
              <MonitorIcon className="h-6 w-6" aria-hidden="true" />
              <span className="text-sm font-medium">合作机构绑定终端</span>
            </div>
            <p className="mt-5 text-5xl font-bold tracking-tight text-gray-900">45 台</p>
            <p className="mt-2 text-sm text-gray-500">在线率 93.3%，整体运行稳定</p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {TERMINAL_STATS.map((stat) => (
              <div key={stat.label} className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3">
                <p className="text-xs text-gray-500">{stat.label}</p>
                <p className={`mt-1 text-2xl font-bold tabular-nums ${stat.tone}`}>{stat.value}</p>
              </div>
            ))}
            <div className="rounded-xl border border-teal-100 bg-teal-50 px-4 py-3">
              <p className="text-xs text-teal-600">今日打印量</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-teal-700">1,240</p>
            </div>
            <div className="rounded-xl border border-violet-100 bg-violet-50 px-4 py-3">
              <p className="text-xs text-violet-600">今日 AI 服务量</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-violet-700">3,450</p>
            </div>
            <div className="rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 sm:col-span-2">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-amber-700">
                  <WrenchIcon className="h-4 w-4" aria-hidden="true" />
                  <span className="text-sm font-semibold">耗材告警</span>
                </div>
                <span className="text-xl font-bold tabular-nums text-amber-700">3</span>
              </div>
              <p className="mt-1 text-xs text-amber-600">2 台纸张不足，1 台碳粉余量偏低</p>
            </div>
          </div>
        </div>
      </Card>
    </section>
  )
}

function QuickActionsSection() {
  return (
    <section aria-label="快捷操作">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">快捷操作</h2>
      <Card className="p-5">
        <div className="grid grid-cols-2 gap-3">
          {QUICK_ACTIONS.map((action) => {
            const Icon = action.icon
            return (
              <button
                key={action.label}
                type="button"
                className="group rounded-xl border border-gray-100 bg-gray-50 p-4 text-left transition hover:border-primary-200 hover:bg-primary-50"
              >
                <Icon className="h-5 w-5 text-gray-500 transition group-hover:text-primary-600" aria-hidden="true" />
                <p className="mt-3 text-sm font-semibold text-gray-900">{action.label}</p>
                <p className="mt-1 text-xs leading-4 text-gray-400">{action.note}</p>
              </button>
            )
          })}
        </div>
      </Card>
    </section>
  )
}

function RankingList({ title, items, jumpLabel }: { title: string; items: RankingItem[]; jumpLabel: string }) {
  return (
    <Card className="p-5">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        <BarChart2Icon className="h-4 w-4 text-gray-400" aria-hidden="true" />
      </div>
      <div className="space-y-4">
        {items.map((item, index) => (
          <div key={item.name} className="flex items-start gap-3">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary-50 text-xs font-bold text-primary-600">
              {index + 1}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-gray-900">{item.name}</p>
              <p className="mt-0.5 truncate text-xs text-gray-400">{item.meta}</p>
              <div className="mt-2 flex items-center gap-4 text-xs tabular-nums text-gray-500">
                <span>浏览 {item.views.toLocaleString()}</span>
                <span>{jumpLabel} {item.jumps.toLocaleString()}</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

function HotRankingSection() {
  return (
    <section aria-label="热门排行" className="xl:col-span-2">
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">热门 TOP5</h2>
      <div className="grid gap-4 lg:grid-cols-2">
        <RankingList title="热门岗位 TOP5" items={HOT_JOBS} jumpLabel="外部跳转" />
        <RankingList title="热门招聘会 TOP5" items={HOT_FAIRS} jumpLabel="预约跳转" />
      </div>
    </section>
  )
}

function SyncLogSection() {
  return (
    <section aria-label="最近同步记录">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400">最近同步记录</h2>
        <button type="button" className="flex items-center gap-1 text-xs font-medium text-primary-600 hover:text-primary-700">
          查看全部
          <ArrowRightIcon className="h-3 w-3" aria-hidden="true" />
        </button>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-100 bg-gray-50">
              <tr>
                {['数据源', '类型', '本次同步', '结果', '同步时间', '操作'].map((header) => (
                  <th key={header} className="whitespace-nowrap px-5 py-3 text-left text-xs font-medium text-gray-500">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {RECENT_SYNCS.map((sync) => {
                const cfg = RESULT_CONFIG[sync.result]
                return (
                  <tr key={`${sync.source}-${sync.time}`} className="transition-colors hover:bg-gray-50">
                    <td className="whitespace-nowrap px-5 py-3.5 font-medium text-gray-800">{sync.source}</td>
                    <td className="px-5 py-3.5">
                      <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{sync.type}</span>
                    </td>
                    <td className="whitespace-nowrap px-5 py-3.5 tabular-nums text-gray-700">{sync.count} 条</td>
                    <td className="px-5 py-3.5">
                      <StatusBadge status={cfg.badge} label={sync.result} />
                    </td>
                    <td className="whitespace-nowrap px-5 py-3.5 text-xs tabular-nums text-gray-400">{sync.time}</td>
                    <td className="px-5 py-3.5 text-right">
                      <button type="button" className="text-xs font-medium text-primary-600 hover:text-primary-700">
                        {sync.action}
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50 px-5 py-3">
          <p className="text-xs text-gray-400">上次成功同步：2026-05-30 08:00</p>
          <button type="button" className="flex items-center gap-1.5 text-xs font-medium text-gray-500 hover:text-gray-700">
            <RefreshCwIcon className="h-3.5 w-3.5" aria-hidden="true" />
            立即同步
          </button>
        </div>
      </Card>
    </section>
  )
}

export default function DashboardPage() {
  const pendingCount = 4

  return (
    <Page title="工作台" subtitle="合作机构数据概览 · 市人才交流中心">
      <div className="flex flex-col gap-6">
        <ComplianceNotice />
        <PendingReviewCallout count={pendingCount} />
        <MetricsGrid />

        <div className="grid gap-6 xl:grid-cols-3">
          <TrendSection />
          <TodayTodoSection />
        </div>

        <div className="grid gap-6 xl:grid-cols-3">
          <TerminalStatusSection />
          <QuickActionsSection />
        </div>

        <div className="grid gap-6 xl:grid-cols-3">
          <HotRankingSection />
          <SyncLogSection />
        </div>
      </div>
    </Page>
  )
}
