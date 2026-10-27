import type { ReactNode } from 'react'
import { COMPLIANCE_COPY } from '@ai-job-print/shared'
import { FileContentPreview } from '../../../components/FileContentPreview'
import { QxTouchIcon, type QxTouchIconName } from '../../../components/qingxu/touch/QxTouchIcon'
import { KIOSK_DEVICE_ORIGINAL_NOTICE } from '../../../utils/kioskLocalPrivacy'
import { WORD_CONVERSION_DISCLOSURE } from '../../../services/api/documentConversion'
import { UploadSessionQrPanel, type PhoneUploadedFile } from '../../upload/components/UploadSessionQrPanel'
import { ResumeUsbImportPanel, type ResumeUsbImportedFile, type ResumeUsbPick } from '../components/ResumeUsbImportPanel'
import { ResumeScanReady } from '../components/ResumeScanReady'
import type { UsbImportGate } from '../../../hooks/useUsbImportGate'
import { PhoneArt } from './ResumeTouchArt'
import './source.css'

export type SourceChannel = 'usb' | 'cloud' | 'phone'
export type StagedFile = {
  name: string
  size: string
  format: string
  fileId: string
  fileUrl?: string
  mimeType?: string
  channelLabel: string
}

const SOURCE_CARDS: Array<{ key: 'phone' | 'usb' | 'paper'; icon: QxTouchIconName; title: string; desc: string }> = [
  { key: 'phone', icon: 'phone', title: '在手机里', desc: '用手机扫码选择简历文件，再回到一体机确认' },
  { key: 'usb', icon: 'usb', title: '在 U 盘里', desc: '从已插入的 U 盘里选一份。只读取你点的那份' },
  { key: 'paper', icon: 'scan', title: '是纸质的', desc: '在打印机面板上扫描，存成 PDF' },
]

const DIAGNOSIS_EXTRA = ['风险表述提醒', '修改优先级建议']

