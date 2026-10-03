// ============================================================
// Admin AI 服务管理页 — Phase 7.9
//
// 合规约束：
// - 页面只展示元数据（taskId/Provider/响应时间/状态/错误码）
// - 禁止展示：简历正文、聊天原文、优化建议内容、文件名、fileId
// - AI 服务结果只服务求职者本人，不推送给企业
// ============================================================

import { useEffect, useState } from 'react'
import { formatCount } from '@ai-job-print/shared'
import { Card, LoadingState, ErrorState } from '@ai-job-print/ui'
import { Page } from '../Page'
import {
  BotIcon,
  CheckCircleIcon,
  ClockIcon,
  BanknoteIcon,
  ServerIcon,
  ScanTextIcon,
  SparklesIcon,
  MessageSquareIcon,
  XCircleIcon,
  ShieldCheckIcon,
  AlertTriangleIcon,
  BriefcaseBusinessIcon,
} from 'lucide-react'
import { getAiUsage, getAiLogs, getAdminJobQualitySummary } from '../../services/api'
import type { AdminAiUsage, AdminAiLogEntry, AiOperation, JobSourceQualitySummary } from '../../services/api'
import { AiAccessSwitchesPanel } from './AiAccessSwitchesPanel'
import { AiUsagePanel } from './AiUsagePanel'
import { AiOperationCostTable } from './AiOperationCostTable'
import { AiLogsTable, LOGS_PAGE_SIZE, type OpFilter, type StatusFilter } from './AiLogsTable'
import { aiLogReason, aiProviderName } from './aiLogDisplay'
import { logOverviewLatency, logOverviewRate } from './aiUsageDisplay'

// ─── 常量映射 ─────────────────────────────────────────────────

// ─── 子组件 ───────────────────────────────────────────────────

interface MetricProps {
  label: string
  value: string | number
  note?: string
  icon: React.ElementType
  iconClass?: string
  title?: string
}

