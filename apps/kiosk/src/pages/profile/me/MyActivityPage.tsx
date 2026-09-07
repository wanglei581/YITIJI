// 我的浏览 / 外部跳转记录 / 本人自填求职进度。
// 合规（CLAUDE.md §2/§10、§4.4A）：浏览/跳转只记动作本身，不得加履约状态；
// 求职进度只展示用户本人填写的条目，每条带不可隐藏的「本人自填」标签。

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { JobApplicationItem, MemberBrowseLogItem, MemberJumpLogItem } from '@ai-job-print/shared'
import {
  BriefcaseIcon,
  CalendarDaysIcon,
  ChevronRightIcon,
  ClockIcon,
  EyeIcon,
  ExternalLinkIcon,
  FileTextIcon,
} from 'lucide-react'
import { getMyBrowseLogs, getMyJumpLogs } from '../../../services/api/activity'
import { listMyJobApplications } from '../../../services/api/jobApplications'
import { useAuth } from '../../../auth/useAuth'
import { formatTime } from '../assets/format'
import { actionLabel, APPLICATION_STATUS_LABEL, detailRoute, TYPE_LABEL } from './activityPresentation'
import { QxMeGuide, QxMePage, QxMeSummary, recordsCtabar } from './qx/QxMeChrome'
import { QxMeErrorBlock, QxMeLoadingBlock, QxMeLoginBlock, QxMePendingRow, QxMeStartRow, QxMeStructRow } from './qx/QxMeStateBits'
import './styles/member-records-qx.css'

type LoadState = 'loading' | 'error' | 'ready'
type ActivityTab = 'browse' | 'jump' | 'applications'

function getTab(searchParams: URLSearchParams): ActivityTab {
  if (searchParams.get('tab') === 'applications') return 'applications'
  return searchParams.get('tab') === 'jump' ? 'jump' : 'browse'
}

