// ============================================================
// Admin AI 服务管理页 — Phase 7.9
//
// 合规约束：
// - 页面只展示元数据（taskId/Provider/响应时间/状态/错误码）
// - 禁止展示：简历正文、聊天原文、优化建议内容、文件名、fileId
// - AI 服务结果只服务求职者本人，不推送给企业
// ============================================================

import { useEffect, useState } from 'react'
import { Card, StatusBadge, LoadingState, ErrorState } from '@ai-job-print/ui'
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
} from 'lucide-react'
import { getAiUsage, getAiLogs } from '../../services/api'
import type { AdminAiUsage, AdminAiLogEntry, AiOperation, AiLogStatus } from '../../services/api'

// ─── 常量映射 ─────────────────────────────────────────────────

const OPERATION_LABELS: Record<AiOperation, string> = {
  parseResume:    '简历解析',
  optimizeResume: '简历优化',
  chatAssistant:  'AI 对话',
  classifyIntent: '意图分类',
}

const STATUS_MAP: Record<AiLogStatus, { badge: 'success' | 'error'; label: string }> = {
  success: { badge: 'success', label: '成功' },
  failed:  { badge: 'error',   label: '失败' },
}

// ─── 筛选类型 ─────────────────────────────────────────────────

type OpFilter     = 'all' | AiOperation
type StatusFilter = 'all' | AiLogStatus

const OP_FILTERS: OpFilter[] = ['all', 'parseResume', 'optimizeResume', 'chatAssistant']
const OP_FILTER_LABELS: Record<OpFilter, string> = {
  all:            '全部',
  parseResume:    '简历解析',
  optimizeResume: '简历优化',
  chatAssistant:  'AI 对话',
  classifyIntent: '意图分类',
}
const STATUS_FILTERS: StatusFilter[] = ['all', 'success', 'failed']
const STATUS_FILTER_LABELS: Record<StatusFilter, string> = {
  all:     '全部状态',
  success: '成功',
  failed:  '失败',
}

// ─── 子组件 ───────────────────────────────────────────────────

interface MetricProps {
  label: string
  value: string | number
  note?: string
  icon: React.ElementType
  iconClass?: string
}

