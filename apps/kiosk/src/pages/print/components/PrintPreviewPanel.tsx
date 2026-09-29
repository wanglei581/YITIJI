import { useEffect, useRef, useState, type ReactNode } from 'react'
import { EyeIcon, FileTextIcon } from 'lucide-react'
import { FileContentPreview } from '../../../components/FileContentPreview'
import { PdfPreviewFrame } from '../PdfPreviewFrame'
import { isWordDocument, useDocumentConversionCapabilities, WORD_CONVERSION_DISCLOSURE } from '../../../services/api/documentConversion'
import type { PrintFileState as PrintFile } from '../printMaterialSession'
import { ENCRYPTED_PDF_BLOCK_COPY, previewKindForFile } from './printPreviewKind'
import { FILE_NAME_BUDGET_CARD, truncateFileNameMiddle } from '../../../lib/fileName'
import '../styles/print-desk-qx.css'

/** 选文件页原有的完整预览弹层，供材料检查与参数页复用。 */
export function PrintFilePreviewModal({ file, token, onClose }: {
  file: Pick<PrintFile, 'name' | 'size' | 'fileUrl' | 'mimeType' | 'fileId'>
  token: string | null
  onClose: () => void
}) {
  const { capabilities } = useDocumentConversionCapabilities()
  const wordBlocked = isWordDocument({ fileName: file.name, mimeType: file.mimeType }) && !capabilities.wordToPdf
  const dialogRef = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const dialog = dialogRef.current
    dialog?.showModal()
    return () => { dialog?.close(); trigger?.focus() }
  }, [])
  return (
    <dialog ref={dialogRef} className="qpd-full-preview" aria-modal="true" aria-label={`完整预览：${file.name}`} onCancel={(event) => { event.preventDefault(); onClose() }}>
      <div className="qpd-full-preview-box">
        <header>
          <div><strong>{truncateFileNameMiddle(file.name, { maxLength: FILE_NAME_BUDGET_CARD })}</strong><span>{file.size} · 预览不改变本次办理里的文件</span></div>
          <button type="button" onClick={onClose}>关闭</button>
        </header>
        {wordBlocked ? <p className="qpd-preview-fallback">Word 转换暂未开放，请另存为 PDF 再上传。</p> : <FileContentPreview className="min-h-0 flex-1 rounded-none border-0" fileUrl={file.fileUrl} fileName={file.name} mimeType={file.mimeType} fileId={file.fileId} token={token} />}
      </div>
    </dialog>
  )
}

export function FilePreviewPanel({ file, token, caption, children, onEncrypted }: {
  file: PrintFile
  token: string | null
  caption?: string
  children?: ReactNode
  /** 预览发现打开密码时通知材料检查页，拦住下一步。 */
  onEncrypted?: () => void
}) {
  const { capabilities } = useDocumentConversionCapabilities()
  const previewKind = previewKindForFile(file)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [page, setPage] = useState(1)
  const [pageCount, setPageCount] = useState<number | null>(null)
  const [encrypted, setEncrypted] = useState(false)
  useEffect(() => { setPage(1); setPageCount(null); setPreviewOpen(false); setEncrypted(false) }, [file.fileId, file.fileUrl])

  return (
    <>
      <div className="qpd-preview-shell">
        {previewKind === 'pdf' && file.fileUrl ? (
          <PdfPreviewFrame className="max-h-full" title={`${file.name} 预览`} src={file.fileUrl} page={page} onPageChange={setPage} onReady={({ pageCount: count }) => setPageCount(count)} passwordMessage={ENCRYPTED_PDF_BLOCK_COPY} onPasswordRequired={() => { setEncrypted(true); onEncrypted?.() }} />
        ) : null}
        {previewKind === 'image' ? <img className="max-h-full" src={file.fileUrl} alt={`${file.name} 预览`} onLoad={() => setPageCount(1)} /> : null}
        {previewKind === 'word' && capabilities.wordToPdf ? (
          <FileContentPreview fileUrl={file.fileUrl} fileName={file.name} mimeType={file.mimeType} fileId={file.fileId} token={token} />
        ) : null}
        {previewKind === 'word' && !capabilities.wordToPdf ? <p className="qpd-preview-fallback">Word 转换暂未开放，请另存为 PDF 再上传。</p> : null}
        {previewKind === 'unsupported' || previewKind === 'unavailable' ? (
          <div className="qpd-preview-fallback">
            <FileTextIcon aria-hidden="true" /><strong>{file.name}</strong>
            <p>{previewKind === 'unavailable' ? '暂时无法打开预览。文件仍在本次办理中，可以稍后重试。' : '当前文件类型不能在浏览器内直接预览。请返回重新选择 PDF、JPG 或 PNG。'}</p>
          </div>
        ) : null}
        <span className="qpd-preview-label">文件预览</span>
      </div>
      <p className="qpd-preview-caption">{encrypted ? '这份 PDF 打不开，看不到页码' : pageCount === null ? '页码以预览显示为准' : `第 ${page} 页 / 共 ${pageCount} 页`}{caption ? ` · 出纸示意：${caption}` : ''}</p>
      <div className="qpd-preview-meta" aria-label="当前文件">
        <strong>{file.name}</strong><span>{file.size} · {encrypted ? '打不开' : file.pages === null ? '页数待识别' : `${file.pages} 页`}</span>
        {children}
      </div>
      {encrypted ? null : (
        <button className="qx-btn qpd-open-preview" data-variant="primary" type="button" onClick={() => setPreviewOpen(true)}><EyeIcon aria-hidden="true" />打开完整预览 · 逐页看清</button>
      )}
      {previewKind === 'word' ? (
        <div className="qpd-conversion-note">
          {capabilities.wordToPdf
            ? `PDF、图片和 Word 可预览；${WORD_CONVERSION_DISCLOSURE}`
            : 'Word 转换暂未开放，请另存为 PDF 再上传。'}
        </div>
      ) : null}
      {previewOpen ? <PrintFilePreviewModal file={file} token={token} onClose={() => setPreviewOpen(false)} /> : null}
    </>
  )
}
