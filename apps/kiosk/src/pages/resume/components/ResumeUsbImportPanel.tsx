import { useEffect, useRef, useState, type ReactNode } from 'react'
import { userMessageOf } from '../../../services/api/userErrorMessage'
import { FileTextIcon, LoaderIcon, RefreshCwIcon, UsbIcon } from 'lucide-react'
import { Button, KioskStatePanel } from '@ai-job-print/ui'
import { useUsbImportGate, type UsbImportGate } from '../../../hooks/useUsbImportGate'
import { unattendedResumeCopy } from '../touch/unattendedResumeCopy'
import { QxTouchIcon } from '../../../components/qingxu/touch/QxTouchIcon'
import { useAuth } from '../../../auth/useAuth'
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

/** 来源页底栏要画「导入这份文件」时用：有没有选中、是不是正在导入，以及触发导入的函数。 */
export interface ResumeUsbPick {
  selected: boolean
  importing: boolean
  run: () => void
}

interface ResumeUsbImportPanelProps {
  /** 来源页已经查过就传进来，避免再闪一次「正在确认」。面试设置页不传，面板自己查。 */
  gate?: UsbImportGate
  onUploaded: (file: ResumeUsbImportedFile) => void
  onBusyChange?: (busy: boolean) => void
  /** 简历来源页传入。默认关：面试设置页不传，点文件行即导入，文案保持原样。 */
  unattended?: boolean
  /** 根目录可用文件数。不传则不通知。面试设置页不传。 */
  onListed?: (count: number) => void
  /** 简历来源页传入：导入键放在页面底栏，面板里不再画。不传则导入键仍在面板里。 */
  onPickChange?: (pick: ResumeUsbPick) => void
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

function formatBadge(filename: string, extension: string): string {
  const fromName = inferFormat('', filename)
  if (fromName !== 'unknown') return fromName.toUpperCase()
  const raw = extension.replace(/^\./, '').toLowerCase()
  if (raw === 'jpeg') return 'JPG'
  return raw ? raw.toUpperCase() : 'FILE'
}

/** 无人值守的状态说明：未开通、确认中、确认不了、不能用。 */
function UsbNote({ title, description, actions, tone }: { title: string; description?: string; actions?: ReactNode; tone: 'empty' | 'error' | 'loading' | 'permission' }) {
  return (
    <div className="resume-usb-panel qxt-usb-note" data-tone={tone} role="status">
      <b>{title}</b>
      {description ? <p>{description}</p> : null}
      {actions}
    </div>
  )
}

export function ResumeUsbImportPanel({ gate: gateFromParent, onUploaded, onBusyChange, unattended = false, onListed, onPickChange }: ResumeUsbImportPanelProps) {
  const ownGate = useUsbImportGate(PANEL_USB_UNCONFIGURED_NOTE)
  const gate = gateFromParent ?? ownGate
  const { getToken } = useAuth()
  const mountedRef = useRef(true)
  const [status, setStatus] = useState<UsbStatus | null>(null)
  const [files, setFiles] = useState<UsbFileListItem[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [importingId, setImportingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [scanNonce, setScanNonce] = useState(0)
  const [redetectNote, setRedetectNote] = useState<string | null>(null)
  const configured = isUsbImportConfigured()

  useEffect(() => {
    onBusyChange?.(importingId !== null)
  }, [importingId, onBusyChange])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      onBusyChange?.(false)
    }
  }, [onBusyChange])

  useEffect(() => {
    if (!configured || gate.state !== 'allowed' || importingId) return undefined
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
      } catch (err) {
        if (cancelled) return
        setStatus(null)
        setFiles(null)
        setError(unattended
          ? unattendedResumeCopy(userMessageOf(err, 'U盘读取失败，请重新插入。'))
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
  }, [configured, gate.state, importingId, unattended, scanNonce])

  useEffect(() => {
    if (!onListed) return
    const count = status?.present && files ? files.length : 0
    onListed(count)
  }, [onListed, status, files])

  const importFile = async (item: UsbFileListItem) => {
    setImportingId(item.safeId)
    setError(null)
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
      setError(unattended
        ? unattendedResumeCopy(userMessageOf(err, 'U盘文件导入失败，请重试'))
        : userMessageOf(err, 'U盘文件导入失败，请重试'))
      setFiles(null)
      setStatus(null)
    } finally {
      if (mountedRef.current) setImportingId(null)
    }
  }

  // 简历来源页：点文件行只是选中，导入由底栏（或面板里的导入键）触发。面试设置页点行即导入。
  const selectedItem = unattended && selectedId ? files?.find((item) => item.safeId === selectedId) : undefined
  const runImportRef = useRef<() => void>(() => {})
  runImportRef.current = () => {
    if (selectedItem && importingId === null) void importFile(selectedItem)
  }
  const importing = importingId !== null
  const hasSelection = Boolean(selectedItem)
  useEffect(() => {
    onPickChange?.({ selected: hasSelection, importing, run: () => runImportRef.current() })
  }, [onPickChange, hasSelection, importing])
  useEffect(() => () => onPickChange?.({ selected: false, importing: false, run: () => {} }), [onPickChange])

  if (!configured) {
    return unattended ? (
      <UsbNote tone="empty" title="这台机器暂未开通 U 盘导入" description="请改用手机扫码上传。" />
    ) : (
      <KioskStatePanel
        compact
        tone="empty"
        title="这台机器暂未开通 U 盘导入"
        description="请改用手机扫码上传，或联系现场工作人员。"
      />
    )
  }

