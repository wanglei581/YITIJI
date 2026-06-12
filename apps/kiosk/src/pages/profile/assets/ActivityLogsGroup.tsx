// ============================================================
// 浏览与跳转记录资产组（P1 闭环，接真原「建设中」入口）。
//
// 三类目标（岗位 / 招聘会 / 政策）各自展示两个子列表：
// - 最近浏览（BrowseLog）
// - 外部入口打开记录（ExternalJumpLog：投递入口 / 预约入口 / 官方入口）
// 操作：查看目标、再次打开来源平台（二维码）、删除记录（两步确认 + 服务端审计）。
//
// 合规（长期红线）：只展示「浏览过 / 打开过入口」两类本人行为；
// 投递、预约、办理结果一律以来源平台为准，本系统不记录也不参与流程——
// 本组件没有、也不允许出现任何投递/预约结果类状态文案。
// ============================================================

import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ActivityTargetType, MemberBrowseLogItem, MemberJumpLogItem } from '@ai-job-print/shared'
import {
  BriefcaseIcon,
  CalendarIcon,
  ExternalLinkIcon,
  EyeIcon,
  LandmarkIcon,
  Loader2Icon,
  QrCodeIcon,
  XIcon,
} from 'lucide-react'
import { useAuth } from '../../../auth/useAuth'
import {
  deleteMyBrowseLog,
  deleteMyJumpLog,
  getMyBrowseLogs,
  getMyJumpLogs,
  recordExternalJump,
} from '../../../services/api/activity'
import { SourceUrlQr } from '../../../components/SourceUrlQr'
import { isValidSourceUrl } from '../../../lib/url'
import { formatTime } from './format'
import { AssetRow, RowTextButton, TwoStepDeleteButton } from './ui'

const PAGE_SIZE = 5

const TYPE_META: Record<ActivityTargetType, {
  label: string
  icon: typeof BriefcaseIcon
  iconBg: string
  iconColor: string
  jumpLabel: string
  emptyHint: string
  notice: string
  viewRoute: (targetId: string) => string
}> = {
  job: {
    label: '岗位',
    icon: BriefcaseIcon,
    iconBg: 'bg-sky-50',
    iconColor: 'text-sky-600',
    jumpLabel: '投递入口打开记录',
    emptyHint: '暂无记录，去首页「岗位信息」浏览岗位后在此查看',
    notice: '投递结果以来源平台为准，本系统不记录也不参与投递流程。',
    viewRoute: (id) => `/jobs/${id}`,
  },
  job_fair: {
    label: '招聘会',
    icon: CalendarIcon,
    iconBg: 'bg-green-50',
    iconColor: 'text-green-600',
    jumpLabel: '预约入口打开记录',
    emptyHint: '暂无记录，去首页「招聘会」浏览活动后在此查看',
    notice: '预约结果以来源平台为准，本系统不记录也不参与预约流程。',
    viewRoute: (id) => `/job-fairs/${id}`,
  },
  policy: {
    label: '政策',
    icon: LandmarkIcon,
    iconBg: 'bg-emerald-50',
    iconColor: 'text-emerald-600',
    jumpLabel: '官方入口打开记录',
    emptyHint: '暂无记录，去首页「政策服务」查看政策后在此查看',
    notice: '政策办理结果以官方平台为准，本系统仅提供信息入口和材料服务。',
    viewRoute: () => '/renshi?tab=policy',
  },
}

const JUMP_ACTION: Record<ActivityTargetType, 'external_apply' | 'external_appointment' | 'external_open'> = {
  job: 'external_apply',
  job_fair: 'external_appointment',
  policy: 'external_open',
}

// ── 单个子列表的独立加载状态（失败只影响自身，可重试 / 加载更多）──────────────

interface LogListState<T> {
  items: T[]
  total: number | null
  nextCursor: string | null
  loading: boolean
  loadingMore: boolean
  error: boolean
}

const EMPTY_STATE = { items: [], total: null, nextCursor: null, loading: false, loadingMore: false, error: false }

