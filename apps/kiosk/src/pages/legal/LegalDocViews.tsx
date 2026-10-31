// /legal/:doc 的呈现件（触屏稿 legal）：文档切换、章节阅读、字号。只管排版，不取数、不拼条款正文。
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
        {/* 稿上目录没有标题字，样式把它收起来；给读屏留一个 h2，章节标题仍是下面的 h3。 */}
        <h2 className="legal-doc-toc-title">章节目录</h2>
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
