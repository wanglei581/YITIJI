// /legal/:doc 的呈现件（稿 08-legal）。只管排版，不取数、不拼条款正文。
// 图标沿用稿里那一套线性路径（stroke 1.9），与 lucide 同体系，逐条对得上稿。

import type { CSSProperties, ReactNode, Ref } from 'react'
import type { Section } from './legalDocModel'

type GlyphName = 'file' | 'shield' | 'warn' | 'info' | 'spark' | 'server' | 'desk' | 'refresh' | 'arrow' | 'clock'

const GLYPHS: Record<GlyphName, ReactNode> = {
  file: <><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></>,
  shield: <><path d="M12 3.2l7.4 2.8v5.4c0 4.6-3.1 8.2-7.4 9.4-4.3-1.2-7.4-4.8-7.4-9.4V6z" /><path d="M8.8 12.1l2.2 2.2 4.2-4.4" /></>,
  warn: <><path d="M12 4.6L21 19.4H3z" /><path d="M12 10v4.6M12 17.2h.01" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>,
  spark: <path d="M12 3.2l1.9 5 5.1 1.9-5.1 1.9L12 17l-1.9-5L5 10.1l5.1-1.9z" />,
  server: <><rect x="3.5" y="4" width="17" height="6.5" rx="2" /><rect x="3.5" y="13.5" width="17" height="6.5" rx="2" /><path d="M7 7.2h.01M7 16.8h.01" /></>,
  desk: <><path d="M21 10c0 7-9 12.5-9 12.5S3 17 3 10a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3.1" /></>,
  refresh: <><path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1" /><path d="M20.5 4.4V10h-5.6" /></>,
  arrow: <path d="M5 12h13M12.5 6l6 6-6 6" />,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 6.6V12l3.6 2.1" /></>,
}

export function Glyph({ name, size = 28 }: { name: GlyphName; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.9}
         strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {GLYPHS[name]}
    </svg>
  )
}

export type Tone = 'slate' | 'teal' | 'wheat' | 'plum'

export interface DocMeta {
  key: 'terms' | 'privacy'
  docType: 'terms_of_service' | 'privacy_policy'
  title: string
  eyebrow: string
  summary: string
  glyph: 'file' | 'shield'
  tone: Tone
  sections: Section[]
}

/** 稿里的区块：编号 + 标题 + 右侧提示，下面是内容。 */
export function LegalSec({ no, title, hint, aside, className, children }: {
  no?: string
  title?: string
  hint?: string
  aside?: ReactNode
  className?: string
  children: ReactNode
}) {
  return (
    <section className={`legal-doc-sec${className ? ` ${className}` : ''}`}>
      {title ? (
        <div className="legal-doc-label">
          {no ? <span className="no" aria-hidden="true">{no}</span> : null}
          <h2 className="t">{title}</h2>
          {hint ? <span className="hint">{hint}</span> : null}
          {aside}
        </div>
      ) : null}
      {children}
    </section>
  )
}

export function DocTabs({ docs, active, onSwitch }: { docs: DocMeta[]; active: DocMeta['key']; onSwitch: (key: DocMeta['key']) => void }) {
  return (
    <div className="legal-doc-tabs" role="group" aria-label="法律文档">
      {docs.map((doc) => (
        <button key={doc.key} type="button" aria-pressed={doc.key === active} data-testid={`legal-doc-${doc.key}`}
                onClick={() => onSwitch(doc.key)}>
          <Glyph name={doc.glyph} size={26} />{doc.title}
        </button>
      ))}
    </div>
  )
}

export function DocHead({ doc, meta }: { doc: DocMeta; meta: ReactNode }) {
  return (
    <div className="legal-doc-head">
      <span className="legal-doc-ic" data-tone={doc.tone}><Glyph name={doc.glyph} size={38} /></span>
      <div className="legal-doc-head-main">
        <div className="legal-doc-eyebrow" aria-hidden="true">{doc.eyebrow}</div>
        <h2 className="legal-doc-title">{doc.title}</h2>
        <p className="legal-doc-sum">{doc.summary}</p>
        <div className="legal-doc-meta">{meta}</div>
      </div>
    </div>
  )
}

