// ============================================================
// 我的浏览 / 跳转 / 求职进度 — /me/activity（本人）。
// 三 Tab 合一。数据跨类型（岗位 / 招聘会 / 政策 / 企业 / 参展企业）。
//
// 前两个 Tab 与第三个性质**不同**，改这个文件前先分清：
//
//   浏览记录 / 外部跳转记录 = 系统观测到的**行为**。合规（CLAUDE.md §2/§10）只允许记录
//     「浏览」与「打开来源平台 / 官方入口」这一动作本身；文案统一用「打开来源入口 /
//     官方入口」，绝不写「投递结果 / 预约结果 / 凭证」—— 来源平台上的结果本系统不记录。
//
//   求职进度 = 用户**自己写下来的**（compliance-boundary.md §4.4A，2026-09-02 具名授权）。
//     它不违反上面那条：本系统依然不记录来源平台的处理结果，它记的是用户本人说的话。
//     判定原则是「合法性由谁写的决定，不由字段名决定」。
//     因此这一 Tab 的所有写入都只能来自用户手动操作，绝不能接任何第三方回流。
// ============================================================

import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Card, EmptyState } from '@ai-job-print/ui'
import type { JobApplicationItem, JobApplicationStatus, MemberBrowseLogItem, MemberJumpLogItem } from '@ai-job-print/shared'
import { JOB_APPLICATION_STATUS_LABELS } from '@ai-job-print/shared'
import { ChevronRightIcon, ClipboardListIcon, ExternalLinkIcon, EyeIcon, Trash2Icon } from 'lucide-react'
import { getMyBrowseLogs, getMyJumpLogs } from '../../../services/api/activity'
import {
  deleteJobApplication,
  getAllMyJobApplications,
  updateJobApplication,
} from '../../../services/api/jobApplications'
import { useAuth } from '../../../auth/useAuth'
import { KIcon, type KioskIconName } from '../../../components/kiosk-icon'
import { useInkRipple } from '../../../hooks/useInkRipple'
import { formatTime } from '../assets/format'
import { actionLabel, detailRoute, TYPE_LABEL } from './activityPresentation'
import { MeListShell, type MeListState } from './MeListShell'
import './me-detail-inkpaper.css'

/**
 * 状态推进顺序：点一下往下一档走，避免在触控屏上做下拉选择。
 *
 * 必须是**覆盖全部五个状态的单一循环** —— 每个状态都要能被点到。
 * 初版写成 offered → intention 且 rejected 只出不进，结果「已拒绝」永远到不了，
 * 用户被拒了记不进去。门禁 verify:job-application-track 现在断言可达性。
 */
const NEXT_STATUS: Record<JobApplicationStatus, JobApplicationStatus> = {
  intention: 'applied',
  applied: 'interviewing',
  interviewing: 'offered',
  offered: 'rejected',
  rejected: 'intention',
}

/** icon / tone 取值须在 KioskIconName 与 .me-tone-* 之内（可用色调：teal/slate/wheat/rose/clay）。 */
const STATUS_META: Record<JobApplicationStatus, { icon: KioskIconName; tone: string }> = {
  intention: { icon: 'star', tone: 'wheat' },
  applied: { icon: 'send', tone: 'teal' },
  interviewing: { icon: 'chat', tone: 'clay' },
  offered: { icon: 'check', tone: 'rose' },
  rejected: { icon: 'close', tone: 'slate' },
}

type ActivityTab = 'browse' | 'jump' | 'applications'

