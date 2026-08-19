// ============================================================
// PrintPickupClaimPage — 步骤4：到机码核销认领
//
// 用户用一体机扫码器扫描二维码，或手动输入小程序中的到机码，
// 调用 POST /api/v1/print/jobs/claim-pickup → 任务状态从 pending → claimed，
// 然后跳到打印进度页（/print/progress）。
//
// 到机码规格：8 位纯数字（2026-08-18 方案 A 定案）。规格常量来自
// @ai-job-print/shared 的 pickupCode —— 本页**不许再内联自己那份正则**，
// 内联副本正是「小程序发一种长度、一体机收另一种长度」的事故来源。
// 认领接口无需登录态（Kiosk = 可控设备层），后端 Throttle 20次/min/IP 防滥用。
//
// 过渡期：同时受理 10 位存量码。删除条件与后端一致（上线满 24h，到机码 TTL 到期）。
// 视觉对照 P47，但不照抄 31 键键盘、10 位混排字位、假金额或假页数。
// ============================================================

import { useEffect, useRef, useState } from 'react'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { ScanIcon, ArrowRightIcon, RotateCcwIcon, PrinterIcon } from 'lucide-react'
import { KioskPageFrame, KioskPageHeader } from '@ai-job-print/ui'
import {
  PICKUP_CODE_ACCEPTED_PATTERN,
  PICKUP_CODE_INPUT_ALPHABET,
  PICKUP_CODE_LENGTH,
  PICKUP_CODE_MAX_INPUT_LENGTH,
  PICKUP_CODE_PATTERN,
  isLegacyPickupCode,
} from '@ai-job-print/shared'
import type { TerminalDeviceStatusView } from '../../hooks/useTerminalDeviceStatus'
import { API_BASE_URL } from '../../services/api/client'
import { getTerminalId } from '../../services/api/screensaver'
import { formatCents } from './cashierStatus'
import {
  V6ArrivalCodeErrorBody,
  V6ArrivalCodeNextNotes,
  V6ArrivalCodePrinterWarn,
  V6ArrivalCodeSide,
  V6ArrivalCodeWhy,
  classifyArrivalClaimError,
  type ArrivalClaimErrorKind,
} from './V6ArrivalCodeGuide'
import './styles/print-pickup-claim.css'

// ── 到机码工具 ────────────────────────────────────────────────
const CODE_LEN = PICKUP_CODE_LENGTH
// 可键入字符 = 新码(纯数字) ∪ 存量码(31 字符集) 的并集，由 shared 常量反推，不手写。
const VALID_CHAR = new RegExp(`[^${PICKUP_CODE_INPUT_ALPHABET}]`, 'g')

/** 过滤并大写输入，去掉分隔符与非法字符，截到两套长度的较大者 */
function normalizeInput(raw: string): string {
  return raw.toUpperCase().replace(VALID_CHAR, '').slice(0, PICKUP_CODE_MAX_INPUT_LENGTH)
}

/**
 * 8 位码读满后不立即提交，而是等输入静默 250ms —— 这不是防抖美化，是防误提交。
 *
 * 存量 10 位码的字符集含 2–9，因此**旧码的前 8 位有可能全是数字**
 * （概率 (8/31)^8 ≈ 1/50000）。若读满 8 位就提交，这类用户会：
 * 提交 → 后端 PICKUP_CODE_INVALID → 本页 setCode('') 清空 → 重输 → 再次在第 8 位被截断，
 * 永远取不到自己已付费的文件。
 *
 * 250ms 的取值依据：USB/HID 扫码器按键间隔约 5ms，10 位存量码全部键入耗时 <100ms，
 * 远小于静默窗口，因此扫码永远不会命中 8 位分支；扫码器随后附带的 Enter 会立即提交。
 * 存量码删除后（上线满 24h），本函数与该定时器可一并移除。
 */
const SETTLE_MS = 250

