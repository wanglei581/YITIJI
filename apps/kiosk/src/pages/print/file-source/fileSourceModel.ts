// 选择文件来源 · 运行时状态机
//
// 38 态清单与 docs/design/kiosk-redesign-2026-08/12-file-source.html 的
// `var STATES=[...]` 逐字对齐。运行时**不**实现 ?state= 夹具：带文件名的画面
// 只来自真实上传 / 轮询结果，禁止 capture=1 伪造成功。

export const FILE_SOURCE_SCREENS = [
  'source-chooser',
  'missing-file',
  'unknown',
  'local-guide',
  'local-picking',
  'local-cancelled',
  'local-rejected',
  'local-oversize',
  'local-unreadable',
  'local-uploading',
  'local-upload-failed',
  'local-ready',
  'phone-generating',
  'phone-gen-failed',
  'phone-ready',
  'phone-waiting',
  'phone-uploading',
  'phone-status-unknown',
  'phone-expired',
  'phone-uploaded',
  'phone-confirming',
  'phone-confirm-failed',
  'phone-confirmed',
  'phone-cancel-requesting',
  'phone-cancel-failed',
  'phone-cancelled',
  'usb-unavailable',
  'usb-agent-offline',
  'usb-wait',
  'usb-detecting',
  'usb-empty',
  'usb-list',
  'usb-read-failed',
  'usb-selected',
  'usb-safeid-expired',
  'usb-importing',
  'usb-import-failed',
  'usb-ready',
] as const

export type FileSourceScreen = (typeof FILE_SOURCE_SCREENS)[number]
export type UploadTab = 'file' | 'qr' | 'usb'
export type FileOrigin = UploadTab
export type LocalRejectKind = 'rejected' | 'oversize' | 'unreadable'

export const FILE_SOURCE_HAS_FILE: ReadonlySet<FileSourceScreen> = new Set([
  'local-ready',
  'usb-ready',
  'phone-confirmed',
])

export interface PhoneSessionView {
  status: 'pending' | 'uploading' | 'uploaded' | 'confirmed' | 'expired' | 'cancelled' | string | null
  loading: boolean
  confirming: boolean
  cancelling: boolean
  cancelFailed: boolean
  confirmFailed: boolean
  error: string | null
  hasQr: boolean
  pendingName: string | null
  pendingSize: string | null
}

export interface FileSourceDeriveInput {
  channelActive: boolean
  tab: UploadTab
  fileOrigin: FileOrigin | null
  hasFile: boolean
  uploading: boolean
  pickerCancelled: boolean
  localRejectKind: LocalRejectKind | null
  uploadError: string | null
  phone: PhoneSessionView
  usbConfigured: boolean
  usbAgentOffline: boolean
  usbPresent: boolean | null
  usbFilesKnown: boolean
  usbFileCount: number
  usbSelected: boolean
  usbUploading: boolean
  usbSafeIdExpired: boolean
  usbImportFailed: boolean
  usbReadFailed: boolean
}

