import { useState } from 'react'
import { isValidSourceUrl } from '../../lib/url'
import type { PolicyPostView } from '../../services/api/policies'
import { QrCodeIcon, ScrollTextIcon } from 'lucide-react'
import { CATEGORY_META } from './shared'
import { CollapsedChevron, type SourceQrTarget } from './components'

const SRC_RULE = '来源入口由发布方提供，本系统未核验其官方性；扫码前请核对机构和目标域名。'

export function NoticePanel({
  notices,
  onOpened,
  onOfficialEntry,
}: {
  notices: PolicyPostView[]
  onOpened: (policy: PolicyPostView) => void
  onOfficialEntry: (policy: PolicyPostView, target: SourceQrTarget) => void
}) {
  const [expandedId, setExpandedId] = useState<string | null>(notices[0]?.id ?? null)

  if (notices.length === 0) {
    return (
      <div className="rq-state" data-kind="empty" data-testid="renshi-notice-empty">
        <b>暂无政策公告</b>
        <p>公告由合作机构发布、管理员审核后展示。可以先看就业政策里的办事指引，或切到上面的其他分区。</p>
      </div>
    )
  }

  return (
    <div className="rq-list" data-testid="renshi-notice-list">
      {notices.map((notice) => {
        const meta = (notice.category && CATEGORY_META[notice.category]) || CATEGORY_META.notice
        const open = expandedId === notice.id
        const urlOk = Boolean(notice.externalUrl && isValidSourceUrl(notice.externalUrl))
        const urlMissing = !notice.externalUrl
        return (
          <article key={notice.id} className={`k8-policy-list-item${open ? ' is-open' : ''}`}>
            <button
              type="button"
              className="rq-item-main"
              aria-expanded={open}
              onClick={() => {
                setExpandedId(open ? null : notice.id)
                if (!open) onOpened(notice)
              }}
            >
              <span className="rq-item-ic rq-item-ic-lib" aria-hidden="true"><ScrollTextIcon /></span>
              <span className="rq-item-tx">
                <b>{notice.title}</b>
                <span className="rq-item-sub">{notice.summary || '正文与来源链接由发布机构提交，本机不改写'}</span>
              </span>
              <span className="rq-item-tail">
                <span className="rq-tag rq-tag-lib">{meta?.label ?? '通知'}</span>
                <CollapsedChevron />
              </span>
            </button>
            {open && (
              <div className="rq-acc">
                {notice.content ? (
                  <div className="rq-quote"><span>公告正文</span><p>{notice.content}</p></div>
                ) : null}
                {notice.publishedDate ? <p className="rq-srcchip">发布时间 <b>{notice.publishedDate}</b></p> : null}
                <p className="rq-srcchip">发布机构 <b>{notice.sourceName}</b></p>
                <p className="rq-note">{SRC_RULE}</p>
                {urlOk ? (
                  <button
                    type="button"
                    className="rq-exit"
                    onClick={() => onOfficialEntry(notice, {
                      title: notice.title,
                      url: notice.externalUrl!,
                      sourceKind: '合作机构发布 · 管理员审核',
                      sourceDetail: notice.sourceName,
                    })}
                  >
                    <QrCodeIcon aria-hidden="true" />
                    <span><b>扫码打开来源链接</b><small>先核对机构和目标域名</small></span>
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      className="rq-exit"
                      aria-disabled="true"
                      onClick={(event) => event.preventDefault()}
                    >
                      <QrCodeIcon aria-hidden="true" />
                      <span>
                        <b>来源二维码暂不可用</b>
                        <small>{urlMissing ? '发布方没有提供来源地址' : '来源地址不是有效的网址'}</small>
                      </span>
                    </button>
                    <p className="rq-why">
                      {urlMissing ? '发布方没有提供来源地址' : '来源地址不是有效的网址'}；本机不会猜地址或补链接。
                    </p>
                  </>
                )}
              </div>
            )}
          </article>
        )
      })}
    </div>
  )
}
