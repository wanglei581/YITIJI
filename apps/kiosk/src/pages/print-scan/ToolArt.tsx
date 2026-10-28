/**
 * 打印工具几屏用的示意图（稿 18 / 稿 20 的手机、U 盘、证件卡、文件叠）。
 * 只作示意，不代表任何真实文件或进度。颜色走 tool-touch.css 里 .scan-touch 下的 --sx-art-*，
 * 这里不写裸色值。
 */

/** 手机上传：手机屏上一页纸加一个向上的箭头和「上传」键。 */
export function PhoneArt() {
  return (
    <svg className="sx-art" viewBox="0 0 150 285" aria-hidden="true">
      <rect x="6" y="4" width="138" height="277" rx="24" fill="var(--sx-art-ink)" />
      <rect x="14" y="20" width="122" height="245" rx="14" fill="var(--qx-paper)" />
      <rect x="58" y="10" width="34" height="5" rx="2.5" fill="var(--sx-art-speaker)" />
      <rect x="34" y="70" width="58" height="76" rx="8" fill="var(--sx-art-sheet)" stroke="var(--sx-art-edge)" strokeWidth="2" />
      <path d="M76 70v18h16" fill="none" stroke="var(--sx-art-edge)" strokeWidth="2" />
      <rect x="44" y="104" width="38" height="5" rx="2" fill="var(--sx-art-line)" />
      <rect x="44" y="116" width="30" height="5" rx="2" fill="var(--sx-art-line)" />
      <circle cx="104" cy="180" r="22" fill="var(--sx-art-teal)" />
      <path d="M104 192v-24M94 177l10-10 10 10" stroke="var(--sx-art-sheet)" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="30" y="222" width="90" height="26" rx="13" fill="var(--sx-art-deep)" />
      <text x="75" y="235" dy=".35em" textAnchor="middle" fill="var(--qxt-cream)" fontSize="13" fontWeight="700">上传</text>
    </svg>
  )
}

/** U 盘插进打印机侧面的口。 */
export function UsbArt() {
  return (
    <svg className="sx-art" viewBox="0 0 150 150" aria-hidden="true">
      <rect x="18" y="86" width="114" height="46" rx="10" fill="var(--sx-art-base)" />
      <rect x="40" y="100" width="70" height="18" rx="4" fill="var(--sx-art-ink)" />
      <rect x="54" y="20" width="42" height="56" rx="8" fill="var(--sx-art-teal)" />
      <rect x="60" y="74" width="30" height="30" rx="3" fill="var(--sx-art-plug)" stroke="var(--sx-art-top)" strokeWidth="2" />
      <rect x="66" y="80" width="6" height="6" fill="var(--sx-art-top)" />
      <rect x="78" y="80" width="6" height="6" fill="var(--sx-art-top)" />
      <path d="M75 6v8M68 10l7 7 7-7" stroke="var(--qxt-clay)" strokeWidth="3.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

/** 证件卡：头像位加几行字。 */
export function IdCardArt() {
  return (
    <svg className="sx-art" viewBox="0 0 150 99" aria-hidden="true">
      <rect x="3" y="3" width="144" height="93" rx="10" fill="var(--qxt-slate-wash)" stroke="var(--qxt-art-slate)" strokeWidth="2" />
      <rect x="14" y="18" width="40" height="52" rx="6" fill="var(--sx-art-id-b)" />
      <circle cx="34" cy="38" r="9" fill="var(--sx-art-id-a)" />
      <path d="M20 66c2-9 8-13 14-13s12 4 14 13" fill="var(--sx-art-id-a)" />
      <rect x="66" y="22" width="64" height="7" rx="3" fill="var(--sx-art-id-a)" />
      <rect x="66" y="38" width="50" height="7" rx="3" fill="var(--sx-art-id-b)" />
      <rect x="66" y="54" width="58" height="7" rx="3" fill="var(--sx-art-id-b)" />
      <rect x="14" y="78" width="116" height="7" rx="3" fill="var(--sx-art-id-b)" />
    </svg>
  )
}

/** 两三张叠着的文件。 */
export function DocStackArt() {
  return (
    <svg className="sx-art" viewBox="0 0 150 140" aria-hidden="true">
      <rect x="36" y="4" width="96" height="116" rx="10" fill="var(--qxt-art-stack)" stroke="var(--qxt-art-edge)" strokeWidth="1.5" />
      <rect x="22" y="16" width="96" height="116" rx="10" fill="var(--qxt-art-stack)" stroke="var(--qxt-art-edge)" strokeWidth="1.5" />
      <rect x="8" y="28" width="96" height="108" rx="10" fill="var(--sx-art-sheet)" stroke="var(--qxt-art-edge)" strokeWidth="1.5" />
      <rect x="22" y="46" width="68" height="7" rx="3" fill="var(--sx-art-line)" />
      <rect x="22" y="62" width="54" height="7" rx="3" fill="var(--sx-art-line)" />
      <rect x="22" y="78" width="62" height="7" rx="3" fill="var(--sx-art-line)" />
      <rect x="22" y="94" width="40" height="7" rx="3" fill="var(--sx-art-line)" />
    </svg>
  )
}

/** 一页纸，下角盖着虚线框的手写签名（签名各屏的示意小样）。 */
export function SignArt() {
  return (
    <svg className="sx-art" viewBox="0 0 150 150" aria-hidden="true">
      <rect x="30" y="8" width="90" height="126" rx="10" fill="var(--sx-art-sheet)" stroke="var(--qxt-art-edge)" strokeWidth="1.5" />
      <rect x="44" y="26" width="62" height="7" rx="3" fill="var(--sx-art-line)" />
      <rect x="44" y="42" width="48" height="7" rx="3" fill="var(--sx-art-line)" />
      <rect x="44" y="58" width="56" height="7" rx="3" fill="var(--sx-art-line)" />
      <rect x="62" y="96" width="52" height="28" rx="6" fill="none" stroke="var(--sx-art-teal)" strokeWidth="2.5" strokeDasharray="6 4" />
      <path d="M68 116c4-12 8-12 10-4s6 8 10-2 6-6 10 2" fill="none" stroke="var(--sx-art-deep)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