export function MyActivityPage() {
  const loginFrom = '/me/activity'
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { isLoggedIn, getToken } = useAuth()
  const [browse, setBrowse] = useState<MemberBrowseLogItem[]>([])
  const [jumps, setJumps] = useState<MemberJumpLogItem[]>([])
  const [applications, setApplications] = useState<JobApplicationItem[]>([])
  const [state, setState] = useState<LoadState>('loading')
  const [reloadKey, setReloadKey] = useState(0)
  const tab = getTab(searchParams)
  const setTab = (next: ActivityTab) => {
    if (next === 'applications') setSearchParams({ tab: 'applications' }, { replace: true })
    else setSearchParams(next === 'jump' ? { tab: 'jump' } : {}, { replace: true })
  }

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
      listMyJobApplications(token, { pageSize: 50 }),
    ])
      .then(([b, j, a]) => {
        setBrowse(b.items)
        setJumps(j.items)
        setApplications(a.items)
        setState('ready')
      })
      .catch(() => setState('error'))
  }, [isLoggedIn, getToken])

  useEffect(() => { load() }, [load, reloadKey])

  const empty = tab === 'browse' ? browse.length === 0 : tab === 'jump' ? jumps.length === 0 : applications.length === 0
  const uiState = !isLoggedIn
    ? 'login'
    : state === 'loading'
      ? 'loading'
      : state === 'error'
        ? 'error'
        : empty
          ? `${tab}-empty`
          : `${tab}-ready`

  const struct = (
    <>
      <QxMeStructRow icon={EyeIcon} title="浏览记录" desc="看过哪些岗位、招聘会与政策" mode={!isLoggedIn ? 'lock' : 'error'} testid="member-records-struct-activity-0" />
      <QxMeStructRow icon={ExternalLinkIcon} title="外部跳转记录" desc="打开过哪些来源平台或官方入口" mode={!isLoggedIn ? 'lock' : 'error'} testid="member-records-struct-activity-1" />
      <QxMeStructRow icon={ClockIcon} title="记录时间" desc="由服务端返回，本机不本地留存明细" mode={!isLoggedIn ? 'lock' : 'error'} testid="member-records-struct-activity-2" />
    </>
  )

  const tabs = (
    <div className="qx-me-tabbar" data-n="3" role="group" aria-label="记录筛选">
      <button type="button" className="qx-me-tab" aria-current={tab === 'browse' ? 'true' : undefined} data-testid="member-records-activity-tab-browse" onClick={() => setTab('browse')}>
        浏览记录<i>{browse.length}</i>
      </button>
      <button type="button" className="qx-me-tab" aria-current={tab === 'jump' ? 'true' : undefined} data-testid="member-records-activity-tab-jump" onClick={() => setTab('jump')}>
        外部跳转记录<i>{jumps.length}</i>
      </button>
      <button type="button" className="qx-me-tab" aria-current={tab === 'applications' ? 'true' : undefined} data-testid="member-records-activity-tab-applications" onClick={() => setTab('applications')}>
        求职进度<i>{applications.length}</i>
      </button>
    </div>
  )

  let body: ReactNode
  if (!isLoggedIn) {
    body = <QxMeLoginBlock title="登录后查看本人记录" desc="游客模式不保存跨会话浏览记录，也不保存你自己填写的求职进度；公共一体机不在本机留存这些明细。" struct={struct} onJobs={() => navigate('/jobs')} onPrint={() => navigate('/print-scan')} />
  } else if (state === 'loading') {
    body = <QxMeLoadingBlock title="正在加载本人记录" />
  } else if (state === 'error') {
    body = <QxMeErrorBlock title="记录这次没有加载出来" desc="当前列表没有更新。请检查网络后重试；已有记录不会因为这次失败而消失。" struct={struct} />
  } else if (tab === 'applications') {
    body = applications.length === 0 ? (
      <>
        <QxMeSummary tone="clay" icon={<ClockIcon size={32} />} label="求职进度" big={0} desc="由你自己填写；本终端不参与投递，也不掌握来源平台的结果" minis={['进度 0']} />
        {tabs}
        <section className="qx-me-list qx-me-grow" data-testid="member-records-application-list" aria-label="从这里开始">
          <QxMeStartRow icon={BriefcaseIcon} title="先去看岗位" desc="在岗位详情点「去来源平台投递」，回来再记一笔" label="查看岗位" route="/jobs" testid="member-records-start-jobs" onClick={() => navigate('/jobs')} />
          <QxMePendingRow route="/me/activity?tab=applications" testid="member-records-start-manual" title="投了本站没有的岗位？" sub="也可以自己填公司与岗位名记一笔 · 手填入口待建设" icon={FileTextIcon} />
          <div className="qx-me-legal">在岗位详情页投完之后，从那里把这次投递记进来。<b>空就是空</b>，本页不会替你造进度。</div>
        </section>
        <QxMeGuide items={[['怎么产生', '你自己填写', '本终端不会替你自动记录'], ['这里显示什么', '你填的公司、岗位与进度', '来源平台的处理结果本终端不掌握'], ['谁能看到', '只有本人', '不会提供给企业或来源机构']]} />
      </>
    ) : (
      <>
        <QxMeSummary tone="clay" icon={<ClockIcon size={32} />} label="求职进度" big={applications.length} desc="全部由你自己填写；本终端不参与投递，也不掌握来源平台的结果" minis={[`进度 ${applications.length}`]} />
        {tabs}
        <section className="qx-me-list qx-me-grow" data-testid="member-records-application-list" aria-label="求职进度">
          {applications.map((item) => (
            <div key={item.id} className="qx-me-row" data-testid={`member-records-application-${item.id}`} data-status-source={item.statusSource}>
              <span className="qx-me-row-ico" data-tone="clay" aria-hidden="true"><BriefcaseIcon size={28} /></span>
              <span className="qx-me-row-main">
                <span className="qx-me-row-head">
                  <span className="qx-me-row-title">{item.positionTitle} · {item.companyName}</span>
                  <span className="qx-me-chip qx-me-self">本人自填</span>
                  <span className="qx-me-st">{APPLICATION_STATUS_LABEL[item.status]}</span>
                </span>
                <span className="qx-me-row-sub">
                  {item.selfReportedAt ? `你填写的投递时间 ${formatTime(item.selfReportedAt)}` : '尚未填写投递时间'}
                </span>
              </span>
            </div>
          ))}
          <div className="qx-me-legal">求职进度<b>由你本人填写，仅你可见</b>；本终端不参与投递，也不掌握来源平台的处理结果，更不会把这些记录提供给企业或来源机构。</div>
        </section>
      </>
    )
  } else if (empty) {
    const browseTab = tab === 'browse'
    body = (
      <>
        <QxMeSummary tone="slate" icon={<ClockIcon size={32} />} label="访问足迹" big={0} desc="只记录浏览与打开来源入口动作，不记录投递或预约结果" minis={['浏览 0', '跳转 0']} />
        {tabs}
        <section className="qx-me-list qx-me-grow" aria-label={browseTab ? '从这里开始浏览' : '从这里打开来源入口'}>
          {browseTab ? (
            <>
              <QxMeStartRow icon={BriefcaseIcon} title="看看第三方岗位" desc="浏览来源平台或机构发布的岗位，浏览动作会记在这里" label="查看岗位" route="/jobs" testid="member-records-start-jobs" onClick={() => navigate('/jobs')} />
              <QxMeStartRow icon={CalendarDaysIcon} tone="wheat" title="看看招聘会" desc="查看官方或主办方发布的招聘会信息" label="查看招聘会" route="/job-fairs" testid="member-records-start-fairs" onClick={() => navigate('/job-fairs')} />
              <QxMeStartRow icon={FileTextIcon} tone="plum" title="先做一份简历" desc="诊断或生成之后再去看岗位会更有针对性" label="去简历服务" route="/resume-service" testid="member-records-start-resume" onClick={() => navigate('/resume-service')} />
            </>
          ) : (
            <>
              <QxMeStartRow icon={BriefcaseIcon} title="打开岗位的来源入口" desc="在岗位详情里点「去来源平台投递」或「扫码投递」" label="查看岗位" route="/jobs" testid="member-records-start-jobs" onClick={() => navigate('/jobs')} />
              <QxMeStartRow icon={CalendarDaysIcon} tone="wheat" title="打开招聘会的官方入口" desc="在招聘会详情里点「去来源平台预约」或「扫码预约」" label="查看招聘会" route="/job-fairs" testid="member-records-start-fairs" onClick={() => navigate('/job-fairs')} />
              <QxMeStartRow icon={EyeIcon} tone="slate" title="先看看浏览记录" desc="浏览与打开来源入口是两类记录，分开保存" label="切到浏览记录" route="/me/activity" testid="member-records-start-browse" onClick={() => setTab('browse')} />
            </>
          )}
          <div className="qx-me-legal">
            {browseTab
              ? <>浏览岗位 / 招聘会 / 政策 / 企业之后，这里会出现你的浏览记录。<b>空就是空</b>，本页不会造记录让页面好看。</>
              : <>打开来源平台或官方入口之后，这里会出现记录。<b>是否投递、是否预约得成由来源平台决定，本系统不记录也不参与。</b></>}
          </div>
        </section>
        <QxMeGuide items={[['怎么产生', '浏览或打开来源入口', '这两个动作分开记录'], ['这里显示什么', '动作本身', '不记录投递、预约或签到结果'], ['谁能看到', '只有本人', '退出后本机不留明细']]} />
      </>
    )
  } else {
    body = (
      <>
        <QxMeSummary
          tone="slate"
          icon={<ClockIcon size={32} />}
          label="访问足迹"
          big={browse.length + jumps.length}
          desc="只记录浏览与打开来源入口动作，不记录投递或预约结果"
          minis={[`浏览 ${browse.length}`, `跳转 ${jumps.length}`]}
        />
        {tabs}
        <section className="qx-me-list qx-me-grow" data-testid="member-records-list" aria-label="浏览与跳转记录">
          {tab === 'browse'
            ? browse.map((it) => (
              <button
                key={it.id}
                type="button"
                className="qx-me-row"
                data-activity-kind="browse"
                data-testid={`member-records-activity-${it.id}`}
                onClick={() => navigate(detailRoute(it.targetType, it.targetId, it.externalId))}
              >
                <span className="qx-me-row-ico" data-tone="slate" aria-hidden="true"><EyeIcon size={28} /></span>
                <span className="qx-me-row-main">
                  <span className="qx-me-row-title">{it.targetTitle ?? `${TYPE_LABEL[it.targetType]}详情`}</span>
                  <span className="qx-me-row-sub">浏览 · {TYPE_LABEL[it.targetType]}{it.sourceName ? ` · ${it.sourceName}` : ''} · {formatTime(it.createdAt)}</span>
                </span>
                <span className="qx-me-row-go" aria-hidden="true"><ChevronRightIcon size={22} /></span>
              </button>
            ))
            : jumps.map((it) => (
              <button
                key={it.id}
                type="button"
                className="qx-me-row"
                data-activity-kind="jump"
                data-testid={`member-records-activity-${it.id}`}
                onClick={() => navigate(detailRoute(it.targetType, it.targetId, it.externalId))}
              >
                <span className="qx-me-row-ico" aria-hidden="true"><ExternalLinkIcon size={28} /></span>
                <span className="qx-me-row-main">
                  <span className="qx-me-row-title">{it.targetTitle ?? `${TYPE_LABEL[it.targetType]}详情`}</span>
                  <span className="qx-me-row-sub">打开{actionLabel(it.action, it.targetType)} · {TYPE_LABEL[it.targetType]} · {formatTime(it.createdAt)}</span>
                </span>
                <span className="qx-me-row-go" aria-hidden="true"><ChevronRightIcon size={22} /></span>
              </button>
            ))}
          <div className="qx-me-legal">仅记录本人浏览与打开来源入口的行为；投递 / 预约结果以来源平台为准，本系统不记录</div>
        </section>
      </>
    )
  }

  const primaryLabel = tab === 'jump' ? '查看招聘会' : '查看岗位'
  const primaryGo = () => navigate(tab === 'jump' ? '/job-fairs' : '/jobs')

  return (
    <QxMePage
      title="浏览与跳转记录"
      view="activity"
      screen="member-list"
      screenState={`activity-${uiState}`}
      eyebrow="MY ACTIVITY"
      ask={<>看过什么、去过哪个来源、自己记了哪些进度，<em>都能回看</em>。</>}
      doing={<>浏览与跳转只记录<b>动作本身</b>；求职进度<b>由你自己填写</b>。</>}
      truth={tab === 'applications'
        ? '本终端不参与投递，也不掌握来源平台的处理结果；求职进度仅你可见，不会提供给企业或来源机构。'
        : '本终端不参与投递，也不掌握来源平台的处理结果；求职进度仅你可见，不会提供给企业或来源机构。'}
      ctabar={recordsCtabar(uiState === 'login' || uiState === 'loading' || uiState === 'error' ? uiState : 'ready', navigate, () => setReloadKey((k) => k + 1), loginFrom, primaryLabel, primaryGo)}
    >
      {body}
    </QxMePage>
  )
}
