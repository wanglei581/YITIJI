import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { CheckCircleIcon, XIcon } from 'lucide-react'
import { useAuth } from '../../auth/useAuth'
import { useMemberProfileOverview } from './assets/useMemberProfileOverview'
import { ProfileEntrySection } from './components/ProfileEntrySection'
import { ProfileHeader } from './components/ProfileHeader'
import { PendingTaskBanner, ProfileSessionRecords } from './components/ProfileSessionRecords'
import { SECTIONS } from './profileEntries'
import type { AIRecord, Entry, IncomingState, ResumeItem, ScanItem } from './profileTypes'

// 「我的」个人资产入口页（参考 miaoda 个人中心：顶部个人信息区 + 白色分区卡片 + 彩色浅底图标）。
// 诚实化与合规约束：
// - 只承诺本次会话记录，不宣称跨会话留存 / 多终端同步等尚未实现的能力。
// - 不展示假数量；未实现入口用「建设中」标签，会话相关入口用「本次记录」标签。
// - 岗位 / 招聘会只作第三方来源信息入口与跳转/浏览记录，不引入任何招聘闭环语义。
// - 不新增后端 API（明细页消费既有 /me/* 端点）；不做活动 / 套餐 / 支付真实逻辑。
// - 信息架构收口：不再把各类明细堆在独立「账号资产」聚合区；我的页只保留入口与概览，
//   明细由 /me/* 轻量页承载（打印订单 / 文档 / 收藏 / 浏览·跳转记录），其余仍归位对应业务页。
// 底部 Tab（首页 / AI助手 / 我的）由 KioskLayout 提供，本页不改动。

