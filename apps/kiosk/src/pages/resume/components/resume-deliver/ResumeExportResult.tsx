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
  /** 非 PDF：这一页不把打印链接交出去。不传则保持原说明。 */
  downloadOnly?: boolean
}) {
  const countdown = useCountdown(props.exported.expiresAt)
  const expired = countdown.expired
  const hasFile = Boolean(props.exported.signedUrl)
  const isPdf = props.formatLabel === 'PDF' || props.kind === 'change_list'
  // 页内预览是页面自己去取 PDF 字节。signedUrl 在对象存储上是另一个域名下的直链，页面取它属于跨站；
  // printFileUrl 经我们自己的服务器出同一份 PDF（打印用的就是它），同站可取。有它就用它，没有才退回直链。
  // 二维码仍用 signedUrl：手机扫码是整页打开，不受这个限制。
  const previewUrl = isPdf && props.exported.printFileUrl ? props.exported.printFileUrl : props.exported.signedUrl

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
      {hasFile && props.savedToDocuments === true && !props.guest ? (
        <p>已存入「我的文档」，可回账号查看。</p>
      ) : null}
      {props.guest ? (
        <p>未登录不写入「我的文档」，请在有效期内扫码带走。</p>
      ) : null}
      {!props.guest && props.savedToDocuments === false ? <p>这次未存入「我的文档」，请在有效期内扫码带走。</p> : null}
      {hasFile && isPdf && (
        <FileContentPreview
          fileUrl={previewUrl}
          fileName={props.exported.filename}
          mimeType="application/pdf"
          format="pdf"
          compact
        />
      )}
      {hasFile && !isPdf && (
        <p>{props.downloadOnly ? '这一份不能在页内预览，也暂不开放打印。可以扫码保存到手机。' : '此格式不能在页内预览。打印用的是同内容 PDF 副本（须打印链接就绪）。'}</p>
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