export function FontTools({ percent, onSmaller, onLarger }: { percent: number; onSmaller: () => void; onLarger: () => void }) {
  return (
    <div className="legal-doc-tools" role="group" aria-label="正文字号">
      <button type="button" className="legal-doc-font" aria-label="缩小字号" data-testid="legal-font-smaller"
              disabled={percent <= 90} onClick={onSmaller}>A−</button>
      <span className="legal-doc-font-now" aria-live="polite">{percent}%</span>
      <button type="button" className="legal-doc-font" aria-label="放大字号" data-testid="legal-font-larger"
              disabled={percent >= 120} onClick={onLarger}>A＋</button>
    </div>
  )
}

export function LegalReader({ sections, active, onSelect, fontPercent, bodyRef }: {
  sections: Section[]
  active: number
  onSelect: (index: number) => void
  fontPercent: number
  bodyRef: Ref<HTMLElement>
}) {
  const section = sections[active] ?? sections[0]
  return (
    <div className="legal-doc-reader">
      <aside className="legal-doc-toc" aria-label="章节目录" data-testid="legal-list">
        <p className="legal-doc-toc-title" aria-hidden="true">章节目录</p>
        {sections.map((item, index) => (
          <button key={`${index}-${item.title}`} type="button" aria-current={index === active ? 'true' : undefined}
                  data-testid={`legal-sec-${index}`} onClick={() => onSelect(index)}>
            <span className="legal-doc-toc-no" aria-hidden="true">{index + 1}</span>{item.title}
          </button>
        ))}
      </aside>
      <article ref={bodyRef} className="legal-doc-body" tabIndex={0} aria-label={section.title}
               style={{ '--legal-font-scale': fontPercent / 100 } as CSSProperties}>
        <h3>{section.title}</h3>
        {section.paragraphs.map((paragraph, index) => <p key={index}>{paragraph}</p>)}
      </article>
    </div>
  )
}

/** 取正文期间只放槽位：六条目录形状 + 八行正文形状，不放任何文字。 */
export function ReaderSkeleton() {
  return (
    <div className="legal-doc-sk" aria-hidden="true">
      <div className="legal-doc-sk-toc">{Array.from({ length: 6 }, (_, index) => <i key={index} />)}</div>
      <div className="legal-doc-sk-body">{Array.from({ length: 8 }, (_, index) => <i key={index} />)}</div>
    </div>
  )
}

export function LegalCard({ tone, glyph, title, children }: { tone: Tone; glyph: GlyphName; title: string; children: ReactNode }) {
  return (
    <div className="legal-doc-card">
      <h3><span className="legal-doc-ic" data-tone={tone}><Glyph name={glyph} size={26} /></span>{title}</h3>
      {children}
    </div>
  )
}

export function StateBlock({ kind, glyph, title, testId, live, children }: {
  kind: 'warn' | 'error'
  glyph: GlyphName
  title: string
  testId?: string
  live?: boolean
  children: ReactNode
}) {
  return (
    <div className="legal-doc-state" data-kind={kind} data-testid={testId} role={live ? 'status' : undefined}>
      <h2 className="legal-doc-state-h"><Glyph name={glyph} size={28} />{title}</h2>
      {children}
    </div>
  )
}

/** not-found 的大选择卡：带前三章标题，点之前就知道两份文档不是同一个东西。 */
export function PickCard({ doc, sections, onPick }: { doc: DocMeta; sections: Section[]; onPick: () => void }) {
  return (
    <button type="button" className="legal-doc-pick" data-testid={`legal-pick-${doc.key}`} onClick={onPick}>
      <span className="legal-doc-ic" data-tone={doc.tone}><Glyph name={doc.glyph} size={30} /></span>
      <span className="legal-doc-pick-t">{doc.title}</span>
      <span className="legal-doc-pick-d">{doc.summary}</span>
      <span className="legal-doc-pick-secs">
        {sections.slice(0, 3).map((section, index) => <span key={`${index}-${section.title}`}>· {section.title}</span>)}
        <span>· 等共 {sections.length} 章</span>
      </span>
    </button>
  )
}

export function LegalTruth() {
  return (
    <div className="legal-doc-truth" data-disclaimer="true" data-testid="legal-truth">
      <p><b>正文从哪来</b>条款正文由运营方发布、经服务端返回；本机留存文本只在取不到时出现，并标明不作为正式版本。</p>
      <p><b>怎么算数</b>以运营方正式发布的版本为准。取不到正文时这里会明说取不到，不会拿旧文本顶上让你误以为读到了现行条款。</p>
    </div>
  )
}
