// ============================================================
// FreshmanInsightsPage — 新生大数据看板（/smart-campus/freshman-insights）
//
// 迎新报到聚合统计的一体机大屏看板：报到总览 / 男女比例 / 年龄分布 /
// 热门专业 TOP5 / 生源地排行 / 学院报到进度。
//
// 本期使用 mock 聚合数据（getFreshmanInsights），结构对齐真实接口形状，
// 后续可无缝替换为真实迎新/教务聚合接口。
//
// 合规（compliance-boundary.md §九）：仅展示聚合统计，绝不含任何个人身份信息，
// 不在本终端采集任何个人信息。无招聘闭环语义。图表均为纯 CSS/Tailwind，无新依赖。
// ============================================================

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Button, Card, ErrorState, LoadingState } from '@ai-job-print/ui'
import { useNavigate } from 'react-router-dom'
import {
  BarChart3Icon,
  Building2Icon,
  CalendarCheckIcon,
  GraduationCapIcon,
  MapPinIcon,
  PieChartIcon,
  ShieldCheckIcon,
  TrendingUpIcon,
  UserRoundCheckIcon,
  UsersIcon,
  type LucideIcon,
} from 'lucide-react'
import { getFreshmanInsights, type FreshmanInsights } from '../../services/api/freshmanInsights'

const fmt = (n: number): string => n.toLocaleString('en-US')
/** 占比/比率，保留 1 位小数。 */
const rate1 = (n: number, d: number): number => (d > 0 ? Math.round((n / d) * 1000) / 10 : 0)

type Tone = 'indigo' | 'emerald' | 'cyan' | 'violet'
const TONES: Record<Tone, { chip: string; fill: string }> = {
  indigo: { chip: 'bg-indigo-50 text-indigo-600', fill: 'bg-indigo-500' },
  emerald: { chip: 'bg-emerald-50 text-emerald-600', fill: 'bg-emerald-500' },
  cyan: { chip: 'bg-cyan-50 text-cyan-600', fill: 'bg-cyan-500' },
  violet: { chip: 'bg-violet-50 text-violet-600', fill: 'bg-violet-500' },
}

