import { useEffect, useRef, useState } from 'react'
import { errorCodeOf, userMessageOf } from '../../../services/api/userErrorMessage'
import { FileTextIcon, LoaderIcon, RefreshCwIcon, UsbIcon } from 'lucide-react'
import { Button, KioskStatePanel } from '@ai-job-print/ui'
import { useUsbImportGate, type UsbImportGate } from '../../../hooks/useUsbImportGate'
import { useAuth } from '../../../auth/useAuth'
import type { ReactNode } from 'react'
import type { UsbChannelPhase } from './resumeChannelCopy'
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
  /** 来源页已经查过就传进来，避免再闪一次「正在确认」。面试设置页不传，面板自己查。 */
  gate?: UsbImportGate
  onUploaded: (file: ResumeUsbImportedFile) => void
  onBusyChange?: (busy: boolean) => void
  /** 默认 inline，面试设置页不传。来源页整屏才传入这块渲染。 */
  layout?: 'inline' | 'screen'
  onPhase?: (phase: UsbChannelPhase) => void
  renderScreen?: (model: UsbScreenModel) => ReactNode
}

export interface UsbScreenModel {
  phase: UsbChannelPhase
  status: UsbStatus | null
  files: UsbFileListItem[] | null
  loading: boolean
  error: string | null
  importFault: { name: string; message: string } | null
  importingName: string | null
  onImport: (item: UsbFileListItem) => void
  onRedetect: () => void
}

const MAX_RESUME_BYTES = 10 * 1024 * 1024

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function inferFormat(mimeType: string, filename: string): string {
  const normalizedMime = mimeType.split(';', 1)[0]?.trim().toLowerCase()
  if (normalizedMime === 'application/pdf') return 'pdf'
  if (normalizedMime === 'image/png') return 'png'
  if (normalizedMime === 'image/jpeg') return 'jpg'
  const extension = filename.trim().toLowerCase().match(/\.([^.]+)$/)?.[1]
  if (extension === 'pdf') return 'pdf'
  if (extension === 'png') return 'png'
  if (extension === 'jpg' || extension === 'jpeg') return 'jpg'
  return 'unknown'
}

const PANEL_USB_UNCONFIGURED_NOTE = '这台机器暂未开通 U 盘导入。请改用手机扫码上传，或联系现场工作人员。'

function usbPhaseOf(input: {
  importingId: string | null
  importFault: { name: string } | null
  error: string | null
  faultCode: string | null
  status: UsbStatus | null
  files: UsbFileListItem[] | null
}): UsbChannelPhase {
  if (input.importingId) return 'usb-importing'
  if (input.importFault) return 'usb-import-failed'
  if (input.error) return input.faultCode === 'LOCAL_AGENT_UNREACHABLE' ? 'usb-agent-offline' : 'usb-read-failed'
  if (input.status?.present && input.files && input.files.length > 0) return 'usb-list'
  if (input.status?.present && input.files && input.files.length === 0) return 'usb-empty'
  if (input.status && !input.status.present) return 'usb-wait'
  return 'usb-detecting'
}

