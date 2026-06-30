// ============================================================
// 我的浏览 / 外部跳转记录 — /me/browse-logs + /me/external-jump-logs（本人）。
// 两 Tab 合一：浏览记录 / 外部跳转记录。数据跨类型（岗位 / 招聘会 / 政策 / 企业 / 参展企业）。
//
// 合规（CLAUDE.md §2/§10）：只记录「浏览」与「打开来源平台 / 官方入口」这一动作本身；
// 文案统一用「打开来源入口 / 官方入口」，绝不写「投递结果 / 预约结果 / 凭证」；
// 投递 / 预约结果以来源平台为准，本系统不记录也不参与。
// ============================================================

import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Card, EmptyState } from '@ai-job-print/ui'
import type {
  ActivityJumpAction,
  ActivityTargetType,
  MemberBrowseLogItem,
  MemberJumpLogItem,
} from '@ai-job-print/shared'
import { ChevronRightIcon, ExternalLinkIcon, EyeIcon } from 'lucide-react'
import { getMyBrowseLogs, getMyJumpLogs } from '../../../services/api/activity'
import { useAuth } from '../../../auth/useAuth'
import { formatTime } from '../assets/format'
import { MeListShell, type MeListState } from './MeListShell'

const TYPE_LABEL: Record<ActivityTargetType, string> = {
  job: '岗位',
  job_fair: '招聘会',
  policy: '政策',
  company_profile: '企业',
  fair_company: '参展企业',
}

// 跳转动作 → 中性「入口」措辞（不出现投递 / 预约 / 凭证）。
const ACTION_LABEL: Record<ActivityJumpAction, string> = {
  external_apply: '岗位来源入口',
  external_appointment: '招聘会来源入口',
  external_checkin_open: '招聘会签到来源入口',
  external_open: '官方入口',
}

function detailRoute(targetType: ActivityTargetType, targetId: string, externalId?: string | null): string {
  switch (targetType) {
    case 'job':
      return `/jobs/${targetId}`
    case 'job_fair':
      return `/job-fairs/${targetId}`
    case 'company_profile':
      return `/companies/${targetId}`
    case 'fair_company':
      return externalId ? `/job-fairs/${externalId}/companies/${targetId}` : '/job-fairs'
    default:
      return '/renshi'
  }
}

function actionLabel(action: ActivityJumpAction, targetType: ActivityTargetType): string {
  if (action === 'external_apply' && targetType === 'fair_company') return '参展企业来源入口'
  if (action === 'external_apply') return '岗位来源入口'
  return ACTION_LABEL[action]
}

export function MyActivityPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { isLoggedIn, getToken } = useAuth()
  const [browse, setBrowse] = useState<MemberBrowseLogItem[]>([])
  const [jumps, setJumps] = useState<MemberJumpLogItem[]>([])
  const [state, setState] = useState<MeListState>('loading')
  const [reloadKey, setReloadKey] = useState(0)

  const tab: 'browse' | 'jump' = searchParams.get('tab') === 'jump' ? 'jump' : 'browse'
  const setTab = (next: 'browse' | 'jump') => setSearchParams(next === 'jump' ? { tab: 'jump' } : {}, { replace: true })

  const load = useCallback(() => {
    if (!isLoggedIn) {
      setState('ready')
      return
    }
    setState('loading')
    const token = getToken()
    Promise.all([getMyBrowseLogs(token, { pageSize: 50 }), getMyJumpLogs(token, { pageSize: 50 })])
      .then(([b, j]) => {
        setBrowse(b.items)
        setJumps(j.items)
        setState('ready')
      })
      .catch(() => setState('error'))
  }, [isLoggedIn, getToken])

  useEffect(() => {
    load()
  }, [load, reloadKey])

  const tabs: { key: 'browse' | 'jump'; label: string; count: number }[] = [
    { key: 'browse', label: '浏览记录', count: browse.length },
    { key: 'jump', label: '外部跳转记录', count: jumps.length },
  ]

  return (
    <MeListShell
      title="浏览与跳转记录"
      subtitle="本人浏览过的、以及打开过来源平台 / 官方入口的记录（仅本人可见）"
      loginFrom="/me/activity"
      isLoggedIn={isLoggedIn}
      state={state}
      onRetry={() => setReloadKey((k) => k + 1)}
    >
      <div className="flex gap-2">
        {tabs.map((t) => {
          const active = tab === t.key
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={[
                'shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors',
                active ? 'bg-primary-600 text-white' : 'bg-white text-gray-600 ring-1 ring-gray-200',
              ].join(' ')}
            >
              {t.label}
              <span className={active ? 'ml-1 text-white/80' : 'ml-1 text-gray-400'}>{t.count}</span>
            </button>
          )
        })}
      </div>

      {tab === 'browse' ? (
        browse.length === 0 ? (
          <Card className="p-4">
            <EmptyState icon={EyeIcon} title="还没有浏览记录" description="浏览岗位 / 招聘会 / 政策 / 企业后，这里会显示你的浏览记录" className="py-12" />
          </Card>
        ) : (
          browse.map((it) => (
            <ActivityRow
              key={it.id}
              icon={EyeIcon}
              iconBg="bg-sky-50"
              iconColor="text-sky-600"
              title={it.targetTitle ?? `${TYPE_LABEL[it.targetType]}详情`}
              meta={`浏览 · ${TYPE_LABEL[it.targetType]}${it.sourceName ? ` · ${it.sourceName}` : ''} · ${formatTime(it.createdAt)}`}
              onTap={() => navigate(detailRoute(it.targetType, it.targetId, it.externalId))}
            />
          ))
        )
      ) : jumps.length === 0 ? (
        <Card className="p-4">
          <EmptyState icon={ExternalLinkIcon} title="还没有跳转记录" description="打开岗位 / 招聘会 / 政策的来源平台或官方入口后，这里会显示记录" className="py-12" />
        </Card>
      ) : (
        jumps.map((it) => (
          <ActivityRow
            key={it.id}
            icon={ExternalLinkIcon}
            iconBg="bg-teal-50"
            iconColor="text-teal-600"
            title={it.targetTitle ?? `${TYPE_LABEL[it.targetType]}详情`}
            meta={`打开${actionLabel(it.action, it.targetType)} · ${TYPE_LABEL[it.targetType]} · ${formatTime(it.createdAt)}`}
            onTap={() => navigate(detailRoute(it.targetType, it.targetId, it.externalId))}
          />
        ))
      )}

      <p className="mt-1 text-center text-xs text-gray-400">仅记录本人浏览与打开来源入口的行为；投递 / 预约结果以来源平台为准，本系统不记录</p>
    </MeListShell>
  )
}

function ActivityRow({
  icon: Icon,
  iconBg,
  iconColor,
  title,
  meta,
  onTap,
}: {
  icon: typeof EyeIcon
  iconBg: string
  iconColor: string
  title: string
  meta: string
  onTap: () => void
}) {
  return (
    <button
      type="button"
      onClick={onTap}
      className="flex w-full items-center gap-4 rounded-2xl border border-neutral-200 bg-white p-4 text-left shadow-sm transition-colors hover:bg-gray-50 active:bg-gray-100"
    >
      <div className={['flex h-12 w-12 shrink-0 items-center justify-center rounded-xl', iconBg].join(' ')}>
        <Icon className={['h-6 w-6', iconColor].join(' ')} aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-gray-900">{title}</p>
        <p className="mt-0.5 truncate text-xs text-gray-400">{meta}</p>
      </div>
      <ChevronRightIcon className="h-5 w-5 shrink-0 text-gray-300" aria-hidden="true" />
    </button>
  )
}
