import { useState } from 'react'
import { EmptyState } from '@ai-job-print/ui'
import type { PolicyPostView } from '../../services/api/policies'
import { isValidSourceUrl } from '../../lib/url'
import { ArrowUpRightIcon, ChevronRightIcon, FileTextIcon, InfoIcon, QrCodeIcon, ScrollTextIcon } from 'lucide-react'
import { BTN_OFFICIAL, CATEGORY_META } from './shared'

// ─── Panel: 政策公告（真实数据）──────────────────────────────────────────────

export function NoticePanel({
  notices,
  sourceLine,
  onOpened,
  onOfficialEntry,
}: {
  notices: PolicyPostView[]
  sourceLine: string | null
  onOpened: (policy: PolicyPostView) => void
  onOfficialEntry: (policy: PolicyPostView) => void
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)

  if (notices.length === 0) {
    return (
      <EmptyState
        icon={ScrollTextIcon}
        title="暂无政策公告"
        description="公告由合作机构发布、管理员审核后展示，敬请关注"
        className="py-16"
      />
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {sourceLine && (
        <p className="flex items-center gap-2 text-xs text-neutral-400">
          <InfoIcon className="h-3.5 w-3.5" aria-hidden="true" />
          {sourceLine}
        </p>
      )}

      {notices.map((notice) => {
        const meta = (notice.category && CATEGORY_META[notice.category]) || CATEGORY_META.notice
        const isOpen = expandedId === notice.id
        const hasDetail = Boolean(notice.content || notice.externalUrl)
        return (
          <div key={notice.id} className="rounded-xl border border-neutral-200 bg-white px-5 py-4 shadow-sm">
            <div className="flex items-start gap-4">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-neutral-50">
                <FileTextIcon className="h-5 w-5 text-neutral-500" aria-hidden="true" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${meta.color}`}>{meta.label}</span>
                  <span className="text-xs text-neutral-400">{notice.sourceName}</span>
                </div>
                <p className="mt-1.5 text-base font-medium leading-snug text-neutral-800">{notice.title}</p>
                {notice.summary && <p className="mt-1 text-sm text-neutral-500">{notice.summary}</p>}
                {notice.publishedDate && <p className="mt-1 text-xs text-neutral-400">发布时间：{notice.publishedDate}</p>}
              </div>
              {hasDetail && (
                <button
                  type="button"
                  onClick={() => {
                    setExpandedId(isOpen ? null : notice.id)
                    if (!isOpen) onOpened(notice)
                  }}
                  className="flex min-h-[48px] shrink-0 items-center gap-1.5 rounded-lg border border-neutral-200 bg-neutral-50 px-3 text-sm font-medium text-neutral-600 hover:bg-neutral-100"
                >
                  {isOpen ? '收起' : '查看详情'}
                  <ChevronRightIcon
                    className={['h-3.5 w-3.5 transition-transform', isOpen ? 'rotate-90' : ''].join(' ')}
                    aria-hidden="true"
                  />
                </button>
              )}
            </div>

            {isOpen && (
              <div className="mt-4 rounded-xl bg-neutral-50 px-4 py-3">
                {notice.content && (
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-neutral-700">{notice.content}</p>
                )}
                {notice.externalUrl && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-neutral-500">
                    <ArrowUpRightIcon className="h-3.5 w-3.5" aria-hidden="true" />
                    官方入口：{notice.externalUrl}（请通过官方渠道访问办理）
                  </p>
                )}
                {notice.externalUrl && isValidSourceUrl(notice.externalUrl) && (
                  <button type="button" onClick={() => onOfficialEntry(notice)} className={`mt-3 ${BTN_OFFICIAL}`}>
                    <QrCodeIcon className="h-4 w-4" aria-hidden="true" />
                    扫码打开官方入口
                  </button>
                )}
                <p className="mt-2 text-xs text-neutral-400">以上内容仅作展示说明，具体政策以官方发布为准。</p>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
