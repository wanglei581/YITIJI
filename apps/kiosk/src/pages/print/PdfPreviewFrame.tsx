import { useEffect, useRef } from 'react'

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * PDF 预览不能把未完成的 document 请求交给 React 随路由一起卸掉。
 * `<iframe src={pdfUrl}>` 在 SPA 跳走时，Chromium 会对原 PDF 报 net::ERR_ABORTED；
 * 改成 blob URL 同样会 abort。即使把 iframe 留在 document.body 上也不行。
 *
 * 因此 iframe 只承载立刻完成的 srcdoc（卸载时没有进行中的 document 请求），
 * 真实 PDF 用 fetch 拉取：卸载时 AbortController 中止的是 fetch，不是 document。
 */
export function PdfPreviewFrame({
  src,
  title,
  className,
}: {
  src: string
  title: string
  className?: string
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const fileLabel = title.replace(/ 预览$/, '')

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    const controller = new AbortController()
    const iframe = document.createElement('iframe')
    iframe.className = className ?? ''
    iframe.title = title
    iframe.setAttribute('data-preview-src', src)
    iframe.srcdoc = `<!doctype html><html><head><meta charset="utf-8"></head><body style="margin:0;display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100%;padding:24px;font:20px/1.6 system-ui,sans-serif;text-align:center"><strong>${escapeHtml(fileLabel)}</strong><span>文件正在读取；逐页内容以打印结果为准。</span></body></html>`
    host.appendChild(iframe)

    void fetch(src, { signal: controller.signal, credentials: 'same-origin' })
      .then((response) => (response.ok ? response.arrayBuffer() : Promise.reject()))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return
        if (error instanceof DOMException && error.name === 'AbortError') return
      })

    return () => {
      controller.abort()
    }
  }, [className, fileLabel, src, title])

  return <div ref={hostRef} data-pdf-preview-host="" className={className} />
}
