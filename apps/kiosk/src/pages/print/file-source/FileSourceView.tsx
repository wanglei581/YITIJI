import type { ReactNode, Ref } from 'react'
import { FileTextIcon, SparklesIcon } from 'lucide-react'
import { QxPageFrame } from '../../../components/qingxu/QxPageFrame'
import { FileContentPreview } from '../../../components/FileContentPreview'
import {
  UploadSessionQrPanel,
  type PhoneSessionChange,
  type PhoneUploadedFile,
  type UploadSessionQrPanelHandle,
} from '../../upload/components/UploadSessionQrPanel'
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
  ExistingSourceLinks,
  FileRow,
  FileSourceHero,
  FileSourceNote,
  FileSourceReason,
  FileSourceStatus,
  FileSourceSteps,
  FileSourceTruth,
  HelpMini,
  NowFileCard,
} from './FileSourceBits'
import { FILE_NAME_BUDGET_CARD, truncateFileNameMiddle } from '../../../lib/fileName'
import '../styles/file-source-qx.css'

export interface FileSourceViewProps {
  screen: FileSourceScreen
  pageTitle: string
  pageSubtitle: string
  terminalLabel: string
  status: { tone: 'ok' | 'warn' | 'bad' | 'unknown'; label: string }
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
  phonePanelRef: Ref<UploadSessionQrPanelHandle>
  onPhoneSessionChange: (snapshot: PhoneSessionChange) => void
  onQrUploaded: (file: PhoneUploadedFile) => void
  onQrBusy: (busy: boolean) => void
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
  if (screen === 'local-guide' || screen === 'local-cancelled') return '打开文件窗口'
  if (screen === 'local-rejected' || screen === 'local-oversize' || screen === 'local-unreadable') return '回窗口再挑一份'
  if (screen === 'local-upload-failed') return '重试上传'
  if (screen === 'phone-gen-failed' || screen === 'phone-expired' || screen === 'phone-cancelled') return '重新出一张码'
  if (screen === 'phone-status-unknown') return '再查一次状态'
  if (screen === 'phone-uploaded') return '确认使用这份文件'
  if (screen === 'phone-confirm-failed') return '重试确认'
  if (screen === 'phone-cancel-failed') return '重试取消'
  if (screen === 'usb-unavailable') return '改用手机扫码上传'
  if (screen === 'usb-agent-offline') return '重试连接本地服务'
  if (screen === 'usb-wait') return '我插好了，去读一次'
  if (screen === 'usb-empty' || screen === 'usb-read-failed' || screen === 'usb-safeid-expired' || screen === 'usb-import-failed') {
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

function disabledReason(screen: FileSourceScreen): string | null {
  if (primaryEnabled(screen) && FILE_SOURCE_HAS_FILE.has(screen)) return null
  if (FILE_SOURCE_HAS_FILE.has(screen)) return null
  if (screen === 'local-uploading') return '上传结果还没确认，材料检查按住不放'
  if (screen === 'phone-generating' || screen === 'phone-ready' || screen === 'phone-waiting') return '还没有文件上来，材料检查按住不放'
  if (screen === 'phone-uploading') return '文件还在路上，材料检查按住不放'
  if (screen === 'phone-confirming') return '确认结果还没回来，材料检查按住不放'
  if (screen === 'phone-cancel-requesting') return '取消结果还没回来，材料检查按住不放'
  if (screen === 'usb-detecting') return '还在读盘，材料检查按住不放'
  if (screen === 'usb-list') return '还没选定文件，材料检查按住不放'
  if (screen === 'usb-importing') return '导入结果还没确认，材料检查按住不放'
  if (screen === 'source-chooser' || screen === 'missing-file') return '这一步还没有文件，先用上面任一通道把文件搬进来'
  if (primaryEnabled(screen)) return null
  return '这一步还没有文件，材料检查按住不放'
}

export function FileSourceView(props: FileSourceViewProps) {
  const {
    screen, pageTitle, pageSubtitle, terminalLabel, status, isResumePrint,
    showFileChannel, showScan, tab, usbMode, currentFile, blockedName, blockedMeta,
    wordHint, usbFiles, usbSelected, usbDriveLabel, formatBytes, phone, previewOpen,
    previewToken, onSelectChannel, onOpenPicker, onRetryLocal, onNext, onExit, onHelp,
    onScan, onDocuments, onResumes, onPreview, onClosePreview, onReplace, onDelete,
    onUsbSelect, onUsbImport, onUsbRescan, onPhoneRefresh, onPhoneConfirm, onPhoneCancel,
    onPhoneRetryStatus, onFileInputChange, inputRef, printAccept, photoOnly,
    onPhoneSessionChange, onQrUploaded, onQrBusy, phonePanelRef,
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
    secondary = ghost('取消这次上传会话', onPhoneCancel, 'file-source-cancel')
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
  const reason = disabledReason(screen)
  const ctabar = previewOpen ? undefined : (
    <div className="print-upload-footer" data-testid="file-source-ctabar">
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
  )

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

  const phonePanel = (
    <div className="fs-phone-slot">
      {!phone.hasQr && !phone.loading ? (
        <div className="fs-qr-blank" data-testid="file-source-qr">
          <strong>{screen === 'phone-gen-failed' ? '码没出来' : '码还没出来'}</strong>
          <span>
            {screen === 'phone-gen-failed'
              ? '向服务端要上传会话失败了。本机不会先出一张假码。'
              : '拿到服务端下发的一次性链接之后这里才会出现二维码'}
          </span>
        </div>
      ) : null}
      <UploadSessionQrPanel
        ref={phonePanelRef}
        purpose="print_doc"
        title="手机扫码上传"
        description={
          isResumePrint
            ? '手机扫码上传简历（PDF/图片）；一体机确认后进入打印材料检查。'
            : '手机或其他联网设备打开链接上传文件；一体机上确认后自动填入本次打印任务。'
        }
        confirmLabel="确认使用这份文件"
        embedded
        onUploaded={onQrUploaded}
        onBusyChange={onQrBusy}
        onSessionChange={onPhoneSessionChange}
      />
    </div>
  )

  let body: ReactNode
  switch (screen) {
    case 'source-chooser':
    case 'missing-file':
    case 'unknown':
      body = (
        <>
          <section className="fs-sec">
            <div className="fs-sec-h">
              <span className="no">01</span>
              <span className="t">{screen === 'unknown' ? '从头选一条通道' : screen === 'missing-file' ? '重新选一条通道' : '文件从哪来'}</span>
              <span className="hint">{screen === 'source-chooser' ? '选一条，下面跟着换' : '三条都能走'}</span>
            </div>
            <ChannelGrid keys={channelKeys} active={null} usbMode={usbMode} onSelect={onSelectChannel} />
          </section>
          <ExistingSourceLinks showScan={showScan} onScan={onScan} onDocuments={onDocuments} />
          {screen === 'source-chooser' ? (
            <section className="fs-sec">
              <div className="fs-split">
                <div className="fs-mini" data-static="true">
                  <h4>第三方网盘尚未接入</h4>
                  <p>本机不做百度网盘 / 微信文件的授权登录 —— 公共终端上登录你的网盘账号不安全。<b>但你自己存过的材料一直在</b>：登录后从「我的文档」直接选，不用重传。</p>
                </div>
                <div className="fs-mini" data-static="true">
                  <h4>两个上限不一样</h4>
                  <p>手机上传单份 <b>≤ 10MB</b>；本机选和 U 盘导入单份 <b>≤ 15MB</b>。Word 是否可收由本机转换能力决定，能力关闭时请另存为 PDF。</p>
                </div>
              </div>
            </section>
          ) : null}
          <section className="fs-sec qx-grow">
            <div className="qx-card" style={{ flex: 1 }}>
              <div className="fs-sec-h">
                <span className="t" style={{ fontSize: 25 }}>当前文件</span>
                <span className="hint">0 份</span>
              </div>
              <FileSourceNote>还没有文件。三条通道任选一条把文件搬进来，文件名会出现在这里。</FileSourceNote>
              <FileSourceSteps title="搬进来之后" items={['服务端校验格式和大小，确认落库。', '文件名和大小显示在这一栏。', '下一步「材料检查」才会亮起来。']} />
              <FileSourceNote><b>没有文件就进不了材料检查</b>，所以下一步先按住不放。</FileSourceNote>
            </div>
          </section>
        </>
      )
      break
    case 'local-guide':
    case 'local-picking':
    case 'local-cancelled':
      body = (
        <>
          <FileSourceStatus kind="plain" title={screen === 'local-cancelled' ? '你取消了文件窗口' : '本机选文件：桌面验证 / 兼容路径'}>
            <div className="fs-status-p">
              {screen === 'local-cancelled'
                ? '这一屏只对应一种情况：系统文件窗口被关掉，上传还没开始。所以这一步还是没有文件，也没有产生任何上传。'
                : '这条会弹出系统文件窗口。一体机上不推荐先用它 —— 系统弹窗会盖住流程，公共屏也不该暴露本机目录。'}
            </div>
          </FileSourceStatus>
          <section className="fs-sec qx-grow">
            <div className="qx-card" style={{ flex: 1 }}>
              <FileSourceSteps
                title="点下面这一下会发生什么"
                items={['浏览器弹出系统文件窗口，你挑一份文件。', '选中即上传，服务端校验格式和大小。', '服务端确认后，文件名出现在「当前文件」里。']}
              />
              <div className="fs-notes" style={{ marginTop: 14 }}>
                <FileSourceNote>{wordHint}</FileSourceNote>
                <FileSourceNote>关掉这个系统窗口不会上传任何东西，也不会改变本次办理里已经有的当前文件。</FileSourceNote>
              </div>
            </div>
          </section>
          {switchRow}
        </>
      )
      break
    case 'local-rejected':
    case 'local-oversize':
    case 'local-unreadable':
      body = (
        <>
          <FileSourceStatus
            kind={screen === 'local-oversize' ? 'warn' : 'error'}
            title={screen === 'local-rejected' ? '这份格式不收' : screen === 'local-oversize' ? '这份超过 15MB' : '这份读不出来'}
            chips={[{ tone: 'bad', label: screen === 'local-oversize' ? '本机 / U 盘 ≤ 15MB' : '未上传' }]}
          >
            <div className="fs-status-p">
              {screen === 'local-rejected'
                ? '服务端只收 PDF、JPG、PNG（Word 仅在转换能力开放时）。这一份没有被上传。'
                : screen === 'local-oversize'
                  ? '本机与 U 盘通道单份上限 15MB，这一份没有被上传。'
                  : '文件为空或者大小取不到，不会硬着头皮上传一份连大小都读不出的东西。'}
            </div>
          </FileSourceStatus>
          <section className="fs-sec qx-grow">
            <div className="qx-card" style={{ flex: 1 }}>
              {blockedName ? (
                <FileRow name={blockedName} meta={blockedMeta ?? ''} tag={screen === 'local-oversize' ? '超过 15MB' : screen === 'local-rejected' ? '格式不收' : '读不出来'} tagTone="bad" bad testId="file-source-blocked-file" />
              ) : null}
              <div className="fs-empty">
                <span className="fs-empty-ic"><FileTextIcon size={38} aria-hidden="true" /></span>
                <span>当前文件仍然是<b>空的</b>。<br />回到窗口再挑一份合规的就能接着走。</span>
              </div>
            </div>
          </section>
        </>
      )
      break
    case 'local-uploading':
    case 'local-upload-failed':
      body = (
        <>
          <FileSourceStatus
            kind={screen === 'local-uploading' ? 'info' : 'error'}
            title={screen === 'local-uploading' ? '正在上传，请稍候' : '上传没成功'}
            pulsing={screen === 'local-uploading'}
            chips={
              screen === 'local-uploading'
                ? [{ label: '没有可确认的百分比' }, { tone: 'warn', label: '本页无取消动作' }]
                : [{ tone: 'bad', label: '服务端未确认' }]
            }
          >
            <div className="fs-status-p">
              {screen === 'local-uploading'
                ? '这一份是一次性整份送出，服务端不回传进度。所以这里不画进度条，也不说还剩几秒。这一步没有「取消本次上传」这个动作。'
                : '服务端没有确认收到这一份，所以当前文件还是空的。你刚才挑的那一份还在，直接重试就行。'}
            </div>
          </FileSourceStatus>
          <section className="fs-sec qx-grow">
            <div className="qx-card" style={{ flex: 1 }}>
              {blockedName ? (
                <FileRow
                  name={blockedName}
                  meta={blockedMeta ?? ''}
                  tag={screen === 'local-uploading' ? '正在上传' : '上传失败'}
                  tagTone={screen === 'local-uploading' ? 'doing' : 'bad'}
                  bad={screen !== 'local-uploading'}
                  testId={screen === 'local-uploading' ? 'file-source-uploading-file' : 'file-source-failed-file'}
                />
              ) : null}
              <div className="fs-empty">
                <span>服务端确认落库之前，<b>当前文件仍然是空的</b>。</span>
              </div>
            </div>
          </section>
          {screen === 'local-uploading' ? <HelpMini onHelp={onHelp} text="上传一直不结束，或者反复失败，可以叫工作人员来看一眼。" /> : null}
        </>
      )
      break
    case 'local-ready':
    case 'usb-ready':
    case 'phone-confirmed':
      body = currentFile ? (
        <>
          <FileSourceStatus kind="info" title={screen === 'usb-ready' ? '导入完成，可以拔 U 盘了' : screen === 'phone-confirmed' ? '已确认，这就是本次办理要打的文件' : '服务端已确认收到'} chips={[{ tone: 'ok', label: '服务端已确认' }]}>
            <div className="fs-status-p">下面这个文件名和大小是服务端确认落库后回给本机的结果，不是本机自己记的。</div>
          </FileSourceStatus>
          <NowFileCard
            name={currentFile.name}
            meta={currentFile.size}
            from={fromLabel}
            onPreview={onPreview}
            onReplace={onReplace}
            onDelete={onDelete}
          />
        </>
      ) : null
      break
    case 'phone-generating':
    case 'phone-gen-failed':
    case 'phone-ready':
    case 'phone-waiting':
    case 'phone-uploading':
    case 'phone-status-unknown':
    case 'phone-expired':
    case 'phone-uploaded':
    case 'phone-confirming':
    case 'phone-confirm-failed':
    case 'phone-cancel-requesting':
    case 'phone-cancel-failed':
    case 'phone-cancelled':
      body = (
        <>
          <FileSourceStatus
            kind={
              screen === 'phone-gen-failed' || screen === 'phone-confirm-failed' || screen === 'phone-cancel-failed'
                ? 'error'
                : screen === 'phone-expired' || screen === 'phone-status-unknown'
                  ? 'warn'
                  : screen.includes('upload') || screen.includes('confirm')
                    ? 'info'
                    : 'plain'
            }
            title={FILE_SOURCE_STATUS_TITLE[screen]}
            pulsing={/generating|waiting|uploading|confirming|requesting/.test(screen)}
            chips={phone.status ? [{ label: `会话状态：${phone.status}` }] : undefined}
          >
            <div className="fs-status-p">
              {screen === 'phone-uploaded'
                ? '文件名和大小是服务端回给本机的结果。uploaded 还不算数——必须你在这台机器上确认，它才成为本次办理的当前文件。'
                : screen === 'phone-cancel-failed'
                  ? '服务端没有确认作废。所以本机不说旧二维码已经失效，也不清掉这次会话。'
                  : FILE_SOURCE_ASK_FALLBACK[screen]}
            </div>
          </FileSourceStatus>
          {screen === 'phone-cancelled' ? (
            <section className="fs-sec">
              <div className="fs-sec-h"><span className="no">01</span><span className="t">接着走哪条</span></div>
              <ChannelGrid keys={channelKeys} active="qr" usbMode={usbMode} onSelect={onSelectChannel} />
            </section>
          ) : null}
          <section className="fs-sec qx-grow">
            <div className="qx-card" style={{ flex: 1 }}>
              {phone.pendingName ? (
                <FileRow
                  name={phone.pendingName}
                  meta={`${phone.pendingSize ?? ''} · 手机扫码上传`}
                  tag={screen === 'phone-uploaded' ? '待确认' : screen === 'phone-confirm-failed' ? '确认失败' : screen === 'phone-cancel-failed' ? '仍待确认' : '处理中'}
                  tagTone={screen === 'phone-confirm-failed' ? 'bad' : 'doing'}
                  testId="file-source-phone-file"
                />
              ) : null}
              {phonePanel}
            </div>
          </section>
          {screen === 'phone-generating' || screen === 'phone-gen-failed' ? switchRow : null}
        </>
      )
      break
    case 'usb-unavailable':
    case 'usb-agent-offline':
    case 'usb-wait':
    case 'usb-detecting':
    case 'usb-empty':
    case 'usb-read-failed':
      body = (
        <>
          <FileSourceStatus
            kind={screen === 'usb-unavailable' ? 'lock' : screen === 'usb-agent-offline' || screen === 'usb-read-failed' ? 'error' : screen === 'usb-empty' ? 'warn' : 'plain'}
            title={
              screen === 'usb-unavailable' ? '这台机器没接通 U 盘导入'
                : screen === 'usb-agent-offline' ? '连不上本机的 Terminal Agent'
                  : screen === 'usb-wait' ? '把 U 盘插进右侧 USB 口'
                    : screen === 'usb-detecting' ? '正在读 U 盘'
                      : screen === 'usb-empty' ? '这个 U 盘里没有能用的文件'
                        : '读 U 盘失败'
            }
            pulsing={screen === 'usb-detecting'}
          >
            <div className="fs-status-p">
              {screen === 'usb-unavailable'
                ? '本终端没有配置 U 盘导入的本地令牌，所以这条通道锁着。这不是重试能解决的。'
                : screen === 'usb-agent-offline'
                  ? '这台机器配了 U 盘导入，但现在连不上本地读盘服务。和「未配置」不是一回事——这个可以重试。'
                  : screen === 'usb-wait'
                    ? '还没有检测到 U 盘。插上之后本地服务会列出根目录里能打印的文件。本机不会自动读整盘，也不进子文件夹。'
                    : screen === 'usb-detecting'
                      ? '本地服务在列根目录。不画进度条——读盘这件事没有可确认的百分比。读完之前不显示任何文件名。'
                      : screen === 'usb-empty'
                        ? '根目录里没有找到 PDF / JPG / PNG。常见原因：简历是 DOCX、文件放在子文件夹里、或者单份超过 15MB。'
                        : '本地服务连上了，但这次没能列出文件。本机不显示上一次的列表。'}
            </div>
          </FileSourceStatus>
          {screen === 'usb-unavailable' || screen === 'usb-agent-offline' || screen === 'usb-empty' || screen === 'usb-read-failed' ? (
            <section className="fs-sec">
              <ChannelGrid keys={channelKeys} active={null} usbMode={usbMode} onSelect={onSelectChannel} />
            </section>
          ) : (
            <section className="fs-sec qx-grow">
              <div className="qx-card" style={{ flex: 1 }}>
                <FileSourceSteps
                  title="插上之后会发生什么"
                  items={['本地服务发现可移动磁盘。', '列出根目录里的 PDF / JPG / PNG，每份配一个一次性标识。', '你选一份，本地服务把它上传到服务端。']}
                />
                <div style={{ marginTop: 14 }}>
                  <FileSourceNote>网页不直接访问磁盘，也拿不到你盘上的绝对路径。</FileSourceNote>
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
    case 'usb-import-failed':
      body = (
        <>
          <FileSourceStatus
            kind={screen === 'usb-import-failed' || screen === 'usb-safeid-expired' ? (screen === 'usb-import-failed' ? 'error' : 'warn') : screen === 'usb-importing' ? 'info' : 'plain'}
            title={
              screen === 'usb-selected' ? '选中了这一份，还没导入'
                : screen === 'usb-safeid-expired' ? '这一份的一次性标识已经失效'
                  : screen === 'usb-importing' ? '正在从 U 盘导入'
                    : screen === 'usb-import-failed' ? '这一份没导进来'
                      : 'U 盘根目录'
            }
            pulsing={screen === 'usb-importing'}
          >
            <div className="fs-status-p">
              {screen === 'usb-selected'
                ? '只导入这一份，U 盘上其它文件不会被读走。导入完成前它还不是当前文件。'
                : screen === 'usb-importing'
                  ? '本地服务在把这一份读出来传到服务端。没有可确认的中间进度。这期间不要拔 U 盘。'
                  : '每一次重新读盘都会换一批一次性标识，旧的当场作废。'}
            </div>
          </FileSourceStatus>
          <section className="fs-sec qx-grow">
            <div className="qx-card" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
              {screen === 'usb-list' && usbFiles
                ? usbFiles.map((item) => (
                    <FileRow
                      key={item.safeId}
                      name={item.filename}
                      meta={formatBytes(item.sizeBytes)}
                      tag="选这份"
                      tagTone="pickable"
                      on={usbSelected?.safeId === item.safeId}
                      onClick={() => onUsbSelect(item.safeId)}
                      testId={`file-source-usb-file-${item.safeId}`}
                    />
                  ))
                : null}
              {usbSelected && screen !== 'usb-list' ? (
                <FileRow
                  name={usbSelected.filename}
                  meta={`${formatBytes(usbSelected.sizeBytes)}${usbDriveLabel ? ` · ${usbDriveLabel}` : ''}`}
                  tag={screen === 'usb-importing' ? '导入中' : screen === 'usb-import-failed' ? '导入失败' : screen === 'usb-safeid-expired' ? '标识失效' : '已选中'}
                  tagTone={screen === 'usb-importing' ? 'doing' : screen === 'usb-selected' ? 'ok' : 'bad'}
                  bad={screen !== 'usb-selected' && screen !== 'usb-importing'}
                  on={screen === 'usb-selected'}
                  dim={screen === 'usb-safeid-expired'}
                  testId="file-source-selected-file"
                />
              ) : null}
              <div style={{ marginTop: 12 }}>
                <FileSourceNote>只列根目录里能打印的文件。超过上限的不列。子文件夹里的东西不在这里。</FileSourceNote>
              </div>
            </div>
          </section>
        </>
      )
      break
    default:
      body = null
  }

  return (
    <QxPageFrame
      title={pageTitle}
      subtitle={pageSubtitle}
      terminalLabel={terminalLabel}
      status={status}
      ctabar={ctabar}
    >
      <input
        ref={inputRef}
        type="file"
        accept={photoOnly ? '.jpg,.jpeg,.png' : printAccept}
        className="fs-hidden-input"
        onChange={onFileInputChange}
      />
      <div
        className="qx-scroll fs-page"
        data-w2-page="print-upload"
        data-qx-screen="file-source"
        data-print-flow-step={1}
        data-state={screen}
        data-testid={`file-source-state-${screen}`}
      >
        <FileSourceHero screen={screen} isResume={isResumePrint} />
        {isResumePrint ? (
          <button type="button" className="fs-mini" onClick={onResumes} aria-label="查看我的简历记录">
            <h4><SparklesIcon size={22} aria-hidden="true" /><span>查看我的简历记录</span></h4>
            <p>已生成的简历可继续查看并打印；已有电子简历也可以在本页上传后直接打印。这里不做 AI 诊断。</p>
          </button>
        ) : null}
        {body}
        {reason && !previewOpen ? <FileSourceReason>{reason}</FileSourceReason> : null}
        <FileSourceTruth />
        {previewOpen && currentFile ? (
          <div className="fs-preview" role="dialog" aria-modal="true" aria-label={`完整预览：${currentFile.name}`}>
            <div className="fs-preview-box">
              <header className="fs-preview-head">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="fs-preview-t">{truncateFileNameMiddle(currentFile.name, { maxLength: FILE_NAME_BUDGET_CARD })}</div>
                  <span className="fs-preview-s">{currentFile.size} · 预览不改变本次办理里的文件</span>
                </div>
                <button type="button" className="fs-preview-close" onClick={onClosePreview}>关闭</button>
              </header>
              <div className="fs-preview-body">
                <FileContentPreview
                  className="min-h-0 flex-1 rounded-none border-0"
                  fileUrl={currentFile.fileUrl}
                  fileName={currentFile.name}
                  mimeType={currentFile.mimeType}
                  fileId={currentFile.fileId}
                  token={previewToken}
                />
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </QxPageFrame>
  )
}

const FILE_SOURCE_STATUS_TITLE: Record<string, string> = {
  'phone-generating': '正在向服务端要一张上传码',
  'phone-gen-failed': '二维码没生成出来',
  'phone-ready': '用手机对准左边这张码',
  'phone-waiting': '码已经出来了，在等服务端的消息',
  'phone-uploading': '手机正在上传',
  'phone-status-unknown': '会话状态取不到了',
  'phone-expired': '这张上传码过期了',
  'phone-uploaded': '手机传上来一份，等你确认',
  'phone-confirming': '正在确认这份文件',
  'phone-confirm-failed': '确认失败',
  'phone-cancel-requesting': '正在取消这次上传会话',
  'phone-cancel-failed': '这次会话没能取消',
  'phone-cancelled': '这次上传会话已作废',
}

const FILE_SOURCE_ASK_FALLBACK: Record<string, string> = {
  'phone-generating': '还没拿到码，所以这里不先放一张假的图。真实页面画的是服务端下发的一次性链接。',
  'phone-gen-failed': '向服务端要上传会话失败了，所以这里没有码。本机不会先出一张假码再补。',
  'phone-ready': '本机看不到你扫没扫——服务端根本不给这种信号。只有它真收到文件，下面才会变。',
  'phone-waiting': '本机在轮询会话状态。看不到你扫没扫，也不模拟手机端的动作。',
  'phone-uploading': '服务端把这次会话标成 uploading。文件还在路上，没有可确认的百分比。',
  'phone-status-unknown': '本机连着几次问不到这次会话的状态。这不代表码已经失效，也不等于已过期。',
  'phone-expired': '服务端确认这次会话已到期，旧二维码不再接收文件。过期由服务端结果判定。',
  'phone-confirming': '本机正在请服务端把这份文件收进本次办理。结果没回来之前，它还不是当前文件。',
  'phone-confirm-failed': '这份文件没有进入本次办理。可以直接重试确认；还是不行就刷新二维码重新传一次。',
  'phone-cancel-requesting': '本机已经把取消请求发给服务端，答复还没回来。这期间刚才那份文件仍然挂在这次会话上。',
  'phone-cancelled': '服务端确认这次会话已经作废，旧二维码不再接收文件。本次办理里还是没有文件。',
}
