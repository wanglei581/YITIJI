import type { JobAiSessionListItem } from '@ai-job-print/shared'
import { Trash2Icon } from 'lucide-react'
import { KIcon, type KioskIconName } from '../../../components/kiosk-icon'
import { formatTime } from '../assets/format'

const OPERATION_META: Record<JobAiSessionListItem['session']['operation'], { label: string; hint: string; icon: KioskIconName; tone?: 'slate' | 'wheat' }> = {
  recommend: { label: '岗位 AI 推荐参考', hint: '基于本人简历与真实岗位生成', icon: 'sparkle' },
  explain: { label: 'AI岗位解读', hint: '基于来源岗位字段生成', icon: 'briefcase', tone: 'slate' },
  match: { label: '岗位匹配参考', hint: '用本人简历做求职准备', icon: 'doc-check', tone: 'wheat' },
}

const STATUS_META: Record<JobAiSessionListItem['session']['status'], { label: string; tone?: 'wait' | 'run' | 'bad' }> = {
  pending: { label: '待处理', tone: 'wait' },
  processing: { label: '处理中', tone: 'run' },
  completed: { label: '已完成' },
  failed: { label: '失败', tone: 'bad' },
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
    <>
      <div className="qx-me-legal">岗位 AI 参考记录 · 仅展示岗位 AI 会话元数据，不展示简历原文、提示词或模型原始输出。分析结果仅供参考</div>
      {items.map((item) => {
        const meta = OPERATION_META[item.session.operation]
        const status = STATUS_META[item.session.status]
        const confirming = confirmId === item.session.id
        return (
          <div key={item.session.id} className="qx-me-row" data-flag={confirming ? 'true' : undefined} data-record-kind="job-ai-session" data-record-status={item.session.status}>
            <span className="qx-me-row-ico" data-tone={meta.tone} aria-hidden="true">
              <KIcon name={meta.icon} />
            </span>
            <span className="qx-me-row-main">
              <span className="qx-me-row-head">
                <span className="qx-me-chip">{meta.label}</span>
                <span className="qx-me-st" data-tone={status.tone}>{status.label}</span>
              </span>
              <span className="qx-me-row-title" style={{ marginTop: 8 }}>{item.job ? `${item.job.title} · ${item.job.company}` : meta.hint}</span>
              <span className="qx-me-row-sub">{metaLine(item)}</span>
            </span>
            <span className="qx-me-acts">
              <button
                type="button"
                className={['qx-me-small me-delete-button', confirming ? 'is-confirm' : ''].join(' ')}
                data-variant="danger"
                disabled={busyId === item.session.id}
                onClick={() => onDelete(item.session.id)}
                title={confirming ? '再次点击确认删除' : '删除'}
                aria-label={confirming ? '再次点击确认删除岗位 AI 参考记录' : '删除岗位 AI 参考记录'}
              >
                <Trash2Icon className="h-4 w-4" aria-hidden="true" />
                {confirming ? <span className="ml-1">确认删除</span> : '删除'}
              </button>
            </span>
          </div>
        )
      })}
    </>
  )
}
