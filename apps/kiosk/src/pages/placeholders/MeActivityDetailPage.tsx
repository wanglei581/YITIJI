import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { MemberAssetPage, MemberBrowseLogItem, MemberJumpLogItem } from '@ai-job-print/shared'
import { BriefcaseIcon, ClockIcon, EyeIcon, LockIcon, RouteIcon } from 'lucide-react'
import { useAuth } from '../../auth/useAuth'
import { getMyBrowseLogs, getMyJumpLogs } from '../../services/api/activity'
import { formatTime } from '../profile/assets/format'
import { actionLabel, detailRoute, TYPE_LABEL } from '../profile/me/activityPresentation'
import { QxMeCta, QxMeGuide, QxMePage } from '../profile/me/qx/QxMeChrome'
import { QxMeErrorBlock, QxMeLoadingBlock, QxMeLoginBlock, QxMeStructRow } from '../profile/me/qx/QxMeStateBits'
import '../profile/me/styles/member-records-qx.css'

type ActivityRecord =
  | { kind: 'browse'; item: MemberBrowseLogItem }
  | { kind: 'jump'; item: MemberJumpLogItem }

type LoadState = 'loading' | 'error' | 'ready'

async function findRecord<T extends MemberBrowseLogItem>(
  loadPage: (cursor?: string | null) => Promise<MemberAssetPage<T>>,
  id: string,
  isCancelled: () => boolean,
): Promise<T | null> {
  const seen = new Set<string>()
  let cursor: string | null = null
  do {
    if (isCancelled()) return null
    const page = await loadPage(cursor)
    const found = page.items.find((item) => item.id === id)
    if (found) return found
    cursor = page.nextCursor
    if (!cursor) return null
    if (seen.has(cursor)) throw new Error('ACTIVITY_CURSOR_REPEATED')
    seen.add(cursor)
  } while (!isCancelled())
  return null
}

