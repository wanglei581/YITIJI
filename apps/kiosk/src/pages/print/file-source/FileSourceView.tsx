import type { ReactNode, Ref } from 'react'
import { PrintAiHelp } from '../components/PrintAiHelp'
import { SparklesIcon } from 'lucide-react'
import { QxAppNavbar } from '../../../components/qingxu/QxAppNavbar'
import { QxPageFrame } from '../../../components/qingxu/QxPageFrame'
import { PrintFilePreviewModal } from '../components/PrintPreviewPanel'
import type { UsbFileListItem } from '../../../services/files/usbImportApi'
import {
  FILE_SOURCE_HAS_FILE,
  type FileSourceScreen,
  type LocalRejectKind,
  type PhoneSessionView,
  type UploadTab,
} from './fileSourceModel'
import { FileSourceHero, FileSourceReason, FileSourceStatus } from './FileSourceBits'
import { ChooserBody, LocalBody, ReadyBody } from './FileSourceLocalBody'
import { PhoneBody } from './FileSourcePhoneBody'
import { UsbBody } from './FileSourceUsbBody'
import '../styles/file-source-qx.css'

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

/** 各通道正文拿到的东西：页面 props 加上几项由本壳层算好的派生值。 */
export type FileSourceBodyProps = FileSourceViewProps & {
  channelKeys: UploadTab[]
  fromLabel: string
  /** 本机通道此刻收的格式（照片入口只收图片；Word 转换开着时多收 DOC / DOCX）。 */
  formats: string
  wordAccepted: boolean
}

