import { useEffect, useRef, useState } from 'react'
import type { CopyJobView } from '../../services/api/copyJobs'
import { copyPriceLabel, copySheetCount } from './copyCheckModel'
import type { CopyDeviceFlow } from './copyDeviceFlow'

export function CopyCheckView({ job, device, busy, onPreviewReady }: {
  job: CopyJobView; device: CopyDeviceFlow; busy: boolean; onPreviewReady: (ready: boolean) => void
}) {
  const [first, setFirst] = useState(1)
  const [images, setImages] = useState<string[]>([])
  const [failed, setFailed] = useState(false)
  const loaded = useRef(new Set<string>())
  const last = Math.min(first + 2, job.pageCount)
  useEffect(() => {
    let active = true
    setImages([])
    setFailed(false)
    loaded.current.clear()
    onPreviewReady(false)
    const pages = Array.from({ length: Math.min(3, job.pageCount - first + 1) }, (_, i) => first + i)
    void device.loadPreview(pages).then((urls) => {
      if (active) setImages(urls)
    }).catch(() => { if (active) { setFailed(true); onPreviewReady(false) } })
    return () => { active = false; device.preview.clear(); onPreviewReady(false) }
  }, [first, job.pageCount, device, onPreviewReady])
  const change = (page: number) => { device.preview.clear(); setImages([]); onPreviewReady(false); setFirst(page) }
  return <>
    <div className="cc-check" data-testid="copy-check-facts">
      <div className="cc-preview">
        {images.map((src, i) => <figure key={src}><img src={src} alt={`第 ${first + i} 页扫描预览`}
          onLoad={() => { loaded.current.add(src); if (loaded.current.size === images.length) onPreviewReady(true) }}
          onError={() => { setFailed(true); onPreviewReady(false); device.preview.clear(); setImages([]) }} />
          <figcaption>第 {first + i} 页 / 共 {job.pageCount} 页</figcaption></figure>)}
        {!images.length ? <p role="status">{failed ? '预览暂时无法确认，请重扫或返回。' : '正在读取本机预览'}</p> : null}
      </div>
      {job.pageCount > 3 ? <div className="cc-pager">
        <button type="button" disabled={busy || first === 1} onClick={() => change(Math.max(1, first - 3))}>上一组</button>
        <span>{first}–{last} / {job.pageCount}</span>
        <button type="button" disabled={busy || last === job.pageCount} onClick={() => change(last + 1)}>下一组</button>
      </div> : null}
      <div className="cc-facts">
        <div>原件 {job.pageCount} 页 × {job.copies} 份 = {job.pageCount * job.copies} 页</div>
        <div>{job.duplex === 'simplex' ? '单面' : '双面'}打印，用 {copySheetCount(job.pageCount, job.copies, job.duplex)} 张纸</div>
        <div>{job.colorMode === 'color' ? '彩色' : '黑白'}</div><div>{copyPriceLabel(job.quote?.amountCents)}</div>
      </div>
    </div>
    {Number(job.quote?.amountCents) > 0 ? <p className="cc-note">这台机器暂不支持付费复印，请重扫或返回。</p> : null}
    <p className="cc-note">扫描件只在这台机器上处理，不上传</p>
  </>
}
