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
import { KIcon, type KioskIconName } from '../../../components/kiosk-icon'
import { useInkRipple } from '../../../hooks/useInkRipple'
import { formatTime } from '../assets/format'
import { MeListShell, type MeListState } from './MeListShell'
import './me-detail-inkpaper.css'

const TYPE_LABEL: Record<ActivityTargetType, string> = {
  job: '岗位',
  job_fair: '招聘会',
  policy: '政策',
  company_profile: '企业',
  fair_company: '参展企业',
}

// 原型各类型对应的 accent 色调（me-tone-* 系列）
const TYPE_TONE: Record<ActivityTargetType, string> = {
  job: 'teal',
  job_fair: 'wheat',
  policy: 'slate',
  company_profile: 'clay',
  fair_company: 'wheat',
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
  useInkRipple('.me-inkdetail .me-ripple')

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
    <div className="me-inkdetail me-inkdetail-activity h-full">
      <MeListShell
        title="浏览与跳转记录"
        subtitle="本人浏览过的、以及打开过来源平台 / 官方入口的记录（仅本人可见）"
        loginFrom="/me/activity"
        isLoggedIn={isLoggedIn}
        state={state}
        onRetry={() => setReloadKey((k) => k + 1)}
      >
        <section className="me-detail-summary" aria-label="浏览与跳转记录概览">
          <span className="me-summary-icon me-tone-slate" aria-hidden="true">
            <KIcon name="clock" />
          </span>
          <div className="min-w-0 flex-1">
            <p>访问足迹</p>
            <strong>{browse.length + jumps.length}</strong>
            <span>只记录浏览与打开来源入口动作，不记录投递或预约结果</span>
          </div>
          <div className="me-summary-mini" aria-label="浏览与跳转记录数量">
            <span>浏览 {browse.length}</span>
            <span>跳转 {jumps.length}</span>
          </div>
        </section>

        <div className="me-tabbar">
          {tabs.map((t) => {
            const active = tab === t.key
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={['me-tab me-ripple', active ? 'is-active' : ''].join(' ')}
                aria-pressed={active}
              >
                {t.label}
                <span>{t.count}</span>
              </button>
            )
          })}
        </div>

        {tab === 'browse' ? (
          browse.length === 0 ? (
            <Card className="me-empty-card">
              <EmptyState icon={EyeIcon} title="还没有浏览记录" description="浏览岗位 / 招聘会 / 政策 / 企业后，这里会显示你的浏览记录" className="py-12" />
            </Card>
          ) : (
            browse.map((it) => (
              <ActivityRow
                key={it.id}
                icon="eye"
                tone={TYPE_TONE[it.targetType]}
                typeLabel={TYPE_LABEL[it.targetType]}
                title={it.targetTitle ?? `${TYPE_LABEL[it.targetType]}详情`}
                meta={`浏览 · ${TYPE_LABEL[it.targetType]}${it.sourceName ? ` · ${it.sourceName}` : ''} · ${formatTime(it.createdAt)}`}
                onTap={() => navigate(detailRoute(it.targetType, it.targetId, it.externalId))}
              />
            ))
          )
        ) : jumps.length === 0 ? (
          <Card className="me-empty-card">
            <EmptyState icon={ExternalLinkIcon} title="还没有跳转记录" description="打开岗位 / 招聘会 / 政策的来源平台或官方入口后，这里会显示记录" className="py-12" />
          </Card>
        ) : (
          jumps.map((it) => (
            <ActivityRow
              key={it.id}
              icon="external"
              tone={TYPE_TONE[it.targetType]}
              typeLabel={TYPE_LABEL[it.targetType]}
              title={it.targetTitle ?? `${TYPE_LABEL[it.targetType]}详情`}
              meta={`打开${actionLabel(it.action, it.targetType)} · ${TYPE_LABEL[it.targetType]} · ${formatTime(it.createdAt)}`}
              onTap={() => navigate(detailRoute(it.targetType, it.targetId, it.externalId))}
            />
          ))
        )}

        <p className="me-legal-note">仅记录本人浏览与打开来源入口的行为；投递 / 预约结果以来源平台为准，本系统不记录</p>
      </MeListShell>
    </div>
  )
}

function ActivityRow({
  icon,
  tone,
  title,
  meta,
  typeLabel,
  onTap,
}: {
  icon: KioskIconName
  tone: string
  title: string
  meta: string
  typeLabel?: string
  onTap: () => void
}) {
  return (
    <button
      type="button"
      onClick={onTap}
      className="me-detail-row me-ripple"
    >
      <span className={['me-row-icon', `me-tone-${tone}`].join(' ')} aria-hidden="true">
        <KIcon name={icon} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="me-row-title">{title}</span>
        <span className="me-row-meta">{meta}</span>
      </span>
      {typeLabel && <span className="me-type-chip" aria-label={`类型：${typeLabel}`}>{typeLabel}</span>}
      <ChevronRightIcon className="me-row-arrow" aria-hidden="true" />
    </button>
  )
}
