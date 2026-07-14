import { KIcon } from '../../../components/kiosk-icon'
import type { ProfileHeaderStats } from '../profileTypes'

export function ProfileHeader({
  isLoggedIn,
  displayName,
  phoneMasked,
  stats,
  statsLoading,
  reserveBannerSpace,
  onLogin,
  onLogout,
  onOpenSettings,
  onOpenNotifications,
}: {
  isLoggedIn: boolean
  displayName: string
  phoneMasked: string
  // null = 账号概览统计尚未加载完成（展示「—」而非误导性的 0）
  stats: ProfileHeaderStats
  statsLoading: boolean
  // 保留本次服务记录的真实状态，供入口页在身份面板后衔接待办记录。
  reserveBannerSpace: boolean
  onLogin: () => void
  onLogout: () => void
  onOpenSettings: () => void
  onOpenNotifications: () => void
}) {
  if (isLoggedIn) {
    return (
      <section
        className="lf-reference-panel kp-profile-header"
        data-has-session-records={reserveBannerSpace ? 'true' : undefined}
        aria-label="账号概览"
      >
        <div className="lf-reference-group-head kp-profile-main">
          <div className="p-ava">{avatarInitial(displayName)}</div>
          <div className="p-id">
            <span className="p-kicker">
              <i className="dot" aria-hidden="true" />
              已登录 · {phoneMasked || '手机号已绑定'}
            </span>
            <strong className="p-name">{displayName}</strong>
            <p>本人简历、文档、打印订单与来源收藏都在下方入口，明细在对应功能页查看。</p>
          </div>
          <div className="p-actions">
            <button type="button" className="p-iconbtn" aria-label="消息通知" onClick={onOpenNotifications}>
              <KIcon name="bell" />
            </button>
            <button type="button" className="p-iconbtn" aria-label="账号设置" onClick={onOpenSettings}>
              <KIcon name="settings" />
            </button>
            <button type="button" className="p-btn ghost" onClick={onLogout}>
              退出登录
            </button>
          </div>
        </div>

        <div className="p-stats">
          <ProfileStat value={stats.aiRecords} label="AI记录" loading={statsLoading} />
          <ProfileStat value={stats.favorites} label="收藏记录" loading={statsLoading} />
          <ProfileStat value={stats.documents} label="文档记录" loading={statsLoading} />
        </div>
      </section>
    )
  }

  return (
    <section
      className="lf-reference-panel kp-profile-header"
      data-has-session-records={reserveBannerSpace ? 'true' : undefined}
      aria-label="登录引导"
    >
      <div className="lf-reference-group-head kp-profile-main">
        <div className="p-ava guest">
          <KIcon name="user" />
        </div>
        <div className="p-id">
          <span className="p-kicker">
            <i className="dot" aria-hidden="true" />
            游客 · 仅本次会话
          </span>
          <strong className="p-name">登录后绑定本人服务记录</strong>
          <p>登录后用于绑定本人服务记录，仅本次会话有效；游客记录离开后自动清空。</p>
        </div>
        <div className="p-actions">
          <button type="button" className="p-btn primary" onClick={onLogin}>
            <KIcon name="phone" />
            手机号登录
          </button>
        </div>
      </div>
    </section>
  )
}

function ProfileStat({ value, label, loading }: { value: number | null; label: string; loading: boolean }) {
  const unloaded = value === null
  return (
    <div className="p-stat" aria-label={`${label}：${unloaded ? (loading ? '加载中' : '暂无数据') : value}`}>
      <b className={[unloaded ? 'unloaded' : '', unloaded && loading ? 'pulse' : ''].filter(Boolean).join(' ')}>
        {unloaded ? '—' : value}
      </b>
      <span>{label}</span>
    </div>
  )
}

function avatarInitial(name: string): string {
  const clean = name.replace(/\s/g, '')
  if (!clean) return '我'
  if (/^\d/.test(clean)) return clean.slice(0, 1)
  return clean.slice(0, 1)
}
