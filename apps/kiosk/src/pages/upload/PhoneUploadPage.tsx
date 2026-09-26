import './phone-upload-service-desk.css'
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import {
  BanIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleHelpIcon,
  FileTextIcon,
  HourglassIcon,
  InfoIcon,
  LoaderCircleIcon,
  MonitorIcon,
  ShieldCheckIcon,
  Trash2Icon,
  UploadIcon,
  type LucideIcon,
} from 'lucide-react'
import { uploadPhoneSessionFile, uploadSessionUserMessage } from '../../services/api/uploadSessions'
import {
  useDocumentConversionCapabilities,
  WORD_CONVERSION_DISCLOSURE,
  WORD_CONVERSION_UNAVAILABLE_COPY,
} from '../../services/api/documentConversion'
import {
  type FactRow,
  type IconKey,
  type PickedFile,
  type PickerMode,
  type SessionPurpose,
  type Tone,
  type TypeIssue,
  type UploadState,
  SESSION_PURPOSES,
  UPLOAD_STEPS,
  chromeCopy,
  classifyUploadError,
  extLabel,
  extOf,
  formatSize,
  genericPolicy,
  isSessionPurpose,
  linkIssueOf,
  pickerCopy,
  precheck,
  receiptOf,
  retainFacts,
  takeoverCopy,
  uploadView,
} from './phoneUploadModel'

/* 手机上传（/upload/phone）。视觉与口径真值：稿 51-phone-relay.html screen=phone-upload。
 * 手机端只有 fragment 里的 sessionId / token / purpose：purpose 可被随手改掉，只作未确认提示；
 * 真实用途、去向与留存只认上传成功回执。成功只等于「系统已收到」，文件没有到过一体机，要回一体机确认才会被使用。 */

const BASE_RESUME_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp'
const BASE_PRINT_DOC_ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png'
const WORD_ACCEPT = '.doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document'

interface PhoneUploadPurposeConfig {
  noun: string
  label: string
  /** 服务端按用途放行的格式（Word 只在转换能力为真时才放）。上传前本页只用三者的交集，不按 URL 里的用途放宽。 */
  accept: string
  /** 只在回执确认用途之后才写的留存时长（retention-policy.ts）。 */
  retain: string
}

const PHONE_UPLOAD_PURPOSES = (wordConversionAvailable: boolean): Readonly<Record<SessionPurpose, PhoneUploadPurposeConfig>> => ({
  resume_upload: {
    noun: '简历文件',
    label: '简历上传',
    accept: wordConversionAvailable ? `${BASE_RESUME_ACCEPT},${WORD_ACCEPT}` : BASE_RESUME_ACCEPT,
    retain: '确认之后：已登录会员按简历类默认保存 **90 天**，可在一体机「我的文档」里改；未登录的临时上传按系统短期留存（**1 小时**）。',
  },
  print_doc: {
    noun: '打印文件',
    label: '打印文件上传',
    accept: wordConversionAvailable ? `${BASE_PRINT_DOC_ACCEPT},${WORD_ACCEPT}` : BASE_PRINT_DOC_ACCEPT,
    retain: '确认之后：按系统短期留存（**24 小时**）。打印完成不代表立刻删除，也不会长期留着。',
  },
  contract_upload: {
    noun: '合同文件',
    label: '合同上传',
    accept: wordConversionAvailable ? `${BASE_RESUME_ACCEPT},${WORD_ACCEPT}` : BASE_RESUME_ACCEPT,
    retain: '确认之后：固定保留 **2 小时**，从你上传的那一刻起算，确认动作不会重置也不会延长；这一档由系统锁定，本人也改不了。',
  },
})

interface Session {
  /** 本会话对应的链接；地址栏换了链接，整份结论作废重来。 */
  link: string
  state: UploadState
  file: PickedFile | null
  typeIssue: TypeIssue
  /** 只来自上传成功回执里的 purpose。 */
  confirmed: SessionPurpose | null
  /** 服务端明确拒收时的公共安全说明（uploadSessionUserMessage 只回中文，从不带错误码）。 */
  serverNote: string
}

function initialSession(link: string): Session {
  return { link, state: 'idle', file: null, typeIssue: null, confirmed: null, serverNote: '' }
}

