import type { ReactNode, Ref } from 'react'
import { uploadedFileSourceLine } from '../../../copy/miniappLinkCopy'
import { helpNeededLine, printProblemLine, whenMiniapp } from '../../../copy/unattendedCopy'
import { useSupportContact } from '../../../hooks/useSupportContact'
import { SparklesIcon } from 'lucide-react'
import { QxTouchCallout } from '../../../components/qingxu/touch/QxTouchCallout'
import { QxAppNavbar } from '../../../components/qingxu/QxAppNavbar'
import { PrintTouchFrame, printAsk } from '../PrintTouchFrame'
import { PrintFillArt } from '../art/PrintFillArt'
import { PrintFilePreviewModal } from '../components/PrintPreviewPanel'
import type { UsbImportHold } from '../../../hooks/useUsbImportGate'
import type { UsbFileListItem } from '../../../services/files/usbImportApi'
import {
  FILE_SOURCE_HAS_FILE,
  type FileSourceScreen,
  type LocalRejectKind,
  type PhoneSessionView,
  type UploadTab,
} from './fileSourceModel'
import {
  ChannelGrid,
  FileRow,
  FileSourceNote,
  UsbImportHoldNotice,
  FileSourceStatus,
  FileSourceSteps,
  FileSourceTruth,
  HelpMini,
  NowFileCard,
  SourceEntry,
} from './FileSourceBits'
import { FileSourceError } from './FileSourceError'
import { fileSourceErrorCopy, isFileSourceErrorScreen } from './fileSourceErrorModel'
import { PhoneBoard } from './FileSourcePhone'
import { UsbPickBoard } from './FileSourceUsb'
import '../styles/file-source-qx.css'
import './file-source-touch.css'

const ASK_LABEL = '问小青：这份文件怎么检查 →'
const ASK_LABEL_SHORT = '问小青：怎么检查'
const ASK_DRAFT = '这份文件要怎么检查？检查会看哪些内容？'

export interface FileSourceViewProps {
  screen: FileSourceScreen
  pageTitle: string
  pageSubtitle: string
  terminalLabel: string
  status: { tone: 'ok' | 'warn' | 'bad' | 'unknown'; label: string }
  /** 打印闸门合上时的可见说明。页头说明在本页只留给读屏，这句要出现在画面上。 */
  orderPausedNotice?: string
  isResumePrint: boolean
  showFileChannel: boolean
  showScan: boolean
  tab: UploadTab
  usbMode: 'ok' | 'unavailable' | 'offline'
  /** 令牌在、后台未放行时盖住 U 盘列表。未配置令牌不走这里，仍用原来的未开通屏。 */
  usbHold?: UsbImportHold | null
  /** 二维码过期时的「改用 U 盘导入」。非放行（含确认中）不出现，避免点进去才说不能用。 */
  usbSwitchAllowed?: boolean
  currentFile: { name: string; size: string; mimeType?: string; fileUrl?: string; fileId?: string } | null
  blockedName: string | null
  blockedMeta: string | null
  wordHint: string
  conversionReason: string | null
  usbFiles: UsbFileListItem[] | null
  usbSelected: UsbFileListItem | null
  usbDriveLabel: string | null
  formatBytes: (bytes: number) => string
  phone: PhoneSessionView
  qrUrl: string | null
  expiresLabel: string
  previewOpen: boolean
  previewToken: string | null
  localRejectKind: LocalRejectKind | null
  inputRef: Ref<HTMLInputElement>
  printAccept: string
  photoOnly: boolean
  onFileInputChange: (event: React.ChangeEvent<HTMLInputElement>) => void
  onSelectChannel: (key: UploadTab) => void
  onOpenPicker: () => void
  onRetryLocal: () => void
  onNext: () => void
  onHome: () => void
  onAdvisor: () => void
  onProfile: () => void
  /** 顶栏返回：稿 12-file-source 的返回键 data-route="/print-scan"。 */
  onBack: () => void
  onExit: () => void
  onHelp: () => void
  onScan: () => void
  onDocuments: () => void
  onResumes: () => void
  onPreview: () => void
  onClosePreview: () => void
  onReplace: () => void
  onDelete: () => void
  onUsbSelect: (safeId: string) => void
  onUsbImport: () => void
  onUsbRescan: () => void
  onPhoneRefresh: () => void
  onPhoneConfirm: () => void
  onPhoneCancel: () => void
  onPhoneRetryStatus: () => void
}

