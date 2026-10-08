import { useState } from 'react'
import { FileContentPreview, type PreviewKind } from '../../../../components/FileContentPreview'
import type { OptimizeSourceFile } from './optimizeSourceFile'

const WORD_NOTE = '这份原件是 Word。这台机器不做忠实的翻页预览，硬渲染会改掉字体和分页，你在这儿看到的就不是真正会打印出来的那一份。优化建议不受影响，就在这一层下面。'

function looksLikeWord(file: OptimizeSourceFile): boolean {
  const name = `${file.name} ${file.format ?? ''} ${file.mimeType ?? ''}`.toLowerCase()
  return name.includes('doc') || name.includes('word')
}

/** 上传原件预览。只打开这次办理已经带上的临时签名地址，不另要接口。 */
export function OptimizeSourcePreview(props: {
  file: OptimizeSourceFile
  token: string | null
  onClose: () => void
}) {
  const [kind, setKind] = useState<PreviewKind | null>(null)
  const word = looksLikeWord(props.file) || kind === 'word' || (kind === 'unsupported' && looksLikeWord(props.file))
  return (
    <div className="qx-rd-overlay" data-testid="resume-optimize-source-preview" role="dialog" aria-modal="true" aria-label="上传原件预览">
      <div className="qx-opt-layer">
        <div className="qx-opt-layer-h">
          <h2>上传原件预览</h2>
          <button type="button" className="qx-btn" data-variant="ghost" data-testid="resume-optimize-source-close" onClick={props.onClose}>
            关闭
          </button>
        </div>
        <p className="qx-opt-source-meta">{props.file.name}</p>
        {word ? <p className="qx-opt-source-note" role="note">{WORD_NOTE}</p> : null}
        <FileContentPreview
          fileUrl={props.file.fileUrl}
          fileName={props.file.name}
          mimeType={props.file.mimeType}
          format={props.file.format}
          fileId={props.file.fileId}
          token={props.token}
          onKindChange={setKind}
        />
      </div>
    </div>
  )
}
