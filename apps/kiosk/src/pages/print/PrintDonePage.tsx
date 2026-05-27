import { useNavigate, useLocation } from 'react-router-dom'
import { Button, Card } from '@ai-job-print/ui'
import { AlertCircleIcon, CheckCircleIcon, FileTextIcon } from 'lucide-react'
import type { PrintJobParams } from '@ai-job-print/shared'

interface PrintFile {
  name: string
  size: string
  pages: number
}

interface PrintJobState {
  file?: PrintFile
  params?: PrintJobParams
  success?: boolean
  reason?: string
}

const DUPLEX_LABEL: Record<string, string> = {
  simplex: '单面',
  duplex_long_edge: '双面（长边）',
  duplex_short_edge: '双面（短边）',
}

export function PrintDonePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const state = (location.state ?? {}) as PrintJobState

  const { file, params, success = true, reason } = state

  const handleRetry = () => {
    const CONTROL_FIELDS = new Set(['success', 'reason', 'simulateFailure', 'failReason'])
    const retryState = Object.fromEntries(
      Object.entries(state).filter(([k]) => !CONTROL_FIELDS.has(k)),
    )
    navigate('/print/confirm', { state: retryState })
  }

  return (
    <div className="flex h-full flex-col items-center justify-center p-8">
      {/* Status icon */}
      <div
        className={[
          'mb-8 flex h-24 w-24 items-center justify-center rounded-full',
          success ? 'bg-green-50' : 'bg-red-50',
        ].join(' ')}
      >
        {success ? (
          <CheckCircleIcon className="h-14 w-14 text-green-600" />
        ) : (
          <AlertCircleIcon className="h-14 w-14 text-red-500" />
        )}
      </div>

      <h1 className="text-2xl font-bold text-gray-900">
        {success ? '打印完成' : '打印失败'}
      </h1>
      <p className="mt-2 text-base text-gray-500">
        {success
          ? '请从出纸口取走文件'
          : (reason ?? '打印任务未能完成，请重试或联系工作人员')}
      </p>

      {/* Summary card */}
      {file && params && (
        <Card className="mt-8 w-full max-w-sm p-5">
          <div className="flex items-center gap-3 border-b border-gray-100 pb-4">
            <div
              className={[
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
                success ? 'bg-primary-50' : 'bg-red-50',
              ].join(' ')}
            >
              <FileTextIcon
                className={['h-5 w-5', success ? 'text-primary-600' : 'text-red-500'].join(' ')}
              />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-gray-900">{file.name}</p>
              <p className="text-xs text-gray-500">
                {file.pages} 页 · {file.size}
              </p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-y-2 text-sm">
            <span className="text-gray-500">份数</span>
            <span className="text-right font-medium text-gray-900">{params.copies} 份</span>
            <span className="text-gray-500">打印面</span>
            <span className="text-right font-medium text-gray-900">
              {DUPLEX_LABEL[params.duplex] ?? params.duplex}
            </span>
            <span className="text-gray-500">色彩</span>
            <span className="text-right font-medium text-gray-900">
              {params.colorMode === 'color' ? '彩色' : '黑白'}
            </span>
            <span className="text-gray-500">质量</span>
            <span className="text-right font-medium text-gray-900">
              {params.quality === 'draft' ? '草稿' : params.quality === 'high' ? '高质量' : '标准'}
            </span>
          </div>
        </Card>
      )}

      {/* Actions */}
      <div className="mt-8 flex w-full max-w-sm gap-3">
        {success ? (
          <>
            <Button
              variant="secondary"
              size="lg"
              className="flex-1"
              onClick={() => navigate('/print/upload')}
            >
              继续打印
            </Button>
            <Button size="lg" className="flex-1" onClick={() => navigate('/')}>
              返回首页
            </Button>
          </>
        ) : (
          <>
            <Button
              variant="secondary"
              size="lg"
              className="flex-1"
              onClick={() => navigate('/')}
            >
              返回首页
            </Button>
            <Button size="lg" className="flex-1" onClick={handleRetry}>
              重试打印
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
