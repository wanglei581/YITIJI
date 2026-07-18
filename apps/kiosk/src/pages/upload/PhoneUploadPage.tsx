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
import { uploadPhoneSessionFile } from '../../services/api/uploadSessions'

const RESUME_ACCEPT = '.pdf,.doc,.docx,.jpg,.jpeg,.png,.webp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,image/webp'
const PRINT_DOC_ACCEPT = '.pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png'
const MAX_BYTES = 10 * 1024 * 1024

type UploadState = 'idle' | 'uploading' | 'success' | 'error'

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
  const isPrintDoc = hashParams.get('purpose')?.trim() === 'print_doc'
  const [state, setState] = useState<UploadState>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [fileLabel, setFileLabel] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)

  const fileNoun = isPrintDoc ? '文件' : '简历文件'
  const accept = isPrintDoc ? PRINT_DOC_ACCEPT : RESUME_ACCEPT
  const ready = Boolean(sessionId && uploadToken)
  const pageTitle = useMemo(() => {
    if (!ready) return '上传链接无效'
    if (state === 'success') return '上传完成'
    if (state === 'error') return '上传遇到问题'
    return `上传${fileNoun}`
  }, [fileNoun, ready, state])

  const uploadFile = async (file: File) => {
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
    setFileLabel(`${file.name} · ${formatSize(file.size)} · ${fileFormat(file)}`)
    try {
      await uploadPhoneSessionFile({ sessionId, uploadToken, file })
      setState('success')
      setMessage(`上传完成，请回到一体机屏幕确认使用这份${fileNoun}。`)
    } catch (err) {
      setState('error')
      setMessage(err instanceof Error ? err.message : '上传失败，请重新扫码或稍后重试。')
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

  return (
    <main className="k1-phone-upload service-desk grid min-h-[100svh] place-items-center bg-[#2a2a26] px-0 py-0 font-sans text-neutral-900 sm:py-6" data-visual-theme="service-desk" data-ux-density="touch">
      {!ready ? (
        <div className="phone-upload-invalid flex flex-col items-center gap-4 px-6 text-center">
          <AlertCircleIcon className="h-12 w-12 text-red-400" />
          <p className="text-lg font-semibold text-neutral-700">上传链接已失效</p>
          <p className="text-sm text-neutral-500">请回到一体机屏幕重新扫码获取新的上传链接。</p>
        </div>
      ) : (
      <section className="flex h-[844px] w-[390px] max-w-full flex-col gap-4 rounded-none bg-canvas px-5 py-6 shadow-none sm:rounded-[28px] sm:shadow-[0_24px_60px_rgba(9,26,23,0.25)]">
        <header className="flex shrink-0 items-center gap-2.5">
          <span className="grid h-[38px] w-[38px] place-items-center rounded-[10px] bg-dark text-surface">
            <UploadCloudIcon className="h-5 w-5" />
          </span>
          <div>
            <b className="font-serif text-[17px] font-bold tracking-normal">AI求职打印服务终端</b>
            <span className="block text-[13px] text-neutral-500">{pageTitle}</span>
          </div>
        </header>

        <div className="flex shrink-0 items-center gap-2 rounded-md border border-neutral-200 bg-surface px-3.5 py-2.5 text-[13px] text-neutral-500">
          <MonitorIcon className="h-4 w-4" />
          上传目标：<b className="font-semibold text-neutral-900">就业服务大厅 · 01号机</b>
        </div>

        <label
          onDragOver={(event) => {
            event.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={handleDrop}
          className={[
            'ph-up-pick relative flex min-h-[150px] shrink-0 cursor-pointer flex-col items-center justify-center gap-2.5 rounded-lg border-2 border-dashed px-5 text-center active:scale-[0.98]',
            dragging ? 'ph-up-pick--drag' : '',
            state === 'uploading' ? 'pointer-events-none opacity-75' : '',
          ].join(' ')}
        >
          <input type="file" accept={accept} aria-label={`选择${fileNoun}`} className="sr-only" disabled={state === 'uploading'} onChange={handleFile} />
          {state === 'uploading' ? <Loader2Icon className="h-10 w-10 animate-spin" /> : state === 'success' ? <CheckCircleIcon className="h-10 w-10" /> : <UploadCloudIcon className="h-10 w-10" />}
          <b className="text-lg font-bold">{state === 'success' ? '已上传到一体机' : '选择手机中的文件'}</b>
          <span className="text-[13px] leading-relaxed text-neutral-500">
            {isPrintDoc ? '打印支持 PDF / JPG / PNG；单个最大 10MB，选择后自动上传' : '简历支持 PDF / Word / JPG / PNG / WEBP；单个最大 10MB，选择后自动上传'}
          </span>
        </label>

        <div className="shrink-0 text-sm font-bold text-neutral-900">本次文件{fileLabel ? '（1）' : '（0）'}</div>
        {fileLabel ? (
          <div className="flex shrink-0 items-center gap-3 rounded-md border border-neutral-200 bg-surface px-3.5 py-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-warning-bg text-warning-fg">
              <FileTextIcon className="h-5.5 w-5.5" />
            </span>
            <span className="min-w-0 flex-1">
              <b className="block truncate text-[15px] font-semibold">{fileLabel.split(' · ')[0]}</b>
              <span className="mt-0.5 block text-xs text-neutral-500">{fileLabel.split(' · ').slice(1).join(' · ')}</span>
            </span>
            <button
              type="button"
              disabled={state === 'uploading'}
              onClick={reset}
              className="grid h-12 w-12 shrink-0 place-items-center rounded-md border border-neutral-200 text-neutral-500 disabled:opacity-40"
              aria-label="移除文件"
            >
              <Trash2Icon className="h-5 w-5" />
            </button>
          </div>
        ) : (
          <div className="flex shrink-0 items-center justify-center rounded-md border border-dashed border-neutral-200 bg-surface px-3.5 py-5 text-sm text-neutral-500">
            尚未选择文件
          </div>
        )}

        <div className="shrink-0 rounded-md border border-neutral-200 bg-surface p-4" role="status" aria-live="polite">
          <div className="flex items-center gap-2.5 text-[15px]">
            <b className="font-bold">
              {state === 'uploading' ? '正在上传，请稍候…' : state === 'success' ? '上传成功' : state === 'error' ? '上传失败' : ready ? '等待选择文件' : '链接不可用'}
            </b>
            <span className="ml-auto text-[13px] text-neutral-500">{state === 'uploading' ? '请勿关闭本页' : '二维码 10 分钟内有效'}</span>
          </div>
          <div className="mt-3 h-3 overflow-hidden rounded-full bg-neutral-100">
            <div
              className={[
                'h-full rounded-full',
                state === 'success' ? 'w-full bg-success' : state === 'error' ? 'w-full bg-error' : state === 'uploading' ? 'ph-up-progress-bar w-full' : 'w-1/5 bg-neutral-300',
              ].join(' ')}
            />
          </div>
          <div className="mt-2.5 flex items-start gap-2 text-[13.5px] leading-relaxed text-neutral-500">
            {state === 'error' ? <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-error-fg" /> : state === 'success' ? <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0 text-success-fg" /> : <ShieldCheckIcon className="mt-0.5 h-4 w-4 shrink-0 text-primary-700" />}
            <span>{message ?? '上传完成后，请在一体机上确认并继续操作；上传失败时可重新选择文件重试。'}</span>
          </div>
        </div>

        <div className="mt-auto flex shrink-0 items-center gap-2 rounded-xl border border-dashed border-neutral-300 bg-canvas px-3.5 py-3 text-[13px] leading-relaxed text-neutral-500">
          <ShieldCheckIcon className="h-4 w-4 shrink-0 text-warning-fg" />
          本页使用一次性上传令牌，不会登录或读取你的账号；文件仅用于本次打印 / 简历服务，到期自动清理。
        </div>
      </section>
      )}
    </main>
  )
}