const ICONS: Record<IconKey, LucideIcon> = {
  alert: CircleAlertIcon, ban: BanIcon, check: CircleCheckIcon, help: CircleHelpIcon, info: InfoIcon,
  loader: LoaderCircleIcon, shield: ShieldCheckIcon, upload: UploadIcon, wait: HourglassIcon,
}

function Icon({ name }: { name: IconKey }) {
  const Glyph = ICONS[name]
  return <Glyph aria-hidden="true" />
}

/** 文案里的 **xx** 渲染成加粗；其余一律按纯文本输出。 */
function Rich({ text }: { text: string }) {
  return <>{text.split('**').map((part, index) => (index % 2 ? <b key={index}>{part}</b> : <Fragment key={index}>{part}</Fragment>))}</>
}

function noteIcon(tone: Tone, calm: IconKey): IconKey {
  return tone === 'error' ? 'alert' : tone === 'warn' ? 'help' : tone === 'ok' ? 'check' : calm
}

function Facts({ rows }: { rows: readonly FactRow[] }) {
  return (
    <dl className="ph-up-facts">
      {rows.map(([key, value]) => (
        <div key={key}><dt>{key}</dt><dd><Rich text={value} /></dd></div>
      ))}
    </dl>
  )
}

function FileBox({ file, removable, note, onRemove }: {
  file: PickedFile | null
  removable: boolean
  note: { tone: Tone; text: string } | null
  onRemove: () => void
}) {
  return (
    <section className="ph-up-filebox">
      <div className="ph-up-fb-head">本次文件<span>{file ? '1 个 · 上限 1 个' : '0 个'}</span></div>
      {file ? (
        <div className="ph-up-file">
          <span className="ph-up-file-icon"><FileTextIcon aria-hidden="true" /></span>
          <span className="ph-up-file-meta"><b>{file.name}</b><small>{formatSize(file.size)} · {extLabel(file.ext)}</small></span>
          <button type="button" className="ph-up-remove" aria-disabled={!removable || undefined} aria-label={removable ? '移除已选择的文件' : '当前不能移除这个文件'} onClick={() => { if (removable) onRemove() }}>
            <Trash2Icon aria-hidden="true" />
          </button>
        </div>
      ) : (
        <div className="ph-up-empty">尚未选择文件</div>
      )}
      {note && (
        <p className="ph-up-note" data-tone={note.tone}><Icon name={noteIcon(note.tone, 'info')} /><span><Rich text={note.text} /></span></p>
      )}
    </section>
  )
}

