import { useEffect, useState } from 'react'
import { FileTextIcon, LoaderIcon, RefreshCwIcon, UsbIcon } from 'lucide-react'
import { Button, KioskStatePanel } from '@ai-job-print/ui'
import {
  getUsbStatus,
  isUsbImportConfigured,
  listUsbFiles,
  uploadUsbFile,
  type UsbFileListItem,
  type UsbStatus,
} from '../../../services/files/usbImportApi'

export interface ResumeUsbImportedFile {
  name: string
  size: string
  format: string
  fileId: string
  fileUrl: string
  mimeType: string
  channel: 'usb'
}

interface ResumeUsbImportPanelProps {
  onUploaded: (file: ResumeUsbImportedFile) => void
  onBusyChange?: (busy: boolean) => void
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function inferFormat(mimeType: string, filename: string): string {
  const value = `${mimeType} ${filename}`.toLowerCase()
  if (value.includes('pdf')) return 'pdf'
  if (value.includes('png')) return 'png'
  if (value.includes('jpeg') || value.includes('jpg')) return 'jpg'
  return 'unknown'
}

export function ResumeUsbImportPanel({ onUploaded, onBusyChange }: ResumeUsbImportPanelProps) {
  const [status, setStatus] = useState<UsbStatus | null>(null)
  const [files, setFiles] = useState<UsbFileListItem[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [importingId, setImportingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const configured = isUsbImportConfigured()

  useEffect(() => {
    onBusyChange?.(loading || importingId !== null)
  }, [importingId, loading, onBusyChange])

  useEffect(() => {
    if (!configured || importingId) return undefined
    let cancelled = false
    let timer: number | undefined

    const poll = async () => {
      setLoading(true)
      try {
        const nextStatus = await getUsbStatus()
        if (cancelled) return
        setStatus(nextStatus)
        setFiles(nextStatus.present ? (await listUsbFiles()).files : null)
        setError(null)
      } catch (err) {
        if (cancelled) return
        setStatus(null)
        setFiles(null)
        setError(err instanceof Error ? err.message : 'U盘读取失败，请确认 Terminal Agent 正在运行')
      } finally {
        if (!cancelled) {
          setLoading(false)
          timer = window.setTimeout(() => void poll(), 2000)
        }
      }
    }

    void poll()
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [configured, importingId])

  const importFile = async (item: UsbFileListItem) => {
    setImportingId(item.safeId)
    setError(null)
    try {
      const uploaded = await uploadUsbFile(item.safeId)
      if (!uploaded.fileUrl) throw new Error('U盘文件已上传，但预览链接未生成，请重新选择')
      onUploaded({
        name: uploaded.filename,
        size: formatBytes(uploaded.sizeBytes),
        format: inferFormat(uploaded.mimeType, uploaded.filename),
        fileId: uploaded.fileId,
        fileUrl: uploaded.fileUrl,
        mimeType: uploaded.mimeType,
        channel: 'usb',
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'U盘文件导入失败，请重试')
      setFiles(null)
      setStatus(null)
    } finally {
      setImportingId(null)
    }
  }

  if (!configured) {
    return (
      <KioskStatePanel
        compact
        tone="empty"
        title="当前终端未配置U盘导入"
        description="请联系工作人员检查 Terminal Agent 本地网桥配置。"
      />
    )
  }

  return (
    <section className="flex min-h-[214px] flex-1 flex-col rounded-lg border border-neutral-200 bg-white p-5" aria-label="U盘简历文件">
      <div className="flex items-center gap-3">
        <span className="grid h-12 w-12 place-items-center rounded-lg bg-primary-50 text-primary-700">
          <UsbIcon className="h-6 w-6" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold text-neutral-900">{status?.present ? status.driveLabel || '已检测到U盘' : '等待插入U盘'}</h2>
          <p className="mt-1 text-sm text-neutral-500">仅显示 PDF、JPG、PNG 文件</p>
        </div>
        {loading && <LoaderIcon className="h-5 w-5 animate-spin text-primary-600" aria-label="正在读取U盘" />}
      </div>

      {error && <KioskStatePanel compact tone="error" title="U盘读取失败" description={error} />}

      {!error && status?.present && files?.length === 0 && (
        <KioskStatePanel compact tone="empty" title="没有可用文件" description="请确认U盘中包含 PDF、JPG 或 PNG 文件。" />
      )}

      {!error && !status?.present && !loading && (
        <div className="grid flex-1 place-items-center py-6 text-center text-sm text-neutral-500">插入U盘后，文件列表会自动刷新</div>
      )}

      {files && files.length > 0 && (
        <div className="mt-4 grid max-h-[290px] gap-2 overflow-y-auto pr-1">
          {files.map((item) => (
            <button
              key={item.safeId}
              type="button"
              disabled={importingId !== null}
              onClick={() => void importFile(item)}
              className="flex min-h-14 items-center gap-3 rounded-lg border border-neutral-200 px-3 text-left hover:border-primary-300 hover:bg-primary-50 disabled:opacity-60"
            >
              {importingId === item.safeId ? <LoaderIcon className="h-5 w-5 animate-spin text-primary-600" /> : <FileTextIcon className="h-5 w-5 text-primary-600" />}
              <span className="min-w-0 flex-1 truncate text-sm font-semibold text-neutral-800">{item.filename}</span>
              <span className="shrink-0 text-xs text-neutral-500">{formatBytes(item.sizeBytes)}</span>
            </button>
          ))}
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <Button size="sm" variant="secondary" disabled={loading || importingId !== null} onClick={() => { setStatus(null); setFiles(null); setError(null) }}>
          <RefreshCwIcon className="h-4 w-4" aria-hidden="true" />
          重新检测
        </Button>
      </div>
    </section>
  )
}
