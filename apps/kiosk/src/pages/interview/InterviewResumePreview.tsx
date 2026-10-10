// 设置屏简历预览。展开与否仍由设置页持有。

import type { Dispatch, SetStateAction } from 'react'
import { FileContentPreview } from '../../components/FileContentPreview'
import type { InterviewResumeFile } from './interviewWorkbenchSession'

const PREVIEWABLE_EXT = new Set(['pdf', 'jpg', 'jpeg', 'png', 'webp', 'doc', 'docx'])

function resumePreviewable(file: InterviewResumeFile): boolean {
  const ext = file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? ''
  const format = (file.format ?? '').replace(/^\./, '').toLowerCase()
  const mime = (file.mimeType ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
  if (PREVIEWABLE_EXT.has(ext) || PREVIEWABLE_EXT.has(format)) return true
  if (mime === 'application/pdf' || mime === 'image/jpeg' || mime === 'image/png' || mime === 'image/webp') return true
  if (mime === 'application/msword' || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return true
  return false
}

export function InterviewResumePreview({
  file,
  open,
  onOpenChange,
  token,
}: {
  file: InterviewResumeFile
  open: boolean
  onOpenChange: Dispatch<SetStateAction<boolean>>
  token: string | null
}) {
  return (
    <>
      <button
        type="button"
        className="iv-mini-btn"
        aria-expanded={open}
        onClick={() => onOpenChange((current) => !current)}
      >
        {open ? '收起预览' : '预览这份简历'}
      </button>
      {open && (
        resumePreviewable(file) ? (
          <div className="iv-resume-preview">
            <FileContentPreview
              fileUrl={file.fileUrl}
              fileName={file.name}
              mimeType={file.mimeType}
              format={file.format}
              fileId={file.fileId}
              token={token}
            />
          </div>
        ) : (
          <p className="iv-copy" data-testid="interview-resume-preview-unsupported">这种格式不能在这里预览，不影响这场练习。</p>
        )
      )}
    </>
  )
}
