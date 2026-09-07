import { QRCodeSVG } from 'qrcode.react'
import { FileContentPreview } from '../../../../components/FileContentPreview'
import { useCountdown } from '../../../../hooks/useCountdown'
import type { ResumeGenerateExportResponse } from '@ai-job-print/shared'
import { formatFileSize, PRINT_THIS_COPY } from './constants'

export function ResumeExportResult(props: {
  exported: ResumeGenerateExportResponse
  formatLabel: string
  version: number
  kind: 'resume' | 'change_list'
  savedToDocuments?: boolean
  guest: boolean
}) {
  const countdown = useCountdown(props.exported.expiresAt)
  const expired = countdown.expired
  const hasFile = Boolean(props.exported.signedUrl)
  const isPdf = props.formatLabel === 'PDF' || props.kind === 'change_list'

  return (
    <section className="qx-card qx-rd-result" data-has-file={hasFile ? '1' : '0'}>
      <h3>{hasFile ? `${props.formatLabel} 已生成` : `${props.formatLabel} 未生成真实文件`}</h3>
      <p className="qx-rd-result-meta">
        {props.exported.filename}
        {props.exported.pageCount > 0 ? ` · ${props.exported.pageCount} 页` : ''}
        {props.exported.sizeBytes > 0 ? ` · ${formatFileSize(props.exported.sizeBytes)}` : ''}
        {` · 版本 ${props.version}`}
      </p>
      {hasFile ? (
        <>
          <p className="qx-rd-print-copy">{PRINT_THIS_COPY}</p>
          <p>
            有效期剩余 {countdown.label}
            {expired ? ' · 请重新导出' : ''}
          </p>
        </>
      ) : (
        <p>没有对应的真实文件可预览或打印；接入真实导出服务后才会生成。</p>
      )}
      {props.savedToDocuments && !props.guest ? (
        <p>已存入「我的文档」，可回账号查看。</p>
      ) : null}
      {props.guest || props.savedToDocuments === false ? (
        <p>未登录不写入「我的文档」，请在有效期内扫码带走。</p>
      ) : null}
      {hasFile && isPdf && (
        <FileContentPreview
          fileUrl={props.exported.signedUrl}
          fileName={props.exported.filename}
          mimeType="application/pdf"
          format="pdf"
          compact
        />
      )}
      {hasFile && !isPdf && (
        <p>此格式不能在页内预览。打印用的是同内容 PDF 副本（须打印链接就绪）。</p>
      )}
      {hasFile && !expired && (
        <div className="qx-rd-qr">
          <p>手机扫码保存 · 剩余 {countdown.label}</p>
          <QRCodeSVG value={props.exported.signedUrl} size={160} level="M" marginSize={0} />
        </div>
      )}
      {hasFile && expired && (
        <p className="qx-rd-expired">二维码已隐藏。链接过期，请重新导出。</p>
      )}
    </section>
  )
}
