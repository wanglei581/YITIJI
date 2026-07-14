import { KIcon } from '../../../components/kiosk-icon'
import type { Entry, EntrySectionData } from '../profileTypes'

function ProfileEntry({ entry, primary, onTap }: { entry: Entry; primary: boolean; onTap: (entry: Entry) => void }) {
  const surfaceClass = primary ? 'lf-reference-primary' : 'lf-reference-secondary'

  return (
    <button type="button" className={`${surfaceClass} kp-entry`} onClick={() => onTap(entry)}>
      <span className={`kp-entry-icon ${entry.tone}`}>
        <KIcon name={entry.icon} />
      </span>
      <span className="kp-entry-content">
        <strong>{entry.label}</strong>
        {entry.desc && <span>{entry.desc}</span>}
      </span>
      {entry.tag ? (
        <span className={entry.tag === '本次记录' ? 'kp-entry-tag session' : 'kp-entry-tag'}>{entry.tag}</span>
      ) : (
        <span className="kp-entry-arrow" aria-hidden="true">
          <KIcon name="arrow" />
        </span>
      )}
    </button>
  )
}

export function ProfileEntrySection({ section, onTap }: { section: EntrySectionData; onTap: (entry: Entry) => void }) {
  const [primaryEntry, ...secondaryEntries] = section.entries

  if (!primaryEntry) return null

  return (
    <section aria-label={section.title} className="lf-reference-panel kp-section">
      <div className="lf-reference-group-head">
        <span className={`kp-group-icon ${primaryEntry.tone}`} aria-hidden="true">
          <KIcon name={primaryEntry.icon} />
        </span>
        <div>
          <h2>{section.title}</h2>
          {section.subtitle && <p>{section.subtitle}</p>}
        </div>
      </div>
      <ProfileEntry entry={primaryEntry} primary onTap={onTap} />
      <div className="kp-secondary-list">
        {secondaryEntries.map((entry, index) => (
          <ProfileEntry
            key={`${entry.label}:${entry.route ?? entry.tag ?? index}`}
            entry={entry}
            primary={false}
            onTap={onTap}
          />
        ))}
      </div>
    </section>
  )
}
