// ============================================================
// PrintUploadPage — W7 · 青序流光外壳（12-file-source.html）
//
// "本机上传" tab now calls POST /api/v1/files/kiosk-upload (A2 mode).
//
// A2 桌面浏览器验证模式 — 设计约束说明：
//   CLAUDE.md §17 要求 Kiosk 生产模式不弹系统文件对话框。
//   "选择文件" tab 用 <input type="file"> 仅作为桌面 Chrome/Edge 下的 E2E 链路验证。
//   "U盘导入" tab 是 A1 生产路径：Terminal Agent 通过 /local/usb/* 本地网桥枚举可移动磁盘
//   （不下发绝对路径，只给一次性 safeId）→ Kiosk 轮询展示文件列表 → 用户选取后一次性消费。
//   该本地网桥的 Windows CIM/PowerShell 检测分支仅在 win32 环境生效，
//   未完成 Windows 真机验收前不得据代码已合入宣称"U 盘导入已完成"。
//
// signedUrl 由后端 kiosk-upload 返回（5-min TTL）；
// PrintConfirmPage 创建打印任务时后端会重新签发 30-min TTL（B1 方案）。
//
// 隐私预检不可绕过：本页只把文件搬进本次办理，下一步固定
// navigate('/print/material-check', { state: { file, source } })。
// 没有当前文件时主操作禁用；本页不伪造「已检查」、不跳预览/确认。
// ============================================================

import { useCallback, useEffect, useRef, useState } from 'react'
import { isTerminalKiosk } from '../../services/api/screensaver'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useBusyLock } from '../../contexts/KioskBusyContext'
import { kioskUploadFile } from '../../services/files/filesApi'
import { userMessageOf } from '../../services/api/userErrorMessage'
import {
  getUsbStatus,
  isUsbImportConfigured,
  listUsbFiles,
  uploadUsbFile,
  type UsbFileListItem,
  type UsbStatus,
} from '../../services/files/usbImportApi'
import { useAuth } from '../../auth/useAuth'
import {
  useDocumentConversionCapabilities,
  WORD_CONVERSION_DISCLOSURE,
  WORD_CONVERSION_UNAVAILABLE_COPY,
} from '../../services/api/documentConversion'
import { useUploadSession, type PhoneUploadedFile } from '../upload/hooks/useUploadSession'
import {
  clearPrintMaterialSession,
  savePrintMaterialSession,
  type PrintFileState,
  type PrintMaterialContentCategory,
  type PrintMaterialSource,
} from './printMaterialSession'
import { getTerminalCode } from '../../services/api/terminalConfig'
import { useTerminalDeviceStatus } from '../../hooks/useTerminalDeviceStatus'
import { FileSourceView } from './file-source/FileSourceView'
import {
  classifyLocalFile,
  classifyUploadError,
  deriveFileSourceScreen,
  isUsbAgentOffline,
  isUsbSafeIdExpired,
  type FileOrigin,
  type LocalRejectKind,
} from './file-source/fileSourceModel'

type UploadTab = 'file' | 'qr' | 'usb'

/**
 * 打印上传的**实际生效**大小上限(MB)。
 *
 * 服务端 file-validation.ts:validateUpload 对 multipart 代理上传取
 * `min(PURPOSE_POLICY.print_doc.maxBytes = 20MB, PROXY_MAX_BYTES = 15MB)` = 15MB,
 * kiosk-upload 与 U 盘导入都走这条 proxy 路径。
 *
 * 2026-08-17 走查:本页原先写「不超过 20MB」,而 16.9MB 文件上传后被拒并提示
 * 「文件超出上限(15MB)」——先告诉用户 20MB 再按 15MB 拒收。这里改为单一常量,
 * 并由 services/api 的 verify:file-display-truth 门禁对着服务端策略核对,不再手抄。
 */
export const PRINT_UPLOAD_MAX_MB = 15
const PRINT_BASE_ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png'
const PRINT_WORD_ACCEPT = '.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document'
const PRINT_UPLOAD_MAX_BYTES = PRINT_UPLOAD_MAX_MB * 1024 * 1024

type UploadedFile = PrintFileState & { fileId: string; fileUrl: string; fileMd5: string }

