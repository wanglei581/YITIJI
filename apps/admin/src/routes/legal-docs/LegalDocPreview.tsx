import { useState } from 'react'
import { splitLegalSections } from './legalDocRender'

/**
 * 按一体机的排版规则预览法务正文（规则见 ./legalDocRender.ts，对照一体机 legalDocModel.ts）。
 * 可切到「原文」看管理员实际录入的文字。
 */
export function LegalDocPreview({ content, className = '' }: { content: string; className?: string }) {
  const [mode, setMode] = useState<'rendered' | 'raw'>('rendered')
  const sections = splitLegalSections(content)
  const empty = !content.trim()

  return (
    <div className={['rounded-lg border border-neutral-200 bg-white', className].join(' ')}>
      <div className="flex items-center justify-between gap-2 border-b border-neutral-100 px-3 py-2">
        <span className="text-xs text-neutral-500">
          {mode === 'rendered' ? `按一体机排版预览 · 共 ${sections.length} 章` : '原文（管理员录入的文字）'}
        </span>
        <div className="flex gap-1" role="group" aria-label="正文显示方式">
          {(['rendered', 'raw'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={mode === value}
              onClick={() => setMode(value)}
              className={[
                'h-8 rounded-md px-2.5 text-xs font-medium',
                mode === value ? 'bg-primary-600 text-white' : 'text-neutral-600 hover:bg-neutral-100',
              ].join(' ')}
            >
              {value === 'rendered' ? '排版预览' : '原文'}
            </button>
          ))}
        </div>
      </div>
      <div className="max-h-[420px] overflow-y-auto px-4 py-3 text-sm leading-relaxed text-neutral-700">
        {empty ? (
          <p className="text-neutral-400">还没有正文</p>
        ) : mode === 'raw' ? (
          <pre className="whitespace-pre-wrap break-words font-sans">{content}</pre>
        ) : (
          sections.map((section, index) => (
            <section key={`${index}-${section.title}`} className={index > 0 ? 'mt-4' : ''}>
              <h3 className="text-base font-semibold text-neutral-900">{section.title}</h3>
              {section.paragraphs.map((paragraph, pIndex) => (
                <p key={pIndex} className="mt-2 whitespace-pre-line">{paragraph}</p>
              ))}
            </section>
          ))
        )}
      </div>
    </div>
  )
}
