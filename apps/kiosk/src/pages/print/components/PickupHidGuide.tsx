import type { ReactNode } from 'react'
import { KioskNumpad } from '../../../components/kiosk-numpad/KioskNumpad'
import {
  AlertCircleIcon,
  InfoIcon,
  LockIcon,
  QrCodeIcon,
  WifiOffIcon,
} from 'lucide-react'
import { helpNeededLine, peekSupportContact, printProblemLine } from '../../../copy/unattendedCopy'
import {
  PICKUP_CODE_LENGTH,
  PICKUP_CODE_MAX_INPUT_LENGTH,
} from '@ai-job-print/shared'
import {
  LEGACY_KEYS,
  PICKUP_SAME_CODE_RESUME_NOTE,
  type PickupFailure,
  type PickupScreen,
} from '../pickupClaimModel'

// 到机码页（原型 11-arrival-code.html）的展示件。只接收页面算好的数据与回调，
// 不发请求、不判定成败；认领、终端身份与离页作废都在 PrintPickupClaimPage 里。

/** 稿 11 各屏页头的说明句。页头标题全程是「输入你的到机码」，变化的只有这一句。 */
export function PickupSubtitle({ screen }: { screen: PickupScreen }) {
  switch (screen) {
    case 'legacy':
      return <>输入早前订单中的 <b>{PICKUP_CODE_MAX_INPUT_LENGTH} 位到机码</b>。核对订单、完成后续步骤，领取打印件。</>
    case 'verifying':
      return <>正在请系统校验这串码，<b>稍等片刻</b>。</>
    case 'invalid-or-expired':
      return <>这串码<b>没通过校验</b>。</>
    case 'locked':
      return <>输错次数太多，<b>这台机器的输码暂时停用了</b>。</>
    case 'network-error':
      return <>暂时没有拿到<b>可信的校验结果</b>。</>
    case 'closed':
      return <>这个到机码<b>不能再用来取件</b>。</>
    case 'failed':
      return <>这次<b>没能完成校验</b>。</>
    case 'success':
      return <>校验通过，<b>打印订单已认领</b>。</>
    default:
      return peekSupportContact().miniappPublished
        ? <>打开手机小程序<b>「我的 → 打印订单」</b>，找到 {PICKUP_CODE_LENGTH} 位到机码。核对订单后，领取打印件。</>
        : <>输入 {PICKUP_CODE_LENGTH} 位到机码。核对订单后，领取打印件。</>
  }
}

/**
 * 稿 .codehint：左边示意图、右边一句主话加一句说明，输码页的唯一一块说明卡。
 * 默认画手机里「打印订单」页的示意；扫码枪那一态换成机身扫码区的示意。
 * 手机示意里不画示例码——示例数字不当真，也不能被当成可核销的码。
 */
export function PickupHintCard({
  art,
  title,
  desc,
  descId,
  status = false,
  children,
}: {
  art: 'phone' | 'scan'
  title: ReactNode
  desc: ReactNode
  descId: string
  /** 校验中那一态：读屏当状态播报。 */
  status?: boolean
  children?: ReactNode
}) {
  return (
    <section className="pcp-hint" aria-label="输码说明" role={status ? 'status' : undefined}>
      {art === 'phone' ? (
        <div className="pcp-hint-art pcp-phone" aria-hidden="true">
          <div className="pcp-phone-top">打印订单</div>
          <div className="pcp-phone-card">
            <small>到机码</small>
            <i />
          </div>
          <div className="pcp-phone-line" />
          <div className="pcp-phone-line pcp-phone-line--s" />
        </div>
      ) : (
        <div className="pcp-hint-art pcp-scanart" aria-hidden="true">
          <span className="pcp-hid-corner pcp-hid-corner--tl" />
          <span className="pcp-hid-corner pcp-hid-corner--tr" />
          <span className="pcp-hid-corner pcp-hid-corner--bl" />
          <span className="pcp-hid-corner pcp-hid-corner--br" />
          <div className="pcp-scanart-phone">
            <QrCodeIcon size={44} />
          </div>
        </div>
      )}
      <div className="pcp-hint-tx">
        <b className="pcp-hint-t">{title}</b>
        <span className="pcp-hint-d" id={descId}>{desc}</span>
        {children}
      </div>
    </section>
  )
}

