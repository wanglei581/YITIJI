/* 手机确认登录的逐态文案（稿 51 screen=qr-login 的口径，逐条对应服务端事实）。
 * 只返回数据，不渲染；页面与 components/MobileQrLoginParts.tsx 负责落版。
 * 硬边界：不写「登录成功 / 已登录」（手机只拿到 confirmed，登录要一体机自己 claim）；
 * 不编一体机名称；不报系统读不到的剩余秒数；不展示错误码与工程内部名。 */
import {
  type MobileQrFacts,
  type MobileQrState,
  type SendErrorKind,
  type SendLimitKind,
  QR_TICKET_TTL_SECONDS,
  RETRY_GATE_SECONDS,
  sendBlockedBy,
  sendVerb,
} from './mobileQrLoginModel'
import { maskPhone } from '../../utils/maskPii'

export type QrIconKey = 'alert' | 'ban' | 'check' | 'clock' | 'help' | 'info' | 'loader' | 'lock' | 'qr' | 'wait'
export type QrTone = 'error' | 'warn' | 'ok' | 'calm'
export type FactRow = readonly [string, string]

export interface QrDeviceCopy { name: string; unknown: boolean; desc: string }
export interface QrStateCardCopy { kind: 'info' | 'warn' | 'error' | 'done'; icon: QrIconKey; head: string; body: string }
export interface QrTakeoverCopy { device: QrDeviceCopy; card: QrStateCardCopy; facts: readonly FactRow[] }
export interface QrAlertCopy { tone: 'error' | 'warn'; icon: QrIconKey; head: string; body: string }
export interface QrNoticeCopy { tone: QrTone; icon: QrIconKey; text: string; id: string }

export interface QrCopyContext extends MobileQrFacts {
  deviceLabel: string | null
  limitKind: SendLimitKind
  sendError: SendErrorKind
  serverMessage: string
}

const TICKET_INTACT = '这张二维码没有因此作废。'

/** 顶栏副标题拆成「固定标题 + 状态尾巴」两段，标题这一段在所有状态下都不变。 */
export function chromeCopy(state: MobileQrState): { suffix: string; tag: string } {
  if (state === 'ticket-expired') return { suffix: '需回一体机重新生成', tag: '需回一体机' }
  if (state === 'confirm-unknown') return { suffix: '结果需回一体机核对', tag: '结果待核对' }
  return { suffix: '确认后回一体机', tag: '登录接力' }
}

