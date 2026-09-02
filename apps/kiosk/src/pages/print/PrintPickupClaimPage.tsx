// ============================================================
// PrintPickupClaimPage — 步骤4：扫码取件认领
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
// ============================================================

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRightIcon, RotateCcwIcon, PrinterIcon } from 'lucide-react'
import {
  PICKUP_CODE_ACCEPTED_PATTERN,
  PICKUP_CODE_INPUT_ALPHABET,
  PICKUP_CODE_LENGTH,
  PICKUP_CODE_MAX_INPUT_LENGTH,
  PICKUP_CODE_PATTERN,
  isLegacyPickupCode,
} from '@ai-job-print/shared'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { API_BASE_URL } from '../../services/api/client'
import { getTerminalId } from '../../services/api/screensaver'
import './styles/pickup-claim-qx.css'
import { KioskNumpad } from '../../components/kiosk-numpad/KioskNumpad'

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
    throw new Error(errMsg)
  }
  return body as ClaimPickupResult
}

// ── 组件 ──────────────────────────────────────────────────────
export function PrintPickupClaimPage() {
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const claimLockRef = useRef(false)
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [code, setCode] = useState('')
  const [state, setState] = useState<ClaimState>('idle')
  const [result, setResult] = useState<ClaimPickupResult | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  // 只影响显示几个码位格与提示文案；受理正则同时接受 8 位新码与 10 位历史码，
  // 这个开关不参与任何格式判定，也不影响提交。
  const [legacyMode, setLegacyMode] = useState(false)

  const isValid = PICKUP_CODE_ACCEPTED_PATTERN.test(code)
  // 已输入超过 8 位时按历史码展示，不必等用户去点开关。
  const cellCount = legacyMode || code.length > CODE_LEN ? PICKUP_CODE_MAX_INPUT_LENGTH : CODE_LEN
  const codeCells = Array.from({ length: cellCount }, (_, i) => code[i] ?? '')

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

  // 输入的唯一入口：手输、HID 扫码器、页内数字键盘三条来源共用这一条路径，
  // 保证格式判据、静默窗口与提交锁对三者完全一致。
  const applyCode = (raw: string) => {
    const nextCode = normalizeInput(raw)
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

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => applyCode(e.target.value)

  const handleReset = () => {
    cancelSettle()
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
      <QxPageFrame
        title="认领成功"
        subtitle={result.released ? '打印任务已进入队列，请稍候出纸' : '订单核验成功，请先完成现场支付'}
        terminalLabel="就业服务大厅"
        ctabar={
          <>
            <p className="why">{result.released ? '出纸完成前请留在取件口旁边。' : '付款成功后系统才会创建打印任务，不会提前出纸。'}</p>
            <button type="button" className="qx-btn" data-variant="ghost" onClick={handleReset}>
              <RotateCcwIcon size={18} />再取一件
            </button>
            <button
              type="button"
              className="qx-btn"
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
          </>
        }
      >
        <div className="qx-scroll pickup-claim-success" data-w2-page="pickup-claim-success" aria-live="polite">
          <div className="qx-state" data-tone="empty">
            <span className="qx-state-ic"><PrinterIcon size={30} /></span>
            <div>
              <div className="qx-state-t">{result.released ? '打印任务已释放' : '订单核验成功'}</div>
              <div className="qx-state-d">{result.released ? '等待打印机排队出纸。' : '付款成功后系统才会创建打印任务，不会提前出纸。'}</div>
            </div>
          </div>

          <div className="qx-rows">
            <div className="qx-row" style={{ cursor: 'default' }}>
              <span className="qx-row-tx"><span className="qx-row-t">订单号</span></span>
              <span className="qx-num" style={{ fontSize: 24 }}>{result.orderNo}</span>
            </div>
            {result.terminalId && (
              <div className="qx-row" style={{ cursor: 'default' }}>
                <span className="qx-row-tx"><span className="qx-row-t">终端</span></span>
                <span className="qx-num" style={{ fontSize: 24 }}>{result.terminalId}</span>
              </div>
            )}
          </div>

        </div>
      </QxPageFrame>
    )
  }

  // ── 输入界面 ──────────────────────────────────────────────────
  return (
    <QxPageFrame
      title="输入你的到机码"
      subtitle={`在手机小程序「我的 → 打印订单」里拿到的那串码，新码是 ${CODE_LEN} 位纯数字。`}
      terminalLabel="就业服务大厅"
      ctabar={
        <>
          <p className="why">输错可以改，不作废；这一步不收钱。</p>
          <button type="button" className="qx-btn" data-variant="ghost" onClick={() => navigate('/print-scan')}>返回</button>
          <button
            type="button"
            className="qx-btn pcp-submit"
            data-variant="primary"
            disabled={!isValid || state === 'loading'}
            onClick={() => void handleClaim()}
            aria-busy={state === 'loading'}
          >
            {state === 'loading'
              ? (<><span className="pcp-spinner" aria-hidden />认领中…</>)
              : (<><ArrowRightIcon size={20} />确认校验</>)}
          </button>
        </>
      }
    >
      <div className="qx-scroll pickup-claim-page" data-w2-page="pickup-claim" data-claim-state={state}>
        {/* 码位格：真实 input 透明覆盖在格子上——HID 扫码器与物理键盘仍然直接打进 input，
            格子只做显示。既保住扫码通路，又让站着的人一眼看出还差几位。 */}
        <div className="qx-card pcp-input-section">
          <label className="pcp-label" htmlFor="pickup-code-input">
            扫码结果 / 到机码
          </label>
          {/* 小程序会把码显示为 12-34-56；分隔符不进入状态或接口。 */}
          <div className="pcp-input-wrap">
            <div
              className={`pcp-codebox${codeCells.length > CODE_LEN ? ' pcp-codebox--legacy' : ''}`}
              aria-hidden="true"
            >
              {codeCells.map((ch, i) => (
                <span
                  key={i}
                  className={[
                    'pcp-cb',
                    ch ? 'is-filled' : '',
                    !ch && i === code.length ? 'is-cur' : '',
                    state === 'error' ? 'is-err' : '',
                  ].filter(Boolean).join(' ')}
                >
                  {ch}
                </span>
              ))}
            </div>
            <input
              id="pickup-code-input"
              ref={inputRef}
              className={['pcp-input', state === 'error' ? 'pcp-input--error' : ''].filter(Boolean).join(' ')}
              type="text"
              // 纯数字码必须唤起数字键盘。用 inputMode 而非 type="number"：
              // 后者会吞掉前导 0、渲染上下箭头，且过渡期还要能键入 10 位存量码的字母。
              inputMode="numeric"
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
              {code.length} / {codeCells.length}
            </div>
          </div>
        </div>

        {/* 三条安心提示。说的是本页行为，不是任何服务端数据，所以可以直接写死。
            站在机器前的人最担心的就是「输错了这码是不是就废了」。 */}
        <ul className="pcp-easy">
          <li>输错可以改，不作废</li>
          <li>这一步不收钱</li>
          <li>输满稍停自动校验，也可按「确认校验」</li>
        </ul>

        {/* 页内数字键盘：Windows 全屏 Kiosk 下 inputMode 不会唤起任何系统键盘，
            没有物理键盘的用户在扫码失败时原本无法输入到机码。 */}
        <div className="qx-card pcp-keypad-card">
          <p className="pcp-keypad-note">
            新码是 <b>{CODE_LEN} 位纯数字</b>：输满稍停片刻自动校验，或按「确认校验」。
            早前下单拿到的 <b>{PICKUP_CODE_MAX_INPUT_LENGTH} 位旧码</b>点左下角「输入历史码」。
          </p>
          <KioskNumpad
            value={code}
            onChange={applyCode}
            maxLength={PICKUP_CODE_MAX_INPUT_LENGTH}
            disabled={state === 'loading'}
            label="到机码数字键盘"
            leadKey={{
              text: legacyMode ? '回到新码' : '输入历史码',
              ariaLabel: legacyMode ? '回到 8 位新码' : '输入 10 位历史码',
              active: legacyMode,
              // 只切显示格数与提示；受理正则同时接受两种码，不改判据也不清空已输内容。
              onPress: () => setLegacyMode(v => !v),
            }}
          />

        {/* 错误信息 */}
        {state === 'error' && (
          <div id="pcp-error-msg" className="pcp-error" role="alert">
            ⚠ {errorMsg}
          </div>
        )}

        </div>

        {/* 三种码对照：现场最高频的求助是「我手上这串码是哪种」——
            到机码、上传码、取件凭证码长得像，用途完全不同。 */}
        <section className="qx-card pcp-ab" aria-label="三种码的区别">
          <h2 className="pcp-ab-t">三种码，别搞混</h2>
          <div className="pcp-ab-cols">
            <div className="pcp-ab-col is-current">
              <b>到机码 · 本页用</b>
              <span>{CODE_LEN} 位纯数字（旧码 {PICKUP_CODE_MAX_INPUT_LENGTH} 位），对应一笔打印订单。</span>
            </div>
            <div className="pcp-ab-col">
              <b>上传码 · 手机传文件用</b>
              <span>在手机上传页出示，有效期以服务端返回为准。</span>
            </div>
            <div className="pcp-ab-col">
              <b>取件凭证码 · 取纸/补打用</b>
              <span>打印完成后才有，给工作人员核验或代取——本页不输它。</span>
            </div>
          </div>
        </section>

        {/* 兜底出口。原本这里是「怎么找到机码」的三步说明，但真正卡住的人
            需要的是另一条路，不是把同一条路再讲一遍。 */}
        <div className="qx-card pcp-help">
          <p className="pch-title">码找不到了？</p>
          <ul className="pch-steps pch-outs">
            <li><b>回手机小程序看</b><span>「我的 → 打印订单」</span></li>
            <li><b>用机身扫码区</b><span>免输码</span></li>
            <li><b>问工作人员</b><span>帮你查订单</span></li>
          </ul>
        </div>
      </div>
    </QxPageFrame>
  )
}
