import './phone-upload-service-desk.css'
import { useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import {
  AlertCircleIcon,
  CheckCircleIcon,
  FileTextIcon,
  Loader2Icon,
  MonitorIcon,
  ShieldCheckIcon,
  Trash2Icon,
  UploadCloudIcon,
} from 'lucide-react'
import { uploadPhoneSessionFile, uploadSessionUserMessage } from '../../services/api/uploadSessions'

const RESUME_ACCEPT = '.pdf,.doc,.docx,.jpg,.jpeg,.png,.webp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,image/webp'
const PRINT_DOC_ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png'
const MAX_BYTES = 10 * 1024 * 1024

type UploadState = 'idle' | 'uploading' | 'success' | 'error'

interface PhoneUploadPurposeConfig {
  noun: string
  accept: string
  helper: string
}

const PHONE_UPLOAD_PURPOSES: Readonly<Record<string, PhoneUploadPurposeConfig>> = {
  resume_upload: {
    noun: '简历文件',
    accept: RESUME_ACCEPT,
    helper: '简历支持 PDF / Word / JPG / PNG / WEBP；单个最大 10MB，选择后自动上传',
  },
  print_doc: {
    noun: '打印文件',
    accept: PRINT_DOC_ACCEPT,
    helper: '打印支持 PDF / JPG / PNG；单个最大 10MB，选择后自动上传',
  },
  signature_image: {
    noun: '签名或印章图片',
    accept: '.jpg,.jpeg,.png,image/jpeg,image/png',
    helper: '支持 JPG / PNG；单个最大 10MB，选择后自动上传',
  },
  contract_upload: {
    noun: '合同文件',
    accept: RESUME_ACCEPT,
    helper: '合同支持 PDF / Word / JPG / PNG / WEBP；单个最大 10MB，选择后自动上传',
  },
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function fileFormat(file: File): string {
  const name = file.name.toLowerCase()
  if (name.endsWith('.pdf')) return 'PDF'
  if (name.endsWith('.doc') || name.endsWith('.docx')) return 'Word'
  if (name.endsWith('.png')) return 'PNG'
  if (name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'JPG'
  if (name.endsWith('.webp')) return 'WEBP'
  return '文件'
}

export function PhoneUploadPage() {
  const location = useLocation()
  const hashParams = useMemo(() => new URLSearchParams(location.hash.replace(/^#/, '')), [location.hash])
  const sessionId = hashParams.get('sessionId')?.trim() ?? ''
  const uploadToken = hashParams.get('token')?.trim() ?? ''
  const purpose = hashParams.get('purpose')?.trim() ?? ''
  const purposeConfig = PHONE_UPLOAD_PURPOSES[purpose]
  const [state, setState] = useState<UploadState>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [fileLabel, setFileLabel] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  const fileNoun = purposeConfig?.noun ?? '文件'
  const ready = Boolean(sessionId && uploadToken && purposeConfig)
  const pageTitle = useMemo(() => {
    if (!ready) return '上传链接无效'
    if (state === 'success') return '上传完成'
    if (state === 'error') return '上传遇到问题'
    return `上传${fileNoun}`
  }, [fileNoun, ready, state])

  const uploadFile = async (file: File) => {
    if (!ready) {
      setState('error')
      setMessage('上传链接无效或用途不受支持，请回到一体机重新生成二维码。')
      return
    }
    if (file.size > MAX_BYTES) {
      setState('error')
      setMessage(`文件超过 10MB（${formatSize(file.size)}），请压缩后重新上传。`)
      return
    }

    setState('uploading')
    setMessage(null)
    setFileLabel(`${file.name} · ${formatSize(file.size)} · ${fileFormat(file)}`)
    try {
      await uploadPhoneSessionFile({ sessionId, uploadToken, file })
      setState('success')
      setMessage(`上传完成，请回到一体机屏幕确认使用这份${fileNoun}。`)
    } catch (err) {
      setState('error')
      setMessage(uploadSessionUserMessage(err, '上传失败，请重新扫码或稍后重试。'))
    }
  }

  const handleFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (file) void uploadFile(file)
  }

  const handleDrop = (event: React.DragEvent<HTMLLabelElement>) => {
    event.preventDefault()
    setDragging(false)
    const file = event.dataTransfer.files?.[0]
    if (file) void uploadFile(file)
  }

  const reset = () => {
    setState('idle')
    setMessage(null)
    setFileLabel(null)
  }

  const fileParts = fileLabel?.split(' · ') ?? []
  const progressClass = state === 'success'
    ? 'is-success'
    : state === 'error'
      ? 'is-error'
      : state === 'uploading'
        ? 'ph-up-progress-bar'
        : 'is-idle'

  return (
    <main className="fusion-w5 fusion-w5--auth k1-phone-upload service-desk" data-kiosk-screen="phone-upload" data-visual-theme="service-desk" data-ux-density="touch" data-kiosk-presentation="fusion-youth" data-kiosk-viewport="mobile">
      {!ready ? (
        <div className="phone-upload-invalid">
          <AlertCircleIcon aria-hidden="true" />
          <p>上传链接已失效</p>
          <p>请回到一体机屏幕重新扫码获取新的上传链接。</p>
        </div>
      ) : (
        <section className="k1-phone-upload-content">
          <header className="ph-up-brand">
            <span><UploadCloudIcon aria-hidden="true" /></span>
            <div>
              <strong>AI求职打印服务终端</strong>
              <small>{pageTitle}</small>
            </div>
          </header>

          <div className="ph-up-target">
            <MonitorIcon aria-hidden="true" />
            上传完成后，请回到发起二维码的一体机确认。
          </div>

          {state === 'success' ? (
            <div className="ph-up-pick is-busy" role="status">
              <CheckCircleIcon aria-hidden="true" />
              <b>已上传到一体机</b>
              <span>请回到一体机确认使用这份{fileNoun}。</span>
            </div>
          ) : (
            <label
              onDragOver={(event) => {
                event.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              className={[
                'ph-up-pick',
                dragging ? 'ph-up-pick--drag' : '',
                state === 'uploading' ? 'is-busy' : '',
              ].join(' ').trim()}
            >
              <input type="file" accept={purposeConfig?.accept ?? ''} aria-label={`选择${fileNoun}`} className="sr-only" disabled={state === 'uploading'} onChange={handleFile} />
              {state === 'uploading' ? <Loader2Icon aria-hidden="true" /> : <UploadCloudIcon aria-hidden="true" />}
              <b>选择手机中的文件</b>
              <span>{purposeConfig?.helper ?? '请回到一体机重新生成二维码。'}</span>
            </label>
          )}

          <div className="ph-up-count">本次文件{fileLabel ? '（1）' : '（0）'}</div>
          {fileLabel ? (
            <div className="ph-up-file">
              <span className="ph-up-file-icon"><FileTextIcon aria-hidden="true" /></span>
              <span className="ph-up-file-meta">
                <b>{fileParts[0]}</b>
                <span>{fileParts.slice(1).join(' · ')}</span>
              </span>
              {state !== 'success' && (
                <button
                  type="button"
                  disabled={state === 'uploading'}
                  onClick={reset}
                  className="ph-up-remove"
                  aria-label="移除文件"
                >
                  <Trash2Icon aria-hidden="true" />
                </button>
              )}
            </div>
          ) : (
            <div className="ph-up-empty">尚未选择文件</div>
          )}

          <div className="ph-up-status" role="status" aria-live="polite">
            <div className="ph-up-status-head">
              <b>
                {state === 'uploading' ? '正在上传，请稍候…' : state === 'success' ? '上传成功' : state === 'error' ? '上传失败' : ready ? '等待选择文件' : '链接不可用'}
              </b>
              <span>{state === 'uploading' ? '请勿关闭本页' : '二维码 10 分钟内有效'}</span>
            </div>
            <div className="ph-up-track">
              <div className={['ph-up-track-bar', progressClass].join(' ')} />
            </div>
            <div className="ph-up-status-note">
              {state === 'error' ? <AlertCircleIcon aria-hidden="true" /> : state === 'success' ? <CheckCircleIcon aria-hidden="true" /> : <ShieldCheckIcon aria-hidden="true" />}
              <span>{message ?? '上传完成后，请在一体机上确认并继续操作；上传失败时可重新选择文件重试。'}</span>
            </div>
          </div>

          <p className="ph-up-privacy">
            <ShieldCheckIcon aria-hidden="true" />
            本页使用一次性上传令牌，不会登录或读取你的账号；文件仅用于本次打印 / 简历服务，到期自动清理。
          </p>
        </section>
      )}
    </main>
  )
}