export function deriveFileSourceScreen(input: FileSourceDeriveInput): FileSourceScreen {
  if (input.hasFile && input.fileOrigin === 'file') return 'local-ready'
  if (input.hasFile && input.fileOrigin === 'usb') return 'usb-ready'
  if (input.hasFile && input.fileOrigin === 'qr') return 'phone-confirmed'

  if (!input.channelActive) return 'source-chooser'

  if (input.tab === 'file') {
    if (input.uploading) return 'local-uploading'
    if (input.localRejectKind === 'rejected') return 'local-rejected'
    if (input.localRejectKind === 'oversize') return 'local-oversize'
    if (input.localRejectKind === 'unreadable') return 'local-unreadable'
    if (input.uploadError) return 'local-upload-failed'
    if (input.pickerCancelled) return 'local-cancelled'
    return 'local-guide'
  }

  if (input.tab === 'qr') {
    if (input.phone.cancelling) return 'phone-cancel-requesting'
    if (input.phone.cancelFailed) return 'phone-cancel-failed'
    if (input.phone.status === 'cancelled') return 'phone-cancelled'
    if (input.phone.confirming) return 'phone-confirming'
    if (input.phone.confirmFailed) return 'phone-confirm-failed'
    if (input.phone.status === 'uploaded') return 'phone-uploaded'
    if (input.phone.status === 'uploading') return 'phone-uploading'
    if (input.phone.status === 'expired') return 'phone-expired'
    if (input.phone.loading && !input.phone.hasQr) return 'phone-generating'
    if (!input.phone.hasQr && input.phone.error) return 'phone-gen-failed'
    if (!input.phone.hasQr && !input.phone.loading) return 'phone-cancelled'
    if (input.phone.hasQr && input.phone.error && input.phone.status === 'pending') return 'phone-status-unknown'
    if (input.phone.hasQr && input.phone.status === 'pending' && input.phone.loading) return 'phone-waiting'
    if (input.phone.hasQr) return 'phone-ready'
    return 'phone-generating'
  }

  if (!input.usbConfigured) return 'usb-unavailable'
  if (input.usbUploading) return 'usb-importing'
  if (input.usbSafeIdExpired) return 'usb-safeid-expired'
  if (input.usbImportFailed) return 'usb-import-failed'
  if (input.usbAgentOffline) return 'usb-agent-offline'
  if (input.usbReadFailed) return 'usb-read-failed'
  if (input.usbSelected) return 'usb-selected'
  if (input.usbPresent === true && !input.usbFilesKnown) return 'usb-detecting'
  if (input.usbPresent === true && input.usbFileCount === 0) return 'usb-empty'
  if (input.usbPresent === true && input.usbFileCount > 0) return 'usb-list'
  return 'usb-wait'
}

const LOCAL_IMAGE_EXT = ['.jpg', '.jpeg', '.png']
const LOCAL_DOC_EXT = ['.pdf', ...LOCAL_IMAGE_EXT]
const LOCAL_WORD_EXT = ['.doc', '.docx']
const LOCAL_IMAGE_MIME = ['image/jpeg', 'image/png']
const LOCAL_DOC_MIME = ['application/pdf', ...LOCAL_IMAGE_MIME]
const LOCAL_WORD_MIME = [
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]

export function classifyLocalFile(
  file: File,
  options: { acceptWord: boolean; photoOnly: boolean; maxBytes: number },
): LocalRejectKind | 'ok' {
  if (!Number.isFinite(file.size) || file.size <= 0) return 'unreadable'
  if (file.size > options.maxBytes) return 'oversize'
  const name = file.name.toLowerCase()
  const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')) : ''
  const mime = (file.type || '').toLowerCase()
  const allowedExt = options.photoOnly
    ? LOCAL_IMAGE_EXT
    : options.acceptWord
      ? [...LOCAL_DOC_EXT, ...LOCAL_WORD_EXT]
      : LOCAL_DOC_EXT
  const allowedMime = options.photoOnly
    ? LOCAL_IMAGE_MIME
    : options.acceptWord
      ? [...LOCAL_DOC_MIME, ...LOCAL_WORD_MIME]
      : LOCAL_DOC_MIME
  const extOk = allowedExt.includes(ext)
  const mimeOk = mime.length === 0 || allowedMime.includes(mime)
  if (!extOk && !mimeOk) return 'rejected'
  if (ext && !extOk) return 'rejected'
  return 'ok'
}

export function isUsbSafeIdExpired(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const status = 'status' in err ? (err as { status?: unknown }).status : undefined
  const code = 'code' in err ? (err as { code?: unknown }).code : undefined
  if (status === 410) return true
  return typeof code === 'string' && /SAFE_?ID|EXPIRED|GONE/i.test(code)
}

export function isUsbAgentOffline(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const code = 'code' in err ? (err as { code?: unknown }).code : undefined
  return code === 'LOCAL_AGENT_UNREACHABLE'
}

export function classifyUploadError(err: unknown): LocalRejectKind | 'failed' {
  if (!err || typeof err !== 'object') return 'failed'
  const code = 'code' in err ? (err as { code?: unknown }).code : undefined
  if (code === 'FILE_TOO_LARGE' || code === 'PRINT_FILE_TOO_LARGE') return 'oversize'
  if (
    code === 'UNSUPPORTED_FILE_TYPE' ||
    code === 'FILE_TYPE_NOT_ALLOWED' ||
    code === 'FILE_TYPE_REJECTED'
  ) {
    return 'rejected'
  }
  return 'failed'
}
