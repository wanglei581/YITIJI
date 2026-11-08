import { PartnerAiServices } from './PartnerAiServices'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FIRST_ORDER_ISSUE_LABELS, formatCount, formatDate, type FirstOrderOverview } from '@ai-job-print/shared'
import { Card } from '@ai-job-print/ui'
import { FRONTEND_HINT, Page, withFrontendHint } from '../Page'
import { FIRST_ORDER_HTTP, firstOrderApi } from '../../services/api/firstOrder'
import { getPartnerDashboard, type PartnerDashboardData } from '../../services/api/orgSelf'
import { partnerPoliciesService, type PartnerPolicyPage } from '../../services/api/policies'
import { getPartnerStats, type PartnerStatsResponse } from '../../services/api/stats'
import { getPartnerTerminalOperations, type PartnerTerminalOpsView } from '../../services/api/terminalOps'
import { OrgNoticesSection, type OrgNoticeOutcome } from './OrgNoticesSection'
import { RecruitmentOverview } from './RecruitmentOverview'
import { LicenseNotice } from './LicenseNotice'

type Load<T> = { status: 'loading' | 'error' | 'ready'; data: T | null }
type OverviewLoad =
  | { kind: 'preview' }
  | { kind: 'loading' }
  | { kind: 'error' }
  | { kind: 'ready'; data: FirstOrderOverview }

const EMPTY_TODAY = '今天没有要核对的事'
const MISS = '这类这次没读到'
const MONTH_PREVIEW = '本月月报可以预览，北京时间下月 1 日起才能留存'
const NO_PROJECT = '尚未登记服务项目，请联系平台核对'
const PREVIEW_NOTE = '项目交付与服务需要连接真实后端。当前为预览模式，不提供演示数据或模拟操作。'
const INCIDENTS = '/terminals?tab=delivery&section=incidents'
const REPORTS = '/terminals?tab=delivery&section=reports'
const PROJECT = '/terminals?tab=delivery&section=project'

function shanghaiMonth(date = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit' }).format(date).slice(0, 7)
}

function shanghaiToday(date = new Date()): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date)
}

function BlockMiss({ onRetry }: { onRetry: () => void }) {
  return (
    <div role="alert" className="flex items-center justify-between gap-3 rounded-lg border border-warning/30 bg-warning-bg px-3 py-2 text-sm text-warning-fg">
      <span>{MISS}</span>
      <button type="button" onClick={onRetry} className="inline-flex min-h-11 shrink-0 items-center rounded-md border border-warning/40 px-3 text-sm font-semibold">重试</button>
    </div>
  )
}

