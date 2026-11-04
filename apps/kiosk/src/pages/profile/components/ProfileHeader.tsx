export function ProfileHeader({
  isLoggedIn,
  displayName,
  phoneMasked,
  reserveBannerSpace,
}: {
  isLoggedIn: boolean
  displayName: string
  phoneMasked: string
  reserveBannerSpace: boolean
  onLogin: () => void
  onOpenSettings: () => void
}) {
  return (
    <section
      className="pf-idcard"
      data-has-session-records={reserveBannerSpace ? 'true' : undefined}
      aria-label={isLoggedIn ? '账号概览' : '登录引导'}
    >
      <span className="pf-idtx">
        <span className="pf-idname">{isLoggedIn ? displayName : '还没有登录'}</span>
        <span className="pf-idsub">
          {isLoggedIn
            ? `${phoneMasked || '手机号已绑定'} · 公共终端不显示完整个人信息`
            : '这台机器是公共终端，不登录就不会显示任何人的简历、订单和文件。'}
        </span>
      </span>
    </section>
  )
}
