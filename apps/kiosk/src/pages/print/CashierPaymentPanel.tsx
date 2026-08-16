import { lazy, Suspense, useCallback, useEffect, useState, type KeyboardEvent } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { CheckIcon, LoaderIcon, RefreshCwIcon, SearchCheckIcon, ShieldCheckIcon } from 'lucide-react'
import { Button, KioskStatePanel } from '@ai-job-print/ui'
import { PAY_CHANNEL_LABEL, type AttemptPaymentMethod, type CashierView } from './cashierStatus'

// 生产包不能含 DEV 沙箱按钮文案或模拟支付入口；Vite 会在 production 将此分支完全裁掉。
const DevSandboxControls = import.meta.env.DEV ? lazy(() => import('./DevSandboxControls')) : null

export type PaymentMethod = 'qr' | 'code'

/**
 * 付款码长度闸门：18 位纯数字。
 *
 * 注意：微信/支付宝付款码都是 18 位。支付宝的「25–30」是**码制前缀**不是长度
 * （见 services/api 的 alipay provider：/^(?:2[5-9]|30)\d{16}$/ —— 2 位前缀 + 16 位 = 18 位），
 * 与本闸门完全一致。不要把它「修」成 25–30 位，那会直接打断支付宝收款。
 */
export const AUTH_CODE_LENGTH = 18

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
  /**
   * 付款码「仅内存缓冲区」。付款码是一次性支付凭证，等同现金，而一体机是 27 寸
   * 公共竖屏 —— 旁观者站在旁边就能看见屏幕。
   *
   * 因此付款码只允许停留在这个 ref 里：
   * - 不进入 React state / props（不会随渲染树、DevTools、错误边界序列化外泄）
   * - 不进入任何 DOM 节点（输入框每次按键后立刻清空，见 drainInput）
   * - 不进入 URL / 日志 / storage / 错误信息
   * 父层只在提交那一瞬读取，读完立即 clearAuthCodeBuffer()。
   */
  authCodeBufferRef: { current: string }
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
    authCodeBufferRef,
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

  // 只保留「已读多少位」这个计数用于渲染。计数不是码值：18 位长度本身是公开的
  // 码制常识，泄露不了任何凭证内容，但能让用户知道扫上了没有、要不要重扫。
  const [authCodeLength, setAuthCodeLength] = useState(0)

  const clearBuffer = useCallback(() => {
    authCodeBufferRef.current = ''
    setAuthCodeLength(0)
  }, [authCodeBufferRef])

  /**
   * 把输入框里的字符「抽干」进内存缓冲区，并立即把输入框置空。
   *
   * 这样 DOM 里永远不存在付款码——不是遮蔽（type=password 仍会把码值挂在
   * DOM 节点上、还会触发浏览器密码管理器保存），而是根本不留。
   * HID 扫码枪在系统眼里就是键盘，逐字符 input 事件同样被逐字符抽干。
   */
  const drainInput = useCallback(
    (input: HTMLInputElement) => {
      const digits = input.value.replace(/\D/g, '')
      input.value = ''
      if (!digits) return
      const next = (authCodeBufferRef.current + digits).slice(0, AUTH_CODE_LENGTH)
      authCodeBufferRef.current = next
      setAuthCodeLength(next.length)
      if (next.length !== AUTH_CODE_LENGTH) return
      // 读满即提交。父层在 onSubmitCode() 的同步段读走码值，随后立刻擦除缓冲区，
      // 使付款码在内存里的存活时间压到一次同步调用之内。
      onSubmitCode()
      clearBuffer()
    },
    [authCodeBufferRef, clearBuffer, onSubmitCode],
  )

  /**
   * 规范要求「提交、失败、超时、切页、窗口隐藏时立即清空缓冲区」。
   * 提交/失败在容器层擦除，切页靠卸载；这里补上窗口隐藏与本组件卸载两条。
   */
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === 'hidden') clearBuffer()
    }
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      document.removeEventListener('visibilitychange', onHidden)
      authCodeBufferRef.current = ''
    }
  }, [authCodeBufferRef, clearBuffer])

  /** 缓冲区为空时输入框也为空，Backspace 不会触发 input 事件，只能自己退格。 */
  const handleCodeKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key !== 'Backspace' || authCodeBufferRef.current.length === 0) return
      event.preventDefault()
      const next = authCodeBufferRef.current.slice(0, -1)
      authCodeBufferRef.current = next
      setAuthCodeLength(next.length)
    },
    [authCodeBufferRef],
  )

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
        // 扫码模组读满 18 位后会紧跟一个回车，落到这里就是第二次提交。
        // 容器层 PrintCashierPage 的 codeSubmitLockRef 是同步锁、已经挡住了它；
        // 这里再挡一道：自动提交后缓冲区已清空，尾随回车在本层就是空操作，
        // 不会走到父层的 18 位校验去弹一个莫名其妙的「请输入 18 位付款码」。
        if (authCodeBufferRef.current.length !== AUTH_CODE_LENGTH) return
        onSubmitCode()
        clearBuffer()
      }}
    >
      <div>
        <p className="cashier-code-label-title">请扫描或输入手机付款码</p>
        <p className="cashier-code-label-hint">
          扫码器会自动读取并提交；也可手动输入 18 位数字。
          <br />
          为保护你的支付安全，付款码不会显示在这块公共屏幕上。
        </p>
      </div>
      {/*
        付款码输入框：永远为空。每次 input 事件都被 drainInput 抽进内存缓冲区，
        DOM 里不留码值，因此这里既不需要也不允许 value 绑定。
      */}
      <div className="cashier-code-field">
        <input
          autoFocus
          onChange={(event) => drainInput(event.currentTarget)}
          onKeyDown={handleCodeKeyDown}
          inputMode="numeric"
          autoComplete="off"
          spellCheck={false}
          aria-label="付款码输入区（内容不显示）"
          placeholder={authCodeLength > 0 ? '' : '请扫描或输入付款码'}
          disabled={codeSubmitting}
          className="cashier-code-input"
        />
        {/*
          非内容型反馈：只显示「读到第几位」，不显示任何一位码值（含尾号）。
          一次性支付凭证整串即凭证，回显尾号既无意义又能被旁观者配合摄像头拼出。
          进度点覆盖在输入框内（pointer-events:none），因为输入框永远是空的 ——
          不把进度放进去，用户看到的就是一个毫无反应的空框。
        */}
        {authCodeLength > 0 && (
          <div className="cashier-code-progress" aria-hidden="true">
            {Array.from({ length: AUTH_CODE_LENGTH }, (_, index) => (
              <span key={index} className="cashier-code-pip" data-filled={index < authCodeLength} />
            ))}
          </div>
        )}
      </div>
      <p className="cashier-code-progress-text" aria-live="polite" aria-atomic="true">
        {codeSubmitting
          ? '已读取完整付款码，正在提交…'
          : authCodeLength === 0
            ? '等待扫码'
            : authCodeLength === AUTH_CODE_LENGTH
              ? '已读取完整付款码'
              : `已读取 ${authCodeLength} / ${AUTH_CODE_LENGTH} 位`}
      </p>
      <button
        type="submit"
        disabled={codeSubmitting || authCodeLength !== AUTH_CODE_LENGTH}
        className="cashier-code-submit"
      >
        {codeSubmitting ? '正在提交…' : '确认支付'}
      </button>
      {authCodeLength > 0 && !codeSubmitting && (
        <button type="button" className="cashier-code-clear" onClick={clearBuffer}>
          清空重扫
        </button>
      )}
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
