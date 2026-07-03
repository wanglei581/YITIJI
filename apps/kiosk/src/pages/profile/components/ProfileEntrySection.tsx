import type { Entry, EntrySectionData } from '../profileTypes'

const cardSurface = 'rounded-2xl border border-neutral-200 bg-white shadow-sm'

// 入口格子：触控区 ≥72px（实际 min-h-[92px] + 内边距），彩色浅底图标 + 标签。无卡片套卡片。
function EntryCell({ entry, onTap }: { entry: Entry; onTap: (e: Entry) => void }) {
  const { icon: Icon, iconBg, iconColor, label, tag } = entry
  return (
    <button
      type="button"
      onClick={() => onTap(entry)}
      className="flex min-h-[92px] flex-col items-center justify-start gap-2 rounded-xl px-1.5 py-3 text-center transition-colors hover:bg-neutral-50 active:bg-neutral-100"
    >
      <span className={['flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl', iconBg].join(' ')}>
        <Icon className={['h-6 w-6', iconColor].join(' ')} aria-hidden="true" />
      </span>
      <span className="text-xs font-medium leading-tight text-neutral-700">{label}</span>
      {tag && (
        <span
          className={[
            'rounded-full px-1.5 py-px text-[10px] font-medium',
            tag === '建设中' ? 'bg-neutral-100 text-neutral-400' : 'bg-primary-50 text-primary-600',
          ].join(' ')}
        >
          {tag}
        </span>
      )}
    </button>
  )
}

export function ProfileEntrySection({ section, onTap }: { section: EntrySectionData; onTap: (e: Entry) => void }) {
  return (
    <section aria-label={section.title} className="flex flex-col gap-3">
      <h2 className="text-sm font-medium text-neutral-500">{section.title}</h2>
      <div className={`${cardSurface} p-3 sm:p-4`}>
        <div className="grid grid-cols-3 gap-1 sm:gap-2 md:grid-cols-4 lg:grid-cols-5">
          {section.entries.map((e) => (
            <EntryCell key={e.label} entry={e} onTap={onTap} />
          ))}
        </div>
      </div>
    </section>
  )
}