function useLogList<T extends { id: string }>(
  enabled: boolean,
  fetchPage: (cursor: string | null) => Promise<{ items: T[]; nextCursor: string | null; total: number }>,
) {
  const [state, setState] = useState<LogListState<T>>(EMPTY_STATE)

  const reload = useCallback(() => {
    if (!enabled) return
    setState((s) => ({ ...s, loading: true, error: false }))
    fetchPage(null)
      .then((page) => setState({ items: page.items, total: page.total, nextCursor: page.nextCursor, loading: false, loadingMore: false, error: false }))
      .catch(() => setState((s) => ({ ...s, loading: false, error: true })))
  }, [enabled, fetchPage])

  const loadMore = useCallback(() => {
    setState((s) => {
      if (!s.nextCursor || s.loadingMore) return s
      fetchPage(s.nextCursor)
        .then((page) =>
          setState((cur) => ({
            ...cur,
            items: [...cur.items, ...page.items],
            total: page.total,
            nextCursor: page.nextCursor,
            loadingMore: false,
          })),
        )
        .catch(() => setState((cur) => ({ ...cur, loadingMore: false })))
      return { ...s, loadingMore: true }
    })
  }, [fetchPage])

  const removeLocal = useCallback((id: string) => {
    setState((s) => ({
      ...s,
      items: s.items.filter((x) => x.id !== id),
      total: s.total === null ? s.total : Math.max(0, s.total - 1),
    }))
  }, [])

  useEffect(() => {
    if (enabled) reload()
    else setState(EMPTY_STATE)
  }, [enabled, reload])

  return { ...state, reload, loadMore, removeLocal }
}

// ── 再次打开来源平台：二维码弹层（真实快照 sourceUrl）──────────────────────────

function ReopenQrOverlay({
  title,
  sourceName,
  sourceUrl,
  notice,
  onClose,
}: {
  title: string
  sourceName: string | null
  sourceUrl: string
  notice: string
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="relative w-[22rem] max-w-full rounded-2xl bg-white p-7 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onClose}
          aria-label="关闭"
          className="absolute right-4 top-4 flex h-12 w-12 items-center justify-center rounded-full text-gray-400 hover:bg-gray-100"
        >
          <XIcon className="h-5 w-5" />
        </button>
        <p className="text-center text-base font-semibold text-gray-800">再次打开来源平台</p>
        <p className="mt-1 truncate text-center text-xs text-gray-400">{title}</p>
        <div className="mt-5 flex justify-center"><SourceUrlQr value={sourceUrl} size={196} /></div>
        {sourceName && <p className="mt-3 text-center text-xs text-gray-500">来源机构：{sourceName}</p>}
        <p className="mt-4 text-xs leading-relaxed text-gray-500">{notice}</p>
      </div>
    </div>
  )
}

// ── 子列表渲染 ────────────────────────────────────────────────────────────────

function LogRows<T extends MemberBrowseLogItem>({
  subtitle,
  list,
  type,
  rowIcon,
  onView,
  onReopen,
  onDelete,
}: {
  subtitle: string
  list: ReturnType<typeof useLogList<T>>
  type: ActivityTargetType
  rowIcon: typeof EyeIcon
  onView: (item: T) => void
  onReopen: (item: T) => void
  onDelete: (item: T) => void
}) {
  const meta = TYPE_META[type]
  return (
    <div>
      <p className="px-1 pt-2 text-xs font-medium text-gray-500">
        {subtitle}
        {list.total !== null && list.total > 0 && <span className="ml-1 text-gray-400">({list.total})</span>}
      </p>
      {list.loading ? (
        <p className="flex items-center gap-2 px-1 py-2 text-xs text-gray-400">
          <Loader2Icon className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          加载中…
        </p>
      ) : list.error ? (
        <div className="flex items-center justify-between px-1 py-1 text-xs">
          <span className="text-gray-500">加载失败</span>
          <button
            type="button"
            onClick={list.reload}
            className="min-h-[48px] rounded-lg border border-gray-200 px-3 font-medium text-primary-600 hover:bg-primary-50"
          >
            重试
          </button>
        </div>
      ) : list.items.length === 0 ? (
        <p className="px-1 py-1.5 text-xs text-gray-400">{meta.emptyHint}</p>
      ) : (
        <>
          <div className="divide-y divide-gray-100">
            {list.items.map((item) => (
              <AssetRow
                key={item.id}
                icon={rowIcon}
                iconBg={meta.iconBg}
                iconColor={meta.iconColor}
                name={item.targetTitle ?? `${meta.label}记录`}
                meta={`${item.sourceName ? `${item.sourceName} · ` : ''}${formatTime(item.createdAt)}`}
              >
                <RowTextButton label="查看" icon={EyeIcon} onClick={() => onView(item)} />
                {item.sourceUrl && isValidSourceUrl(item.sourceUrl) && (
                  <RowTextButton label="再次打开" icon={QrCodeIcon} onClick={() => onReopen(item)} />
                )}
                <TwoStepDeleteButton title="删除记录" onConfirm={() => onDelete(item)} />
              </AssetRow>
            ))}
          </div>
          {list.nextCursor && (
            <button
              type="button"
              onClick={list.loadMore}
              disabled={list.loadingMore}
              className="mb-1 mt-1 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-lg border border-dashed border-gray-200 text-sm font-medium text-gray-500 hover:bg-gray-50 disabled:opacity-60"
            >
              {list.loadingMore && <Loader2Icon className="h-4 w-4 animate-spin" aria-hidden="true" />}
              加载更多
            </button>
          )}
        </>
      )}
    </div>
  )
}