export default function MeActivityDetailPage() {
  const navigate = useNavigate()
  const { id = '' } = useParams()
  const { isLoggedIn, getToken } = useAuth()
  const [state, setState] = useState<LoadState>('loading')
  const [record, setRecord] = useState<ActivityRecord | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const load = useCallback(() => setReloadKey((value) => value + 1), [])

  useEffect(() => {
    if (!isLoggedIn || !id) {
      setRecord(null)
      setState('ready')
      return
    }
    let cancelled = false
    const token = getToken()
    setState('loading')
    setRecord(null)
    Promise.all([
      findRecord((cursor) => getMyBrowseLogs(token, { cursor, pageSize: 50 }), id, () => cancelled),
      findRecord((cursor) => getMyJumpLogs(token, { cursor, pageSize: 50 }), id, () => cancelled),
    ]).then(([browse, jump]) => {
      if (cancelled) return
      setRecord(browse ? { kind: 'browse', item: browse } : jump ? { kind: 'jump', item: jump } : null)
      setState('ready')
    }).catch(() => {
      if (!cancelled) setState('error')
    })
    return () => { cancelled = true }
  }, [getToken, id, isLoggedIn, reloadKey])

  const item = record?.item
  const uiState = !isLoggedIn ? 'login' : state === 'loading' ? 'loading' : state === 'error' ? 'error' : !record || !item ? 'not-found' : 'detail'
  const struct = (
    <>
      <QxMeStructRow icon={EyeIcon} title="这条记录的内容类型" desc="岗位 / 招聘会 / 政策 / 企业" mode={!isLoggedIn ? 'lock' : 'error'} testid="member-records-struct-activity-detail-0" />
      <QxMeStructRow icon={ClockIcon} title="记录时间" desc="由服务端返回" mode={!isLoggedIn ? 'lock' : 'error'} testid="member-records-struct-activity-detail-1" />
      <QxMeStructRow icon={RouteIcon} title="回到原内容" desc="一步回到来源详情" mode={!isLoggedIn ? 'lock' : 'error'} testid="member-records-struct-activity-detail-2" />
    </>
  )

  let inner: ReactNode
  if (!isLoggedIn) {
    inner = <QxMeLoginBlock title="登录后查看本人记录" desc="游客模式不保存跨会话浏览记录，这条记录只对本人可见。" struct={struct} onJobs={() => navigate('/jobs')} onPrint={() => navigate('/print-scan')} />
  } else if (state === 'loading') {
    inner = <QxMeLoadingBlock title="正在读取这条记录" />
  } else if (state === 'error') {
    inner = <QxMeErrorBlock title="这条记录这次没有读到" desc="当前没有读到这条记录。请检查网络后重试。" struct={struct} />
  } else if (!record || !item) {
    inner = (
      <>
        <section className="qx-me-banner" data-testid="qx-me-fallback" data-kind="empty">
          <span className="qx-me-banner-ico" aria-hidden="true"><EyeIcon size={34} /></span>
          <span className="qx-me-banner-main">
            <h2 className="qx-me-banner-t">未找到这条记录</h2>
            <span className="qx-me-banner-p">记录可能已清理，或不属于当前登录账号。<b>本页不会拿别的记录顶替。</b></span>
          </span>
        </section>
        <section className="qx-me-list qx-me-grow" aria-label="这条记录本应包含的字段">{struct}</section>
        <QxMeGuide items={[['可能原因', '记录已被清理', '记录按各自留存期限清理'], ['也可能', '不属于当前账号', '记录只对本人可见'], ['下一步', '回列表重新选择', '列表里只显示本人记录']]} />
      </>
    )
  } else {
    const actionText = record.kind === 'browse' ? '浏览' : actionLabel(record.item.action, item.targetType)
    inner = (
      <>
        <section className="qx-me-detail-head" data-testid="member-records-detail">
          <span className="qx-me-row-ico" aria-hidden="true"><EyeIcon size={32} /></span>
          <div>
            <h2>{item.targetTitle ?? `${TYPE_LABEL[item.targetType]}详情`}</h2>
            <p>{record.kind === 'browse' ? '浏览记录' : actionText} · 仅本人可见</p>
          </div>
        </section>
        <section className="qx-me-list qx-me-grow" data-testid="member-records-detail-fields" aria-label="这条记录包含的字段">
          <div className="qx-me-row" data-detail-field="0">
            <span className="qx-me-row-ico" aria-hidden="true"><EyeIcon size={28} /></span>
            <span className="qx-me-row-main">
              <span className="qx-me-row-title">内容类型</span>
              <span className="qx-me-row-sub">这条记录指向一条来源{TYPE_LABEL[item.targetType]}</span>
            </span>
            <span className="qx-me-acts"><span className="qx-me-chip">{TYPE_LABEL[item.targetType]}</span></span>
          </div>
          <div className="qx-me-row" data-detail-field="1">
            <span className="qx-me-row-ico" data-tone="slate" aria-hidden="true"><RouteIcon size={28} /></span>
            <span className="qx-me-row-main">
              <span className="qx-me-row-title">记录动作</span>
              <span className="qx-me-row-sub">只记「看过」或「打开来源入口」这个动作，不是投递，也不是预约</span>
            </span>
            <span className="qx-me-acts"><span className="qx-me-chip">{actionText}</span></span>
          </div>
          <div className="qx-me-row" data-detail-field="2">
            <span className="qx-me-row-ico" data-tone="wheat" aria-hidden="true"><ClockIcon size={28} /></span>
            <span className="qx-me-row-main">
              <span className="qx-me-row-title">记录时间</span>
              <span className="qx-me-row-sub">由服务端返回，本机不本地留存明细</span>
            </span>
            <span className="qx-me-acts"><span className="qx-me-chip">{formatTime(item.createdAt)}</span></span>
          </div>
          <div className="qx-me-row" data-detail-field="3">
            <span className="qx-me-row-ico" aria-hidden="true"><BriefcaseIcon size={28} /></span>
            <span className="qx-me-row-main">
              <span className="qx-me-row-title">来源机构</span>
              <span className="qx-me-row-sub">来源机构与外部投递入口以岗位详情页为准</span>
            </span>
            <span className="qx-me-acts"><span className="qx-me-chip">{item.sourceName ?? '以详情页为准'}</span></span>
          </div>
          <div className="qx-me-row" data-detail-field="4">
            <span className="qx-me-row-ico" data-tone="plum" aria-hidden="true"><LockIcon size={28} /></span>
            <span className="qx-me-row-main">
              <span className="qx-me-row-title">可见范围</span>
              <span className="qx-me-row-sub">退出或超时后，本机不保留这条记录的明细</span>
            </span>
            <span className="qx-me-acts"><span className="qx-me-chip">仅本人可见</span></span>
          </div>
          <div className="qx-me-legal">这里只记录浏览与打开来源入口动作；投递或预约结果以来源平台为准，本系统不记录也不参与。</div>
        </section>
      </>
    )
  }

  const ctabar = uiState === 'error' ? (
    <>
      <button type="button" className="qx-btn" data-route="/help" onClick={() => navigate('/help')}>联系工作人员</button>
      <button type="button" className="qx-btn" data-variant="primary" data-testid="member-records-primary" onClick={load}>重新加载</button>
    </>
  ) : uiState === 'login' ? (
    <QxMeCta secondaryLabel="返回我的" secondaryRoute="/profile" onSecondary={() => navigate('/profile')} primary={
      <button type="button" className="qx-btn" data-variant="primary" data-testid="member-records-primary" onClick={() => navigate('/login', { state: { from: `/me/activity/${id}` } })}>手机号登录</button>
    } />
  ) : uiState === 'loading' ? (
    <QxMeCta secondaryLabel="返回我的" secondaryRoute="/profile" onSecondary={() => navigate('/profile')} primary={
      <span className="qx-btn" data-variant="primary" aria-disabled="true" data-testid="member-records-primary">记录还未加载完成</span>
    } />
  ) : uiState === 'not-found' ? (
    <QxMeCta secondaryLabel="返回我的" secondaryRoute="/profile" onSecondary={() => navigate('/profile')} primary={
      <button type="button" className="qx-btn" data-variant="primary" data-testid="member-records-primary" onClick={() => navigate('/me/activity')}>返回记录列表</button>
    } />
  ) : (
    <QxMeCta secondaryLabel="返回记录列表" secondaryRoute="/me/activity" onSecondary={() => navigate('/me/activity')} primary={
      <button type="button" className="qx-btn" data-variant="primary" data-testid="member-records-primary" onClick={() => item && navigate(detailRoute(item.targetType, item.targetId, item.externalId))}>查看原内容</button>
    } />
  )

  return (
    <QxMePage
      title="记录详情"
      view="activity-detail"
      screen="activity-detail"
      screenState={`activity-detail-${uiState}`}
      eyebrow="ACTIVITY DETAIL"
      ask={<>这条记录，<em>只说明它自己</em>。</>}
      doing={<>记录里只有<b>内容类型与时间</b>，没有来源平台的处理结果。</>}
      truth="投递 / 预约结果以来源平台为准，本系统不记录也不参与。"
      ctabar={ctabar}
    >
      <section className="me-detail-scroll">
        {inner}
      </section>
    </QxMePage>
  )
}