function MetricCard({ label, value, note, title, icon: Icon, iconClass = 'text-primary-600 bg-primary-50' }: MetricProps) {
  return (
    <Card className="flex items-start gap-3.5 p-4">
      <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] ${iconClass}`}>
        <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <p className="text-[11.5px] font-medium text-neutral-500">{label}</p>
        <p className="mt-0.5 text-[1.35rem] font-bold tabular-nums leading-none text-neutral-900" title={title}>{value}</p>
        {note && <p className="mt-1 text-[11px] text-neutral-400">{note}</p>}
      </div>
    </Card>
  )
}

// ─── 主组件 ───────────────────────────────────────────────────

export default function AiServicesPage() {
  const [usage,        setUsage]        = useState<AdminAiUsage | null>(null)
  const [logs,         setLogs]         = useState<AdminAiLogEntry[]>([])
  const [logsTotal,    setLogsTotal]    = useState(0)
  const [logsOffset,   setLogsOffset]   = useState(0)
  const [logsLoading,  setLogsLoading]  = useState(true)
  const [logsError,    setLogsError]    = useState<string | null>(null)
  const [qualitySummary, setQualitySummary] = useState<JobSourceQualitySummary[]>([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState<string | null>(null)
  const [opFilter,     setOpFilter]     = useState<OpFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  // 概览（统计 + 岗位质量）只在挂载时取一次，与日志筛选解耦。
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [usageData, qualityData] = await Promise.all([
          getAiUsage(),
          getAdminJobQualitySummary(),
        ])
        if (cancelled) return
        setUsage(usageData)
        setQualitySummary(qualityData)
      } catch {
        if (!cancelled) setError('AI 服务数据加载失败，请刷新重试')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  // 日志：**每次筛选 / 翻页都重新请求后端**。
  //
  // 此前是「固定拉最近 100 条 → 在浏览器里 filter」，低频能力（合同审查等）
  // 只要没挤进最近 100 条就显示为空 —— 页面在对运营说「没有调用」，
  // 而库里其实有。筛选必须由后端带 operation / status 走索引查，
  // 不要为了少一次请求把它改回客户端过滤。
  useEffect(() => {
    let cancelled = false
    setLogsLoading(true)
    void (async () => {
      try {
        const result = await getAiLogs({
          operation: opFilter === 'all' ? undefined : opFilter,
          status: statusFilter === 'all' ? undefined : statusFilter,
          limit: LOGS_PAGE_SIZE,
          offset: logsOffset,
        })
        if (cancelled) return
        setLogs(result.entries)
        setLogsTotal(result.total)
        setLogsError(null)
      } catch {
        if (cancelled) return
        // 失败时清空并明说加载失败，绝不留着上一次筛选的结果冒充本次结果。
        setLogs([])
        setLogsTotal(0)
        setLogsError('调用日志加载失败，请重试')
      } finally {
        if (!cancelled) setLogsLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [opFilter, statusFilter, logsOffset])

  // 换筛选条件必须回到第一页，否则会停在旧偏移量上、看起来像「筛不出东西」。
  const applyOpFilter = (next: OpFilter) => { setOpFilter(next); setLogsOffset(0) }
  const applyStatusFilter = (next: StatusFilter) => { setStatusFilter(next); setLogsOffset(0) }

  if (loading) {
    return (
      <Page title="AI 服务管理" subtitle="AI 开关、用量与额度、调用记录">
        <AiAccessSwitchesPanel />
        <AiUsagePanel />
        <LoadingState text="加载 AI 服务数据…" />
      </Page>
    )
  }

  if (error || !usage) {
    return (
      <Page title="AI 服务管理" subtitle="AI 开关、用量与额度、调用记录">
        <AiAccessSwitchesPanel />
        <AiUsagePanel />
        <ErrorState title="数据加载失败" message={error ?? '未知错误'} />
      </Page>
    )
  }

  const successRate    = usage.successRate
  const noCallsIn24h   = usage.totalCalls === 0
  const estimatedCost  = `¥${usage.estimatedCostCny.toFixed(2)}`
  // 这张卡来自旧调用日志的 token 估算，和上面额度面板按计量账算出的「已计费金额」不是同一本账。
  const logCostDistinction = '这是旧调用日志按 token 估算的金额，和上面额度面板的「已计费金额」不是一回事'
  const costNote       = usage.unmeasuredCalls > 0
    ? `下限 · 另有 ${usage.unmeasuredCalls} 次调用未采集成本。${logCostDistinction}`
    : usage.estimatedCostCny === 0
      ? `${usage.providerName} 暂无已记录 token 成本。${logCostDistinction}`
      : `基于 token 用量估算。${logCostDistinction}`
  const jobAiCalls = usage.byOperation.jobRecommend + usage.byOperation.jobExplain + usage.byOperation.jobMatch
  /** 岗位 AI 三项成本：只取已采集部分，并单独给出「未估算」笔数，不把未采集当 0。 */
  const jobAiOps: AiOperation[] = ['jobRecommend', 'jobExplain', 'jobMatch']
  const jobAiCost = jobAiOps.reduce((sum, op) => sum + (usage.costByOperation[op]?.cny ?? 0), 0)
  const jobAiUnmeasured = jobAiOps.reduce((sum, op) => {
    const cost = usage.costByOperation[op]
    return sum + (cost ? cost.calls - cost.measuredCalls : 0)
  }, 0)
  /** 单个能力的成本文案：未采集显示「未估算」，绝不显示 ¥0.0000。 */
  const opCostText = (op: AiOperation): string => {
    const cost = usage.costByOperation[op]
    if (!cost || cost.measuredCalls === 0) return cost && cost.calls > 0 ? '成本未估算' : '成本 ¥0.0000'
    const suffix = cost.measuredCalls < cost.calls ? `（+${cost.calls - cost.measuredCalls} 笔未估算）` : ''
    return `成本 ¥${cost.cny.toFixed(4)}${suffix}`
  }

  const qualityTotals = qualitySummary.reduce(
    (acc, item) => ({
      totalJobs: acc.totalJobs + item.totalJobs,
      readyJobs: acc.readyJobs + item.readyJobs,
      partialJobs: acc.partialJobs + item.partialJobs,
      insufficientJobs: acc.insufficientJobs + item.insufficientJobs,
      staleJobs: acc.staleJobs + item.staleJobs,
      brokenSourceUrlJobs: acc.brokenSourceUrlJobs + item.brokenSourceUrlJobs,
    }),
    { totalJobs: 0, readyJobs: 0, partialJobs: 0, insufficientJobs: 0, staleJobs: 0, brokenSourceUrlJobs: 0 },
  )
  const readyRate = qualityTotals.totalJobs > 0
    ? Math.round((qualityTotals.readyJobs / qualityTotals.totalJobs) * 1000) / 10
    : 0

  return (
    <Page title="AI 服务管理" subtitle="AI 开关、用量与额度、调用记录">
      <AiAccessSwitchesPanel />
      <AiUsagePanel />

      {/* ── 成本告警 ─────────────────────────────────── */}
      <section aria-label="成本告警" className="mb-6">
        {usage.alerts.length > 0 ? (
          <div className="space-y-3">
            {usage.alerts.map((alert) => (
              <Card
                key={alert.code}
                className={[
                  'flex items-start gap-3 border p-4',
                  alert.level === 'critical' ? 'border-error/30 bg-error-bg' : 'border-warning/30 bg-warning-bg',
                ].join(' ')}
              >
                <AlertTriangleIcon
                  className={['mt-0.5 h-5 w-5 shrink-0', alert.level === 'critical' ? 'text-error-fg' : 'text-warning'].join(' ')}
                  aria-hidden="true"
                />
                <div>
                  <p className={['text-sm font-semibold', alert.level === 'critical' ? 'text-error-fg' : 'text-warning-fg'].join(' ')}>
                    {alert.title}
                  </p>
                  <p className={['mt-1 text-sm', alert.level === 'critical' ? 'text-error-fg' : 'text-warning-fg'].join(' ')}>
                    {alert.detail}
                  </p>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <Card className="flex items-center gap-3 border-success/20 bg-success-bg p-4">
            <ShieldCheckIcon className="h-5 w-5 text-success" aria-hidden="true" />
            <p className="text-sm text-success-fg">成本告警：近 24 小时暂无 AI 成本或失败率异常。</p>
          </Card>
        )}
      </section>

      {/* ── 近 24 小时概览指标（服务端按滚动 24 小时统计，不是北京时间自然日） ── */}
      <section aria-label="近 24 小时 AI 服务概览">
        <div className="mb-3 flex items-center gap-2">
          <span className="inline-block h-3.5 w-[3px] shrink-0 rounded-full bg-primary-500" aria-hidden="true" />
          <h2 className="text-[13px] font-bold text-neutral-700">近 24 小时概览</h2>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCard
            label="AI 调用总次数"
            value={formatCount(usage.totalCalls)}
            note="近 24 小时累计"
            icon={BotIcon}
          />
          <MetricCard
            label="成功率"
            value={logOverviewRate(usage.totalCalls, successRate)}
            note={noCallsIn24h ? '近 24 小时暂无调用' : `${usage.successCount} 次成功 / ${usage.failCount} 次失败`}
            icon={CheckCircleIcon}
            iconClass={noCallsIn24h ? 'text-neutral-500 bg-neutral-100' : successRate >= 95 ? 'text-success-fg bg-success-bg' : 'text-warning-fg bg-warning-bg'}
          />
          <MetricCard
            label="平均响应时间"
            value={logOverviewLatency(usage.totalCalls, usage.avgLatencyMs)}
            note={noCallsIn24h ? '近 24 小时暂无调用' : '仅计入成功请求'}
            icon={ClockIcon}
            iconClass={noCallsIn24h ? 'text-neutral-500 bg-neutral-100' : 'text-info-fg bg-info-bg'}
          />
          <MetricCard
            label="按日志估算的成本"
            value={estimatedCost}
            note={costNote}
            icon={BanknoteIcon}
            iconClass="text-neutral-500 bg-neutral-100"
          />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <MetricCard
            label="当前 AI 服务"
            value={aiProviderName(usage.providerName)}
            title={usage.providerName}
            note="切换请联系运维修改服务器配置"
            icon={ServerIcon}
            iconClass="text-purple-600 bg-purple-50"
          />
          <MetricCard
            label="简历解析"
            value={formatCount(usage.byOperation.parseResume)}
            note="简历解析调用次数"
            icon={ScanTextIcon}
          />
          <MetricCard
            label="简历优化"
            value={formatCount(usage.byOperation.optimizeResume)}
            note="简历优化调用次数"
            icon={SparklesIcon}
            iconClass="text-yellow-600 bg-yellow-50"
          />
          <MetricCard
            label="AI 助手对话"
            value={formatCount(usage.byOperation.chatAssistant)}
            note="AI 助手对话调用次数"
            icon={MessageSquareIcon}
            iconClass="text-teal-600 bg-teal-50"
          />
          <MetricCard
            label="真实 token 用量"
            value={usage.tokenUsageTotals.totalTokens.toLocaleString()}
            note={`${usage.tokenUsageTotals.promptTokens.toLocaleString()} 输入 / ${usage.tokenUsageTotals.completionTokens.toLocaleString()} 输出`}
            icon={ServerIcon}
            iconClass="text-indigo-600 bg-indigo-50"
          />
        </div>
      </section>

      {/* ── 岗位 AI 运营 ─────────────────────────────── */}
      <section aria-label="岗位 AI 运营" className="mt-7">
        <div className="mb-3 flex items-center gap-2">
          <span className="inline-block h-3.5 w-[3px] shrink-0 rounded-full bg-primary-500" aria-hidden="true" />
          <h2 className="text-[13px] font-bold text-neutral-700">岗位 AI 运营</h2>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCard
            label="岗位 AI 调用"
            value={formatCount(jobAiCalls)}
            note="推荐 / 解读 / 匹配参考"
            icon={BriefcaseBusinessIcon}
            iconClass="text-sky-600 bg-sky-50"
          />
          <MetricCard
            label="岗位推荐"
            value={formatCount(usage.byOperation.jobRecommend)}
            note={opCostText('jobRecommend')}
            icon={SparklesIcon}
            iconClass="text-violet-600 bg-violet-50"
          />
          <MetricCard
            label="岗位解读"
            value={formatCount(usage.byOperation.jobExplain)}
            note={opCostText('jobExplain')}
            icon={ScanTextIcon}
            iconClass="text-info-fg bg-info-bg"
          />
          <MetricCard
            label="匹配参考"
            value={formatCount(usage.byOperation.jobMatch)}
            note={jobAiUnmeasured > 0
              ? `岗位 AI 总成本 ¥${jobAiCost.toFixed(4)}（+${jobAiUnmeasured} 笔未估算）`
              : `岗位 AI 总成本 ¥${jobAiCost.toFixed(4)}`}
            icon={CheckCircleIcon}
            iconClass="text-success-fg bg-success-bg"
          />
        </div>
      </section>

      {/* ── 分能力调用量与成本（A-6，已拆成 AiOperationCostTable）─────────
          上面的卡片只覆盖 6 个高频能力；这张表覆盖全部 15 个 operation，
          避免职业规划 / 参会计划 / 模拟面试 / 语音这些能力的花费在 Admin 侧不可见。 */}
      <AiOperationCostTable usage={usage} />

      {/* ── 岗位来源质量 ─────────────────────────────── */}
      <section aria-label="岗位来源质量" className="mt-7">
        <div className="mb-3 flex items-center gap-2">
          <span className="inline-block h-3.5 w-[3px] shrink-0 rounded-full bg-primary-500" aria-hidden="true" />
          <h2 className="text-[13px] font-bold text-neutral-700">岗位来源质量</h2>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCard
            label="来源岗位总量"
            value={formatCount(qualityTotals.totalJobs)}
            note={`${qualitySummary.length} 个来源分组`}
            icon={BriefcaseBusinessIcon}
          />
          <MetricCard
            label="AI 可读就绪率"
            value={qualityTotals.totalJobs > 0 ? `${readyRate}%` : '—'}
            note={`${qualityTotals.readyJobs} 条已就绪`}
            icon={CheckCircleIcon}
            iconClass={qualityTotals.totalJobs === 0 ? 'text-neutral-500 bg-neutral-100' : readyRate >= 90 ? 'text-success-fg bg-success-bg' : 'text-warning-fg bg-warning-bg'}
          />
          <MetricCard
            label="字段缺失"
            value={qualityTotals.partialJobs + qualityTotals.insufficientJobs}
            note="部分缺失 / 信息不足"
            icon={AlertTriangleIcon}
            iconClass="text-warning-fg bg-warning-bg"
          />
          <MetricCard
            label="来源链接异常"
            value={formatCount(qualityTotals.brokenSourceUrlJobs)}
            note={`${qualityTotals.staleJobs} 条过期或同步陈旧`}
            icon={XCircleIcon}
            iconClass="text-error-fg bg-error-bg"
          />
        </div>
      </section>

      {/* ── 失败原因统计 ──────────────────────────────── */}
      {usage.errorDistribution.length > 0 && (
        <section aria-label="失败原因统计" className="mt-7">
          <div className="mb-3 flex items-center gap-2">
            <span className="inline-block h-3.5 w-[3px] shrink-0 rounded-full bg-primary-500" aria-hidden="true" />
            <h2 className="text-[13px] font-bold text-neutral-700">失败原因分布</h2>
          </div>
          <Card className="p-5">
            <div className="flex flex-wrap gap-3">
              {usage.errorDistribution.map((r) => (
                <div
                  key={r.code}
                  className="flex items-center gap-2 rounded-lg border border-error/20 bg-error-bg px-4 py-2"
                >
                  <XCircleIcon className="h-4 w-4 text-error-fg" aria-hidden="true" />
                  <span className="text-sm font-medium text-error-fg" title={r.code}>{aiLogReason(r.code)}</span>
                  <span className="text-sm text-error-fg">{r.count} 次</span>
                </div>
              ))}
            </div>
          </Card>
        </section>
      )}

      <AiLogsTable logs={logs} logsTotal={logsTotal} logsOffset={logsOffset} logsLoading={logsLoading} logsError={logsError}
        opFilter={opFilter} statusFilter={statusFilter} applyOpFilter={applyOpFilter} applyStatusFilter={applyStatusFilter} setLogsOffset={setLogsOffset} />

      {/* ── 合规说明 ──────────────────────────────────── */}
      <section aria-label="合规说明" className="mt-8">
        <Card className="flex items-start gap-3 border-info/20 bg-info-bg p-4">
          <ShieldCheckIcon className="mt-0.5 h-5 w-5 shrink-0 text-info" aria-hidden="true" />
          <div className="text-sm text-info-fg">
            <p className="font-medium">数据合规说明</p>
            <ul className="mt-1 list-inside list-disc space-y-1 text-info-fg">
              <li>
                AI 日志仅记录任务编号、厂商与模型、响应时间、状态与失败原因，
                不保存完整简历内容和聊天原文
              </li>
              <li>AI 服务结果仅服务求职者本人，不推送给企业或第三方</li>
            </ul>
          </div>
        </Card>
      </section>
    </Page>
  )
}
