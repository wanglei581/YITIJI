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
    <>
      <div className="qx-me-legal">模拟面试 · 数据来自本人练习记录，仅展示元数据；报告可回看，不向企业转交。</div>
      {items.map((item) => {
        const confirming = confirmId === item.sessionId
        return (
          <div key={item.sessionId} className="qx-me-row" data-flag={confirming ? 'true' : undefined}>
            <span className="qx-me-row-ico" data-tone="plum" aria-hidden="true">
              <KIcon name="sparkle" />
            </span>
            <span className="qx-me-row-main">
              <span className="qx-me-row-head">
                <span className="qx-me-chip">{item.interviewerLabel}</span>
                <span className="qx-me-st" data-tone={item.hasReport ? undefined : 'run'}>{item.hasReport ? '已完成' : '无报告'}</span>
              </span>
              <span className="qx-me-row-title" style={{ marginTop: 8 }}>{item.position}</span>
              <span className="qx-me-row-sub">{metaLine(item)}</span>
            </span>
            <span className="qx-me-acts">
              {item.hasReport ? (
                <button type="button" className="qx-me-small" onClick={() => onOpen(item.sessionId)} aria-label={`查看模拟面试报告 ${item.position}`}>
                  <EyeIcon className="h-4 w-4" aria-hidden="true" />
                  <span className="ml-1">查看</span>
                </button>
              ) : null}
              <button
                type="button"
                className={['qx-me-small me-delete-button', confirming ? 'is-confirm' : ''].join(' ')}
                data-variant="danger"
                disabled={busyId === item.sessionId}
                onClick={() => onDelete(item.sessionId)}
                title={confirming ? '再次点击确认删除' : '删除'}
                aria-label={confirming ? '再次点击确认删除模拟面试记录' : '删除模拟面试记录'}
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
