// ============================================================
// PrintPickupClaimPage — 步骤4：扫码取件认领
//
// 用户在一体机上输入取件码（手机小程序「打印订单」页显示），
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

  const [code, setCode] = useState('')
  const [state, setState] = useState<ClaimState>('idle')
  const [result, setResult] = useState<ClaimPickupResult | null>(null)
  const [errorMsg, setErrorMsg] = useState('')

  const isValid = VALID_CODE.test(code)

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCode(normalizeInput(e.target.value))
    if (state === 'error') { setState('idle'); setErrorMsg('') }
  }

  const handleClaim = async () => {
    if (!isValid || state === 'loading') return
    setState('loading')
    setErrorMsg('')
    try {
      const data = await claimPickup(code)
      setResult(data)
      setState('success')
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '请求失败，请重试')
      setState('error')
    }
  }

  const handleReset = () => {
    setCode('')
    setState('idle')
    setResult(null)
    setErrorMsg('')
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
        <div className="pickup-claim-success">
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
              className="btn-kiosk primary"
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
            <button className="btn-kiosk ghost" onClick={handleReset}>
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
        description="输入手机上的取件码，即可从本机出纸"
        onBack={() => navigate('/print-scan')}
        backLabel="返回"
      />

      <div className="pickup-claim-page">
        {/* 说明区 */}
        <div className="pcp-lead">
          <ScanIcon size={32} className="pcp-lead-icon" />
          <p className="pcp-lead-text">
            请在手机小程序「我的 → 打印订单」中找到待取件订单，记下 {CODE_LEN} 位取件码，在此输入。
          </p>
        </div>

        {/* 输入框 */}
        <div className="pcp-input-section">
          <label className="pcp-label" htmlFor="pickup-code-input">
            取件码（{CODE_LEN} 位）
          </label>
          <input
            id="pickup-code-input"
            ref={inputRef}
            className={['pcp-input', state === 'error' ? 'pcp-input--error' : ''].filter(Boolean).join(' ')}
            style={{ minHeight: '56px' }}
            type="text"
            inputMode="text"
            placeholder="例：AB2C7M9P3K"
            maxLength={CODE_LEN}
            value={code}
            onChange={handleInput}
            onKeyDown={e => { if (e.key === 'Enter') void handleClaim() }}
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

        {/* 格式说明 */}
        <p className="pcp-format-hint">
          取件码由大写字母和数字组成，不含易混淆字符（0、1、I、O）
        </p>

        {/* 错误信息 */}
        {state === 'error' && (
          <div id="pcp-error-msg" className="pcp-error" role="alert">
            ⚠ {errorMsg}
          </div>
        )}

        {/* 确认按钮 */}
        <button
          className={['btn-kiosk', 'primary', 'block', !isValid || state === 'loading' ? 'disabled' : ''].filter(Boolean).join(' ')}
          disabled={!isValid || state === 'loading'}
          onClick={() => void handleClaim()}
          aria-busy={state === 'loading'}
        >
          {state === 'loading' ? (
            <>
              <span className="spinner-sm" aria-hidden />
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
            <li>点击「查看取件码」，记下 {CODE_LEN} 位码输入上方</li>
          </ol>
        </div>
      </div>
    </PrintPageFrame>
  )
}
