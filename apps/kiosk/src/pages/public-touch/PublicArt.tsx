/** 公共页线稿。只用 currentColor，不靠底色填空白。 */
export function PublicArt({ kind }: { kind: 'resume' | 'stack' | 'list' | 'phone' | 'machine' }) {
  const common = {
    viewBox: '0 0 160 120',
    fill: 'none',
    xmlns: 'http://www.w3.org/2000/svg',
    'aria-hidden': true as const,
  }
  if (kind === 'stack') {
    return (
      <svg {...common}>
        <rect x="28" y="22" width="104" height="76" rx="8" stroke="currentColor" strokeWidth="3" />
        <path d="M44 44h72M44 60h56M44 76h40" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        <rect x="46" y="8" width="68" height="18" rx="6" stroke="currentColor" strokeWidth="3" />
      </svg>
    )
  }
  if (kind === 'list') {
    return (
      <svg {...common}>
        <rect x="24" y="14" width="112" height="92" rx="10" stroke="currentColor" strokeWidth="3" />
        <path d="M40 38h16M64 38h56M40 58h16M64 58h48M40 78h16M64 78h40" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    )
  }
  if (kind === 'phone') {
    return (
      <svg {...common}>
        <rect x="52" y="8" width="56" height="104" rx="12" stroke="currentColor" strokeWidth="3" />
        <path d="M68 28h24M64 48h32M64 64h24" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        <circle cx="80" cy="92" r="6" stroke="currentColor" strokeWidth="3" />
      </svg>
    )
  }
  if (kind === 'machine') {
    return (
      <svg {...common}>
        <rect x="22" y="16" width="116" height="72" rx="10" stroke="currentColor" strokeWidth="3" />
        <path d="M36 34h40M36 50h28" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        <rect x="86" y="32" width="34" height="28" rx="4" stroke="currentColor" strokeWidth="3" />
        <path d="M48 88h64M40 100h80" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <rect x="36" y="8" width="88" height="104" rx="8" stroke="currentColor" strokeWidth="3" />
      <path d="M50 28h60M50 44h44M50 60h52M50 76h28" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
      <circle cx="108" cy="88" r="14" stroke="currentColor" strokeWidth="3" />
      <path d="M101 88l5 5 10-12" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}
