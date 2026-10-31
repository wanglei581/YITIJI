import type { ReactNode } from 'react'
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  FileTextIcon,
  FolderIcon,
  HelpCircleIcon,
  InfoIcon,
  SmartphoneIcon,
  UsbIcon,
  XCircleIcon,
} from 'lucide-react'
import { QxTouchCallout } from '../../../components/qingxu/touch/QxTouchCallout'
import { QxTouchIcon, type QxTouchIconName } from '../../../components/qingxu/touch/QxTouchIcon'
import { QxTouchSlab } from '../../../components/qingxu/touch/QxTouchSlab'
import { PrintArt } from '../art/PrintArt'
import { displayFileName, type FileSourceScreen, type UploadTab } from './fileSourceModel'
import type { UsbImportHold } from '../../../hooks/useUsbImportGate'

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
    <div className="qx-card fs-file-work" data-testid="file-source-file-card" data-live="true">
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

export function HelpMini({ onHelp, text }: { onHelp: () => void; text: string }) {
  return (
    <button type="button" className="fs-mini" onClick={onHelp} data-testid="file-source-help-link" aria-label="使用帮助">
      <h4><HelpCircleIcon size={22} aria-hidden="true" /><span>卡住了？看使用帮助</span></h4>
      <p>{text}</p>
    </button>
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
  art,
  disabled = false,
  onClick,
}: {
  testId: string
  title: string
  desc: string
  icon: QxTouchIconName
  /** 稿里的实物小样：手机 / U 盘 / 扫描件。没有就退回图标（本机选文件）。 */
  art?: 'phone' | 'usb' | 'scan-paper'
  disabled?: boolean
  onClick: () => void
}) {
  const slab = (
    <QxTouchSlab
      title={title}
      desc={desc}
      row
      off={disabled}
      visual={art ? <PrintArt name={art} size={art === 'phone' ? 78 : 120} /> : <QxTouchIcon name={icon} size={64} />}
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
  usbHold = null,
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
  /** 令牌在、后台没放行时的说明（useUsbImportGate）。只有 blocked 才把这一项置灰：读不到或还在读，留着可点，进去由 U 盘页说明。 */
  usbHold?: UsbImportHold | null
  wordText: string
  miniappLine: string
  onSelectChannel: (key: UploadTab) => void
  onScan: () => void
  onDocuments: () => void
}) {
  // 后台把 U 盘导入配成维护中、测试中、不支持、未验收时，这一项和「本机暂未开通」一样先置灰、写清原因，
  // 不等人点进去才被挡回来（走查 I-13）。
  const usbBlocked = usbMode === 'ok' && usbHold?.state === 'blocked'
  const usbOff = usbMode !== 'ok' || usbBlocked
  const usbDesc =
    usbMode === 'unavailable'
      ? '本机暂未开通 U 盘导入，请改用手机上传。'
      : usbBlocked
        ? `${(usbHold?.note ?? '本机暂未开通').replace(/[。.]$/, '')}，请改用手机上传。`
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
          art="phone"
          onClick={() => onSelectChannel('qr')}
        />
        <SourceCard
          testId="file-source-ch-usb"
          title={CHANNEL_COPY.usb.name}
          desc={usbDesc}
          icon="usb"
          art="usb"
          disabled={usbOff}
          onClick={() => onSelectChannel('usb')}
        />
        {showScan ? (
          <SourceCard
            testId="file-source-scan-source"
            title="是纸质的 · 放到打印机上扫描"
            desc="扫描纸质原件，扫成 PDF 后可以存、可以打。"
            icon="scan"
            art="scan-paper"
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
        className="qxt-rowlink fs-doc-row"
        data-testid="file-source-member-source"
        aria-label="我的文档 / 最近打印"
        onClick={onDocuments}
      >
        <QxTouchIcon name="folder" size={32} strokeWidth={2} />
        <span>
          <b>我的文档</b>
          {miniappLine ? <small>{miniappLine}</small> : null}
        </span>
        <span className="qxt-chev"><QxTouchIcon name="chevR" size={28} strokeWidth={2.2} /></span>
      </button>
      <div className="fs-fmt">
        <div className="fs-fmt-t">能打印的文件</div>
        <div className="fs-fmt-row">
          <div><b>PDF</b><span>.pdf</span></div>
          <div><b>图片</b><span>.jpg .png</span></div>
          <div className="no"><b>Word</b><span>{wordText}</span></div>
        </div>
        <small>手机上传不超过 10MB · U 盘不超过 15MB</small>
      </div>
      <p className="fs-cloud">第三方网盘尚未接入。公共终端不做网盘授权登录。</p>
    </>
  )
}
