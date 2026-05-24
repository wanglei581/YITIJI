import { useNavigate, useLocation } from 'react-router-dom'
import { Button, Card } from '@ai-job-print/ui'
import {
  AlertCircleIcon,
  CheckCircleIcon,
  FileTextIcon,
} from 'lucide-react'

interface PrintFile {
  name: string
  size: string
  pages: number
}

interface PrintJobState {
  file?: PrintFile
  copies?: number
  duplex?: string
  color?: string
  success?: boolean
  reason?: string
}

export function PrintDonePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const state = (location.state ?? {}) as PrintJobState

  const { file, copies = 1, duplex = 'single', color = 'bw', success = true, reason } = state

  // 重试：移除控制字段，其余参数完整带回确认页
  const CONTROL_FIELDS = new Set(['success', 'reason', 'simulateFailure', 'failReason'])
  const handleRetry = () => {
    const retryState = Object.fromEntries(
      Object.entries(state).filter(([k]) => !CONTROL_FIELDS.has(k)),
    )
    navigate('/print/confirm', { state: retryState })
  }

  return (
    <div className="flex h-full flex-col items-center justify-center p-8">
      {/* 状态图标 */}
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

      {/* 标题 / 描述 */}
      <h1 className="text-2xl font-bold text-gray-900">
        {success ? '打印完成' : '打印失败'}
      </h1>
      <p className="mt-2 text-base text-gray-500">
        {success ? '请从出纸口取走文件' : (reason ?? '打印任务未能完成，请重试或联系工作人员')}
      </p>

      {/* 摘要卡片 */}
      {file && (
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
            <span className="text-right font-medium text-gray-900">{copies} 份</span>
            <span className="text-gray-500">打印面</span>
            <span className="text-right font-medium text-gray-900">
              {duplex === 'duplex' ? '双面' : '单面'}
            </span>
            <span className="text-gray-500">色彩</span>
            <span className="text-right font-medium text-gray-900">
              {color === 'color' ? '彩色' : '黑白'}
            </span>
          </div>
        </Card>
      )}

      {/* 操作按钮 */}
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
