// Partner 数据统计页 — /stats
//
// 口径：Codex 审查通过方案 C（Partner 先行）
// 数据来源：getPartnerStats()，HTTP 模式接真实 /partner/stats 接口
// Mock 模式：固定演示数据，页面顶部强制标注"演示数据"，不伪造成实时经营结论

import { useEffect, useState } from 'react'
import {
  Card,
  ErrorState,
  LoadingState,
  MetricGrid,
  SectionCard,
  TrendLineChart,
} from '@ai-job-print/ui'
import {
  BarChart2Icon,
  BriefcaseIcon,
  CalendarIcon,
  DatabaseIcon,
  FlaskConicalIcon,
  RefreshCwIcon,
} from 'lucide-react'
import { Page } from '../Page'
import { API_MODE } from '../../services/api/client'
import {
  getPartnerStats,
  type PartnerStatsResponse,
  type StatsPeriod,
} from '../../services/api/stats'

// ─── 时间范围选择器 ────────────────────────────────────────────────────────

const PERIODS: { value: StatsPeriod; label: string }[] = [
  { value: 'week',    label: '本周' },
  { value: 'month',   label: '本月' },
  { value: 'quarter', label: '本季度' },
]

function PeriodSelector({ value, onChange }: { value: StatsPeriod; onChange: (p: StatsPeriod) => void }) {
  return (
    <div className="flex rounded-lg border border-neutral-200 bg-surface text-sm">
      {PERIODS.map((p) => (
        <button
          key={p.value}
          type="button"
          onClick={() => onChange(p.value)}
          className={`px-4 py-1.5 font-medium transition-colors first:rounded-l-lg last:rounded-r-lg ${
            value === p.value
              ? 'bg-primary-600 text-white'
              : 'text-neutral-600 hover:bg-neutral-50'
          }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  )
}

// ─── 演示数据提示 ──────────────────────────────────────────────────────────

function DemoBanner() {
  if (API_MODE === 'http') return null
  return (
    <div className="mb-5 flex items-center gap-2.5 rounded-lg border border-warning/30 bg-warning-bg px-4 py-2.5 text-sm text-warning-fg">
      <FlaskConicalIcon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span>
        <strong>演示数据</strong>——当前为 Mock 模式，以下数据为固定示例，
        <strong>不代表真实经营状况</strong>。接入真实后端后自动切换。
      </span>
    </div>
  )
}

// ─── 状态分布卡 ────────────────────────────────────────────────────────────

function StatusDistCard({ dist }: { dist: PartnerStatsResponse['statusDist'] }) {
  const total = dist.success + dist.partial + dist.failed
  if (total === 0) {
    return (
      <div className="flex h-full items-center justify-center py-8 text-sm text-neutral-400">
        本周期暂无同步记录
      </div>
    )
  }
  const bars: { label: string; count: number; color: string; bg: string }[] = [
    { label: '成功', count: dist.success, color: 'bg-success',  bg: 'bg-success-bg' },
    { label: '部分', count: dist.partial, color: 'bg-warning',  bg: 'bg-warning-bg' },
    { label: '失败', count: dist.failed,  color: 'bg-error',    bg: 'bg-error-bg'   },
  ]
  return (
    <div className="space-y-3">
      {bars.map((b) => {
        const pct = total > 0 ? Math.round((b.count / total) * 100) : 0
        return (
          <div key={b.label}>
            <div className="mb-1 flex items-center justify-between text-xs text-neutral-600">
              <span className="font-medium">{b.label}</span>
              <span className="tabular-nums">{b.count} 次 · {pct}%</span>
            </div>
            <div className={`h-2 w-full overflow-hidden rounded-full ${b.bg}`}>
              <div
                className={`h-full rounded-full ${b.color} transition-all duration-500`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        )
      })}
      <p className="pt-1 text-xs text-neutral-400">共 {total} 个同步批次</p>
    </div>
  )
}

// ─── 快照指标行 ────────────────────────────────────────────────────────────

function SnapshotRow({ snapshot }: { snapshot: PartnerStatsResponse['snapshot'] }) {
  const items = [
    { label: '当前已发布岗位', value: snapshot.publishedJobs, icon: BriefcaseIcon },
    { label: '当前已发布招聘会', value: snapshot.publishedFairs, icon: CalendarIcon },
    { label: '启用数据源', value: snapshot.activeSources, icon: DatabaseIcon },
  ]
  return (
    <div className="grid grid-cols-3 gap-3">
      {items.map((item) => {
        const Icon = item.icon
        return (
          <Card key={item.label} className="flex items-center gap-3 p-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-primary-50 text-primary-600">
              <Icon className="h-4 w-4" aria-hidden="true" />
            </div>
            <div>
              <p className="text-[11.5px] font-medium text-neutral-500">{item.label}</p>
              <p className="mt-0.5 text-[1.4rem] font-bold tabular-nums leading-none text-neutral-900">
                {item.value.toLocaleString()}
              </p>
              <p className="mt-0.5 text-[10.5px] text-neutral-400">当前快照 · 不随时间选择器变化</p>
            </div>
          </Card>
        )
      })}
    </div>
  )
}

// ─── 主页面 ────────────────────────────────────────────────────────────────

export default function StatsPage() {
  const [period, setPeriod] = useState<StatsPeriod>('week')
  const [data, setData] = useState<PartnerStatsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(false)
    getPartnerStats(period)
      .then((d) => { if (!cancelled) { setData(d); setLoading(false) } })
      .catch(() => { if (!cancelled) { setError(true); setLoading(false) } })
    return () => { cancelled = true }
  }, [period])

  const periodLabel = PERIODS.find((p) => p.value === period)?.label ?? ''

  return (
    <Page title="数据统计" subtitle="岗位与招聘会数据统计">
      <EmptyState
        icon={BarChart2Icon}
        title="统计报表本阶段不开放"
        description="岗位与招聘会请在「数据源 / 同步日志 / 工作台」查看真实业务数据。本页不做假报表或演示图表。"
      />
    </Page>
  )
}
