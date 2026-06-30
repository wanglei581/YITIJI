import { Card } from '@ai-job-print/ui'
import type { JobAiSessionListItem } from '@ai-job-print/shared'
import { BriefcaseIcon, FileSearchIcon, SparklesIcon, Trash2Icon, type LucideIcon } from 'lucide-react'
import { formatTime } from '../assets/format'

const OPERATION_META: Record<JobAiSessionListItem['session']['operation'], { label: string; hint: string; icon: LucideIcon; bg: string; color: string }> = {
  recommend: { label: '岗位 AI 推荐参考', hint: '基于本人简历与真实岗位生成', icon: SparklesIcon, bg: 'bg-primary-50', color: 'text-primary-600' },
  explain: { label: 'AI岗位解读', hint: '基于来源岗位字段生成', icon: BriefcaseIcon, bg: 'bg-cyan-50', color: 'text-cyan-600' },
  match: { label: '岗位匹配参考', hint: '用本人简历做求职准备', icon: FileSearchIcon, bg: 'bg-sky-50', color: 'text-sky-600' },
}

const STATUS_META: Record<JobAiSessionListItem['session']['status'], { label: string; cls: string }> = {
  pending: { label: '待处理', cls: 'bg-amber-50 text-amber-600' },
  processing: { label: '处理中', cls: 'bg-blue-50 text-blue-600' },
  completed: { label: '已完成', cls: 'bg-emerald-50 text-emerald-600' },
  failed: { label: '失败', cls: 'bg-red-50 text-red-600' },
}

function metaLine(item: JobAiSessionListItem): string {
  const expires = item.session.expiresAt ? ` · 留存至 ${formatTime(item.session.expiresAt)}` : ''
  const recommendation = item.recommendationCount > 0 ? ` · 推荐项共计 ${item.recommendationCount} 项` : ''
  return `${item.session.provider ?? 'llm'} · ${formatTime(item.session.createdAt)}${recommendation}${expires}`
}

export function JobAiSessionRecords({
  items,
  confirmId,
  busyId,
  onDelete,
}: {
  items: JobAiSessionListItem[]
  confirmId: string | null
  busyId: string | null
  onDelete: (sessionId: string) => void
}) {
  if (items.length === 0) return null
  return (
    <section aria-label="岗位 AI 参考记录" className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">岗位 AI 参考记录</h2>
          <p className="mt-1 text-xs leading-relaxed text-gray-400">仅展示岗位 AI 会话元数据，不展示简历原文、提示词或模型原始输出。</p>
        </div>
        <span className="shrink-0 rounded-full bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-500">
          分析结果仅供参考
        </span>
      </div>

      {items.map((item) => {
        const meta = OPERATION_META[item.session.operation]
        const status = STATUS_META[item.session.status]
        const Icon = meta.icon
        const confirming = confirmId === item.session.id
        return (
          <Card key={item.session.id} className="flex items-center gap-4 p-4">
            <div className={['flex h-12 w-12 shrink-0 items-center justify-center rounded-xl', meta.bg].join(' ')}>
              <Icon className={['h-6 w-6', meta.color].join(' ')} aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-semibold text-gray-900">{meta.label}</p>
                <span className={['shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', status.cls].join(' ')}>
                  {status.label}
                </span>
              </div>
              <p className="mt-0.5 truncate text-xs text-gray-400">
                {item.job ? `${item.job.title} · ${item.job.company}` : meta.hint}
              </p>
              <p className="mt-0.5 truncate text-xs text-gray-400">{metaLine(item)}</p>
            </div>
            <button
              type="button"
              disabled={busyId === item.session.id}
              onClick={() => onDelete(item.session.id)}
              title={confirming ? '再次点击确认删除' : '删除'}
              aria-label={confirming ? '再次点击确认删除岗位 AI 参考记录' : '删除岗位 AI 参考记录'}
              className={[
                'flex h-12 shrink-0 items-center justify-center rounded-lg border px-3 text-sm font-medium transition-colors',
                confirming
                  ? 'border-red-300 bg-red-50 text-red-600'
                  : 'border-gray-200 text-gray-400 hover:bg-red-50 hover:text-red-500',
              ].join(' ')}
            >
              <Trash2Icon className="h-4 w-4" aria-hidden="true" />
              {confirming && <span className="ml-1">确认删除</span>}
            </button>
          </Card>
        )
      })}
    </section>
  )
}
