// Partner 数据统计页 — /stats
//
// 数据来源：getPartnerStats() → GET /partner/stats?period=week|month|quarter
// orgId 取自 token，本页不发送任何机构标识，跨机构数据不可达。
//
// ── 诚实口径（C1，2026-08-16）──────────────────────────────────────────────
//
// 本页只展示后端真实算出来的东西：
//   - snapshot：本机构在架内容计数 + 待审核数（当前快照，不随周期变化）
//   - sync：周期内同步批次 / 成功率 / 新增 / 失败，含等长基期环比
//   - trend / statusDist：周期内按上海日历日的同步趋势与状态分布
//
// 本页**刻意不展示**曝光 / 详情浏览 / 打开来源平台 / 资料打印 / 转化漏斗 /
// 内容排行 / 时段与点位分布 —— `BrowseLog` 与 `ExternalJumpLog` 都没有
// `sourceOrgId` 字段，按机构归因无从算起。用 targetId 反查 Job.sourceOrgId
// 只能拿到**当前**归属、不是不可变快照，内容换来源机构后历史会漂移，
// 因此不做该 join，也不给估算值。归因区块如实显示「暂无归因数据」。
//
// 合规（CLAUDE.md §2 / §9）：
//   - 统计口径只有浏览、外部跳转、打印、AI 调用；
//     「打开来源平台」只表示点击外部入口的次数，
//     **不代表投递、意向或简历相关的任何结果**；
//     用户可见文案一律遵守 CLAUDE.md §2 的投递/预约文案白名单。
//   - 只给机构级聚合，最小样本阈值 N≥5，不出个人明细。

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Button,
  Card,
  ErrorState,
  LoadingState,
  SectionCard,
  TrendLineChart,
} from '@ai-job-print/ui'
import {
  BriefcaseIcon,
  BuildingIcon,
  CalendarIcon,
  DatabaseIcon,
  FileTextIcon,
  InfoIcon,
  RefreshCwIcon,
} from 'lucide-react'
import { Page } from '../Page'
import {
  getPartnerStats,
  type PartnerStatsResponse,
  type StatsMetric,
  type StatsPeriod,
} from '../../services/api/stats'

// ─── 时间范围选择器 ────────────────────────────────────────────────────────

const PERIODS: { value: StatsPeriod; label: string }[] = [
  { value: 'week',    label: '本周' },
  { value: 'month',   label: '本月' },
  { value: 'quarter', label: '本季度' },
]

