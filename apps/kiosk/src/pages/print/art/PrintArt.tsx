import './print-art.css'
import { mfpArt, phoneArt, resumeArt, ringArt, scanPaperArt, stackArt, usbArt } from './printArtSvg'

export type PrintArtName = 'resume' | 'stack' | 'phone' | 'usb' | 'scan-paper' | 'mfp' | 'ring'

/** 实物小样。纯装饰，读屏跳过；内容是常量 SVG。 */
export function PrintArt({ name, size, count, pct, stroke, className }: {
  name: PrintArtName
  size?: number
  count?: number
  pct?: number
  stroke?: number
  className?: string
}) {
  const html = name === 'resume' ? resumeArt(size)
    : name === 'stack' ? stackArt(size, count)
      : name === 'phone' ? phoneArt(size)
        : name === 'usb' ? usbArt(size)
          : name === 'scan-paper' ? scanPaperArt(size)
            : name === 'ring' ? ringArt(pct ?? 1, size, stroke)
              : mfpArt()
  return <span className={['pa', `pa-${name}`, className].filter(Boolean).join(' ')} aria-hidden="true" dangerouslySetInnerHTML={{ __html: html }} />
}
