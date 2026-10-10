import { useEffect, useRef, useState } from 'react'
import { isValidSourceUrl } from '../../lib/url'
import type { PolicyPostView } from '../../services/api/policies'
import { policyPublishedOn } from './policyFacts'
import { FileTextIcon, PrinterIcon, QrCodeIcon, ScaleIcon, ScrollTextIcon } from 'lucide-react'
import { CATEGORY_META, type TabKey } from './shared'
import { CollapsedChevron, RqDeadEnd, SourceFacts, type SourceQrTarget } from './components'

const SRC_RULE = '来源入口由发布方提供，本系统未核验其官方性；扫码前请核对机构和目标域名。'

export function NoticePanel({
  notices,
  focusId,
  suppressAutoOpen = false,
  onOpened,
  onActiveId,
  onUpload,
  onOfficialEntry,
  onTab,
}: {
  notices: PolicyPostView[]
  /** 收藏或地址里点名的那一条。在公告里就展开它，不先展开第一条。 */
  focusId?: string | null
  /** 刚撤下一条时，不要改去展开下一条。 */
  suppressAutoOpen?: boolean
  onOpened: (policy: PolicyPostView) => void
  onActiveId: (id: string | null) => void
  onUpload: (id: string) => void
  onOfficialEntry: (policy: PolicyPostView, target: SourceQrTarget) => void
  onTab: (tab: TabKey) => void
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)
  const openedFocusRef = useRef<string | null>(null)
  const focusHit = focusId && notices.some((item) => item.id === focusId) ? focusId : null
  const stillThere = (id: string | null) => Boolean(id && notices.some((item) => item.id === id))
  const openId = touched
    ? (stillThere(expandedId) ? expandedId : null)
    : suppressAutoOpen
      ? focusHit
      : (focusHit ?? notices[0]?.id ?? null)

  useEffect(() => {
    onActiveId(openId)
    return () => onActiveId(null)
  }, [onActiveId, openId])

  useEffect(() => {
    if (!focusHit || openId !== focusHit) return
    if (openedFocusRef.current === focusHit) return
    const item = notices.find((entry) => entry.id === focusHit)
    if (!item) return
    openedFocusRef.current = focusHit
    onOpened(item)
    if (!touched) {
      document.querySelector(`[data-policy-id="${CSS.escape(focusHit)}"]`)?.scrollIntoView({ block: 'nearest' })
    }
  }, [focusHit, notices, onOpened, openId, touched])

  if (notices.length === 0) {
    return (
      <RqDeadEnd
        tone="empty"
        icon={ScrollTextIcon}
        title="暂无政策公告"
        testId="renshi-notice-empty"
        exitsHint="公告为空不影响这三条"
        exits={[
          { key: 'policy', icon: FileTextIcon, title: '去看就业政策', desc: '政策条目与办事指引', onClick: () => onTab('policy') },
          { key: 'eligibility', icon: ScaleIcon, title: '去条件核对', desc: '按政策原文逐条比对', onClick: () => onTab('eligibility') },
        ]}
        uploadDesc="不受公告影响"
        note="公告正文与来源链接都由发布机构提交，本机不改写、不补写。"
      >
        公告由发布机构自己审核并发布，目前一条都没有。这是内容进度，不是读取失败；读取失败会另有一屏说明。
      </RqDeadEnd>
    )
  }

  return (
    <div className="rq-list" data-testid="renshi-notice-list" data-count={notices.length}>
      {notices.map((notice) => {
        const meta = (notice.category && CATEGORY_META[notice.category]) || CATEGORY_META.notice
        const open = openId === notice.id
        const urlOk = Boolean(notice.externalUrl && isValidSourceUrl(notice.externalUrl))
        const urlMissing = !notice.externalUrl
        return (
          <article key={notice.id} className={`k8-policy-list-item${open ? ' is-open' : ''}`} data-policy-id={notice.id}>
            <button
              type="button"
              className="rq-item-main"
              aria-expanded={open}
              onClick={() => {
                setTouched(true)
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
                <SourceFacts
                  sourceName={notice.sourceName}
                  syncTime={notice.syncTime}
                  publishedOn={policyPublishedOn(notice)}
                  dateLabel="发布时间"
                />
                <p className="rq-note">{SRC_RULE}</p>
                <div className="rq-strip">
                  {urlOk ? (
                    <button
                      type="button"
                      className="rq-exit"
                      onClick={() => onOfficialEntry(notice, {
                        title: notice.title,
                        url: notice.externalUrl!,
                        sourceKind: '机构发布 · 机构自己审核',
                        sourceDetail: notice.sourceName,
                      })}
                    >
                      <QrCodeIcon aria-hidden="true" />
                      <span><b>扫码打开来源链接</b><small>先核对机构和目标域名</small></span>
                    </button>
                  ) : (
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
                  )}
                  {/* 稿 48 公告展开条：来源二维码旁边一格上传自备材料打印（公告本身不提供下载）。 */}
                  <button type="button" className="rq-exit" onClick={() => onUpload(notice.id)}>
                    <PrinterIcon aria-hidden="true" />
                    <span><b>上传自备材料打印</b><small>本机只打印你自己带来的文件</small></span>
                  </button>
                </div>
                {!urlOk && (
                  <p className="rq-why">
                    {urlMissing ? '发布方没有提供来源地址' : '来源地址不是有效的网址'}；本机不会猜地址或补链接。
                  </p>
                )}
              </div>
            )}
          </article>
        )
      })}
    </div>
  )
}
