import { Card } from '@ai-job-print/ui'
import { AlertTriangleIcon, CheckCircleIcon, LinkIcon } from 'lucide-react'
import type { PartnerJobQualitySummary } from '../../../services/api'

interface Props {
  qualitySummary: PartnerJobQualitySummary[]
}

function aggregate(items: PartnerJobQualitySummary[]) {
  return items.reduce(
    (acc, item) => ({
      totalJobs: acc.totalJobs + item.totalJobs,
      readyJobs: acc.readyJobs + item.readyJobs,
      partialJobs: acc.partialJobs + item.partialJobs,
      insufficientJobs: acc.insufficientJobs + item.insufficientJobs,
      staleJobs: acc.staleJobs + item.staleJobs,
      brokenSourceUrlJobs: acc.brokenSourceUrlJobs + item.brokenSourceUrlJobs,
      lastCheckedAt: latest(acc.lastCheckedAt, item.lastCheckedAt),
    }),
    {
      totalJobs: 0,
      readyJobs: 0,
      partialJobs: 0,
      insufficientJobs: 0,
      staleJobs: 0,
      brokenSourceUrlJobs: 0,
      lastCheckedAt: null as string | null,
    },
  )
}

function latest(a: string | null, b: string | null): string | null {
  if (!a) return b
  if (!b) return a
  return a > b ? a : b
}

function rate(ready: number, total: number): number {
  return total > 0 ? Math.round((ready / total) * 1000) / 10 : 0
}

export function JobQualitySummaryPanel({ qualitySummary }: Props) {
  const total = aggregate(qualitySummary)
  const readyRate = rate(total.readyJobs, total.totalJobs)
  const needsFix = total.partialJobs + total.insufficientJobs

  return (
    <Card className="mb-4 border-sky-100 bg-sky-50/60 p-4">
      <div className="flex flex-wrap items-start gap-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-sky-600">
          <CheckCircleIcon className="h-5 w-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold text-gray-900">本机构岗位质量</h2>
            <span className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-sky-700">
              AI 可读就绪率 {readyRate}%
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-gray-500">
            质量摘要来自已落库的岗位字段与来源链接巡检，只用于改进岗位展示完整度，不包含个人服务记录。
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <Metric label="岗位总量" value={total.totalJobs} note={`${qualitySummary.length} 个来源分组`} />
            <Metric label="字段缺失" value={needsFix} note="需要补描述、要求、薪资或技能等字段" icon="warning" />
            <Metric label="来源链接异常" value={total.brokenSourceUrlJobs} note="请修正外部来源地址" icon="link" />
            <Metric label="同步陈旧/过期" value={total.staleJobs} note={total.lastCheckedAt ? `最近检查 ${total.lastCheckedAt.slice(0, 10)}` : '暂无检查记录'} icon="warning" />
          </div>
        </div>
      </div>
    </Card>
  )
}

function Metric({ label, value, note, icon }: { label: string; value: number; note: string; icon?: 'warning' | 'link' }) {
  const Icon = icon === 'link' ? LinkIcon : icon === 'warning' ? AlertTriangleIcon : CheckCircleIcon
  const iconClass = icon === 'warning' ? 'text-amber-500' : icon === 'link' ? 'text-red-500' : 'text-emerald-500'
  return (
    <div className="rounded-lg bg-white p-3">
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${iconClass}`} aria-hidden="true" />
        <span className="text-xs text-gray-500">{label}</span>
      </div>
      <p className="mt-1 text-lg font-semibold text-gray-900">{value}</p>
      <p className="mt-0.5 text-xs leading-relaxed text-gray-400">{note}</p>
    </div>
  )
}