/**
 * 到机码页的扫码枪说明（稿 pickup 点「用扫码枪扫」后在说明卡里展开的那一句，不另加一块高度）。
 *
 * 这里教的是「去哪儿扫、怎么扫」，不是扫码器状态。
 * 2026-09-07 Windows 真机实测（PR #913）：模组靠接近感应触发、不常亮；
 * 能读手机屏幕上的码，但需要把亮度调高。亮度这一句稿里没有，照实写。
 * 说明原句由页面传入（原句在 PrintPickupClaimPage），本件只管摆位置、回显与错误条。
 */
export function PickupHidGuide({
  line,
  echo,
  errorMsg,
  actions,
}: {
  line: string
  echo: ReactNode
  errorMsg: string
  actions: ReactNode
}) {
  return (
    <PickupHintCard
      art="scan"
      title="用扫码枪扫"
      descId="pcp-hid-hint"
      desc={<>{peekSupportContact().miniappPublished ? '打开小程序里的到机码页面，' : ''}{line}</>}
    >
      {echo}
      {errorMsg ? (
        <span id="pcp-error-msg" className="pcp-error" role="alert">
          ⚠ {errorMsg}
        </span>
      ) : null}
      {actions}
    </PickupHintCard>
  )
}

/** 两种「扫码」不是一回事：本页是机器读你的手机，手机传文件、扫码登录是手机扫屏幕。收在折叠里，扫码枪那一态才出现。 */
export function PickupScanKinds() {
  return (
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
  )
}

/** 方案②：到机码就是取件码，不再单列第三种码。函数名沿用，避免改动页面对这张卡的引用锚点。
 *  续打说明放在这一栏，不放键盘说明：键盘说明多一行会在 1280×720 横屏把「确认校验」挤出可视区。 */
