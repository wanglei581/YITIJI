// ============================================================
// PrintPickupClaimPage — 步骤4：扫码取件认领
//
// 用户用一体机扫码器扫描二维码，或手动输入小程序中的取件码，
// 调用 POST /api/v1/print/jobs/claim-pickup → 任务状态从 pending → claimed，
// 然后跳到打印进度页（/print/progress）。
//
// 取件码规格：10位，字符集 23456789ABCDEFGHJKMNPQRSTUVWXYZ（32个无歧义字符）。
// 认领接口无需登录态（Kiosk = 可控设备层），后端 Throttle 20次/min/IP 防滥用。
// ============================================================

import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ScanIcon, ArrowRightIcon, RotateCcwIcon, PrinterIcon } from 'lucide-react'
import { KioskPageHeader } from '@ai-job-print/ui'
import { PrintPageFrame } from './PrintPrototypeLayout'
import { API_BASE_URL } from '../../services/api/client'
import { getTerminalId } from '../../services/api/screensaver'
import './styles/print-pickup-claim.css'

// ── 取件码工具 ────────────────────────────────────────────────
// 合法字符：32个无歧义字符（去掉 0,1,I,O）
const VALID_CHAR = /[^23456789ABCDEFGHJKMNPQRSTUVWXYZ]/g
const CODE_LEN = 10
const VALID_CODE = /^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{10}$/

/** 过滤并大写输入，去掉非法字符，截 10 位 */
function normalizeInput(raw: string): string {
  return raw.toUpperCase().replace(VALID_CHAR, '').slice(0, CODE_LEN)
}

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
      `取件码无效或已过期（${errCode}）`
    throw new Error(errMsg)
  }
  return body as ClaimPickupResult
}

// ── 组件 ──────────────────────────────────────────────────────
export function PrintPickupClaimPage() {
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const claimLockRef = useRef(false)

  const [code, setCode] = useState('')
  const [state, setState] = useState<ClaimState>('idle')
  const [result, setResult] = useState<ClaimPickupResult | null>(null)
  const [errorMsg, setErrorMsg] = useState('')

  const isValid = VALID_CODE.test(code)

  const handleClaim = async (inputCode = code) => {
    const submittedCode = normalizeInput(inputCode)
    if (!VALID_CODE.test(submittedCode) || claimLockRef.current) return
    claimLockRef.current = true
    setCode(submittedCode)
    setState('loading')
    setErrorMsg('')
    try {
      const data = await claimPickup(submittedCode)
      setResult(data)
      setState('success')
    } catch (err) {
      claimLockRef.current = false
      setCode('')
      setErrorMsg(err instanceof Error ? err.message : '请求失败，请重试')
      setState('error')
      setTimeout(() => inputRef.current?.focus(), 80)
    }
  }

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextCode = normalizeInput(e.target.value)
    setCode(nextCode)
    if (state === 'error') { setState('idle'); setErrorMsg('') }
    // USB/HID 扫码器会像键盘一样一次性输入二维码内容。读满 10 位即
    // 自动核销；提交锁同时拦住扫码器随后附带的 Enter，避免重复请求。
    if (VALID_CODE.test(nextCode)) void handleClaim(nextCode)
  }

  const handleReset = () => {
    setCode('')
    setState('idle')
    setResult(null)
    setErrorMsg('')
    claimLockRef.current = false
    setTimeout(() => inputRef.current?.focus(), 80)
  }

  // ── 成功：提示排队，跳进度页 ─────────────────────────────────
  if (state === 'success' && result) {
    return (
      <PrintPageFrame>
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
            {result.terminalId && (
              <div className="pcs-row">
                <dt>终端</dt>
                <dd>{result.terminalId}</dd>
              </div>
            )}
          </dl>

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
      </PrintPageFrame>
    )
  }

  // ── 输入界面 ──────────────────────────────────────────────────
  return (
    <PrintPageFrame>
      <KioskPageHeader
        title="扫码取件"
        description="扫描小程序二维码，或输入 10 位取件码"
        onBack={() => navigate('/print-scan')}
        backLabel="返回"
      />

      <div className="pickup-claim-page" data-w2-page="pickup-claim" data-claim-state={state}>
        {/* 说明区 */}
        <div className="pcp-lead">
          <span className="pcp-lead-icon" aria-hidden="true"><ScanIcon size={32} /></span>
          <div className="pcp-lead-copy">
            <span className="pcp-status">等待扫码输入</span>
            <p className="pcp-lead-text">
              打开小程序「我的 → 打印订单 → 查看取件码」，将二维码对准本机扫码器；无法扫码时可手动输入。
            </p>
          </div>
        </div>

        {/* 输入框 */}
        <div className="pcp-input-section">
          <label className="pcp-label" htmlFor="pickup-code-input">
            扫码结果 / 取件码（{CODE_LEN} 位）
          </label>
          {/* 小程序会把码显示为 AB-2C-…；分隔符不进入状态或接口。 */}
          <div className="pcp-input-wrap">
            <input
              id="pickup-code-input"
              ref={inputRef}
              className={['pcp-input', state === 'error' ? 'pcp-input--error' : ''].filter(Boolean).join(' ')}
              type="text"
              inputMode="text"
              placeholder="例：AB2C7M9P3K"
              maxLength={CODE_LEN * 3}
              value={code}
              onChange={handleInput}
              onKeyDown={e => { if (e.key === 'Enter') void handleClaim(code) }}
              autoFocus
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              aria-label="取件码输入框"
              aria-invalid={state === 'error'}
              aria-describedby={state === 'error' ? 'pcp-error-msg' : 'pcp-hint'}
            />
            <div id="pcp-hint" className={`pcp-counter ${code.length === CODE_LEN ? 'pcp-counter--full' : ''}`}>
              {code.length} / {CODE_LEN}
            </div>
          </div>
        </div>

        {/* 格式说明 */}
        <p className="pcp-format-hint">
          扫码器读满后自动核销；手动码由大写字母和数字组成，不含 0、1、I、O
        </p>

        {/* 错误信息 */}
        {state === 'error' && (
          <div id="pcp-error-msg" className="pcp-error" role="alert">
            ⚠ {errorMsg}
          </div>
        )}

        {/* 确认按钮 */}
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

        {/* 操作指引 */}
        <div className="pcp-help">
          <p className="pch-title">怎么找取件码？</p>
          <ol className="pch-steps">
            <li>打开小程序，点击底部「我的」</li>
            <li>选择「打印订单」，找到待取件订单</li>
            <li>点击「查看取件码」，对准扫码器；也可输入 {CODE_LEN} 位码</li>
          </ol>
        </div>
      </div>
    </PrintPageFrame>
  )
}
