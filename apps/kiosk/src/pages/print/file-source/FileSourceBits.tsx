import type { ReactNode } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  FileTextIcon,
  FolderIcon,
  HelpCircleIcon,
  InfoIcon,
  Loader2Icon,
  ScanLineIcon,
  SmartphoneIcon,
  UsbIcon,
  XCircleIcon,
} from 'lucide-react'
import { QxTouchCallout } from '../../../components/qingxu/touch/QxTouchCallout'
import { QxTouchIcon, type QxTouchIconName } from '../../../components/qingxu/touch/QxTouchIcon'
import { QxTouchSlab } from '../../../components/qingxu/touch/QxTouchSlab'
import { FILE_NAME_BUDGET_CARD, truncateFileNameMiddle } from '../../../lib/fileName'
import type { FileSourceScreen, PhoneSessionView, UploadTab } from './fileSourceModel'
import type { UsbImportHold } from '../../../hooks/useUsbImportGate'
import { FILE_SOURCE_ASK, fileSourceEyebrow } from './fileSourceModel'

const USB_HOLD_ASK: Record<UsbImportHold['state'], { lead: string; em: string; tail: string; doing: string }> = {
  loading: { lead: '先确认', em: '能不能用 U 盘', tail: '。', doing: '还没确认前，不读盘，也不列出文件。' },
  blocked: { lead: 'U 盘这条', em: '现在不能用', tail: '。', doing: '原因写在下面。可以改用手机上传。' },
  unknown: { lead: '暂时', em: '确认不了', tail: '。', doing: '读不到开通情况时，不把 U 盘当成能用。' },
}

export function FileSourceHero({
  screen,
  isResume,
  hold = null,
}: {
  screen: FileSourceScreen
  isResume: boolean
  hold?: UsbImportHold['state'] | null
}) {
  const ask = hold ? USB_HOLD_ASK[hold] : FILE_SOURCE_ASK[screen]
  const doing =
    !hold && isResume && screen === 'source-chooser'
      ? '上传已有简历，检查后带走打印件。'
      : ask.doing
  return (
    <section className="fs-hero" data-testid="file-source-hero">
      <div className="fs-hero-row">
        <div className="fs-hero-face" aria-hidden="true">青</div>
        <div className="fs-hero-main">
          <div className="fs-hero-eyebrow">{fileSourceEyebrow(screen)}</div>
          <div className="fs-hero-ask">
            {ask.lead}<em>{ask.em}</em>{ask.tail}
          </div>
          <div className="fs-hero-doing">{doing}</div>
        </div>
      </div>
    </section>
  )
}

