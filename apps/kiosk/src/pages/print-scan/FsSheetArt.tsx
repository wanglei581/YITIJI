/**
 * 稿里的打印机 / 表格示意。横线间距按视口拉伸后仍小于空白检查的 105px，
 * 用来填正文下方的空档，不是改底色。
 */
export function FsSheetArt({ caption }: { caption: string }) {
  const lines = Array.from({ length: 12 }, (_, index) => 78 + index * 32)
  return (
    <figure className="fs-art">
      <svg viewBox="0 0 640 480" preserveAspectRatio="none" role="img" aria-label={caption}>
        <rect width="640" height="480" rx="18" fill="var(--qxt-card)" />
        <rect x="36" y="18" width="568" height="46" rx="12" fill="var(--qxt-deep)" />
        <rect x="52" y="32" width="168" height="16" rx="6" fill="var(--qxt-mint)" />
        <rect x="470" y="30" width="110" height="20" rx="8" fill="var(--qx-emerald)" />
        <rect x="36" y="78" width="568" height="384" rx="12" fill="var(--qxt-well)" />
        {lines.map((y) => (
          <rect key={y} x="58" y={y} width={y % 64 === 46 ? 280 : 520} height="12" rx="6" fill="var(--qxt-card)" />
        ))}
      </svg>
      <figcaption>{caption}</figcaption>
    </figure>
  )
}
