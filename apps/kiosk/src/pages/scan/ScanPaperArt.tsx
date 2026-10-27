/** 稿里的扫描示意：进纸器、歪放的纸、出纸口绿条。只作示意，不代表页数或进度。 */
export function ScanPaperArt() {
  return (
    <svg className="fs-paper" viewBox="0 0 150 150" aria-hidden="true">
      <rect x="10" y="64" width="130" height="62" rx="12" fill="var(--qxt-line)" />
      <rect x="10" y="52" width="130" height="18" rx="7" fill="var(--qxt-ink-3)" />
      <rect x="34" y="18" width="70" height="56" rx="6" fill="var(--qxt-card)" stroke="var(--qxt-edge)" strokeWidth="2" transform="rotate(-8 69 46)" />
      <rect x="46" y="32" width="40" height="5" rx="2" fill="var(--qxt-ink-3)" transform="rotate(-8 69 46)" />
      <rect x="46" y="44" width="30" height="5" rx="2" fill="var(--qxt-ink-3)" transform="rotate(-8 69 46)" />
      <rect x="22" y="96" width="106" height="6" rx="3" fill="var(--qx-emerald)" />
    </svg>
  )
}
