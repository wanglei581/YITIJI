import { useMemberCursorPage } from './useMemberCursorPage'
import { MemberLoadMore } from './MemberLoadMore'
// 我的浏览 / 外部跳转记录 / 本人自填求职进度。
// 合规（CLAUDE.md §2/§10、§4.4A）：浏览/跳转只记动作本身，不得加履约状态；
// 求职进度只展示用户本人填写的条目，每条带不可隐藏的「本人自填」标签。
// 招聘内容托管（next-tasks 3.13）关闭时：足迹里不出现岗位、招聘会、企业类记录，
// 空态与底栏也不再引导去看岗位或招聘会（那些页在本机不开放）。

import { useCallback, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { JobApplicationItem, MemberBrowseLogItem, MemberJumpLogItem } from '@ai-job-print/shared'
import { getMyBrowseLogs, getMyJumpLogs } from '../../../services/api/activity'
import { listMyJobApplications } from '../../../services/api/jobApplications'
import { useAuth } from '../../../auth/useAuth'
import { useRecruitmentHosting } from '../../../hooks/useRecruitmentHosting'
import { useSupportContact } from '../../../hooks/useSupportContact'
import { formatTime } from '../assets/format'
import { actionLabel, APPLICATION_STATUS_LABEL, detailRoute, TYPE_LABEL } from './activityPresentation'
import { QxMePage, recordsCtabar } from './qx/QxMeChrome'
import { QxMeErrorBlock, QxMeLoadingBlock, QxMeLoginBlock } from './qx/QxMeStateBits'
import { MeBtn, MeP, MeRows, MeSeg } from '../touch/MeKit'
import { MeEmptyPack, MeExitCard } from '../touch/MeStatePacks'
import './styles/member-records-qx.css'

type ActivityTab = 'browse' | 'jump' | 'applications'

/** 托管关闭时只保留政策类记录：其余类型的详情页都在招聘内容闸门后面。 */
const keepWhenClosed = (item: { targetType: string }) => item.targetType === 'policy'

function getTab(searchParams: URLSearchParams): ActivityTab {
  if (searchParams.get('tab') === 'applications') return 'applications'
  return searchParams.get('tab') === 'jump' ? 'jump' : 'browse'
}

export function MyActivityPage() {
  const loginFrom = '/me/activity'
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { isLoggedIn, getToken } = useAuth()
  const hostingOpen = useRecruitmentHosting().enabled
  // 求职进度页签由后台开关控制，默认不显示：读不到开关、没配开关都当关。
  const showJobProgressTab = useSupportContact(isLoggedIn).selfNoteTab
  const [reloadKey, setReloadKey] = useState(0)
  const requestedTab = getTab(searchParams)
  const tab = showJobProgressTab || requestedTab !== 'applications' ? requestedTab : 'browse'
  const setTab = (next: ActivityTab) => {
    if (next === 'applications') setSearchParams({ tab: 'applications' }, { replace: true })
    else setSearchParams(next === 'jump' ? { tab: 'jump' } : {}, { replace: true })
  }

  const token = getToken()
  const fetchBrowse = useCallback((cursor?: string) => getMyBrowseLogs(token, { pageSize: 50, cursor }), [token])
  const fetchJumps = useCallback((cursor?: string) => getMyJumpLogs(token, { pageSize: 50, cursor }), [token])
  const fetchApplications = useCallback((cursor?: string) => listMyJobApplications(token, { pageSize: 50, cursor }), [token])
  const browsePage = useMemberCursorPage<MemberBrowseLogItem>({ enabled: isLoggedIn && tab === 'browse', identityKey: token, reloadKey, fetchPage: fetchBrowse })
  const jumpsPage = useMemberCursorPage<MemberJumpLogItem>({ enabled: isLoggedIn && tab === 'jump', identityKey: token, reloadKey, fetchPage: fetchJumps })
  const applicationsPage = useMemberCursorPage<JobApplicationItem>({ enabled: isLoggedIn && tab === 'applications', identityKey: token, reloadKey, fetchPage: fetchApplications })
  const { items: loadedBrowse } = browsePage
  const { items: loadedJumps } = jumpsPage
  const { items: applications } = applicationsPage
  const pagination = tab === 'browse' ? browsePage : tab === 'jump' ? jumpsPage : applicationsPage
  const state = pagination.state

  const browse = hostingOpen ? loadedBrowse : loadedBrowse.filter(keepWhenClosed)
  const jumps = hostingOpen ? loadedJumps : loadedJumps.filter(keepWhenClosed)

  const empty = !pagination.nextCursor && (tab === 'browse' ? browse.length === 0 : tab === 'jump' ? jumps.length === 0 : applications.length === 0)
  const uiState = !isLoggedIn
    ? 'login'
    : state === 'loading'
      ? 'loading'
      : state === 'error'
        ? 'error'
        : empty
          ? `${tab}-empty`
          : `${tab}-ready`

  const tabItems = [
    { id: 'browse', label: '浏览', testId: 'member-records-activity-tab-browse', aria: '浏览记录' },
    { id: 'jump', label: '外部跳转', testId: 'member-records-activity-tab-jump', aria: '外部跳转记录' },
    ...(showJobProgressTab ? [{ id: 'applications', label: '求职进度', testId: 'member-records-activity-tab-applications', aria: '求职进度' }] : []),
  ]
  const tabs = (
    <MeSeg
      label="记录筛选"
      current={tab}
      items={tabItems}
      onPick={(id) => setTab(id as ActivityTab)}
    />
  )

  let body: ReactNode
  if (!isLoggedIn) {
    body = <QxMeLoginBlock title="登录后查看本人记录" />
  } else if (state === 'loading') {
    body = <QxMeLoadingBlock title="正在加载本人记录" />
  } else if (state === 'error') {
    body = <QxMeErrorBlock onRetry={() => setReloadKey((k) => k + 1)} />
  } else if (tab === 'applications') {
    body = applications.length === 0 ? (
      <>
        {tabs}
        <MeP>求职进度是本人自己填的。手填还在建设，现在不能填。</MeP>
        <MeBtn v="sec" disabled data-testid="member-records-start-manual">手填入口待建设</MeBtn>
        <div className="me-state" data-testid="member-records-application-list">
          <MeP>{hostingOpen ? '在岗位详情页投完之后，从那里把这次投递记进来。' : '求职进度只由你本人填写。'}{pagination.nextCursor ? '已加载的记录中没有这一类，可继续加载较早记录。' : '当前没有这一类记录。'}本页不会替你造进度。</MeP>
          <div className="me-stack">
            <MeExitCard art="checklist" artWidth={120} title="查看政策" desc="进度不能填的时候，可以先看政策" onClick={() => navigate('/policy-service')} />
          </div>
        </div>
      </>
    ) : (
      <>
        {tabs}
        <MeRows few={applications.length < 5} testId="member-records-application-list" label="求职进度">
          {applications.map((item) => (
            <div key={item.id} className="me-static" data-testid={`member-records-application-${item.id}`} data-status-source={item.statusSource}>
              <b>{item.positionTitle} · {item.companyName}</b>
              <small>
                <span className="qx-me-chip qx-me-self">本人自填</span> {APPLICATION_STATUS_LABEL[item.status]}
              </small>
              <small>{item.selfReportedAt ? `你填写的投递时间 ${formatTime(item.selfReportedAt)}` : '尚未填写投递时间'}</small>
            </div>
          ))}
        </MeRows>
        <MeP>求职进度<b>由你本人填写，仅你可见</b>；本终端不参与投递，也不掌握来源平台的处理结果，更不会把这些记录提供给企业或来源机构。</MeP>
      </>
    )
  } else if (empty) {
    const browseTab = tab === 'browse'
    body = (
      <>
        {tabs}
        <div className="me-state" data-testid="qx-me-fallback">
          <MeEmptyPack sentence={browseTab ? '这里还没有记录。只记你在这台机器上浏览和打开的来源。' : '打开来源平台或官方入口之后，这里会出现记录。是否投递、是否预约得成由来源平台决定，本系统不记录也不参与。'}>
            {hostingOpen ? (
              <>
                <MeExitCard art="checklist" artWidth={120} title="查看岗位" desc="在岗位详情里点「去来源平台投递」或「扫码投递」" onClick={() => navigate('/jobs')} />
                <MeExitCard art="stack" artWidth={110} title="查看招聘会" desc="在招聘会详情里点「去来源平台预约」或「扫码预约」" onClick={() => navigate('/job-fairs')} />
              </>
            ) : (
              <>
                <MeExitCard art="checklist" artWidth={120} title="查看政策" desc="看本机构发布的就业政策" onClick={() => navigate('/policy-service')} />
                <MeExitCard art="usb" artWidth={120} title="去打印" desc="打印和扫描现在就能办" onClick={() => navigate('/print-scan')} />
              </>
            )}
          </MeEmptyPack>
        </div>
      </>
    )
  } else {
    body = (
      <>
        {tabs}
        <MeRows few={(tab === 'browse' ? browse : jumps).length < 7} testId="member-records-list" label="浏览与跳转记录">
          {tab === 'browse'
            ? browse.map((it) => (
              <button
                key={it.id}
                type="button"
                className="me-line"
                data-activity-kind="browse"
                data-testid={`member-records-activity-${it.id}`}
                onClick={() => navigate(detailRoute(it.targetType, it.targetId, it.externalId))}
              >
                <b>{it.targetTitle ?? `${TYPE_LABEL[it.targetType]}详情`}</b>
                <small>浏览 · {TYPE_LABEL[it.targetType]}{it.sourceName ? ` · ${it.sourceName}` : ''} · {formatTime(it.createdAt)}</small>
              </button>
            ))
            : jumps.map((it) => (
              <button
                key={it.id}
                type="button"
                className="me-line"
                data-activity-kind="jump"
                data-testid={`member-records-activity-${it.id}`}
                onClick={() => navigate(detailRoute(it.targetType, it.targetId, it.externalId))}
              >
                <b>{it.targetTitle ?? `${TYPE_LABEL[it.targetType]}详情`}</b>
                <small>打开{actionLabel(it.action, it.targetType)} · {TYPE_LABEL[it.targetType]} · {formatTime(it.createdAt)}</small>
              </button>
            ))}
        </MeRows>
        {(tab === 'browse' ? browse : jumps).length < 7 ? (
          <div className="me-stack">
            <MeExitCard art="checklist" artWidth={110} title={hostingOpen ? '查看岗位' : '查看政策'} desc={hostingOpen ? '在岗位详情里点「去来源平台投递」或「扫码投递」' : '看本机构发布的就业政策'} onClick={() => navigate(hostingOpen ? '/jobs' : '/policy-service')} />
            <MeExitCard art="usb" artWidth={110} title="去打印" desc="打印和扫描现在就能办" onClick={() => navigate('/print-scan')} />
          </div>
        ) : null}
      </>
    )
  }

  const primaryLabel = !hostingOpen ? '查看政策' : tab === 'jump' ? '查看招聘会' : '查看岗位'
  const primaryGo = () => navigate(!hostingOpen ? '/policy-service' : tab === 'jump' ? '/job-fairs' : '/jobs')

  return (
    <QxMePage
      title="浏览与跳转记录"
      view="activity"
      screen="member-list"
      screenState={`activity-${uiState}`}
      eyebrow="我的 · 浏览记录"
      sub={showJobProgressTab
        ? '看过什么、去过哪个来源、自己记了哪些进度，都能回看'
        : '只记录浏览和打开，不记录你在别的平台办了什么'}
      fine={showJobProgressTab
        ? '仅记录本人浏览与打开来源入口的行为；投递 / 预约结果以来源平台为准，本系统不记录。本终端不参与投递，也不掌握来源平台的处理结果；求职进度仅你可见，不会提供给企业或来源机构。离开 3 分钟没操作会自动退出。'
        : '只记录你在这台机器上看过的政策。投递 / 预约结果以来源平台为准，本系统不记录。离开 3 分钟没操作会自动退出。'}
      ctabar={recordsCtabar(uiState === 'login' || uiState === 'loading' || uiState === 'error' ? uiState : 'ready', navigate, () => setReloadKey((k) => k + 1), loginFrom, primaryLabel, primaryGo)}
    >
      {body}
      {isLoggedIn && state === 'ready' ? <MemberLoadMore {...pagination} /> : null}
    </QxMePage>
  )
}
