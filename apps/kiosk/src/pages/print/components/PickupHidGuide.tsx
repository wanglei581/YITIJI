import type { ReactNode } from 'react'
import { KioskNumpad } from '../../../components/kiosk-numpad/KioskNumpad'
import {
  AlertCircleIcon,
  CheckIcon,
  FileTextIcon,
  InfoIcon,
  LockIcon,
  QrCodeIcon,
  ShieldCheckIcon,
  WifiOffIcon,
} from 'lucide-react'
import {
  PICKUP_CODE_LENGTH,
  PICKUP_CODE_MAX_INPUT_LENGTH,
} from '@ai-job-print/shared'
import { LEGACY_KEYS, type ClaimSuccessCopy, type PickupFailure, type PickupScreen } from '../pickupClaimModel'

// 到机码页（原型 11-arrival-code.html）的展示件。只接收页面算好的数据与回调，
// 不发请求、不判定成败；认领、终端身份与离页作废都在 PrintPickupClaimPage 里。

/** 稿 11 各屏页头的说明句。页头标题全程是「输入你的到机码」，变化的只有这一句。 */
export function PickupSubtitle({ screen }: { screen: PickupScreen }) {
  switch (screen) {
    case 'legacy':
      return <>旧码在这里输：<b>{PICKUP_CODE_MAX_INPUT_LENGTH} 位带字母的历史码</b>（早前下单拿到的）。新码（{PICKUP_CODE_LENGTH} 位纯数字）请回新码键盘。</>
    case 'verifying':
      return <>正在请服务端校验这串码，<b>稍等片刻</b>。</>
    case 'invalid-or-expired':
      return <>这串码<b>没通过校验</b>。</>
    case 'locked':
      return <>输错次数太多，<b>这台机器的输码暂时停用了</b>。</>
    case 'network-error':
      return <>暂时没有拿到<b>可信的校验结果</b>。</>
    case 'failed':
      return <>这次<b>没能完成校验</b>。</>
    case 'success':
      return <>校验通过，<b>打印订单已认领</b>。</>
    default:
      return <>在手机小程序<b>「我的 → 打印订单」</b>里拿到的那串码，新码是 <b>{PICKUP_CODE_LENGTH} 位纯数字</b>。输入后这台机器会认领你的打印订单。</>
  }
}

/**
 * 到机码页的 hid 扫码指引（原型 11-arrival-code.html `rHid()`）。
 *
 * 这一屏教的是「去哪儿扫、怎么扫」，不是扫码器状态。
 * 2026-09-07 Windows 真机实测（PR #913）：模组靠接近感应触发、不常亮；
 * 能读手机屏幕上的码，但需要把亮度调高。亮度这一句稿里没有，照实写。
 */
export function PickupHidGuide({
  echo,
  errorMsg,
}: {
  echo: ReactNode
  errorMsg: string
}) {
  return (
    <>
      <div className="qx-card pcp-hid-card pcp-enter">
        <div className="pcp-hid-stage" aria-hidden="true">
          <span className="pcp-hid-corner pcp-hid-corner--tl" />
          <span className="pcp-hid-corner pcp-hid-corner--tr" />
          <span className="pcp-hid-corner pcp-hid-corner--bl" />
          <span className="pcp-hid-corner pcp-hid-corner--br" />
          <div className="pcp-hid-phone">
            <QrCodeIcon size={38} />
          </div>
        </div>
        <div className="pcp-hid-main">
          <p className="pcp-hid-t">请出示手机上的码</p>
          <p className="pcp-hid-s" id="pcp-hid-hint">
            打开小程序里的到机码页面，把手机屏幕对准<strong>机身侧面的扫码区</strong>。
            扫码模组靠接近感应触发，不会一直亮着。
            <strong>把手机屏幕亮度调高</strong>，再把屏幕凑近扫码区。
            扫到的内容以 USB 键盘方式输入，和手输走同一套校验规则。
          </p>
          {echo}
          {errorMsg ? (
            <div id="pcp-error-msg" className="pcp-error" role="alert">
              ⚠ {errorMsg}
            </div>
          ) : null}
        </div>
      </div>

      <section className="qx-card pcp-hid-ab" aria-label="两种扫码的区别">
        <h2 className="pcp-hid-ab-t">两种「扫码」不是一回事</h2>
        <div className="pcp-hid-ab-cols">
          <div className="pcp-hid-ab-col is-current">
            <b>本页：机器读你的手机</b>
            <span>机身扫码区读取你手机上的到机码，扫到自动校验。</span>
          </div>
          <div className="pcp-hid-ab-col">
            <b>另一处：你用手机扫屏幕</b>
            <span>手机传文件、扫码登录是扫这台机器的屏幕，去「文件来源」页。</span>
          </div>
        </div>
      </section>
    </>
  )
}

