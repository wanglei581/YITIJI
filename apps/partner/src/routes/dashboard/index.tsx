import { useCallback, useEffect, useState, type ElementType, type ReactNode } from 'react'
import { Button, Card, StatusBadge, LoadingState, ErrorState, EmptyState } from '@ai-job-print/ui'
import { Page } from '../Page'
import {
  AlertCircleIcon, BriefcaseIcon, CalendarIcon, CheckCircleIcon, ClockIcon,
  DatabaseIcon, RefreshCwIcon, XCircleIcon,
} from 'lucide-react'
import { getPartnerDashboard, type PartnerDashboard } from '../../services/api'

// ─── 展示映射 ───────────────────────────────────────────────────────────────────

type Badge = 'success' | 'warning' | 'error' | 'info' | 'default'

const REVIEW_MAP: Record<string, { badge: Badge; label: string }> = {
  pending: { badge: 'warning', label: '待审核' },
  reviewing: { badge: 'info', label: '审核中' },
  approved: { badge: 'success', label: '已通过' },
  rejected: { badge: 'error', label: '已拒绝' },
}
const PUBLISH_MAP: Record<string, { badge: Badge; label: string }> = {
  draft: { badge: 'default', label: '草稿' },
  published: { badge: 'success', label: '已发布' },
  unpublished: { badge: 'default', label: '已下架' },
  expired: { badge: 'default', label: '已过期' },
}
const SYNC_RESULT_MAP: Record<string, { badge: Badge; label: string }> = {
  success: { badge: 'success', label: '成功' },
  partial: { badge: 'warning', label: '部分失败' },
  failed: { badge: 'error', label: '失败' },
}
const DATA_TYPE_LABELS: Record<string, string> = { job: '岗位', fair: '招聘会' }

