import { useEffect, useState } from 'react'
import { UserIcon } from 'lucide-react'
import { needsHandoverConfirm } from '../../../auth/kioskPresence'

/** 多久看一眼「空档到点了没有」。判据是 30 秒，半秒一次足够，开销可以忽略。 */
const VOICE_CHECK_EVERY_MS = 500

type IdentityVoice = 'self' | 'next'

/**
 * 首页身份行现在该对谁说话。
 *
 * 首页是公共屏，这台机器分不出站在屏前的是本人还是下一位。能用的只有一个信号：和「我的」前的「还是你吗？」、
 * 首页「继续办理」的收起同一个判据——有没有「空档满 30 秒、没人点过屏」（kioskPresence.needsHandoverConfirm）：
 *   · 没有：一直有人在点，机器就按「还是登录的那位」对待（进「我的」也不再多问），这一行对本人说话；
 *   · 有了：站在屏前的可能已经不是登录的那个人，改回对下一位说话（W-75 原句）。
 * 这个判据是粘性的（空档一到就记下，之后点屏不解除），只有本人在「还是你吗？」答「是我，继续」才翻回去。
 * 没登录时没有「说给谁」的问题，不起计时。
 */
function useIdentityVoice(active: boolean): IdentityVoice {
  const [voice, setVoice] = useState<IdentityVoice>(() => (needsHandoverConfirm() ? 'next' : 'self'))
  useEffect(() => {
    if (!active) return
    const read = (): void => setVoice(needsHandoverConfirm() ? 'next' : 'self')
    read()
    const timer = window.setInterval(read, VOICE_CHECK_EVERY_MS)
    return () => window.clearInterval(timer)
  }, [active])
  return voice
}

/**
 * 首页「直接办」一行右侧的登录态（W-75，产品负责人 9/29 同意；稿 01 ?state=member）。
 *
 * 首页是公共屏：登录着也不显示手机号（打码的也不显示），不叫名字。旁边给结束使用的按钮（走 endKioskUse('handover')）。
 * 进个人区走底部「我的」，这里不放「进入我的」这类直达入口。
 *
 * 说什么话看 useIdentityVoice：
 *   · 本人还在屏前 →「你已登录」+「结束使用」。左边那句本来就写「离开前请点结束使用」，按钮叫同一个名字，
 *     不再叫「结束上一位的使用」让刚登录的本人犹豫「这是要退我自己吗」（10/29 本机走查 I-05）；
 *   · 空档到点之后 →「有人登录着」+「结束上一位的使用」，给站到屏前的下一位看（W-75 原句，一字不改）。
 * 两种说法都不露名字和手机号，也不新开任何看上一位资料的出口。
 */
export function HomeIdentityActions({
  isLoggedIn,
  onLogin,
  onEndPrevious,
}: {
  isLoggedIn: boolean
  onLogin: () => void
  onEndPrevious: () => void
}) {
  const voice = useIdentityVoice(isLoggedIn)
  if (!isLoggedIn) {
    return (
      <button type="button" className="qx-home-identity" data-testid="home-identity" onClick={onLogin}>
        <UserIcon aria-hidden="true" />
        <span>登录后查看本人记录</span>
      </button>
    )
  }
  if (voice === 'self') {
    return (
      <>
        <span className="qx-home-identity" data-kind="status" data-testid="home-identity" data-state="member" data-voice="self" role="status">
          <UserIcon aria-hidden="true" />
          <span>你已登录</span>
        </span>
        <button type="button" className="qx-home-identity" data-testid="home-end-previous" onClick={onEndPrevious}>
          结束使用
        </button>
      </>
    )
  }
  return (
    <>
      <span className="qx-home-identity" data-kind="status" data-testid="home-identity" data-state="member" data-voice="next" role="status">
        <UserIcon aria-hidden="true" />
        <span>有人登录着</span>
      </span>
      <button type="button" className="qx-home-identity" data-testid="home-end-previous" onClick={onEndPrevious}>
        结束上一位的使用
      </button>
    </>
  )
}