// 单位换算按「四舍五入后是否还落在本档」判定,不能只比原始字节数。
// 反例(2026-08-17 走查):1 048 500 B < 1MiB 走 KB 档,(1048500/1024).toFixed(0) = "1024",
// 显示成「1024 KB」——用户看到一个本该进位成 1.0 MB 的数。B→KB 边界同理。
function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '大小未知'
  const KB = 1024
  const MB = KB * 1024
  if (bytes < KB) return `${Math.round(bytes)} B`
  const kb = bytes / KB
  if (kb < 1024 && Math.round(kb) < 1024) return `${Math.round(kb)} KB`
  return `${(bytes / MB).toFixed(1)} MB`
}

const IMAGE_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

function resolveContentCategory(
  entryContentCategory: PrintMaterialContentCategory | undefined,
  mimeType: string | undefined
): PrintMaterialContentCategory | undefined {
  if (entryContentCategory !== 'photo') return undefined
  if (!mimeType || !IMAGE_MIME_TYPES.has(mimeType)) return undefined
  return 'photo'
}

function qxStatusFromDevice(device: ReturnType<typeof useTerminalDeviceStatus>): {
  tone: 'ok' | 'warn' | 'bad' | 'unknown'
  label: string
} {
  if (device.loading || device.kind === 'unknown') return { tone: 'unknown', label: '状态未知' }
  if (device.printerReady) return { tone: device.kind === 'low_paper' ? 'warn' : 'ok', label: device.printerLabel }
  if (device.kind === 'offline') return { tone: 'bad', label: device.printerLabel }
  return { tone: 'bad', label: device.printerLabel }
}

// 本页是打印流程 step={1}（选择文件来源）。青序稿不再挂 PrintPrototypeHeader，
// 步骤身份改由 FileSourceView 的 data-print-flow-step 声明。