function primaryLabel(screen: FileSourceScreen, isResume: boolean): string {
  if (screen === 'unknown') return '回到来源选择'
  if (screen === 'local-guide') return '打开文件窗口'
  if (screen === 'local-cancelled') return '再打开一次文件窗口'
  if (screen === 'local-rejected' || screen === 'local-oversize' || screen === 'local-unreadable') return '回窗口再挑一份'
  if (screen === 'local-upload-failed') return '重试上传'
  if (screen === 'phone-gen-failed') return '重新生成二维码'
  if (screen === 'phone-expired' || screen === 'phone-cancelled') return '重新出一张码'
  if (screen === 'phone-status-unknown') return '再查一次状态'
  if (screen === 'phone-uploaded') return '确认使用这份文件'
  if (screen === 'phone-confirm-failed') return '重试确认'
  if (screen === 'phone-cancel-failed') return '重试取消'
  if (screen === 'usb-unavailable') return '改用手机扫码上传'
  if (screen === 'usb-agent-offline') return '重试读 U 盘'
  if (screen === 'usb-wait') return '我插好了，去读一次'
  if (screen === 'usb-empty' || screen === 'usb-read-failed' || screen === 'usb-safeid-expired' || screen === 'usb-import-failed') {
    if (screen === 'usb-import-failed') return '重新读盘再选一次'
    return screen === 'usb-empty' ? '换个 U 盘再读一次' : '重新读一次 U 盘'
  }
  if (screen === 'usb-selected') return '导入这一份'
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

/**
 * 稿 reasonLine：底部按钮上方那一行，说清「下一步：材料检查」为什么还按住。
 * 手里已有当前文件的三态没有这行。按钮本身可点（例如「打开文件窗口」）时也照稿显示——
 * 它说的是材料检查，不是这颗按钮。
 */
const FILE_SOURCE_REASON: Record<FileSourceScreen, string | null> = {
  'source-chooser': '还没有文件，所以「下一步：材料检查」暂时按住不放；先用上面任一通道搬一份进来',
  'missing-file': '本次办理里没有文件，材料检查按住不放',
  unknown: '先回到来源选择，再往下走',
  'local-guide': '还没选文件，材料检查按住不放',
  'local-picking': '还没选定文件，材料检查按住不放',
  'local-cancelled': '这一步还没有文件，材料检查按住不放',
  'local-rejected': '这一份没被收下，当前文件还是空的',
  'local-oversize': '这一份没被收下，当前文件还是空的',
  'local-unreadable': '这一份没被收下，当前文件还是空的',
  'local-uploading': '上传结果还没确认，材料检查按住不放',
  'local-upload-failed': '上传失败，当前文件仍然是空的',
  'local-ready': null,
  'phone-generating': '码还没出来，材料检查按住不放',
  'phone-gen-failed': '上传码还没出来，材料检查按住不放',
  'phone-ready': '还没有文件上来，材料检查按住不放',
  'phone-waiting': '还没有文件上来，材料检查按住不放',
  'phone-uploading': '文件还在路上，材料检查按住不放',
  'phone-status-unknown': '状态未知，材料检查按住不放',
  'phone-expired': '码已过期且没有当前文件，材料检查按住不放',
  'phone-uploaded': '还没确认，材料检查按住不放',
  'phone-confirming': '确认结果还没回来，材料检查按住不放',
  'phone-confirm-failed': '确认失败，当前文件仍然是空的',
  'phone-confirmed': null,
  'phone-cancel-requesting': '取消结果还没回来，材料检查按住不放',
  'phone-cancel-failed': '这一份还没确认，材料检查按住不放',
  'phone-cancelled': '这一步还没有文件，材料检查按住不放',
  'usb-unavailable': '这一步还没有文件，材料检查按住不放',
  'usb-agent-offline': '这一步还没有文件，材料检查按住不放',
  'usb-wait': '还没检测到 U 盘，材料检查按住不放',
  'usb-detecting': '还在读盘，材料检查按住不放',
  'usb-empty': 'U 盘里没有可用文件，材料检查按住不放',
  'usb-list': '还没选定文件，材料检查按住不放',
  'usb-read-failed': '这次没读出文件，材料检查按住不放',
  'usb-selected': '还没导入，材料检查按住不放',
  'usb-safeid-expired': '这一份已失效，需要重新读 U 盘再选',
  'usb-importing': '导入结果还没确认，材料检查按住不放',
  'usb-import-failed': '导入失败，当前文件仍然是空的',
  'usb-ready': null,
}

export function FileSourceView(props: FileSourceViewProps) {
  const {
    screen, pageTitle, pageSubtitle, terminalLabel, status, orderPausedNotice, isResumePrint,
    showFileChannel, tab, currentFile, usbDriveLabel,
    previewOpen, previewToken, onSelectChannel, onOpenPicker, onRetryLocal, onNext, onExit, onBack,
    onHelp, onResumes, onClosePreview,
    onUsbImport, onUsbRescan, onPhoneRefresh, onPhoneConfirm, onPhoneCancel,
    onPhoneRetryStatus, onFileInputChange, inputRef, printAccept, photoOnly,
  } = props

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
  } else if (screen === 'local-rejected' || screen === 'local-oversize' || screen === 'local-unreadable') {
    secondary = ghost('换一条通道', () => onSelectChannel('qr'), 'file-source-switch-source')
  } else if (screen === 'local-upload-failed' || screen === 'phone-gen-failed' || screen === 'usb-read-failed' || screen === 'usb-unavailable') {
    secondary = ghost('联系工作人员', onHelp, 'file-source-help')
  } else if (screen === 'phone-ready') {
    secondary = ghost('刷新二维码', onPhoneRefresh, 'file-source-refresh')
  } else if (screen === 'phone-waiting' || screen === 'phone-uploading' || screen === 'phone-uploaded' || screen === 'phone-confirming') {
    secondary = ghost('取消这次手机上传', onPhoneCancel, 'file-source-cancel')
  } else if (screen === 'phone-status-unknown' || screen === 'phone-confirm-failed') {
    secondary = ghost('重新出一张码', onPhoneRefresh, 'file-source-refresh')
  } else if (screen === 'phone-expired' || screen === 'usb-agent-offline' || screen === 'usb-safeid-expired' || screen === 'usb-import-failed') {
    secondary = ghost(
      screen === 'phone-expired' ? '改用 U 盘导入' : '改用手机扫码上传',
      () => onSelectChannel(screen === 'phone-expired' ? 'usb' : 'qr'),
      'file-source-switch-source',
    )
  } else if (screen === 'phone-cancel-failed') {
    secondary = ghost('保留这份 · 回去确认', onPhoneConfirm, 'file-source-keep')
  } else if (screen === 'usb-detecting') {
    secondary = ghost('取消，换一条通道', () => onSelectChannel('qr'), 'file-source-switch-source')
  } else if (screen === 'usb-list') {
    secondary = ghost('重新读一次盘', onUsbRescan, 'file-source-refresh')
  } else if (screen === 'usb-selected') {
    secondary = ghost('回列表重选', onUsbRescan, 'file-source-back-list')
  } else if (screen === 'local-uploading' || screen === 'usb-importing') {
    secondary = ghost('退出 · 回打印扫描', onExit, 'file-source-exit')
  } else {
    secondary = ghost('退出 · 回打印扫描', onExit, 'file-source-exit')
  }

  const enabled = primaryEnabled(screen)
  const reason = FILE_SOURCE_REASON[screen]
  const ctabar = previewOpen ? undefined : (
    <div className="fs-bottom"><div className="print-upload-footer" data-testid="file-source-ctabar">
      {secondary}
      <button
        type="button"
        className="qx-btn"
        data-variant="primary"
        disabled={!enabled}
        aria-disabled={!enabled || undefined}
        onClick={handlePrimary}
        data-testid="file-source-primary"
        aria-label={enabled ? primaryLabel(screen, isResumePrint) : `${primaryLabel(screen, isResumePrint)}（${reason ?? '还没有文件'}）`}
      >
        {primaryLabel(screen, isResumePrint)}
      </button>
    </div>
      <div className="fs-actions">
        <button type="button" onClick={onBack}>上一步</button>
        <PrintAiHelp label="问小青：这份文件怎么检查 →" draft="这份文件要怎么检查？检查会看哪些内容？" />
      </div>
    </div>
  )

  const wordAccepted = props.conversionReason === null
  const formats = photoOnly ? 'JPG / PNG' : wordAccepted ? 'PDF / Word / JPG / PNG' : 'PDF / JPG / PNG'
  const bodyProps: FileSourceBodyProps = { ...props, channelKeys, fromLabel, formats, wordAccepted }
  const prefix = screen.split('-')[0]
  const body: ReactNode = FILE_SOURCE_HAS_FILE.has(screen)
    ? <ReadyBody {...bodyProps} />
    : prefix === 'local'
      ? <LocalBody {...bodyProps} />
      : prefix === 'phone'
        ? <PhoneBody {...bodyProps} />
        : prefix === 'usb'
          ? <UsbBody {...bodyProps} />
          : <ChooserBody {...bodyProps} />
  const heroDoing =
    screen === 'source-chooser' && !showFileChannel
      ? '手机、U 盘、纸质扫描都能进来；登录后还能直接用「我的文档」里存过的材料。第三方网盘不接入。'
      : undefined

  return (
    <QxPageFrame
      title={pageTitle}
      subtitle={pageSubtitle}
      terminalLabel={terminalLabel}
      status={status}
      back={{ label: '返回打印扫描', onBack }}
      ctabar={ctabar}
      navbar={previewOpen ? undefined : <QxAppNavbar onHome={props.onHome} onAdvisor={props.onAdvisor} onProfile={props.onProfile} />}
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
        className="qx-scroll fs-page"
        data-w2-page="print-upload"
        data-qx-screen="file-source"
        data-takeaway="检查后带走打印件"
        data-print-flow-step={1}
        data-state={screen}
        data-testid={`file-source-state-${screen}`}
      >
        <FileSourceHero screen={screen} isResume={isResumePrint} doing={heroDoing} />
        {orderPausedNotice ? (
          <FileSourceStatus kind="warn" title={status.label}>
            {orderPausedNotice}
          </FileSourceStatus>
        ) : null}
        {isResumePrint ? (
          <button type="button" className="fs-mini" onClick={onResumes} aria-label="查看我的简历记录">
            <h4><SparklesIcon size={22} aria-hidden="true" /><span>查看我的简历记录</span></h4>
            <p>已生成的简历可继续查看并打印；已有电子简历也可以在本页上传后直接打印。这里不做 AI 诊断。</p>
          </button>
        ) : null}
        {body}
        {reason && !previewOpen ? <FileSourceReason>{reason}</FileSourceReason> : null}
        {previewOpen && currentFile ? (
          <PrintFilePreviewModal file={currentFile} token={previewToken} onClose={onClosePreview} />
        ) : null}
      </div>
    </QxPageFrame>
  )
}
