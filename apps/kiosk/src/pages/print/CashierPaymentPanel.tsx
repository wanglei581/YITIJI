import { lazy, Suspense, useState, type RefObject } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { CheckIcon, LoaderIcon, RefreshCwIcon, SearchCheckIcon, ShieldCheckIcon } from 'lucide-react'
import { Button, KioskStatePanel } from '@ai-job-print/ui'
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
  /** 受遮蔽的非受控输入框，只把 DOM 节点交给父层在提交瞬间读取。 */
  authCodeInputRef: RefObject<HTMLInputElement>
  qrContent: string | null
  remainSec: number | null
  reconciling: boolean
  canReissue: boolean
  isDevSandbox: boolean
  canProceed: boolean
  onSubmitCode: () => void
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
    authCodeInputRef,
    qrContent,
    remainSec,
    reconciling,
    canReissue,
    isDevSandbox,
    canProceed,
    onSubmitCode,
    onReconcile,
    onReissue,
    onSimulateSandbox,
  } = props
  // 仅保留位数以支持无障碍提示与按钮状态；付款码本身从不进入 React 状态。
  const [authCodeLength, setAuthCodeLength] = useState(0)

  const showCodeInput = paymentMethod === 'code' && (!snapshot?.attempt || snapshot.attempt.status === 'failed')
  const canReconcile =
    (view?.phase === 'awaiting_scan' || view?.phase === 'awaiting_code_confirmation') &&
    snapshot?.attempt?.channel !== undefined &&
    snapshot.attempt.channel !== 'sandbox'
  const failFacts = view?.phase === 'refunded'
    ? [
        { text: <> <b>未进入打印</b> · 该订单已进入退款流程 </> },
        { text: <> <b>未产生新的打印任务</b> · 打印机不会出件 </> },
        { text: <> <b>如需继续</b> · 请返回重新发起打印 </> },
      ]
    : view?.phase === 'closed'
      ? [
          { text: <> <b>未产生扣款</b> · 超时关闭不会扣费 </> },
          { text: <> <b>未创建打印任务</b> · 打印机不会出件 </> },
          { text: <> <b>文件仍在</b> · 重新支付即可继续打印 </> },
        ]
      : [
          { text: <> <b>未产生扣款</b> · 如手机端未扣费即无需处理 </> },
          { text: <> <b>未创建打印任务</b> · 打印机不会出件 </> },
          { text: <> <b>文件仍在</b> · 重新支付即可继续打印 </> },
        ]

  // 终态走冻结的 KioskStatePanel（fusion-w2）；meta 补 32A 诚实事实，不伪造已支付/已出件。
  const terminalState = view && ['failed', 'closed', 'expired', 'refunded'].includes(view.phase)
    ? (
        <KioskStatePanel
          compact
          tone="error"
          title={view.title}
          description={view.hint}
          className="cashier-fail-card"
          meta={view.phase === 'expired' ? undefined : (
            <div className="cashier-fail-facts">
              {failFacts.map((fact, index) => (
                <div key={index} className="cashier-fail-fact">
                  <CheckIcon aria-hidden="true" />
                  <span>{fact.text}</span>
                </div>
              ))}
            </div>
          )}
          actions={view.canReissue ? (
            <Button variant="secondary" size="lg" style={{ width: '100%' }} disabled={issuing} onClick={onReissue}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
                <RefreshCwIcon style={{ width: 18, height: 18, animation: issuing ? 'spin 1s linear infinite' : undefined }} aria-hidden="true" />
                {view.phase === 'expired'
                  ? '重新出码'
                  : (attemptPaymentMethod ?? paymentMethod) === 'code'
                    ? '重新扫码'
                    : '重新支付'}
              </span>
            </Button>
          ) : undefined}
        />
      )
    : null

  const inner = showCodeInput ? (
    <form
      className="cashier-code-form"
      onSubmit={(event) => {
        event.preventDefault()
        setAuthCodeLength(0)
        onSubmitCode()
      }}
    >
      <div>
        <p className="cashier-code-label-title">请扫描或输入手机付款码</p>
        <p className="cashier-code-label-hint">扫码器会自动输入并提交；也可手动输入 18 位数字。</p>
      </div>
      <input
        ref={authCodeInputRef}
        autoFocus
        type="password"
        onChange={(event) => {
          const nextCode = event.target.value.replace(/\D/g, '').slice(0, 18)
          event.target.value = nextCode
          setAuthCodeLength(nextCode.length)
          if (nextCode.length === 18) {
            setAuthCodeLength(0)
            onSubmitCode()
          }
        }}
        inputMode="numeric"
        autoComplete="off"
        maxLength={18}
        aria-label="付款码"
        placeholder="请输入 18 位付款码"
        disabled={codeSubmitting}
        className="cashier-code-input"
      />
      <p className="sr-only" aria-live="polite" aria-atomic="true">
        已输入 {authCodeLength} / 18 位付款码
      </p>
      <button type="submit" disabled={codeSubmitting || authCodeLength !== 18} className="cashier-code-submit">
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
  ) : terminalState ?? (
    <div className="cashier-qr-area">
      <div className="cashier-qr-panel">
        {view.title || view.hint ? (
          <div className="cashier-tone-banner" data-tone={view.tone}>
            <b>{view.title}</b>
            {view.hint && <p style={{ marginTop: 4 }}>{view.hint}</p>}
          </div>
        ) : null}

        {qrContent && (
          <>
            <div className="cashier-qr-frame">
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
