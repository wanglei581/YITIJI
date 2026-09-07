import { UserIcon } from 'lucide-react'

export function ProfileHeader({
  isLoggedIn,
  displayName,
  phoneMasked,
  reserveBannerSpace,
  onLogin,
  onOpenSettings,
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
      <span className="pf-avatar" aria-hidden="true">
        {isLoggedIn ? avatarInitial(displayName) : <UserIcon size={40} />}
      </span>
      <span className="pf-idtx">
        <span className="pf-idname">{isLoggedIn ? displayName : '还没有登录'}</span>
        <span className="pf-idsub">
          {isLoggedIn
            ? `${phoneMasked || '手机号已绑定'} · 公共终端默认不显示完整个人信息`
            : '这台机器是公共终端，不登录就不会显示任何人的简历、订单和文件。'}
        </span>
      </span>
      {isLoggedIn ? (
        <button type="button" className="pf-idbtn" data-testid="profile-account" onClick={onOpenSettings}>
          账号设置
        </button>
      ) : (
        <button type="button" className="pf-idbtn" data-testid="profile-login" onClick={onLogin}>
          去登录
        </button>
      )}
    </section>
  )
}

function avatarInitial(name: string): string {
  const clean = name.replace(/\s/g, '')
  if (!clean) return '我'
  if (/^\d/.test(clean)) return clean.slice(0, 1)
  return clean.slice(0, 1)
}
