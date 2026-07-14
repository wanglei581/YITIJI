import { useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { AlertCircleIcon, CheckCircleIcon, FileTextIcon, Loader2Icon, ShieldCheckIcon, UploadCloudIcon } from 'lucide-react'
import { Button, Card } from '@ai-job-print/ui'
import { uploadPhoneSessionFile } from '../../services/api/uploadSessions'
import './phone-upload-service-desk.css'

const RESUME_ACCEPT = '.pdf,.doc,.docx,.jpg,.jpeg,.png,.webp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,image/webp'
// print_doc 服务端 MIME 白名单只有 PDF/JPG/PNG(见 services/api file-validation.ts PRINTABLE),
// doc/docx/webp 上传后会被服务端拒绝,故手机端 accept 也收窄,避免选中后才失败。
const PRINT_DOC_ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png'
const MAX_BYTES = 10 * 1024 * 1024

type UploadState = 'idle' | 'uploading' | 'success' | 'error'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function PhoneUploadPage() {
  const location = useLocation()
  const hashParams = useMemo(() => new URLSearchParams(location.hash.replace(/^#/, '')), [location.hash])
  const sessionId = hashParams.get('sessionId')?.trim() ?? ''
  const uploadToken = hashParams.get('token')?.trim() ?? ''
  // purpose 仅决定手机端文案,真正的会话用途以服务端存储为准,这里不做任何鉴权判断。
  const isPrintDoc = hashParams.get('purpose')?.trim() === 'print_doc'
  const [state, setState] = useState<UploadState>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [fileLabel, setFileLabel] = useState<string | null>(null)

  const fileNoun = isPrintDoc ? '文件' : '简历文件'
  const accept = isPrintDoc ? PRINT_DOC_ACCEPT : RESUME_ACCEPT
  const ready = Boolean(sessionId && uploadToken)
  const pageTitle = useMemo(() => {
    if (!ready) return '上传链接无效'
    if (state === 'success') return '上传完成'
    return `上传${fileNoun}`
  }, [fileNoun, ready, state])

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!ready) {
      setState('error')
      setMessage('上传链接无效，请回到一体机重新生成二维码。')
      return
    }
    if (file.size > MAX_BYTES) {
      setState('error')
      setMessage(`文件超过 10MB（${formatSize(file.size)}），请压缩后重新上传。`)
      return
    }

    setState('uploading')
    setMessage(null)
    setFileLabel(`${file.name} · ${formatSize(file.size)}`)
    try {
      await uploadPhoneSessionFile({
        sessionId,
        uploadToken,
        file,
      })
      setState('success')
      setMessage(`手机端已上传，请回到一体机上确认使用这份${fileNoun}。`)
    } catch (err) {
      setState('error')
      setMessage(err instanceof Error ? err.message : '上传失败，请重新扫码或稍后重试。')
    }
  }

  return (
    <main className="service-desk k1-phone-upload" data-visual-theme="service-desk" data-ux-density="touch">
      <section className="phone-upload-shell">
        <header className="phone-upload-heading">
          <p className="phone-upload-eyebrow">AI求职打印一体机</p>
          <h1>{pageTitle}</h1>
          <p className="phone-upload-intro">
            临时上传不会保存到账号。如一体机已登录，仍需在一体机上确认后才会保存到账号。
          </p>
        </header>

        <Card className="phone-upload-card">
          <div className="phone-upload-trust">
            <ShieldCheckIcon aria-hidden="true" />
            <p>手机页面只使用一次性上传令牌，不会获取一体机上的会员登录态。请只上传自己的{fileNoun}。</p>
          </div>

          {!ready ? (
            <div className="phone-upload-invalid" role="alert" aria-live="polite">
              <AlertCircleIcon aria-hidden="true" />
              <h2>这个上传链接已经不能使用</h2>
              <p>请回到一体机重新生成二维码，再用手机扫码上传。</p>
            </div>
          ) : (
            <>
              <label
                className={[
                  'phone-upload-picker',
                  state !== 'uploading' ? 'is-ready' : 'is-disabled',
                ].join(' ')}
                data-upload-state={state}
                aria-disabled={state === 'uploading'}
              >
                <input
                  type="file"
                  aria-label={`选择${fileNoun}`}
                  accept={accept}
                  className="phone-upload-input"
                  disabled={state === 'uploading'}
                  onChange={handleFile}
                />
                <div className="phone-upload-icon" aria-hidden="true">
                  {state === 'uploading' ? (
                    <Loader2Icon className="phone-upload-spinner" />
                  ) : state === 'success' ? (
                    <CheckCircleIcon />
                  ) : (
                    <UploadCloudIcon />
                  )}
                </div>
                <p className="phone-upload-picker-title">
                  {state === 'uploading' ? '正在上传...' : state === 'success' ? '已上传到一体机' : `选择${fileNoun}`}
                </p>
                <p className="phone-upload-picker-copy">
                  {isPrintDoc ? '支持 PDF / JPG / PNG，单个文件最大 10MB。' : '支持 PDF / DOC / DOCX / JPG / PNG / WEBP，单个文件最大 10MB。'}
                </p>
                {fileLabel && (
                  <div className="phone-upload-file-label">
                    <FileTextIcon aria-hidden="true" />
                    {fileLabel}
                  </div>
                )}
              </label>

              {message && (
                <div
                  className={[
                    'phone-upload-message',
                    state === 'success' ? 'is-success' : 'is-error',
                  ].join(' ')}
                  role="status"
                  aria-live="polite"
                >
                  {state === 'success' ? <CheckCircleIcon aria-hidden="true" /> : <AlertCircleIcon aria-hidden="true" />}
                  <span>{message}</span>
                </div>
              )}

              {state === 'error' && (
                <Button size="lg" className="phone-upload-retry" onClick={() => setState('idle')}>
                  重新选择文件
                </Button>
              )}
            </>
          )}
        </Card>
      </section>
    </main>
  )
}
