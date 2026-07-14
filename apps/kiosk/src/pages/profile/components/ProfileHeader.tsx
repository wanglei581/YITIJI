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
  return (
    <section
      className="kp-profile-header"
      data-has-session-records={reserveBannerSpace ? 'true' : undefined}
      aria-label={isLoggedIn ? '账号概览' : '登录引导'}
    >
      <div className="kp-profile-main">
        <div className={isLoggedIn ? 'p-ava' : 'p-ava guest'}>
          {isLoggedIn ? avatarInitial(displayName) : <KIcon name="user" />}
        </div>
        <div className="p-id">
          <span className="p-kicker">
            <i className="dot" aria-hidden="true" />
            {isLoggedIn ? `已登录 · ${phoneMasked || '手机号已绑定'}` : '游客 · 仅本次会话'}
          </span>
          <strong className="p-name">{isLoggedIn ? displayName : '登录后查看本人记录'}</strong>
          <p>
            {isLoggedIn
              ? '本人简历、文档、打印订单与来源收藏均由下方正式入口提供。'
              : '可直接使用基础服务；本人记录与账号概览需先登录。'}
          </p>
        </div>
        <div className="p-actions">
          {isLoggedIn ? (
            <>
              <button type="button" className="p-iconbtn" aria-label="消息通知" onClick={onOpenNotifications}>
                <KIcon name="bell" />
              </button>
              <button type="button" className="p-iconbtn" aria-label="账号设置" onClick={onOpenSettings}>
                <KIcon name="settings" />
              </button>
              <button type="button" className="p-btn ghost" onClick={onLogout}>
                退出登录
              </button>
            </>
          ) : (
            <button type="button" className="p-btn primary" onClick={onLogin}>
              <KIcon name="phone" />
              手机号登录
            </button>
          )}
        </div>
      </div>

      {isLoggedIn && (
        <div className="p-stats">
          <ProfileStat value={stats.aiRecords} label="AI记录" loading={statsLoading} />
          <ProfileStat value={stats.favorites} label="收藏记录" loading={statsLoading} />
          <ProfileStat value={stats.documents} label="文档记录" loading={statsLoading} />
        </div>
      )}

      <div className="kp-profile-boundary">
        <KIcon name="shield" />
        <span>
          <strong>本人数据与办理结果仅由正式页面提供</strong>
          <small>
            {isLoggedIn
              ? '顶部数量来自本人真实记录；详情、订单与服务结果请进入对应功能页查看。'
              : '本页不伪造个人数量、订单或设备结果；建设中入口不可办理。'}
          </small>
        </span>
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
