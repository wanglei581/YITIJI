import type { ReactNode, Ref } from 'react'
import { PrintAiHelp } from '../components/PrintAiHelp'
import { FileTextIcon, SparklesIcon } from 'lucide-react'
import { QxAppNavbar } from '../../../components/qingxu/QxAppNavbar'
import { QxPageFrame } from '../../../components/qingxu/QxPageFrame'
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
  ExistingSourceLinks,
  FileRow,
  FileSourceHero,
  FileSourceNote,
  UsbImportHoldNotice,
  FileSourceReason,
  FileSourceStatus,
  FileSourceSteps,
  FileSourceTruth,
  HelpMini,
  NowFileCard,
  PhoneQrSlot,
} from './FileSourceBits'
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
  if (screen === 'phone-uploaded') return '确认使用这份文件'
  if (screen === 'phone-confirm-failed') return '重试确认'
  if (screen === 'phone-cancel-failed') return '重试取消'
  if (screen === 'usb-unavailable') return '改用手机扫码上传'
  if (screen === 'usb-agent-offline') return '重新连接 U 盘'
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
  if (screen === 'local-guide' || screen === 'local-picking') return '还没选文件，材料检查按住不放'
  if (screen.startsWith('local-')) return '当前文件仍然是空的，材料检查按住不放'
  if (screen.startsWith('phone-')) return '这一步还没有当前文件，材料检查按住不放'
  if (screen.startsWith('usb-')) return '还没导入文件，材料检查按住不放'
  if (primaryEnabled(screen)) return null
  return '这一步还没有文件，材料检查按住不放'
}