export function takeoverCopy(state: MobileQrState, deviceLabel: string | null): QrTakeoverCopy | null {
  if (state === 'missing-ticket') {
    return {
      device: { name: '尚未识别一体机', unknown: true, desc: '这个链接缺少必要的登录信息，本页无法确认你要登录哪台机器。' },
      card: { kind: 'warn', icon: 'qr', head: '这个链接不能用来登录', body: '请回到一体机，在屏幕上重新生成二维码后再扫一次。二维码不要转发给别人。' },
      facts: [
        ['为什么', '登录信息只在扫码时由一体机生成，转发或收藏的旧链接可能不完整。'],
        ['怎么办', '回一体机登录页选「扫码」，用手机相机重新扫屏幕上的二维码。'],
      ],
    }
  }
  if (state === 'checking') {
    return {
      device: { name: '正在识别一体机', unknown: true, desc: '正在核对这个二维码是否还有效，请稍候。' },
      card: { kind: 'info', icon: 'loader', head: '正在检查二维码', body: '还没确认这台机器之前，这一页不会让你填手机号。' },
      facts: [],
    }
  }
  if (state === 'status-error') {
    return {
      device: { name: '尚未识别一体机', unknown: true, desc: '二维码状态这次没读到，本页还不知道它是否有效。' },
      card: { kind: 'error', icon: 'alert', head: '二维码状态读取失败', body: '可能只是网络没连上。可以先重试一次；仍然失败就回一体机刷新二维码。' },
      facts: [
        ['先试这个', '点上面的「重新检查二维码」再读一次；网络恢复后通常就能继续。'],
        ['时限', `二维码自一体机生成起共 ${QR_TICKET_TTL_SECONDS} 秒，到期只能在一体机上重新生成。`],
        ['安全', '本页不显示二维码里的登录信息。'],
      ],
    }
  }
  if (state === 'ticket-expired') {
    return {
      device: { name: deviceLabel ?? '这台一体机', unknown: !deviceLabel, desc: '这台机器上的这张二维码，已经不能再用来确认登录了。' },
      card: { kind: 'warn', icon: 'qr', head: '这个二维码不能再确认了', body: '它可能已经超时，也可能已经被一体机领取或已经确认过。请先回一体机看屏幕上的结果。' },
      facts: [
        ['怎么办', '先看一体机屏幕：已经登录就直接在一体机上继续；没有登录就在一体机上重新生成二维码，再扫一次。'],
        ['为什么没有重试', '这张二维码在系统里已经不能再确认，在手机上重试只会再失败一次。'],
        ['安全', '不要用别人转发给你的链接或二维码登录。'],
      ],
    }
  }
  if (state === 'confirmed') {
    return {
      device: { name: deviceLabel ?? '刚才那台一体机', unknown: !deviceLabel, desc: '你在手机上的确认已经提交，手机这边到此为止，接下来看这台机器的屏幕。' },
      card: { kind: 'done', icon: 'check', head: '已确认，请回一体机继续', body: '手机这一步只做了「确认」。一体机还要继续校验并领取这次确认，能不能进入账号以一体机屏幕上的结果为准。' },
      facts: [
        ['手机端做了什么', '完成了手机号验证，并确认了本次一体机登录请求。'],
        ['手机端没做什么', '没有在手机上登录，也没有把账号带到手机浏览器里；这一页不代表一体机已经登录。'],
        ['回一体机之后', '按一体机屏幕上的结果继续；如果没有进入账号，就在一体机上重新生成二维码再扫一次。'],
        ['离开之前', '在一体机上办完事记得点退出登录，公共设备不要留登录态。'],
      ],
    }
  }
  return null
}

/** 表单屏的机器卡。compact：已发过码或屏上压着一条错误时收成一行，让原因和下一步留在首屏。 */
export function formDeviceCopy(deviceLabel: string | null, compact: boolean): QrDeviceCopy & { note: string } {
  const unknown = !deviceLabel
  return {
    name: deviceLabel ?? '一体机名称未提供',
    unknown,
    desc: compact
      ? (unknown ? '这次登录请求没带机器名称。' : '正在为这台机器确认登录。')
      : (unknown ? '这次登录请求里没有机器名称，本页无法显示是哪一台。' : '这台一体机正在请求登录你的账号。'),
    note: compact ? '' : (unknown
      ? '请核对面前一体机屏幕上的二维码，确认就是你刚才亲手扫的那一张，再往下填。'
      : '请核对：这个名称和你面前这台机器一致，二维码也是你刚才亲手扫的那一张。'),
  }
}

function sentence(message: string): string {
  return /[。！？.!?]$/.test(message) ? message : `${message}。`
}