export function ProfilePage() {
  const navigate = useNavigate()
  const location = useLocation()
  const { user, isLoggedIn, displayName, logout, getToken } = useAuth()
  const incoming = (location.state ?? {}) as IncomingState

  // ── 本次会话记录（仅来自 location.state，不伪造数量）──────────────
  const [resumes, setResumes] = useState<ResumeItem[]>(() =>
    incoming.savedResume
      ? [{ id: `r-${Date.now()}`, ...incoming.savedResume, savedAt: incoming.savedAt ?? new Date().toISOString() }]
      : [],
  )
  const [scans, setScans] = useState<ScanItem[]>(() =>
    incoming.savedFile
      ? [{ id: `s-${Date.now()}`, ...incoming.savedFile, savedAt: incoming.savedAt ?? new Date().toISOString() }]
      : [],
  )
  const [aiRecords, setAiRecords] = useState<AIRecord[]>(() =>
    incoming.savedResumeAdvice
      ? [{
          id: `a-${Date.now()}`,
          label: '优化建议',
          detail: `${incoming.savedResumeAdvice.suggestions.length} 条建议`,
          fileName: incoming.savedResumeAdvice.file?.name ?? '简历',
          createdAt: incoming.savedResumeAdvice.savedAt,
        }]
      : [],
  )

  const hasSessionRecords = resumes.length + scans.length + aiRecords.length > 0

  // ── 账号概览统计：仅用于顶部三项数量，不在「我的」页下方聚合展示明细 ──
  const profileOverview = useMemberProfileOverview(isLoggedIn, getToken)

  const headerDisplayName = user?.nickname?.trim() || displayName || '会员账号'
  const headerPhoneMasked = user?.phoneMasked ?? displayName
  // 头部统计取服务端真实 total（来自 /me/* 分页响应），不叠加本次会话记录，避免同一文件被双算；
  // 本次会话记录在下方「本次服务记录」单独展示。不展示「完整度」——无真实完整度计算，不编造数字。
  // total 为 null（加载中 / 未登录 / 加载失败）时头部展示「—」，避免误显示 0。
  const headerStats = {
    aiRecords: profileOverview.aiRecords,
    favorites: profileOverview.favorites,
    documents: profileOverview.documents,
  }
  const statsLoading = profileOverview.loading

  // ── Toast ────────────────────────────────────────────────────
  // 诚实化：不承诺跨页面资产明细，只提示「已加入本次记录」。
  const [toastMsg, setToastMsg] = useState<string | null>(() => {
    if (incoming.savedResume) return '简历已加入本次记录'
    if (incoming.savedFile) return '扫描文件已加入本次记录'
    if (incoming.savedResumeAdvice) return '优化建议已加入本次记录'
    return null
  })

  useEffect(() => {
    if (!toastMsg) return
    const t = setTimeout(() => setToastMsg(null), 3500)
    return () => clearTimeout(t)
  }, [toastMsg])

  // ── Handlers ─────────────────────────────────────────────────
  const goLogin = () => navigate('/login', { state: { from: location.pathname } })

  const continuePendingTask = () => {
    if (resumes[0]) {
      navigate('/resume/source')
      return
    }
    if (scans[0]) {
      printFile(scans[0])
      return
    }
    if (aiRecords[0]) {
      navigate('/resume/source')
    }
  }

  const printFile = (file: { name: string; size: string; pages?: number }) => {
    navigate('/print/preview', {
      state: { file: { name: file.name, size: file.size, pages: file.pages ?? 1 } },
    })
  }

  const handleEntryTap = (entry: Entry) => {
    if (entry.route) {
      navigate(entry.route)
      return
    }
    if (entry.tag === '本次记录') {
      setToastMsg(hasSessionRecords ? '本次会话记录见下方' : '本次会话暂无记录，完成服务后在此查看')
      return
    }
    setToastMsg('该功能建设中，敬请期待')
  }

  return (
    <div className="relative flex min-h-full flex-col gap-4 bg-[#eef2f7] p-6 pb-24">
      {/* ── 顶部个人信息区 ── */}
      <ProfileHeader
        isLoggedIn={isLoggedIn}
        displayName={headerDisplayName}
        phoneMasked={headerPhoneMasked}
        stats={headerStats}
        statsLoading={statsLoading}
        reserveBannerSpace={isLoggedIn && hasSessionRecords}
        onLogin={goLogin}
        onLogout={logout}
        onOpenSettings={() => navigate('/me/settings')}
        onOpenNotifications={() => navigate('/me/notifications')}
      />

      {isLoggedIn && hasSessionRecords && <PendingTaskBanner onContinue={continuePendingTask} />}

      {/* 提示 toast */}
      {toastMsg && (
        <div className="fixed left-1/2 top-4 z-50 flex -translate-x-1/2 items-center gap-2 rounded-full bg-success px-5 py-2.5 text-sm font-medium text-white shadow-lg">
          <CheckCircleIcon className="h-4 w-4 shrink-0" />
          {toastMsg}
          <button
            onClick={() => setToastMsg(null)}
            aria-label="关闭提示"
            className="ml-1 rounded-full p-0.5 hover:bg-success"
          >
            <XIcon className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* ── 分区入口（九宫格）── */}
      {SECTIONS.map((section) => (
        <ProfileEntrySection key={section.title} section={section} onTap={handleEntryTap} />
      ))}

      {/* ── 本次服务记录（仅当本次会话产生了记录时显示，避免空态占位）── */}
      {hasSessionRecords && (
        <ProfileSessionRecords
          resumes={resumes}
          scans={scans}
          aiRecords={aiRecords}
          onPrintFile={printFile}
          onDeleteResume={(id) => setResumes((prev) => prev.filter((x) => x.id !== id))}
          onDeleteScan={(id) => setScans((prev) => prev.filter((x) => x.id !== id))}
          onDeleteAiRecord={(id) => setAiRecords((prev) => prev.filter((x) => x.id !== id))}
        />
      )}

      {/* 合规说明 — 诚实化：我的页只做入口与概览；游客仅本次会话 */}
      <p className="text-center text-xs leading-relaxed text-neutral-400">
        {isLoggedIn
          ? '本人数据仅本人可见，留存到期后自动清理；各类记录将逐步归位到对应业务页面'
          : '以上为本次服务产生的记录，仅保存在当前会话；登录后可查看本人服务概览'}
      </p>
    </div>
  )
}