export function FileSourceView(props: FileSourceViewProps) {
  const {
    screen, pageTitle, pageSubtitle, terminalLabel, status, orderPausedNotice, isResumePrint,
    showFileChannel, showScan, tab, usbMode, usbHold = null, usbSwitchAllowed = true, currentFile, blockedName, blockedMeta,
    wordHint, usbFiles, usbSelected, usbDriveLabel, formatBytes, phone, qrUrl, expiresLabel,
    previewOpen, previewToken, onSelectChannel, onOpenPicker, onRetryLocal, onNext, onExit, onBack,
    onHelp, onScan, onDocuments, onResumes, onPreview, onClosePreview, onReplace, onDelete,
    onUsbSelect, onUsbImport, onUsbRescan, onPhoneRefresh, onPhoneConfirm, onPhoneCancel,
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
    secondary = ghost('重新读一次盘', onUsbRescan, 'file-source-refresh')
  } else if (screen === 'usb-selected') {
    secondary = ghost('回列表重选', onUsbRescan, 'file-source-back-list')
  } else if (screen === 'local-uploading' || screen === 'usb-importing') {
    secondary = ghost('退出 · 回打印扫描', onExit, 'file-source-exit')
  } else {
    secondary = ghost('退出 · 回打印扫描', onExit, 'file-source-exit')
  }

  const usbHoldActive = tab === 'usb' ? usbHold : null
  if (usbHoldActive) secondary = ghost('退出 · 回打印扫描', onExit, 'file-source-exit')

  const enabled = usbHoldActive ? usbHoldActive.state !== 'loading' : primaryEnabled(screen)
  const reason = usbHoldActive
    ? (usbHoldActive.state === 'loading' ? '确认完成前先不读 U 盘' : null)
    : disabledReason(screen)
  const primaryText = usbHoldActive
    ? (usbHoldActive.state === 'loading' ? '确认后再选文件' : '改用手机扫码上传')
    : primaryLabel(screen, isResumePrint)
  const ctabar = previewOpen ? undefined : (
    <div className="fs-bottom"><div className="print-upload-footer" data-testid="file-source-ctabar">
      {secondary}
      <button
        type="button"
        className="qx-btn"
        data-variant="primary"
        disabled={!enabled}
        aria-disabled={!enabled || undefined}
        onClick={() => {
          if (usbHoldActive) {
            if (usbHoldActive.state !== 'loading') onSelectChannel('qr')
            return
          }
          handlePrimary()
        }}
        data-testid="file-source-primary"
        aria-label={enabled ? primaryText : `${primaryText}（${reason ?? '还没有文件'}）`}
      >
        {primaryText}
      </button>
    </div>
      <div className="fs-actions">
        <button type="button" onClick={onBack}>上一步</button>
        <PrintAiHelp label="问小青：这份文件怎么检查 →" draft="这份文件要怎么检查？检查会看哪些内容？" />
      </div>
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
      <PhoneQrSlot
        qrUrl={qrUrl}
        loading={phone.loading}
        failed={screen === 'phone-gen-failed'}
        expiresLabel={expiresLabel}
        inactive={screen === 'phone-expired' || screen === 'phone-cancelled'}
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
              <span className="hint">{screen === 'source-chooser' ? '选一条，下面跟着换' : '选择适合你的方式'}</span>
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
            <div className="qx-card fs-file-work" style={{ flex: 1 }}>
              <div className="fs-sec-h">
                <span className="t" style={{ fontSize: 'var(--qx-fs-body-lg)' }}>当前文件</span>
                <span className="hint">0 份</span>
              </div>
              <FileSourceNote>还没有文件。选择一种方式上传，收到后文件名会出现在这里。</FileSourceNote>
              <FileSourceSteps title="搬进来之后" items={['检查文件格式和大小。', '文件名和大小显示在这一栏。', '下一步「材料检查」才会亮起来。']} />
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
          <FileSourceStatus kind="plain" title={screen === 'local-cancelled' ? '你取消了文件窗口' : '本机选文件：备用通道'} chips={[{ label: 'PDF / JPG / PNG' }, { label: '单份 ≤ 15MB' }]}>
            <div className="fs-status-p">
              {screen === 'local-cancelled'
                ? '这一屏只对应一种情况：系统文件窗口被关掉，上传还没开始。所以这一步还是没有文件，也没有产生任何上传。'
                : '这条会弹出系统文件窗口。一体机上不推荐先用它——系统窗口会盖住流程，公共屏幕也不该暴露本机目录。手机和 U 盘都不方便时再用这条，单份 ≤ 15MB。'}
            </div>
          </FileSourceStatus>
          <section className="fs-sec qx-grow">
            <div className="qx-card fs-file-work" style={{ flex: 1 }}>
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
      body = (
        <>
          <FileSourceStatus
            kind={screen === 'local-oversize' ? 'warn' : 'error'}
            title={screen === 'local-rejected' ? '这份格式不收' : screen === 'local-oversize' ? '这份超过 15MB' : '这份读不出来'}
            chips={[{ tone: 'bad', label: screen === 'local-oversize' ? '本机 / U 盘 ≤ 15MB' : '未上传' }]}
          >
            <div className="fs-status-p">
              {screen === 'local-rejected'
                ? '支持 PDF、JPG、PNG；Word 需本机开通转换。这一份未能上传。'
                : screen === 'local-oversize'
                  ? '本机与 U 盘通道单份上限 15MB，这一份没有被上传。'
                  : '文件为空或者大小取不到，不会硬着头皮上传一份连大小都读不出的东西。'}
            </div>
          </FileSourceStatus>
          <section className="fs-sec qx-grow">
            <div className="qx-card fs-file-work" style={{ flex: 1 }}>
              {blockedName ? (
                <FileRow name={blockedName} meta={blockedMeta ?? ''} tag={screen === 'local-oversize' ? '超过 15MB' : screen === 'local-rejected' ? '格式不收' : '读不出来'} tagTone="bad" bad testId="file-source-blocked-file" />
              ) : null}
              <div className="fs-empty">
                <span className="fs-empty-ic"><FileTextIcon size={38} aria-hidden="true" /></span>
                <span>当前文件仍然是<b>空的</b>。<br />回到窗口再挑一份合规的就能接着走。</span>
              </div>
              <FileSourceSteps title="挑一份能收的" items={['PDF 最稳，排版不容易变。', '手机照片选 JPG / PNG。', '单份控制在 15MB 以内。']} />
              <FileSourceNote>{wordHint}</FileSourceNote>
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
                : [{ tone: 'bad', label: '尚未收到' }]
            }
          >
            <div className="fs-status-p">
              {screen === 'local-uploading'
                ? '正在上传这份文件，请稍候。完成前无法继续材料检查。'
                : '还没有收到这一份文件。可以重试刚才选择的文件。'}
            </div>
          </FileSourceStatus>
          <section className="fs-sec qx-grow">
            <div className="qx-card fs-file-work" style={{ flex: 1 }}>
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
                <span>收到文件之前，<b>当前文件仍然是空的</b>。{screen === 'local-upload-failed' ? '重试仍失败时，换手机扫码这条通道。' : '结果由系统返回，这一页没有取消上传动作。'}</span>
              </div>
              <FileSourceSteps title={screen === 'local-uploading' ? '接下来只有三种结果' : '重试会怎么走'} items={screen === 'local-uploading' ? ['成功：系统确认保存，文件成为当前文件。', '失败：没有确认收到，可以直接重试。', '一直没结束：叫工作人员来看。'] : ['仍用刚才挑的那一份。', '把这一份重新送一次。', '收到后显示在当前文件里。']} />
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
            chips={phone.status ? [{ label: phoneStatusLabel(phone.status) }] : undefined}
          >
            <div className="fs-status-p">
              {screen === 'phone-uploaded'
                ? '请核对文件名和大小；在这台机器上确认后，才能继续材料检查。'
                : screen === 'phone-cancel-failed'
                  ? '取消未成功，旧二维码可能仍有效。可以重试取消，或确认使用这份文件。'
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
            <div className="qx-card fs-file-work" style={{ flex: 1 }}>
              {phone.pendingName ? (
                <FileRow
                  name={phone.pendingName}
                  meta={`${phone.pendingSize ?? ''} · 手机扫码上传`}
                  tag={screen === 'phone-uploaded' ? '待确认' : screen === 'phone-confirm-failed' ? '确认失败' : screen === 'phone-cancel-failed' ? '仍待确认' : '处理中'}
                  tagTone={screen === 'phone-confirm-failed' ? 'bad' : 'doing'}
                  testId="file-source-phone-file"
                />
              ) : null}
              {phone.pendingName && ['phone-uploaded', 'phone-confirming', 'phone-confirm-failed', 'phone-cancel-requesting', 'phone-cancel-failed'].includes(screen) ? (
                <><div className="fs-empty"><span className="fs-empty-ic"><FileTextIcon size={38} aria-hidden="true" /></span><span>{screen === 'phone-uploaded' ? '确认这一下要你在这台机器上点；确认前它还不是当前文件。' : screen === 'phone-confirming' ? '确认结果回来前，这份还没有进入本次办理。' : screen === 'phone-cancel-requesting' ? '取消结果回来前，这份仍然挂着，不说已经作废。' : screen === 'phone-cancel-failed' ? '取消没有确认成功，这份仍留着等你决定。' : '确认失败，当前文件仍然是空的。'}</span></div><FileSourceSteps title="接下来怎么走" items={screen.includes('cancel') ? ['系统答复之前不作废这份文件。', '没取消成功，可以重试或回去确认。', '两条路都不会凭空多出一份文件。'] : ['本机确认后才收进本次办理。', '成为当前文件后，手机上传页可以关了。', '下一步材料检查才会放行。']} /></>
              ) : <div className="fs-phone-guide">{phonePanel}<div><FileSourceSteps title={screen === 'phone-expired' ? '这张已经不能用了' : screen === 'phone-cancelled' ? '再来一次也行' : '扫码 → 选文件 → 上传'} items={['手机打开相机或微信扫一扫。', '选择 PDF / JPG / PNG，单份 ≤ 10MB。', '系统收到后，回来这台机器确认。']} /><FileSourceNote>{screen === 'phone-status-unknown' ? '查询失败不等于已过期；可以再查一次，或重新出码。' : screen === 'phone-expired' || screen === 'phone-cancelled' ? '重新出码会建立新的上传，旧码不再收文件。' : '本机看不到你扫没扫，只认系统收到文件。'}</FileSourceNote></div></div>}
            </div>
          </section>
          {screen === 'phone-generating' || screen === 'phone-gen-failed' ? switchRow : null}
          {screen === 'phone-generating' || screen === 'phone-gen-failed' ? null : (
            <div className="fs-mini" data-static="true">
              <h4>卡住了？找人帮忙</h4>
              <p>扫码、确认或取消一直没结果时，可以叫现场工作人员来看看。</p>
            </div>
          )}
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
                : screen === 'usb-agent-offline' ? '暂时无法读取 U 盘'
                  : screen === 'usb-wait' ? '把 U 盘插进右侧 USB 口'
                    : screen === 'usb-detecting' ? '正在读 U 盘'
                      : screen === 'usb-empty' ? '这个 U 盘里没有能用的文件'
                        : '读 U 盘失败'
            }
            pulsing={screen === 'usb-detecting'}
          >
            <div className="fs-status-p">
              {screen === 'usb-unavailable'
                ? '本机暂未开通 U 盘导入，请改用手机上传或联系工作人员。'
                : screen === 'usb-agent-offline'
                  ? '暂时无法读取 U 盘。可以重新连接，或改用手机上传。'
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
            <div className="qx-card"><FileSourceSteps title={screen === 'usb-empty' ? '对号入座' : '重试是安全的'} items={screen === 'usb-empty' ? ['Word 另存为 PDF，再放到 U 盘最外层。', '不进入子文件夹，请把文件移到最外层。', '单份超过 15MB 时，降低分辨率再导出。'] : ['重新插入 U 盘，或换一个 USB 口。', '重新读取最外层文件，不改动盘上内容。', '仍没有结果时，换手机上传或联系工作人员。']} /></div>
          ) : null}
          {screen === 'usb-unavailable' || screen === 'usb-agent-offline' || screen === 'usb-empty' || screen === 'usb-read-failed' ? (
            <section className="fs-sec">
              <ChannelGrid keys={channelKeys} active={null} usbMode={usbMode} onSelect={onSelectChannel} />
            </section>
          ) : (
            <section className="fs-sec qx-grow">
              <div className="qx-card fs-file-work" style={{ flex: 1 }}>
                <FileSourceSteps
                  title="插上之后会发生什么"
                  items={['检测已插入的 U 盘。', '列出根目录里可打印的 PDF / JPG / PNG。', '选择一份文件，再点「导入这一份」。']}
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
    case 'usb-import-failed':
      body = (
        <>
          <FileSourceStatus
            kind={screen === 'usb-import-failed' || screen === 'usb-safeid-expired' ? (screen === 'usb-import-failed' ? 'error' : 'warn') : screen === 'usb-importing' ? 'info' : 'plain'}
            title={
              screen === 'usb-selected' ? '选中了这一份，还没导入'
                : screen === 'usb-safeid-expired' ? '请重新选择这份文件'
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
                  ? '正在导入选中的文件，请暂时不要拔出 U 盘。'
                  : '重新读盘后，请从最新列表选择要打印的文件。'}
            </div>
          </FileSourceStatus>
          <section className="fs-sec qx-grow">
            <div className="qx-card fs-file-work" style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
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
                  tag={screen === 'usb-importing' ? '导入中' : screen === 'usb-import-failed' ? '导入失败' : screen === 'usb-safeid-expired' ? '需要重选' : '已选中'}
                  tagTone={screen === 'usb-importing' ? 'doing' : screen === 'usb-selected' ? 'ok' : 'bad'}
                  bad={screen !== 'usb-selected' && screen !== 'usb-importing'}
                  on={screen === 'usb-selected'}
                  dim={screen === 'usb-safeid-expired'}
                  testId="file-source-selected-file"
                />
              ) : null}
              <div className="fs-empty"><span>{screen === 'usb-list' ? '一次只选一份，再点导入。' : screen === 'usb-selected' ? '只选中了这一份，还没有上传任何东西。' : screen === 'usb-importing' ? '系统确认保存之前，当前文件仍然是空的。这期间别拔 U 盘。' : '当前文件仍然是空的。重新读盘，在新列表里再选一份。'}</span></div>
              <FileSourceSteps title={screen === 'usb-importing' ? '导入完成之后' : screen === 'usb-list' || screen === 'usb-selected' ? '选中之后会怎样' : '重新读盘之后'} items={['从最新列表选择一份文件。', '导入后系统校验并保存这一份。', '系统确认收到后，才能进入材料检查。']} />
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
        data-state={usbHoldActive ? 'usb-hold' : screen}
        data-usb-gate={usbHoldActive?.state}
        data-testid={usbHoldActive ? 'file-source-state-usb-hold' : `file-source-state-${screen}`}
      >
        <FileSourceHero screen={screen} isResume={isResumePrint} hold={usbHoldActive?.state ?? null} />
        <div className="fs-flow" aria-label="打印流程">
          <span aria-current="step">1 选文件</span><span>2 材料检查</span><span>3 预览与参数</span><span>4 核对价格</span>
        </div>
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
        {usbHoldActive ? <UsbImportHoldNotice hold={usbHoldActive} /> : body}
        {reason && !previewOpen ? <FileSourceReason>{reason}</FileSourceReason> : null}
        <FileSourceTruth />
        {previewOpen && currentFile ? (
          <PrintFilePreviewModal file={currentFile} token={previewToken} onClose={onClosePreview} />
        ) : null}
      </div>
    </QxPageFrame>
  )
}

function phoneStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: '等待手机上传', uploading: '手机正在上传', uploaded: '已上传，待确认',
    confirmed: '已确认文件', expired: '二维码已过期', cancelled: '上传已取消',
  }
  return labels[status] ?? '上传状态待确认'
}

const FILE_SOURCE_STATUS_TITLE: Record<string, string> = {
  'phone-generating': '正在生成上传二维码', 'phone-gen-failed': '二维码没生成出来',
  'phone-ready': '用手机扫描下方二维码', 'phone-waiting': '正在等待手机上传',
  'phone-uploading': '手机正在上传', 'phone-status-unknown': '暂时查不到上传状态',
  'phone-expired': '这张上传码过期了', 'phone-uploaded': '手机传上来一份，等你确认',
  'phone-confirming': '正在确认这份文件', 'phone-confirm-failed': '确认失败',
  'phone-cancel-requesting': '正在取消这次上传', 'phone-cancel-failed': '这次上传没能取消',
  'phone-cancelled': '这次上传已取消',
}

const FILE_SOURCE_ASK_FALLBACK: Record<string, string> = {
  'phone-generating': '二维码生成后，用手机相机或微信扫一扫打开上传页。',
  'phone-gen-failed': '还没有收到文件，可以重新生成二维码或换一种上传方式。',
  'phone-ready': '扫码选文件并上传；收到后，这里会出现文件名，请回来确认。',
  'phone-waiting': '手机上传完成后，这里会出现文件名。扫描二维码本身不会改变文件状态。',
  'phone-uploading': '请保持手机上传页面打开，传完后回来确认文件。',
  'phone-status-unknown': '暂时查不到结果，不代表二维码已经过期。可以重试查询或重新生成。',
  'phone-expired': '旧二维码不再接收文件。请重新生成二维码，再次上传。',
  'phone-confirming': '正在确认使用这份文件，完成后才能继续材料检查。',
  'phone-confirm-failed': '文件尚未进入本次办理。请重试确认，或重新生成二维码上传。',
  'phone-cancel-requesting': '取消结果尚未返回，请稍候。',
  'phone-cancelled': '旧二维码已失效。可以重新生成二维码，或换一种上传方式。',
}