export function formAlertCopy(c: QrCopyContext): QrAlertCopy | null {
  const verb = sendVerb(c)
  if (c.state === 'send-error') {
    if (c.sendError === 'channel') {
      return { tone: 'error', icon: 'alert', head: '验证码没有发出去', body: '短信通道这次没能把验证码发出来。你之前收到过的验证码也已经作废，需要重新获取一次；现在就可以再点「获取验证码」。' }
    }
    if (c.sendError === 'unknown') {
      return { tone: 'warn', icon: 'help', head: '验证码这次有没有发出，本页不知道', body: `请求没有拿到明确结果，可能是网络中断。本页不能确认短信是否发出，所以不开放验证码输入；请稍后再点「${verb}」重新获取一条。如果提示太频繁，说明上一次可能已经发出，等按钮倒计时走完再获取。` }
    }
    return { tone: 'error', icon: 'alert', head: '验证码没有发出去', body: c.serverMessage ? `${sentence(c.serverMessage)}请核对手机号后再试。` : '系统没有接受这次请求。请核对手机号后再试；仍然不行就回一体机换其他登录方式，或请现场工作人员协助。' }
  }
  if (c.state === 'send-limited') {
    const noCode = c.locked && !c.hasUsableCode ? '你手上那条验证码已经不能用了，这次重新获取又被挡下，所以现在没有可以填的验证码。' : ''
    if (c.limitKind === 'tomorrow') {
      return { tone: 'warn', icon: 'clock', head: '这个号码今天不能再获取验证码了', body: `${maskPhone(c.dailyLimitedPhone ?? c.phone)} 今天的验证码次数已经用完，请明天再试。${noCode}这一条等下去不会变，所以「${verb}」对这个号码已经不能点；急着办可以换一个本人手机号，或者回一体机请现场工作人员协助。` }
    }
    return { tone: 'warn', icon: 'clock', head: '现在获取得太频繁了', body: `刚刚已经请求过，或者当前网络、当前这台手机的请求太密集，系统暂时没有再发。${noCode}现在不能马上重试：「${verb}」已经被本页拦住，还要等多久、什么时候能再点，按钮上和它下面那条说明写着。系统那边还要多久，本页看不到，不给你报一个假的秒数。` }
  }
  if (c.state === 'confirm-code-invalid') {
    return { tone: 'error', icon: 'alert', head: '验证码不正确', body: `刚才填的这条不对，输入框已经清空。这次错误没有用掉你收到的验证码，可以核对短信里最新的一条再填一次。但验证码有有效期，也有尝试次数上限，继续失败或者已经过期时就得重新获取。${TICKET_INTACT}` }
  }
  if (c.state === 'confirm-code-expired') {
    return { tone: 'warn', icon: 'clock', head: '这条验证码已经不能用了', body: `它可能已经超过有效期，也可能已经用过一次。重填同一条不会通过，请点下面的「重新获取」拿一条新的再确认。${TICKET_INTACT}` }
  }
  if (c.state === 'confirm-code-locked') {
    return { tone: 'warn', icon: 'lock', head: '验证码试得太多次了', body: `为了防止有人逐个猜码，系统已经把这条验证码作废，输入框也已清空。请点下面的「重新获取」拿一条新的再确认。${TICKET_INTACT}` }
  }
  if (c.state === 'confirm-rejected') {
    return { tone: 'error', icon: 'alert', head: '这次确认没有通过', body: c.serverMessage ? `${sentence(c.serverMessage)}${TICKET_INTACT}` : `系统没有接受这次确认。可以核对手机号和验证码后再试；仍然不行就回一体机换其他登录方式，或请现场工作人员协助。${TICKET_INTACT}` }
  }
  if (c.state === 'confirm-unknown') {
    return { tone: 'warn', icon: 'help', head: '这次确认有没有成功，本页不知道', body: '请求已经发出去了，但没有拿到明确结果，可能是网络中断，也可能是结果没能传回这一页。不要在这里反复点确认 —— 先回一体机看屏幕，那边显示的才是真结果。' }
  }
  return null
}

