import { KIcon } from '../../../components/kiosk-icon'
import type { Entry, EntrySectionData } from '../profileTypes'

function ProfileEntry({ entry, onTap }: { entry: Entry; onTap: (entry: Entry) => void }) {
  const disabled = entry.tag === '建设中'

  return (
    <button type="button" className="kp-entry" disabled={disabled} onClick={() => onTap(entry)}>
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
  if (section.entries.length === 0) return null

  return (
    <section aria-label={section.title} className="kp-section">
      <div className="kp-section-head">
        <div>
          <h2>{section.title}</h2>
          {section.subtitle && <p>{section.subtitle}</p>}
        </div>
      </div>
      <div className={`kp-entry-grid kp-entry-grid--${section.layout}`}>
        {section.entries.map((entry, index) => (
          <ProfileEntry
            key={`${entry.label}:${entry.route ?? entry.tag ?? index}`}
            entry={entry}
            onTap={onTap}
          />
        ))}
      </div>
    </section>
  )
}