export function PickupThreeCodeCard() {
  return (
    <section className="qx-card pcp-ab" aria-label="三种码的区别">
      <h2 className="pcp-ab-t"><InfoIcon size={22} aria-hidden="true" />三种码，别搞混</h2>
      <div className="pcp-ab-cols">
        <div className="pcp-ab-col is-current">
          <b>到机码 · 本页用</b>
          <span>{PICKUP_CODE_LENGTH} 位纯数字（旧码 {PICKUP_CODE_MAX_INPUT_LENGTH} 位），对应一笔打印订单。</span>
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
  )
}

/**
 * 历史码键盘（稿 alphaKb）。键位就是存量码字符集，键盘上没有 0/O/1/I/L。
 * 与 KioskNumpad 同一约定：onPointerDown + preventDefault，不夺输入框焦点，
 * 扫码器与触屏可以随时交替；只改字符串，不校验、不提交。
 */
export function PickupAlphaKeys({
  value,
  onChange,
  disabled,
}: {
  value: string
  onChange: (next: string) => void
  disabled: boolean
}) {
  const press = (next: string) => {
    if (!disabled) onChange(next)
  }
  return (
    <div className="pcp-alpha" role="group" aria-label="历史码键盘" data-testid="pickup-alpha-keypad">
      {LEGACY_KEYS.map(ch => (
        <button
          key={ch}
          type="button"
          className="pcp-alpha-key"
          disabled={disabled}
          aria-label={ch}
          onPointerDown={event => {
            event.preventDefault()
            if (value.length < PICKUP_CODE_MAX_INPUT_LENGTH) press(value + ch)
          }}
        >
          {ch}
        </button>
      ))}
      <button
        type="button"
        className="pcp-alpha-key pcp-alpha-del"
        disabled={disabled || value.length === 0}
        aria-label="删除"
        onPointerDown={event => {
          event.preventDefault()
          press(value.slice(0, -1))
        }}
      >
        ⌫ 删除
      </button>
    </div>
  )
}

/** 码位格（稿 .codebox）：只做显示，aria-hidden；真实输入在覆盖其上的透明 input 里。 */
export function PickupCodeBoxes({ cells, cursor, error }: { cells: string[]; cursor: number; error: boolean }) {
  return (
    <div className={`pcp-codebox${cells.length > PICKUP_CODE_LENGTH ? ' pcp-codebox--legacy' : ''}`} aria-hidden="true">
      {cells.map((ch, i) => (
        <span
          key={i}
          className={['pcp-cb', ch ? 'is-filled' : '', !ch && i === cursor ? 'is-cur' : '', error ? 'is-err' : '']
            .filter(Boolean).join(' ')}
        >
          {ch}
        </span>
      ))}
    </div>
  )
}

/**
 * 键盘卡（稿 .kb）：说明 → 数字键或历史码字母键 → 确认行。确认键由页面传入（submit），
 * 它与提交锁、静默窗口是同一条提交路径，留在页面里。
 * 页内键盘是必需品：Windows 全屏 Kiosk 下 inputMode 不会唤起任何系统键盘。
 */