export function ResumeUsbImportPanel({
  gate: gateFromParent, onUploaded, onBusyChange, layout = 'inline', onPhase, renderScreen,
}: ResumeUsbImportPanelProps) {
  const ownGate = useUsbImportGate(PANEL_USB_UNCONFIGURED_NOTE)
  const gate = gateFromParent ?? ownGate
  const { getToken } = useAuth()
  const mountedRef = useRef(true)
  const [status, setStatus] = useState<UsbStatus | null>(null)
  const [files, setFiles] = useState<UsbFileListItem[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [importingId, setImportingId] = useState<string | null>(null)
  const [importingName, setImportingName] = useState<string | null>(null)
  const [importFault, setImportFault] = useState<{ name: string; message: string } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [faultCode, setFaultCode] = useState<string | null>(null)
  const [pollNonce, setPollNonce] = useState(0)
  const configured = isUsbImportConfigured()
  const phase = usbPhaseOf({ importingId, importFault, error, faultCode, status, files })

  useEffect(() => {
    onBusyChange?.(importingId !== null)
  }, [importingId, onBusyChange])

  useEffect(() => {
    if (layout !== 'screen') return
    onPhase?.(phase)
  }, [layout, onPhase, phase])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      onBusyChange?.(false)
    }
  }, [onBusyChange])

  useEffect(() => {
    if (!configured || gate.state !== 'allowed' || importingId || importFault) return undefined
    let cancelled = false
    let timer: number | undefined

    const poll = async () => {
      setLoading(true)
      try {
        const nextStatus = await getUsbStatus()
        if (cancelled) return
        setStatus(nextStatus)
        setFiles(nextStatus.present ? (await listUsbFiles()).files.filter((item) => item.sizeBytes <= MAX_RESUME_BYTES) : null)
        setError(null)
        setFaultCode(null)
      } catch (err) {
        if (cancelled) return
        setStatus(null)
        setFiles(null)
        const code = errorCodeOf(err) ?? null
        setFaultCode(code)
        setError(code === 'LOCAL_AGENT_UNREACHABLE'
          ? userMessageOf(err, '无法连接这台机器的本机程序，请确认设备正常后重试')
          : userMessageOf(err, 'U盘读取失败，请重新插入或联系现场工作人员'))
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
  }, [configured, gate.state, importingId, importFault, pollNonce])

  const redetect = () => {
    setStatus(null)
    setFiles(null)
    setError(null)
    setFaultCode(null)
    setImportFault(null)
    setPollNonce((nonce) => nonce + 1)
  }

  const importFile = async (item: UsbFileListItem) => {
    setImportingId(item.safeId)
    setImportingName(item.filename)
    setError(null)
    setImportFault(null)
    try {
      const uploaded = await uploadUsbFile(item.safeId, 'resume_upload', getToken())
      if (!uploaded.fileUrl) throw new Error('U盘文件已上传，但预览链接未生成，请重新选择')
      if (!mountedRef.current) return
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
      if (!mountedRef.current) return
      const message = userMessageOf(err, 'U盘文件导入失败，请重试')
      if (layout === 'screen') {
        setImportFault({ name: item.filename, message })
        setError(null)
      } else {
        setError(message)
        setFiles(null)
        setStatus(null)
      }
    } finally {
      if (mountedRef.current) setImportingId(null)
    }
  }

  if (!configured) {
    return (
      <KioskStatePanel
        compact
        tone="empty"
        title="这台机器暂未开通 U 盘导入"
        description="请改用手机扫码上传，或联系现场工作人员。"
      />
    )
  }

  if (gate.state !== 'allowed') {
    return (
      <KioskStatePanel
        compact
        tone={gate.state === 'unknown' ? 'error' : gate.state === 'loading' ? 'loading' : 'permission'}
        title={
          gate.state === 'loading'
            ? (gate.note ?? '正在确认本机是否开通 U 盘导入…')
            : gate.state === 'unknown'
              ? '暂时确认不了'
              : 'U盘上传现在不能用'
        }
        description={
          gate.state === 'loading'
            ? '确认完成前不会读取 U 盘，也不会列出文件。'
            : (gate.note ?? undefined)
        }
        actions={gate.state === 'unknown' ? (
          <button type="button" className="qx-btn" data-variant="ghost" data-testid="resume-usb-retry" onClick={gate.retry}>
            重新检查
          </button>
        ) : undefined}
      />
    )
  }

  if (layout === 'screen' && gate.state === 'allowed' && renderScreen) {
    return renderScreen({
      phase, status, files, loading, error, importFault, importingName,
      onImport: (item) => void importFile(item),
      onRedetect: redetect,
    })
  }

  return (
    <section className="resume-usb-panel flex min-h-[214px] flex-1 flex-col rounded-lg border border-neutral-200 bg-white p-5" aria-label="U盘简历文件" data-usb-state={importingId ? 'importing' : error ? 'error' : status?.present ? (files && files.length > 0 ? 'list' : 'empty') : 'wait'}>
      <div className="resume-usb-panel__head flex items-center gap-3">
        <span className="resume-usb-panel__icon grid h-12 w-12 place-items-center rounded-lg bg-primary-50 text-primary-700">
          <UsbIcon className="h-6 w-6" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-bold text-neutral-900">{status?.present ? status.driveLabel || '已检测到U盘' : '等待插入U盘'}</h2>
          <p className="resume-usb-panel__hint mt-1 text-sm text-neutral-500">仅显示 10MB 以内的 PDF、JPG、PNG 文件</p>
        </div>
        {loading && <LoaderIcon className="h-5 w-5 animate-spin text-primary-600" aria-label="正在读取U盘" />}
      </div>

      {error && <KioskStatePanel compact tone="error" title="U盘读取失败" description={error} />}

      {!error && status?.present && files?.length === 0 && (
        <KioskStatePanel compact tone="empty" title="没有可用文件" description="请确认U盘中包含 PDF、JPG 或 PNG 文件。" />
      )}

      {!error && !status?.present && !loading && (
        <div className="resume-usb-panel__empty grid flex-1 place-items-center py-6 text-center text-sm text-neutral-500">插入U盘后，文件列表会自动刷新</div>
      )}

      {files && files.length > 0 && (
        <div className="resume-usb-panel__list mt-4 grid max-h-[290px] gap-2 overflow-y-auto pr-1">
          {files.map((item) => (
            <button
              key={item.safeId}
              type="button"
              disabled={importingId !== null}
              onClick={() => void importFile(item)}
              className="resume-usb-panel__row flex min-h-14 items-center gap-3 rounded-lg border border-neutral-200 px-3 text-left hover:border-primary-300 hover:bg-primary-50 disabled:opacity-60"
            >
              {importingId === item.safeId ? <LoaderIcon className="h-5 w-5 animate-spin text-primary-600" /> : <FileTextIcon className="h-5 w-5 text-primary-600" />}
              <span className="resume-usb-panel__name min-w-0 flex-1 truncate text-sm font-semibold text-neutral-800">{item.filename}</span>
              <span className="resume-usb-panel__size shrink-0 text-xs text-neutral-500">{formatBytes(item.sizeBytes)}</span>
            </button>
          ))}
        </div>
      )}

      <div className="resume-usb-panel__actions mt-4 flex justify-end">
        <Button size="sm" variant="secondary" disabled={loading || importingId !== null} onClick={redetect}>
          <RefreshCwIcon className="h-4 w-4" aria-hidden="true" />
          重新检测
        </Button>
      </div>
    </section>
  )
}