/** 发码按钮点不动时，「什么时候 / 怎么才能再点」写在按钮旁边。 */
export function sendBlockNoticeCopy(c: QrCopyContext): QrNoticeCopy | null {
  const blocked = sendBlockedBy(c)
  const verb = sendVerb(c)
  if (blocked === 'retry-gate') {
    return { tone: 'warn', icon: 'wait', id: 'retry-gate', text: `现在不能${verb}：本页按正常重发间隔留了 ${RETRY_GATE_SECONDS} 秒最短等待，按钮上倒数的就是这个数。系统那边还要多久，本页看不到，也不会编一个给你。等按钮能点了可以再试一次，那一次仍然可能再被挡下。` }
  }
  if (blocked === 'daily-limit') {
    return { tone: 'warn', icon: 'ban', id: 'daily-limit', text: `这个手机号今天不能再获取验证码，等下去也不会变。${c.locked ? '点上面的「更换」，改成另一个本人手机号就可以继续。' : '把上面的手机号改成另一个本人手机号就可以继续。'}不方便换号就回一体机换其他登录方式，或请现场工作人员协助。` }
  }
  if (blocked === 'cooldown' && c.state === 'send-limited') {
    return { tone: 'calm', icon: 'clock', id: 'cooldown', text: '按钮上倒数的是上一次成功发码之后的重发间隔，这个数是系统给的。它走完之后本页才会再判断能不能重新获取。' }
  }
  if (c.state === 'send-limited' && !blocked) {
    return { tone: 'calm', icon: 'info', id: 'retry-ready', text: `最短等待已经走完，现在可以再点一次「${verb}」。本页不能保证这一次就发得出去，仍然可能再被挡下。` }
  }
  return null
}

/** 表单里的状态提示。「已发送」只在发码成功过、且那条码还没被服务端销毁时出现。 */
export function formNoticesCopy(c: QrCopyContext, sentSeconds: number): QrNoticeCopy[] {
  const notices: QrNoticeCopy[] = []
  const block = sendBlockNoticeCopy(c)
  if (block) notices.push(block)
  if (c.hasUsableCode && ['code-sent', 'ready', 'device-missing', 'confirming'].includes(c.state)) {
    notices.push({ tone: 'ok', icon: 'check', id: 'sent', text: `验证码已发送至 ${maskPhone(c.phone)}，${sentSeconds} 秒后可重新获取。` })
  }
  if (!c.locked && (c.state === 'ready' || c.state === 'device-missing')) {
    notices.push({ tone: 'calm', icon: 'info', id: 'not-sent', text: '还没有获取验证码，验证码输入和确认按钮现在都不能用。' })
  }
  if (c.state === 'send-limited' && c.locked && !c.hasUsableCode) {
    notices.push({ tone: 'warn', icon: 'ban', id: 'no-usable-code', text: '现在没有可以填的验证码：旧的那条已经不能用，这次重新获取又被挡下，所以验证码输入和确认按钮暂时都不可用。' })
  }
  if (c.state === 'send-limited' && c.hasUsableCode) {
    notices.push({ tone: 'calm', icon: 'info', id: 'old-code', text: '之前收到的那条验证码可以再核对一次；本页看不到它还剩多少有效期，也不能保证它一定还有效。' })
  }
  if (c.state === 'send-loading') notices.push({ tone: 'calm', icon: 'loader', id: 'send-loading', text: '正在请求发送验证码，请不要重复点击。' })
  if (c.state === 'confirming') notices.push({ tone: 'calm', icon: 'loader', id: 'confirming', text: '正在确认，请不要关闭本页。' })
  return notices
}