function reviewView(s: string) { return REVIEW_MAP[s] ?? { badge: 'default' as Badge, label: s } }
function publishView(s: string) { return PUBLISH_MAP[s] ?? { badge: 'default' as Badge, label: s } }
function syncView(s: string) { return SYNC_RESULT_MAP[s] ?? { badge: 'default' as Badge, label: s } }

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const [data, setData] = useState<PartnerDashboard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setData(await getPartnerDashboard())
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载数据看板失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  if (loading) {
    return <Page title="工作台" subtitle="合作机构数据概览"><LoadingState text="加载数据看板中…" className="py-16" /></Page>
  }
  if (error || !data) {
    return (
      <Page title="工作台" subtitle="合作机构数据概览">
        <ErrorState title="加载数据看板失败" message={error ?? '未知错误'} onRetry={() => void load()} />
      </Page>
    )
  }

  const { org, stats, recentSyncLogs, recentJobs, recentJobFairs, updatedAt } = data
  const isEmpty = stats.jobCount === 0 && stats.jobFairCount === 0 && stats.syncSourceCount === 0

  const refreshBtn = (
    <Button size="sm" variant="outline" className="flex items-center gap-1.5" onClick={() => void load()}>
      <RefreshCwIcon className="h-4 w-4" />
      刷新
    </Button>
  )

  return (
    <Page title="工作台" subtitle={`合作机构数据概览 · ${org.name}`} actions={refreshBtn}>
      <p className="mb-4 text-xs text-gray-400">
        数据更新时间：{fmtTime(updatedAt)}
        {stats.lastSyncTime && <span className="ml-3">最近同步：{fmtTime(stats.lastSyncTime)}</span>}
      </p>

      {isEmpty ? (
        <EmptyState
          icon={DatabaseIcon}
          title="暂无数据"
          description="配置数据源或提交岗位 / 招聘会信息后，统计会显示在这里。"
        />
      ) : (
        <div className="flex flex-col gap-6">
          {stats.pendingReviewCount > 0 && (
            <div className="flex items-center gap-3 rounded-xl border border-orange-200 bg-orange-50 px-5 py-4">
              <AlertCircleIcon className="h-5 w-5 shrink-0 text-orange-500" />
              <div>
                <p className="text-sm font-semibold text-orange-800">有 {stats.pendingReviewCount} 条数据待管理员审核</p>
                <p className="mt-0.5 text-xs text-orange-600">数据提交后需经管理员审核，通过后才会在终端展示</p>
              </div>
            </div>
          )}

          {/* 统计卡 */}
          <section aria-label="数据概览">
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">数据概览</h2>
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
              <Metric label="岗位数量" value={stats.jobCount} icon={BriefcaseIcon} iconClass="bg-blue-50 text-blue-600" />
              <Metric label="招聘会数量" value={stats.jobFairCount} icon={CalendarIcon} iconClass="bg-purple-50 text-purple-600" />
              <Metric label="已发布" value={stats.publishedJobCount + stats.publishedFairCount} note={`岗位 ${stats.publishedJobCount} · 招聘会 ${stats.publishedFairCount}`} icon={CheckCircleIcon} iconClass="bg-green-50 text-green-600" />
              <Metric label="待审核" value={stats.pendingReviewCount} icon={ClockIcon} iconClass="bg-orange-50 text-orange-500" />
              <Metric label="已拒绝" value={stats.rejectedCount} icon={XCircleIcon} iconClass="bg-red-50 text-red-500" />
              <Metric label="数据源" value={stats.syncSourceCount} icon={DatabaseIcon} iconClass="bg-cyan-50 text-cyan-600" />
            </div>
          </section>

          {/* 最近同步记录 */}
          <Section title="最近同步记录">
            {recentSyncLogs.length === 0 ? (
              <CardEmpty text="暂无同步记录" />
            ) : (
              <SimpleTable headers={['数据源', '类型', '本次同步', '结果', '同步时间']}>
                {recentSyncLogs.map((s) => {
                  const r = syncView(s.status)
                  return (
                    <tr key={s.id} className="hover:bg-gray-50">
                      <td className="px-5 py-3 font-medium text-gray-800">{s.sourceName ?? '—'}</td>
                      <td className="px-5 py-3"><Tag>{DATA_TYPE_LABELS[s.dataType] ?? s.dataType}</Tag></td>
                      <td className="px-5 py-3 text-xs tabular-nums text-gray-600">成功 {s.successCount}{s.failCount > 0 && <span className="text-red-500"> · 失败 {s.failCount}</span>}</td>
                      <td className="px-5 py-3"><StatusBadge status={r.badge} label={r.label} /></td>
                      <td className="whitespace-nowrap px-5 py-3 text-xs tabular-nums text-gray-400">{fmtTime(s.createdAt)}</td>
                    </tr>
                  )
                })}
              </SimpleTable>
            )}
          </Section>

          {/* 最近岗位 / 招聘会 */}
          <div className="grid gap-6 lg:grid-cols-2">
            <Section title="最近岗位">
              {recentJobs.length === 0 ? <CardEmpty text="暂无岗位数据" /> : (
                <SimpleTable headers={['岗位', '来源', '审核', '发布']}>
                  {recentJobs.map((j) => (
                    <tr key={j.id} className="hover:bg-gray-50">
                      <td className="max-w-[12rem] px-5 py-3 text-gray-800"><span className="line-clamp-1">{j.title}</span></td>
                      <td className="px-5 py-3 text-xs text-gray-500">{j.sourceName ?? '—'}</td>
                      <td className="px-5 py-3"><StatusBadge status={reviewView(j.reviewStatus).badge} label={reviewView(j.reviewStatus).label} /></td>
                      <td className="px-5 py-3"><StatusBadge status={publishView(j.publishStatus).badge} label={publishView(j.publishStatus).label} /></td>
                    </tr>
                  ))}
                </SimpleTable>
              )}
            </Section>
            <Section title="最近招聘会">
              {recentJobFairs.length === 0 ? <CardEmpty text="暂无招聘会数据" /> : (
                <SimpleTable headers={['招聘会', '来源', '审核', '开始时间']}>
                  {recentJobFairs.map((f) => (
                    <tr key={f.id} className="hover:bg-gray-50">
                      <td className="max-w-[12rem] px-5 py-3 text-gray-800"><span className="line-clamp-1">{f.title}</span></td>
                      <td className="px-5 py-3 text-xs text-gray-500">{f.sourceName ?? '—'}</td>
                      <td className="px-5 py-3"><StatusBadge status={reviewView(f.reviewStatus).badge} label={reviewView(f.reviewStatus).label} /></td>
                      <td className="whitespace-nowrap px-5 py-3 text-xs tabular-nums text-gray-400">{fmtTime(f.startTime)}</td>
                    </tr>
                  ))}
                </SimpleTable>
              )}
            </Section>
          </div>
        </div>
      )}

      <p className="mt-4 text-xs text-gray-400">
        以上为本机构岗位 / 招聘会 / 数据源 / 同步的真实统计；不含访问量趋势等推测数据，仅展示真实计数。
      </p>
    </Page>
  )
}

// ─── 小组件 ─────────────────────────────────────────────────────────────────────

function Metric({ label, value, note, icon: Icon, iconClass }: { label: string; value: number; note?: string; icon: ElementType; iconClass: string }) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-xs text-gray-500">{label}</p>
          <p className="mt-1.5 text-2xl font-bold tabular-nums text-gray-900">{value}</p>
          {note && <p className="mt-1 text-[10px] text-gray-400">{note}</p>}
        </div>
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${iconClass}`}>
          <Icon className="h-5 w-5" aria-hidden="true" />
        </div>
      </div>
    </Card>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-400">{title}</h2>
      {children}
    </section>
  )
}

function SimpleTable({ headers, children }: { headers: string[]; children: ReactNode }) {
  return (
    <Card className="overflow-hidden p-0">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-100 bg-gray-50">
            <tr>{headers.map((h, i) => <th key={i} className="whitespace-nowrap px-5 py-3 text-left text-xs font-medium text-gray-500">{h}</th>)}</tr>
          </thead>
          <tbody className="divide-y divide-gray-100">{children}</tbody>
        </table>
      </div>
    </Card>
  )
}

function CardEmpty({ text }: { text: string }) {
  return <Card className="p-6"><p className="text-center text-xs text-gray-400">{text}</p></Card>
}

function Tag({ children }: { children: ReactNode }) {
  return <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{children}</span>
}
