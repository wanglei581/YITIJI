import { ChevronRightIcon, UserIcon } from 'lucide-react'

export function ProfileHeader({
  isLoggedIn,
  phoneMasked,
  reserveBannerSpace,
  onLogin,
}: {
  isLoggedIn: boolean
  phoneMasked: string
  reserveBannerSpace: boolean
  onLogin: () => void
}) {
  const phoneLine = phoneMasked || '只显示前三后四'
  return (
    <section
      className="pf-idcard"
      data-has-session-records={reserveBannerSpace ? 'true' : undefined}
      aria-label={isLoggedIn ? '账号概览' : '登录引导'}
    >
      <span className="pf-avatar" aria-hidden="true">
        <UserIcon size={40} />
      </span>
      <span className="pf-idtx">
        <span className="pf-idname">{isLoggedIn ? '本人账号' : '还没有登录'}</span>
        <span className="pf-idsub">
          {isLoggedIn
            ? `手机号 ${phoneLine} · 公共终端默认不显示完整个人信息`
            : '这台机器是公共终端，不登录就不会显示任何人的简历、订单和文件。'}
        </span>
      </span>
      {isLoggedIn ? (
        <span className="pf-idstat">账号设置在页面下方</span>
      ) : (
        <button type="button" className="pf-idbtn" onClick={onLogin}>
          去登录
          <ChevronRightIcon size={22} aria-hidden />
        </button>
      )}
    </section>
  )
}
