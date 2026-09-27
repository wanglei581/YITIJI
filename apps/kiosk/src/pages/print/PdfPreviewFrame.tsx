import { PdfCanvasPreview } from '../../components/PdfCanvasPreview'

/**
 * PDF 预览不能把未完成的 document 请求交给 React 随路由一起卸掉。
 * 把 PDF 地址交给 iframe 的 src，在 SPA 跳走时 Chromium 会对原 PDF 报 net::ERR_ABORTED；
 * 改成 blob URL 同样会 abort。即使把 iframe 留在 document.body 上也不行。
 *
 * 因此这里不创建 iframe / embed / object，也不 window.open。
 * 字节用 fetch 拉取：卸载时 AbortController 中止的是 fetch，不是 document。
 * 页画在共用 canvas 上；换文件或离开页面时取消 render task，并销毁 PDF 文档。
 */
export function PdfPreviewFrame({
  src,
  title,
  className,
  page,
  onPageChange,
  onReady,
}: {
  src: string
  title: string
  className?: string
  page?: number
  onPageChange?: (page: number) => void
  onReady?: (info: { pageCount: number }) => void
}) {
  return (
    <PdfCanvasPreview
      className={className}
      title={title}
      src={src}
      fit="width"
      page={page}
      onPageChange={onPageChange}
      onReady={onReady}
    />
  )
}
