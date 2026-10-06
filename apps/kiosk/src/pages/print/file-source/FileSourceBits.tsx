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
import { FILE_NAME_BUDGET_CARD, truncateFileNameMiddle } from '../../../lib/fileName'
import type { FileSourceScreen, UploadTab } from './fileSourceModel'
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
  onClick?: () => void
  testId?: string
}) {
  const className = ['fs-frow', on ? 'on' : '', dim ? 'dim' : ''].filter(Boolean).join(' ')
  const inner = (
    <>
      <span className={`fs-f-ic${bad ? ' bad' : ''}`}><FileTextIcon size={26} aria-hidden="true" /></span>
      <span className="fs-f-m">
        <span className="fs-f-n" title={name}>{displayFileName(name)}</span>
        <span className="fs-f-s">{meta}</span>
      </span>
      <span className={`fs-f-tag ${tagTone}`}>{tag}</span>
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
    desc: '手机扫屏幕上的码，打开上传页选文件。不用登录，也不用装软件。',
    limit: 'PDF / JPG / PNG · 单份 ≤ 10MB',
    tone: 'teal',
  },
  usb: {
    name: 'U 盘导入',
    desc: '插右侧 USB 口，本地服务列出根目录里的文件，你在屏幕上选。',
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
        <button type="button" className="fs-mini" onClick={onDocuments} data-testid="file-source-member-source" aria-label="从我的文档或最近打印文件选择">
          <h4><FileTextIcon size={22} aria-hidden="true" /><span>我的文档 / 最近打印</span></h4>
          <p>登录后查看已保存材料和最近打印文件。进入打印前会重新取得<b>有效访问链接</b>，过期或失败会明确提示。</p>
        </button>
      </div>
    </section>
  )
}

export function HelpMini({ onHelp, text }: { onHelp: () => void; text: string }) {
  return (
    <button type="button" className="fs-mini" onClick={onHelp} data-testid="file-source-help-link" aria-label="问小青">
      <h4><HelpCircleIcon size={22} aria-hidden="true" /><span>问小青</span></h4>
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
    return <div className="fs-qr-blank"><InfoIcon size={38} aria-hidden="true" /><strong>这张上传码已失效</strong><span>旧码不再接收文件，请重新出一张码。</span></div>
  }
  if (qrUrl) {
    return (
      <div className="fs-qr-live" data-testid="file-source-qr">
        <QRCodeSVG value={qrUrl} size={396} level="M" marginSize={1} />
        <span>
          {expiresLabel
            ? `二维码有效期 ${expiresLabel}，文件最大 10MB。`
            : '文件最大 10MB，请上传后回到这里确认。'}
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
