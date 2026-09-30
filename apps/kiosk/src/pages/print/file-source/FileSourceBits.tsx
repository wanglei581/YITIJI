import type { ReactNode } from 'react'
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  FileTextIcon,
  FolderIcon,
  HelpCircleIcon,
  InfoIcon,
  ScanLineIcon,
  SmartphoneIcon,
  UsbIcon,
  XCircleIcon,
} from 'lucide-react'
import { FILE_NAME_BUDGET_CARD, truncateFileNameMiddle } from '../../../lib/fileName'
import type { FileSourceScreen, UploadTab } from './fileSourceModel'
import { FILE_SOURCE_ASK, fileSourceEyebrow } from './fileSourceModel'

export function FileSourceHero({ screen, isResume, doing: doingOverride }: { screen: FileSourceScreen; isResume: boolean; doing?: string }) {
  const ask = FILE_SOURCE_ASK[screen]
  const doing =
    isResume && screen === 'source-chooser'
      ? '这里只是把简历文件搬进来打印，不做 AI 诊断 —— 诊断在简历服务那条线上。'
      : doingOverride ?? ask.doing
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

export function FileSourceNote({ children }: { children: ReactNode }) {
  return (
    <div className="fs-note">
      <span className="sq" aria-hidden="true" />
      <span>{children}</span>
    </div>
  )
}

export function FileSourceSteps({ title, items, row }: { title?: string; items: ReactNode[]; row?: boolean }) {
  return (
    <div>
      {title ? (
        <div className="fs-sec-h fs-steps-h">
          <span className="t">{title}</span>
        </div>
      ) : null}
      <ol className={`fs-steps${row ? ' row' : ''}`}>
        {items.map((item, index) => (
          <li key={index}>
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
    <section className="fs-sec qx-grow">
    <div className="qx-card fs-gcard" data-testid="file-source-file-card" data-live="true">
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
        className="qx-btn fs-pvopen"
        data-variant="ghost"
        onClick={onPreview}
        data-testid="file-source-preview-open"
        aria-label={`打开完整预览：${name}`}
      >
        {previewLabel}
      </button>
      <div className="fs-hr" />
      <div className="fs-notes">
        <FileSourceNote>本次打印<b>只用这一份</b>，其他文件可稍后再办。</FileSourceNote>
        <FileSourceNote>下一步做<b>文档识别与隐私预检</b>，再决定怎样打印。</FileSourceNote>
      </div>
      <FileSourceSteps
        title="检查后再打印"
        items={['识别文件页数。', '提示可能需要遮挡的隐私内容。', '核对参数与价格，带走打印件。']}
        row
      />
    </div>
    </section>
  )
}

const CHANNEL_COPY: Record<UploadTab, { name: string; desc: string; limit: string; tone: 'clay' | 'teal' | 'slate' }> = {
  file: {
    name: '本机选文件',
    desc: '从电脑的文件窗口选一份，选好后开始上传。',
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
    desc: '把 U 盘插右侧 USB 口，屏幕上会列出盘里的文件，直接选。',
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
            ? '这台机器没有开通 U 盘导入，所以这条通道不能用。'
            : key === 'usb' && usbMode === 'offline'
              ? '这台机器读 U 盘的功能装好了，但此刻没连上。和「没开通」不是一回事。'
              : copy.desc
        const limit =
          key === 'usb' && usbMode === 'unavailable'
            ? '本机没开通 · 重试也没用'
            : key === 'usb' && usbMode === 'offline'
              ? '暂时没连上 · 可以重试'
              : copy.limit
        const note =
          key === 'file' ? '电脑文件' : key === 'qr' ? '一体机首选' : usbMode === 'unavailable' ? '暂未开通' : undefined
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
              {key === 'file' ? <span className="fs-tag mut">电脑文件</span> : null}
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
        <span className="hint">{showScan ? '两条真实入口' : '一条真实入口'}</span>
      </div>
      <div className="fs-split">
        {showScan ? (
          <button type="button" className="fs-mini" onClick={onScan} data-testid="file-source-scan-source" aria-label="扫描纸质原件">
            <h4><ScanLineIcon size={22} aria-hidden="true" /><span>扫描纸质原件</span></h4>
            <p>先开始这次扫描，再去<b>奔图操作面板</b>扫描。完成后取得 PDF；屏幕上启动不了扫描仪。</p>
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
    <section className="fs-sec">
      <button type="button" className="fs-mini" onClick={onHelp} data-testid="file-source-help-link" aria-label="联系工作人员">
        <h4><HelpCircleIcon size={22} aria-hidden="true" /><span>卡住了？找人帮忙</span></h4>
        <p>{text}</p>
      </button>
    </section>
  )
}

/** 稿里那种不带动作的小说明卡（「想换一条来源？」「手机那边可以关了」）。 */
export function InfoMini({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="fs-sec">
      <div className="fs-mini" data-static="true">
        <h4>{icon}<span>{title}</span></h4>
        <p>{children}</p>
      </div>
    </section>
  )
}
