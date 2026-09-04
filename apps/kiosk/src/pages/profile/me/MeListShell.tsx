// ============================================================
// 「我的」明细列表页共享脚手架（打印订单 / 文档 / 收藏 / 浏览·跳转记录共用）。
//
// 诚实化与合规：
// - 仅展示本人真实数据（来自 /me/* 受 EndUserAuthGuard 保护端点）；未登录引导登录、
//   不展示任何本地假数据；加载中 / 失败 / 空态都诚实呈现。
// - mock 模式（无真实会员会话）下各 /me 客户端返回空页 → 走「空态」，不伪造数量。
// - 岗位 / 招聘会 / 政策只作来源信息入口；记录只记本人行为本身，不含投递 / 预约结果。
// ============================================================

import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Button,
  Card,
  KioskPageFrame,
  KioskPageHeader,
  KioskStatePanel,
} from '@ai-job-print/ui'
import { LogInIcon, type LucideIcon } from 'lucide-react'

export type MeListState = 'loading' | 'error' | 'ready'

interface MeListShellProps {
  title: string
  subtitle: string
  /** 未登录时登录跳转的来源路径（登录后回跳） */
  loginFrom: string
  isLoggedIn: boolean
  state: MeListState
  onRetry: () => void
  /** 简单列表页：ready 且空时展示空态卡。Tab / 自定义页传 false 并在 children 内自行处理空态 */
  isEmpty?: boolean
  emptyIcon?: LucideIcon
  emptyTitle?: string
  emptyDescription?: string
  /** 页头右侧操作区；默认「返回我的」。可覆盖为多按钮（如权益页「去权益活动领取」） */
  aside?: ReactNode
  /**
   * 未登录态的补充说明。不传时只说"登录后可见"——那对游客是死路：
   * 他不知道自己现在还能做什么。每页应说明这一页具体存的是什么。
   */
  signedOutDescription?: string
  /** ready 且非空时渲染（列表 / Tab 内容） */
  children: ReactNode
}

export function MeListShell({
  title,
  subtitle,
  loginFrom,
  isLoggedIn,
  state,
  onRetry,
  isEmpty = false,
  emptyIcon,
  emptyTitle,
  emptyDescription,
  aside,
  signedOutDescription,
  children,
}: MeListShellProps) {
  const navigate = useNavigate()
  return (
    <KioskPageFrame
      className="fusion-w5 fusion-w5--profile me-list-shell h-full"
      header={<KioskPageHeader
        title={title}
        description={subtitle}
        aside={
          aside ?? (
            <Button size="sm" variant="secondary" onClick={() => navigate('/profile')}>
              返回我的
            </Button>
          )
        }
      />}
    >
      <section data-kiosk-domain="profile" data-kiosk-screen="member-list" className="flex min-h-0 flex-1 flex-col px-6">

      {/* 未登录 / 加载 / 错误 / 空 这四种都是"单块焦点态"——整屏只有一张卡。
          定高 1080×1920 屏上顶着上边放会在下方留一大片死白（实测 1065px）。
          单块焦点态居中是对的；有列表内容时必须顶对齐，否则整页悬在屏幕中间。
          这条规则与 30-my-profile 的块数闸门同源。 */}
      <div
        className={`mt-4 flex-1 overflow-y-auto pb-8${
          !isLoggedIn || state === 'loading' || state === 'error' || isEmpty
            ? ' flex flex-col justify-center'
            : ''
        }`}
      >
        {!isLoggedIn ? (
          <KioskStatePanel
            tone="permission"
            title="登录后查看本人记录"
            description={
              signedOutDescription ??
              '本人记录仅本人可见，登录后绑定；游客模式不留存跨会话明细'
            }
            icon={<LogInIcon aria-hidden="true" />}
            actions={
              <div className="flex flex-wrap items-center gap-3">
                <Button size="lg" className="min-h-14 px-8" onClick={() => navigate('/login', { state: { from: loginFrom } })}>手机号登录</Button>
                {/* 免登录出口。不给这两个，游客点进「我的」任何一页就是死路——
                    而打印扫描与岗位浏览本来就不需要登录（CLAUDE.md §9A）。
                    原型 39 / 40 都画了这类出口，运行时此前一个都没有。 */}
                <Button variant="outline" size="lg" className="min-h-14 px-6" onClick={() => navigate('/print-scan')}>去打印扫描</Button>
                <Button variant="outline" size="lg" className="min-h-14 px-6" onClick={() => navigate('/jobs')}>查看岗位</Button>
              </div>
            }
          />
        ) : state === 'loading' ? (
          <KioskStatePanel tone="loading" title="正在加载本人记录" description="请稍候，不会展示其他账号的数据" />
        ) : state === 'error' ? (
          <KioskStatePanel tone="error" title="暂时无法加载" description="请检查网络后重试" actions={<Button onClick={onRetry}>重新加载</Button>} />
        ) : isEmpty ? (
          <Card className="p-4">
            <KioskStatePanel
              tone="empty"
              icon={emptyIcon ? (() => { const Icon = emptyIcon; return <Icon aria-hidden="true" /> })() : undefined}
              title={emptyTitle ?? '暂无记录'}
              description={emptyDescription ?? ''}
            />
          </Card>
        ) : (
          <div className="flex flex-col gap-3">{children}</div>
        )}
      </div>
      </section>
    </KioskPageFrame>
  )
}
