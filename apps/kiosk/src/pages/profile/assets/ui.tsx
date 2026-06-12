// ============================================================
// 账号资产通用 UI 件（Phase C-2D，从 ProfilePage 拆出）
//
// - AssetGroupShell：分组外壳，统一承载 加载中 / 加载失败可重试 / 空态 / 行列表 / 加载更多。
//   每组独立加载（互不阻塞）：一组失败只影响该组，其余组照常展示。
// - AssetRow / RowIconButton / TwoStepDeleteButton：行展示与触控操作（≥48px）。
// ============================================================

import { useEffect, useState, type ReactNode } from 'react'
import { Loader2Icon, Trash2Icon, type LucideIcon } from 'lucide-react'
import type { AssetGroupHandle } from './useMemberAssetGroups'

/** 列表项图标操作按钮：触控区 ≥48px（h-12 w-12）。 */
export function RowIconButton({
  icon: Icon,
  title,
  tone = 'neutral',
  onClick,
}: {
  icon: LucideIcon
  title: string
  tone?: 'neutral' | 'danger'
  onClick: () => void
}) {
  const toneCls =
    tone === 'danger'
      ? 'text-gray-400 hover:bg-red-50 hover:text-red-500'
      : 'text-gray-500 hover:bg-gray-50'
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-label={title}
      className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-gray-200 ${toneCls}`}
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
    </button>
  )
}

/**
 * 两步删除按钮：第一次点击进入确认态（3 秒后自动还原），再次点击才真正删除。
 * 公共触摸屏防误触；不弹系统级对话框（Kiosk 模式约束）。
 */
export function TwoStepDeleteButton({ title, onConfirm }: { title: string; onConfirm: () => void }) {
  const [arming, setArming] = useState(false)
  useEffect(() => {
    if (!arming) return
    const t = setTimeout(() => setArming(false), 3000)
    return () => clearTimeout(t)
  }, [arming])
  if (!arming) {
    return <RowIconButton icon={Trash2Icon} title={title} tone="danger" onClick={() => setArming(true)} />
  }
  return (
    <button
      type="button"
      onClick={() => {
        setArming(false)
        onConfirm()
      }}
      className="flex min-h-[48px] shrink-0 items-center rounded-lg bg-red-500 px-3 text-sm font-semibold text-white active:bg-red-600"
    >
      确认删除
    </button>
  )
}

/** 账号资产行：图标 + 名称 + 元信息 + 任意右侧操作（children）。 */
export function AssetRow({
  icon: Icon,
  iconBg,
  iconColor,
  name,
  meta,
  children,
}: {
  icon: LucideIcon
  iconBg: string
  iconColor: string
  name: string
  meta: string
  children?: ReactNode
}) {
  return (
    <div className="flex items-center gap-3 py-3">
      <span className={['flex h-10 w-10 shrink-0 items-center justify-center rounded-lg', iconBg].join(' ')}>
        <Icon className={['h-5 w-5', iconColor].join(' ')} aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-gray-900">{name}</p>
        <p className="truncate text-xs text-gray-400">{meta}</p>
      </div>
      {children}
    </div>
  )
}

/** 行内文本操作按钮（查看 / 下载等，触控区 ≥48px）。 */
export function RowTextButton({
  label,
  icon: Icon,
  onClick,
}: {
  label: string
  icon?: LucideIcon
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[48px] shrink-0 items-center gap-1 rounded-lg border border-gray-200 px-3 text-sm font-medium text-primary-600 transition-colors hover:bg-primary-50 active:bg-primary-100"
    >
      {Icon && <Icon className="h-4 w-4" aria-hidden="true" />}
      {label}
    </button>
  )
}

/**
 * 资产分组外壳：小标题（含真实总数）+ 独立的 加载/失败重试/空态/行列表/加载更多。
 * 同一张白卡内，不卡片套卡片。
 */
export function AssetGroupShell<T extends { id: string }>({
  title,
  group,
  empty,
  headerExtra,
  beforeRows,
  renderRow,
}: {
  title: string
  group: AssetGroupHandle<T>
  empty: string
  headerExtra?: ReactNode
  /** 行列表之前的固定内容（如同组并列的另一类记录），不受本组加载/空态影响 */
  beforeRows?: ReactNode
  renderRow: (item: T) => ReactNode
}) {
  return (
    <div className="border-t border-gray-100 py-2 first:border-t-0">
      <div className="flex items-center justify-between px-1 py-1.5">
        <p className="text-xs font-medium text-gray-500">
          {title}
          {group.total !== null && group.total > 0 && <span className="ml-1 text-gray-400">({group.total})</span>}
        </p>
        {headerExtra}
      </div>
      {beforeRows}
      {group.loading ? (
        <p className="flex items-center gap-2 px-1 pb-2 text-xs text-gray-400">
          <Loader2Icon className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          加载中…
        </p>
      ) : group.error ? (
        <div className="flex items-center justify-between px-1 pb-2 text-xs">
          <span className="text-gray-500">加载失败</span>
          <button
            type="button"
            onClick={group.reload}
            className="min-h-[44px] rounded-lg border border-gray-200 px-3 font-medium text-primary-600 hover:bg-primary-50"
          >
            重试
          </button>
        </div>
      ) : group.items.length === 0 ? (
        <p className="px-1 pb-2 text-xs text-gray-400">{empty}</p>
      ) : (
        <>
          <div className="divide-y divide-gray-100">{group.items.map(renderRow)}</div>
          {group.nextCursor && (
            <button
              type="button"
              onClick={group.loadMore}
              disabled={group.loadingMore}
              className="mb-1 mt-1 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-dashed border-gray-200 text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-60"
            >
              {group.loadingMore && <Loader2Icon className="h-4 w-4 animate-spin" aria-hidden="true" />}
              加载更多
            </button>
          )}
        </>
      )}
    </div>
  )
}
