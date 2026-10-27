import './print-art.css'
import { mfpArt, phoneArt, resumeArt, ringArt, scanPaperArt, stackArt, usbArt } from './printArtSvg'

export type PrintArtName = 'resume' | 'stack' | 'phone' | 'usb' | 'scan-paper' | 'mfp' | 'ring'

/** 把小样自带的四周留白裁掉一圈（viewBox 往里收）：小样在同样大的盒子里画得更满，又不会真的伸出盒子。 */
function cropViewBox(svg: string, crop: number): string {
  return svg.replace(/viewBox="(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)"/, (_all, x, y, w, h) => {
    const [vx, vy, vw, vh] = [x, y, w, h].map(Number)
    return `viewBox="${vx + vw * crop} ${vy + vh * crop} ${vw * (1 - 2 * crop)} ${vh * (1 - 2 * crop)}"`
  })
}

/** 实物小样。纯装饰，读屏跳过；内容是常量 SVG。 */
export function PrintArt({ name, size, count, pct, stroke, className, crop }: {
  name: PrintArtName
  size?: number
  count?: number
  pct?: number
  stroke?: number
  className?: string
  /** 四周各裁掉的比例（0–0.2）。不传就是整幅。 */
  crop?: number
}) {
  const raw = name === 'resume' ? resumeArt(size)
    : name === 'stack' ? stackArt(size, count)
      : name === 'phone' ? phoneArt(size)
        : name === 'usb' ? usbArt(size)
          : name === 'scan-paper' ? scanPaperArt(size)
            : name === 'ring' ? ringArt(pct ?? 1, size, stroke)
              : mfpArt()
  const html = crop ? cropViewBox(raw, Math.min(0.2, Math.max(0, crop))) : raw
  return <span className={['pa', `pa-${name}`, className].filter(Boolean).join(' ')} aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />
}
