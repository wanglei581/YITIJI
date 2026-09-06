import { Card } from '@ai-job-print/ui'
import type { MemberInterviewItem } from '@ai-job-print/shared'
import { EyeIcon, Trash2Icon } from 'lucide-react'
import { KIcon } from '../../../components/kiosk-icon'
import { formatTime } from '../assets/format'

function metaLine(item: MemberInterviewItem): string {
  const ended = item.endedAt ? ` · 结束于 ${formatTime(item.endedAt)}` : ''
  return `${item.industry} · ${item.durationMin} 分钟 · ${formatTime(item.createdAt)}${ended}`
}

export function MockInterviewRecords({
  items,
  confirmId,
  busyId,
  onOpen,
  onDelete,
}: {
  items: MemberInterviewItem[]
  confirmId: string | null
  busyId: string | null
  onOpen: (sessionId: string) => void
  onDelete: (sessionId: string) => void
}) {
  if (items.length === 0) return null
  return (
    <section aria-label="模拟面试记录" className="space-y-3">
      <div className="me-section-copy">
        <h2>模拟面试</h2>
        <p>数据来自本人练习记录，仅展示元数据；报告可回看，不向企业转交。</p>
      </div>
      {items.map((item) => {
        const confirming = confirmId === item.sessionId
        return (
          <Card key={item.sessionId} className="me-benefit-card me-ripple">
            <div className="flex items-center gap-4">
              <span className="me-row-icon me-tone-plum" aria-hidden="true">
                <KIcon name="sparkle" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="me-chip">{item.interviewerLabel}</span>
                  <span className={['me-status', item.hasReport ? 'is-active' : 'is-muted'].join(' ')}>
                    {item.hasReport ? '已完成' : '无报告'}
                  </span>
                </div>
                <p className="me-row-title mt-2">{item.position}</p>
                <p className="me-row-meta">{metaLine(item)}</p>
              </div>
              {item.hasReport && (
                <button
                  type="button"
                  className="me-ripple me-doc-action"
                  onClick={() => onOpen(item.sessionId)}
                  aria-label={`查看模拟面试报告 ${item.position}`}
                >
                  <EyeIcon className="h-4 w-4" aria-hidden="true" />
                  <span className="ml-1">查看</span>
                </button>
              )}
              <button
                type="button"
                disabled={busyId === item.sessionId}
                onClick={() => onDelete(item.sessionId)}
                title={confirming ? '再次点击确认删除' : '删除'}
                aria-label={confirming ? '再次点击确认删除模拟面试记录' : '删除模拟面试记录'}
                className={['me-delete-button me-ripple', confirming ? 'is-confirm' : ''].join(' ')}
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
