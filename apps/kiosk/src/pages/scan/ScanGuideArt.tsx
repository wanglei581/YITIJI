import { PrintArt } from '../print/art/PrintArt'
import { DocStackArt, IdCardArt } from '../print-scan/ToolArt'
import type { ScanMaterial } from './scanMaterials'

/**
 * 玻璃台示意。颜色走扫描页已有的 --sx-art-* / --qxt-*，不写裸色值。
 * viewBox 只在要裁掉四周透明边、把图放大的地方传（复印已停止，照稿 cs-scan-stopped?flow=copy 的裁法）。
 */
export function GlassArt({ viewBox = '0 0 150 150' }: { viewBox?: string } = {}) {
  return (
    <svg className="sx-art" viewBox={viewBox} aria-hidden="true">
      <rect x="8" y="22" width="134" height="108" rx="14" fill="var(--sx-art-base)" />
      <rect x="20" y="34" width="110" height="84" rx="8" fill="var(--qxt-teal-wash)" stroke="var(--sx-art-top)" strokeWidth="2" />
      <rect x="30" y="46" width="52" height="64" rx="3" fill="var(--sx-art-sheet)" stroke="var(--qxt-art-edge)" strokeWidth="2" />
      <rect x="38" y="56" width="34" height="5" rx="2" fill="var(--sx-art-line)" />
      <rect x="38" y="68" width="26" height="5" rx="2" fill="var(--sx-art-line)" />
      <rect x="38" y="80" width="34" height="5" rx="2" fill="var(--sx-art-line)" />
      <rect x="38" y="92" width="22" height="5" rx="2" fill="var(--sx-art-line)" />
      <path d="M22 62V36h26" fill="none" stroke="var(--qxt-mark-b)" strokeWidth="4.5" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="14" y="132" width="122" height="6" rx="3" fill="var(--sx-art-top)" />
    </svg>
  )
}

/** 进纸器示意。empty 时不画纸，给出纸口和进纸方向。viewBox 同玻璃台，只在要裁边放大时传。 */
export function FeederArt({ empty = false, viewBox = '0 0 150 150' }: { empty?: boolean; viewBox?: string }) {
  return (
    <svg className="sx-art" viewBox={viewBox} aria-hidden="true">
      <rect x="8" y="82" width="134" height="50" rx="12" fill="var(--sx-art-base)" />
      <path d="M26 82 L36 20 H116 L124 82 Z" fill="var(--qxt-art-track)" stroke="var(--sx-art-top)" strokeWidth="2" />
      {empty ? null : (
        <>
          <rect x="48" y="26" width="58" height="38" rx="3" fill="var(--sx-art-sheet)" stroke="var(--qxt-art-edge)" strokeWidth="2" transform="rotate(-4 77 45)" />
          <rect x="44" y="22" width="58" height="38" rx="3" fill="var(--sx-art-sheet)" stroke="var(--qxt-art-edge)" strokeWidth="2" />
          <rect x="52" y="31" width="34" height="5" rx="2" fill="var(--sx-art-line)" />
          <rect x="52" y="42" width="26" height="5" rx="2" fill="var(--sx-art-line)" />
          <path d="M126 22v22M118 36l8 8 8-8" fill="none" stroke="var(--qxt-mark-b)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      <rect x="20" y="70" width="110" height="18" rx="8" fill="var(--sx-art-top)" />
      <rect x="30" y="104" width="90" height="6" rx="3" fill="var(--qxt-mark-a)" />
    </svg>
  )
}

/** 合同小样：一页纸加一道示意签字线。不是签名功能。 */
export function ContractArt() {
  return (
    <svg className="sx-art" viewBox="0 0 120 170" aria-hidden="true">
      <rect x="1" y="1" width="118" height="168" rx="6" fill="var(--sx-art-sheet)" stroke="var(--qxt-art-edge)" strokeWidth="2" />
      <rect x="14" y="16" width="64" height="10" rx="3" fill="var(--qxt-ink)" />
      <rect x="14" y="40" width="92" height="5" rx="2" fill="var(--sx-art-line)" />
      <rect x="14" y="54" width="80" height="5" rx="2" fill="var(--sx-art-line)" />
      <rect x="14" y="68" width="92" height="5" rx="2" fill="var(--sx-art-line)" />
      <rect x="14" y="82" width="70" height="5" rx="2" fill="var(--sx-art-line)" />
      <rect x="14" y="96" width="88" height="5" rx="2" fill="var(--sx-art-line)" />
      <rect x="14" y="110" width="60" height="5" rx="2" fill="var(--sx-art-line)" />
      <path d="M16 142q8-18 14-5t14-1 16-8" fill="none" stroke="var(--qxt-art-slate)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="14" y="150" width="62" height="2.5" rx="1" fill="var(--sx-art-top)" />
    </svg>
  )
}

/** 四种材料卡左边的小样。简历、文件叠、证件复用现成插画。 */
export function MaterialThumb({ material }: { material: ScanMaterial }) {
  if (material === 'resume') return <PrintArt name="resume" size={148} />
  if (material === 'id') return <IdCardArt />
  if (material === 'document') return <DocStackArt />
  return <ContractArt />
}