function useLoad<T>(read: () => Promise<T>, reloadKey: number): Load<T> {
  const [load, setLoad] = useState<Load<T>>({ status: 'loading', data: null })
  useEffect(() => {
    let alive = true
    setLoad((prev) => ({ status: 'loading', data: prev.data }))
    read()
      .then((data) => { if (alive) setLoad({ status: 'ready', data }) })
      .catch(() => { if (alive) setLoad((prev) => ({ status: 'error', data: prev.data })) })
    return () => { alive = false }
    // read 是每次渲染新建的函数，只跟 reloadKey 走，避免请求循环。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadKey])
  return load
}

export default function DashboardPage() {
  const [overviewKey, setOverviewKey] = useState(0)
  const [statsKey, setStatsKey] = useState(0)
  const [policyKey, setPolicyKey] = useState(0)
  const [dashKey, setDashKey] = useState(0)
  const [opsKey, setOpsKey] = useState(0)
  const [noticeOutcome, setNoticeOutcome] = useState<OrgNoticeOutcome>('loading')
  const [licenseAttention, setLicenseAttention] = useState(true)
  const onNoticeOutcome = useCallback((next: OrgNoticeOutcome) => {
    setNoticeOutcome((prev) => (prev === next ? prev : next))
  }, [])

  const [overview, setOverview] = useState<OverviewLoad>(FIRST_ORDER_HTTP ? { kind: 'loading' } : { kind: 'preview' })
  const [statsLoad, setStatsLoad] = useState<Load<PartnerStatsResponse['snapshot']>>({ status: 'loading', data: null })
  const policies = useLoad(() => partnerPoliciesService.getPolicies({ page: 1, pageSize: 100 }), policyKey)
  const dashboard = useLoad(() => getPartnerDashboard(), dashKey)
  const ops = useLoad(() => getPartnerTerminalOperations('week'), opsKey)

  useEffect(() => {
    let alive = true
    setStatsLoad((prev) => ({ status: 'loading', data: prev.data }))
    getPartnerStats('week')
      .then((stats) => {
        if (!alive) return
        setStatsLoad({ status: 'ready', data: stats.snapshot })
      })
      .catch(() => { if (alive) setStatsLoad((prev) => ({ status: 'error', data: prev.data })) })
    return () => { alive = false }
  }, [statsKey])

  useEffect(() => {
    if (!FIRST_ORDER_HTTP) {
      setOverview({ kind: 'preview' })
      return
    }
    let alive = true
    setOverview({ kind: 'loading' })
    firstOrderApi.overview()
      .then((data) => { if (alive) setOverview({ kind: 'ready', data }) })
      .catch(() => { if (alive) setOverview({ kind: 'error' }) })
    return () => { alive = false }
  }, [overviewKey])

  const stats = statsLoad
  const snapshot = stats.status === 'ready' ? stats.data : null
  const pendingCount = snapshot?.pendingReviewPolicies ?? null
  const policyTitles = policyTitlesFrom(policies, pendingCount)
  const month = shanghaiMonth()
  const actionable = countActionable(overview, pendingCount)
  const showEmpty = overview.kind === 'ready'
    && stats.status === 'ready'
    && policies.status === 'ready'
    && noticeOutcome === 'empty'
    && !licenseAttention
    && actionable === 0

  return (
    <Page title="工作台" subtitle={withFrontendHint(`${shanghaiToday()} 本机构今天要核对的事`, FRONTEND_HINT.none)}>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6">
          <section aria-label="今天要处理" className="space-y-4">
            <div className="flex items-center gap-2">
              <span className="inline-block h-3.5 w-[3px] shrink-0 rounded-full bg-primary-500" aria-hidden="true" />
              <h2 className="text-[13px] font-bold text-neutral-700">今天要处理</h2>
            </div>
            <ProjectBar overview={overview} />
            <LicenseNotice onAttention={setLicenseAttention} />
            {overview.kind === 'error' && <BlockMiss onRetry={() => setOverviewKey((k) => k + 1)} />}
            {overview.kind === 'ready' && <OverviewRows data={overview.data} month={month} />}
            {stats.status === 'error' && <BlockMiss onRetry={() => setStatsKey((k) => k + 1)} />}
            {pendingCount !== null && pendingCount > 0 && (
              <PolicyTodo count={pendingCount} titles={policyTitles} listStatus={policies.status} onRetry={() => setPolicyKey((k) => k + 1)} />
            )}
            {policies.status === 'error' && !(pendingCount !== null && pendingCount > 0) && <BlockMiss onRetry={() => setPolicyKey((k) => k + 1)} />}
            {showEmpty && <p className="text-sm text-neutral-600">{EMPTY_TODAY}</p>}
            <Link to={INCIDENTS} className="inline-flex h-14 min-h-14 items-center justify-center rounded-xl bg-primary-600 px-8 text-base font-bold text-white hover:bg-primary-700">报障</Link>
          </section>
          <RecruitmentOverview
            dashboard={dashboard}
            snapshot={snapshot}
            statsStatus={stats.status}
            onRetryDashboard={() => setDashKey((k) => k + 1)}
            onRetryStats={() => setStatsKey((k) => k + 1)}
          />
          <OrgNoticesSection onOutcome={onNoticeOutcome} />
        </div>
        <div className="min-w-0 space-y-4">
          <TerminalWeek ops={ops} overview={overview} onRetryOps={() => setOpsKey((k) => k + 1)} onRetryOverview={() => setOverviewKey((k) => k + 1)} />
          <PolicyGlance dashboard={dashboard} snapshot={snapshot} statsFailed={stats.status === 'error'} onRetryDash={() => setDashKey((k) => k + 1)} onRetryStats={() => setStatsKey((k) => k + 1)} />
        </div>
      </div>
    </Page>
  )
}

function policyTitlesFrom(policies: Load<PartnerPolicyPage>, pendingCount: number | null): { titles: string[]; partial: boolean } {
  if (policies.status !== 'ready' || !policies.data || pendingCount === null) return { titles: [], partial: false }
  const titles = policies.data.data
    .filter((row) => row.reviewStatus === 'pending' || row.reviewStatus === 'reviewing')
    .map((row) => row.title)
  const partial = pendingCount > titles.length || policies.data.pagination.total > policies.data.data.length
  return { titles, partial }
}

function countActionable(overview: OverviewLoad, pendingCount: number | null): number {
  let count = pendingCount ?? 0
  if (overview.kind !== 'ready') return count
  const month = shanghaiMonth()
  // 未关闭的报障都要让机构看见：刚提交待受理、平台处理中、技术恢复待核对
  count += overview.data.incidents.filter((item) => item.status !== 'closed').length
  count += overview.data.reports.filter((item) => item.month < month && !item.acknowledgedAt).length
  return count
}

function ProjectBar({ overview }: { overview: OverviewLoad }) {
  if (overview.kind === 'preview') {
    return <p className="rounded-xl border border-neutral-200 bg-surface px-4 py-3 text-sm text-neutral-600">{PREVIEW_NOTE}</p>
  }
  if (overview.kind === 'loading') return <p className="text-sm text-neutral-500">正在读取服务项目</p>
  if (overview.kind === 'error') return null
  const projects = overview.data.projects
  if (projects.length === 0) {
    return <p className="rounded-xl border border-neutral-200 bg-surface px-4 py-3 text-sm text-neutral-700">{NO_PROJECT}</p>
  }
  const first = projects[0]!
  const extra = projects.length > 1 ? `，另有 ${projects.length - 1} 个服务项目` : ''
  return (
    <Link to={PROJECT} className="block rounded-xl border border-neutral-200 bg-surface px-4 py-3 hover:border-primary-300">
      <p className="text-base font-semibold text-neutral-900">{first.name}{extra}</p>
      <p className="mt-1 text-sm text-neutral-600">服务范围：{first.serviceScope}</p>
      <p className="mt-0.5 text-sm text-neutral-600">服务至 {formatDate(first.serviceEndAt)}</p>
      <p className="mt-0.5 text-sm text-neutral-600">服务联系：{first.supportContact}</p>
    </Link>
  )
}

function OverviewRows({ data, month }: { data: FirstOrderOverview; month: string }) {
  const incidents = data.incidents.filter((item) => item.status !== 'closed')
  const reports = data.reports.filter((item) => item.month < month && !item.acknowledgedAt)
  return (
    <ul className="space-y-2">
      {incidents.map((item) => {
        const issue = FIRST_ORDER_ISSUE_LABELS[item.issueCode] ?? '设备问题'
        const waiting = item.status === 'resolved'
        return (
          <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-surface px-4 py-3">
            <p className="text-sm text-neutral-800">
              <span className="font-semibold">{item.terminalCode}</span>
              {' · '}{issue}{' · '}{waiting ? '技术恢复，待你核对' : item.status === 'open' ? '已提交，等平台受理' : '平台处理中'}
            </p>
            <Link to={INCIDENTS} className="inline-flex min-h-11 items-center text-sm font-semibold text-primary-700">{waiting ? '去核对' : '看进度'}</Link>
          </li>
        )
      })}
      {reports.map((item) => (
        <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-neutral-200 bg-surface px-4 py-3">
          <p className="text-sm font-semibold text-neutral-800">{item.month} 月报已留存，待核对</p>
          <Link to={REPORTS} className="inline-flex min-h-11 items-center text-sm font-semibold text-primary-700">去核对</Link>
        </li>
      ))}
      <li className="rounded-xl border border-neutral-200 bg-surface px-4 py-3 text-sm text-neutral-600">
        {MONTH_PREVIEW}
        <Link to={REPORTS} className="ml-3 inline-flex min-h-11 items-center font-semibold text-primary-700">去预览</Link>
      </li>
    </ul>
  )
}

function PolicyTodo({ count, titles, listStatus, onRetry }: { count: number; titles: { titles: string[]; partial: boolean }; listStatus: Load<PartnerPolicyPage>['status']; onRetry: () => void }) {
  return (
    <div className="rounded-xl border border-warning/30 bg-warning-bg px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-semibold text-warning-fg">{formatCount(count)} 条政策等你审核</p>
        <Link to="/policy" className="inline-flex min-h-11 items-center text-sm font-semibold text-warning-fg">去审核</Link>
      </div>
      {listStatus === 'loading' && <p className="mt-2 text-sm text-neutral-600">正在读取政策标题</p>}
      {listStatus === 'error' && <div className="mt-2"><BlockMiss onRetry={onRetry} /></div>}
      {listStatus === 'ready' && (
        <ul className="mt-2 space-y-1">
          {titles.titles.map((title) => <li key={title} className="text-sm text-neutral-800">{title}</li>)}
        </ul>
      )}
      {listStatus === 'ready' && titles.partial && <p className="mt-2 text-xs text-neutral-600">只列出这次读到的标题。</p>}
    </div>
  )
}

function TerminalWeek({
  ops,
  overview,
  onRetryOps,
  onRetryOverview,
}: {
  ops: Load<PartnerTerminalOpsView>
  overview: OverviewLoad
  onRetryOps: () => void
  onRetryOverview: () => void
}) {
  const lowPaper = overview.kind === 'ready' ? overview.data.terminals.filter((item) => item.printerStatus === 'low_paper') : []
  return (
    <Card className="space-y-3 p-4">
      <section aria-label="近 7 天终端运营（截至昨天）" className="space-y-2">
        <h2 className="text-[13px] font-bold text-neutral-700">近 7 天终端运营（截至昨天）</h2>
        {ops.status === 'loading' && <p className="text-sm text-neutral-500">正在读取终端运营</p>}
        {ops.status === 'error' && <BlockMiss onRetry={onRetryOps} />}
        {ops.status === 'ready' && ops.data && <OpsFigures data={ops.data} />}
        {overview.kind === 'error' && <BlockMiss onRetry={onRetryOverview} />}
        {lowPaper.map((item) => (
          <p key={item.id} className="text-sm text-neutral-700">{item.displayName?.trim() || item.terminalCode}：纸张或墨粉不足，仍可打印</p>
        ))}
        <PartnerAiServices />
      </section>
    </Card>
  )
}

function OpsFigures({ data }: { data: PartnerTerminalOpsView }) {
  const { totals } = data
  if (totals.terminalCount === 0) return <p className="text-sm text-neutral-600">暂无终端</p>
  return (
    <div className="space-y-1 text-sm text-neutral-800">
      <p>现在在线 <span className="font-semibold tabular-nums">{formatCount(totals.onlineTerminals)}</span> / <span className="tabular-nums">{formatCount(totals.terminalCount)}</span></p>
      <p>近 7 天服务次数 {totals.serviceCount === null ? '样本不足' : formatCount(totals.serviceCount)}</p>
      <p className="text-xs text-neutral-500">在线是此刻，服务次数到昨天</p>
    </div>
  )
}

function PolicyGlance({
  dashboard,
  snapshot,
  statsFailed,
  onRetryDash,
  onRetryStats,
}: {
  dashboard: Load<PartnerDashboardData>
  snapshot: PartnerStatsResponse['snapshot'] | null
  statsFailed: boolean
  onRetryDash: () => void
  onRetryStats: () => void
}) {
  const published = dashboard.status === 'ready' && dashboard.data ? dashboard.data.policies.published : null
  const total = dashboard.status === 'ready' && dashboard.data ? dashboard.data.policies.total : null
  return (
    <Card className="space-y-2 p-4">
      <section aria-label="政策概况" className="space-y-2">
        <h2 className="text-[13px] font-bold text-neutral-700">政策概况</h2>
        {dashboard.status === 'loading' && <p className="text-sm text-neutral-500">正在读取政策概况</p>}
        {dashboard.status === 'error' && <BlockMiss onRetry={onRetryDash} />}
        {total !== null && published !== null && (
          <p className="text-sm text-neutral-800">政策公告 <span className="font-semibold tabular-nums">{formatCount(total)}</span> · 已发布 <span className="font-semibold tabular-nums">{formatCount(published)}</span></p>
        )}
        {statsFailed && <BlockMiss onRetry={onRetryStats} />}
        {snapshot && <p className="text-sm text-neutral-800">待审核 <span className="font-semibold tabular-nums">{formatCount(snapshot.pendingReviewPolicies)}</span>（含审核中）</p>}
      </section>
    </Card>
  )
}