export function PickupThreeCodeCard() {
  return (
    <section className="qx-card pcp-ab" aria-label="两种码的区别">
      <h2 className="pcp-ab-t"><InfoIcon size={22} aria-hidden="true" />两种码，别搞混</h2>
      <div className="pcp-ab-cols">
        <div className="pcp-ab-col is-current">
          <b>到机码 · 本页用</b>
          <span>{PICKUP_CODE_LENGTH} 位纯数字（旧码 {PICKUP_CODE_MAX_INPUT_LENGTH} 位），对应一笔打印订单。取件和接着打都用它。</span>
          <span className="pcp-ab-note">{PICKUP_SAME_CODE_RESUME_NOTE}</span>
        </div>
        <div className="pcp-ab-col">
          <b>上传码 · 手机传文件用</b>
          <span>用于把手机文件传到本机。</span>
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
 * 键盘卡（稿 .keypad）：数字键（左下清空、右下删一位）或历史码字母键。
 * 历史码与扫码枪的切换放在键盘下面一行（稿 .d3-pickrow），确认键在底栏，都在页面里。
 * 页内键盘是必需品：Windows 全屏 Kiosk 下 inputMode 不会唤起任何系统键盘。
 */
export function PickupKeypadCard({
  code,
  loading,
  legacyMode,
  onChange,
}: {
  code: string
  loading: boolean
  legacyMode: boolean
  onChange: (next: string) => void
}) {
  return (
    <section className="pcp-keypad-card" data-inert={loading || undefined} aria-label="到机码键盘">
      {legacyMode ? (
        <PickupAlphaKeys value={code} onChange={onChange} disabled={loading} />
      ) : (
        <KioskNumpad
          value={code}
          onChange={onChange}
          maxLength={PICKUP_CODE_MAX_INPUT_LENGTH}
          disabled={loading}
          label="到机码数字键盘"
          delText="删一位"
        />
      )}
    </section>
  )
}

/** 历史码一行说明（稿 .d3-note2）：键盘上没有 0/O/1/I/L，所以不会认错。 */
export function PickupLegacyNote() {
  return (
    <p className="pcp-note2" id="pcp-hint">
      历史码一共 <b>{PICKUP_CODE_MAX_INPUT_LENGTH} 位</b>，不含 <b>0、O、1、I、L</b>，键盘上没有这几个键，不会认错。读满 {PICKUP_CODE_MAX_INPUT_LENGTH} 位自动校验。
    </p>
  )
}

/** 稿 outs()：码找不到时的另外三条路，不是把同一条路再讲一遍。 */
export function PickupOutsStrip({ onHid, onHelp }: { onHid: () => void; onHelp: () => void }) {
  return (
    <div className="qx-card pcp-help">
      <p className="pch-title">码找不到了？</p>
      <ul className="pch-steps pch-outs">
        {peekSupportContact().miniappPublished ? (
          <li>
            <b>回手机小程序看</b>
            <span>「我的 → 打印订单」</span>
          </li>
        ) : null}
        <li>
          <button type="button" className="pch-out-btn" onClick={onHid}>
            <b>用机身扫码区</b>
            <span>免输码</span>
          </button>
        </li>
        <li>
          <button type="button" className="pch-out-btn" onClick={onHelp}>
            <b>使用帮助</b>
            <span>查订单说明</span>
          </button>
        </li>
      </ul>
    </div>
  )
}

/**
 * 认领失败的五种屏（稿 rInvalid / rLocked / rNetwork，外加「码已是终态」与「其他」）。
 * message 由页面经 pickupClaimMessage 映射，这里只摆位置；role="alert" 每屏恰好一个。
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
            <small>{locked ? '这台机器连续输错次数过多，取件暂时停用' : '可能是网络或服务暂时不可用；请勿据此认为订单已认领'}</small>
          </p>
        </div>
        <p className="pcp-block-body">
          {locked ? (
            <>这是为了防止有人在公共机器上反复试码。停用<b>过一段时间会自动解除</b>，你的码不会因为停用而作废，到时候再输就行。{helpNeededLine()}</>
          ) : (
            <>可以用<b>同一串码重试校验</b>，系统会按这台机器核对已认领状态，不会因此重复出纸。如果仍拿不到结果，{printProblemLine()}</>
          )}
        </p>
        <div className="pcp-actions">
          {locked ? (
            <>
              <button type="button" className="qx-btn pcp-act" data-variant="ghost" onClick={onHome}>先回首页</button>
              <button type="button" className="qx-btn pcp-act pcp-act--staff" data-testid="arrival-code-primary" onClick={onHelp}>
                使用帮助
              </button>
            </>
          ) : (
            <>
              <button type="button" className="qx-btn pcp-act pcp-act--go" data-testid="arrival-code-primary" onClick={onRetry}>
                重试校验
              </button>
              <button type="button" className="qx-btn pcp-act" data-variant="ghost" onClick={onHelp}>使用帮助</button>
            </>
          )}
        </div>
      </section>
    )
  }

  // 终态码（已用过、已退款、文件失效……）：在这台机器上重输不会有别的结果，
  // 主操作给「回到首页」把屏让给下一位；输另一个码是次要出口。不出现「重试 / 重新输入同一个码」。
  if (failure === 'closed') {
    return (
      <>
        <div id="pcp-error-msg" className="pcp-strip pcp-strip--error pcp-enter" role="alert">
          <AlertCircleIcon size={28} aria-hidden="true" />
          <span>{message}</span>
        </div>
        <div className="pcp-actions">
          <button type="button" className="qx-btn pcp-act pcp-act--go" data-testid="arrival-code-primary" onClick={onHome}>
            回到首页
          </button>
          <button type="button" className="qx-btn pcp-act" data-variant="ghost" onClick={onReset}>
            输另一个到机码
          </button>
        </div>
      </>
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
        <button type="button" className="qx-btn pcp-act pcp-act--go" data-testid="arrival-code-primary" onClick={failure === 'printer' ? onRetry : onReset}>
          {failure === 'printer' ? '重试校验' : '清除，重新输入'}
        </button>
        <button type="button" className="qx-btn pcp-act" data-variant="ghost" onClick={onHelp}>
          {failure === 'invalid' ? '查看取码说明 / 使用帮助' : '使用帮助'}
        </button>
      </div>
    </>
  )
}