export function PrintUploadPage() {
  const navigate = useNavigate()
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const { getToken, isLoggedIn } = useAuth()
  const device = useTerminalDeviceStatus()
  const { capabilities: conversionCapabilities } = useDocumentConversionCapabilities()
  const wordConversionAvailable = conversionCapabilities.wordToPdf
  const printAccept = wordConversionAvailable ? `${PRINT_BASE_ACCEPT},${PRINT_WORD_ACCEPT}` : PRINT_BASE_ACCEPT
  const inputRef = useRef<HTMLInputElement>(null)
  const lastLocalFileRef = useRef<File | null>(null)
  const source: PrintMaterialSource =
    searchParams.get('source') === 'resume' ? 'resume' : 'document'
  const isResumePrint = source === 'resume'
  const isDocumentPrint = source === 'document'

  const isTransferMode = isDocumentPrint && searchParams.get('mode') === 'transfer'
  const isPhotoEntry =
    (location.state as { category?: 'photo' } | null)?.category === 'photo' ||
    searchParams.get('category') === 'photo'
  const contentCategory = isPhotoEntry ? 'photo' : undefined

  const requestedTab = searchParams.get('tab')
  const hasRequestedTab = requestedTab === 'qr' || requestedTab === 'usb' || requestedTab === 'file'
  const entryTab: UploadTab =
    requestedTab === 'qr' || requestedTab === 'usb' ? requestedTab : (isTerminalKiosk() ? 'qr' : 'file')

  const TRANSFER_COPY: Record<UploadTab, { title: string; subtitle: string }> = {
    file: { title: '本机上传', subtitle: '在这台机器上选择文件，传完可以直接接着打印' },
    qr: { title: '手机扫码上传', subtitle: '把手机里的文件传到这台机器，传完可以直接接着打印' },
    usb: { title: 'U盘导入', subtitle: '从 U 盘里选文件传到这台机器，传完可以直接接着打印' },
  }

  const pageTitle = !isDocumentPrint
    ? '简历打印'
    : isTransferMode
      ? TRANSFER_COPY[entryTab].title
      : isPhotoEntry
        ? '照片打印'
        : '文档打印'
  const pageSubtitle = !isDocumentPrint
    ? '从我的简历或上传一份简历进入打印'
    : isTransferMode
      ? TRANSFER_COPY[entryTab].subtitle
      : isPhotoEntry
        ? '照片上传后设参数打印，与文档打印同一条流程'
        : '通用文档、求职材料或图片上传后打印'

  const wordClosedCopy = `${WORD_CONVERSION_UNAVAILABLE_COPY}；支持 PDF、JPG、PNG，单份不超过 ${PRINT_UPLOAD_MAX_MB}MB${source === 'resume' ? '，适合已有电子简历直接打印' : '，上传后将先做材料检查'}`
  const wordOpenCopy = `支持 PDF、DOC、DOCX、JPG、PNG，单份不超过 ${PRINT_UPLOAD_MAX_MB}MB；${WORD_CONVERSION_DISCLOSURE}`

  const initialTab: UploadTab = entryTab
  const [tab, setTab] = useState<UploadTab>(initialTab)
  const [channelActive, setChannelActive] = useState(isTransferMode || hasRequestedTab)
  const [file, setFile] = useState<UploadedFile | null>(null)
  const [fileOrigin, setFileOrigin] = useState<FileOrigin | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [pickerCancelled, setPickerCancelled] = useState(false)
  const [localRejectKind, setLocalRejectKind] = useState<LocalRejectKind | null>(null)
  const [blockedName, setBlockedName] = useState<string | null>(null)
  const [blockedMeta, setBlockedMeta] = useState<string | null>(null)
  const [usbConfigured] = useState(() => isUsbImportConfigured())
  const [usbStatus, setUsbStatus] = useState<UsbStatus | null>(null)
  const [usbFiles, setUsbFiles] = useState<UsbFileListItem[] | null>(null)
  const [usbError, setUsbError] = useState<string | null>(null)
  const [usbUploading, setUsbUploading] = useState(false)
  const [usbSelected, setUsbSelected] = useState<UsbFileListItem | null>(null)
  const [usbSafeIdExpired, setUsbSafeIdExpired] = useState(false)
  const [usbImportFailed, setUsbImportFailed] = useState(false)
  const [usbAgentOffline, setUsbAgentOffline] = useState(false)
  const [usbReadFailed, setUsbReadFailed] = useState(false)
  const [usbPollKey, setUsbPollKey] = useState(0)
  const [previewOpen, setPreviewOpen] = useState(false)

  const showFileChannel = !isTerminalKiosk()
  const wordHint = wordConversionAvailable ? wordOpenCopy : wordClosedCopy

  useEffect(() => {
    if (tab !== 'usb' || !usbConfigured || file || usbUploading || usbSelected) return undefined
    let cancelled = false

    const poll = async () => {
      try {
        const status = await getUsbStatus()
        if (cancelled) return
        setUsbStatus(status)
        setUsbError(null)
        setUsbAgentOffline(false)
        setUsbReadFailed(false)
        if (status.present) {
          const list = await listUsbFiles()
          if (cancelled) return
          setUsbFiles(list.files)
        } else {
          setUsbFiles(null)
        }
      } catch (err) {
        if (cancelled) return
        setUsbStatus(null)
        setUsbFiles(null)
        if (isUsbAgentOffline(err)) {
          setUsbAgentOffline(true)
          setUsbReadFailed(false)
        } else {
          setUsbAgentOffline(false)
          setUsbReadFailed(true)
        }
        setUsbError(userMessageOf(err, 'U 盘状态查询失败，请确认终端服务正在运行后重试'))
      }
    }

    let timer: number | undefined
    const loop = async () => {
      await poll()
      if (!cancelled) timer = window.setTimeout(() => void loop(), 2000)
    }
    void loop()
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [tab, usbConfigured, file, usbUploading, usbSelected, usbPollKey])

  const persistFile = useCallback((nextFile: UploadedFile, origin: FileOrigin) => {
    setFile(nextFile)
    setFileOrigin(origin)
    savePrintMaterialSession({
      file: nextFile,
      source,
      contentCategory: resolveContentCategory(contentCategory, nextFile.mimeType),
    })
  }, [contentCategory, source])

  const handleQrUploaded = useCallback((uploaded: PhoneUploadedFile) => {
    if (!uploaded.fileUrl) {
      setUploadError('文件签名链接生成失败，请刷新二维码重试')
      return
    }
    setUploadError(null)
    const nextFile: UploadedFile = {
      name: uploaded.name,
      size: uploaded.size,
      pages: null,
      fileId: uploaded.fileId,
      fileUrl: uploaded.fileUrl,
      fileMd5: uploaded.sha256 ?? '',
      mimeType: uploaded.mimeType,
    }
    persistFile(nextFile, 'qr')
  }, [persistFile])

  const phoneEnabled = tab === 'qr' && channelActive && !file
  const phoneSession = useUploadSession({
    purpose: 'print_doc',
    enabled: phoneEnabled,
    onUploaded: handleQrUploaded,
  })
  const phone = phoneSession.snapshot
  useBusyLock(uploading || usbUploading || phone.loading || phone.confirming || phone.cancelling)

  const uploadLocalFile = useCallback(async (selected: File) => {
    const verdict = classifyLocalFile(selected, {
      acceptWord: wordConversionAvailable && !isPhotoEntry,
      photoOnly: Boolean(isPhotoEntry),
      maxBytes: PRINT_UPLOAD_MAX_BYTES,
    })
    lastLocalFileRef.current = selected
    setBlockedName(selected.name)
    setBlockedMeta(formatBytes(selected.size))
    setPickerCancelled(false)
    if (verdict !== 'ok') {
      setLocalRejectKind(verdict)
      setUploadError(null)
      setFile(null)
      clearPrintMaterialSession()
      return
    }
    setLocalRejectKind(null)
    setUploadError(null)
    setUploading(true)
    clearPrintMaterialSession()
    try {
      const result = await kioskUploadFile(selected, getToken())
      const nextFile: UploadedFile = {
        name: result.filename,
        size: formatBytes(result.sizeBytes),
        pages: null,
        fileId: result.fileId,
        fileUrl: result.signedUrl,
        fileMd5: result.sha256,
        mimeType: result.mimeType,
      }
      persistFile(nextFile, 'file')
    } catch (err) {
      const kind = classifyUploadError(err)
      if (kind !== 'failed') setLocalRejectKind(kind)
      setUploadError(userMessageOf(err, '上传失败，请重试'))
    } finally {
      setUploading(false)
    }
  }, [getToken, isPhotoEntry, persistFile, wordConversionAvailable])

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0]
    e.target.value = ''
    if (!selected) {
      setPickerCancelled(true)
      return
    }
    await uploadLocalFile(selected)
  }

  const handleUsbFileSelect = async (safeId: string) => {
    if (usbUploading) return
    const picked = usbFiles?.find((item) => item.safeId === safeId) ?? null
    setUsbSelected(picked)
    setUsbSafeIdExpired(false)
    setUsbImportFailed(false)
  }

  const handleUsbImport = async () => {
    if (!usbSelected || usbUploading) return
    setUsbUploading(true)
    setUsbError(null)
    setUsbImportFailed(false)
    setUsbSafeIdExpired(false)
    try {
      const result = await uploadUsbFile(usbSelected.safeId)
      const nextFile: UploadedFile = {
        name: result.filename,
        size: formatBytes(result.sizeBytes),
        pages: null,
        fileId: result.fileId,
        fileUrl: result.fileUrl ?? '',
        fileMd5: result.sha256,
        mimeType: result.mimeType,
      }
      persistFile(nextFile, 'usb')
      setUsbSelected(null)
    } catch (err) {
      if (isUsbSafeIdExpired(err)) {
        setUsbSafeIdExpired(true)
        setUsbImportFailed(false)
      } else {
        setUsbImportFailed(true)
      }
      setUsbError(userMessageOf(err, 'U 盘文件导入失败，请重试'))
    } finally {
      setUsbUploading(false)
    }
  }

  const handleNext = () => {
    if (!file) return
    savePrintMaterialSession({
      file,
      source,
      contentCategory: resolveContentCategory(contentCategory, file.mimeType),
    })
    navigate('/print/material-check', { state: { file, source } })
  }

  const clearCurrentFile = () => {
    setFile(null)
    setFileOrigin(null)
    setPreviewOpen(false)
    setUploadError(null)
    clearPrintMaterialSession()
  }

  const activateChannel = (key: UploadTab) => {
    if (file) return
    setTab(key)
    setChannelActive(true)
    setUploadError(null)
    setPickerCancelled(false)
    setLocalRejectKind(null)
    setUsbSelected(null)
    setUsbImportFailed(false)
    setUsbSafeIdExpired(false)
  }

  const handleUsbRescan = () => {
    setUsbSelected(null)
    setUsbFiles(null)
    setUsbStatus(null)
    setUsbError(null)
    setUsbImportFailed(false)
    setUsbSafeIdExpired(false)
    setUsbReadFailed(false)
    setUsbAgentOffline(false)
    setUsbPollKey((key) => key + 1)
  }

  const exitPath = isTransferMode ? '/print-scan' : '/'
  const terminalCode = getTerminalCode()
  const screen = deriveFileSourceScreen({
    channelActive,
    tab,
    fileOrigin,
    hasFile: Boolean(file),
    uploading,
    pickerCancelled,
    localRejectKind,
    uploadError,
    phone,
    usbConfigured,
    usbAgentOffline,
    usbPresent: usbStatus ? usbStatus.present : null,
    usbFilesKnown: usbFiles !== null,
    usbFileCount: usbFiles?.length ?? 0,
    usbSelected: Boolean(usbSelected),
    usbUploading,
    usbSafeIdExpired,
    usbImportFailed,
    usbReadFailed: Boolean(usbReadFailed && usbError),
  })

  const fromQuery = `${location.pathname}${location.search}`

  return (
    <>
    <span
      className="fs-hidden-input"
      aria-disabled={!wordConversionAvailable || undefined}
      aria-describedby={!wordConversionAvailable ? 'print-word-conversion-reason' : undefined}
    >
      Word 文件上传能力
    </span>
    {!wordConversionAvailable ? (
      <p id="print-word-conversion-reason" className="fs-hidden-input">
        {conversionCapabilities.reason || '转换引擎未就绪；服务恢复并通过能力探测后会自动开放。'}
      </p>
    ) : null}
    <FileSourceView
      screen={screen}
      pageTitle={pageTitle}
      pageSubtitle={pageSubtitle}
      terminalLabel={terminalCode ? `就业服务大厅 · ${terminalCode}` : '就业服务大厅'}
      status={qxStatusFromDevice(device)}
      isResumePrint={isResumePrint}
      showFileChannel={showFileChannel}
      showScan={!isResumePrint}
      tab={tab}
      usbMode={!usbConfigured ? 'unavailable' : usbAgentOffline ? 'offline' : 'ok'}
      currentFile={file}
      blockedName={blockedName}
      blockedMeta={blockedMeta}
      wordHint={wordHint}
      conversionReason={conversionCapabilities.reason || null}
      usbFiles={usbFiles}
      usbSelected={usbSelected}
      usbDriveLabel={usbStatus?.driveLabel ?? null}
      formatBytes={formatBytes}
      phone={phone}
      qrUrl={phoneSession.qrUrl}
      expiresLabel={phoneSession.expiresLabel}
      previewOpen={previewOpen}
      previewToken={getToken()}
      localRejectKind={localRejectKind}
      inputRef={inputRef}
      printAccept={printAccept}
      photoOnly={Boolean(isPhotoEntry)}
      onFileInputChange={handleFileChange}
      onSelectChannel={activateChannel}
      onOpenPicker={() => {
        setPickerCancelled(false)
        inputRef.current?.click()
      }}
      onRetryLocal={() => {
        const pending = lastLocalFileRef.current
        if (pending) void uploadLocalFile(pending)
        else inputRef.current?.click()
      }}
      onNext={handleNext}
      onExit={() => navigate(exitPath)}
      onHelp={() => navigate('/help')}
      onScan={() => navigate('/scan/start')}
      onDocuments={() => {
        if (isLoggedIn) navigate('/me/documents')
        else navigate('/login', { state: { from: fromQuery } })
      }}
      onResumes={() => {
        if (isLoggedIn) navigate('/me/resumes')
        else navigate('/login', { state: { from: '/print/upload?source=resume' } })
      }}
      onPreview={() => setPreviewOpen(true)}
      onClosePreview={() => setPreviewOpen(false)}
      onReplace={() => {
        clearCurrentFile()
        if (tab === 'file') window.setTimeout(() => inputRef.current?.click(), 0)
      }}
      onDelete={clearCurrentFile}
      onUsbSelect={(safeId) => void handleUsbFileSelect(safeId)}
      onUsbImport={() => void handleUsbImport()}
      onUsbRescan={handleUsbRescan}
      onPhoneRefresh={() => void phoneSession.refresh()}
      onPhoneConfirm={() => void phoneSession.confirm()}
      onPhoneCancel={() => void phoneSession.cancel()}
      onPhoneRetryStatus={() => void phoneSession.refresh()}
    />
    </>
  )
}