function primaryLabel(screen: FileSourceScreen, isResume: boolean): string {
  if (screen === 'unknown') return '回到来源选择'
  if (screen === 'local-cancelled') return '再打开一次文件窗口'
  if (screen === 'local-guide') return '打开文件窗口'
  if (screen === 'local-rejected' || screen === 'local-oversize' || screen === 'local-unreadable') return '回窗口再挑一份'
  if (screen === 'local-upload-failed') return '重试上传'
  if (screen === 'phone-gen-failed' || screen === 'phone-expired' || screen === 'phone-cancelled') return '重新出一张码'
  if (screen === 'phone-status-unknown') return '再查一次状态'
  if (screen === 'phone-uploaded' || screen === 'phone-generating' || screen === 'phone-ready' || screen === 'phone-waiting' || screen === 'phone-uploading') return '确认使用这份文件'
  if (screen === 'phone-confirm-failed') return '重试确认'
  if (screen === 'phone-cancel-failed') return '重试取消'
  if (screen === 'usb-unavailable') return '改用手机扫码上传'
  if (screen === 'usb-agent-offline') return '重新连接 U 盘'
  if (screen === 'usb-wait') return '我插好了，去读一次'
  if (screen === 'usb-empty' || screen === 'usb-read-failed' || screen === 'usb-safeid-expired' || screen === 'usb-import-failed') {
    return screen === 'usb-empty' ? '换个 U 盘再读一次' : '重新读一次 U 盘'
  }
  if (screen === 'usb-selected') return '导入这份文件'
  if (FILE_SOURCE_HAS_FILE.has(screen)) return isResume ? '下一步：材料检查' : '下一步：材料检查'
  return '下一步：材料检查'
}

function primaryEnabled(screen: FileSourceScreen): boolean {
  return (
    FILE_SOURCE_HAS_FILE.has(screen) ||
    screen === 'local-guide' ||
    screen === 'local-cancelled' ||
    screen === 'local-rejected' ||
    screen === 'local-oversize' ||
    screen === 'local-unreadable' ||
    screen === 'local-upload-failed' ||
    screen === 'unknown' ||
    screen === 'phone-gen-failed' ||
    screen === 'phone-status-unknown' ||
    screen === 'phone-expired' ||
    screen === 'phone-uploaded' ||
    screen === 'phone-confirm-failed' ||
    screen === 'phone-cancel-failed' ||
    screen === 'phone-cancelled' ||
    screen === 'usb-unavailable' ||
    screen === 'usb-agent-offline' ||
    screen === 'usb-wait' ||
    screen === 'usb-empty' ||
    screen === 'usb-read-failed' ||
    screen === 'usb-selected' ||
    screen === 'usb-safeid-expired' ||
    screen === 'usb-import-failed'
  )
}

function touchPage(screen: FileSourceScreen): 'print-src' | 'print-upload' | 'print-usb' {
  if (screen.startsWith('phone')) return 'print-upload'
  if (screen.startsWith('usb')) return 'print-usb'
  return 'print-src'
}

function touchTitle(screen: FileSourceScreen): string {
  if (screen === 'source-chooser' || screen === 'missing-file' || screen === 'unknown') return '文件在哪里？'
  if (screen === 'local-rejected' || screen === 'local-oversize' || screen === 'local-unreadable' || screen === 'local-upload-failed') return '这份没传上来'
  if (screen === 'phone-gen-failed') return '二维码没出来，文件没传上来'
  if (screen === 'phone-uploaded' || screen === 'phone-confirming' || screen === 'phone-confirm-failed' || screen === 'phone-cancel-requesting' || screen === 'phone-cancel-failed') return '系统已收到，等你确认'
  if (screen === 'phone-expired') return '这张上传码过期了'
  if (screen === 'phone-cancelled') return '这次上传已取消'
  if (screen.startsWith('phone')) return '用手机扫描下方二维码'
  if (screen === 'usb-list' || screen === 'usb-selected' || screen === 'usb-importing') return '挑一份就行'
  if (screen === 'usb-wait') return '把 U 盘插进右侧 USB 口'
  if (screen === 'usb-detecting') return '正在读 U 盘'
  if (screen === 'usb-empty') return '这个 U 盘里没有能用的文件'
  if (screen === 'usb-unavailable') return '这台机器没接通 U 盘导入'
  if (screen === 'usb-agent-offline' || screen === 'usb-read-failed') return '暂时无法读取 U 盘'
  if (screen === 'usb-import-failed') return '这一份没导进来'
  if (screen === 'usb-safeid-expired') return '请重新选择这份文件'
  if (screen === 'local-cancelled') return '你取消了文件窗口'
  if (screen === 'local-uploading') return '正在上传，请稍候'
  if (screen === 'local-ready' || screen === 'usb-ready' || screen === 'phone-confirmed') return '先核对这份文件'
  if (screen === 'local-guide' || screen === 'local-picking') return '本机选文件'
  return '文件在哪里？'
}

