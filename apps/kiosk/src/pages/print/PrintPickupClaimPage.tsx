// ============================================================
// PrintPickupClaimPage — 步骤4：扫码取件认领
//
// 用户用一体机扫码器扫描二维码，或手动输入小程序中的到机码，
// 调用 POST /api/v1/print/jobs/claim-pickup → 任务状态从 pending → claimed，
// 然后跳到打印进度页（/print/progress）。
//
// 视觉真值：docs/design/kiosk-redesign-2026-08/11-arrival-code.html（按稿逐屏：
// idle / legacy / verifying / invalid-or-expired / locked / network-error / success / hid）。
// 哪一屏只由本机输入与服务端回执决定，判定在 ./pickupClaimModel，展示件在
// ./components/PickupHidGuide；本文件只管输入、提交与离页作废。
//
// 到机码规格：8 位纯数字（2026-08-18 方案 A 定案）。规格常量来自
// @ai-job-print/shared 的 pickupCode —— 本页**不许再内联自己那份正则**，
// 内联副本正是「小程序发一种长度、一体机收另一种长度」的事故来源。
//
// 鉴权口径：认领接口不要会员登录态，但**要终端身份** —— 后端 claim-pickup 由
// TerminalIdentityGuard 把守（拿着别人的到机码在普通浏览器里核销、进而释放别人已付费的
// 文件，是这道闸门挡的事）。因此必须走 terminalProtectedFetch，而不是裸 fetch：
// 它统一补 x-terminal-id + x-terminal-session-token，并在会话票被拒时只刷新一次；
// 刷新不通就直接失败，绝不拿刚被拒的旧票重放。后端另有 Throttle 20次/min/IP 防滥用。
//
// 过渡期：同时受理 10 位存量码。删除条件与后端一致（上线满 24h，到机码 TTL 到期）。
// ============================================================

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { userMessageOf } from '../../services/api/userErrorMessage'
import { ApiHttpError } from '../../services/api/httpAdapter'
import { useNavigate } from 'react-router-dom'
import { ArrowRightIcon, CheckIcon } from 'lucide-react'
import {
  PICKUP_CODE_ACCEPTED_PATTERN,
  PICKUP_CODE_INPUT_ALPHABET,
  PICKUP_CODE_LENGTH,
  PICKUP_CODE_MAX_INPUT_LENGTH,
  PICKUP_CODE_PATTERN,
  isLegacyPickupCode,
} from '@ai-job-print/shared'
import { QxPageFrame } from '../../components/qingxu/QxPageFrame'
import { QxAppNavbar } from '../../components/qingxu/QxAppNavbar'
import { API_BASE_URL } from '../../services/api/client'
import { getTerminalId } from '../../services/api/screensaver'
import { terminalProtectedFetch } from '../../services/terminalAuth'
import './styles/pickup-claim-qx.css'
import { PickupHidGuide, PickupThreeCodeCard } from './components/PickupHidGuide'
// 上一行的导入形状被 verify:fusion-w2 逐字钉住，稿 11 其余展示件另起一行导入。
import { PickupCodeBoxes, PickupFailurePanel, PickupKeypadCard, PickupOutsStrip, PickupSubtitle, PickupWinCard } from './components/PickupHidGuide'
import { PICKUP_LOCKED_MESSAGE, classifyClaimFailure, claimMetaLine, claimSuccessCopy, failureScreen, pickupCells } from './pickupClaimModel'
import type { PickupFailure, PickupScreen } from './pickupClaimModel'

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
type GuideMode = 'keypad' | 'hid'