export function MyActivityPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { isLoggedIn, getToken } = useAuth()
  const [browse, setBrowse] = useState<MemberBrowseLogItem[]>([])
  const [jumps, setJumps] = useState<MemberJumpLogItem[]>([])
  const [applications, setApplications] = useState<JobApplicationItem[]>([])
  const [state, setState] = useState<MeListState>('loading')
  const [reloadKey, setReloadKey] = useState(0)
  const [busyId, setBusyId] = useState<string | null>(null)
  useInkRipple('.me-inkdetail .me-ripple')

  const rawTab = searchParams.get('tab')
  const tab: ActivityTab = rawTab === 'jump' ? 'jump' : rawTab === 'applications' ? 'applications' : 'browse'
  const setTab = (next: ActivityTab) =>
    setSearchParams(next === 'browse' ? {} : { tab: next }, { replace: true })

  const load = useCallback(() => {
    if (!isLoggedIn) {
      setState('ready')
      return
    }
    setState('loading')
    const token = getToken()
    Promise.all([
      getMyBrowseLogs(token, { pageSize: 50 }),
      getMyJumpLogs(token, { pageSize: 50 }),
      getAllMyJobApplications(token),
    ])
      .then(([b, j, a]) => {
        setBrowse(b.items)
        setJumps(j.items)
        setApplications(a)
        setState('ready')
      })
      .catch(() => setState('error'))
  }, [isLoggedIn, getToken])

  useEffect(() => {
    load()
  }, [load, reloadKey])

  /** 推进一条求职进度的状态。只改用户自己那条，statusSource 由服务端恒定为「用户自填」。 */
  async function advance(item: JobApplicationItem) {
    if (busyId) return
    setBusyId(item.id)
    try {
      const next = await updateJobApplication(getToken(), item.id, { status: NEXT_STATUS[item.status] })
      if (next) setApplications((prev) => prev.map((i) => (i.id === next.id ? next : i)))
    } catch {
      setState('error')
    } finally {
      setBusyId(null)
    }
  }

  async function removeApplication(item: JobApplicationItem) {
    if (busyId) return
    setBusyId(item.id)
    try {
      await deleteJobApplication(getToken(), item.id)
      setApplications((prev) => prev.filter((i) => i.id !== item.id))
    } catch {
      setState('error')
    } finally {
      setBusyId(null)
    }
  }

  const tabs: { key: ActivityTab; label: string; count: number }[] = [
    { key: 'browse', label: '浏览记录', count: browse.length },
    { key: 'jump', label: '外部跳转记录', count: jumps.length },
    { key: 'applications', label: '求职进度', count: applications.length },
  ]

  return (
    <div className="me-inkdetail me-inkdetail-activity h-full">
      <MeListShell
        title="浏览、跳转与求职进度"
        subtitle="本人的访问足迹，以及你自己记录的求职进展（仅本人可见）"
        loginFrom="/me/activity"
        isLoggedIn={isLoggedIn}
        state={state}
        onRetry={() => setReloadKey((k) => k + 1)}
      >
        <section className="me-detail-summary" aria-label="浏览、跳转与求职进度概览">
          <span className="me-summary-icon me-tone-slate" aria-hidden="true">
            <KIcon name="clock" />
          </span>
          <div className="min-w-0 flex-1">
            <p>访问足迹与求职进度</p>
            <strong>{browse.length + jumps.length + applications.length}</strong>
            {/* 两句都是合规要求的诚实声明，缺一不可：前半句管前两个 Tab（系统观测到的行为），
                后半句管第三个 Tab（用户自己写的）。不得改成暗示平台掌握结果的措辞。 */}
            <span>浏览与跳转只记录动作本身；求职进度全部由你自己填写，本终端不参与投递</span>
          </div>
          <div className="me-summary-mini" aria-label="记录数量">
            <span>浏览 {browse.length}</span>
            <span>跳转 {jumps.length}</span>
            <span>进度 {applications.length}</span>
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

        {tab === 'applications' ? null : tab === 'browse' ? (
          browse.length === 0 ? (
            <Card className="me-empty-card">
              <EmptyState icon={EyeIcon} title="还没有浏览记录" description="浏览岗位 / 招聘会 / 政策 / 企业后，这里会显示你的浏览记录" className="py-12" />
            </Card>
          ) : (
            browse.map((it) => (
              <ActivityRow
                key={it.id}
                icon="eye"
                tone="slate"
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
              tone="teal"
              title={it.targetTitle ?? `${TYPE_LABEL[it.targetType]}详情`}
              meta={`打开${actionLabel(it.action, it.targetType)} · ${TYPE_LABEL[it.targetType]} · ${formatTime(it.createdAt)}`}
              onTap={() => navigate(detailRoute(it.targetType, it.targetId, it.externalId))}
            />
          ))
        )}

        {tab === 'applications' &&
          (applications.length === 0 ? (
            <Card className="me-empty-card">
              <EmptyState
                icon={ClipboardListIcon}
                title="还没有求职进度"
                description="在岗位详情页去来源平台投递后，回来点「记录一次投递」，这里会显示你的求职进展"
                className="py-12"
              />
            </Card>
          ) : (
            applications.map((item) => {
              const meta = STATUS_META[item.status]
              const busy = busyId === item.id
              const nextLabel = JOB_APPLICATION_STATUS_LABELS[NEXT_STATUS[item.status]]
              return (
                <Card key={item.id} className="me-app-card">
                  <span className={['me-row-icon', `me-tone-${meta.tone}`].join(' ')} aria-hidden="true">
                    <KIcon name={meta.icon} />
                  </span>
                  <button
                    type="button"
                    className="me-app-main me-ripple"
                    disabled={!item.jobId}
                    onClick={() => item.jobId && navigate(`/jobs/${item.jobId}`)}
                  >
                    <span className="me-row-title">
                      {item.positionTitle}
                      <span className="me-app-company"> · {item.companyName}</span>
                    </span>
                    <span className="me-row-meta">
                      {JOB_APPLICATION_STATUS_LABELS[item.status]}
                      {item.appliedAt ? ` · 你填写的投递时间 ${formatTime(item.appliedAt)}` : ''}
                      {item.sourceName ? ` · 来源 ${item.sourceName}` : ''}
                    </span>
                  </button>
                  <div className="me-app-actions">
                    <button
                      type="button"
                      className={['me-app-action me-ripple', busy ? 'is-disabled' : ''].join(' ')}
                      onClick={() => void advance(item)}
                      disabled={busy}
                      aria-label={`把这条记录改为${nextLabel}`}
                    >
                      改为{nextLabel}
                    </button>
                    <button
                      type="button"
                      className={['me-app-action me-ripple', busy ? 'is-disabled' : ''].join(' ')}
                      onClick={() => void removeApplication(item)}
                      disabled={busy}
                      aria-label={`删除 ${item.companyName} ${item.positionTitle} 这条记录`}
                    >
                      <Trash2Icon aria-hidden="true" />
                      删除
                    </button>
                  </div>
                  {item.jobId ? <ChevronRightIcon className="me-row-arrow" aria-hidden="true" /> : null}
                </Card>
              )
            })
          ))}

        <p className="me-legal-note">
          {tab === 'applications'
            ? '求职进度由你本人填写，仅你可见；本终端不参与投递，也不掌握来源平台的处理结果，更不会把这些记录提供给企业或来源机构'
            : '仅记录本人浏览与打开来源入口的行为；投递 / 预约结果以来源平台为准，本系统不记录'}
        </p>
      </MeListShell>
    </div>
  )
}

function ActivityRow({
  icon,
  tone,
  title,
  meta,
  onTap,
}: {
  icon: KioskIconName
  tone: string
  title: string
  meta: string
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
      <ChevronRightIcon className="me-row-arrow" aria-hidden="true" />
    </button>
  )
}
