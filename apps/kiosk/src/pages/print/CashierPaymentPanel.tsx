import { lazy, Suspense } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { LoaderIcon, RefreshCwIcon, SearchCheckIcon, ShieldCheckIcon } from 'lucide-react'
import { Button } from '@ai-job-print/ui'
import { PAY_CHANNEL_LABEL, type AttemptPaymentMethod, type CashierView } from './cashierStatus'

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

interface CashierPaymentPanelProps {
  paymentMethod: PaymentMethod | null
  attemptPaymentMethod: AttemptPaymentMethod | null
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
  onSubmitCode: (authCode?: string) => void
  onReconcile: () => void
  onReissue: () => void
  onSimulateSandbox: (result: 'success' | 'failed') => void
}

/** 收银方式的呈现层：不发请求、不持久化付款码，只把页面传入的状态映射为操作控件。 */
export function CashierPaymentPanel(props: CashierPaymentPanelProps) {
  const {
    paymentMethod,
    attemptPaymentMethod,
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

  const showCodeInput = paymentMethod === 'code' && (!snapshot?.attempt || snapshot.attempt.status === 'failed')
  const canReconcile =
    (view?.phase === 'awaiting_scan' || view?.phase === 'awaiting_code_confirmation') &&
    snapshot?.attempt?.channel !== undefined &&
    snapshot.attempt.channel !== 'sandbox'

  const inner = showCodeInput ? (
    <form
      className="cashier-code-form"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmitCode()
      }}
    >
      <div>
        <p className="cashier-code-label-title">请扫描或输入手机付款码</p>
        <p className="cashier-code-label-hint">扫码器会自动输入并提交；也可手动输入 18 位数字。</p>
      </div>
      <input
        autoFocus
        value={authCode}
        onChange={(event) => {
          const nextCode = event.target.value.replace(/\D/g, '').slice(0, 18)
          onAuthCodeChange(nextCode)
          if (nextCode.length === 18) onSubmitCode(nextCode)
        }}
        inputMode="numeric"
        autoComplete="off"
        maxLength={18}
        aria-label="付款码"
        placeholder="请输入 18 位付款码"
        disabled={codeSubmitting}
        className="cashier-code-input"
      />
      <button type="submit" disabled={codeSubmitting || authCode.length !== 18} className="cashier-code-submit">
        {codeSubmitting ? '正在提交…' : '确认支付'}
      </button>
    </form>
  ) : !view ? (
    <div className="cashier-idle-panel">
      <LoaderIcon style={{ width: 32, height: 32, animation: 'spin 1s linear infinite', color: 'var(--print-teal)' }} />
      <p>
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
    <div className="cashier-qr-area">
      <div className="cashier-qr-panel">
        {view.title || view.hint ? (
          <div style={{
            width: '100%',
            borderRadius: 12,
            padding: '10px 16px',
            textAlign: 'center',
            fontSize: 16,
            background: view.tone === 'success' ? 'var(--print-teal-soft)' : view.tone === 'error' ? 'rgb(193 74 52 / 8%)' : view.tone === 'warning' ? 'var(--print-wheat-soft)' : 'var(--print-slate-soft)',
            color: view.tone === 'success' ? 'var(--print-teal-deep)' : view.tone === 'error' ? 'var(--print-error)' : view.tone === 'warning' ? 'var(--print-wheat-deep, #8a6219)' : 'var(--print-slate)',
            border: `1px solid ${view.tone === 'success' ? 'rgb(31 158 134 / 30%)' : view.tone === 'error' ? 'rgb(193 74 52 / 30%)' : view.tone === 'warning' ? 'rgb(169 120 31 / 30%)' : 'rgb(63 104 176 / 25%)'}`,
          }}>
            <p style={{ fontWeight: 700 }}>{view.title}</p>
            {view.hint && <p style={{ marginTop: 4, lineHeight: 1.5 }}>{view.hint}</p>}
          </div>
        ) : null}

        {qrContent && (
          <>
            <div style={{ background: '#fff', borderRadius: 12, padding: 16, border: '1px solid var(--print-line)' }}>
              <QRCodeSVG value={qrContent} size={240} level="M" marginSize={1} />
            </div>
            <div className="cashier-qr-title">
              请使用{PAY_CHANNEL_LABEL[snapshot?.attempt?.channel ?? ''] ?? '手机'}扫码支付
            </div>
            <div className="cashier-qr-sub">支付主体与金额以手机端展示为准</div>
            <div className="cashier-qr-badge">
              <ShieldCheckIcon aria-hidden="true" />
              {snapshot?.attempt?.channel === 'sandbox'
                ? '测试支付通道 · 非真实收款'
                : `${PAY_CHANNEL_LABEL[snapshot?.attempt?.channel ?? ''] ?? '线上支付'} · 支付结果以服务端确认为准`}
            </div>
            {remainSec !== null && (
              <p className="cashier-countdown">
                收款码 {String(Math.floor(remainSec / 60)).padStart(2, '0')}:{String(remainSec % 60).padStart(2, '0')} 后失效，过期请重新出码
              </p>
            )}
          </>
        )}
      </div>

      {canReconcile && (
        <button
          type="button"
          onClick={onReconcile}
          disabled={reconciling}
          className="cashier-verify-btn"
        >
          <SearchCheckIcon style={{ animation: reconciling ? 'pulse 1.5s ease-in-out infinite' : undefined }} aria-hidden="true" />
          {reconciling ? '正在向支付渠道核实…' : '已支付但未跳转？点此核实支付结果'}
        </button>
      )}

      {canReissue && (
        <Button variant="secondary" size="lg" style={{ width: '100%', marginTop: 8 }} disabled={issuing} onClick={onReissue}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <RefreshCwIcon style={{ width: 18, height: 18, animation: issuing ? 'spin 1s linear infinite' : undefined }} aria-hidden="true" />
            {(attemptPaymentMethod ?? paymentMethod) === 'code' ? '重新扫码' : '重新出码'}
          </span>
        </Button>
      )}
    </div>
  )

  return (
    <>
      {inner}
      {isDevSandbox && !canProceed && DevSandboxControls && (
        <Suspense fallback={null}>
          <DevSandboxControls onSimulate={onSimulateSandbox} />
        </Suspense>
      )}
    </>
  )
}