// ── 接口类型 ──────────────────────────────────────────────────
interface ClaimPickupResult {
  released: boolean
  taskId?: string
  orderId: string
  orderNo: string
  terminalId: string | null
  taskStatus: string
  printTaskStatus: string
  amountCents?: number
  priceLines?: unknown[]
  fileName?: string | null
  paymentSessionToken: string
}

type ClaimState = 'idle' | 'loading' | 'success' | 'error'

class ClaimPickupError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.name = 'ClaimPickupError'
    this.code = code
  }
}

// ── API 调用（无登录态，Kiosk 匿名层） ────────────────────────
async function claimPickup(code: string): Promise<ClaimPickupResult> {
  const terminalId = getTerminalId()
  if (!terminalId) throw new Error('终端身份尚未就绪，请稍后重试')
  const res = await fetch(`${API_BASE_URL}/print/jobs/claim-pickup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-terminal-id': terminalId },
    body: JSON.stringify({ code }),
  })
  const body = (await res.json()) as {
    taskId?: string
    orderId?: string
    orderNo?: string
    terminalId?: string | null
    taskStatus?: string
    printTaskStatus?: string
    error?: { code?: string; message?: string }
    message?: string | string[]
  }
  if (!res.ok) {
    const errCode = body.error?.code ?? 'CLAIM_FAILED'
    const errMsg =
      body.error?.message ??
      (Array.isArray(body.message) ? body.message.join('; ') : (body.message as string | undefined)) ??
      `到机码无效或已过期（${errCode}）`
    throw new ClaimPickupError(errCode, errMsg)
  }
  return body as ClaimPickupResult
}

// ── 组件 ──────────────────────────────────────────────────────
export function PrintPickupClaimPage() {
  const navigate = useNavigate()
  const device = useOutletContext<TerminalDeviceStatusView | undefined>()
  const inputRef = useRef<HTMLInputElement>(null)
  const claimLockRef = useRef(false)
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [code, setCode] = useState('')
  const [state, setState] = useState<ClaimState>('idle')
  const [result, setResult] = useState<ClaimPickupResult | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [errorKind, setErrorKind] = useState<ArrivalClaimErrorKind>('invalid')
  const [lastAttemptCode, setLastAttemptCode] = useState('')

  const isValid = PICKUP_CODE_ACCEPTED_PATTERN.test(code)

  const cancelSettle = () => {
    if (settleTimerRef.current) {
      clearTimeout(settleTimerRef.current)
      settleTimerRef.current = null
    }
  }
  useEffect(() => cancelSettle, [])

  const handleClaim = async (inputCode = code) => {
    cancelSettle()
    const submittedCode = normalizeInput(inputCode)
    if (!PICKUP_CODE_ACCEPTED_PATTERN.test(submittedCode) || claimLockRef.current) return
    claimLockRef.current = true
    setCode(submittedCode)
    setLastAttemptCode(submittedCode)
    setState('loading')
    setErrorMsg('')
    try {
      const data = await claimPickup(submittedCode)
      setResult(data)
      setState('success')
    } catch (err) {
      claimLockRef.current = false
      setCode('')
      const kind = err instanceof ClaimPickupError ? classifyArrivalClaimError(err.code) : 'invalid'
      setErrorKind(kind)
      setErrorMsg(err instanceof Error ? err.message : '请求失败，请重试')
      setState('error')
      setTimeout(() => inputRef.current?.focus(), 80)
    }
  }

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextCode = normalizeInput(e.target.value)
    setCode(nextCode)
    cancelSettle()
    if (state === 'error') { setState('idle'); setErrorMsg('') }
    // USB/HID 扫码器会像键盘一样一次性输入二维码内容。
    // 存量 10 位码读满即自动核销（它不可能再长，无歧义）；
    // 提交锁同时拦住扫码器随后附带的 Enter，避免重复请求。
    if (isLegacyPickupCode(nextCode)) {
      void handleClaim(nextCode)
      return
    }
    // 8 位新码则等静默 250ms 再提交：旧码前 8 位可能恰好全为数字，
    // 立即提交会把这类用户永久卡死在「输入被截断 → 认领失败 → 清空」的循环里。
    if (PICKUP_CODE_PATTERN.test(nextCode)) {
      settleTimerRef.current = setTimeout(() => {
        settleTimerRef.current = null
        void handleClaim(nextCode)
      }, SETTLE_MS)
    }
  }

  const handleReset = () => {
    cancelSettle()
    setCode('')
    setState('idle')
    setResult(null)
    setErrorMsg('')
    setLastAttemptCode('')
    claimLockRef.current = false
    setTimeout(() => inputRef.current?.focus(), 80)
  }

  // ── 成功：提示排队，跳进度页 ─────────────────────────────────
  if (state === 'success' && result) {
    return (
      <KioskPageFrame className="v6-pickup-claim-page">
        <KioskPageHeader
          title="认领成功"
          description={result.released ? '打印任务已进入队列，请稍候出纸' : '订单核验成功，请先完成现场支付'}
          onBack={() => navigate('/print-scan')}
          backLabel="返回"
        />
        <div className="pickup-claim-success" data-w2-page="pickup-claim-success" aria-live="polite">
          <div className="pcs-icon-wrap">
            <PrinterIcon size={48} className="pcs-icon" />
          </div>
          <h2 className="pcs-title">{result.released ? '打印任务已释放' : '订单核验成功'}</h2>
          <p className="pcs-sub">{result.released ? '等待打印机排队出纸' : '付款成功后系统才会创建打印任务，不会提前出纸'}</p>

          <dl className="pcs-meta">
            <div className="pcs-row">
              <dt>订单号</dt>
              <dd>{result.orderNo}</dd>
            </div>
            {result.fileName ? (
              <div className="pcs-row">
                <dt>文件</dt>
                <dd>{result.fileName}</dd>
              </div>
            ) : null}
            {typeof result.amountCents === 'number' ? (
              <div className="pcs-row">
                <dt>应付</dt>
                <dd>{formatCents(result.amountCents)}</dd>
              </div>
            ) : null}
            {result.terminalId && (
              <div className="pcs-row">
                <dt>终端</dt>
                <dd>{result.terminalId}</dd>
              </div>
            )}
          </dl>
          <V6ArrivalCodeNextNotes released={result.released} />

          <div className="pcs-actions">
            <button
              type="button"
              className="k-btn pcs-primary"
              data-variant="primary"
              onClick={() => navigate(result.released ? '/print/progress' : '/print/cashier', {
                state: result.released
                  ? { taskId: result.taskId, orderId: result.orderId, paymentSessionToken: result.paymentSessionToken }
                  : {
                      orderId: result.orderId,
                      orderNo: result.orderNo,
                      amountCents: result.amountCents,
                      priceLines: result.priceLines ?? [],
                      paymentSessionToken: result.paymentSessionToken,
                      file: result.fileName ? { filename: result.fileName } : undefined,
                    },
              })}
            >
              <ArrowRightIcon size={20} />
              {result.released ? '查看打印进度' : '进入现场支付'}
            </button>
            <button type="button" className="k-btn pcs-secondary" data-variant="ghost" data-size="sm" onClick={handleReset}>
              <RotateCcwIcon size={18} />
              再取一件
            </button>
          </div>
        </div>
      </KioskPageFrame>
    )
  }

  // ── 输入界面 ──────────────────────────────────────────────────
  return (
    <KioskPageFrame className="v6-pickup-claim-page">
      <KioskPageHeader
        title="到机码核销"
        description={`扫描小程序二维码，或输入 ${CODE_LEN} 位到机码`}
        onBack={() => navigate('/print-scan')}
        backLabel="返回"
      />

      <div className="pickup-claim-page" data-w2-page="pickup-claim" data-claim-state={state}>
        <V6ArrivalCodePrinterWarn
          kind={device?.kind ?? 'unknown'}
          loading={device?.loading ?? true}
          printerLabel={device?.printerLabel ?? '已配置打印机'}
        />
        <div className="pcp-lead">
          <span className="pcp-lead-icon" aria-hidden="true"><ScanIcon size={32} /></span>
          <div className="pcp-lead-copy">
            <span className="pcp-status">等待扫码输入</span>
            <p className="pcp-lead-text">
              打开小程序「我的 → 打印订单 → 查看到机码」，将二维码对准本机扫码器；无法扫码时可手动输入。
            </p>
          </div>
        </div>

        <div className="pcp-input-section">
          <label className="pcp-label" htmlFor="pickup-code-input">
            扫码结果 / 到机码（{CODE_LEN} 位）
          </label>
          {/* 小程序会把码显示为 12-34-56；分隔符不进入状态或接口。 */}
          <div className="pcp-input-wrap">
            <input
              id="pickup-code-input"
              ref={inputRef}
              className={['pcp-input', state === 'error' ? 'pcp-input--error' : ''].filter(Boolean).join(' ')}
              type="text"
              // 纯数字码必须唤起数字键盘。用 inputMode 而非 type="number"：
              // 后者会吞掉前导 0、渲染上下箭头，且过渡期还要能键入 10 位存量码的字母。
              inputMode="numeric"
              placeholder="例：28491703"
              // 上限取两套长度的较大者（存量 10 位）×3，容纳粘贴进来的分隔符；
              // 真正的长度判定在 normalizeInput + 受理正则，不靠 maxLength。
              maxLength={PICKUP_CODE_MAX_INPUT_LENGTH * 3}
              value={code}
              onChange={handleInput}
              onKeyDown={e => { if (e.key === 'Enter') void handleClaim(code) }}
              autoFocus
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              aria-label="到机码输入框"
              aria-invalid={state === 'error'}
              aria-describedby={state === 'error' ? 'pcp-error-msg' : 'pcp-hint'}
            />
            {/* 计数器按当前输入形态显示目标长度：正在输入存量码时不该催用户「只要 8 位」。 */}
            <div id="pcp-hint" className={`pcp-counter ${isValid ? 'pcp-counter--full' : ''}`}>
              {code.length} / {code.length > CODE_LEN ? PICKUP_CODE_MAX_INPUT_LENGTH : CODE_LEN}
            </div>
          </div>
        </div>

        <p className="pcp-format-hint">
          到机码为 {CODE_LEN} 位数字；扫码器读满后自动核销。
          {' '}早前下单拿到的 {PICKUP_CODE_MAX_INPUT_LENGTH} 位旧码仍然有效，可直接输入。
        </p>

        <V6ArrivalCodeWhy />

        {state === 'error' && (
          <div id="pcp-error-msg" className="pcp-error" role="alert">
            <V6ArrivalCodeErrorBody kind={errorKind} message={errorMsg} lastCode={lastAttemptCode} />
          </div>
        )}

        <button
          type="button"
          className="k-btn pcp-submit"
          data-variant="primary"
          disabled={!isValid || state === 'loading'}
          onClick={() => void handleClaim()}
          aria-busy={state === 'loading'}
        >
          {state === 'loading' ? (
            <>
              <span className="pcp-spinner" aria-hidden />
              认领中…
            </>
          ) : (
            <>
              <ArrowRightIcon size={20} />
              确认取件
            </>
          )}
        </button>

        <div className="pcp-help">
          <p className="pch-title">怎么找到机码？</p>
          <ol className="pch-steps">
            <li>打开小程序，点击底部「我的」</li>
            <li>选择「打印订单」，找到待取件订单</li>
            <li>点击「查看到机码」，对准扫码器；也可手动输入 {CODE_LEN} 位数字</li>
          </ol>
          <V6ArrivalCodeSide />
        </div>
      </div>
    </KioskPageFrame>
  )
}