export function FileSourceStatus({
  kind,
  title,
  children,
  chips,
  pulsing,
}: {
  kind: 'plain' | 'info' | 'warn' | 'error' | 'lock'
  title: string
  children: ReactNode
  chips?: { tone?: 'ok' | 'warn' | 'bad'; label: string }[]
  pulsing?: boolean
}) {
  const Icon =
    kind === 'error' ? XCircleIcon : kind === 'warn' ? AlertCircleIcon : kind === 'lock' ? InfoIcon : CheckCircle2Icon
  return (
    <div className="qx-card fs-status" data-kind={kind} data-testid="file-source-status">
      <div className="fs-status-h" role="status">
        {pulsing ? <span className="fs-dot breathe" aria-hidden="true" /> : <Icon size={28} aria-hidden="true" />}
        <span>{title}</span>
      </div>
      {typeof children === 'string' ? <div className="fs-status-p">{children}</div> : children}
      {chips && chips.length > 0 ? (
        <div className="fs-chips">
          {chips.map((chip) => (
            <span key={chip.label} className={`fs-chip${chip.tone ? ` ${chip.tone}` : ''}`}>{chip.label}</span>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function UsbImportHoldNotice({ hold }: { hold: UsbImportHold }) {
  if (hold.state === 'loading') {
    return (
      <FileSourceStatus kind="plain" title={hold.note ?? '正在确认本机是否开通 U 盘导入…'} pulsing>
        <div className="fs-status-p">确认完成前不会读取 U 盘，也不会列出文件。</div>
      </FileSourceStatus>
    )
  }
  if (hold.state === 'unknown') {
    return (
      <>
        <FileSourceStatus kind="warn" title="暂时确认不了">
          <div className="fs-status-p">{hold.note}</div>
        </FileSourceStatus>
        <button type="button" className="qx-btn" data-variant="ghost" data-testid="usb-import-retry" onClick={hold.onRetry}>
          重新检查
        </button>
      </>
    )
  }
  return (
    <FileSourceStatus kind="lock" title="U 盘导入现在不能用">
      <div className="fs-status-p">{hold.note}</div>
    </FileSourceStatus>
  )
}

export function FileSourceNote({ children }: { children: ReactNode }) {
  return (
    <div className="fs-note">
      <span className="sq" aria-hidden="true" />
      <span>{children}</span>
    </div>
  )
}

export function FileSourceSteps({ title, items }: { title?: string; items: string[] }) {
  return (
    <div>
      {title ? (
        <div className="fs-sec-h" style={{ marginBottom: 8 }}>
          <span className="t" style={{ fontSize: 'var(--qx-fs-body-lg)' }}>{title}</span>
        </div>
      ) : null}
      <ol className="fs-steps">
        {items.map((item, index) => (
          <li key={item}>
            <span className="n">{index + 1}</span>
            <span>{item}</span>
          </li>
        ))}
      </ol>
    </div>
  )
}

export function FileSourceReason({ children }: { children: ReactNode }) {
  return (
    <div className="fs-reason" data-testid="file-source-disabled-reason">
      <InfoIcon size={22} aria-hidden="true" />
      <span>{children}</span>
    </div>
  )
}

function displayFileName(name: string): string {
  return truncateFileNameMiddle(name, { maxLength: FILE_NAME_BUDGET_CARD })
}

export function FileRow({
  name,
  meta,
  tag,
  tagTone,
  bad,
  on,
  dim,
  mark,
  onClick,
  testId,
}: {
  name: string
  meta: string
  tag: string
  tagTone: 'ok' | 'bad' | 'doing' | 'pickable'
  bad?: boolean
  on?: boolean
  dim?: boolean
  /** 左侧类型字，例如 PDF。不传时仍是文件图标。 */
  mark?: string
  onClick?: () => void
  testId?: string
}) {
  const className = ['fs-frow', on ? 'on' : '', dim ? 'dim' : ''].filter(Boolean).join(' ')
  const inner = (
    <>
      <span className={`fs-f-ic${bad ? ' bad' : ''}`} data-mark={mark || undefined}>{mark ? <b>{mark}</b> : <FileTextIcon size={26} aria-hidden="true" />}</span>
      <span className="fs-f-m">
        <span className="fs-f-n" title={name}>{displayFileName(name)}</span>
        <span className="fs-f-s">{meta}</span>
      </span>
      {tag ? <span className={`fs-f-tag ${tagTone}`}>{tag}</span> : null}
    </>
  )
  if (!onClick) {
    return <div className={className} data-static="true" data-testid={testId}>{inner}</div>
  }
  return (
    <button type="button" className={className} onClick={onClick} data-testid={testId} aria-label={`选择 ${name}（${meta}）`}>
      {inner}
    </button>
  )
}

export function NowFileCard({
  name,
  meta,
  from,
  onPreview,
  onReplace,
  onDelete,
  previewLabel = '打开完整预览 · 逐页看清楚再打印',
}: {
  name: string
  meta: string
  from: string
  onPreview: () => void
  onReplace: () => void
  onDelete: () => void
  previewLabel?: string
}) {
  return (
    <div className="qx-card qx-grow fs-file-work" data-testid="file-source-file-card" data-live="true">
      <div className="fs-now">
        <span className="fs-now-ic"><FileTextIcon size={38} aria-hidden="true" /></span>
        <span className="fs-now-m">
          <span className="fs-now-n" title={name}>{displayFileName(name)}</span>
          <span className="fs-now-s">{meta} · {from}</span>
        </span>
        <span className="fs-now-act">
          <button type="button" className="fs-sbtn" onClick={onReplace} data-testid="file-source-replace" aria-label="更换当前文件">
            更换
          </button>
          <button type="button" className="fs-sbtn warn" onClick={onDelete} data-testid="file-source-delete" aria-label="删除当前文件">
            删除
          </button>
        </span>
      </div>
      <button
        type="button"
        className="qx-btn"
        data-variant="ghost"
        style={{ width: '100%', marginTop: 16 }}
        onClick={onPreview}
        data-testid="file-source-preview-open"
        aria-label={`打开完整预览：${name}`}
      >
        {previewLabel}
      </button>
      <div className="fs-hr" />
      <FileSourceNote>本次办理<b>只带这一份</b>。需要打印其他材料时，完成这一份后再选择。</FileSourceNote>
      <div style={{ marginTop: 10 }}>
        <FileSourceNote>页数、可打印性和敏感信息检查在<b>下一步（材料检查）</b>做，这一页不预告结论。</FileSourceNote>
      </div>
      <FileSourceSteps
        title="检查后再打印"
        items={['识别页数，判断这份能不能按当前参数打。', '扫一遍敏感信息，提示你要不要遮挡。', '都过了才进打印参数设置。']}
      />
    </div>
  )
}

const CHANNEL_COPY: Record<UploadTab, { name: string; desc: string; limit: string; tone: 'clay' | 'teal' | 'slate' }> = {
  file: {
    name: '本机选文件',
    desc: '在这台机器上弹出文件窗口，自己翻着挑一份。公共屏幕上翻自己的文件不方便，一般先用手机扫码。',
    limit: 'PDF / JPG / PNG · 单份 ≤ 15MB',
    tone: 'clay',
  },
  qr: {
    name: '手机扫码上传',
    desc: '不用登录、不用装软件。单份不超过 10MB',
    limit: 'PDF / JPG / PNG · 单份 ≤ 10MB',
    tone: 'teal',
  },
  usb: {
    name: 'U 盘导入',
    desc: '只读根目录，只读取你主动选择的文件',
    limit: 'PDF / JPG / PNG · 单份 ≤ 15MB',
    tone: 'slate',
  },
}

export function ChannelGrid({
  keys,
  active,
  usbMode,
  onSelect,
}: {
  keys: UploadTab[]
  active: UploadTab | null
  usbMode: 'ok' | 'unavailable' | 'offline'
  onSelect: (key: UploadTab) => void
}) {
  return (
    <div className="w2-print-upload-source-grid fs-chs" data-count={keys.length} data-testid="file-source-channels">
      {keys.map((key) => {
        const copy = CHANNEL_COPY[key]
        const disabled = key === 'usb' && usbMode !== 'ok'
        const desc =
          key === 'usb' && usbMode === 'unavailable'
            ? '本机暂未开通 U 盘导入，请改用手机上传。'
            : key === 'usb' && usbMode === 'offline'
              ? '暂时无法读取 U 盘，可以重新连接或改用手机上传。'
              : copy.desc
        const limit =
          key === 'usb' && usbMode === 'unavailable'
            ? '本机暂未开通'
            : key === 'usb' && usbMode === 'offline'
              ? '暂时无法读取 · 可以重试'
              : copy.limit
        const note =
          key === 'file' ? '备用通道' : key === 'qr' ? '一体机首选' : usbMode === 'unavailable' ? '暂未开通' : undefined
        const Icon = key === 'file' ? FolderIcon : key === 'qr' ? SmartphoneIcon : UsbIcon
        return (
          <button
            key={key}
            type="button"
            className={`fs-ch${active === key ? ' on' : ''}`}
            data-testid={`file-source-ch-${key}`}
            aria-label={`${copy.name}（${limit}）`}
            aria-current={active === key ? 'true' : undefined}
            aria-disabled={disabled || undefined}
            disabled={disabled}
            onClick={() => {
              if (!disabled) onSelect(key)
            }}
          >
            <span className="fs-ch-ic" data-tone={copy.tone}><Icon size={32} aria-hidden="true" /></span>
            <span className="fs-ch-n">
              <span>{copy.name}</span>
              {key === 'qr' ? <span className="fs-tag">一体机首选</span> : null}
              {key === 'file' ? <span className="fs-tag mut">备用通道</span> : null}
              {disabled && note ? <span className="fs-tag mut">{note}</span> : null}
            </span>
            <span className="fs-ch-d">{desc}</span>
            <span className="fs-ch-f">{limit}</span>
          </button>
        )
      })}
    </div>
  )
}

export function ExistingSourceLinks({
  showScan,
  onScan,
  onDocuments,
}: {
  showScan: boolean
  onScan: () => void
  onDocuments: () => void
}) {
  return (
    <section className="fs-sec">
      <div className="fs-sec-h">
        <span className="no">02</span>
        <span className="t">文件不在手机或 U 盘？</span>
        <span className="hint">继续准备材料</span>
      </div>
      <div className="fs-split">
        {showScan ? (
          <button type="button" className="fs-mini" onClick={onScan} data-testid="file-source-scan-source" aria-label="扫描纸质原件">
            <h4><ScanLineIcon size={22} aria-hidden="true" /><span>扫描纸质原件</span></h4>
            <p>先开始扫描办理，再去<b>奔图操作面板</b>扫描。完成后取得 PDF；网页不能远程启动扫描仪。</p>
          </button>
        ) : null}
        <button type="button" className="fs-mini" onClick={onDocuments} data-testid="file-source-member-source" aria-label="我的文档 / 最近打印">
          <h4><FileTextIcon size={22} aria-hidden="true" /><span>我的文档 / 最近打印</span></h4>
          <p>登录后查看已保存材料和最近打印文件。进入打印前会重新取得<b>有效访问链接</b>，过期或失败会明确提示。</p>
        </button>
      </div>
    </section>
  )
}

export function HelpMini({ onHelp, text }: { onHelp: () => void; text: string }) {
  return (
    <button type="button" className="fs-mini" onClick={onHelp} data-testid="file-source-help-link" aria-label="使用帮助">
      <h4><HelpCircleIcon size={22} aria-hidden="true" /><span>卡住了？看使用帮助</span></h4>
      <p>{text}</p>
    </button>
  )
}

export function PhoneQrSlot({
  qrUrl,
  loading,
  failed,
  expiresLabel,
  inactive = false,
}: {
  qrUrl: string | null
  loading: boolean
  failed: boolean
  expiresLabel: string
  inactive?: boolean
}) {
  if (inactive) {
    return <div className="fs-qr-blank" data-testid="file-source-qr"><InfoIcon size={38} aria-hidden="true" /><strong>这张上传码已失效</strong><span>旧码不再接收文件，请重新出一张码。</span></div>
  }
  if (qrUrl) {
    return (
      <div className="fs-qr-live" data-testid="file-source-qr">
        <QRCodeSVG value={qrUrl} size={396} level="M" marginSize={1} />
        <span>
          {expiresLabel && !expiresLabel.includes('NaN')
            ? `二维码有效期 ${expiresLabel}。单份不超过 10MB。`
            : '二维码有效期从生成时起算，10 分钟。单份不超过 10MB。'}
        </span>
      </div>
    )
  }
  return (
    <div className="fs-qr-blank" data-testid="file-source-qr">
      {loading ? <Loader2Icon size={36} aria-hidden="true" /> : null}
      <strong>{failed ? '码没出来' : '码还没出来'}</strong>
      <span>
        {failed
          ? '请重新生成二维码，或换一种上传方式。'
          : '正在准备上传二维码，请稍候。'}
      </span>
    </div>
  )
}

export function FileSourceTruth() {
  return (
    <div className="fs-truth" data-testid="file-source-truth">
      <p>结束办理或闲置超时会清除本机临时信息；已上传文件按留存期限管理。</p>
    </div>
  )
}

function SourceCard({
  testId,
  title,
  desc,
  icon,
  disabled = false,
  onClick,
}: {
  testId: string
  title: string
  desc: string
  icon: QxTouchIconName
  disabled?: boolean
  onClick: () => void
}) {
  const slab = (
    <QxTouchSlab
      title={title}
      desc={desc}
      row
      off={disabled}
      visual={<QxTouchIcon name={icon} size={64} />}
      onClick={disabled ? undefined : onClick}
    />
  )
  return (
    <div className="fs-ch" data-testid={testId}>
      {disabled ? (
        <button type="button" className="fs-touch-hit" disabled>
          {slab}
        </button>
      ) : slab}
    </div>
  )
}

export function SourceEntry({
  screen,
  showFileChannel,
  showScan,
  usbMode,
  wordText,
  miniappLine,
  onSelectChannel,
  onScan,
  onDocuments,
}: {
  screen: FileSourceScreen
  showFileChannel: boolean
  showScan: boolean
  usbMode: 'ok' | 'unavailable' | 'offline'
  wordText: string
  miniappLine: string
  onSelectChannel: (key: UploadTab) => void
  onScan: () => void
  onDocuments: () => void
}) {
  const usbDesc =
    usbMode === 'unavailable'
      ? '本机暂未开通 U 盘导入，请改用手机上传。'
      : usbMode === 'offline'
        ? '暂时无法读取 U 盘，可以重新连接或改用手机上传。'
        : CHANNEL_COPY.usb.desc
  const count = 2 + (showScan ? 1 : 0) + (showFileChannel ? 1 : 0)
  return (
    <>
      {screen === 'missing-file' ? (
        <QxTouchCallout kind="howto">这一步没有文件。请重新选一种方式，不会替你挑一份。</QxTouchCallout>
      ) : null}
      {screen === 'unknown' ? (
        <QxTouchCallout kind="remind" icon="alert">请重新选择文件从哪里来。</QxTouchCallout>
      ) : null}
      <div className="w2-print-upload-source-grid fs-chs" data-count={count} data-testid="file-source-channels">
        <SourceCard
          testId="file-source-ch-qr"
          title={CHANNEL_COPY.qr.name}
          desc={CHANNEL_COPY.qr.desc}
          icon="phone"
          onClick={() => onSelectChannel('qr')}
        />
        <SourceCard
          testId="file-source-ch-usb"
          title={CHANNEL_COPY.usb.name}
          desc={usbDesc}
          icon="usb"
          disabled={usbMode !== 'ok'}
          onClick={() => onSelectChannel('usb')}
        />
        {showScan ? (
          <SourceCard
            testId="file-source-scan-source"
            title="是纸质的 · 放到打印机上扫描"
            desc="扫描纸质原件，扫成 PDF 后可以存、可以打。"
            icon="scan"
            onClick={onScan}
          />
        ) : null}
        {showFileChannel ? (
          <SourceCard
            testId="file-source-ch-file"
            title={CHANNEL_COPY.file.name}
            desc={CHANNEL_COPY.file.desc}
            icon="folder"
            onClick={() => onSelectChannel('file')}
          />
        ) : null}
      </div>
      <button
        type="button"
        className="fs-doc-row"
        data-testid="file-source-member-source"
        aria-label="我的文档 / 最近打印"
        onClick={onDocuments}
      >
        <QxTouchIcon name="folder" size={36} />
        <span>
          <b>我的文档</b>
          {miniappLine ? <small>{miniappLine}</small> : null}
        </span>
      </button>
      <div className="fs-formats">
        <div><b>PDF</b><span>.pdf</span></div>
        <div><b>图片</b><span>.jpg .png</span></div>
        <div><b>Word</b><span>{wordText}</span></div>
      </div>
      <p className="fs-size-line">手机上传不超过 10MB · U 盘不超过 15MB</p>
      <p className="fs-cloud">第三方网盘尚未接入。公共终端不做网盘授权登录。</p>
    </>
  )
}

const PHONE_STEPS = [
  { title: '扫码', detail: '相机或微信' },
  { title: '在手机上选文件、点上传', detail: 'PDF、JPG、PNG' },
  { title: '回到这台机器点确认', detail: '确认前不会进入下一步' },
] as const

export function PhoneBoard({
  screen,
  phone,
  qrUrl,
  expiresLabel,
  channelKeys,
  usbMode,
  helpText,
  actions,
  onSelectChannel,
}: {
  screen: FileSourceScreen
  phone: PhoneSessionView
  qrUrl: string | null
  expiresLabel: string
  channelKeys: UploadTab[]
  usbMode: 'ok' | 'unavailable' | 'offline'
  helpText: string
  actions?: ReactNode
  onSelectChannel: (key: UploadTab) => void
}) {
  const received = ['phone-uploaded', 'phone-confirming', 'phone-confirm-failed', 'phone-cancel-requesting', 'phone-cancel-failed'].includes(screen)
  const showQr = !received
  const waiting = screen === 'phone-ready' || screen === 'phone-waiting' || screen === 'phone-generating' || screen === 'phone-uploading'
  return (
    <>
      {showQr ? (
        <PhoneQrSlot
          qrUrl={qrUrl}
          loading={phone.loading}
          failed={screen === 'phone-gen-failed'}
          expiresLabel={expiresLabel}
          inactive={screen === 'phone-expired' || screen === 'phone-cancelled'}
        />
      ) : null}
      {waiting ? (
        <div className="qxt-steps fs-phone-steps">
          {PHONE_STEPS.map((step, index) => (
            <div className="qxt-step" key={step.title}>
              <span className="qxt-step-n">{index + 1}</span>
              <b>{step.title}</b>
              <small>{step.detail}</small>
            </div>
          ))}
        </div>
      ) : null}
      {waiting ? <p className="fs-wait">等你在手机上传文件 · 传好后会显示在下面，再点确认</p> : null}
      {screen === 'phone-status-unknown' ? (
        <QxTouchCallout kind="remind" icon="alert">暂时查不到结果，不代表二维码已经过期。可以再查一次，或重新出一张码。</QxTouchCallout>
      ) : null}
      {screen === 'phone-expired' || screen === 'phone-cancelled' ? (
        <QxTouchCallout kind="howto">重新出码会建立新的上传，旧码不再收文件。</QxTouchCallout>
      ) : null}
      {screen === 'phone-gen-failed' ? (
        <div className="qxt-reason-box">
          <h4><QxTouchIcon name="alert" size={30} />没传上来</h4>
          <p className="qxt-reason">还没有收到文件，可以重新生成二维码或换一种上传方式。</p>
        </div>
      ) : null}
      {phone.pendingName ? (
        <FileRow
          name={phone.pendingName}
          meta={`${phone.pendingSize ?? ''} · 手机扫码上传`}
          tag=""
          tagTone="doing"
          testId="file-source-phone-file"
        />
      ) : null}
      {received ? (
        <p className="fs-wait">
          {screen === 'phone-uploaded'
            ? '系统已收到，等你确认'
            : screen === 'phone-confirming'
              ? '确认结果回来前，这份还没有进入本次办理。'
              : screen === 'phone-confirm-failed'
                ? '确认失败，当前文件仍然是空的。'
                : screen === 'phone-cancel-requesting'
                  ? '取消结果回来前，这份仍然挂着，不说已经作废。'
                  : '取消没有确认成功，这份仍留着等你决定。'}
        </p>
      ) : waiting && !phone.pendingName ? (
        <p className="fs-placeholder">传好的文件会出现在这里</p>
      ) : null}
      {screen === 'phone-uploaded' ? (
        <QxTouchCallout kind="fine">请核对文件名和大小。在这台机器上确认后，才能继续材料检查。确认前它还不是当前文件。</QxTouchCallout>
      ) : null}
      {screen === 'phone-cancel-failed' ? (
        <QxTouchCallout kind="remind" icon="alert">取消未成功，旧二维码可能仍有效。可以重试取消，或确认使用这份文件。</QxTouchCallout>
      ) : null}
      {screen === 'phone-uploading' ? (
        <QxTouchCallout kind="fine">请保持手机上传页面打开，传完后回来确认文件。本机看不到你扫没扫，只认系统收到文件。</QxTouchCallout>
      ) : null}
      {waiting && screen !== 'phone-uploading' ? (
        <QxTouchCallout kind="fine">本机看不到你扫没扫，只认系统收到文件。</QxTouchCallout>
      ) : null}
      {screen === 'phone-cancelled' || screen === 'phone-generating' || screen === 'phone-gen-failed' ? (
        <ChannelGrid keys={channelKeys} active={screen === 'phone-cancelled' ? 'qr' : null} usbMode={usbMode} onSelect={onSelectChannel} />
      ) : null}
      {actions}
      {helpText ? <QxTouchCallout kind="remind">{helpText}</QxTouchCallout> : null}
    </>
  )
}

export function UsbPickBoard({
  screen,
  files,
  selected,
  driveLabel,
  formatBytes,
  onSelect,
  onRescan,
}: {
  screen: FileSourceScreen
  files: { safeId: string; filename: string; sizeBytes: number }[] | null
  selected: { safeId: string; filename: string; sizeBytes: number } | null
  driveLabel: string | null
  formatBytes: (bytes: number) => string
  onSelect: (safeId: string) => void
  onRescan: () => void
}) {
  const known = screen === 'usb-list' && files !== null
  return (
    <>
      {screen === 'usb-list' ? (
        <div className="fs-usb-head">
          <b>{known ? `U 盘根目录里能用的文件（${files.length} 个）` : '还没读到 U 盘里的文件。'}</b>
          <button type="button" className="fs-touch-btn" data-testid="file-source-refresh" onClick={onRescan}>重新检测</button>
        </div>
      ) : null}
      {known
        ? (
          <div className="fs-usb-list">
            {files.map((item) => {
              const ext = item.filename.split('.').pop()?.replace(/[^a-zA-Z0-9]/g, '').slice(0, 4).toUpperCase()
              return (
                <FileRow
                  key={item.safeId}
                  name={item.filename}
                  meta={formatBytes(item.sizeBytes)}
                  tag=""
                  tagTone="pickable"
                  mark={ext || '文件'}
                  on={selected?.safeId === item.safeId}
                  onClick={() => onSelect(item.safeId)}
                  testId={`file-source-usb-file-${item.safeId}`}
                />
              )
            })}
          </div>
        )
        : null}
      {selected && screen !== 'usb-list' ? (
        <FileRow
          name={selected.filename}
          meta={`${formatBytes(selected.sizeBytes)}${driveLabel ? ` · ${driveLabel}` : ''}`}
          tag=""
          tagTone={screen === 'usb-importing' ? 'doing' : 'ok'}
          on={screen === 'usb-selected'}
          bad={screen === 'usb-import-failed' || screen === 'usb-safeid-expired'}
          dim={screen === 'usb-safeid-expired'}
          testId="file-source-selected-file"
        />
      ) : null}
      {screen === 'usb-importing' ? (
        <>
          <p className="fs-wait">正在导入选中的文件，请暂时不要拔出 U 盘。</p>
          <p className="fs-wait">系统确认保存之前，当前文件仍然是空的。这期间别拔 U 盘。</p>
        </>
      ) : null}
      {screen === 'usb-selected' ? (
        <QxTouchCallout kind="fine">只导入这一份，U 盘上其它文件不会被读走。导入完成前它还不是当前文件。</QxTouchCallout>
      ) : null}
      {screen === 'usb-list' ? (
        <QxTouchCallout kind="fine">一次只选一份。还没选定之前，导入按钮按住不放。只列根目录，不进子文件夹。</QxTouchCallout>
      ) : null}
      {screen === 'usb-import-failed' || screen === 'usb-safeid-expired' ? (
        <QxTouchCallout kind="remind" icon="alert">当前文件仍然是空的。重新读一次 U 盘后，在新列表里再选一份。</QxTouchCallout>
      ) : null}
    </>
  )
}

export function RejectBoard({
  reason,
  name,
  meta,
  extra,
  onRetry,
  actions,
  helpText,
  fileTestId,
}: {
  reason: string
  name: string | null
  meta: string | null
  extra?: string | null
  onRetry: () => void
  actions?: ReactNode
  helpText?: string
  fileTestId?: string
}) {
  return (
    <>
      {name ? (
        <div className="qxt-file qxt-rise" data-testid={fileTestId}>
          <span className="qxt-file-badge">未上传</span>
          <div>
            <b>{name}</b>
            <small>{meta ?? '大小未取得'}</small>
          </div>
        </div>
      ) : (
        <QxTouchCallout kind="howto" icon="alert">当前文件仍然是空的。</QxTouchCallout>
      )}
      <div className="qxt-reason-box qxt-rise">
        <h4><QxTouchIcon name="alert" size={30} />没传上来</h4>
        <p className="qxt-reason">{reason}</p>
      </div>
      <QxTouchSlab
        title="重新传"
        desc="再送一次。系统确认收到之前，当前文件仍然是空的。"
        row
        compact
        takeStyle="plain"
        take="重新传"
        visual={<QxTouchIcon name="file" size={48} />}
        onClick={onRetry}
      />
      {actions}
      {extra ? <QxTouchCallout kind="fine">{extra}</QxTouchCallout> : null}
      {helpText ? <QxTouchCallout kind="remind">{helpText}</QxTouchCallout> : null}
    </>
  )
}