// ── 主组件 ────────────────────────────────────────────────────────────────────

export function ActivityLogsGroup({ onToast }: { onToast: (msg: string) => void }) {
  const { isLoggedIn, getToken } = useAuth()
  const navigate = useNavigate()
  const [type, setType] = useState<ActivityTargetType>('job')
  const [reopen, setReopen] = useState<MemberBrowseLogItem | MemberJumpLogItem | null>(null)

  const browse = useLogList<MemberBrowseLogItem>(
    isLoggedIn,
    useCallback(
      (cursor: string | null) => getMyBrowseLogs(getToken(), { cursor, pageSize: PAGE_SIZE, targetType: type }),
      [getToken, type],
    ),
  )
  const jumps = useLogList<MemberJumpLogItem>(
    isLoggedIn,
    useCallback(
      (cursor: string | null) => getMyJumpLogs(getToken(), { cursor, pageSize: PAGE_SIZE, targetType: type }),
      [getToken, type],
    ),
  )

  const meta = TYPE_META[type]

  const handleView = (item: MemberBrowseLogItem) => navigate(meta.viewRoute(item.targetId))

  // 「再次打开来源平台」也是一次打开入口动作 → 再记一条跳转记录（fire-and-forget，
  // 目标已下架时服务端拒绝记录但二维码照常展示，绝不阻断）。
  const handleReopen = (item: MemberBrowseLogItem) => {
    recordExternalJump(getToken(), type, item.targetId, JUMP_ACTION[type])
    setReopen(item)
  }

  const handleDeleteBrowse = async (item: MemberBrowseLogItem) => {
    const token = getToken()
    if (!token) return
    try {
      await deleteMyBrowseLog(token, item.id)
      browse.removeLocal(item.id)
      onToast('浏览记录已删除')
    } catch {
      onToast('删除失败，请稍后重试')
    }
  }

  const handleDeleteJump = async (item: MemberJumpLogItem) => {
    const token = getToken()
    if (!token) return
    try {
      await deleteMyJumpLog(token, item.id)
      jumps.removeLocal(item.id)
      onToast('跳转记录已删除')
    } catch {
      onToast('删除失败，请稍后重试')
    }
  }

  return (
    <div className="border-t border-gray-100 py-2">
      {reopen?.sourceUrl && (
        <ReopenQrOverlay
          title={reopen.targetTitle ?? `${meta.label}记录`}
          sourceName={reopen.sourceName}
          sourceUrl={reopen.sourceUrl}
          notice={meta.notice}
          onClose={() => setReopen(null)}
        />
      )}

      <div className="flex items-center justify-between px-1 py-1.5">
        <p className="text-xs font-medium text-gray-500">浏览与跳转记录</p>
        <div className="flex gap-1">
          {(Object.keys(TYPE_META) as ActivityTargetType[]).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              aria-pressed={type === t}
              className={[
                'min-h-[44px] rounded-lg px-3 text-xs font-medium transition-colors',
                type === t ? 'bg-primary-50 text-primary-700' : 'text-gray-500 hover:bg-gray-50',
              ].join(' ')}
            >
              {TYPE_META[t].label}
            </button>
          ))}
        </div>
      </div>

      <LogRows
        subtitle={`最近查看${meta.label}`}
        list={browse}
        type={type}
        rowIcon={EyeIcon}
        onView={handleView}
        onReopen={handleReopen}
        onDelete={(item) => void handleDeleteBrowse(item)}
      />
      <LogRows
        subtitle={meta.jumpLabel}
        list={jumps}
        type={type}
        rowIcon={ExternalLinkIcon}
        onView={handleView}
        onReopen={handleReopen}
        onDelete={(item) => void handleDeleteJump(item)}
      />

      <p className="px-1 pb-1 pt-2 text-xs leading-relaxed text-gray-400">{meta.notice}</p>
    </div>
  )
}
