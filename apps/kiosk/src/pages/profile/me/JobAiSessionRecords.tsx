import { Card } from '@ai-job-print/ui'
import type { JobAiSessionListItem } from '@ai-job-print/shared'
import { Trash2Icon } from 'lucide-react'
import { KIcon, type KioskIconName } from '../../../components/kiosk-icon'
import { formatTime } from '../assets/format'

const OPERATION_META: Record<JobAiSessionListItem['session']['operation'], { label: string; hint: string; icon: KioskIconName; tone: string }> = {
  recommend: { label: '岗位 AI 推荐参考', hint: '基于本人简历与真实岗位生成', icon: 'sparkle', tone: 'teal' },
  explain: { label: 'AI岗位解读', hint: '基于来源岗位字段生成', icon: 'briefcase', tone: 'slate' },
  match: { label: '岗位匹配参考', hint: '用本人简历做求职准备', icon: 'doc-check', tone: 'wheat' },
}

const STATUS_META: Record<JobAiSessionListItem['session']['status'], { label: string; cls: string }> = {
  pending: { label: '待处理', cls: 'is-warning' },
  processing: { label: '处理中', cls: 'is-muted' },
  completed: { label: '已完成', cls: 'is-active' },
  failed: { label: '失败', cls: 'is-danger' },
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
    <section aria-label="岗位 AI 参考记录" className="me-job-ai-records space-y-3">
      <div className="me-section-copy flex items-start justify-between gap-3">
        <div>
          <h2>岗位 AI 参考记录</h2>
          <p>仅展示岗位 AI 会话元数据，不展示简历原文、提示词或模型原始输出。</p>
        </div>
        <span className="me-chip shrink-0">
          分析结果仅供参考
        </span>
      </div>

      {items.map((item) => {
        const meta = OPERATION_META[item.session.operation]
        const status = STATUS_META[item.session.status]
        const confirming = confirmId === item.session.id
        return (
          <Card key={item.session.id} className="me-benefit-card me-ripple">
            <div className="flex items-center gap-4">
            <span className={['me-row-icon', `me-tone-${meta.tone}`].join(' ')} aria-hidden="true">
              <KIcon name={meta.icon} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="me-chip">{meta.label}</span>
                <span className={['me-status', status.cls].join(' ')}>
                  {status.label}
                </span>
              </div>
              <p className="me-row-title mt-2">
                {item.job ? `${item.job.title} · ${item.job.company}` : meta.hint}
              </p>
              <p className="me-row-meta">{metaLine(item)}</p>
            </div>
            <button
              type="button"
              disabled={busyId === item.session.id}
              onClick={() => onDelete(item.session.id)}
              title={confirming ? '再次点击确认删除' : '删除'}
              aria-label={confirming ? '再次点击确认删除岗位 AI 参考记录' : '删除岗位 AI 参考记录'}
              className={[
                'me-delete-button me-ripple',
                confirming
                  ? 'is-confirm'
                  : '',
              ].join(' ')}
            >
              <Trash2Icon className="h-4 w-4" aria-hidden="true" />
              {confirming && <span className="ml-1">确认删除</span>}
            </button>
            </div>
          </Card>
        )
      })}
    </section>
  )
}
