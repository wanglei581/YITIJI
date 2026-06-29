import { useMemo, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import { AlertCircleIcon, CheckCircleIcon, FileTextIcon, Loader2Icon, ShieldCheckIcon, UploadCloudIcon } from 'lucide-react'
import { Button, Card } from '@ai-job-print/ui'
import { uploadPhoneSessionFile } from '../../services/api/uploadSessions'

const ACCEPT = '.pdf,.doc,.docx,.jpg,.jpeg,.png,.webp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,image/jpeg,image/png,image/webp'
const MAX_BYTES = 10 * 1024 * 1024

type UploadState = 'idle' | 'uploading' | 'success' | 'error'

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function PhoneUploadPage() {
  const location = useLocation()
  const [searchParams] = useSearchParams()
  const hashParams = useMemo(() => new URLSearchParams(location.hash.replace(/^#/, '')), [location.hash])
  const sessionId = (hashParams.get('sessionId') ?? searchParams.get('sessionId'))?.trim() ?? ''
  const uploadToken = (hashParams.get('token') ?? searchParams.get('token'))?.trim() ?? ''
  const [state, setState] = useState<UploadState>('idle')
  const [message, setMessage] = useState<string | null>(null)
  const [fileLabel, setFileLabel] = useState<string | null>(null)

  const ready = Boolean(sessionId && uploadToken)
  const pageTitle = useMemo(() => {
    if (!ready) return '上传链接无效'
    if (state === 'success') return '上传完成'
    return '上传简历文件'
  }, [ready, state])

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
      setMessage('手机端已上传，请回到一体机上确认使用这份简历。')
    } catch (err) {
      setState('error')
      setMessage(err instanceof Error ? err.message : '上传失败，请重新扫码或稍后重试。')
    }
  }

  return (
    <main className="min-h-screen bg-gray-50 px-4 py-6 text-gray-900">
      <section className="mx-auto flex min-h-[calc(100vh-48px)] max-w-md flex-col">
        <div className="py-4">
          <p className="text-sm font-semibold text-primary-600">AI求职打印一体机</p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-normal">{pageTitle}</h1>
          <p className="mt-3 text-sm leading-relaxed text-gray-600">
            临时上传不会保存到账号。如一体机已登录，仍需在一体机上确认后才会保存到账号。
          </p>
        </div>

        <Card className="mt-4 p-5">
          <div className="flex items-start gap-3 rounded-2xl bg-primary-50 px-4 py-3 text-sm leading-relaxed text-primary-800">
            <ShieldCheckIcon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <p>手机页面只使用一次性上传令牌，不会获取一体机上的会员登录态。请只上传自己的简历文件。</p>
          </div>

          <label
            className={[
              'mt-5 flex min-h-[220px] cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed px-5 py-8 text-center transition-colors',
              ready && state !== 'uploading'
                ? 'border-primary-200 bg-white active:bg-primary-50'
                : 'border-gray-200 bg-gray-50 opacity-70',
            ].join(' ')}
          >
            <input
              type="file"
              accept={ACCEPT}
              className="hidden"
              disabled={!ready || state === 'uploading'}
              onChange={handleFile}
            />
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-50 text-primary-600">
              {state === 'uploading' ? (
                <Loader2Icon className="h-8 w-8 animate-spin" aria-hidden="true" />
              ) : state === 'success' ? (
                <CheckCircleIcon className="h-8 w-8" aria-hidden="true" />
              ) : (
                <UploadCloudIcon className="h-8 w-8" aria-hidden="true" />
              )}
            </div>
            <p className="mt-4 text-xl font-bold">
              {state === 'uploading' ? '正在上传...' : state === 'success' ? '已上传到一体机' : '选择简历文件'}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-gray-500">
              支持 PDF / DOC / DOCX / JPG / PNG / WEBP，单个文件最大 10MB。
            </p>
            {fileLabel && (
              <div className="mt-4 flex items-center gap-2 rounded-2xl bg-gray-50 px-3 py-2 text-sm font-semibold text-gray-700">
                <FileTextIcon className="h-4 w-4" aria-hidden="true" />
                {fileLabel}
              </div>
            )}
          </label>

          {message && (
            <div
              className={[
                'mt-5 flex items-start gap-2 rounded-2xl px-4 py-3 text-sm font-semibold leading-relaxed',
                state === 'success' ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700',
              ].join(' ')}
            >
              {state === 'success' ? <CheckCircleIcon className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />}
              <span>{message}</span>
            </div>
          )}

          {state === 'error' && (
            <Button size="lg" className="mt-5 w-full" onClick={() => setState('idle')} disabled={!ready}>
              重新选择文件
            </Button>
          )}
        </Card>
      </section>
    </main>
  )
}