export function PhoneUploadPage() {
  const location = useLocation()
  const { capabilities: conversionCapabilities, loading: conversionLoading } = useDocumentConversionCapabilities()
  const purposes = PHONE_UPLOAD_PURPOSES(conversionCapabilities.wordToPdf)
  const hashParams = useMemo(() => new URLSearchParams(location.hash.replace(/^#/, '')), [location.hash])
  const sessionId = hashParams.get('sessionId')?.trim() ?? ''
  const uploadToken = hashParams.get('token')?.trim() ?? ''
  const purposeHint = hashParams.get('purpose')?.trim() ?? ''
  const issue = linkIssueOf(sessionId, uploadToken, purposeHint)
  const ready = issue === null
  const hinted = isSessionPurpose(purposeHint) ? purposes[purposeHint] : null
  const policy = genericPolicy(SESSION_PURPOSES.map((purpose) => purposes[purpose].accept))

  const linkKey = `${sessionId}\n${uploadToken}`
  const [s, setS] = useState<Session>(() => initialSession(linkKey))
  // 同一页面实例里换了链接：文件、结论与用途都属于旧链接，整份丢掉。
  if (s.link !== linkKey) setS(initialSession(linkKey))
  const attemptRef = useRef(0)
  const flowRef = useRef<HTMLDivElement>(null)

  // 换态即回到顶部：结论、原因与下一步先落在首屏。
  useEffect(() => {
    flowRef.current?.scrollTo({ top: 0 })
  }, [s.state, issue])

  const confirmed = s.confirmed ? purposes[s.confirmed] : null
  const view = s.state !== 'success'
    ? uploadView(s.state, { file: s.file, typeIssue: s.typeIssue, unknownType: Boolean(s.file && !s.file.type), chips: policy.chips })
    : null
  const canPick = ready && view?.picker === 'ready'
  const chrome = chromeCopy(issue, s.state, confirmed?.label ?? null)
  const takeover = issue ? takeoverCopy(issue) : null
  const chipsText = policy.chips.join(' / ')
  const formatsNote = conversionCapabilities.wordToPdf
    ? `在系统核对用途之前，本页只放行 **${chipsText}**；Word ${WORD_CONVERSION_DISCLOSURE}。要传其他格式，请回一体机按那一步屏幕上的说明操作。`
    : conversionLoading
      ? `在系统核对用途之前，本页只放行 **${chipsText}**；Word 能否转换还在确认，确认之前本页不发送 Word。`
      : `在系统核对用途之前，本页只放行 **${chipsText}**。${WORD_CONVERSION_UNAVAILABLE_COPY}；要传其他格式，请回一体机按那一步屏幕上的说明操作。`

  const uploadFile = async (file: File, picked: PickedFile) => {
    const attempt = ++attemptRef.current
    const owner = linkKey
    // 回执只落回发出它的那次尝试与那条链接；换链接或离开后才到的回执一律丢弃。
    const land = (update: (prev: Session) => Session) => {
      if (attempt === attemptRef.current) setS((prev) => (prev.link === owner ? update(prev) : prev))
    }
    setS((prev) => ({ ...prev, state: 'uploading', file: picked, typeIssue: null, serverNote: '' }))
    try {
      const receipt = receiptOf(await uploadPhoneSessionFile({ sessionId, uploadToken, file }))
      // 回执不是 uploaded 就不能说「已收到」：没有结论，按结果未知处理。
      land((prev) => (receipt.received ? { ...prev, state: 'success', confirmed: receipt.purpose } : { ...prev, state: 'outcome-unknown' }))
    } catch (error) {
      const failure = classifyUploadError(error)
      land((prev) => ({ ...prev, state: failure, serverNote: failure === 'service-error' ? uploadSessionUserMessage(error, '') : '' }))
    }
  }

  const pickFile = (file: File | undefined) => {
    if (!file || !canPick) return
    const picked: PickedFile = { name: file.name, size: file.size, ext: extOf(file.name), type: file.type || '' }
    const blocked = precheck(picked, policy)
    if (blocked) {
      // 预检拦下的文件一个字节都不发出去。
      setS((prev) => ({ ...prev, state: blocked.state, file: picked, typeIssue: blocked.typeIssue, serverNote: '' }))
      return
    }
    void uploadFile(file, picked)
  }

  const removeFile = () => setS((prev) => ({ ...prev, state: 'idle', file: null, typeIssue: null, serverNote: '' }))

  const renderPicker = (mode: PickerMode) => {
    const copy = pickerCopy(mode, policy.chips)
    const off = mode !== 'ready'
    return (
      <label
        className="ph-up-picker"
        data-mode={mode}
        aria-disabled={off || undefined}
        onDragOver={(event) => { if (!off) event.preventDefault() }}
        onDrop={(event) => { event.preventDefault(); pickFile(event.dataTransfer.files?.[0]) }}
      >
        <input
          type="file"
          className="ph-up-file-input"
          accept={policy.accept}
          aria-label="选择要上传的文件"
          disabled={off}
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            pickFile(file)
          }}
        />
        <span className="ph-up-picker-ic"><Icon name={copy.icon} /></span>
        <b>{copy.head}</b>
        <span className="ph-up-hint"><Rich text={copy.hint} /></span>
        <span className="ph-up-pill" aria-hidden="true">{copy.pill}</span>
      </label>
    )
  }

  return (
    <main className="fusion-w5 fusion-w5--auth k1-phone-upload service-desk" data-kiosk-screen="phone-upload" data-visual-theme="service-desk" data-ux-density="touch" data-kiosk-presentation="fusion-youth" data-kiosk-viewport="mobile" data-phone-upload-state={issue ?? s.state} data-purpose={s.confirmed ?? 'unconfirmed'} data-purpose-confirmed={s.confirmed ? '1' : '0'}>
      <section className="k1-phone-upload-content">
        <header className="ph-up-relaybar">
          <span className="ph-up-seal" aria-hidden="true">职</span>
          <div className="ph-up-brand">
            <strong>职易达</strong>
            <small>{chrome.sub}</small>
          </div>
          <span className="ph-up-tag">{chrome.tag}</span>
        </header>
        <div className="ph-up-wave" aria-hidden="true" />

        <div className="ph-up-flow" ref={flowRef}>
          {!ready ? (
            <section className={issue === 'invalid' ? 'ph-up-takeover phone-upload-invalid' : 'ph-up-takeover'}>
              {takeover && (
                <>
                  <section className="ph-up-statecard" data-kind={takeover.kind} role="status">
                    <span className="ph-up-glyph"><Icon name={takeover.icon} /></span>
                    <h1>{takeover.head}</h1>
                    <p>{takeover.body}</p>
                  </section>
                  <div className="ph-up-grow" />
                  <Facts rows={takeover.facts} />
                </>
              )}
            </section>
          ) : (
            <>
              {view ? (
                <>
                  <p className="ph-up-target">
                    <MonitorIcon aria-hidden="true" />
                    <span>
                      这份文件用于一体机发起的这一次上传。具体是哪一步、允许哪些格式、留多久，以系统对这次上传的核对结果为准。
                      {hinted && <span className="ph-up-unsure">链接里写着这次可能是「{hinted.label}」。本页无法核对这句话，也不按它决定任何事。</span>}
                    </span>
                  </p>
                  {!view.facts && (
                    <ol className="ph-up-steps" aria-label="手机上传的三步">
                      {UPLOAD_STEPS.map((step, index) => (
                        <li key={step}><span className="ph-up-step-no" aria-hidden="true">{index + 1}</span><span>{step}</span></li>
                      ))}
                    </ol>
                  )}
                  {renderPicker(view.picker)}
                  <FileBox file={s.file} removable={view.removable} note={view.fileNote} onRemove={removeFile} />
                  {view.chips && (
                    <>
                      <div className="ph-up-sect">现在能发送的格式</div>
                      <div className="ph-up-chips">{policy.chips.map((chip) => <span key={chip} className="ph-up-chip">{chip}</span>)}</div>
                    </>
                  )}
                  <section className="ph-up-progress" role="status">
                    <div className="ph-up-pg-head"><b>{view.progress.head}</b><span>{view.progress.right}</span></div>
                    <div className="ph-up-track"><i data-fill={view.progress.fill} /></div>
                    <p className="ph-up-note" data-tone={view.progress.tone}>
                      <Icon name={noteIcon(view.progress.tone, 'shield')} />
                      <span><Rich text={view.progress.note} /></span>
                    </p>
                    {s.state === 'service-error' && s.serverNote && <p className="ph-up-server-note">系统说明：{s.serverNote}</p>}
                  </section>
                  <div className="ph-up-grow" />
                  <Facts rows={view.facts ?? retainFacts(null, formatsNote)} />
                </>
              ) : (
                <>
                  <section className="ph-up-done" role="status">
                    <span className="ph-up-done-glyph"><CircleCheckIcon aria-hidden="true" /></span>
                    <h1>已收到</h1>
                    <span>系统已收到这份文件，请回一体机确认使用。手机这一页可以关掉了。</span>
                  </section>
                  {confirmed && (
                    <p className="ph-up-notice" role="status"><InfoIcon aria-hidden="true" /><span>系统核对后确认：这次上传用于<b>{confirmed.label}</b>。</span></p>
                  )}
                  <FileBox file={s.file} removable={false} note={{ tone: 'ok', text: '它**尚未进入本次任务**，也没有开始打印或简历处理；是否使用由你在一体机上确认。' }} onRemove={removeFile} />
                  <div className="ph-up-grow" />
                  <Facts rows={retainFacts(confirmed?.retain ?? null, formatsNote)} />
                </>
              )}
            </>
          )}
        </div>

        <p className="ph-up-footer">
          <Icon name={chrome.icon} />
          <span>{chrome.foot}</span>
        </p>
      </section>
    </main>
  )
}
