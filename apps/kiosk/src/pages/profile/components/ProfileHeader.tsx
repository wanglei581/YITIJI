import { Button } from '@ai-job-print/ui'
import {
  BadgeCheckIcon,
  BellIcon,
  GraduationCapIcon,
  LogInIcon,
  SettingsIcon,
  TargetIcon,
  UserRoundIcon,
} from 'lucide-react'
import type { ProfileHeaderStats } from '../profileTypes'

const cardSurface = 'rounded-2xl border border-neutral-200 bg-white shadow-sm'

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
      <section
        className={[
          '-mx-6 -mt-6 rounded-b-[28px] bg-gradient-to-br from-[#1677ff] via-[#1687ff] to-[#0f8cff] px-6 pt-8 text-white shadow-sm',
          reserveBannerSpace ? 'pb-16' : 'pb-8',
        ].join(' ')}
      >
        <div className="flex min-h-[44px] items-center justify-between">
          <h1 className="text-xl font-bold">我的主页</h1>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onOpenSettings}
              aria-label="账号设置"
              className="flex h-12 w-12 items-center justify-center rounded-full bg-white/16 text-white ring-1 ring-white/15 active:bg-white/24"
            >
              <SettingsIcon className="h-5 w-5" aria-hidden="true" />
            </button>
            <button
              type="button"
              onClick={onOpenNotifications}
              aria-label="消息通知"
              className="flex h-12 w-12 items-center justify-center rounded-full bg-white/16 text-white ring-1 ring-white/15 active:bg-white/24"
            >
              <BellIcon className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
        </div>

        <div className="mt-6 flex items-start gap-4">
          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-2 border-white/35 bg-white/18 text-2xl font-bold shadow-inner">
            {avatarInitial(displayName)}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="truncate text-2xl font-bold leading-tight">{displayName}</p>
              <span className="inline-flex min-h-[24px] items-center gap-1 rounded-full bg-white/18 px-2.5 text-xs font-semibold text-white ring-1 ring-white/20">
                <BadgeCheckIcon className="h-3.5 w-3.5" aria-hidden="true" />
                已登录
              </span>
            </div>
            <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-white/85">
              <GraduationCapIcon className="h-4 w-4" aria-hidden="true" />
              会员账号
              <span className="text-white/45">|</span>
              {phoneMasked || '手机号已绑定'}
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-white/85">
              <TargetIcon className="h-4 w-4" aria-hidden="true" />
              账号资料能力逐步开放中
            </p>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="hidden min-h-[40px] shrink-0 rounded-full bg-white/15 px-4 text-sm font-semibold text-white ring-1 ring-white/20 active:bg-white/25 sm:inline-flex sm:items-center"
          >
            退出登录
          </button>
        </div>

        <div className="mt-6 rounded-2xl border border-white/18 bg-white/8 px-4 py-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]">
          <div className="grid grid-cols-3 divide-x divide-white/16 text-center">
            <ProfileStat value={stats.aiRecords} label="AI记录" loading={statsLoading} />
            <ProfileStat value={stats.favorites} label="收藏记录" loading={statsLoading} />
            <ProfileStat value={stats.documents} label="文档记录" loading={statsLoading} />
          </div>
        </div>
      </section>
    )
  }

  return (
    <div className={`flex items-center gap-4 ${cardSurface} px-6 py-5`}>
      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-neutral-100">
        <UserRoundIcon className="h-8 w-8 text-neutral-400" aria-hidden="true" />
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-xl font-bold text-neutral-900">游客</p>
        <p className="mt-1 text-sm text-neutral-500">登录后用于绑定本人服务记录，仅本次会话有效</p>
      </div>

      <Button size="lg" onClick={onLogin} className="flex h-14 shrink-0 items-center gap-1 px-5 text-base">
        <LogInIcon className="h-5 w-5" aria-hidden="true" />
        手机号登录
      </Button>
    </div>
  )
}

// value=null 表示账号概览统计尚未加载完成：展示「—」而非误导性的 0；loading 时轻微脉冲提示。
function ProfileStat({ value, label, loading }: { value: number | null; label: string; loading: boolean }) {
  const unloaded = value === null
  return (
    <div className="px-2" aria-label={`${label}：${unloaded ? (loading ? '加载中' : '暂无数据') : value}`}>
      <p
        className={[
          'text-2xl font-bold leading-none',
          unloaded ? 'text-white/55' : '',
          unloaded && loading ? 'motion-safe:animate-pulse' : '',
        ].join(' ')}
      >
        {unloaded ? '—' : value}
      </p>
      <p className="mt-2 text-xs font-semibold text-white/78">{label}</p>
    </div>
  )
}

function avatarInitial(name: string): string {
  const clean = name.replace(/\s/g, '')
  if (!clean) return '我'
  if (/^\d/.test(clean)) return clean.slice(0, 1)
  return clean.slice(0, 1)
}
