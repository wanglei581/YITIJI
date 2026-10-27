import type { ReactNode } from 'react'

/** 稿里的报告插画：几行进度条和要点，纯装饰，不表示任何结果。 */
export function InterviewArtMark({ className = 'qxt-iv-art-mark', align = 'center' }: { className?: string; align?: 'center' | 'left' }) {
  return (
    <svg className={className} viewBox="0 0 300 420" width="300" height="420" preserveAspectRatio={align === 'left' ? 'xMinYMid meet' : 'xMidYMid meet'} aria-hidden="true">
      <rect width="300" height="420" rx="24" fill="var(--qx-paper)" />
      <rect x="28" y="32" width="168" height="22" rx="6" fill="var(--qx-deep)" />
      <rect x="28" y="68" width="120" height="12" rx="4" fill="var(--qxt-ink-3)" />
      <rect x="28" y="108" width="244" height="16" rx="8" fill="var(--qxt-line)" />
      <rect x="28" y="108" width="180" height="16" rx="8" fill="var(--qxt-teal-ink)" />
      <rect x="28" y="136" width="244" height="16" rx="8" fill="var(--qxt-line)" />
      <rect x="28" y="136" width="140" height="16" rx="8" fill="var(--qxt-teal-ink)" />
      <rect x="28" y="164" width="244" height="16" rx="8" fill="var(--qxt-line)" />
      <rect x="28" y="164" width="100" height="16" rx="8" fill="var(--qxt-clay)" />
      <circle cx="40" cy="214" r="8" fill="var(--qxt-teal-ink)" />
      <rect x="60" y="208" width="160" height="12" rx="4" fill="var(--qxt-ink-3)" />
      <circle cx="40" cy="246" r="8" fill="var(--qxt-teal-ink)" />
      <rect x="60" y="240" width="140" height="12" rx="4" fill="var(--qxt-ink-3)" />
      <circle cx="40" cy="278" r="8" fill="var(--qxt-clay)" />
      <rect x="60" y="272" width="170" height="12" rx="4" fill="var(--qxt-ink-3)" />
      <rect x="28" y="312" width="200" height="14" rx="4" fill="var(--qxt-ink-3)" />
      <rect x="28" y="338" width="168" height="14" rx="4" fill="var(--qxt-ink-3)" />
      <rect x="28" y="372" width="120" height="28" rx="10" fill="var(--qx-deep)" />
    </svg>
  )
}

/**
 * 稿 fi-art：插画在上、标题和说明居中。状态页（读取中、不可用、为空、过期）都用它。
 * fill：放在内容页的最下面当余高吸收件。余高够放（约 320px 以上）时撑满余高，不够就整块不出现，
 * 不留半截字，也不给已经装满的页再多添一屏要滑。
 */
export function InterviewArt({
  title,
  children,
  headingRef,
  variant = 'page',
}: {
  title: string
  children: ReactNode
  headingRef?: React.Ref<HTMLHeadingElement>
  variant?: 'page' | 'more' | 'fill'
}) {
  const art = (
    <section className={variant === 'more' ? 'qxt-iv-art is-more' : 'qxt-iv-art'}>
      <InterviewArtMark />
      <div className="qxt-iv-art-copy">
        <h2 ref={headingRef} tabIndex={-1}>{title}</h2>
        <p>{children}</p>
      </div>
    </section>
  )
  return variant === 'fill' ? <div className="qxt-iv-artslot">{art}</div> : art
}