export function PickupKeypadCard({
  code,
  loading,
  legacyMode,
  onChange,
  onLegacyMode,
  submit,
}: {
  code: string
  loading: boolean
  legacyMode: boolean
  onChange: (next: string) => void
  onLegacyMode: (legacy: boolean) => void
  submit: ReactNode
}) {
  return (
    <section className="qx-card pcp-keypad-card" data-inert={loading || undefined} aria-label="到机码键盘">
      <p className="pcp-keypad-note" id="pcp-hint">
        {loading
          ? '正在校验，键盘暂时不可用——校验结果出来后会自动恢复。'
          : legacyMode
            ? <>历史码一共 <b>{PICKUP_CODE_MAX_INPUT_LENGTH} 位</b>，不含 <b>0、O、1、I、L</b>，键盘上没有这几个键——不用担心认错。读满 {PICKUP_CODE_MAX_INPUT_LENGTH} 位自动校验。</>
            : <>新码是 <b>{PICKUP_CODE_LENGTH} 位纯数字</b>：输满稍停片刻自动校验，或按「确认校验」。早前下单拿到的 <b>{PICKUP_CODE_MAX_INPUT_LENGTH} 位旧码</b>点左下角「输入历史码」。</>}
      </p>
      {legacyMode ? (
        <PickupAlphaKeys value={code} onChange={onChange} disabled={loading} />
      ) : (
        <KioskNumpad
          value={code}
          onChange={onChange}
          maxLength={PICKUP_CODE_MAX_INPUT_LENGTH}
          disabled={loading}
          label="到机码数字键盘"
          leadKey={{
            text: '输入历史码',
            ariaLabel: `输入 ${PICKUP_CODE_MAX_INPUT_LENGTH} 位历史码`,
            onPress: () => onLegacyMode(true),
          }}
        />
      )}
      <div className="pcp-kb-foot">
        {legacyMode && (
          <button
            type="button"
            className="qx-btn pcp-kb-back"
            disabled={loading}
            onPointerDown={e => e.preventDefault()}
            onClick={() => onLegacyMode(false)}
          >
            ← 回到 {PICKUP_CODE_LENGTH} 位新码键盘
          </button>
        )}
        {submit}
      </div>
    </section>
  )
}

/** 稿 outs()：码找不到时的另外三条路，不是把同一条路再讲一遍。 */
export function PickupOutsStrip({ onHid, onHelp }: { onHid: () => void; onHelp: () => void }) {
  return (
    <div className="qx-card pcp-help">
      <p className="pch-title">码找不到了？</p>
      <ul className="pch-steps pch-outs">
        <li>
          <b>回手机小程序看</b>
          <span>「我的 → 打印订单」</span>
        </li>
        <li>
          <button type="button" className="pch-out-btn" onClick={onHid}>
            <b>用机身扫码区</b>
            <span>免输码</span>
          </button>
        </li>
        <li>
          <button type="button" className="pch-out-btn" onClick={onHelp}>
            <b>问工作人员</b>
            <span>帮你查订单</span>
          </button>
        </li>
      </ul>
    </div>
  )
}

/**
 * 认领失败的四种屏（稿 rInvalid / rLocked / rNetwork，外加「其他」）。
 * message 由页面经 userMessageOf 映射，这里只摆位置；role="alert" 每屏恰好一个。
 */