  if (gate.state !== 'allowed') {
    const title = gate.state === 'loading'
      ? (gate.note ?? '正在确认本机是否开通 U 盘导入…')
      : gate.state === 'unknown'
        ? '暂时确认不了'
        : 'U盘上传现在不能用'
    const tone = gate.state === 'unknown' ? 'error' : gate.state === 'loading' ? 'loading' : 'permission'
    const description = gate.state === 'loading'
      ? '确认完成前不会读取 U 盘，也不会列出文件。'
      : (unattended && gate.note ? unattendedResumeCopy(gate.note) : (gate.note ?? undefined))
    if (unattended) {
      return (
        <UsbNote
          tone={tone}
          title={title}
          description={description}
          actions={gate.state === 'unknown' ? (
            <button type="button" className="qxt-usb-mini" data-testid="resume-usb-retry" onClick={gate.retry}>重新检查</button>
          ) : undefined}
        />
      )
    }
    return (
      <KioskStatePanel
        compact
        tone={tone}
        title={title}
        description={description}
        actions={gate.state === 'unknown' ? (
          <button type="button" className="qx-btn" data-variant="ghost" data-testid="resume-usb-retry" onClick={gate.retry}>
            重新检查
          </button>
        ) : undefined}
      />
    )
  }

  const dataState = importingId ? 'importing' : error ? 'error' : status?.present ? (files && files.length > 0 ? 'list' : 'empty') : 'wait'

  if (unattended) {
    const picking = Boolean(files && files.length > 0)
    const redetect = () => {
      setRedetectNote(!status?.present ? '刚刚重新检测过，还是没有插入 U 盘' : `刚刚重新读过这块 U 盘，根目录里还是这 ${files?.length ?? 0} 个文件`)
      setSelectedId(null)
      setError(null)
      setScanNonce((value) => value + 1)
    }
    return (
      <section className={`resume-usb-panel qxt-usb${picking ? ' qxt-usb-pick' : ''}`} aria-label="U盘简历文件" data-usb-state={dataState}>
        {picking ? (
          <div className="qxt-usb-head">
            <b>U 盘根目录里能用的文件（{files!.length} 个）</b>
            <button type="button" className="qxt-usb-mini" disabled={loading || importingId !== null} onClick={redetect}>重新检测</button>
          </div>
        ) : (
          <>
            <b>{status?.present ? status.driveLabel || '已检测到U盘' : '等待插入U盘'}</b>
            <p>插好后列出 10MB 以内的 PDF、JPG、PNG。只读取你主动选择的文件，上传完成后即可拔出 U 盘。</p>
          </>
        )}
        {redetectNote ? <p className="qxt-usb-redetect" role="status">{redetectNote}</p> : null}
        {error ? <p className="qxt-usb-error" role="alert"><b>U盘读取失败</b>{error}</p> : null}
        {!error && status?.present && files?.length === 0 ? (
          <p className="qxt-usb-empty" role="status"><b>没有可用文件</b>请确认U盘中包含 PDF、JPG 或 PNG 文件。</p>
        ) : null}
        {files && files.length > 0 ? (
          <div className="qxt-usb-list">
            {files.map((item) => {
              const badge = formatBadge(item.filename, item.extension)
              return (
                <button
                  key={item.safeId}
                  type="button"
                  disabled={importingId !== null}
                  aria-pressed={selectedId === item.safeId}
                  onClick={() => setSelectedId(item.safeId)}
                  className="resume-usb-panel__row qxt-usb-row"
                >
                  <span className="resume-usb-panel__fmt qxt-usb-fmt" data-kind={badge === 'PDF' ? 'pdf' : 'img'}>
                    {importingId === item.safeId ? <LoaderIcon className="qxt-usb-spin" aria-hidden="true" /> : badge}
                  </span>
                  <span className="qxt-usb-name">
                    <b className="resume-usb-panel__name">{item.filename}</b>
                    <small className="resume-usb-panel__size">{formatBytes(item.sizeBytes)}</small>
                  </span>
                  <span className="qxt-usb-go">
                    {selectedId === item.safeId ? <span className="resume-usb-panel__picked">已选中</span> : <QxTouchIcon name="chevR" size={34} strokeWidth={2.2} />}
                  </span>
                </button>
              )
            })}
          </div>
        ) : null}
        {picking ? (
          <p className="resume-usb-panel__remind qxt-usb-remind">
            <QxTouchIcon name="usb" size={34} strokeWidth={2} />
            <span>
              {importingId
                ? '正在导入选中的文件，请暂时不要拔出 U 盘。系统确认保存之前，当前文件仍然是空的。这期间别拔 U 盘。'
                : selectedId
                  ? '只导入这一份，U 盘上其它文件不会被读走。导入完成前它还不是当前文件。'
                  : '只读取你主动选择的文件。导入完成后可以直接拔出 U 盘。'}
            </span>
          </p>
        ) : (
          <button type="button" className="qxt-usb-sec" disabled={loading || importingId !== null} onClick={redetect}>
            重新检测
          </button>
        )}
        {!onPickChange && selectedItem ? (
          <button type="button" className="resume-usb-import qxt-usb-pri" disabled={importingId !== null} onClick={() => void importFile(selectedItem)}>
            {importingId ? '正在导入' : '导入这份文件'}
          </button>
        ) : null}
      </section>
    )
  }

  return (
    <section className="resume-usb-panel flex min-h-[214px] flex-1 flex-col rounded-lg border border-neutral-200 bg-white p-5" aria-label="U盘简历文件" data-usb-state={dataState}>
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
        <Button size="sm" variant="secondary" disabled={loading || importingId !== null} onClick={() => { setStatus(null); setFiles(null); setError(null) }}>
          <RefreshCwIcon className="h-4 w-4" aria-hidden="true" />
          重新检测
        </Button>
      </div>
    </section>
  )
}