export function formFactsCopy(c: QrCopyContext): readonly FactRow[] {
  if (c.state === 'confirm-unknown') {
    return [
      ['第一步', '回一体机看屏幕：已经进入账号就直接在一体机上继续办事。'],
      ['为什么不重试', '刚才那次确认可能已经生效。在手机上反复点确认，只会让你更难判断到底成没成。'],
      ['验证码', '页面保留了你刚才填的验证码，本页不会自动清空，也不会替你再提交一次。'],
      ['重新检查之后', '可能显示这张二维码已经不能再确认（多半是那次确认已经生效或已被一体机领取），也可能回到填验证码这一步（说明那次确认没送到）。'],
      ['一体机上没登录', '在一体机上重新生成二维码，再扫一次。'],
    ]
  }
  if (c.state === 'confirm-code-invalid') {
    return [
      ['下一步', '核对短信里最新的一条验证码，在上面重新填一次，再点确认。'],
      ['这次错误的影响', '这一次比较没有用掉你收到的验证码，它不会因为填错就被系统销毁。'],
      ['但不保证还能用', '它还剩多少有效期、还能再错几次，本页都看不到。再次提示已过期或已被作废时，就必须重新获取。'],
      ['二维码还在', '填错验证码不会让这张二维码失效；只要它还在有效期内，确认就能继续。'],
      ['别反复试', '同一条验证码试得太多次会被系统作废；那之后只能重新获取，而重新获取也可能被暂时挡下。'],
    ]
  }
  if (c.state === 'confirm-code-expired' || c.state === 'confirm-code-locked') {
    const locked = c.state === 'confirm-code-locked'
    return [
      ['下一步', '点上面的「重新获取」；按钮如果还在倒计时，等它走完再点。收到新的一条后填进去再确认。'],
      ['可能还要再等', '重新获取本身也可能被系统暂时挡下（发得太频繁、或今天次数用完）。真被挡下时，这一页会照实说明，不会假装已经发出。'],
      ['为什么不能重填', locked ? '这条验证码已经被系统作废，再填一次同样不会通过。' : '这条验证码在系统里已经不存在了，再填一次同样不会通过。'],
      [locked ? '为什么会这样' : '可能的原因', locked
        ? '同一条验证码连续填错太多次。这是防止有人逐个猜码的保护，不是封号，也不影响你的账号。'
        : '超过了验证码的有效期，或者这条码之前已经用过一次。'],
      ['二维码还在', '这张二维码没有因此作废；但它有自己的时限，来不及就回一体机重新生成。'],
      ['一直收不到短信', '回一体机在屏幕上换其他登录方式，或请现场工作人员协助。'],
    ]
  }
  if (c.state === 'send-limited') {
    const tomorrow = c.limitKind === 'tomorrow'
    return [
      ['为什么会这样', '为了防止短信被滥用，系统对同一个号码、同一个网络、同一台手机都设了频率上限。'],
      ['还要等多久', tomorrow
        ? '系统那边到明天才会放开，本页看不到具体时间；等在这一页没有意义。'
        : `系统那边还要多久，本页看不到，不会给你一个编出来的秒数。本页自己留了 ${RETRY_GATE_SECONDS} 秒最短等待，按钮上倒数的是这个数；它走完只是允许你再试一次，不代表一定发得出去。`],
      ['怎么才能恢复', tomorrow
        ? `换一个本人手机号，${c.locked ? '点上面的「更换」改号，' : '直接改上面的手机号，'}就能马上重新获取；这个号码今天不用再试了。`
        : `等按钮可以点了再点一次「${sendVerb(c)}」。换号不一定管用 —— 被限的可能是当前网络或这台手机，不只是这个号码。`],
      ['之前的验证码', c.locked && !c.hasUsableCode
        ? '手上那条已经不能用了，现在一条可填的都没有，只能等「重新获取」可以点了再拿一条新的。'
        : '如果刚才收到过一条，可以再核对一次；本页看不到它还剩多少有效期，也不能保证它一定还有效。'],
      ['实在等不了', '回一体机在屏幕上换其他登录方式，或请现场工作人员协助。'],
    ]
  }
  return [
    ['这一步做什么', '完成手机号验证，并确认本次一体机登录请求。'],
    ['只确认这一台', '只确认你刚才亲手扫的那台机器；别人转发或代扫的二维码不要确认。'],
    ['确认之后', '登录动作在一体机上完成，手机不会登录，也不会保存你的账号。'],
    ['手机号', '完整号码只在填写时出现在输入框里供本人核对；获取验证码后锁定并改为脱敏显示。系统中加密存储。'],
  ]
}