export function FreshmanInsightsPage() {
  const navigate = useNavigate()
  const [data, setData] = useState<FreshmanInsights | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(false)
    try {
      setData(await getFreshmanInsights())
    } catch {
      setError(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-canvas p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">新生大数据</h1>
          <p className="mt-0.5 text-sm text-gray-500">迎新报到实时概览</p>
        </div>
        <Button size="sm" variant="secondary" onClick={() => navigate('/smart-campus')}>
          返回
        </Button>
      </div>

      {/* 合规来源条 */}
      <div className="mb-5 flex items-start gap-2 rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-3">
        <ShieldCheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-indigo-600" aria-hidden="true" />
        <p className="text-xs leading-relaxed text-indigo-900">
          仅展示迎新报到的<span className="font-semibold">聚合统计</span>，不含任何个人身份信息，也不在本终端采集任何个人信息。
        </p>
      </div>

      {loading ? (
        <LoadingState text="正在加载新生大数据…" />
      ) : error || !data ? (
        <ErrorState title="数据加载失败" message="请稍后重试" onRetry={() => void load()} />
      ) : (
        <Board data={data} />
      )}
    </div>
  )
}

function Board({ data }: { data: FreshmanInsights }) {
  const { overview, gender, ageDistribution, topMajors, origins, colleges } = data
  const reportRate = rate1(overview.checkedIn, overview.total)
  const genderTotal = gender.male + gender.female
  const malePct = rate1(gender.male, genderTotal)
  const femalePct = rate1(gender.female, genderTotal)
  const maxAge = Math.max(...ageDistribution.map((a) => a.count), 1)
  const maxMajor = Math.max(...topMajors.map((m) => m.count), 1)
  const maxOrigin = Math.max(...origins.map((o) => o.count), 1)

  return (
    <>
      {/* 数据更新 / 示例数据标识 */}
      <div className="mb-4 flex items-center gap-2 text-xs text-gray-400">
        <span>数据更新 {data.updatedAt}</span>
        {data.isMock && (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 font-medium text-amber-600">示例数据</span>
        )}
      </div>

      {/* 报到总览 */}
      <div className="mb-4 grid grid-cols-2 gap-4">
        <KpiCard icon={UsersIcon} tone="indigo" label="新生总数" value={fmt(overview.total)} />
        <KpiCard icon={UserRoundCheckIcon} tone="emerald" label="已报到" value={fmt(overview.checkedIn)} />
        <KpiCard icon={TrendingUpIcon} tone="cyan" label="报到率" value={`${reportRate}%`} bar={reportRate} />
        <KpiCard icon={CalendarCheckIcon} tone="violet" label="今日报到" value={fmt(overview.todayCheckedIn)} />
      </div>

      {/* 男女比例 */}
      <Section icon={PieChartIcon} title="男女比例">
        <div className="flex items-center gap-6">
          <div className="relative h-36 w-36 shrink-0">
            <div
              className="h-36 w-36 rounded-full"
              style={{ background: `conic-gradient(#4f46e5 0 ${malePct}%, #22d3ee ${malePct}% 100%)` }}
              aria-hidden="true"
            />
            <div className="absolute inset-[14px] flex flex-col items-center justify-center rounded-full bg-white">
              <span className="text-[11px] text-gray-400">男 : 女</span>
              <span className="text-lg font-bold text-gray-900">
                {Math.round(malePct)} : {Math.round(femalePct)}
              </span>
            </div>
          </div>
          <div className="flex-1 space-y-3">
            <GenderLegend dot="bg-indigo-600" label="男生" count={gender.male} pct={malePct} />
            <GenderLegend dot="bg-cyan-400" label="女生" count={gender.female} pct={femalePct} />
          </div>
        </div>
      </Section>

      {/* 年龄分布 */}
      <Section icon={BarChart3Icon} title="年龄分布">
        <div className="space-y-3.5">
          {ageDistribution.map((b) => (
            <div key={b.label} className="flex items-center gap-3">
              <span className="w-20 shrink-0 text-sm text-gray-600">{b.label}</span>
              <div className="h-3 flex-1 overflow-hidden rounded-full bg-gray-100">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-violet-500"
                  style={{ width: `${rate1(b.count, maxAge)}%` }}
                />
              </div>
              <span className="w-14 shrink-0 text-right text-sm font-semibold text-gray-900">{fmt(b.count)}</span>
            </div>
          ))}
        </div>
      </Section>

      {/* 热门专业 TOP5 */}
      <Section icon={GraduationCapIcon} title="热门专业 TOP5">
        <div className="space-y-3.5">
          {topMajors.map((m, i) => (
            <RankBar
              key={m.name}
              rank={i + 1}
              name={m.name}
              meta={`${fmt(m.count)} 人 · ${rate1(m.count, overview.total)}%`}
              width={rate1(m.count, maxMajor)}
              fill="bg-cyan-500"
            />
          ))}
        </div>
      </Section>

      {/* 生源地排行 */}
      <Section icon={MapPinIcon} title="生源地排行">
        <div className="space-y-3.5">
          {origins.map((o, i) => (
            <RankBar
              key={o.region}
              rank={i + 1}
              name={o.region}
              meta={`${fmt(o.count)} 人 · ${rate1(o.count, overview.total)}%`}
              width={rate1(o.count, maxOrigin)}
              fill="bg-violet-500"
            />
          ))}
        </div>
      </Section>

      {/* 学院报到进度 */}
      <Section icon={Building2Icon} title="学院报到进度">
        <div className="space-y-3.5">
          {colleges.map((c) => {
            const r = rate1(c.checkedIn, c.total)
            return (
              <div key={c.name}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-gray-800">{c.name}</span>
                  <span className="text-xs text-gray-400">
                    已报到 {fmt(c.checkedIn)} / {fmt(c.total)} ·{' '}
                    <span className="font-semibold text-emerald-600">{r}%</span>
                  </span>
                </div>
                <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-gray-100">
                  <div className="h-full rounded-full bg-emerald-500" style={{ width: `${r}%` }} />
                </div>
              </div>
            )
          })}
        </div>
      </Section>

      <p className="px-1 pt-1 text-[11px] leading-relaxed text-gray-400">
        以上为聚合统计示例数据，不含任何个人信息；后续将接入学校迎新 / 教务聚合数据。
      </p>

      <div className="h-2" />
    </>
  )
}

function KpiCard({
  icon: Icon,
  tone,
  label,
  value,
  bar,
}: {
  icon: LucideIcon
  tone: Tone
  label: string
  value: string
  bar?: number
}) {
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <div className={['flex h-9 w-9 items-center justify-center rounded-lg', TONES[tone].chip].join(' ')}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
        <span className="text-sm text-gray-500">{label}</span>
      </div>
      <div className="mt-3 text-3xl font-bold tracking-tight text-gray-900">{value}</div>
      {bar !== undefined && (
        <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-gray-100">
          <div className={['h-full rounded-full', TONES[tone].fill].join(' ')} style={{ width: `${bar}%` }} />
        </div>
      )}
    </Card>
  )
}

function Section({ icon: Icon, title, children }: { icon: LucideIcon; title: string; children: ReactNode }) {
  return (
    <Card className="mb-4 p-5">
      <div className="mb-4 flex items-center gap-2">
        <Icon className="h-4 w-4 text-indigo-600" aria-hidden="true" />
        <p className="text-sm font-semibold text-gray-700">{title}</p>
      </div>
      {children}
    </Card>
  )
}

function GenderLegend({ dot, label, count, pct }: { dot: string; label: string; count: number; pct: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className={['h-3 w-3 shrink-0 rounded-full', dot].join(' ')} aria-hidden="true" />
      <span className="text-sm text-gray-600">{label}</span>
      <span className="ml-auto text-sm font-semibold text-gray-900">{fmt(count)}</span>
      <span className="w-14 text-right text-xs text-gray-400">{pct}%</span>
    </div>
  )
}

function RankBar({
  rank,
  name,
  meta,
  width,
  fill,
}: {
  rank: number
  name: string
  meta: string
  width: number
  fill: string
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-indigo-50 text-xs font-bold text-indigo-600">
        {rank}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-medium text-gray-800">{name}</span>
          <span className="shrink-0 text-xs text-gray-400">{meta}</span>
        </div>
        <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-gray-100">
          <div className={['h-full rounded-full', fill].join(' ')} style={{ width: `${width}%` }} />
        </div>
      </div>
    </div>
  )
}
