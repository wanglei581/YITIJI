import { UserIcon } from 'lucide-react'

/**
 * 首页「直接办」一行右侧的登录态（W-75，产品负责人 9/29 同意；稿 01 ?state=member）。
 *
 * 首页是公共屏：登录着也不显示手机号（打码的也不显示），不叫名字，只说「有人登录着」——
 * 站在屏前的可能已经不是登录的那个人。旁边给「结束上一位的使用」（走 endKioskUse('handover')）。
 * 进个人区走底部「我的」，这里不放「进入我的」这类直达入口。
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
  if (!isLoggedIn) {
    return (
      <button type="button" className="qx-home-identity" data-testid="home-identity" onClick={onLogin}>
        <UserIcon aria-hidden="true" />
        <span>登录后查看本人记录</span>
      </button>
    )
  }
  return (
    <>
      <span className="qx-home-identity" data-kind="status" data-testid="home-identity" data-state="member" role="status">
        <UserIcon aria-hidden="true" />
        <span>有人登录着</span>
      </span>
      <button type="button" className="qx-home-identity" data-testid="home-end-previous" onClick={onEndPrevious}>
        结束上一位的使用
      </button>
    </>
  )
}
