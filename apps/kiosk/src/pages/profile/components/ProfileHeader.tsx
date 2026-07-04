import { KIcon } from '../../../components/kiosk-icon'
import type { ProfileHeaderStats } from '../profileTypes'

// p-hero（墨青纸感）：米纸卡 + 装饰圆环 + 宋体名字 + 概览统计。
// 诚实化口径不变：统计取服务端真实 total，null 显示「—」；不编造完整度。

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
  // 下方是否会展示「本次服务记录」浮层卡：true 时预留底部空间承接 -mt-12 浮层，false 时收紧
  reserveBannerSpace: boolean
  onLogin: () => void
  onLogout: () => void
  onOpenSettings: () => void
  onOpenNotifications: () => void
}) {
  if (isLoggedIn) {
    return (
      <section className={reserveBannerSpace ? 'p-hero with-pending' : 'p-hero'} aria-label="账号概览">
        <div className="p-top">
          <div className="p-ava">{avatarInitial(displayName)}</div>
          <div className="p-id">
            <span className="p-kicker">
              <i className="dot" aria-hidden="true" />
              已登录 · {phoneMasked || '手机号已绑定'}
            </span>
            <h1>{displayName}</h1>
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
    <section className="p-hero" aria-label="登录引导">
      <div className="p-top">
        <div className="p-ava guest">
          <KIcon name="user" />
        </div>
        <div className="p-id">
          <span className="p-kicker">
            <i className="dot" aria-hidden="true" />
            游客 · 仅本次会话
          </span>
          <h1>登录后绑定本人服务记录</h1>
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

// value=null 表示账号概览统计尚未加载完成：展示「—」而非误导性的 0；loading 时轻微脉冲提示。
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
