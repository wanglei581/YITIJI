// ============================================================
// 面试文件「带走」：先生成 PDF，再在预览里给两条路——本人手机扫码保存、去打印这一份。
//
// 两处用：
//   - 练习报告页「扫码存到手机」（练习报告 PDF，origin interview_report）；
//   - 报告生成不了时「带走本场问答」（题目 + 本人提交过的回答，不调模型，origin interview_practice，
//     与服务端题目单同一口径：派生打印稿，免材料检查）。
//
// 不伪造：文件真生成出来才打开预览；生成失败停在原页、写明原因，不进打印、不出二维码。
// 预览弹窗与手机扫码区复用 FilePreviewDialog（简历导出同款），不另画一套。
// ============================================================

import { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { InterviewPrintResponse } from '@ai-job-print/shared'
import { FilePreviewDialog } from '../../components/FilePreviewDialog'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { useSupportContact } from '../../hooks/useSupportContact'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { useStartPrintHandoff } from '../print/usePrintHandoff'
import { interviewUserLine } from './interviewMicCopy'

type TakeawayOrigin = 'interview_report' | 'interview_practice'

function sizeLabel(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

export function useInterviewTakeaway(origin: TakeawayOrigin) {
  const startPrint = useStartPrintHandoff()
  const contact = useSupportContact()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [file, setFile] = useState<InterviewPrintResponse | null>(null)
  const lastRef = useRef<{ generate: () => Promise<InterviewPrintResponse>; fallback: string } | null>(null)
  useBusyLock(busy)

  const open = async (generate: () => Promise<InterviewPrintResponse>, fallback: string) => {
    if (busy) return
    lastRef.current = { generate, fallback }
    setBusy(true)
    setError(null)
    try {
      setFile(await generate())
    } catch (err) {
      setFile(null)
      setError(userMessageOf(err, fallback))
    } finally {
      setBusy(false)
    }
  }

  const print = () => {
    if (!file?.printFileUrl) return
    startPrint({
      origin,
      returnPath: window.location.pathname,
      file: {
        name: file.filename,
        size: sizeLabel(file.sizeBytes),
        pages: file.pageCount,
        fileId: file.fileId,
        fileUrl: file.printFileUrl,
        mimeType: 'application/pdf',
      },
    })
  }

  const regenerate = () => {
    const last = lastRef.current
    if (last) void open(last.generate, last.fallback)
  }

  const preview = file ? (
    <FilePreviewDialog
      fileUrl={file.printFileUrl ?? file.signedUrl}
      fileName={file.filename}
      mimeType="application/pdf"
      format="pdf"
      phoneDownloadUrl={file.signedUrl}
      expiresAt={file.expiresAt}
      onRegenerate={regenerate}
      regenerating={busy}
      primaryAction={file.printFileUrl ? { label: '去打印这一份', onClick: print } : undefined}
      onClose={() => setFile(null)}
    />
  ) : null
  // 挂到舞台容器上（仍随舞台缩放），不留在面试页里：面试页的按钮样式（作答区按钮、button.w-12）会把弹窗的关闭键和主按钮改走样。
  const host = typeof document !== 'undefined' ? document.querySelector('.kiosk-stage') : null
  const dialog = preview && host ? createPortal(preview, host) : preview

  return { open, busy, error: interviewUserLine(error, contact), dialog }
}