function PeriodSelector({
  value,
  onChange,
}: {
  value: StatsPeriod
  onChange: (p: StatsPeriod) => void
}) {
  return (
    <div
      role="group"
      aria-label="统计周期"
      className="flex rounded-lg border border-neutral-200 bg-surface text-sm"
    >
      {PERIODS.map((p) => (
        <button
          key={p.value}
          type="button"
          aria-pressed={value === p.value}
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

// ─── 在架内容快照 ──────────────────────────────────────────────────────────

function SnapshotRow({ snapshot }: { snapshot: PartnerStatsResponse['snapshot'] }) {
  const items = [
    { label: '在架岗位',   value: snapshot.publishedJobs,      icon: BriefcaseIcon, tone: 'bg-primary-50 text-primary-600' },
    { label: '在架招聘会', value: snapshot.publishedFairs,     icon: CalendarIcon,  tone: 'bg-info-bg text-info-fg' },
    { label: '在架企业',   value: snapshot.publishedCompanies, icon: BuildingIcon,  tone: 'bg-purple-50 text-purple-600' },
    { label: '在架政策',   value: snapshot.publishedPolicies,  icon: FileTextIcon,  tone: 'bg-cyan-50 text-cyan-600' },
    { label: '启用数据源', value: snapshot.activeSources,      icon: DatabaseIcon,  tone: 'bg-warning-bg text-warning-fg' },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      {items.map((item) => {
        const Icon = item.icon
        return (
          <Card key={item.label} className="flex items-center gap-3 p-4">
            <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] ${item.tone}`}>
              <Icon className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <p className="text-[11.5px] font-medium text-neutral-500">{item.label}</p>
              <p className="mt-0.5 text-[1.4rem] font-bold tabular-nums leading-none text-neutral-900">
                {item.value.toLocaleString()}
              </p>
            </div>
          </Card>
        )
      })}
    </div>
  )
}

// ─── 环比指标卡 ────────────────────────────────────────────────────────────

function DeltaText({ metric }: { metric: StatsMetric }) {
  // deltaPercent=null 代表无可比基期，照实说明，不显示 ∞% 也不伪造 0%
  if (metric.deltaPercent === null) {
    return <span className="text-[10.5px] text-neutral-400">无可比基期</span>
  }
  const up = metric.deltaPercent > 0
  const flat = metric.deltaPercent === 0
  const tone = flat ? 'text-neutral-500' : up ? 'text-success-fg' : 'text-error-fg'
  const sign = up ? '+' : ''
  return (
    <span className={`text-[10.5px] font-medium ${tone}`}>
      {sign}
      {metric.deltaPercent}% {metric.comparisonLabel}
    </span>
  )
}

function SyncMetrics({ sync }: { sync: PartnerStatsResponse['sync'] }) {
  const items: { label: string; metric: StatsMetric; suffix?: string }[] = [
    { label: '同步批次',   metric: sync.totalBatches },
    { label: '同步成功率', metric: sync.successRate, suffix: '%' },
    { label: '新增内容',   metric: sync.totalAdded },
    { label: '同步失败',   metric: sync.totalFailed },
  ]
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((item) => (
        <Card key={item.label} className="p-4">
          <p className="text-[11.5px] font-medium text-neutral-500">{item.label}</p>
          <p className="mt-1.5 text-[1.5rem] font-bold tabular-nums leading-none text-neutral-900">
            {item.metric.current.toLocaleString()}
            {item.suffix ?? ''}
          </p>
          <p className="mt-1.5">
            <DeltaText metric={item.metric} />
          </p>
        </Card>
      ))}
    </div>
  )
}

// ─── 状态分布 ──────────────────────────────────────────────────────────────

function StatusDistCard({ dist }: { dist: PartnerStatsResponse['statusDist'] }) {
  const total = dist.success + dist.partial + dist.failed
  if (total === 0) {
    return (
      <p className="py-8 text-center text-sm text-neutral-400">本周期暂无同步记录</p>
    )
  }
  const bars = [
    { label: '成功', count: dist.success, color: 'bg-success', bg: 'bg-success-bg' },
    { label: '部分', count: dist.partial, color: 'bg-warning', bg: 'bg-warning-bg' },
    { label: '失败', count: dist.failed,  color: 'bg-error',   bg: 'bg-error-bg'   },
  ]
  return (
    <div className="space-y-3">
      {bars.map((b) => {
        const pct = Math.round((b.count / total) * 100)
        return (
          <div key={b.label}>
            <div className="mb-1 flex items-center justify-between text-xs text-neutral-600">
              <span className="font-medium">{b.label}</span>
              <span className="tabular-nums">
                {b.count} 次 · {pct}%
              </span>
            </div>
            <div className={`h-2 w-full overflow-hidden rounded-full ${b.bg}`}>
              <div className={`h-full rounded-full ${b.color}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        )
      })}
      <p className="pt-1 text-xs text-neutral-400">共 {total} 个同步批次</p>
    </div>
  )
}

// ─── 归因不可用说明（不伪造漏斗）──────────────────────────────────────────

function AttributionNotice({
  attribution,
}: {
  attribution: PartnerStatsResponse['attribution']
}) {
  return (
    <Card className="border-neutral-300 bg-neutral-50/60 p-5">
      <div className="flex gap-3">
        <InfoIcon className="mt-0.5 h-4 w-4 shrink-0 text-neutral-500" aria-hidden="true" />
        <div className="min-w-0 space-y-2 text-sm text-neutral-600">
          <p className="font-bold text-neutral-800">曝光与跳转效果：暂无归因数据</p>
          <p>
            列表曝光、详情浏览、打开来源平台、资料打印这四项，以及由它们组成的转化漏斗、
            内容排行、时段与点位分布，<strong>当前都算不出来</strong>——
            终端的浏览与外部跳转日志里没有记录内容归属的机构快照，
            无法把某一次浏览安全地算到本机构名下。
          </p>
          <p>
            用内容 ID 反查当前来源机构在技术上可行，但那不是不可变快照：
            内容之后换了来源机构，历史统计就会跟着变。
            <strong>本页宁可留空，也不给一个会漂移的漏斗。</strong>
          </p>
          <p className="text-xs text-neutral-500">
            归因能力落地后，任一分组样本不足 {attribution.minSampleThreshold} 条时将显示「样本不足」而非数字，
            只提供机构级聚合，不提供求职者个人明细。
          </p>
          <p className="text-xs text-neutral-500">
            口径说明：本平台不做平台内投递，「打开来源平台」只统计点击外部入口的次数，
            不代表投递结果，系统也不记录办理结果。
          </p>
        </div>
      </div>
    </Card>
  )
}

// ─── 周期内无同步活动的空态 ────────────────────────────────────────────────

function NoActivityState({
  data,
  periodLabel,
  onRetry,
}: {
  data: PartnerStatsResponse
  periodLabel: string
  onRetry: () => void
}) {
  const navigate = useNavigate()
  const { pendingReview, activeSources } = data.snapshot
  const hasContent =
    data.snapshot.publishedJobs +
      data.snapshot.publishedFairs +
      data.snapshot.publishedCompanies +
      data.snapshot.publishedPolicies >
    0

  // 按最可能的原因给出下一步，而不是一句「暂无数据」
  let reason: string
  if (activeSources === 0) {
    reason = '本机构当前没有启用中的数据源，因此不会产生同步批次。先去数据源页配置并启用一个来源。'
  } else if (pendingReview > 0) {
    reason = `本机构有 ${pendingReview} 条内容还在等管理员审核，审核通过并发布后才会在终端展示。`
  } else if (!hasContent) {
    reason = '本机构还没有已发布的内容，先导入岗位或招聘会，通过审核后即可在终端展示。'
  } else {
    reason = `内容已在架，只是${periodLabel}内数据源没有跑过同步批次。数据源按配置的周期拉取，也可以在数据源页手动触发。`
  }

  return (
    <Card className="p-8">
      <div className="mx-auto max-w-xl text-center">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-neutral-100 text-neutral-500">
          <RefreshCwIcon className="h-5 w-5" aria-hidden="true" />
        </div>
        <h3 className="mt-3 text-[15px] font-bold text-neutral-800">
          {periodLabel}内没有同步记录
        </h3>
        <p className="mt-2 text-sm text-neutral-600">{reason}</p>
        <div className="mt-5 flex flex-wrap justify-center gap-2.5">
          <Button size="sm" variant="primary" onClick={() => navigate('/sources')}>
            去数据源配置
          </Button>
          <Button size="sm" variant="secondary" onClick={() => navigate('/sync-logs')}>
            查看同步日志
          </Button>
          <Button size="sm" variant="ghost" onClick={onRetry}>
            重新加载
          </Button>
        </div>
      </div>
    </Card>
  )
}

// ─── 主页面 ────────────────────────────────────────────────────────────────

export default function StatsPage() {
  const [period, setPeriod] = useState<StatsPeriod>('week')
  const [data, setData] = useState<PartnerStatsResponse | null>(null)
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading')
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setState('loading')
    getPartnerStats(period)
      .then((d) => {
        if (cancelled) return
        setData(d)
        setState('ready')
      })
      .catch(() => {
        if (cancelled) return
        setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [period, reloadKey])

  const retry = () => setReloadKey((k) => k + 1)
  const periodLabel = PERIODS.find((p) => p.value === period)?.label ?? ''

  return (
    <Page
      title="数据统计"
      subtitle="我发布的内容产生了什么效果"
      actions={<PeriodSelector value={period} onChange={setPeriod} />}
    >
      {state === 'loading' ? (
        <LoadingState className="py-20" />
      ) : state === 'error' || !data ? (
        <ErrorState
          className="py-20"
          title="统计数据加载失败"
          message="无法读取本机构统计数据。你的内容展示不受影响。"
          onRetry={retry}
        />
      ) : (
        <div className="flex flex-col gap-6">
          {/* 在架内容 —— 当前快照，不随周期变化 */}
          <section aria-label="在架内容">
            <div className="mb-2.5 flex items-center gap-2">
              <span className="inline-block h-3.5 w-[3px] shrink-0 rounded-full bg-primary-500" aria-hidden="true" />
              <h2 className="text-[13px] font-bold text-neutral-700">在架内容</h2>
              <span className="text-[11.5px] text-neutral-400">当前快照 · 不随周期选择变化</span>
            </div>
            <SnapshotRow snapshot={data.snapshot} />
            {data.snapshot.pendingReview > 0 && (
              <p className="mt-2.5 text-xs text-neutral-500">
                另有 <strong className="tabular-nums text-neutral-700">{data.snapshot.pendingReview}</strong> 条内容待管理员审核，
                通过并发布后才会在终端展示。
              </p>
            )}
          </section>

          {/* 同步效果 —— 周期内，含环比 */}
          <section aria-label="同步效果">
            <div className="mb-2.5 flex items-center gap-2">
              <span className="inline-block h-3.5 w-[3px] shrink-0 rounded-full bg-primary-500" aria-hidden="true" />
              <h2 className="text-[13px] font-bold text-neutral-700">同步效果</h2>
              <span className="text-[11.5px] text-neutral-400">
                {data.period.label}（{data.period.from} ~ {data.period.to}）· 时区 {data.timezone}
              </span>
            </div>

            {data.sync.totalBatches.current === 0 ? (
              <NoActivityState data={data} periodLabel={periodLabel} onRetry={retry} />
            ) : (
              <div className="flex flex-col gap-4">
                <SyncMetrics sync={data.sync} />
                <div className="grid grid-cols-1 gap-4 xl:grid-cols-[2fr_1fr]">
                  <SectionCard title="按日同步趋势">
                    <TrendLineChart
                      labels={data.trend.map((b) => b.date.slice(5))}
                      series={[
                        { label: '新增', values: data.trend.map((b) => b.added) },
                        { label: '更新', values: data.trend.map((b) => b.updated) },
                        { label: '失败', values: data.trend.map((b) => b.failed) },
                      ]}
                      height={240}
                    />
                  </SectionCard>
                  <SectionCard title="同步状态分布">
                    <StatusDistCard dist={data.statusDist} />
                  </SectionCard>
                </div>
              </div>
            )}
          </section>

          {/* 归因 —— 恒不可用，如实说明 */}
          <section aria-label="曝光与跳转效果">
            <div className="mb-2.5 flex items-center gap-2">
              <span className="inline-block h-3.5 w-[3px] shrink-0 rounded-full bg-neutral-300" aria-hidden="true" />
              <h2 className="text-[13px] font-bold text-neutral-700">曝光与跳转效果</h2>
            </div>
            <AttributionNotice attribution={data.attribution} />
          </section>

          <p className="text-xs text-neutral-400">
            本后台仅管理来源数据，不在本系统内接收求职者简历，不参与招聘闭环。
            统计只覆盖浏览、外部跳转、打印与 AI 调用，且只提供机构级聚合。
          </p>
        </div>
      )}
    </Page>
  )
}
