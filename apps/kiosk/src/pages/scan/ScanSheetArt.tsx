/** 纸页示意。只为版式，不代表已经扫到的那一页。 */
export function ScanSheetArt({
  width,
  height,
  stretch = false,
}: {
  width: number
  height: number
  /** 只在「状态未知」把示意线条铺满纸面，避免上下留出大块空白。 */
  stretch?: boolean
}) {
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 120 170"
      preserveAspectRatio={stretch ? 'none' : undefined}
      aria-hidden="true"
    >
      <rect x="1" y="1" width="118" height="168" rx="6" fill="var(--qxt-card)" stroke="var(--qxt-edge)" strokeWidth="2" />
      <rect x="14" y="18" width="62" height="10" rx="3" fill="var(--qx-deep, var(--qxt-deep-2))" />
      <rect x="14" y="40" width="92" height="5" rx="2" fill="var(--qx-emerald)" />
      <rect x="14" y="54" width="80" height="4" rx="2" fill="var(--qxt-art-rule, var(--qxt-edge))" />
      <rect x="14" y="68" width="92" height="5" rx="2" fill="var(--qx-emerald)" />
      <rect x="14" y="82" width="70" height="4" rx="2" fill="var(--qxt-art-rule, var(--qxt-edge))" />
      <rect x="14" y="96" width="86" height="5" rx="2" fill="var(--qx-emerald)" />
      <rect x="14" y="110" width="60" height="4" rx="2" fill="var(--qxt-art-rule, var(--qxt-edge))" />
      <rect x="14" y="124" width="88" height="5" rx="2" fill="var(--qx-emerald)" />
      <rect x="14" y="138" width="72" height="4" rx="2" fill="var(--qxt-art-rule, var(--qxt-edge))" />
      <rect x="14" y="152" width="84" height="5" rx="2" fill="var(--qx-emerald)" />
    </svg>
  )
}

export function ScanStackArt() {
  return (
    <svg className="sx-art" viewBox="0 0 150 150" aria-hidden="true">
      <rect x="28" y="36" width="78" height="100" rx="6" fill="var(--qxt-card)" stroke="var(--qxt-edge)" strokeWidth="2" transform="rotate(-8 67 86)" />
      <rect x="40" y="28" width="78" height="100" rx="6" fill="var(--qxt-card)" stroke="var(--qxt-edge)" strokeWidth="2" />
      <rect x="50" y="42" width="46" height="6" rx="2" fill="var(--qx-deep, var(--qxt-deep-2))" />
      <rect x="50" y="58" width="58" height="4" rx="2" fill="var(--qxt-art-rule, var(--qxt-edge))" />
      <rect x="50" y="70" width="50" height="4" rx="2" fill="var(--qxt-art-rule, var(--qxt-edge))" />
      <rect x="50" y="82" width="58" height="4" rx="2" fill="var(--qxt-art-rule, var(--qxt-edge))" />
    </svg>
  )
}
