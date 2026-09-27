import { FileTextIcon } from 'lucide-react'
import { FileContentPreview } from '../../../components/FileContentPreview'
import { PdfPreviewFrame } from '../PdfPreviewFrame'
import { useDocumentConversionCapabilities, WORD_CONVERSION_DISCLOSURE, WORD_CONVERSION_UNAVAILABLE_COPY } from '../../../services/api/documentConversion'
import type { PrintFileState as PrintFile } from '../printMaterialSession'
import { previewKindForFile } from './printPreviewKind'

export function FilePreviewPanel({ file, token }: { file: PrintFile; token: string | null }) {
  const { capabilities } = useDocumentConversionCapabilities()
  const previewKind = previewKindForFile(file)

  return (
    <>
      <div className="qpd-preview-shell">
        {previewKind === 'pdf' && file.fileUrl ? (
          <PdfPreviewFrame className="max-h-full" title={`${file.name} 预览`} src={file.fileUrl} />
        ) : null}
        {previewKind === 'image' ? <img className="max-h-full" src={file.fileUrl} alt={`${file.name} 预览`} /> : null}
        {previewKind === 'word' ? (
          <FileContentPreview
            fileUrl={file.fileUrl}
            fileName={file.name}
            mimeType={file.mimeType}
            fileId={file.fileId}
            token={token}
          />
        ) : null}
        {previewKind === 'unsupported' || previewKind === 'unavailable' ? (
          <div className="qpd-preview-fallback">
            <FileTextIcon aria-hidden="true" />
            <strong>{file.name}</strong>
            <p>
              {previewKind === 'unavailable'
                ? '暂时无法打开预览。文件仍在本次办理中，可以稍后重试。'
                : '当前文件类型不能在浏览器内直接预览。请返回重新选择 PDF、JPG 或 PNG。'}
            </p>
          </div>
        ) : null}
        <span className="qpd-preview-label">文件预览</span>
      </div>
      <div className="qpd-conversion-note">
        {capabilities.wordToPdf
          ? `PDF、图片和 Word 可预览；${WORD_CONVERSION_DISCLOSURE.replace('由转换引擎生成', '转换后')}`
          : `PDF 和图片可预览；${WORD_CONVERSION_UNAVAILABLE_COPY}${capabilities.reason ? `（${capabilities.reason}）` : ''}`}
      </div>
    </>
  )
}

