import { lazy, Suspense } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { LoaderIcon, RefreshCwIcon, SearchCheckIcon, ShieldCheckIcon } from 'lucide-react'
import { Button, Card } from '@ai-job-print/ui'
import { PAY_CHANNEL_LABEL, type CashierView } from './cashierStatus'

// 生产包不能含 DEV 沙箱按钮文案或模拟支付入口；Vite 会在 production 将此分支完全裁掉。
const DevSandboxControls = import.meta.env.DEV ? lazy(() => import('./DevSandboxControls')) : null

export type PaymentMethod = 'qr' | 'code'

export interface CashierSnapshot {
  payStatus: string
  attempt: {
    attemptId: string
    channel: string
    status: 'created' | 'pending' | 'success' | 'failed' | 'expired'
    qrCodeContent: string | null
    expiresAt: string | null
  } | null
}

const TONE_BOX: Record<CashierView['tone'], string> = {
  info: 'border-primary-200 bg-primary-50 text-primary-700',
  success: 'border-success/30 bg-success-bg text-success-fg',
  warning: 'border-warning/30 bg-warning-bg text-warning-fg',
  error: 'border-error/30 bg-error-bg text-error-fg',
}

interface CashierPaymentPanelProps {
  paymentMethod: PaymentMethod | null
  snapshot: CashierSnapshot | null
  view: CashierView | null
  channelsLoading: boolean
  issuing: boolean
  codeSubmitting: boolean
  authCode: string
  qrContent: string | null
  remainSec: number | null
  reconciling: boolean
  canReissue: boolean
  isDevSandbox: boolean
  canProceed: boolean
  onAuthCodeChange: (value: string) => void
  onSubmitCode: () => void
  onReconcile: () => void
  onReissue: () => void
  onSimulateSandbox: (result: 'success' | 'failed') => void
}

/** 收银方式的呈现层：不发请求、不持久化付款码，只把页面传入的状态映射为操作控件。 */
export function CashierPaymentPanel(props: CashierPaymentPanelProps) {
  const {
    paymentMethod,
    snapshot,
    view,
    channelsLoading,
    issuing,
    codeSubmitting,
    authCode,
    qrContent,
    remainSec,
    reconciling,
    canReissue,
    isDevSandbox,
    canProceed,
    onAuthCodeChange,
    onSubmitCode,
    onReconcile,
    onReissue,
    onSimulateSandbox,
  } = props

  const showCodeInput = paymentMethod === 'code' && (!snapshot || snapshot.attempt?.status === 'failed')
  const canReconcile =
    (view?.phase === 'awaiting_scan' || view?.phase === 'awaiting_code_confirmation') &&
    snapshot?.attempt?.channel !== undefined &&
    snapshot.attempt.channel !== 'sandbox'

  return (
    <>
      <Card className="flex flex-col items-center gap-4 p-6">
      {showCodeInput ? (
        <form
          className="flex w-full max-w-md flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            onSubmitCode()
          }}
        >
          <div className="text-center">
            <p className="font-semibold text-neutral-900">请扫描或输入手机付款码</p>
            <p className="mt-1 text-sm text-neutral-500">扫码器会自动输入并提交；也可手动输入 18 位数字。</p>
          </div>
          <input
            autoFocus
            value={authCode}
            onChange={(event) => onAuthCodeChange(event.target.value.replace(/\D/g, '').slice(0, 18))}
            inputMode="numeric"
            autoComplete="off"
            maxLength={18}
            aria-label="付款码"
            placeholder="请输入 18 位付款码"
            disabled={codeSubmitting}
            className="min-h-[56px] rounded-lg border border-neutral-300 px-4 text-center text-lg tracking-widest outline-none focus:border-primary-600"
          />
          <Button type="submit" size="lg" disabled={codeSubmitting || authCode.length !== 18}>
            {codeSubmitting ? '正在提交…' : '确认支付'}
          </Button>
        </form>
      ) : !view ? (
        <div className="flex flex-col items-center gap-3 py-8 text-neutral-500">
          <LoaderIcon className="h-8 w-8 animate-spin text-primary-600" />
          <p className="text-sm">
            {channelsLoading
              ? '正在获取支付通道…'
              : issuing
                ? '正在生成支付码…'
                : paymentMethod === null
                  ? '请选择支付方式'
                  : '正在获取支付状态…'}
          </p>
        </div>
      ) : (
        <>
          <div className={['w-full rounded-lg border px-4 py-3 text-center text-sm', TONE_BOX[view.tone]].join(' ')}>
            <p className="font-semibold">{view.title}</p>
            <p className="mt-1 leading-relaxed">{view.hint}</p>
          </div>

          {qrContent && (
            <div className="flex flex-col items-center gap-2">
              <div className="rounded-xl border border-neutral-200 bg-white p-4">
                <QRCodeSVG value={qrContent} size={220} level="M" marginSize={1} />
              </div>
              <div className="flex items-center gap-1.5 text-xs text-neutral-400">
                <ShieldCheckIcon className="h-3.5 w-3.5" />
                {snapshot?.attempt?.channel === 'sandbox'
                  ? '测试支付通道 · 非真实收款'
                  : `${PAY_CHANNEL_LABEL[snapshot?.attempt?.channel ?? ''] ?? '线上支付'} · 支付结果以服务端确认为准`}
              </div>
              {remainSec !== null && <p className="text-xs text-neutral-400">支付码有效期剩余 {remainSec} 秒</p>}
            </div>
          )}

          {canReconcile && (
            <button
              onClick={onReconcile}
              disabled={reconciling}
              className="flex min-h-[48px] items-center gap-2 rounded-lg border border-neutral-200 px-4 text-sm text-neutral-600"
            >
              <SearchCheckIcon className={['h-4 w-4', reconciling ? 'animate-pulse' : ''].join(' ')} />
              {reconciling ? '正在向支付渠道核实…' : '已完成支付但未跳转？点此核实'}
            </button>
          )}

          {canReissue && (
            <Button variant="secondary" size="lg" disabled={issuing} onClick={onReissue}>
              <span className="flex items-center gap-2">
                <RefreshCwIcon className={['h-4 w-4', issuing ? 'animate-spin' : ''].join(' ')} />
                {paymentMethod === 'code' ? '重新扫码' : '重新出码'}
              </span>
            </Button>
          )}
        </>
      )}
      </Card>
      {isDevSandbox && !canProceed && DevSandboxControls && (
        <Suspense fallback={null}>
          <DevSandboxControls onSimulate={onSimulateSandbox} />
        </Suspense>
      )}
    </>
  )
}
