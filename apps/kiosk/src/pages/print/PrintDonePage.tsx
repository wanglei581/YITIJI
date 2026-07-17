import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Button, Card } from '@ai-job-print/ui'
import { AlertCircleIcon, CheckCircleIcon, FileTextIcon, TicketIcon } from 'lucide-react'
import type { PrintJobParams } from '@ai-job-print/shared'
import { API_MODE } from '../../services/api/client'
import { getPayStatus } from '../../services/print/paymentApi'
import { printUploadPathForSource, type PrintMaterialSource } from './printMaterialSession'
import { PrintPrototypeHeader } from './PrintPrototypeLayout'

interface PrintFile {
  name:     string
  size:     string
  pages:    number
  fileUrl?: string
}

interface PrintJobState {
  file?:         PrintFile
  params?:       PrintJobParams
  success?:      boolean
  reason?:       string
  returnUrl?:    string
  returnLabel?:  string
  taskId?:       string
  orderId?:      string
  paymentSessionToken?: string
  source?:       PrintMaterialSource
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

  const { file, params, success = true, reason, returnUrl, returnLabel } = state
  const uploadPath = printUploadPathForSource(state.source)

  // C5-3：paid 后展示取件凭证码。取件码可见性完全由后端 pickupCodeVisibleFor 决定
  // （paid + 未退款 + 任务未进终态），前端只透传后端返回值，不自行编造。
  const [pickupCode, setPickupCode] = useState<string | null>(null)
  const [pickupCodeError, setPickupCodeError] = useState<string | null>(null)
  const [rating, setRating] = useState<'满意' | '一般' | '不满意' | null>(null)
  useEffect(() => {
    if (!success || API_MODE !== 'http' || !state.orderId || !state.paymentSessionToken) return
    let cancelled = false
    void (async () => {
      try {
        const s = await getPayStatus({ orderId: state.orderId as string, paymentSessionToken: state.paymentSessionToken })
        if (!cancelled) {
          setPickupCode(s.pickupCode)
          setPickupCodeError(null)
        }
      } catch {
        if (!cancelled) {
          setPickupCodeError('取件凭证暂时无法读取，请联系工作人员核验订单')
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [success, state.orderId, state.paymentSessionToken])

  const handleRetry = () => {
    const CONTROL_FIELDS = new Set(['success', 'reason', 'simulateFailure', 'failReason'])
    const retryState = Object.fromEntries(
      Object.entries(state).filter(([k]) => !CONTROL_FIELDS.has(k)),
    )
    navigate('/print/confirm', { state: retryState })
  }

  return (
    <div className="print-proto flex min-h-full flex-col">
      <PrintPrototypeHeader
        title={success ? '打印完成' : '打印失败'}
        subtitle={success ? '请从出纸口取走文件' : '请检查任务状态后重试'}
        step={7}
        backLabel="返回首页"
        onBack={() => navigate('/')}
      />
      <main className="flex flex-1 flex-col items-center justify-center p-8">
      {/* Status icon */}
      <div
        className={[
          'mb-8 flex h-24 w-24 items-center justify-center rounded-full',
          success ? 'bg-success-bg' : 'bg-error-bg',
        ].join(' ')}
      >
        {success ? (
          <CheckCircleIcon className="h-14 w-14 text-success-fg" />
        ) : (
          <AlertCircleIcon className="h-14 w-14 text-error-fg" />
        )}
      </div>

      <h1 className="text-2xl font-bold text-neutral-900">
        {success ? '打印完成' : '打印失败'}
      </h1>
      <p className="mt-2 text-base text-neutral-500">
        {success
          ? '请从出纸口取走文件'
          : (reason ?? '打印任务未能完成，请重试或联系工作人员')}
      </p>

      {/* 取件凭证码（paid 后由后端下发；仅可见时展示） */}
      {success && pickupCode && (
        <Card className="mt-6 w-full max-w-sm border-primary-200 bg-primary-50 p-5">
          <div className="flex items-center gap-2 text-sm text-primary-700">
            <TicketIcon className="h-4 w-4" />
            取件凭证码
          </div>
          <p className="mt-2 text-center font-mono text-3xl font-bold tracking-widest text-primary-700">
            {pickupCode}
          </p>
          <p className="mt-2 text-center text-xs text-neutral-500">
            如需现场核验取件，请出示此凭证码
          </p>
        </Card>
      )}
      {success && pickupCodeError && (
        <Card className="mt-6 w-full max-w-sm border-warning/30 bg-warning-bg p-4 text-warning-fg">
          <div className="flex items-start gap-2 text-sm">
            <AlertCircleIcon className="mt-0.5 h-4 w-4 shrink-0" />
            <p>{pickupCodeError}</p>
          </div>
        </Card>
      )}

      {/* Summary card */}
      {file && params && (
        <Card className="mt-8 w-full max-w-sm p-5">
          <div className="flex items-center gap-3 border-b border-neutral-100 pb-4">
            <div
              className={[
                'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
                success ? 'bg-primary-50' : 'bg-error-bg',
              ].join(' ')}
            >
              <FileTextIcon
                className={['h-5 w-5', success ? 'text-primary-600' : 'text-error-fg'].join(' ')}
              />
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-neutral-900">{file.name}</p>
              <p className="text-xs text-neutral-500">
                {file.pages} 页 · {file.size}
              </p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-y-2 text-sm">
            <span className="text-neutral-500">份数</span>
            <span className="text-right font-medium text-neutral-900">{params.copies} 份</span>
            <span className="text-neutral-500">打印面</span>
            <span className="text-right font-medium text-neutral-900">
              {DUPLEX_LABEL[params.duplex] ?? params.duplex}
            </span>
            <span className="text-neutral-500">色彩</span>
            <span className="text-right font-medium text-neutral-900">
              {params.colorMode === 'color' ? '彩色' : '黑白'}
            </span>
            <span className="text-neutral-500">质量</span>
            <span className="text-right font-medium text-neutral-900">
              {params.quality === 'draft' ? '草稿' : params.quality === 'high' ? '高质量' : '标准'}
            </span>
          </div>
        </Card>
      )}

      {success && (
        <section className="mt-6 w-full max-w-sm" aria-label="服务评价">
          <p className="mb-3 text-center text-sm font-medium text-neutral-700">本次服务体验如何？</p>
          <div className="grid grid-cols-3 gap-3">
            {(['满意', '一般', '不满意'] as const).map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={rating === item}
                onClick={() => setRating(item)}
                className={[
                  'min-h-[56px] rounded-lg border px-3 text-sm font-semibold',
                  rating === item ? 'border-primary-600 bg-primary-50 text-primary-700' : 'border-neutral-200 bg-white text-neutral-600',
                ].join(' ')}
              >
                {item}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* Actions */}
      <div className="mt-8 flex w-full max-w-sm gap-3">
        {success ? (
          <>
            {returnUrl ? (
              <Button
                variant="secondary"
                size="lg"
                className="flex-1"
                onClick={() => navigate(returnUrl)}
              >
                返回{returnLabel ?? '上一页'}
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="lg"
                className="flex-1"
                onClick={() => navigate(uploadPath)}
              >
                继续打印
              </Button>
            )}
            <Button size="lg" className="flex-1" onClick={() => navigate('/')}>
              返回首页
            </Button>
            <Button variant="secondary" size="lg" className="flex-1" onClick={() => navigate('/me/print-orders')}>
              查看订单
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
      </main>
    </div>
  )
}