function MetricCard({ label, value, note, icon: Icon, iconClass = 'text-primary-600 bg-primary-50' }: MetricProps) {
  return (
    <Card className="flex items-start gap-4 p-5">
      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${iconClass}`}>
        <Icon className="h-5 w-5" aria-hidden="true" />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-500">{label}</p>
        <p className="mt-0.5 text-xl font-semibold text-gray-900">{value}</p>
        {note && <p className="mt-0.5 text-xs text-gray-400">{note}</p>}
      </div>
    </Card>
  )
}

// ─── 主组件 ───────────────────────────────────────────────────

export default function AiServicesPage() {
  const [usage,        setUsage]        = useState<AdminAiUsage | null>(null)
  const [logs,         setLogs]         = useState<AdminAiLogEntry[]>([])
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState<string | null>(null)
  const [opFilter,     setOpFilter]     = useState<OpFilter>('all')
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [usageData, logsData] = await Promise.all([
          getAiUsage(),
          getAiLogs(100),
        ])
        if (cancelled) return
        setUsage(usageData)
        setLogs(logsData.entries)
      } catch {
        if (!cancelled) setError('AI 服务数据加载失败，请刷新重试')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [])

  if (loading) {
    return (
      <Page title="AI 服务管理" subtitle="调用统计 · 元数据日志 · Provider 状态">
        <LoadingState text="加载 AI 服务数据…" />
      </Page>
    )
  }

  if (error || !usage) {
    return (
      <Page title="AI 服务管理" subtitle="调用统计 · 元数据日志 · Provider 状态">
        <ErrorState title="数据加载失败" message={error ?? '未知错误'} />
      </Page>
    )
  }

  const successRate    = usage.successRate
  const estimatedCost  = `¥${usage.estimatedCostCny.toFixed(2)}`
  const costNote       = usage.estimatedCostCny === 0
    ? `${usage.providerName} 无真实 token 消耗`
    : '基于 token 用量估算'

  const visibleLogs = logs.filter((l) => {
    if (opFilter !== 'all'     && l.operation !== opFilter)  return false
    if (statusFilter !== 'all' && l.status    !== statusFilter) return false
    return true
  })

  return (
    <Page title="AI 服务管理" subtitle="调用统计 · 元数据日志 · Provider 状态">

      {/* ── 今日概览指标 ─────────────────────────────── */}
      <section aria-label="今日 AI 服务概览">
        <h2 className="mb-3 text-sm font-medium text-gray-500">今日概览</h2>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <MetricCard
            label="AI 调用总次数"
            value={usage.totalCalls}
            note="今日累计"
            icon={BotIcon}
          />
          <MetricCard
            label="成功率"
            value={`${successRate}%`}
            note={`${usage.successCount} 次成功 / ${usage.failCount} 次失败`}
            icon={CheckCircleIcon}
            iconClass={successRate >= 95 ? 'text-green-600 bg-green-50' : 'text-orange-500 bg-orange-50'}
          />
          <MetricCard
            label="平均响应时间"
            value={`${usage.avgLatencyMs} ms`}
            note="仅计入成功请求"
            icon={ClockIcon}
            iconClass="text-blue-600 bg-blue-50"
          />
          <MetricCard
            label="预估成本"
            value={estimatedCost}
            note={costNote}
            icon={BanknoteIcon}
            iconClass="text-gray-500 bg-gray-100"
          />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <MetricCard
            label="当前 Provider"
            value={usage.providerName}
            note="切换需修改服务端 AI_PROVIDER"
            icon={ServerIcon}
            iconClass="text-purple-600 bg-purple-50"
          />
          <MetricCard
            label="简历解析"
            value={usage.byOperation.parseResume}
            note="parseResume 调用次数"
            icon={ScanTextIcon}
          />
          <MetricCard
            label="简历优化"
            value={usage.byOperation.optimizeResume}
            note="optimizeResume 调用次数"
            icon={SparklesIcon}
            iconClass="text-yellow-600 bg-yellow-50"
          />
          <MetricCard
            label="AI 助手对话"
            value={usage.byOperation.chatAssistant}
            note="chatAssistant 调用次数"
            icon={MessageSquareIcon}
            iconClass="text-teal-600 bg-teal-50"
          />
        </div>
      </section>

      {/* ── 失败原因统计 ──────────────────────────────── */}
      {usage.errorDistribution.length > 0 && (
        <section aria-label="失败原因统计" className="mt-8">
          <h2 className="mb-3 text-sm font-medium text-gray-500">失败原因分布</h2>
          <Card className="p-5">
            <div className="flex flex-wrap gap-3">
              {usage.errorDistribution.map((r) => (
                <div
                  key={r.code}
                  className="flex items-center gap-2 rounded-lg border border-red-100 bg-red-50 px-4 py-2"
                >
                  <XCircleIcon className="h-4 w-4 text-red-500" aria-hidden="true" />
                  <span className="text-sm font-medium text-red-700">{r.code}</span>
                  <span className="text-sm text-red-500">{r.count} 次</span>
                </div>
              ))}
            </div>
          </Card>
        </section>
      )}

      {/* ── 最近调用日志 ──────────────────────────────── */}
      <section aria-label="最近 AI 调用日志" className="mt-8">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-sm font-medium text-gray-500">最近调用日志</h2>
          <div className="ml-auto flex flex-wrap gap-2">
            <div className="flex rounded-lg border border-gray-200 bg-white text-sm">
              {OP_FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setOpFilter(f)}
                  className={`px-3 py-1.5 first:rounded-l-lg last:rounded-r-lg ${
                    opFilter === f
                      ? 'bg-primary-600 text-white'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {OP_FILTER_LABELS[f]}
                </button>
              ))}
            </div>
            <div className="flex rounded-lg border border-gray-200 bg-white text-sm">
              {STATUS_FILTERS.map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setStatusFilter(f)}
                  className={`px-3 py-1.5 first:rounded-l-lg last:rounded-r-lg ${
                    statusFilter === f
                      ? 'bg-primary-600 text-white'
                      : 'text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  {STATUS_FILTER_LABELS[f]}
                </button>
              ))}
            </div>
          </div>
        </div>

        <Card className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-gray-100 bg-gray-50 text-xs text-gray-500">
                <tr>
                  <th className="px-4 py-3 text-left font-medium">Task ID</th>
                  <th className="px-4 py-3 text-left font-medium">服务类型</th>
                  <th className="px-4 py-3 text-left font-medium">Provider</th>
                  <th className="px-4 py-3 text-left font-medium">状态</th>
                  <th className="px-4 py-3 text-right font-medium">响应时间</th>
                  <th className="px-4 py-3 text-left font-medium">时间</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {visibleLogs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-gray-400">
                      暂无匹配记录
                    </td>
                  </tr>
                ) : (
                  visibleLogs.map((log) => (
                    <tr key={log.taskId} className="hover:bg-gray-50/50">
                      <td className="px-4 py-3 font-mono text-xs text-gray-500">
                        {log.taskId.slice(0, 28)}{log.taskId.length > 28 ? '…' : ''}
                      </td>
                      <td className="px-4 py-3 text-gray-700">
                        {OPERATION_LABELS[log.operation]}
                      </td>
                      <td className="px-4 py-3">
                        <span className="rounded bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700">
                          {log.provider}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge
                          status={STATUS_MAP[log.status].badge}
                          label={STATUS_MAP[log.status].label}
                        />
                        {log.errorCode && (
                          <code className="ml-2 text-xs text-gray-400">{log.errorCode}</code>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-gray-600">
                        {log.latencyMs >= 1000
                          ? `${(log.latencyMs / 1000).toFixed(1)}s`
                          : `${log.latencyMs}ms`}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-gray-400">
                        {log.createdAt}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      </section>

      {/* ── 合规说明 ──────────────────────────────────── */}
      <section aria-label="合规说明" className="mt-8">
        <Card className="flex items-start gap-3 border-blue-100 bg-blue-50 p-4">
          <ShieldCheckIcon className="mt-0.5 h-5 w-5 shrink-0 text-blue-500" aria-hidden="true" />
          <div className="text-sm text-blue-700">
            <p className="font-medium">数据合规说明</p>
            <ul className="mt-1 list-inside list-disc space-y-1 text-blue-600">
              <li>
                AI 日志仅记录元数据（taskId / Provider / 响应时间 / 状态 / 错误码），
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