function touchSubtitle(screen: FileSourceScreen, pageSubtitle: string, paused: string | undefined): string | undefined {
  if (paused) return pageSubtitle
  if (screen === 'usb-list' || screen === 'usb-selected' || screen === 'usb-importing') return '只读根目录，不进子文件夹。'
  if (screen === 'usb-wait' || screen === 'usb-detecting') return '还没读到 U 盘里的文件。'
  return undefined
}

export function FileSourceView(props: FileSourceViewProps) {
  const {
    screen, pageTitle, pageSubtitle, terminalLabel, status, orderPausedNotice, isResumePrint,
    showFileChannel, showScan, tab, usbMode, usbHold = null, usbSwitchAllowed = true, currentFile, blockedName, blockedMeta,
    wordHint, conversionReason, usbFiles, usbSelected, usbDriveLabel, formatBytes, phone, qrUrl, expiresLabel,
    previewOpen, previewToken, onSelectChannel, onOpenPicker, onRetryLocal, onNext, onExit, onBack,
    onHelp, onScan, onDocuments, onResumes, onPreview, onClosePreview, onReplace, onDelete,
    onUsbSelect, onUsbImport, onUsbRescan, onPhoneRefresh, onPhoneConfirm, onPhoneCancel,
    onPhoneRetryStatus, onFileInputChange, inputRef, printAccept, photoOnly,
  } = props
  const support = useSupportContact()
  const miniappLine = whenMiniapp(support, '手机小程序里登录后传过的 PDF、图片，登录这台机器后在我的文档里选。')

  const channelKeys: UploadTab[] = showFileChannel ? ['qr', 'file', 'usb'] : ['qr', 'usb']
  const fromLabel =
    tab === 'usb' ? `U 盘导入${usbDriveLabel ? ` · ${usbDriveLabel}` : ''}` : tab === 'qr' ? '手机扫码上传' : '本机选文件'

  const handlePrimary = () => {
    if (FILE_SOURCE_HAS_FILE.has(screen)) {
      onNext()
      return
    }
    if (screen === 'local-guide' || screen === 'local-cancelled' || screen === 'local-rejected' || screen === 'local-oversize' || screen === 'local-unreadable') {
      onOpenPicker()
      return
    }
    if (screen === 'local-upload-failed') {
      onRetryLocal()
      return
    }
    if (screen === 'unknown') {
      onSelectChannel('qr')
      return
    }
    if (screen === 'phone-gen-failed' || screen === 'phone-expired' || screen === 'phone-cancelled') {
      onPhoneRefresh()
      return
    }
    if (screen === 'phone-status-unknown') {
      onPhoneRetryStatus()
      return
    }
    if (screen === 'phone-uploaded' || screen === 'phone-confirm-failed') {
      onPhoneConfirm()
      return
    }
    if (screen === 'phone-cancel-failed') {
      onPhoneCancel()
      return
    }
    if (screen === 'usb-unavailable') {
      onSelectChannel('qr')
      return
    }
    if (screen === 'usb-agent-offline' || screen === 'usb-wait' || screen === 'usb-empty' || screen === 'usb-read-failed' || screen === 'usb-safeid-expired' || screen === 'usb-import-failed') {
      onUsbRescan()
      return
    }
    if (screen === 'usb-selected') {
      onUsbImport()
    }
  }

  const ghost = (label: string, action: () => void, testId: string) => (
    <button type="button" className="qx-btn" data-variant="ghost" onClick={action} data-testid={testId}>
      {label}
    </button>
  )

  let secondary: ReactNode
  if (screen === 'local-picking') {
    secondary = ghost('取消这次选择', onOpenPicker, 'file-source-cancel-pick')
  } else if (screen === 'local-rejected' || screen === 'local-oversize' || screen === 'local-unreadable' || screen === 'local-upload-failed' || screen === 'phone-gen-failed') {
    secondary = ghost('换一种方式', () => onSelectChannel('qr'), 'file-source-switch-source')
  } else if (screen === 'usb-read-failed' || screen === 'usb-unavailable') {
    secondary = ghost('使用帮助', onHelp, 'file-source-help')
  } else if (screen === 'phone-ready') {
    secondary = ghost('刷新二维码', onPhoneRefresh, 'file-source-refresh')
  } else if (screen === 'phone-waiting' || screen === 'phone-uploading' || screen === 'phone-uploaded' || screen === 'phone-confirming') {
    secondary = ghost('取消这次上传', onPhoneCancel, 'file-source-cancel')
  } else if (screen === 'phone-status-unknown' || screen === 'phone-confirm-failed') {
    secondary = ghost('重新出一张码', onPhoneRefresh, 'file-source-refresh')
  } else if (screen === 'phone-expired' || screen === 'usb-agent-offline' || screen === 'usb-safeid-expired' || screen === 'usb-import-failed') {
    const offerUsb = screen === 'phone-expired' && usbSwitchAllowed
    secondary = ghost(
      offerUsb ? '改用 U 盘导入' : screen === 'phone-expired' ? '退出 · 回打印扫描' : '改用手机扫码上传',
      () => {
        if (offerUsb) onSelectChannel('usb')
        else if (screen === 'phone-expired') onExit()
        else onSelectChannel('qr')
      },
      offerUsb || screen !== 'phone-expired' ? 'file-source-switch-source' : 'file-source-exit',
    )
  } else if (screen === 'phone-cancel-failed') {
    secondary = ghost('保留这份 · 回去确认', onPhoneConfirm, 'file-source-keep')
  } else if (screen === 'usb-detecting') {
    secondary = ghost('取消，换一条通道', () => onSelectChannel('qr'), 'file-source-switch-source')
  } else if (screen === 'usb-list') {
    secondary = null
  } else if (screen === 'usb-selected') {
    secondary = ghost('回列表重选', onUsbRescan, 'file-source-back-list')
  } else if (screen === 'source-chooser' || screen === 'missing-file') {
    // 稿 print-src：底栏返回就是出口，页内不再摆一颗「退出」
    secondary = null
  } else if (screen === 'local-uploading' || screen === 'usb-importing') {
    secondary = ghost('退出 · 回打印扫描', onExit, 'file-source-exit')
  } else {
    secondary = ghost('退出 · 回打印扫描', onExit, 'file-source-exit')
  }

  const usbHoldActive = tab === 'usb' ? usbHold : null
  if (usbHoldActive) secondary = ghost('退出 · 回打印扫描', onExit, 'file-source-exit')

  const enabled = usbHoldActive ? usbHoldActive.state !== 'loading' : primaryEnabled(screen)
  const primaryText = usbHoldActive
    ? (usbHoldActive.state === 'loading' ? '确认后再选文件' : '改用手机扫码上传')
    : primaryLabel(screen, isResumePrint)
  const onPrimary = () => {
    if (usbHoldActive) {
      if (usbHoldActive.state !== 'loading') onSelectChannel('qr')
      return
    }
    handlePrimary()
  }
  // 八种出错屏（稿 st-error）共用一块出错板件：两张出口卡 = 重试这一步 + 换一种办法。
  // 动作都沿用原来的底栏主键与次按钮，没有新增能力；USB 通道没放行时，「换一种方式」改成去我的文档。
  const errorMode = isFileSourceErrorScreen(screen) && !usbHoldActive
  const usbOk = usbMode === 'ok' && usbSwitchAllowed
  const errorCopy = errorMode && isFileSourceErrorScreen(screen) ? fileSourceErrorCopy(screen, { usbSwitchAllowed: usbOk }) : null
  const toQr = () => onSelectChannel('qr')
  const errorActions: Record<string, { retry: () => void; alt: () => void; file: { name: string; meta: string | null; testId: string } | null; fine?: string | null }> = {
    'local-rejected': { retry: onOpenPicker, alt: toQr, file: blockedName ? { name: blockedName, meta: blockedMeta, testId: 'file-source-blocked-file' } : null, fine: wordHint },
    'local-oversize': { retry: onOpenPicker, alt: toQr, file: blockedName ? { name: blockedName, meta: blockedMeta, testId: 'file-source-blocked-file' } : null, fine: wordHint },
    'local-unreadable': { retry: onOpenPicker, alt: toQr, file: blockedName ? { name: blockedName, meta: blockedMeta, testId: 'file-source-blocked-file' } : null, fine: wordHint },
    'local-upload-failed': { retry: onRetryLocal, alt: toQr, file: blockedName ? { name: blockedName, meta: blockedMeta, testId: 'file-source-failed-file' } : null },
    'phone-gen-failed': { retry: onPhoneRefresh, alt: usbOk ? () => onSelectChannel('usb') : onDocuments, file: null },
    'phone-confirm-failed': {
      retry: onPhoneConfirm,
      alt: onPhoneRefresh,
      file: phone.pendingName ? { name: phone.pendingName, meta: `${phone.pendingSize ?? ''} · ${uploadedFileSourceLine(phone.pendingSource) || '手机扫码上传'}`, testId: 'file-source-phone-file' } : null,
    },
    'usb-import-failed': {
      retry: onUsbRescan,
      alt: toQr,
      file: usbSelected
        ? { name: usbSelected.filename, meta: `${formatBytes(usbSelected.sizeBytes)}${usbDriveLabel ? ` · ${usbDriveLabel}` : ''}`, testId: 'file-source-selected-file' }
        : null,
    },
    'usb-read-failed': { retry: onUsbRescan, alt: toQr, file: null },
  }
  const errorBoard = errorCopy ? (() => {
    const actions = errorActions[screen]
    return (
      <FileSourceError
        copy={errorCopy}
        file={actions.file}
        onRetry={actions.retry}
        onAlt={actions.alt}
        onHelp={onHelp}
        remind={helpNeededLine(support)}
        fine={actions.fine}
      />
    )
  })() : null

  const switchRow = (
    <section className="fs-sec" data-testid="file-source-switch">
      <div className="fs-sec-h">
        <span className="no">02</span>
        <span className="t">换一条通道也行</span>
        <span className="hint">当前：{tab === 'file' ? '本机选文件' : tab === 'qr' ? '手机扫码上传' : 'U 盘导入'}</span>
      </div>
      <ChannelGrid keys={channelKeys} active={tab} usbMode={usbMode} onSelect={onSelectChannel} />
    </section>
  )

  let body: ReactNode
  switch (screen) {
    case 'source-chooser':
    case 'missing-file':
    case 'unknown':
      body = (
        <>
          <SourceEntry
            screen={screen}
            showFileChannel={showFileChannel}
            showScan={showScan}
            usbMode={usbMode}
            wordText={conversionReason ?? wordHint}
            miniappLine={miniappLine}
            onSelectChannel={onSelectChannel}
            onScan={onScan}
            onDocuments={onDocuments}
          />
        </>
      )
      break
    case 'local-guide':
    case 'local-picking':
    case 'local-cancelled':
      body = (
        <>
          <FileSourceStatus kind="plain" title={screen === 'local-cancelled' ? '你取消了文件窗口' : '本机选文件：备用通道'} chips={[{ label: 'PDF / JPG / PNG' }, { label: '单份 ≤ 15MB' }]}>
            <div className="fs-status-p">
              {screen === 'local-cancelled'
                ? '这一屏只对应一种情况：系统文件窗口被关掉，上传还没开始。所以这一步还是没有文件，也没有产生任何上传。'
                : '这条会弹出系统文件窗口。一体机上不推荐先用它——系统窗口会盖住流程，公共屏幕也不该暴露本机目录。手机和 U 盘都不方便时再用这条，单份 ≤ 15MB。'}
            </div>
          </FileSourceStatus>
          <section className="fs-sec">
            <div className="qx-card fs-file-work">
              <FileSourceSteps
                title="点下面这一下会发生什么"
                items={['浏览器弹出系统文件窗口，你挑一份文件。', '选中即上传，并检查格式和大小。', '收到后，文件名出现在「当前文件」里。']}
              />
              <div className="fs-notes" style={{ marginTop: 14 }}>
                <FileSourceNote>第三方网盘尚未接入：公共终端不做网盘授权登录。你自己存过或生成过的材料在「我的文档」里，登录即可直接选；其余先下载到手机再扫码上传。</FileSourceNote>
                <FileSourceNote>关掉这个系统窗口不会上传任何东西，也不会改变本次办理里已经有的当前文件。</FileSourceNote>
              </div>
            </div>
          </section>
          {switchRow}
          {screen === 'local-cancelled' ? <div className="fs-mini" data-static="true"><h4>本机通道的定位</h4><FileSourceNote>在屏幕上弹文件窗口是备用通道，现场优先用手机扫码。</FileSourceNote><FileSourceSteps title="为什么更推荐手机扫码" items={['不用在公共屏幕翻本机目录。', '系统弹窗不会盖住流程。', '要打的文件多半在你手机里。']} /></div> : null}
        </>
      )
      break
    case 'local-rejected':
    case 'local-oversize':
    case 'local-unreadable':
    case 'local-upload-failed':
    case 'phone-gen-failed':
    case 'phone-confirm-failed':
    case 'usb-import-failed':
    case 'usb-read-failed':
      body = errorBoard
      break
    case 'local-uploading':
      body = (
        <>
          <FileSourceStatus
            kind={screen === 'local-uploading' ? 'info' : 'error'}
            title={screen === 'local-uploading' ? '正在上传，请稍候' : '上传没成功'}
            pulsing={screen === 'local-uploading'}
            chips={
              screen === 'local-uploading'
                ? [{ label: '没有可确认的百分比' }, { tone: 'warn', label: '本页无取消动作' }]
                : [{ tone: 'bad', label: '尚未收到' }]
            }
          >
            <div className="fs-status-p">
              {screen === 'local-uploading'
                ? '正在上传这份文件，请稍候。完成前无法继续材料检查。'
                : '还没有收到这一份文件。可以重试刚才选择的文件。'}
            </div>
          </FileSourceStatus>
          <section className="fs-sec">
            <div className="qx-card fs-file-work">
              {blockedName ? (
                <FileRow
                  name={blockedName}
                  meta={blockedMeta ?? ''}
                  tag="正在上传"
                  tagTone="doing"
                  testId="file-source-uploading-file"
                />
              ) : null}
              <div className="fs-empty">
                <span>收到文件之前，<b>当前文件仍然是空的</b>。结果由系统返回，这一页没有取消上传动作。</span>
              </div>
              <FileSourceSteps title="接下来只有三种结果" items={['成功：系统确认保存，文件成为当前文件。', '失败：没有确认收到，可以直接重试。', '一直没结束：先重试，仍不行就看使用帮助。']} />
            </div>
          </section>
          <HelpMini onHelp={onHelp} text={`上传一直不结束，或者反复失败。${helpNeededLine(support)}`} />
        </>
      )
      break
    case 'local-ready':
    case 'usb-ready':
    case 'phone-confirmed':
      body = currentFile ? (
        <>
          <FileSourceStatus kind="info" title={screen === 'usb-ready' ? '导入完成，可以拔 U 盘了' : screen === 'phone-confirmed' ? '已确认，这就是本次办理要打的文件' : '先核对这份文件'} chips={[{ tone: 'ok', label: '已收到文件' }]}>
            <div className="fs-status-p">打开预览，看清每一页有没有选错。一次办理一份，需要换文件可以在下面更换。</div>
          </FileSourceStatus>
          <NowFileCard
            name={currentFile.name}
            meta={currentFile.size}
            from={fromLabel}
            onPreview={onPreview}
            onReplace={onReplace}
            onDelete={onDelete}
          />
          <div className="fs-mini" data-static="true"><h4>{screen === 'usb-ready' ? 'U 盘上的东西没被改' : screen === 'phone-confirmed' ? '手机那边可以关了' : '想换一条来源？'}</h4><p>{screen === 'usb-ready' ? '整个过程只读不写，盘上的原件仍在原处。' : screen === 'phone-confirmed' ? '确认之后手机上传页可以关闭，本次办理只用这一份文件。' : '先删除当前文件，再选择手机上传或 U 盘。'}</p></div>
        </>
      ) : null
      break
    case 'phone-generating':
    case 'phone-ready':
    case 'phone-waiting':
    case 'phone-uploading':
    case 'phone-status-unknown':
    case 'phone-expired':
    case 'phone-uploaded':
    case 'phone-confirming':
    case 'phone-cancel-requesting':
    case 'phone-cancel-failed':
    case 'phone-cancelled':
      body = (
        <PhoneBoard
          screen={screen}
          phone={phone}
          qrUrl={qrUrl}
          expiresLabel={expiresLabel}
          channelKeys={channelKeys}
          usbMode={usbMode}
          helpText={['phone-status-unknown', 'phone-expired', 'phone-cancel-failed'].includes(screen) ? helpNeededLine(support) : ''}
          onSelectChannel={onSelectChannel}
        />
      )
      break
    case 'usb-unavailable':
    case 'usb-agent-offline':
    case 'usb-wait':
    case 'usb-detecting':
    case 'usb-empty':
      body = (
        <>
          <FileSourceStatus
            kind={screen === 'usb-unavailable' ? 'lock' : screen === 'usb-agent-offline' ? 'error' : screen === 'usb-empty' ? 'warn' : 'plain'}
            title={
              screen === 'usb-unavailable' ? '这台机器没接通 U 盘导入'
                : screen === 'usb-agent-offline' ? '暂时无法读取 U 盘'
                  : screen === 'usb-wait' ? '把 U 盘插进右侧 USB 口'
                    : screen === 'usb-detecting' ? '正在读 U 盘'
                      : '这个 U 盘里没有能用的文件'
            }
            pulsing={screen === 'usb-detecting'}
          >
            <div className="fs-status-p">
              {screen === 'usb-unavailable'
                ? `本机暂未开通 U 盘导入，请改用手机上传。${printProblemLine()}`
                : screen === 'usb-agent-offline'
                  ? '暂时无法读取 U 盘。可以重新连接，或改用手机上传。'
                  : screen === 'usb-wait'
                    ? '还没有检测到 U 盘。插上之后本地服务会列出根目录里能打印的文件。本机不会自动读整盘，也不进子文件夹。'
                    : screen === 'usb-detecting'
                      ? '本地服务在列根目录。不画进度条——读盘这件事没有可确认的百分比。读完之前不显示任何文件名。'
                      : '根目录里没有找到 PDF / JPG / PNG。常见原因：简历是 DOCX、文件放在子文件夹里、或者单份超过 15MB。'}
            </div>
          </FileSourceStatus>
          {screen === 'usb-unavailable' || screen === 'usb-agent-offline' || screen === 'usb-empty' ? (
            <div className="qx-card"><FileSourceSteps title={screen === 'usb-empty' ? '对号入座' : '重试是安全的'} items={screen === 'usb-empty' ? ['Word 另存为 PDF，再放到 U 盘最外层。', '不进入子文件夹，请把文件移到最外层。', '单份超过 15MB 时，降低分辨率再导出。'] : ['重新插入 U 盘，或换一个 USB 口。', '重新读取最外层文件，不改动盘上内容。', '仍没有结果时，换手机上传，或看使用帮助。']} /></div>
          ) : null}
          {screen === 'usb-unavailable' || screen === 'usb-agent-offline' || screen === 'usb-empty' ? (
            <section className="fs-sec">
              <ChannelGrid keys={channelKeys} active={null} usbMode={usbMode} onSelect={onSelectChannel} />
            </section>
          ) : (
            <section className="fs-sec">
              <div className="qx-card fs-file-work">
                <FileSourceSteps
                  title="插上之后会发生什么"
                  items={['检测已插入的 U 盘。', '列出根目录里可打印的 PDF / JPG / PNG。', '选择一份文件，再点「导入这份文件」。']}
                />
                <div style={{ marginTop: 14 }}>
                  <FileSourceNote>屏幕上只列文件名，不显示完整路径。</FileSourceNote><FileSourceNote>整个过程只读不写，不会往你的 U 盘里放东西。</FileSourceNote>
                </div>
              </div>
            </section>
          )}
          {screen === 'usb-wait' ? switchRow : null}
        </>
      )
      break
    case 'usb-list':
    case 'usb-selected':
    case 'usb-safeid-expired':
    case 'usb-importing':
      body = (
        <UsbPickBoard
          screen={screen}
          files={usbFiles}
          selected={usbSelected}
          driveLabel={usbDriveLabel}
          formatBytes={formatBytes}
          wordText={conversionReason ?? wordHint}
          onSelect={onUsbSelect}
          onRescan={onUsbRescan}
        />
      )
      break
    default:
      body = null
  }

  // 稿：来源选择页没有主按钮（没有文件就没有下一步）；U 盘列表选中之前也没有，选中后才出「导入这份文件」。
  const noPrimary = !usbHoldActive && (screen === 'source-chooser' || screen === 'missing-file' || screen === 'usb-list')
  const eyebrow = pageTitle === '简历打印' || pageTitle === '照片打印' ? pageTitle : '文档打印'
  // 出错屏（稿 st-error）：眉题「打印文件 · 上传」，警示色状态胶囊，无「青」印章、不画四步轴。
  return (
    <PrintTouchFrame
      page={touchPage(screen)}
      legacyBody={false}
      kind="std"
      eyebrow={errorCopy ? `${pageTitle === '简历打印' || pageTitle === '照片打印' ? pageTitle : '打印文件'} · 上传` : eyebrow}
      title={errorCopy ? errorCopy.title : touchTitle(screen)}
      subtitle={errorCopy ? errorCopy.subtitle : touchSubtitle(screen, pageSubtitle, orderPausedNotice)}
      seal={errorCopy || screen.startsWith('phone') || screen.startsWith('usb') ? null : 'idle'}
      railNow={errorCopy || screen.startsWith('phone') ? undefined : 0}
      terminalLabel={terminalLabel}
      status={errorCopy ? { tone: 'warn', label: errorCopy.pill } : screen === 'phone-uploaded' ? { tone: 'ok', label: '系统已收到，等你确认' } : status}
      back={{ label: '上一步', onBack }}
      navbar={previewOpen ? undefined : <QxAppNavbar onHome={props.onHome} onAdvisor={props.onAdvisor} onProfile={props.onProfile} />}
      // 稿：选文件与手机传文件亮「首页」，U 盘选文件不亮任何一项。
      navCurrent={screen.startsWith('usb') ? 'none' : 'home'}
      ask={previewOpen ? undefined : errorCopy
        ? printAsk(errorCopy.ask.label, errorCopy.ask.draft)
        : printAsk(screen.startsWith('phone') || screen.startsWith('usb') ? ASK_LABEL_SHORT : ASK_LABEL, ASK_DRAFT)}
      primary={previewOpen || noPrimary ? undefined : {
        label: primaryText,
        onClick: onPrimary,
        disabled: !enabled,
        testId: 'file-source-primary',
      }}
    >
      {showFileChannel && (
        <input
          ref={inputRef}
          type="file"
          accept={photoOnly ? '.jpg,.jpeg,.png' : printAccept}
          className="fs-hidden-input"
          onChange={onFileInputChange}
        />
      )}
      <div
        className="fs-touch-page"
        data-w2-page="print-upload"
        data-print-flow-step={1}
        data-state={usbHoldActive ? 'usb-hold' : screen}
        data-usb-gate={usbHoldActive?.state}
        data-testid={usbHoldActive ? 'file-source-state-usb-hold' : `file-source-state-${screen}`}
      >
        {orderPausedNotice ? <QxTouchCallout kind="remind">{orderPausedNotice}</QxTouchCallout> : null}
        {isResumePrint ? (
          <button type="button" className="fs-touch-btn fs-resume-entry" onClick={onResumes} aria-label="查看我的简历记录">
            <SparklesIcon size={22} aria-hidden="true" />
            <span>
              <b>查看我的简历记录</b>
              <small>已生成的简历可继续查看并打印；已有电子简历也可以在本页上传后直接打印。这里不做 AI 诊断。</small>
            </span>
          </button>
        ) : null}
        {usbHoldActive ? <UsbImportHoldNotice hold={usbHoldActive} /> : body}
        <FileSourceTruth />
        {/* 出错板件里两张出口卡自己吃掉剩下的高度（稿 st-error），不再叠一幅填充小样。 */}
        {screen === 'source-chooser' || errorCopy ? null : <PrintFillArt name={screen.startsWith('phone') ? 'phone' : screen.startsWith('usb') ? 'usb' : 'scan-paper'} />}
        <div className="print-upload-footer" data-testid="file-source-ctabar">
          {previewOpen || errorCopy ? null : secondary}
        </div>
        {previewOpen && currentFile ? (
          <PrintFilePreviewModal file={currentFile} token={previewToken} onClose={onClosePreview} />
        ) : null}
      </div>
    </PrintTouchFrame>
  )
}