export function PickupFailurePanel({
  failure,
  message,
  onReset,
  onRetry,
  onHelp,
  onHome,
}: {
  failure: PickupFailure
  message: string
  onReset: () => void
  onRetry: () => void
  onHelp: () => void
  onHome: () => void
}) {
  if (failure === 'locked' || failure === 'network') {
    const locked = failure === 'locked'
    return (
      <section className={`qx-card pcp-block pcp-enter pcp-block--${locked ? 'locked' : 'net'}`}>
        <div className="pcp-block-head" id="pcp-error-msg" role="alert">
          <span className="pcp-block-ico">
            {locked ? <LockIcon size={40} aria-hidden="true" /> : <WifiOffIcon size={40} aria-hidden="true" />}
          </span>
          <p className="pcp-block-t">
            {locked ? '本机输码暂时停用' : '本次校验结果尚未确认'}
            <small>{locked ? '这台机器连续输错次数过多，服务端临时停用了取件' : '可能是网络或服务暂时不可用；请勿据此认为订单已认领'}</small>
          </p>
        </div>
        <p className="pcp-block-body">
          {locked ? (
            <>这是为了防止有人在公共机器上反复试码。停用<b>过一段时间会自动解除</b>，你的码不会因为停用而作废，到时候再输就行；着急的话请找现场工作人员。</>
          ) : (
            <>可以用<b>同一串码重试校验</b>，服务端会按同一终端核对已认领状态，不会因此重复出纸；如果仍拿不到结果，请找工作人员核实订单。</>
          )}
        </p>
        <div className="pcp-actions">
          {locked ? (
            <>
              <button type="button" className="qx-btn pcp-act" data-variant="ghost" onClick={onHome}>先回首页</button>
              <button type="button" className="qx-btn pcp-act pcp-act--staff" data-testid="arrival-code-primary" onClick={onHelp}>
                联系工作人员获取帮助
              </button>
            </>
          ) : (
            <>
              <button type="button" className="qx-btn pcp-act pcp-act--go" data-testid="arrival-code-primary" onClick={onRetry}>
                重试校验
              </button>
              <button type="button" className="qx-btn pcp-act" data-variant="ghost" onClick={onHelp}>联系工作人员</button>
            </>
          )}
        </div>
      </section>
    )
  }

  return (
    <>
      <div id="pcp-error-msg" className="pcp-strip pcp-strip--error pcp-enter" role="alert">
        <AlertCircleIcon size={28} aria-hidden="true" />
        <span>
          {message}
          {failure === 'invalid' ? (
            <small>不存在、已过期或不属于这台机器的码，都会显示这一句——不提示具体原因，是为了防止有人试探别人的码。</small>
          ) : null}
        </span>
      </div>
      <div className="pcp-actions">
        <button type="button" className="qx-btn pcp-act pcp-act--go" data-testid="arrival-code-primary" onClick={onReset}>
          清除，重新输入
        </button>
        <button type="button" className="qx-btn pcp-act" data-variant="ghost" onClick={onHelp}>
          {failure === 'invalid' ? '查看取码说明 / 找工作人员' : '找工作人员'}
        </button>
      </div>
    </>
  )
}

/**
 * 认领成功卡（稿 rSuccess）。标题、步骤与主按钮文案全部来自服务端 released 分支，
 * 订单号 / 文件名 / 金额只转述回执，缺哪项就不显示哪项，不补演示值。
 */
export function PickupWinCard({
  copy,
  orderNo,
  meta,
  onReset,
  primary,
}: {
  copy: ClaimSuccessCopy
  orderNo: string
  meta: string
  onReset: () => void
  primary: ReactNode
}) {
  return (
    <>
      <section className="qx-card pcp-win pcp-enter" aria-label="认领结果">
        <div className="pcp-win-head">
          <span className="pcp-win-ico"><CheckIcon size={40} strokeWidth={3} aria-hidden="true" /></span>
          <div className="pcp-win-tx">
            <p className="pcp-win-t">{copy.title}</p>
            <p className="pcp-win-s">{copy.line}</p>
          </div>
        </div>
        <div className="pcp-win-file">
          <FileTextIcon size={40} aria-hidden="true" />
          <div className="pcp-win-fm">
            <p className="pcp-win-fn">打印订单 <span className="qx-num">{orderNo}</span></p>
            {meta ? <p className="pcp-win-fs">{meta}</p> : null}
          </div>
        </div>
        <ol className="pcp-win-steps">
          {copy.steps.map((step, index) => (
            <li key={step}><span className="pcp-win-no" aria-hidden="true">{index + 1}</span>{step}</li>
          ))}
        </ol>
        <div className="pcp-actions">
          <button type="button" className="qx-btn pcp-act" data-variant="ghost" onClick={onReset}>再取一件</button>
          {primary}
        </div>
      </section>
      <p className="pcp-safe">
        <ShieldCheckIcon size={24} aria-hidden="true" />
        <span>结束会话或闲置超时后，会<b>清除本机登录态和临时会话信息</b>，下一个人无法查看。订单与文件按服务端留存期限管理。</span>
      </p>
    </>
  )
}
