import { KIcon } from '../../../components/kiosk-icon'
import type { Entry, EntrySectionData } from '../profileTypes'

// 分区渲染（墨青纸感）：sec-head + 三种布局。
// 点击行为由 onTap 统一处理，确保 route / 建设中 / 本次记录逻辑仍归 ProfilePage。

function GridEntry({ entry, onTap }: { entry: Entry; onTap: (e: Entry) => void }) {
  return (
    <button type="button" className="entry" onClick={() => onTap(entry)}>
      <span className={`ei ${entry.tone}`}>
        <KIcon name={entry.icon} />
      </span>
      <strong>{entry.label}</strong>
      {entry.desc && <span className="desc">{entry.desc}</span>}
      {entry.tag && <span className={entry.tag === '本次记录' ? 'badge session' : 'badge'}>{entry.tag}</span>}
    </button>
  )
}

function ChipEntry({ entry, onTap }: { entry: Entry; onTap: (e: Entry) => void }) {
  return (
    <button type="button" className="chip-row" onClick={() => onTap(entry)}>
      <span className={`ei ${entry.tone}`}>
        <KIcon name={entry.icon} />
      </span>
      <strong>{entry.label}</strong>
      {entry.tag ? (
        <span className={entry.tag === '本次记录' ? 'badge session' : 'badge'}>{entry.tag}</span>
      ) : (
        <span className="arrow">
          <KIcon name="arrow" />
        </span>
      )}
    </button>
  )
}

function AccountEntry({ entry, onTap }: { entry: Entry; onTap: (e: Entry) => void }) {
  return (
    <button type="button" className="account" onClick={() => onTap(entry)}>
      <span className="aci">
        <KIcon name={entry.icon} />
      </span>
      <strong>{entry.label}</strong>
      {entry.tag && <span className="badge">{entry.tag}</span>}
    </button>
  )
}

export function ProfileEntrySection({ section, onTap }: { section: EntrySectionData; onTap: (e: Entry) => void }) {
  const gridClass =
    section.layout === 'grid' ? 'entry-grid' : section.layout === 'chips' ? 'chip-grid' : 'account-grid'

  return (
    <section aria-label={section.title} className="kp-section">
      <div className="sec-head">
        <span className={section.rail && section.rail !== 'teal' ? `rail ${section.rail}` : 'rail'} aria-hidden="true" />
        <div>
          <h2>{section.title}</h2>
          {section.subtitle && <p>{section.subtitle}</p>}
        </div>
      </div>
      <div className={gridClass}>
        {section.entries.map((e) => {
          if (section.layout === 'grid') return <GridEntry key={e.label} entry={e} onTap={onTap} />
          if (section.layout === 'chips') return <ChipEntry key={e.label} entry={e} onTap={onTap} />
          return <AccountEntry key={e.label} entry={e} onTap={onTap} />
        })}
      </div>
    </section>
  )
}