/** 文件类型小标：PDF / JPG / PNG，按格式（或 MIME）取色。 */
function badgeOf(formatOrMime: string): { text: string; kind: 'pdf' | 'img' | 'doc' } {
  const f = formatOrMime.toLowerCase()
  if (f.includes('pdf')) return { text: 'PDF', kind: 'pdf' }
  if (f.includes('word') || f.includes('doc')) return { text: 'DOC', kind: 'doc' }
  if (f.includes('jpeg') || f.includes('jpg')) return { text: 'JPG', kind: 'img' }
  if (f.includes('png')) return { text: 'PNG', kind: 'img' }
  return { text: f.replace(/^image\//, '').toUpperCase().slice(0, 4) || 'FILE', kind: 'img' }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * 简历来源页的「简历在哪」一步（稿 resume-src / upload / usb）。
 * 只排版：上传、U 盘、扫描交接、预览与错误都是运行页原来的逻辑，由来源页传进来。
 */
export function ResumeSourceWhere(props: {
  kiosk: boolean
  selected: SourceChannel
  sourceBusy: boolean
  usbScreen: boolean
  file: StagedFile | null
  scanReady: boolean
  loggedIn: boolean
  uploading: boolean
  error: string | null
  uploadUnknown: boolean
  /** 未知结果后「建议这样做」那句：登录与否说法不同，由页面按身份决定。 */
  unknownNext: string
  phoneCancelled: boolean
  phoneReceived: { filename: string; sizeBytes: number; mimeType: string } | null
  phoneConfirmRef: { current: (() => void) | null }
  onPhoneReceived: (file: { filename: string; sizeBytes: number; mimeType: string } | null) => void
  wordConversionAvailable: boolean
  supportedFormats: string[]
  dimensions: string[]
  intentIsOptimize: boolean
  intentPrivacy: string
  usbGate: UsbImportGate
  token: string | null
  onPickPhone: () => void
  onPickUsb: () => void
  onPickCloud: () => void
  onPaper: () => void
  onPhoneUploaded: (file: PhoneUploadedFile) => void
  onPhoneBusy: (busy: boolean) => void
  onPhoneCancelled: () => void
  onNewScan: () => void
  onUsbUploaded: (file: ResumeUsbImportedFile) => void
  onUsbBusy: (busy: boolean) => void
  onUsbListed: (count: number) => void
  onUsbPick: (pick: ResumeUsbPick) => void
  onDropScan: () => void
  onRescan: () => void
  onChangeFile: () => void
  onUploadBox: () => void
  onLogin: () => void
  onMine: () => void
  onGenerate: () => void
  onPrintOnly: () => void
}) {
  const { file } = props
  const cloudSelected = props.selected === 'cloud'

  const sources = (
    <div className="qxt-srcs" role="group" aria-label="选择简历来源">
      {SOURCE_CARDS.map((card) => {
        const pressed = card.key === 'phone' ? props.selected === 'phone' : card.key === 'usb' ? props.selected === 'usb' : false
        const onClick = card.key === 'phone' ? props.onPickPhone : card.key === 'usb' ? props.onPickUsb : props.onPaper
        return (
          <button key={card.key} type="button" className="qxt-src" aria-pressed={pressed} disabled={card.key !== 'paper' && props.sourceBusy} onClick={onClick}>
            <span className="qxt-ico"><QxTouchIcon name={card.icon} size={40} strokeWidth={2} /></span>
            <b>{card.title}</b>
            <small>{card.desc}</small>
          </button>
        )
      })}
      {!props.kiosk ? (
        <button type="button" className="qxt-src" aria-pressed={cloudSelected} disabled={props.sourceBusy} onClick={props.onPickCloud}>
          <span className="qxt-ico"><QxTouchIcon name="file" size={40} strokeWidth={2} /></span>
          <b>本机文件</b>
          <small>选择云盘同步目录或本机下载目录中的简历文件</small>
        </button>
      ) : null}
    </div>
  )

  let panel: ReactNode
  if (props.scanReady && file) {
    panel = (
      <ResumeScanReady name={file.name} size={file.size} format={file.format} onDrop={props.onDropScan} onRescan={props.onRescan} />
    )
  } else if (file) {
    const badge = badgeOf(file.format)
    panel = (
      <>
        <div className="qxt-filecard" role="status">
          <span className="qxt-ft" data-kind={badge.kind}>{badge.text}</span>
          <span className="qxt-fx"><b>{file.name}</b><small>{file.size} · {file.format.toUpperCase()} · {file.channelLabel}</small></span>
          <span className="qxt-fb">待你确认</span>
        </div>
        <button type="button" className="qxt-ghost resume-change-file" disabled={props.sourceBusy} onClick={props.onChangeFile}>更换文件</button>
        <details className="qx-rt-preview">
          <summary>预览原件</summary>
          <FileContentPreview compact fileUrl={file.fileUrl} fileName={file.name} mimeType={file.mimeType} format={file.format} fileId={file.fileId} token={props.token} />
        </details>
      </>
    )
  } else if (props.selected === 'phone' && props.phoneCancelled) {
    panel = (
      <div className="qxt-cancel" role="status">
        <PhoneArt width={120} />
        <div>
          <b>这次扫码已取消</b>
          <p>这张码已经作废。文件还没到这台机器，可以再出一张码。</p>
          <button type="button" className="qxt-usb-pri" onClick={props.onNewScan}>再出一张码</button>
        </div>
      </div>
    )
  } else if (props.selected === 'phone') {
    panel = (
      <div className="resume-source-phone-session" data-phone-session="">
        <UploadSessionQrPanel
          confirmLabel="确认使用这份文件"
          onUploaded={props.onPhoneUploaded}
          onBusyChange={props.onPhoneBusy}
          onCancelled={props.onPhoneCancelled}
          onReceivedChange={props.onPhoneReceived}
          confirmRef={props.phoneConfirmRef}
          busyWhen="received"
        />
        <ol className="qxt-steps3" aria-label="怎么把文件传过来">
          <li><span className="n">1</span><b>扫码</b></li>
          <li><span className="n">2</span><b>在手机上选文件、点上传</b></li>
          <li><span className="n">3</span><b>回到这台机器点确认</b></li>
        </ol>
        {props.phoneReceived ? (
          <div className="qxt-drop qxt-got" role="status">
            <span className="qxt-ft" data-kind={badgeOf(props.phoneReceived.mimeType).kind}>{badgeOf(props.phoneReceived.mimeType).text}</span>
            <span className="qxt-fx"><b>{props.phoneReceived.filename}</b><small>{formatBytes(props.phoneReceived.sizeBytes)} · 手机已传上来，等你确认</small></span>
          </div>
        ) : (
          <div className="qxt-drop" role="status"><QxTouchIcon name="file" size={36} strokeWidth={1.8} /><span>传过来的文件会出现在这里</span></div>
        )}
      </div>
    )
  } else if (props.selected === 'usb') {
    panel = (
      <div className="qxt-usbwrap">
        <ResumeUsbImportPanel unattended gate={props.usbGate} onUploaded={props.onUsbUploaded} onBusyChange={props.onUsbBusy} onListed={props.onUsbListed} onPickChange={props.onUsbPick} />
      </div>
    )
  } else {
    panel = (
      <button type="button" disabled={props.sourceBusy} onClick={props.onUploadBox} className="qx-rt-dropzone">
        <strong>点击上传文件</strong>
        <span>{props.wordConversionAvailable ? '支持 PDF、DOC、DOCX 和图片格式，单个文件最大 10MB' : '支持 PDF / 图片格式，单个文件最大 10MB'}</span>
      </button>
    )
  }

  return (
    <>
      {props.usbScreen ? null : sources}
      <div className="qxt-panel" data-panel={props.usbScreen ? 'usb-list' : props.scanReady ? 'scan' : file ? 'file' : props.selected}>
        {panel}
        {props.error ? <p className="resume-source-error qxt-src-note" data-tone="error" role="alert">{props.error}</p> : null}
        {props.uploadUnknown ? (
          <>
            <p className="resume-source-unknown qxt-src-note" data-tone="warn" role="status">
              <b>结果未知</b>暂时无法确认这一份有没有传上去。本页不会自动再传，也不会用之前那份文件继续。
            </p>
            <dl className="qxt-kv">
              <div><dt>发生了什么</dt><dd>上传过程中网络或服务出了问题，这台机器没能确认上传是否完成。</dd></div>
              <div><dt>还不确定的</dt><dd>这份文件可能已经传上去了，也可能没有。</dd></div>
              <div><dt>再传一次</dt><dd>可以重新选择文件再传；如果刚才那次其实已经传上去，会多出一份重复文件。</dd></div>
              <div><dt>建议这样做</dt><dd data-testid="resume-source-unknown-next">{props.unknownNext}</dd></div>
            </dl>
          </>
        ) : null}
        {props.uploading ? <p className="resume-source-status qxt-src-note" role="status">上传中，请稍候…</p> : null}
      </div>

      {props.loggedIn ? (
        <button type="button" className="qxt-link" onClick={props.onMine}>
          <QxTouchIcon name="user" size={28} strokeWidth={2} />
          <span>保存过的简历在『我的简历』里看</span>
          <QxTouchIcon name="chevR" size={28} strokeWidth={2.2} />
        </button>
      ) : (
        <button type="button" className="qxt-link" onClick={props.onLogin}>
          <QxTouchIcon name="user" size={28} strokeWidth={2} />
          <span>当前未登录 · 这次按临时上传处理 · 去登录</span>
          <QxTouchIcon name="chevR" size={28} strokeWidth={2.2} />
        </button>
      )}
      <div className="qxt-links">
        <button type="button" onClick={props.onGenerate}>没有电子简历？让 AI 帮你写一份</button>
        <button type="button" onClick={props.onPrintOnly}>只想打印原件</button>
      </div>

      {props.scanReady ? null : (
        <p id="resume-word-conversion-reason" className="qxt-fine" aria-disabled={!props.wordConversionAvailable || undefined}>
          {props.wordConversionAvailable
            ? `Word ${WORD_CONVERSION_DISCLOSURE}。`
            : props.usbScreen
              ? 'Word 转换暂未开放，请另存为 PDF 再上传。读不出来可以换一个 USB 口，或者改用手机传。'
              : 'Word 转换暂未开放，请另存为 PDF 再上传。'}
        </p>
      )}
      <section className="qx-rt-dims qxt-dims">
        <details>
          <summary>
            <span>{props.intentIsOptimize ? '优化前将先完成以下诊断(必要步骤)' : '诊断报告包含以下内容'}</span>
            <small>{props.dimensions.length} 项 · 点击展开</small>
          </summary>
          <div className="qxt-dim-grid">
            {props.dimensions.map((item) => (
              <span key={item} className="qx-rt-dim" data-extra={DIAGNOSIS_EXTRA.includes(item) ? 'true' : undefined}>{item}</span>
            ))}
          </div>
        </details>
      </section>
      <p className="qxt-fine">报告按六个维度分别给出建议。系统不会编造「超过多少人」「必然提分」等无法验证的结论。</p>
      <footer className="qxt-truth">
        <p><b>格式</b>只收 {props.supportedFormats.join(' / ')}，单份不超过 10MB；U 盘通道只列 PDF / JPG / PNG。</p>
        <p className="resume-source-privacy"><b>用途 · 隐私</b>{props.intentPrivacy}{COMPLIANCE_COPY.KIOSK_RESUME_UPLOAD_PRIVACY}</p>
        <p><b>留存</b>{KIOSK_DEVICE_ORIGINAL_NOTICE}</p>
      </footer>
    </>
  )
}