// ── API 调用（无会员登录态；终端身份由 terminalProtectedFetch 附带） ──
async function claimPickup(code: string, staleSignal?: AbortSignal): Promise<ClaimPickupResult> {
  const terminalId = getTerminalId()
  if (!terminalId) throw new Error('终端身份尚未就绪，请稍后重试')
  // x-terminal-id 仍显式写在这里：terminalProtectedFetch 会用 getTerminalId() 设同一个值，
  // 但这一行是「本请求按哪台机器核销」的可读契约，也是跨端门禁的取证锚点，不省。
  // staleSignal 不取消已经发出的认领；页面卸载后只是不再重放。
  const res = await terminalProtectedFetch(`${API_BASE_URL}/print/jobs/claim-pickup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'x-terminal-id': terminalId },
    body: JSON.stringify({ code }),
    staleSignal,
  })
  let body: {
    taskId?: string
    orderId?: string
    orderNo?: string
    terminalId?: string | null
    released?: boolean
    paymentSessionToken?: string
    taskStatus?: string
    printTaskStatus?: string
    error?: { code?: string; message?: string }
    message?: string | string[]
  }
  try {
    body = (await res.json()) as typeof body
  } catch {
    throw new ApiHttpError('CLAIM_RECEIPT_UNKNOWN', '本次到机码校验结果尚未确认', res.status)
  }
  if (!body || typeof body !== 'object') {
    throw new ApiHttpError('CLAIM_RECEIPT_UNKNOWN', '本次到机码校验结果尚未确认', res.status)
  }
  if (!res.ok) {
    const errCode = body.error?.code ?? 'CLAIM_FAILED'
    const errMsg =
      body.error?.message ??
      (Array.isArray(body.message) ? body.message.join('; ') : (body.message as string | undefined)) ??
      `到机码无效或已过期（${errCode}）`
    // 带错误码抛出，userMessageOf 才能按 PICKUP_CODE_* 映射用户文案，而不是落到通用兜底
    throw new ApiHttpError(errCode, errMsg, res.status)
  }
  if (
    typeof body.released !== 'boolean' ||
    !body.orderId || !body.orderNo ||
    (body.released && !body.taskId) ||
    (!body.released && !body.paymentSessionToken)
  ) {
    throw new ApiHttpError('CLAIM_RECEIPT_UNKNOWN', '本次到机码校验结果尚未确认', res.status)
  }
  return body as ClaimPickupResult
}

// ── 组件 ──────────────────────────────────────────────────────
export function PrintPickupClaimPage() {
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const claimLockRef = useRef(false)
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 卸载即作废，同时覆盖用户离开和隐私清场（清场会卸掉 children）。
  // 每次挂载新建：不能复用已经 abort 过的那只。
  const pageAliveRef = useRef<AbortController | null>(null)

  const [code, setCode] = useState('')
  const [state, setState] = useState<ClaimState>('idle')
  const [result, setResult] = useState<ClaimPickupResult | null>(null)
  const [errorMsg, setErrorMsg] = useState('')
  // 失败屏的种类与被拒的那串码（码格回显、网络重试用）。只在本组件内存里：离页 / 清场卸载即丢。
  const [failure, setFailure] = useState<{ kind: PickupFailure; code: string } | null>(null)
  // true = 显示 10 格与历史码字母键盘（稿 alphaKb）；受理正则同时接受 8 位新码与 10 位历史码，
  // 这个开关不参与任何格式判定，也不影响提交。
  const [legacyMode, setLegacyMode] = useState(false)
  // keypad = 手输；hid = 稿 rHid() 扫码指引。默认 keypad 保住数字键盘主路径；
  // hid 必须在未扫码时就可达（入口在手输页，不依赖扫到才出现）。
  const [guide, setGuide] = useState<GuideMode>('keypad')

  const isValid = PICKUP_CODE_ACCEPTED_PATTERN.test(code)
  const loading = state === 'loading'

  const cancelSettle = () => {
    if (settleTimerRef.current) {
      clearTimeout(settleTimerRef.current)
      settleTimerRef.current = null
    }
  }
  useEffect(() => cancelSettle, [])

  useEffect(() => {
    const controller = new AbortController()
    pageAliveRef.current = controller
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (state === 'success') return
    const id = window.setTimeout(() => inputRef.current?.focus(), 80)
    return () => window.clearTimeout(id)
  }, [guide, state, legacyMode])

  const handleClaim = async (inputCode = code) => {
    cancelSettle()
    const submittedCode = normalizeInput(inputCode)
    if (!PICKUP_CODE_ACCEPTED_PATTERN.test(submittedCode) || claimLockRef.current) return
    claimLockRef.current = true
    setCode(submittedCode)
    setState('loading')
    setErrorMsg('')
    setFailure(null)
    // 取本次挂载的信号。await 之后 ref 可能已指向下一次挂载，回读会把上一单画到公共屏上。
    const staleSignal = pageAliveRef.current?.signal
    try {
      const data = await claimPickup(submittedCode, staleSignal)
      if (staleSignal?.aborted) return
      setResult(data)
      setState('success')
    } catch (err) {
      if (staleSignal?.aborted) return
      claimLockRef.current = false
      setCode('')
      const kind = classifyClaimFailure(err)
      setFailure({ kind, code: submittedCode })
      setErrorMsg(kind === 'locked' ? PICKUP_LOCKED_MESSAGE : userMessageOf(err, '到机码校验没有完成，请重试或联系现场工作人员'))
      setState('error')
      setTimeout(() => inputRef.current?.focus(), 80)
    }
  }

  // 输入的唯一入口：手输、HID 扫码器、页内键盘三条来源共用这一条路径，
  // 保证格式判据、静默窗口与提交锁对三者完全一致。
  const applyCode = (raw: string) => {
    const nextCode = normalizeInput(raw)
    setCode(nextCode)
    cancelSettle()
    if (state === 'error') { setState('idle'); setErrorMsg(''); setFailure(null) }
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
    setFailure(null)
    claimLockRef.current = false
    setGuide('keypad')
    setLegacyMode(false)
    setTimeout(() => inputRef.current?.focus(), 80)
  }

  // 网络失败才给「重试校验」：认领对同一终端幂等，原码重发不会重复认领或重复出纸。
  const handleRetry = () => {
    if (failure) void handleClaim(failure.code)
  }

  const screen: PickupScreen =
    state === 'success' && result ? 'success'
      : guide === 'hid' ? 'hid'
        : loading ? 'verifying'
          : state === 'error' && failure ? failureScreen(failure.kind)
            : legacyMode ? 'legacy' : 'idle'

  // 青序壳：标题全程不变、底部导航按稿常驻；返回键按稿 aria-label="返回打印扫描"，终态「认领成功」不放——它的出口是自己的主行动。
  const frame = (body: ReactNode) => (
    <QxPageFrame
      back={screen === 'success' ? undefined : { label: '返回打印扫描', onBack: () => navigate('/print-scan') }}
      title="输入你的到机码"
      subtitle={screen === 'hid' ? <>不用手输：<strong>把手机上的码，对准机身扫码区</strong>。</> : <PickupSubtitle screen={screen} />}
      // 胶囊只标页面用途，不表示任何设备状态，所以 tone 保持 unknown。
      status={{ tone: 'unknown', label: '到机码验证' }}
      terminalLabel="就业服务大厅"
      navbar={
        <QxAppNavbar
          onHome={() => navigate('/')}
          onAdvisor={() => navigate('/assistant')}
          onProfile={() => navigate('/profile')}
        />
      }
    >
      {body}
    </QxPageFrame>
  )

  // ── 成功：稿 rSuccess，分支只看服务端 released ─────────────────
  if (state === 'success' && result) {
    const copy = claimSuccessCopy(result.released)
    return frame(
      <div
        className="qx-scroll pickup-claim-page pickup-claim-success"
        data-w2-page="pickup-claim-success"
        data-claim-state="success"
        data-testid="arrival-code-state-success"
        aria-live="polite"
      >
        <PickupWinCard
          copy={copy}
          orderNo={result.orderNo}
          meta={claimMetaLine(result.fileName, result.amountCents)}
          onReset={handleReset}
          primary={
            <button
              type="button"
              className="qx-btn pcp-act pcp-act--go pcs-primary"
              data-testid="arrival-code-primary"
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
              {copy.cta}
              <ArrowRightIcon size={24} aria-hidden="true" />
            </button>
          }
        />
        <PickupThreeCodeCard />
      </div>,
    )
  }

  const describedBy = state === 'error' ? 'pcp-error-msg' : guide === 'hid' ? 'pcp-hid-hint' : 'pcp-hint'
  const pickupCodeInput = (
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
      aria-describedby={describedBy}
    />
  )

  // ── hid 扫码指引（原型 11 rHid；未扫码即可达，不报扫码硬件状态）──
  if (guide === 'hid') {
    const echoText =
      loading
        ? '正在校验，请稍候…'
        : code.length === 0
          ? '等待扫码输入…（扫码器扫到会自动填入并校验）'
          : `已接收 ${code.length} 位`
    return frame(
      <div
        className="qx-scroll pickup-claim-page pickup-claim-hid"
        data-w2-page="pickup-claim"
        data-claim-guide="hid"
        data-claim-state={state}
        data-testid="arrival-code-state-hid"
      >
        <PickupHidGuide
          echo={
            <div className="pcp-input-wrap">
              <p className="pcp-scan-echo" id="hid-echo-code" aria-hidden="true">
                <span className="pcp-scan-dot" data-live={loading || code.length > 0 || undefined} />
                {echoText}
              </p>
              {pickupCodeInput}
            </div>
          }
          errorMsg={state === 'error' ? errorMsg : ''}
        />
        <div className="pcp-actions">
          <button
            type="button"
            className="qx-btn pcp-act pcp-hid-cta"
            data-variant="ghost"
            data-testid="arrival-code-primary"
            onClick={() => setGuide('keypad')}
          >
            还是手输吧
          </button>
          <button
            type="button"
            className="qx-btn pcp-act pcp-hid-cta"
            data-variant="ghost"
            onClick={() => navigate('/help')}
          >
            扫不出来？求助
          </button>
        </div>
        <PickupThreeCodeCard />
      </div>,
    )
  }

  // ── 手输：idle / legacy / verifying / 各失败屏 ─────────────────
  // 失败屏回显被拒的那串码（输入框本身已清空、保持聚焦，下一次扫码直接落进来）。
  const display = state === 'error' && failure ? failure.code : code
  const cells = pickupCells(display, legacyMode)
  const entering = screen === 'idle' || screen === 'legacy'
  const showKeypad = entering || screen === 'verifying'
  const goHelp = () => navigate('/help')

  return frame(
    <div
      className="qx-scroll pickup-claim-page"
      data-w2-page="pickup-claim"
      data-claim-guide="keypad"
      data-claim-state={state}
      data-claim-failure={failure?.kind}
      data-testid={`arrival-code-state-${screen}`}
    >
      {/* 码位格：真实 input 透明覆盖在格子上——HID 扫码器与物理键盘仍然直接打进 input，
          格子只做显示。锁定屏不画格子：锁定期内服务端不再核对任何码。 */}
      {screen !== 'locked' && (
        <div className="pcp-input-wrap">
          <PickupCodeBoxes
            cells={cells}
            cursor={entering ? code.length : -1}
            error={screen === 'invalid-or-expired'}
          />
          {pickupCodeInput}
        </div>
      )}

      {screen === 'idle' && (
        <>
          {/* 未扫码就要看得见「怎么扫」：扫码模组靠接近感应、不常亮。压成一条紧凑入口，
              点进去才是 rHid() 的完整指引屏。 */}
          <button type="button" className="pcp-hid-entry" onClick={() => setGuide('hid')}>
            <span className="pcp-hid-entry-t">不用手输：把手机上的码，对准机身侧面的扫码区</span>
            <span className="pcp-hid-entry-d">手机亮度调高，再凑近扫码区</span>
          </button>
          {/* 有效期不写死日期：本页拿不到服务端的过期时间，只能如实说以服务端为准。 */}
          <p className="pcp-expire-note">这串码<b>还能用多久，以服务端记录的取件码状态为准</b>；如果已经过期，校验时会直接告诉你，不会让你白输一遍。</p>
          {/* 三条安心提示说的是本页行为，不是服务端数据，所以可以直接写死。 */}
          <ul className="pcp-easy">
            <li>输错可以改，不作废</li>
            <li>这一步不收钱</li>
            <li>输满稍停自动校验，也可按「确认校验」</li>
          </ul>
        </>
      )}

      {screen === 'verifying' && (
        <p className="pcp-strip pcp-strip--checking" role="status">
          <span className="pcp-dots" aria-hidden="true"><i /><i /><i /></span>
          正在校验，请稍候
        </p>
      )}

      {state === 'error' && failure && (
        <PickupFailurePanel
          failure={failure.kind}
          message={errorMsg}
          onReset={handleReset}
          onRetry={handleRetry}
          onHelp={goHelp}
          onHome={() => navigate('/')}
        />
      )}

      {/* 页内键盘：Windows 全屏 Kiosk 下 inputMode 不会唤起任何系统键盘，
          没有物理键盘的用户在扫码失败时原本无法输入到机码。确认键按稿收在键盘最后一行。 */}
      {showKeypad && (
        <PickupKeypadCard
          code={code}
          loading={loading}
          legacyMode={legacyMode}
          onChange={applyCode}
          // 只切显示格数与键盘；受理正则同时接受两种码，不改判据也不清空已输内容。
          onLegacyMode={setLegacyMode}
          submit={
            <button
              type="button"
              className="qx-btn pcp-submit"
              data-variant="primary"
              disabled={!isValid || loading}
              // 不夺输入框焦点：扫码器随时可能接着输入。
              onPointerDown={e => e.preventDefault()}
              onClick={() => void handleClaim()}
              aria-busy={loading}
            >
              {loading
                ? (<><span className="pcp-dots" aria-hidden="true"><i /><i /><i /></span>正在校验…</>)
                : (<><CheckIcon size={26} strokeWidth={3} aria-hidden="true" />{isValid ? '确认校验' : `确认校验（输满 ${legacyMode ? PICKUP_CODE_MAX_INPUT_LENGTH : CODE_LEN} 位可用）`}</>)}
            </button>
          }
        />
      )}

      <PickupThreeCodeCard />

      {screen !== 'verifying' && screen !== 'legacy' && (
        <PickupOutsStrip onHid={() => setGuide('hid')} onHelp={goHelp} />
      )}
    </div>,
  )
}
