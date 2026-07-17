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
import { Button, Card, EmptyState, ErrorState, LoadingState } from '@ai-job-print/ui'
import { ChevronLeftIcon, LogInIcon, type LucideIcon } from 'lucide-react'

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
  headerActions?: ReactNode
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
  headerActions,
  children,
}: MeListShellProps) {
  const navigate = useNavigate()
  return (
    <div className="me-list-shell">
      <header className="me-pagehead">
        <button type="button" className="me-pagehead-back" onClick={() => navigate('/profile')}>
          <ChevronLeftIcon aria-hidden="true" />
          返回
        </button>
        <div className="me-pagehead-titles">
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        {headerActions && <div className="me-pagehead-actions">{headerActions}</div>}
      </header>

      <div className="me-list-content">
        {!isLoggedIn ? (
          <Card className="flex flex-col items-center gap-4 p-10 text-center">
            <LogInIcon className="h-10 w-10 text-neutral-300" aria-hidden="true" />
            <div>
              <p className="text-base font-semibold text-neutral-900">登录后查看本人记录</p>
              <p className="mt-1 text-sm text-neutral-500">本人记录仅本人可见，登录后绑定；游客模式不留存跨会话明细</p>
            </div>
            <Button
              size="lg"
              className="h-14 px-8"
              onClick={() => navigate('/login', { state: { from: loginFrom } })}
            >
              <LogInIcon className="mr-1.5 h-5 w-5" aria-hidden="true" />
              手机号登录
            </Button>
          </Card>
        ) : state === 'loading' ? (
          <LoadingState className="py-20" />
        ) : state === 'error' ? (
          <ErrorState className="py-20" onRetry={onRetry} />
        ) : isEmpty ? (
          <Card className="p-4">
            <EmptyState
              icon={emptyIcon}
              title={emptyTitle ?? '暂无记录'}
              description={emptyDescription ?? ''}
              className="py-12"
            />
          </Card>
        ) : (
          <div className="me-list-ready flex flex-col gap-3">{children}</div>
        )}
      </div>
    </div>
  )
}
