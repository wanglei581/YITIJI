import './print-art-tokens.css'
import './print-art.css'
import { mfpArt, phoneArt, resumeArt, ringArt, scanPaperArt, stackArt, usbArt } from './printArtSvg'

export type PrintArtName = 'resume' | 'stack' | 'phone' | 'usb' | 'scan-paper' | 'mfp' | 'ring'

export type PrintArtCrop = number | { x?: number; top?: number; bottom?: number }

/** 把小样自带的留白裁一圈（viewBox 往里收）：小样在同样大的盒子里画得更满，又不会真的伸出盒子。 */
function cropViewBox(svg: string, crop: PrintArtCrop): string {
  const clamp = (value = 0) => Math.min(0.2, Math.max(0, value))
  const side = typeof crop === 'number' ? clamp(crop) : clamp(crop.x)
  const top = typeof crop === 'number' ? clamp(crop) : clamp(crop.top)
  const bottom = typeof crop === 'number' ? clamp(crop) : clamp(crop.bottom)
  return svg.replace(/viewBox="(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+)"/, (_all, x, y, w, h) => {
    const [vx, vy, vw, vh] = [x, y, w, h].map(Number)
    return `viewBox="${vx + vw * side} ${vy + vh * top} ${vw * (1 - 2 * side)} ${vh * (1 - top - bottom)}"`
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
  /** 裁掉的留白比例（0–0.2）：给一个数四周一样，或分别给左右、上、下。不传就是整幅。 */
  crop?: PrintArtCrop
}) {
  const raw = name === 'resume' ? resumeArt(size)
    : name === 'stack' ? stackArt(size, count)
      : name === 'phone' ? phoneArt(size)
        : name === 'usb' ? usbArt(size)
          : name === 'scan-paper' ? scanPaperArt(size)
            : name === 'ring' ? ringArt(pct ?? 1, size, stroke)
              : mfpArt()
  const html = crop ? cropViewBox(raw, crop) : raw
  return <span className={['pa', `pa-${name}`, className].filter(Boolean).join(' ')} aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />
}
