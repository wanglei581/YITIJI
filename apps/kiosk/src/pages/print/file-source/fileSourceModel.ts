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

export interface FileSourceAsk {
  lead: string
  em: string
  tail: string
  doing: string
}

export const FILE_SOURCE_ASK: Record<FileSourceScreen, FileSourceAsk> = {
  'source-chooser': { lead: '文件', em: '怎么进来', tail: '？', doing: '本机、手机、U 盘、纸质扫描都能进来；登录后还能直接用「我的文档」里存过的材料。第三方网盘不接入。' },
  'missing-file': { lead: '这一步', em: '没有文件', tail: '。', doing: '我不替你挑一份，也不凭地址就说已经传好了。' },
  unknown: { lead: '这个状态', em: '我不认识', tail: '。', doing: '不猜你想去哪一步，也不把地址里的原始参数抄到屏幕上。' },
  'local-guide': { lead: '本机选文件是', em: '兼容路径', tail: '。', doing: '会弹系统窗口。一体机上优先手机扫码，这条留给桌面验证。' },
  'local-picking': { lead: '挑', em: '一份', tail: '就行。', doing: '一次只能选一个。选中即上传，服务端校验格式和大小。' },
  'local-cancelled': { lead: '窗口', em: '关掉了', tail: '。', doing: '上传还没开始，没有产生任何上传。再打开一次，或者换条通道。' },
  'local-rejected': { lead: '这份', em: '格式不收', tail: '。', doing: '只收 PDF / JPG / PNG。Word 先另存为 PDF。' },
  'local-oversize': { lead: '这份', em: '太大了', tail: '。', doing: '本机与 U 盘单份 15MB 以内，手机通道是 10MB。' },
  'local-unreadable': { lead: '这份', em: '读不出来', tail: '。', doing: '大小都取不到，不会硬着头皮上传。' },
  'local-uploading': { lead: '正在', em: '送上去', tail: '。', doing: '一次性上传，没有进度百分比。这一步没有取消动作，等服务端给结果。' },
  'local-upload-failed': { lead: '', em: '没送上去', tail: '。', doing: '服务端没确认收到。刚才挑的那份还在，直接重试。' },
  'local-ready': { lead: '收到了，', em: '就这一份', tail: '。', doing: '服务端确认落库后回给本机的结果。可以去材料检查了。' },
  'phone-generating': { lead: '正在', em: '要一张码', tail: '。', doing: '还没拿到就不先放假图。稍等一下。' },
  'phone-gen-failed': { lead: '码', em: '没出来', tail: '。', doing: '没有任何文件被接收。重试，或者换条通道。' },
  'phone-ready': { lead: '', em: '扫这张码', tail: '。', doing: '本机看不到你扫没扫，只认服务端收到文件。' },
  'phone-waiting': { lead: '在', em: '等你手机', tail: '。', doing: '手机上传完，下面会出现文件名。' },
  'phone-uploading': { lead: '手机', em: '正在传', tail: '。', doing: '没有百分比可显示。传完还要你回来点确认。' },
  'phone-status-unknown': { lead: '状态', em: '问不到了', tail: '。', doing: '这不等于已过期。可以再问一次，或者重新出码。' },
  'phone-expired': { lead: '这张码', em: '过期了', tail: '。', doing: '按服务端结果判定。重新出一张就行。' },
  'phone-uploaded': { lead: '传上来了，', em: '等你确认', tail: '。', doing: 'uploaded 还不算数，确认之后才进这次办理。' },
  'phone-confirming': { lead: '正在', em: '确认', tail: '。', doing: '结果没回来之前，它还不是当前文件。' },
  'phone-confirm-failed': { lead: '', em: '确认失败', tail: '。', doing: '这份没进本次办理。重试确认，或者重新出码。' },
  'phone-confirmed': { lead: '确认了，', em: '就这一份', tail: '。', doing: '这是本次办理要打的文件。可以去材料检查了。' },
  'phone-cancel-requesting': { lead: '正在', em: '取消', tail: '。', doing: '答复没回来之前，这份还挂着，我不说已经作废。' },
  'phone-cancel-failed': { lead: '', em: '没取消掉', tail: '。', doing: '这份还留着。可以重试，也可以回去把它确认掉。' },
  'phone-cancelled': { lead: '会话', em: '已作废', tail: '。', doing: '旧码不再收文件。本次办理里还是没有文件。' },
  'usb-unavailable': { lead: 'U 盘这条', em: '锁着', tail: '。', doing: '本机没配这条通道的令牌，重试也没用。' },
  'usb-agent-offline': { lead: '本地服务', em: '连不上', tail: '。', doing: '和「未配置」不是一回事，这个可以重试。' },
  'usb-wait': { lead: '把 U 盘', em: '插进来', tail: '。', doing: '只读根目录，不进子文件夹，也不自动读整盘。' },
  'usb-detecting': { lead: '正在', em: '读盘', tail: '。', doing: '不画进度条。读完之前不显示任何文件名。' },
  'usb-empty': { lead: '盘里', em: '没有能用的', tail: '。', doing: '根目录没有 PDF / JPG / PNG。多半是格式或位置的问题。' },
  'usb-list': { lead: '挑', em: '一份', tail: '就行。', doing: '每份带一个一次性标识，重新读盘会换一批。' },
  'usb-read-failed': { lead: '', em: '没读出来', tail: '。', doing: '重新插一次。我不显示上一次的列表。' },
  'usb-selected': { lead: '选中了，', em: '还没导入', tail: '。', doing: '只动这一份，盘上其它文件不会被读走。' },
  'usb-safeid-expired': { lead: '这份的标识', em: '失效了', tail: '。', doing: '没有文件被导入。重新读盘再选一次。' },
  'usb-importing': { lead: '正在', em: '导入', tail: '。', doing: '这期间别拔 U 盘。没有中间进度可显示。' },
  'usb-import-failed': { lead: '', em: '没导进来', tail: '。', doing: '多半是一次性标识失效了。重新读盘再选一次。' },
  'usb-ready': { lead: '导好了，', em: '就这一份', tail: '。', doing: '可以拔 U 盘了。本机没有「安全弹出」按钮。' },
}

export function fileSourceEyebrow(screen: FileSourceScreen): string {
  const prefix = screen.split('-')[0]
  if (prefix === 'local') return 'LOCAL FILE'
  if (prefix === 'phone') return 'PHONE UPLOAD'
  if (prefix === 'usb') return 'USB IMPORT'
  return 'FILE SOURCE'
}

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
