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
  RefreshCwIcon,
} from 'lucide-react'

// ─── Types & mock ─────────────────────────────────────────────────────────────

interface MetricCard {
  label: string
  value: string | number
  note: string
  icon: React.ElementType
  iconClass: string
}

interface SyncRecord {
  source: string
  type: '岗位' | '招聘会' | '政策'
  result: '成功' | '失败' | '部分失败'
  count: number
  time: string
}

const METRICS: MetricCard[] = [
  { label: '已上传岗位',   value: 28,   note: '已发布 24 条',     icon: BriefcaseIcon,  iconClass: 'bg-blue-50 text-blue-600' },
  { label: '已上传招聘会', value: 5,    note: '进行中 1 场',       icon: CalendarIcon,   iconClass: 'bg-purple-50 text-purple-600' },
  { label: '已发布数据',   value: 29,   note: '岗位 24 + 招聘会 5', icon: CheckCircleIcon,iconClass: 'bg-green-50 text-green-600' },
  { label: '待审核数据',   value: 4,    note: '请及时跟进',        icon: ClockIcon,      iconClass: 'bg-orange-50 text-orange-500' },
  { label: '外部跳转次数', value: 156,  note: '近 7 天',           icon: ExternalLinkIcon, iconClass: 'bg-cyan-50 text-cyan-600' },
  { label: '终端展示次数', value: 842,  note: '近 7 天',           icon: MonitorIcon,    iconClass: 'bg-indigo-50 text-indigo-600' },
  { label: '打印资料次数', value: 37,   note: '近 7 天',           icon: PrinterIcon,    iconClass: 'bg-teal-50 text-teal-600' },
  { label: '数据统计',     value: '↑',  note: '查看完整报表',      icon: BarChart2Icon,  iconClass: 'bg-gray-100 text-gray-500' },
]

const RECENT_SYNCS: SyncRecord[] = [
  { source: '市人才网 API',     type: '岗位',   result: '成功',    count: 12, time: '2026-05-25 08:00' },
  { source: '市人才网 API',     type: '招聘会', result: '成功',    count: 2,  time: '2026-05-25 08:00' },
  { source: '高校就业 Excel',   type: '岗位',   result: '部分失败', count: 8,  time: '2026-05-24 18:00' },
  { source: '市人社局 Webhook', type: '招聘会', result: '成功',    count: 1,  time: '2026-05-24 12:00' },
]

const RESULT_CONFIG: Record<SyncRecord['result'], { color: string; badge: 'success' | 'error' | 'warning' }> = {
  '成功':    { color: 'text-green-600', badge: 'success' },
  '失败':    { color: 'text-red-500',   badge: 'error' },
  '部分失败': { color: 'text-orange-500', badge: 'warning' },
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PendingReviewCallout({ count }: { count: number }) {
  if (count === 0) return null
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-orange-200 bg-orange-50 px-5 py-4">
      <div className="flex items-center gap-3">
        <AlertCircleIcon className="h-5 w-5 shrink-0 text-orange-500" aria-hidden="true" />
        <div>
          <p className="text-sm font-semibold text-orange-800">
            有 {count} 条数据待管理员审核
          </p>
          <p className="mt-0.5 text-xs text-orange-600">
            数据提交后需经管理员审核，通过后才会在终端展示
          </p>
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
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">
        数据概览
      </h2>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {METRICS.map((m) => {
          const Icon = m.icon
          return (
            <Card key={m.label} className="p-5">
              <div className="flex items-start justify-between">
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-gray-500">{m.label}</p>
                  <p className="mt-1.5 text-2xl font-bold tabular-nums text-gray-900">{m.value}</p>
                  <p className="mt-1 text-[10px] text-gray-400">{m.note}</p>
                </div>
                <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${m.iconClass}`}>
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

function SyncLogSection() {
  return (
    <section aria-label="最近同步记录">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-400">
          最近同步记录
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
        <table className="w-full text-sm">
          <thead className="border-b border-gray-100 bg-gray-50">
            <tr>
              {['数据源', '类型', '本次同步', '结果', '同步时间', ''].map((h, i) => (
                <th
                  key={i}
                  className="whitespace-nowrap px-5 py-3 text-left text-xs font-medium text-gray-500"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {RECENT_SYNCS.map((s, i) => {
              const cfg = RESULT_CONFIG[s.result]
              return (
                <tr key={i} className="transition-colors hover:bg-gray-50">
                  <td className="px-5 py-3.5 font-medium text-gray-800">{s.source}</td>
                  <td className="px-5 py-3.5">
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                      {s.type}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 tabular-nums text-gray-700">
                    {s.count} 条
                  </td>
                  <td className="px-5 py-3.5">
                    <StatusBadge status={cfg.badge} label={s.result} />
                  </td>
                  <td className="whitespace-nowrap px-5 py-3.5 text-xs tabular-nums text-gray-400">
                    {s.time}
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <button
                      type="button"
                      className="text-xs font-medium text-primary-600 hover:text-primary-700"
                    >
                      详情
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>

        <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50 px-5 py-3">
          <p className="text-xs text-gray-400">
            上次成功同步：2026-05-25 08:00
          </p>
          <button
            type="button"
            disabled
            title="手动同步写入端点未在工作台接入，已禁用"
            className="flex cursor-not-allowed items-center gap-1.5 text-xs font-medium text-gray-300"
          >
            <RefreshCwIcon className="h-3.5 w-3.5" aria-hidden="true" />
            立即同步
          </button>
        </div>
      </Card>
    </section>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const pendingCount = 4

  return (
    <Page title="工作台" subtitle="合作机构数据概览 · 市人才交流中心">
      <div className="flex flex-col gap-6">
        <PendingReviewCallout count={pendingCount} />
        <MetricsGrid />
        <SyncLogSection />
      </div>
    </Page>
  )
}
