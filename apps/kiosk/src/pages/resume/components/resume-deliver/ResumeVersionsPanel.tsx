import { useEffect, useState } from 'react'
import type { ResumeConfirmedVersion } from '@ai-job-print/shared'
import { FilePreviewDialog } from '../../../../components/FilePreviewDialog'
import { listResumeVersions } from '../../../../services/api'
import { fetchAccessUrl } from '../../../../services/api/memberAssets'
import { userMessageOf } from '../../../../services/api/userErrorMessage'
import { formatClock } from './resumeDecisions'

export function ResumeVersionsPanel(props: {
  taskId: string
  token: string
  refreshKey: number
}) {
  const [items, setItems] = useState<ResumeConfirmedVersion[]>([])
  const [latestVersion, setLatestVersion] = useState<number | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [opening, setOpening] = useState(false)
  const [openError, setOpenError] = useState<string | null>(null)
  const [preview, setPreview] = useState<{ url: string; name: string; expiresAt?: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoadError(null)
    listResumeVersions(props.taskId, props.token)
      .then((res) => {
        if (cancelled) return
        setItems(res.items ?? [])
        setLatestVersion(res.latestVersion)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setItems([])
        setLatestVersion(null)
        setLoadError(userMessageOf(err, '已确认版本这次没读取到'))
      })
    return () => { cancelled = true }
  }, [props.taskId, props.token, props.refreshKey])

  const openVersion = async (item: ResumeConfirmedVersion) => {
    if (opening) return
    setOpening(true)
    setOpenError(null)
    try {
      const access = await fetchAccessUrl(`/files/${encodeURIComponent(item.fileId)}/preview-url`, props.token)
      if (!access.url) {
        setOpenError('这份确认稿没有可用的预览链接，文件可能已到期或被清理')
        return
      }
      setPreview({
        url: access.url,
        name: `已确认版本 v${item.version}`,
        expiresAt: access.expiresAt,
      })
    } catch (err) {
      setOpenError(userMessageOf(err, '这份确认稿暂时打不开，文件可能已到期或被清理'))
    } finally {
      setOpening(false)
    }
  }

  return (
    <div className="qx-card qx-rd-versions">
      <h3>已确认版本</h3>
      <p>导出成功后会出现在这里。点开可预览或扫码带走当时确认的文件。</p>
      {loadError ? <p className="qx-rd-error" role="alert">{loadError}</p> : null}
      {!loadError && items.length === 0 ? (
        <p>还没有已确认版本。导出成功后会出现在这里。</p>
      ) : null}
      {items.map((item) => (
        <button
          key={`${item.version}-${item.fileId}`}
          type="button"
          className="qx-rd-version"
          disabled={opening}
          onClick={() => { void openVersion(item) }}
        >
          <b>v{item.version}{latestVersion === item.version ? ' · 最新' : ''}</b>
          <span>
            {formatClock(item.confirmedAt, true) || item.confirmedAt}
            {item.factsConfirmedAt ? ' · 已做事实核对' : ' · 未做事实核对'}
          </span>
        </button>
      ))}
      {openError ? <p className="qx-rd-error" role="alert">{openError}</p> : null}
      {preview ? (
        <FilePreviewDialog
          fileUrl={preview.url}
          fileName={preview.name}
          format="pdf"
          mimeType="application/pdf"
          phoneDownloadUrl={preview.url}
          expiresAt={preview.expiresAt}
          onClose={() => setPreview(null)}
        />
      ) : null}
    </div>
  )
}
