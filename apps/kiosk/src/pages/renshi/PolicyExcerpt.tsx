import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { QxTouchIcon } from '../../components/qingxu/touch/QxTouchIcon'
import { policyExcerptAbout, policyExcerptFits, policyExcerptPages } from './policySearchModel'

/** 发布机构填了正文才出。原样保留换行，不排版、不摘要，网址只当文字。 */
export function PolicyExcerpt({ content, title, source, published, onOverlay }: {
  content?: string | null
  title: string
  source: string
  published: string
  onOverlay: (overlay: ReactNode) => void
}) {
  const text = content ?? ''
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState(0)
  const fits = text.trim() ? policyExcerptFits(text) : true
  const pages = useMemo(() => policyExcerptPages(text), [text])
  const safePage = Math.min(page, pages.length - 1)
  useEffect(() => {
    if (!open || !text.trim()) {
      onOverlay(null)
      return
    }
    onOverlay(<div className="policy-read-layer" role="dialog" aria-label="原文摘录">
      <div className="policy-read-sheet">
        <div className="policy-excerpt-head">
          <div>
            <h2>原文摘录</h2>
            <p className="policy-min-fine policy-read-meta">{title} · {source}发布 · {published}</p>
          </div>
          <span className="policy-min-chip">以发布机构原文为准</span>
        </div>
        <div className="policy-read" data-testid="policy-excerpt-page">{pages[safePage]}</div>
        <div className="policy-read-pager">
          <button type="button" className="qxt-btn qxt-btn-sec" disabled={safePage === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}><QxTouchIcon name="chevL" size={30} strokeWidth={2.4} />上一页</button>
          <span>第 {safePage + 1} / {pages.length} 页</span>
          <button type="button" className="qxt-btn qxt-btn-pri" disabled={safePage >= pages.length - 1} onClick={() => setPage((current) => Math.min(pages.length - 1, current + 1))}>下一页<QxTouchIcon name="chevR" size={30} strokeWidth={2.4} /></button>
        </div>
        <p className="policy-read-note">这是发布机构填写的正文，原样显示，没有改动；办理以发布机构原文为准。</p>
        <button type="button" className="qxt-btn qxt-btn-sec policy-read-close" data-testid="policy-excerpt-close" onClick={() => setOpen(false)}>收起</button>
      </div>
    </div>)
    return () => onOverlay(null)
  }, [open, onOverlay, pages, published, safePage, source, text, title])
  if (!text.trim()) return null
  return <section className="policy-min-section" data-testid="policy-excerpt">
    <div className="policy-excerpt-head">
      <h2><QxTouchIcon name="book" size={30} />原文摘录</h2>
      <span className="policy-min-chip">以发布机构原文为准</span>
      {!fits && <button type="button" className="policy-excerpt-open" data-testid="policy-excerpt-open"
        onClick={() => { setPage(0); setOpen(true) }}>展开全文 · {policyExcerptAbout(text)}</button>}
    </div>
    <p className={fits ? 'policy-excerpt' : 'policy-excerpt policy-excerpt-cut'}>{text}</p>
  </section>
}
